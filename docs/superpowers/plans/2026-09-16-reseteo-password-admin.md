# Reseteo de contraseña disparado por administrativo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un ADMINISTRATIVO dispara, desde el listado de personas, el envío de un enlace de restablecimiento de contraseña a la persona (alumno/maestro/administrativo). La persona completa el cambio ella misma desde ese enlace — sin autoservicio de solicitud, sin tabla de tokens propia.

**Architecture:** Backend agrega 2 endpoints (`POST /personas/:id/resetear-password` para disparar, `POST /auth/completar-reseteo` para el efecto secundario tras el cambio real) + 1 método nuevo de `MailService` + 1 valor nuevo de enum. El cambio de contraseña real ocurre 100% client-side vía `supabase.auth.updateUser()`, usando la sesión de recuperación que Supabase establece automáticamente cuando el navegador abre el link generado por `client.auth.admin.generateLink({ type: 'recovery' })`. Frontend agrega una página pública nueva, un modal compartido, un hook de cooldown en `localStorage`, y el botón en los 3 listados de personas.

**Tech Stack:** NestJS + Prisma 6.x + `@supabase/server` (Admin API) + Mailgun (`fetch` nativo) · Next.js (App Router) + `@supabase/ssr` + React Query + Tailwind.

## Global Constraints

- Regla 2 de CLAUDE.md raíz: `sedeId` siempre de `@SedeActual()`, nunca de body/query/path.
- Regla 5: `RegistroAuditoria` solo se crea automáticamente dentro de la operación, nunca vía endpoint de escritura directa.
- Regla 7: jerarquía de `nivelPermiso` (`SUPER_ADMIN > ADMIN > AUXILIAR`) aplica SOLO cuando el target de una acción administrativa es `ADMINISTRATIVO` — nunca para `ALUMNO`/`MAESTRO`.
- Regla 12: todo catch loguea con `console.error` (backend) antes de responder, y también en frontend antes de un `toast.error`.
- Alcance: SOLO los 3 roles con cuenta Supabase Auth (ALUMNO/MAESTRO/ADMINISTRATIVO). `/plataforma` (`AdminPlataforma`) queda fuera — no tocar ese módulo.
- Sin autoservicio: NO se construye ningún formulario público de "olvidé mi contraseña" que reciba un login/email como input. El único disparador es el admin desde el CRUD.
- Cooldown de 1h por par (admin, persona) — SOLO frontend (`localStorage`), sin verificación en el backend.
- El correo de reseteo NO es best-effort silencioso — si Mailgun falla, el endpoint responde `500 SERVER_ERROR` (a diferencia del correo de bienvenida).
- Nunca loguear ni persistir el link/token de recuperación en `RegistroAuditoria` ni en ningún log — solo metadatos (`rol`, ids).
- Sin librerías nuevas.
- `prisma migrate dev` está roto en este repo (`P3006`, shadow-DB) — las migraciones se escriben a mano (mismo patrón que `20260908120000_accion_auditoria_consulta_emergencia`) y se aplican con `npx prisma migrate deploy` (nunca `migrate dev`).
- Spec completo: `docs/superpowers/specs/2026-09-16-reseteo-password-admin-design.md`.

---

## Task 1: Backend — disparar el reseteo (`POST /personas/:id/resetear-password`)

**Files:**
- Create: `App/backend/prisma/migrations/20260916120000_accion_auditoria_reseteo_password/migration.sql`
- Modify: `App/backend/prisma/schema.prisma` (enum `AccionAuditoria`)
- Modify: `App/backend/src/mail/mail.service.ts` (nuevo método `enviarCorreoReseteoPassword`)
- Modify: `App/backend/src/personas/personas.service.ts` (nuevo método `resetearPassword`)
- Modify: `App/backend/src/personas/personas.controller.ts` (nueva ruta)
- Create: `App/backend/test/personas-resetear-password.e2e-spec.ts`

**Interfaces:**
- Consumes: `PersonasService.JERARQUIA_NIVEL_PERMISO` (ya existe, `private static readonly`, línea ~223 de `personas.service.ts`), `obtenerCorreosPersonales(prisma, usuarioIds)` de `src/common/publicacion/correos-destinatarios.util.ts` (firma: `(prisma: PrismaService, usuarioIds: string[]) => Promise<{ usuarioId: string; correoPersonal: string }[]>`), `this.getClient()` / `PERSONAS_SUPABASE_CLIENT_OVERRIDE` (ya existen en `personas.service.ts`).
- Produces: `MailService.enviarCorreoReseteoPassword(params: EnviarCorreoReseteoPasswordParams): Promise<void>` — la usará también el frontend indirectamente (vía el endpoint), y la reutilizará cualquier caller futuro. `PersonasService.resetearPassword(id: string, sedeId: string, actorUsuarioId: string): Promise<{ ok: true }>`. Ruta `POST /personas/:id/resetear-password`.

- [ ] **Step 1: Migración — `AccionAuditoria` gana `RESETEO_PASSWORD`**

Editar `App/backend/prisma/schema.prisma`, en el enum `AccionAuditoria` (busca `CONSULTA_EMERGENCIA`):

```prisma
enum AccionAuditoria {
  ALTA
  BAJA
  EDICION
  CAMBIO_PERMISO
  CAMBIO_ESTATUS
  ELIMINACION
  CONSULTA_EMERGENCIA
  RESETEO_PASSWORD
}
```

Crear el directorio `App/backend/prisma/migrations/20260916120000_accion_auditoria_reseteo_password/` con el archivo `migration.sql`:

```sql
-- AlterEnum
ALTER TYPE "AccionAuditoria" ADD VALUE 'RESETEO_PASSWORD';
```

Aplicar contra la DB de dev:

```bash
cd App/backend
npx prisma migrate deploy
npx prisma generate
```

Confirmar que `npx prisma migrate status` no reporta migraciones pendientes ni drift.

- [ ] **Step 2: `MailService.enviarCorreoReseteoPassword`**

En `App/backend/src/mail/mail.service.ts`, agregar (después de `EnviarCorreoBienvenidaParams`, junto a las demás interfaces de params):

```ts
export interface EnviarCorreoReseteoPasswordParams {
  nombreCompleto: string;
  /** Destino real (`to:`) — SIEMPRE `correoPersonal` del perfil, nunca `Usuario.email`. */
  correoDestino: string;
  /** Link de recuperación generado por `client.auth.admin.generateLink({ type: 'recovery' })`. */
  linkReseteo: string;
}
```

Agregar 2 builders privados (junto a `buildTexto`/`buildHtml` existentes):

```ts
private buildTextoReseteo(params: EnviarCorreoReseteoPasswordParams): string {
  const { nombreCompleto, linkReseteo } = params;
  return [
    `Hola ${nombreCompleto},`,
    '',
    'Un administrativo de SIGE (Sistema de Gestión Escolar de CESP) solicitó restablecer tu contraseña.',
    '',
    `Da clic aquí para elegir una contraseña nueva: ${linkReseteo}`,
    '',
    'Si tú no solicitaste esto, puedes ignorar este correo — tu contraseña actual sigue siendo válida.',
    '',
    'SIGE CESP',
  ].join('\n');
}

private buildHtmlReseteo(params: EnviarCorreoReseteoPasswordParams): string {
  const { nombreCompleto, linkReseteo } = params;
  return `
    <div style="font-family: Arial, sans-serif; font-size: 14px; color: #1f2937;">
      <p>Hola <strong>${nombreCompleto}</strong>,</p>
      <p>Un administrativo de SIGE (Sistema de Gestión Escolar de CESP) solicitó restablecer tu contraseña.</p>
      <p><a href="${linkReseteo}">Da clic aquí para elegir una contraseña nueva</a></p>
      <p>Si tú no solicitaste esto, puedes ignorar este correo — tu contraseña actual sigue siendo válida.</p>
      <p>SIGE CESP</p>
    </div>
  `.trim();
}
```

Agregar el método público (después de `enviarCorreoBienvenida`, antes de `enviarNotificacion`):

```ts
/**
 * A diferencia de `enviarCorreoBienvenida`/`enviarNotificacion`, el CALLER
 * (`PersonasService.resetearPassword`) NO envuelve esta llamada en un
 * try/catch silencioso — el correo es el único mecanismo de entrega del
 * link, así que un fallo de Mailgun debe propagarse como error real, no
 * tragarse como best-effort.
 */
async enviarCorreoReseteoPassword(
  params: EnviarCorreoReseteoPasswordParams,
): Promise<void> {
  if (!enviosHabilitados()) {
    console.log(
      '[MailService] Envío deshabilitado (MAILGUN_ENVIOS_HABILITADO=false) — se hubiera enviado reseteo a:',
      params.correoDestino,
    );
    return;
  }

  await this.enviarCorreoAMailgun(
    params.correoDestino,
    'Restablece tu contraseña — SIGE CESP',
    this.buildTextoReseteo(params),
    this.buildHtmlReseteo(params),
  );
}
```

- [ ] **Step 3: `PersonasService.resetearPassword`**

En `App/backend/src/personas/personas.service.ts`, agregar el import del helper (junto a los demás imports de `../common` si existen, o agregar la línea nueva):

```ts
import { obtenerCorreosPersonales } from '../common/publicacion/correos-destinatarios.util';
```

Agregar el método nuevo, al final de la clase (después de `cambiarEstatus`, antes del `}` de cierre de la clase):

```ts
/**
 * `POST /personas/:id/resetear-password` — disparado por un ADMINISTRATIVO
 * desde el CRUD (sin autoservicio, decisión explícita del usuario). Genera
 * un link de recuperación NATIVO de Supabase Auth (`generateLink`, tipo
 * `recovery`) y lo envía por Mailgun al `correoPersonal` de la persona — el
 * cambio de contraseña real ocurre después, 100% client-side, cuando la
 * persona abre ese link (`supabase.auth.updateUser()`, ver
 * `app/restablecer-password/page.tsx`).
 *
 * A diferencia de `cambiarEstatus`, el correo NO es best-effort: si Mailgun
 * falla, este método propaga el error como `500 SERVER_ERROR` (ver
 * `MailService.enviarCorreoReseteoPassword`).
 */
async resetearPassword(
  id: string,
  sedeId: string,
  actorUsuarioId: string,
): Promise<{ ok: true }> {
  try {
    const usuario = await this.prisma.usuario.findFirst({
      where: { id, sedeId },
      select: {
        id: true,
        email: true,
        rol: true,
        perfilAlumno: {
          select: { nombres: true, apellidoPaterno: true, apellidoMaterno: true },
        },
        perfilMaestro: {
          select: { nombres: true, apellidoPaterno: true, apellidoMaterno: true },
        },
        perfilAdministrativo: {
          select: {
            nombres: true,
            apellidoPaterno: true,
            apellidoMaterno: true,
            nivelPermiso: true,
          },
        },
      },
    });

    if (!usuario) {
      throw new NotFoundException({
        error: 'Persona no encontrada en tu sede',
        code: 'NOT_FOUND',
      });
    }

    if (usuario.rol === RolUsuario.ADMINISTRATIVO && usuario.perfilAdministrativo) {
      const perfilActor = await this.prisma.perfilAdministrativo.findUnique({
        where: { usuarioId: actorUsuarioId },
        select: { nivelPermiso: true },
      });
      const nivelActor = perfilActor?.nivelPermiso ?? NivelPermiso.AUXILIAR;

      if (nivelActor === NivelPermiso.AUXILIAR) {
        throw new ForbiddenException({
          error:
            'Un usuario con nivel AUXILIAR no puede resetear la contraseña de personal administrativo',
          code: 'NIVEL_PERMISO_INSUFICIENTE',
        });
      }

      const rangoActor = PersonasService.JERARQUIA_NIVEL_PERMISO[nivelActor];
      const rangoObjetivo =
        PersonasService.JERARQUIA_NIVEL_PERMISO[
          usuario.perfilAdministrativo.nivelPermiso
        ];

      if (rangoActor < rangoObjetivo) {
        throw new ForbiddenException({
          error:
            'No tienes nivel de permiso suficiente para resetear la contraseña de este administrativo',
          code: 'NIVEL_PERMISO_INSUFICIENTE',
        });
      }
    }

    const perfil =
      usuario.perfilAlumno ?? usuario.perfilMaestro ?? usuario.perfilAdministrativo;
    const nombreCompleto = perfil
      ? [perfil.nombres, perfil.apellidoPaterno, perfil.apellidoMaterno]
          .filter(Boolean)
          .join(' ')
      : usuario.email;

    const correos = await obtenerCorreosPersonales(this.prisma, [id]);
    const correoPersonal = correos[0]?.correoPersonal;

    if (!correoPersonal) {
      console.error(
        '[PersonasService.resetearPassword] La persona no tiene correoPersonal registrado:',
        { id },
      );
      throw new InternalServerErrorException({
        error: 'Error inesperado al resetear la contraseña',
        code: 'SERVER_ERROR',
      });
    }

    const client = await this.getClient();
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    const { data, error } = await client.auth.admin.generateLink({
      type: 'recovery',
      email: usuario.email,
      options: { redirectTo: `${frontendUrl}/restablecer-password` },
    });

    if (error || !data?.properties?.action_link) {
      console.error(
        '[PersonasService.resetearPassword] Error generando el link de recuperación en Supabase Auth:',
        error,
      );
      throw new InternalServerErrorException({
        error: 'Error inesperado al resetear la contraseña',
        code: 'SERVER_ERROR',
      });
    }

    // El correo NO es best-effort acá (ver comentario del método) — si
    // lanza, cae al catch de abajo y se mapea a 500 SERVER_ERROR.
    await this.mailService.enviarCorreoReseteoPassword({
      nombreCompleto,
      correoDestino: correoPersonal,
      linkReseteo: data.properties.action_link,
    });

    try {
      await this.prisma.registroAuditoria.create({
        data: {
          usuarioId: actorUsuarioId,
          sedeId,
          accion: AccionAuditoria.RESETEO_PASSWORD,
          entidad: 'Usuario',
          entidadId: id,
          detalle: { rol: usuario.rol },
        },
      });
    } catch (err) {
      // El link ya se generó y el correo ya se envió — no hay nada que
      // compensar si solo falla la auditoría (regla 12, mismo criterio que
      // el fallback de `AuthService.cambiarPassword`).
      console.error(
        '[PersonasService.resetearPassword] El correo se envió pero falló el RegistroAuditoria:',
        err,
      );
    }

    return { ok: true };
  } catch (err) {
    if (
      err instanceof NotFoundException ||
      err instanceof ForbiddenException ||
      err instanceof InternalServerErrorException
    ) {
      throw err;
    }

    console.error(
      '[PersonasService.resetearPassword] Error inesperado reseteando contraseña:',
      err,
    );
    throw new InternalServerErrorException({
      error: 'Error inesperado al resetear la contraseña',
      code: 'SERVER_ERROR',
    });
  }
}
```

- [ ] **Step 4: Ruta en `PersonasController`**

En `App/backend/src/personas/personas.controller.ts`, agregar (después del método `cambiarEstatus`, antes del `}` de cierre de la clase):

```ts
@Post(':id/resetear-password')
@Roles(RolUsuario.ADMINISTRATIVO)
async resetearPassword(
  @Param('id') id: string,
  @SedeActual() sedeId: string,
  @ActorUsuarioId() actorUsuarioId: string,
) {
  const data = await this.personasService.resetearPassword(
    id,
    sedeId,
    actorUsuarioId,
  );
  return { data };
}
```

Confirmar que `Post` ya está importado desde `@nestjs/common` en este archivo (ya lo usa el método `crear`/`altaPersona` vía `@Post()`); si no, agregarlo al import existente.

- [ ] **Step 5: Test e2e**

Crear `App/backend/test/personas-resetear-password.e2e-spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { NivelPermiso, PuestoAdministrativo, RolUsuario } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { SEDE_GUARD_ENV_OVERRIDE } from '../src/common/guards/sede.guard';
import { PERSONAS_SUPABASE_CLIENT_OVERRIDE } from '../src/personas/personas.service';
import { MAIL_FETCH_OVERRIDE } from '../src/mail/mail.service';
import { loadEnv } from '../src/load-env';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup-app';

loadEnv();

interface ErrorBody {
  error: string;
  code: string;
}

describe('PersonasController — POST /personas/:id/resetear-password (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let sedeValladolidId: string;
  let actorAdminId: string;
  let actorAuxiliarId: string;
  let generateLink: jest.Mock;
  let mailFetch: jest.Mock;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';
  const flagOriginal = process.env.MAILGUN_ENVIOS_HABILITADO;
  const usuarioIdsCreados: string[] = [];

  async function firmarToken(sub: string, sedeId: string): Promise<string> {
    return new jose.SignJWT({
      role: 'authenticated',
      sede_id: sedeId,
      rol: RolUsuario.ADMINISTRATIVO,
    })
      .setProtectedHeader({ alg, kid })
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  async function crearAdministrativoFixture(params: {
    sedeId: string;
    nivelPermiso: NivelPermiso;
  }): Promise<string> {
    const usuario = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.reseteo.${randomUUID()}@example.com`,
        rol: RolUsuario.ADMINISTRATIVO,
        sedeId: params.sedeId,
      },
    });
    await prisma.perfilAdministrativo.create({
      data: {
        usuarioId: usuario.id,
        nombres: 'Fixture',
        apellidoPaterno: 'Reseteo',
        curp: `FX${randomUUID().slice(0, 16).toUpperCase()}`,
        correoPersonal: `fixture.reseteo.personal.${randomUUID()}@example.com`,
        telefono: '9990009999',
        fechaContratacion: new Date('2024-01-01'),
        puesto: PuestoAdministrativo.AUXILIAR,
        nivelPermiso: params.nivelPermiso,
      },
    });
    usuarioIdsCreados.push(usuario.id);
    return usuario.id;
  }

  beforeAll(async () => {
    process.env.MAILGUN_ENVIOS_HABILITADO = 'true';

    jose = await import('jose');
    const keyPair = await jose.generateKeyPair(alg, { extractable: true });
    privateKey = keyPair.privateKey;
    const publicJwk = await jose.exportJWK(keyPair.publicKey);
    publicJwk.kid = kid;
    publicJwk.alg = alg;
    publicJwk.use = 'sig';

    generateLink = jest.fn();
    const mockSupabaseAdminClient = {
      auth: { admin: { generateLink } },
    };
    mailFetch = jest.fn();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SEDE_GUARD_ENV_OVERRIDE)
      .useValue({ jwks: { keys: [publicJwk] } })
      .overrideProvider(PERSONAS_SUPABASE_CLIENT_OVERRIDE)
      .useValue(mockSupabaseAdminClient)
      .overrideProvider(MAIL_FETCH_OVERRIDE)
      .useValue(mailFetch)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    const merida = await prisma.sede.findUniqueOrThrow({
      where: { nombre: 'CESP Mérida' },
    });
    sedeMeridaId = merida.id;
    const valladolid = await prisma.sede.findUniqueOrThrow({
      where: { nombre: 'CESP Valladolid' },
    });
    sedeValladolidId = valladolid.id;

    actorAdminId = await crearAdministrativoFixture({
      sedeId: sedeMeridaId,
      nivelPermiso: NivelPermiso.ADMIN,
    });
    actorAuxiliarId = await crearAdministrativoFixture({
      sedeId: sedeMeridaId,
      nivelPermiso: NivelPermiso.AUXILIAR,
    });
  });

  afterEach(() => {
    generateLink.mockReset();
    mailFetch.mockReset();
  });

  afterAll(async () => {
    process.env.MAILGUN_ENVIOS_HABILITADO = flagOriginal;
    if (usuarioIdsCreados.length > 0) {
      await prisma.registroAuditoria.deleteMany({
        where: { entidadId: { in: usuarioIdsCreados } },
      });
      await prisma.registroAuditoria.deleteMany({
        where: { usuarioId: { in: usuarioIdsCreados } },
      });
      await prisma.perfilAdministrativo.deleteMany({
        where: { usuarioId: { in: usuarioIdsCreados } },
      });
      await prisma.usuario.deleteMany({
        where: { id: { in: usuarioIdsCreados } },
      });
    }
    await app.close();
  });

  it('devuelve 200 y llama a Mailgun con el link generado por Supabase', async () => {
    const objetivoId = await crearAdministrativoFixture({
      sedeId: sedeMeridaId,
      nivelPermiso: NivelPermiso.AUXILIAR,
    });
    generateLink.mockResolvedValue({
      data: { properties: { action_link: 'https://supabase.example/verify?token=abc' } },
      error: null,
    });
    mailFetch.mockResolvedValue({
      ok: true,
      text: async () => '',
    } as unknown as Response);

    const token = await firmarToken(actorAdminId, sedeMeridaId);

    await request(app.getHttpServer() as App)
      .post(`/personas/${objetivoId}/resetear-password`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect((res.body as { data: { ok: true } }).data.ok).toBe(true);
      });

    expect(generateLink).toHaveBeenCalledWith({
      type: 'recovery',
      email: expect.stringContaining('fixture.reseteo.'),
      options: { redirectTo: expect.stringContaining('/restablecer-password') },
    });
    expect(mailFetch).toHaveBeenCalledTimes(1);
  });

  it('devuelve 404 si la persona es de otra sede', async () => {
    const objetivoOtraSedeId = await crearAdministrativoFixture({
      sedeId: sedeValladolidId,
      nivelPermiso: NivelPermiso.AUXILIAR,
    });
    const token = await firmarToken(actorAdminId, sedeMeridaId);

    await request(app.getHttpServer() as App)
      .post(`/personas/${objetivoOtraSedeId}/resetear-password`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404)
      .expect((res) => {
        expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
      });

    expect(generateLink).not.toHaveBeenCalled();
  });

  it('devuelve 403 NIVEL_PERMISO_INSUFICIENTE si un AUXILIAR intenta resetear a un administrativo', async () => {
    const objetivoId = await crearAdministrativoFixture({
      sedeId: sedeMeridaId,
      nivelPermiso: NivelPermiso.ADMIN,
    });
    const token = await firmarToken(actorAuxiliarId, sedeMeridaId);

    await request(app.getHttpServer() as App)
      .post(`/personas/${objetivoId}/resetear-password`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403)
      .expect((res) => {
        expect((res.body as ErrorBody).code).toBe('NIVEL_PERMISO_INSUFICIENTE');
      });

    expect(generateLink).not.toHaveBeenCalled();
  });

  it('devuelve 500 SERVER_ERROR si Mailgun falla (el correo no es best-effort acá)', async () => {
    const objetivoId = await crearAdministrativoFixture({
      sedeId: sedeMeridaId,
      nivelPermiso: NivelPermiso.AUXILIAR,
    });
    generateLink.mockResolvedValue({
      data: { properties: { action_link: 'https://supabase.example/verify?token=abc' } },
      error: null,
    });
    mailFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'mailgun caído',
    } as unknown as Response);

    const token = await firmarToken(actorAdminId, sedeMeridaId);

    await request(app.getHttpServer() as App)
      .post(`/personas/${objetivoId}/resetear-password`)
      .set('Authorization', `Bearer ${token}`)
      .expect(500)
      .expect((res) => {
        expect((res.body as ErrorBody).code).toBe('SERVER_ERROR');
      });
  });
});
```

- [ ] **Step 6: Correr la suite**

```bash
cd App/backend
npx jest test/personas-resetear-password.e2e-spec.ts --runInBand
```

Expected: 4/4 tests en verde. Luego correr la suite e2e completa para confirmar que no se rompió nada:

```bash
npx jest --config test/jest-e2e.json --runInBand
```

Expected: todos los tests en verde (el número exacto de suites/tests crece en 1 archivo + 4 casos respecto al último conteo documentado en `CLAUDE.md`).

- [ ] **Step 7: Commit**

```bash
cd App/backend
git add prisma/schema.prisma prisma/migrations/20260916120000_accion_auditoria_reseteo_password src/mail/mail.service.ts src/personas/personas.service.ts src/personas/personas.controller.ts test/personas-resetear-password.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(backend): endpoint para que un admin dispare el reseteo de contraseña

POST /personas/:id/resetear-password genera un link de recuperación
nativo de Supabase Auth (generateLink) y lo envía por Mailgun al
correoPersonal de la persona. Sin autoservicio: solo un ADMINISTRATIVO
puede dispararlo, con la misma jerarquía de nivelPermiso que ya aplica
a PATCH /personas/:id/estatus cuando el target es ADMINISTRATIVO. El
correo no es best-effort aquí: si Mailgun falla, la respuesta es 500.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Backend — completar el reseteo (`POST /auth/completar-reseteo`)

**Files:**
- Modify: `App/backend/src/auth/auth.service.ts` (nuevo método `completarReseteo`)
- Modify: `App/backend/src/auth/auth.controller.ts` (nueva ruta)
- Create: `App/backend/test/completar-reseteo.e2e-spec.ts`

**Interfaces:**
- Consumes: nada de Task 1 directamente (endpoints independientes) — solo el valor de enum `AccionAuditoria.EDICION` (ya existente) y los decoradores `@ActorUsuarioId()`/`@SedeActual()`/`SedeGuard` (ya existentes, mismos que usa `cambiarPassword`).
- Produces: `AuthService.completarReseteo(actorUsuarioId: string, sedeId: string): Promise<{ ok: true }>`. Ruta `POST /auth/completar-reseteo`. Lo consumirá el frontend en Task 4.

- [ ] **Step 1: `AuthService.completarReseteo`**

En `App/backend/src/auth/auth.service.ts`, agregar el método al final de la clase (después de `cambiarPassword`, antes del `}` de cierre):

```ts
/**
 * `POST /auth/completar-reseteo` — se llama DESPUÉS de que el navegador ya
 * cambió la contraseña real vía `supabase.auth.updateUser()` (client-side,
 * usando la sesión de recuperación que Supabase estableció al abrir el link
 * de `PersonasService.resetearPassword`). Este método NO toca Supabase Auth
 * — solo limpia `primerIngreso` y deja el rastro de auditoría, mismo
 * criterio que el paso (c)+(d) de `cambiarPassword`.
 *
 * Reusa `AccionAuditoria.EDICION` (mismo criterio que `cambiarPassword`: el
 * enum no tiene un valor dedicado a "completar un reseteo", y semánticamente
 * es una edición de la propia fila `Usuario`).
 */
async completarReseteo(
  actorUsuarioId: string,
  sedeId: string,
): Promise<{ ok: true }> {
  try {
    await this.prisma.usuario.update({
      where: { id: actorUsuarioId },
      data: { primerIngreso: false },
    });

    await this.prisma.registroAuditoria.create({
      data: {
        usuarioId: actorUsuarioId,
        sedeId,
        accion: AccionAuditoria.EDICION,
        entidad: 'Usuario',
        entidadId: actorUsuarioId,
        detalle: { accion: 'completar_reseteo_password' },
      },
    });
  } catch (err) {
    // La contraseña ya es correcta en Supabase Auth en este punto (el
    // navegador ya llamó updateUser) — no hay nada que compensar si esto
    // falla, mismo criterio que el fallback de `cambiarPassword`.
    console.error(
      '[AuthService.completarReseteo] Falló primerIngreso/RegistroAuditoria tras un reseteo ya completado en Supabase Auth:',
      err,
    );
  }

  return { ok: true };
}
```

- [ ] **Step 2: Ruta en `AuthController`**

En `App/backend/src/auth/auth.controller.ts`, agregar (después de `cambiarPassword`, antes del `}` de cierre de la clase):

```ts
@Post('completar-reseteo')
@HttpCode(200)
@UseGuards(SedeGuard)
async completarReseteo(
  @ActorUsuarioId() actorUsuarioId: string,
  @SedeActual() sedeId: string,
) {
  const data = await this.authService.completarReseteo(actorUsuarioId, sedeId);
  return { data };
}
```

- [ ] **Step 3: Test e2e**

Crear `App/backend/test/completar-reseteo.e2e-spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { RolUsuario } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { SEDE_GUARD_ENV_OVERRIDE } from '../src/common/guards/sede.guard';
import { loadEnv } from '../src/load-env';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup-app';

loadEnv();

describe('AuthController — POST /auth/completar-reseteo (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';
  const usuarioIdsCreados: string[] = [];

  async function firmarToken(sub: string, sedeId: string): Promise<string> {
    return new jose.SignJWT({
      role: 'authenticated',
      sede_id: sedeId,
      rol: RolUsuario.ALUMNO,
    })
      .setProtectedHeader({ alg, kid })
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  beforeAll(async () => {
    jose = await import('jose');
    const keyPair = await jose.generateKeyPair(alg, { extractable: true });
    privateKey = keyPair.privateKey;
    const publicJwk = await jose.exportJWK(keyPair.publicKey);
    publicJwk.kid = kid;
    publicJwk.alg = alg;
    publicJwk.use = 'sig';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SEDE_GUARD_ENV_OVERRIDE)
      .useValue({ jwks: { keys: [publicJwk] } })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    const merida = await prisma.sede.findUniqueOrThrow({
      where: { nombre: 'CESP Mérida' },
    });
    sedeMeridaId = merida.id;
  });

  afterAll(async () => {
    if (usuarioIdsCreados.length > 0) {
      await prisma.registroAuditoria.deleteMany({
        where: { usuarioId: { in: usuarioIdsCreados } },
      });
      await prisma.perfilAlumno.deleteMany({
        where: { usuarioId: { in: usuarioIdsCreados } },
      });
      await prisma.usuario.deleteMany({
        where: { id: { in: usuarioIdsCreados } },
      });
    }
    await app.close();
  });

  it('pone primerIngreso en false y responde 200', async () => {
    const usuario = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.completar-reseteo.${randomUUID()}@example.com`,
        rol: RolUsuario.ALUMNO,
        sedeId: sedeMeridaId,
        primerIngreso: true,
      },
    });
    usuarioIdsCreados.push(usuario.id);

    const token = await firmarToken(usuario.id, sedeMeridaId);

    await request(app.getHttpServer() as App)
      .post('/auth/completar-reseteo')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect((res.body as { data: { ok: true } }).data.ok).toBe(true);
      });

    const actualizado = await prisma.usuario.findUniqueOrThrow({
      where: { id: usuario.id },
    });
    expect(actualizado.primerIngreso).toBe(false);
  });

  it('devuelve 401 sin JWT', async () => {
    await request(app.getHttpServer() as App)
      .post('/auth/completar-reseteo')
      .expect(401);
  });
});
```

- [ ] **Step 4: Correr la suite**

```bash
cd App/backend
npx jest test/completar-reseteo.e2e-spec.ts --runInBand
```

Expected: 2/2 en verde. Luego correr la suite completa (`npx jest --config test/jest-e2e.json --runInBand`) — todo en verde.

- [ ] **Step 5: Commit**

```bash
cd App/backend
git add src/auth/auth.service.ts src/auth/auth.controller.ts test/completar-reseteo.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(backend): endpoint para completar un reseteo de contraseña

POST /auth/completar-reseteo se llama después de que el navegador ya
cambió la contraseña real vía supabase.auth.updateUser() (sesión de
recuperación establecida por el link de Task 1). Solo limpia
primerIngreso y audita, mismo criterio que el paso final de
cambiarPassword — reusa AccionAuditoria.EDICION.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Frontend — botón y modal en los 3 listados de personas

**Files:**
- Modify: `App/frontend/src/lib/api/personas.ts` (nueva función `resetearPasswordPersona`)
- Create: `App/frontend/src/components/admin/ui/personas-listado/ResetearPasswordModal.tsx`
- Create: `App/frontend/src/components/admin/ui/personas-listado/useCooldownReseteo.ts`
- Modify: `App/frontend/src/app/admin/administrativos/page.tsx`
- Modify: `App/frontend/src/app/admin/maestros/page.tsx`
- Modify: `App/frontend/src/app/admin/alumnos/page.tsx`

**Interfaces:**
- Consumes: `POST /personas/:id/resetear-password` de Task 1 (backend ya debe estar mergeado/disponible antes de este task).
- Produces: nada que otro task de este plan consuma (Task 4 es independiente — página pública, no toca los listados).

- [ ] **Step 1: `resetearPasswordPersona` en `lib/api/personas.ts`**

En `App/frontend/src/lib/api/personas.ts`, agregar al final del archivo (después de `cambiarEstatusPersona`):

```ts
/**
 * `POST /personas/:id/resetear-password` — dispara el envío de un enlace de
 * restablecimiento al correo personal de la persona (`usuarioId`). Sin
 * body — el backend resuelve todo desde `:id` + el JWT del actor. Sin
 * cooldown en esta capa — lo maneja `useCooldownReseteo` en el componente.
 */
export function resetearPasswordPersona(usuarioId: string): Promise<{ ok: true }> {
  return apiFetchAuth<{ ok: true }>(`/personas/${usuarioId}/resetear-password`, {
    method: 'POST',
  });
}
```

- [ ] **Step 2: `ResetearPasswordModal.tsx`**

Crear `App/frontend/src/components/admin/ui/personas-listado/ResetearPasswordModal.tsx`:

```tsx
'use client';

/**
 * Modal de confirmación para `POST /personas/:id/resetear-password` — mismo
 * patrón visual que `CambiarEstatusModal.tsx` (overlay + panel `max-w-md`),
 * pero sin campos: es una confirmación simple, no un formulario. NO muestra
 * el correo destino real (el listado de personas no expone `correoPersonal`
 * en su contrato, y no se extiende solo para esto — evita exponer PII en un
 * modal de confirmación).
 */
export interface ResetearPasswordModalProps {
  nombreCompleto: string;
  enviando: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}

export function ResetearPasswordModal({
  nombreCompleto,
  enviando,
  onConfirmar,
  onCancelar,
}: ResetearPasswordModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-slate">
          Restablecer contraseña
        </h2>
        <p className="mt-2 text-sm text-slate/80">
          ¿Restablecer la contraseña de <strong>{nombreCompleto}</strong>? Se
          enviará un enlace a su correo personal registrado.
        </p>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancelar}
            disabled={enviando}
            className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={enviando}
            className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
          >
            {enviando ? 'Enviando…' : 'Enviar enlace'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `useCooldownReseteo.ts`**

Crear `App/frontend/src/components/admin/ui/personas-listado/useCooldownReseteo.ts`:

```ts
'use client';

import { useCallback, useState } from 'react';

const DURACION_COOLDOWN_MS = 60 * 60 * 1000; // 1 hora — decisión explícita del usuario.

function claveCooldown(actorUsuarioId: string, targetUsuarioId: string): string {
  return `sige:reseteo-cooldown:${actorUsuarioId}:${targetUsuarioId}`;
}

/**
 * Cooldown de 1h por par (admin, persona) — SOLO en el frontend, sin
 * enforcement en el backend (decisión explícita del usuario: "es solo hacer
 * disabled en botón"). Dos admins distintos resetean a la misma persona sin
 * bloquearse entre sí; el mismo admin resetea a otra persona sin esperar.
 *
 * Persistido en `localStorage` (per-viewer, sobrevive un refresh dentro de
 * la hora) — nunca se sincroniza entre pestañas/dispositivos ni se lee de
 * vuelta por el backend, es puramente una conveniencia de UI.
 */
export function useCooldownReseteo(actorUsuarioId: string | undefined) {
  // Se re-lee en cada llamada a `estaEnCooldown`/`minutosRestantes` en vez de
  // cachear en un `useState` — el cooldown expira con el tiempo, no con un
  // evento de React; un `setState` disparado por un timer sería más
  // complejo sin aportar nada que un checkeo directo no dé ya.
  const [, forzarRerender] = useState(0);

  const leerExpiracion = useCallback(
    (targetUsuarioId: string): number | null => {
      if (!actorUsuarioId) return null;
      try {
        const valor = localStorage.getItem(
          claveCooldown(actorUsuarioId, targetUsuarioId),
        );
        return valor ? Number(valor) : null;
      } catch (err) {
        console.error('[useCooldownReseteo] Error leyendo localStorage:', err);
        return null;
      }
    },
    [actorUsuarioId],
  );

  const estaEnCooldown = useCallback(
    (targetUsuarioId: string): boolean => {
      const expiracion = leerExpiracion(targetUsuarioId);
      return expiracion !== null && expiracion > Date.now();
    },
    [leerExpiracion],
  );

  const minutosRestantes = useCallback(
    (targetUsuarioId: string): number => {
      const expiracion = leerExpiracion(targetUsuarioId);
      if (expiracion === null) return 0;
      return Math.max(0, Math.ceil((expiracion - Date.now()) / 60000));
    },
    [leerExpiracion],
  );

  const iniciarCooldown = useCallback(
    (targetUsuarioId: string) => {
      if (!actorUsuarioId) return;
      try {
        localStorage.setItem(
          claveCooldown(actorUsuarioId, targetUsuarioId),
          String(Date.now() + DURACION_COOLDOWN_MS),
        );
      } catch (err) {
        console.error('[useCooldownReseteo] Error escribiendo localStorage:', err);
      }
      forzarRerender((n) => n + 1);
    },
    [actorUsuarioId],
  );

  return { estaEnCooldown, minutosRestantes, iniciarCooldown };
}
```

- [ ] **Step 4: Integrar en `app/admin/administrativos/page.tsx`**

Leer el archivo completo antes de editar (`App/frontend/src/app/admin/administrativos/page.tsx`) para ubicar los puntos exactos — la página ya importa `obtenerPerfil`/`perfilActorQuery` (usarlo como fuente de `actorUsuarioId`) y ya tiene un botón "Cambiar estatus" por fila dentro de una celda `<td>` de la columna "Acciones".

Agregar los imports:

```ts
import { resetearPasswordPersona } from '@/lib/api/personas';
import { ResetearPasswordModal } from '@/components/admin/ui/personas-listado/ResetearPasswordModal';
import { useCooldownReseteo } from '@/components/admin/ui/personas-listado/useCooldownReseteo';
```

Dentro del componente, junto al `useState` de `administrativoAEditar` ya existente, agregar:

```ts
const [administrativoAResetear, setAdministrativoAResetear] =
  useState<PersonaListItemAdministrativo | null>(null);
const { estaEnCooldown, minutosRestantes, iniciarCooldown } = useCooldownReseteo(
  perfilActorQuery.data?.id,
);

const resetearMutation = useMutation({
  mutationFn: (usuarioId: string) => resetearPasswordPersona(usuarioId),
  onSuccess: (_data, usuarioId) => {
    toast.success('Enlace de restablecimiento enviado.');
    iniciarCooldown(usuarioId);
    setAdministrativoAResetear(null);
  },
  onError: (err) => {
    console.error(
      '[AdminAdministrativosPage] Error al resetear contraseña:',
      err,
    );
    const mensaje =
      err instanceof ApiError
        ? err.error
        : 'Ocurrió un error inesperado. Intenta de nuevo.';
    toast.error(mensaje);
  },
});
```

Nota: verifica el nombre real del campo `id` en `obtenerPerfil()` (`lib/api/perfil.ts`) — puede ser `id`/`usuarioId`, usa el que ya usa esta misma página unas líneas abajo para comparar contra `administrativo.usuarioId` (ya existe esa comparación en el botón "Cambiar estatus" oculto para el propio actor — reutiliza exactamente esa misma propiedad).

En la celda de "Acciones" de cada fila (`<td>` que hoy solo tiene el botón "Cambiar estatus"), agregar el botón nuevo justo después:

```tsx
<button
  type="button"
  onClick={() => setAdministrativoAResetear(administrativo)}
  disabled={estaEnCooldown(administrativo.usuarioId)}
  className="ml-3 text-navy hover:underline disabled:cursor-not-allowed disabled:text-slate/40 disabled:no-underline"
  title={
    estaEnCooldown(administrativo.usuarioId)
      ? `Disponible en ${minutosRestantes(administrativo.usuarioId)} min`
      : undefined
  }
>
  Restablecer contraseña
</button>
```

Al final del JSX del componente (junto al `{administrativoAEditar && <CambiarEstatusModal ... />}` ya existente), agregar:

```tsx
{administrativoAResetear && (
  <ResetearPasswordModal
    nombreCompleto={[
      administrativoAResetear.nombres,
      administrativoAResetear.apellidoPaterno,
      administrativoAResetear.apellidoMaterno,
    ]
      .filter(Boolean)
      .join(' ')}
    enviando={resetearMutation.isPending}
    onConfirmar={() => resetearMutation.mutate(administrativoAResetear.usuarioId)}
    onCancelar={() => setAdministrativoAResetear(null)}
  />
)}
```

- [ ] **Step 5: Integrar en `app/admin/maestros/page.tsx`**

Mismo patrón EXACTO que el Step 4, adaptado a este archivo: mismos imports, mismo `useState`/`useMutation`/`useCooldownReseteo`, mismo botón agregado junto al "Cambiar estatus" ya existente en su columna "Acciones", mismo bloque de `ResetearPasswordModal` al final del JSX — usando `PersonaListItemMaestro` en vez de `PersonaListItemAdministrativo` y el estado `maestroAResetear`/`setMaestroAResetear`.

- [ ] **Step 6: Integrar en `app/admin/alumnos/page.tsx`**

Este archivo NO tiene columna "Acciones" hoy (leer el archivo completo primero para confirmar la estructura real de la tabla). Agregar:

1. `<Th>Acciones</Th>` al final del `<tr>` de encabezados (en las 2 tablas del archivo si hay una responsive/desktop duplicada, mismo patrón que los otros 2 listados — revisar cómo administrativos/maestros manejan esa duplicación y replicarlo aquí).
2. Una celda `<td>` nueva al final de cada fila, con SOLO el botón "Restablecer contraseña" (alumno no tiene "Cambiar estatus" desde este listado — fuera de alcance, no agregarlo).
3. Mismos imports/`useState`/`useMutation`/`useCooldownReseteo`/modal que los Steps 4-5, usando `PersonaListItemAlumno` y el estado `alumnoAResetear`/`setAlumnoAResetear`.

- [ ] **Step 7: Build y lint**

```bash
cd App/frontend
pnpm build
pnpm lint
```

Expected: ambos limpios (sin errores nuevos).

- [ ] **Step 8: Verificación manual en navegador**

Con backend y frontend en dev, iniciar sesión como `ADMINISTRATIVO`, ir a cada uno de los 3 listados (alumnos/maestros/administrativos), confirmar que el botón "Restablecer contraseña" aparece por fila, que el modal muestra el nombre correcto, que al confirmar se deshabilita ese botón para esa fila (recargar la página y confirmar que sigue deshabilitado — persistencia en `localStorage`), y que otra fila sigue habilitada.

- [ ] **Step 9: Commit**

```bash
cd App/frontend
git add src/lib/api/personas.ts src/components/admin/ui/personas-listado/ResetearPasswordModal.tsx src/components/admin/ui/personas-listado/useCooldownReseteo.ts src/app/admin/administrativos/page.tsx src/app/admin/maestros/page.tsx src/app/admin/alumnos/page.tsx
git commit -m "$(cat <<'EOF'
feat(admin): botón para resetear contraseña en los 3 listados de personas

Agrega "Restablecer contraseña" (POST /personas/:id/resetear-password)
junto al botón de "Cambiar estatus" en administrativos/maestros, y una
columna de Acciones nueva en alumnos (que no tenía ninguna). Cooldown
de 1h por (admin, persona) puramente en localStorage, sin enforcement
en el backend — decisión explícita del usuario.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Frontend — página pública `/restablecer-password`

**Files:**
- Modify: `App/frontend/src/lib/api/auth.ts` (nueva función `completarReseteo`)
- Create: `App/frontend/src/app/restablecer-password/page.tsx`
- Modify: `App/frontend/src/proxy.ts` (`RUTAS_PUBLICAS`)

**Interfaces:**
- Consumes: `POST /auth/completar-reseteo` de Task 2 (debe estar disponible antes de este task). `createClient()` de `App/frontend/src/lib/supabase/client.ts` (ya existe, sin cambios).
- Produces: nada que otro task de este plan consuma (último task).

- [ ] **Step 1: `completarReseteo` en `lib/api/auth.ts`**

Leer `App/frontend/src/lib/api/auth.ts` completo primero (es corto, solo tiene `login`) para mantener el mismo estilo. Agregar al final:

```ts
/**
 * `POST /auth/completar-reseteo` — se llama justo después de que el
 * navegador ya cambió la contraseña real vía `supabase.auth.updateUser()`
 * en `app/restablecer-password/page.tsx`. Solo limpia `primerIngreso` +
 * audita en el backend — best-effort desde este lado (ver esa página: si
 * esta llamada falla, no se bloquea la navegación del usuario, la
 * contraseña ya quedó bien puesta).
 */
export function completarReseteo(): Promise<{ ok: true }> {
  return apiFetchAuth<{ ok: true }>('/auth/completar-reseteo', {
    method: 'POST',
  });
}
```

Confirmar el import real de `apiFetchAuth` que ya usa `login()` en este mismo archivo y reutilizarlo tal cual (misma ruta de import).

- [ ] **Step 2: Página `app/restablecer-password/page.tsx`**

Crear `App/frontend/src/app/restablecer-password/page.tsx`:

```tsx
'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { completarReseteo } from '@/lib/api/auth';
import { createClient } from '@/lib/supabase/client';

/**
 * Página pública — el link de correo generado por
 * `PersonasService.resetearPassword` (`client.auth.admin.generateLink`,
 * `type: 'recovery'`) redirige aquí. Supabase establece la sesión de
 * recuperación automáticamente en la URL (el cliente de
 * `lib/supabase/client.ts` usa `createBrowserClient`, que detecta la sesión
 * en la URL por defecto) — esta página solo espera a que esa sesión quede
 * lista, pide la contraseña nueva, y llama `supabase.auth.updateUser()`
 * DIRECTO desde el navegador (sin backend de por medio para el cambio real).
 *
 * Agregada a `RUTAS_PUBLICAS` en `src/proxy.ts` — se renderiza sin importar
 * el estado de autenticación (la sesión de recuperación SÍ cuenta como
 * "autenticada" para los claims del JWT que lee el middleware).
 */
type Estado = 'verificando' | 'lista' | 'invalida' | 'enviando' | 'completa';

export default function RestablecerPasswordPage() {
  const router = useRouter();
  const [estado, setEstado] = useState<Estado>('verificando');
  const [password, setPassword] = useState('');
  const [confirmarPassword, setConfirmarPassword] = useState('');

  useEffect(() => {
    const supabase = createClient();
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error || !data.session) {
          console.error(
            '[RestablecerPasswordPage] Sin sesión de recuperación válida:',
            error,
          );
          setEstado('invalida');
          return;
        }
        setEstado('lista');
      })
      .catch((err: unknown) => {
        console.error(
          '[RestablecerPasswordPage] Error verificando la sesión de recuperación:',
          err,
        );
        setEstado('invalida');
      });
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (password.length < 8) {
      toast.error('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== confirmarPassword) {
      toast.error('Las contraseñas no coinciden.');
      return;
    }

    setEstado('enviando');
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      console.error(
        '[RestablecerPasswordPage] Error al actualizar la contraseña:',
        error,
      );
      toast.error('No se pudo actualizar la contraseña. Intenta de nuevo.');
      setEstado('lista');
      return;
    }

    try {
      await completarReseteo();
    } catch (err) {
      // Best-effort — la contraseña ya quedó bien puesta en Supabase Auth,
      // no se bloquea al usuario por esto (regla 12, loguear igual).
      console.error(
        '[RestablecerPasswordPage] La contraseña se actualizó pero falló completar-reseteo:',
        err,
      );
    }

    setEstado('completa');
    toast.success('Contraseña actualizada.');
    router.push('/');
    router.refresh();
  }

  if (estado === 'verificando') {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <p className="text-sm text-slate/60">Verificando enlace…</p>
      </main>
    );
  }

  if (estado === 'invalida') {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
          <h1 className="font-display text-xl font-semibold text-slate">
            Enlace inválido o expirado
          </h1>
          <p className="mt-2 text-sm text-slate/70">
            Pide a un administrativo que genere un nuevo enlace de
            restablecimiento.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg">
        <h1 className="font-display text-xl font-semibold text-slate">
          Elige tu nueva contraseña
        </h1>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate/80">
              Contraseña nueva
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={estado === 'enviando'}
              className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none disabled:opacity-50"
            />
          </div>
          <div>
            <label htmlFor="confirmar" className="block text-sm font-medium text-slate/80">
              Confirmar contraseña
            </label>
            <input
              id="confirmar"
              type="password"
              autoComplete="new-password"
              required
              value={confirmarPassword}
              onChange={(e) => setConfirmarPassword(e.target.value)}
              disabled={estado === 'enviando'}
              className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none disabled:opacity-50"
            />
          </div>
          <button
            type="submit"
            disabled={estado === 'enviando'}
            className="w-full rounded-lg bg-navy px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
          >
            {estado === 'enviando' ? 'Guardando…' : 'Guardar contraseña'}
          </button>
        </form>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: `proxy.ts` — ruta pública nueva**

En `App/frontend/src/proxy.ts`, modificar la línea de `RUTAS_PUBLICAS`:

```ts
const RUTAS_PUBLICAS = ['/login', '/no-autorizado', '/restablecer-password'];
```

No se necesita ningún otro cambio en este archivo — la nueva ruta cae al `return supabaseResponse` genérico dentro del bloque `if (RUTAS_PUBLICAS.includes(pathname))` (el caso especial de "si autenticado, redirigir" solo aplica cuando `pathname === '/login'`).

- [ ] **Step 4: Build y lint**

```bash
cd App/frontend
pnpm build
pnpm lint
```

Expected: ambos limpios.

- [ ] **Step 5: Verificación manual en navegador**

Requiere que el usuario haya agregado `{FRONTEND_URL}/restablecer-password` a las Redirect URLs de Supabase (ver spec, sección "Configuración manual requerida") y que `MAILGUN_ENVIOS_HABILITADO=true` en el backend de dev. Flujo completo: disparar un reseteo desde `app/admin/administrativos/page.tsx` (Task 3) hacia una persona de prueba cuyo `correoPersonal` sea `jesusaviala@gmail.com` (único destinatario autorizado en el sandbox de Mailgun hoy), abrir el correo real, abrir el link, confirmar que llega a `/restablecer-password` con el formulario visible (no el mensaje de "enlace inválido"), poner una contraseña nueva, confirmar redirección a la home del rol, cerrar sesión, y volver a iniciar sesión con la contraseña nueva.

- [ ] **Step 6: Commit**

```bash
cd App/frontend
git add src/lib/api/auth.ts src/app/restablecer-password/page.tsx src/proxy.ts
git commit -m "$(cat <<'EOF'
feat(frontend): página pública para completar el reseteo de contraseña

/restablecer-password recibe el link de recuperación de Supabase Auth,
detecta la sesión de recuperación automáticamente, pide la contraseña
nueva y llama supabase.auth.updateUser() directo desde el navegador.
Agregada a RUTAS_PUBLICAS en proxy.ts.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Post-implementación

- Recordar al usuario (no es código, no lo puede hacer un subagente): agregar `{FRONTEND_URL}/restablecer-password` a las Redirect URLs de Supabase Auth en dev y en prod, antes de que este flujo pueda probarse/usarse de verdad.
- No tocar `ESTADO.md`/roadmap — este cambio no tiene día de roadmap asignado (mismo criterio que otros ajustes directos sin día).
