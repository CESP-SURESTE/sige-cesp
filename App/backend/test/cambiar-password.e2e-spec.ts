import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { RolUsuario } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { AUTH_SUPABASE_CLIENT_OVERRIDE } from '../src/auth/auth.service';
import { SEDE_GUARD_ENV_OVERRIDE } from '../src/common/guards/sede.guard';
import { loadEnv } from '../src/load-env';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup-app';

loadEnv();

interface ErrorBody {
  error: string;
  code: string;
}

interface CambiarPasswordBody {
  data: { ok: true };
}

/**
 * Test de integración — Fase 4, Día 12.
 *
 * `PATCH /auth/cambiar-password` de punta a punta contra la app real
 * (`AppModule` completo, `PrismaService` conectado a la DB real de Supabase
 * — misma sede/usuario sembrados por `prisma/seed.ts`), pero sin pegarle al
 * Admin API real de Supabase Auth: se inyecta un mock de
 * `client.auth.{signInWithPassword, admin.updateUserById}` vía
 * `AUTH_SUPABASE_CLIENT_OVERRIDE` — mismo patrón que
 * `test/auth.e2e-spec.ts` (login) y `test/personas.e2e-spec.ts` (alta).
 *
 * JWTs firmados con el mismo mecanismo que `sede-guard.e2e-spec.ts` /
 * `personas.e2e-spec.ts` (JWKS de prueba generado con `jose`, inyectado vía
 * `SEDE_GUARD_ENV_OVERRIDE`) — el claim `email` del JWT es el que
 * `@ActorEmail()` lee de vuelta como `request.userClaims.email`.
 */
describe('AuthController — PATCH /auth/cambiar-password (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let actorId: string;
  let actorEmail: string;
  // Actor separado del de "cambio exitoso" — evita acoplar el estado de
  // `primerIngreso` entre tests (el caso exitoso lo deja en `false`; el caso
  // de credenciales inválidas necesita partir de `true`, el default real).
  let actorFallidoId: string;
  let actorFallidoEmail: string;
  let signInWithPassword: jest.Mock;
  let updateUserById: jest.Mock;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';

  async function firmarToken(sub: string, email: string): Promise<string> {
    return new jose.SignJWT({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      email,
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

    signInWithPassword = jest.fn();
    updateUserById = jest.fn();
    const mockSupabaseClient = {
      auth: {
        signInWithPassword,
        admin: { updateUserById },
      },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SEDE_GUARD_ENV_OVERRIDE)
      .useValue({ jwks: { keys: [publicJwk] } })
      .overrideProvider(AUTH_SUPABASE_CLIENT_OVERRIDE)
      .useValue(mockSupabaseClient)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    const merida = await prisma.sede.findUniqueOrThrow({
      where: { nombre: 'CESP Mérida' },
    });
    sedeMeridaId = merida.id;

    // Actor real: fila propia en `usuarios` (FK real de
    // `RegistroAuditoria.usuarioId` y del `update` de `primerIngreso`) —
    // `primerIngreso: true` (default del schema), como cualquier alta real
    // sin cambiar la contraseña todavía.
    actorEmail = `fixture.cambiar-password.${randomUUID()}@cesp-merida.edu.mx`;
    const actor = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: actorEmail,
        rol: RolUsuario.ALUMNO,
        sedeId: sedeMeridaId,
      },
    });
    actorId = actor.id;

    actorFallidoEmail = `fixture.cambiar-password.fallido.${randomUUID()}@cesp-merida.edu.mx`;
    const actorFallido = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: actorFallidoEmail,
        rol: RolUsuario.ALUMNO,
        sedeId: sedeMeridaId,
      },
    });
    actorFallidoId = actorFallido.id;
  });

  afterEach(() => {
    signInWithPassword.mockReset();
    updateUserById.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  it('cambio exitoso -> 200, primerIngreso queda false y se crea RegistroAuditoria', async () => {
    signInWithPassword.mockResolvedValueOnce({
      data: { user: { id: actorId }, session: {} },
      error: null,
    });
    updateUserById.mockResolvedValueOnce({
      data: { user: { id: actorId } },
      error: null,
    });

    const res = await request(app.getHttpServer())
      .patch('/auth/cambiar-password')
      .set('Authorization', `Bearer ${await firmarToken(actorId, actorEmail)}`)
      .send({
        passwordActual: 'password-actual',
        passwordNueva: 'password-nueva-123',
      });

    expect(res.status).toBe(200);
    expect((res.body as CambiarPasswordBody).data.ok).toBe(true);

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: actorEmail,
      password: 'password-actual',
    });
    expect(updateUserById).toHaveBeenCalledWith(actorId, {
      password: 'password-nueva-123',
    });

    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { id: actorId },
    });
    expect(usuario.primerIngreso).toBe(false);

    const auditoria = await prisma.registroAuditoria.findFirst({
      where: { entidad: 'Usuario', entidadId: actorId },
      orderBy: { fecha: 'desc' },
    });
    expect(auditoria?.usuarioId).toBe(actorId);
    expect(auditoria?.accion).toBe('EDICION');
  });

  it('passwordActual incorrecta -> 401 UNAUTHORIZED, sin llamar a updateUserById', async () => {
    signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: {
        name: 'AuthApiError',
        message: 'Invalid login credentials',
        status: 400,
        code: 'invalid_credentials',
      },
    });

    const res = await request(app.getHttpServer())
      .patch('/auth/cambiar-password')
      .set(
        'Authorization',
        `Bearer ${await firmarToken(actorFallidoId, actorFallidoEmail)}`,
      )
      .send({
        passwordActual: 'password-incorrecta',
        passwordNueva: 'password-nueva-123',
      });

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
    expect(updateUserById).not.toHaveBeenCalled();

    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { id: actorFallidoId },
    });
    expect(usuario.primerIngreso).toBe(true);
  });

  it('passwordNueva menor a 8 caracteres -> 400 VALIDATION_ERROR, sin llamar a Supabase Auth', async () => {
    const res = await request(app.getHttpServer())
      .patch('/auth/cambiar-password')
      .set('Authorization', `Bearer ${await firmarToken(actorId, actorEmail)}`)
      .send({ passwordActual: 'password-actual', passwordNueva: 'corta' });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('sin Authorization header -> 401 UNAUTHORIZED (SedeGuard)', async () => {
    const res = await request(app.getHttpServer())
      .patch('/auth/cambiar-password')
      .send({
        passwordActual: 'password-actual',
        passwordNueva: 'password-nueva-123',
      });

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
  });
});
