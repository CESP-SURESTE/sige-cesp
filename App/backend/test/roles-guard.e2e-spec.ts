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

interface ErrorBody {
  error: string;
  code: string;
}

/**
 * Test de integración — Fase 2, Día 8.
 *
 * Prueba `RolesGuard` de punta a punta contra la app real (`AppModule`
 * completo) y `PruebaRolesController` (`GET /prueba-roles/solo-administrativo`
 * y `GET /prueba-roles/guard-mal-compuesto`).
 *
 * Mismo mecanismo que `sede-guard.e2e-spec.ts`: JWKS de prueba generado con
 * `jose`, inyectado vía `SEDE_GUARD_ENV_OVERRIDE`, para firmar JWTs
 * verificables sin depender de Supabase Auth real.
 */
describe('RolesGuard (e2e)', () => {
  let app: INestApplication<App>;
  let sedeId: string;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';

  async function firmarToken(claims: Record<string, unknown>): Promise<string> {
    return new jose.SignJWT(claims)
      .setProtectedHeader({ alg, kid })
      .setSubject('22222222-2222-2222-2222-222222222222')
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

    const prisma = moduleFixture.get(PrismaService);
    const merida = await prisma.sede.findUniqueOrThrow({
      where: { nombre: 'CESP Mérida' },
    });
    sedeId = merida.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rol ADMINISTRATIVO -> 200', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .get('/prueba-roles/solo-administrativo')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { ok: true } });
  });

  it('rol MAESTRO -> 403 ROL_NO_AUTORIZADO', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeId,
      rol: RolUsuario.MAESTRO,
    });

    const res = await request(app.getHttpServer())
      .get('/prueba-roles/solo-administrativo')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });

  it('rol ALUMNO -> 403 ROL_NO_AUTORIZADO', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeId,
      rol: RolUsuario.ALUMNO,
    });

    const res = await request(app.getHttpServer())
      .get('/prueba-roles/solo-administrativo')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });

  it('ruta con RolesGuard pero sin SedeGuard corrido antes -> 500 SERVER_ERROR explícito', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .get('/prueba-roles/guard-mal-compuesto')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
    expect((res.body as ErrorBody).code).toBe('SERVER_ERROR');
  });

  it('guard-mal-compuesto revienta incluso sin Authorization header (RolesGuard no verifica el JWT por su cuenta)', async () => {
    const res = await request(app.getHttpServer()).get(
      '/prueba-roles/guard-mal-compuesto',
    );

    expect(res.status).toBe(500);
    expect((res.body as ErrorBody).code).toBe('SERVER_ERROR');
  });
});
