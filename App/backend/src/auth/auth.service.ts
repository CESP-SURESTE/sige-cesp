import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * `@supabase/server` (y `jose`, del que depende) son paquetes ESM-only —
 * mismo motivo/solución que en `src/common/guards/sede.guard.ts` (leer el
 * comentario completo ahí): `import()` dinámico + caché a nivel de módulo,
 * para que tanto Node en producción como Jest (vía
 * `--experimental-vm-modules`) lo resuelvan con el loader ESM real.
 *
 * `@supabase/server` publica declaraciones `.d.cts` y `.d.mts` separadas
 * para el mismo símbolo `createAdminClient` (build dual CJS/ESM). Una
 * referencia de tipo (`typeof import(...)`, resuelta en modo `require` por
 * este proyecto) y el `import()` dinámico en runtime (siempre resuelto en
 * modo `import`/ESM por Node) terminan viendo dos copias nominalmente
 * distintas de la clase `SupabaseClient` — mismos campos, pero sus
 * miembros `protected` hacen que TS las rechace como incompatibles
 * (`TS2322`/`TS2589`). El `as unknown as` de abajo es un cast seguro: en
 * runtime es literalmente el mismo `createAdminClient` exportado por el
 * paquete, solo cambia qué archivo `.d.ts` usó TS para tipar la referencia.
 */
type CreateAdminClientFn =
  typeof import('@supabase/server/core').createAdminClient;
type SupabaseAdminClient = ReturnType<CreateAdminClientFn>;

let createAdminClientFn: CreateAdminClientFn | undefined;

async function getCreateAdminClient(): Promise<CreateAdminClientFn> {
  if (!createAdminClientFn) {
    const core = await import('@supabase/server/core');
    createAdminClientFn =
      core.createAdminClient as unknown as CreateAdminClientFn;
  }
  return createAdminClientFn;
}

/**
 * Token de inyección para overridear, en tests, el cliente de Supabase que
 * usa `AuthService` — mismo patrón que `SEDE_GUARD_ENV_OVERRIDE` en
 * `sede.guard.ts`. A diferencia de ese guard (que solo necesita overridear
 * el JWKS para verificar firmas), acá conviene overridear el cliente
 * completo: no existe todavía un usuario real de Supabase Auth contra el
 * cual probar `signInWithPassword` (Fase 2 recién empieza), así que los
 * tests inyectan un cliente con `.auth.signInWithPassword` mockeado en vez
 * de pegarle a un proyecto real.
 *
 * `undefined` por default (producción): el service cae a `createAdminClient()`
 * real, resuelto contra `SUPABASE_URL`/`SUPABASE_SECRET_KEY` de `process.env`.
 */
export const AUTH_SUPABASE_CLIENT_OVERRIDE = 'AUTH_SUPABASE_CLIENT_OVERRIDE';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface LoginResultUser {
  id: string;
  email?: string;
  role?: string;
  appMetadata: Record<string, unknown>;
  userMetadata: Record<string, unknown>;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  expiresAt?: number;
  user: LoginResultUser;
}

/**
 * `AuthService` — Fase 2, Día 7.
 *
 * Wrapper delgado sobre `supabase.auth.signInWithPassword` de Supabase Auth.
 * No emite JWT propio ni toca la tabla `Usuario`: el `access_token` que
 * devuelve Supabase Auth es el mismo que consumen `SedeGuard` (Día 6) y,
 * más adelante, `RolesGuard` (Fase 2) para el resto del API.
 */
@Injectable()
export class AuthService {
  constructor(
    @Optional()
    @Inject(AUTH_SUPABASE_CLIENT_OVERRIDE)
    private readonly clientOverride?: SupabaseAdminClient,
  ) {}

  private async getClient(): Promise<SupabaseAdminClient> {
    if (this.clientOverride) {
      return this.clientOverride;
    }
    const createAdminClient = await getCreateAdminClient();
    return createAdminClient();
  }

  /**
   * Valida el body a mano — capa independiente del `ValidationPipe` global
   * (agregado en Día 9, ver `setup-app.ts`), que ya cubre `LoginDto`
   * (`@IsEmail`, `@IsString`+`@IsNotEmpty`) antes de llegar aquí. Se deja
   * esta segunda validación a propósito: no depende de que el controller
   * siga usando `LoginDto` tal cual, y es la que decide el mensaje/código
   * de error de negocio (`VALIDATION_ERROR`) específico de login.
   * Solo valida presencia/formato, nunca decide autenticación acá.
   */
  private validarCredenciales(
    email: unknown,
    password: unknown,
  ): { email: string; password: string } {
    if (typeof email !== 'string' || email.trim().length === 0) {
      throw new BadRequestException({
        error: 'El email es requerido',
        code: 'VALIDATION_ERROR',
      });
    }

    if (!EMAIL_REGEX.test(email)) {
      throw new BadRequestException({
        error: 'El email tiene un formato inválido',
        code: 'VALIDATION_ERROR',
      });
    }

    if (typeof password !== 'string' || password.length === 0) {
      throw new BadRequestException({
        error: 'La contraseña es requerida',
        code: 'VALIDATION_ERROR',
      });
    }

    return { email, password };
  }

  async login(
    emailInput: unknown,
    passwordInput: unknown,
  ): Promise<LoginResult> {
    const { email, password } = this.validarCredenciales(
      emailInput,
      passwordInput,
    );

    try {
      const client = await this.getClient();

      const { data, error } = await client.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        // Cuenta bloqueada/baneada — supabase-js 2.x expone esto con
        // `code: 'user_banned'` en el `AuthApiError` (ver
        // `@supabase/auth-js/dist/main/lib/error-codes.d.ts`).
        if (error.code === 'user_banned') {
          throw new ForbiddenException({
            error: 'La cuenta está bloqueada',
            code: 'CUENTA_BLOQUEADA',
          });
        }

        // Credenciales inválidas — código explícito `invalid_credentials`.
        if (error.code === 'invalid_credentials') {
          throw new UnauthorizedException({
            error: 'Credenciales inválidas',
            code: 'UNAUTHORIZED',
          });
        }

        // Correo sin confirmar — cuenta real, pero Supabase Auth bloquea el
        // login hasta que se confirme (mismo tratamiento que
        // `CUENTA_BLOQUEADA`: la cuenta existe, el rechazo es por estado,
        // no por credenciales). Encontrado en vivo probando login real
        // (Día 10, QA manual) — antes cualquier cuenta sin confirmar caía
        // al 500 genérico de abajo.
        if (error.code === 'email_not_confirmed') {
          throw new ForbiddenException({
            error: 'Debes confirmar tu correo antes de iniciar sesión',
            code: 'CORREO_NO_CONFIRMADO',
          });
        }

        // Cualquier otro error de Supabase Auth (rate limit, proyecto
        // caído, etc.) — no se filtran detalles internos en el mensaje al
        // cliente, pero sí se loguea server-side (regla 12 de CLAUDE.md
        // raíz) para no repetir el 500 indiagnosticable de Día 10.
        console.error('[AuthService.login] Error no mapeado de Supabase Auth:', {
          code: error.code,
          status: error.status,
          message: error.message,
        });
        throw new InternalServerErrorException({
          error: 'Error inesperado al iniciar sesión',
          code: 'SERVER_ERROR',
        });
      }

      if (!data.session || !data.user) {
        throw new InternalServerErrorException({
          error: 'Error inesperado al iniciar sesión',
          code: 'SERVER_ERROR',
        });
      }

      return {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        tokenType: data.session.token_type,
        expiresIn: data.session.expires_in,
        expiresAt: data.session.expires_at,
        user: {
          id: data.user.id,
          email: data.user.email,
          role: data.user.role,
          appMetadata: data.user.app_metadata,
          userMetadata: data.user.user_metadata,
        },
      };
    } catch (err) {
      // Los errores ya mapeados arriba (`ForbiddenException`,
      // `UnauthorizedException`, `InternalServerErrorException`) son
      // `HttpException` — se relanzan tal cual. Cualquier otra excepción
      // (ej. `signInWithPassword` lanzando en vez de devolver `{ error }`,
      // el propio `createAdminClient()` fallando por env mal configurado)
      // cae acá y se normaliza a 500 `SERVER_ERROR` sin filtrar detalles.
      if (err instanceof HttpException) {
        throw err;
      }

      // Regla 12 de CLAUDE.md raíz — loguear antes de responder, aunque el
      // cliente solo reciba el 500 genérico sin detalles.
      console.error('[AuthService.login] Excepción no-HTTP:', err);

      throw new InternalServerErrorException({
        error: 'Error inesperado al iniciar sesión',
        code: 'SERVER_ERROR',
      });
    }
  }
}
