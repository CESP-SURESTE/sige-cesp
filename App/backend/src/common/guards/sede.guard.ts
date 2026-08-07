import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { SupabaseEnv } from '@supabase/server';

/**
 * `@supabase/server` (y `jose`, del que depende) son paquetes ESM-only —
 * cargarlos con un `import` estático (que TypeScript baja a `require()` bajo
 * `module: commonjs`/`nodenext`) revienta bajo Jest, cuyo runtime de módulos
 * no soporta la interop `require(esm)` que sí tiene Node nativo desde la
 * 22.x (se confirmó: el mismo código corre bien fuera de Jest, vía
 * `ts-node`/`node dist/main.js`; solo Jest lo rechaza). Se resuelve con
 * `import()` dinámico + caché en módulo — TypeScript preserva los `import()`
 * dinámicos tal cual (no los baja a `require`), así que tanto Node en
 * producción como Jest en tests lo resuelven con el loader ESM real.
 */
let verifyCredentialsFn:
  typeof import('@supabase/server/core').verifyCredentials | undefined;

async function getVerifyCredentials() {
  if (!verifyCredentialsFn) {
    ({ verifyCredentials: verifyCredentialsFn } =
      await import('@supabase/server/core'));
  }
  return verifyCredentialsFn;
}

/**
 * Token de inyección para overridear el JWKS/env que usa `SedeGuard` al
 * verificar el JWT. En producción no se provee (el guard cae al
 * `SUPABASE_URL`/`SUPABASE_JWKS_URL` reales de `process.env`, resueltos
 * internamente por `@supabase/server`). En tests, se sobreescribe con un
 * JWKS de prueba (par de llaves generado en el propio test) para poder
 * firmar JWTs verificables sin depender de una cuenta real de Supabase Auth
 * (Fase 2 todavía no existe) — ver `test/sede-guard.e2e-spec.ts`.
 */
export const SEDE_GUARD_ENV_OVERRIDE = 'SEDE_GUARD_ENV_OVERRIDE';

/**
 * Guard de sede — Fase 1, Día 6.
 *
 * Regla 5.2 de CLAUDE.md: "Todo guard de sede debe extraer sede_id del JWT,
 * nunca confiar en un sede_id que venga en el body del request." Este guard
 * es la aplicación literal de esa regla:
 *
 *   1. Verifica el `Bearer <token>` del header `Authorization` contra el
 *      JWKS del proyecto de Supabase (firma real, no solo decodificar sin
 *      validar).
 *   2. Lee el custom claim `sede_id` del JWT ya verificado (embebido por el
 *      Auth Hook de Supabase, ver Día 5 — `custom_access_token_hook`). Si no
 *      viene, el usuario no tiene sede asignada: 403, no se adivina nada.
 *   3. Si la ruta declara un parámetro de ruta `:sedeId` (convención para
 *      rutas explícitamente scoped a una sede, ej. `GET /sedes/:sedeId`),
 *      compara ese parámetro contra el `sede_id` del JWT — SOLO el JWT es
 *      fuente de verdad; el parámetro de ruta nunca decide nada por sí
 *      mismo, solo se usa para detectar un intento de acceso cruzado y
 *      rechazarlo con 403.
 *   4. Deja `request.sedeId`, `request.userClaims` y `request.jwtClaims`
 *      disponibles para el resto del request — `@SedeActual()` expone
 *      `request.sedeId` a los controllers.
 *
 * Esta es la capa que en la práctica filtra las queries del backend, ya que
 * Prisma se conecta con un rol que bypassa RLS (ver nota en
 * `prisma/migrations/20260806224102_rls_multisede/migration.sql`).
 */
@Injectable()
export class SedeGuard implements CanActivate {
  constructor(
    @Optional()
    @Inject(SEDE_GUARD_ENV_OVERRIDE)
    private readonly envOverride?: Partial<SupabaseEnv>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    const authHeader = request.headers['authorization'];
    const token =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : null;

    if (!token) {
      throw new UnauthorizedException({
        error:
          'Falta el token de autenticación (Authorization: Bearer <token>)',
        code: 'UNAUTHORIZED',
      });
    }

    const verifyCredentials = await getVerifyCredentials();
    const { data: auth, error } = await verifyCredentials(
      { token, apikey: null },
      { auth: 'user', env: this.envOverride },
    );

    if (error || !auth) {
      throw new UnauthorizedException({
        error: 'Token inválido o expirado',
        code: 'UNAUTHORIZED',
      });
    }

    const sedeIdClaim = auth.jwtClaims?.['sede_id'];

    if (typeof sedeIdClaim !== 'string' || sedeIdClaim.length === 0) {
      throw new ForbiddenException({
        error: 'El token no tiene una sede asignada (falta el claim sede_id)',
        code: 'SEDE_NO_ASIGNADA',
      });
    }

    // Regla 5.2 de CLAUDE.md: el parámetro de ruta jamás decide el alcance,
    // solo se compara contra la fuente de verdad (el JWT) para detectar un
    // intento de acceso cruzado.
    const sedeIdParam = request.params?.['sedeId'];
    if (sedeIdParam && sedeIdParam !== sedeIdClaim) {
      throw new ForbiddenException({
        error: 'No tienes acceso a datos de otra sede',
        code: 'SEDE_CROSS_ACCESS',
      });
    }

    request.sedeId = sedeIdClaim;
    request.userClaims = auth.userClaims ?? undefined;
    request.jwtClaims = auth.jwtClaims ?? undefined;

    return true;
  }
}
