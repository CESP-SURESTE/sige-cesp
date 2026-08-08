import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
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

interface SedeBody {
  data: { id: string; nombre: string };
}

/**
 * Test de integración — Fase 1, Día 6.
 *
 * Prueba el `SedeGuard` de punta a punta contra la app real (`AppModule`
 * completo, con `PrismaService` conectado a la base de datos real de
 * Supabase — las mismas 2 sedes sembradas en el Día 4) y el endpoint real
 * `GET /sedes/:sedeId`.
 *
 * Para poder firmar JWTs verificables sin depender de una cuenta real de
 * Supabase Auth (Fase 2 no existe todavía), se genera un par de llaves de
 * prueba con `jose` y se inyecta como JWKS vía `SEDE_GUARD_ENV_OVERRIDE`
 * (ver `sede.guard.ts`) — el guard verifica la firma real contra ese JWKS de
 * prueba, exactamente la misma ruta de código que usaría en producción
 * contra el JWKS real de Supabase (`SUPABASE_JWKS_URL`).
 */
describe('SedeGuard (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let sedeValladolidId: string;
  let privateKey: CryptoKey;
  // `jose` (v6) es un paquete ESM-only ("type": "module", sin build CJS) —
  // un `import ... from 'jose'` estático revienta bajo ts-jest (que compila
  // a CommonJS). Se resuelve con `import()` dinámico: TypeScript preserva
  // los `import()` dinámicos tal cual en la salida (no los baja a
  // `require`), así que Node lo carga con su propio interop ESM/CJS nativo,
  // sin pasar por el transform de Jest.
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';

  async function firmarToken(claims: Record<string, unknown>): Promise<string> {
    return new jose.SignJWT(claims)
      .setProtectedHeader({ alg, kid })
      .setSubject('11111111-1111-1111-1111-111111111111')
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
    const valladolid = await prisma.sede.findUniqueOrThrow({
      where: { nombre: 'CESP Valladolid' },
    });
    sedeMeridaId = merida.id;
    sedeValladolidId = valladolid.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('sin Authorization header -> 401 UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer()).get(
      `/sedes/${sedeMeridaId}`,
    );

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
  });

  it('con un token con firma inválida -> 401 UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer())
      .get(`/sedes/${sedeMeridaId}`)
      .set('Authorization', 'Bearer esto-no-es-un-jwt-valido');

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
  });

  it('con un JWT válido pero sin claim sede_id -> 403 SEDE_NO_ASIGNADA', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      email: 'sin-sede@example.com',
    });

    const res = await request(app.getHttpServer())
      .get(`/sedes/${sedeMeridaId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('SEDE_NO_ASIGNADA');
  });

  it('usuario de sede Mérida pidiendo su propia sede -> 200 con los datos de esa sede', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
    });

    const res = await request(app.getHttpServer())
      .get(`/sedes/${sedeMeridaId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect((res.body as SedeBody).data.id).toBe(sedeMeridaId);
    expect((res.body as SedeBody).data.nombre).toBe('CESP Mérida');
  });

  it('CROSS-SEDE: usuario de sede Mérida pidiendo la sede Valladolid -> 403 SEDE_CROSS_ACCESS', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
    });

    const res = await request(app.getHttpServer())
      .get(`/sedes/${sedeValladolidId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('SEDE_CROSS_ACCESS');
  });

  it('CROSS-SEDE inverso: usuario de Valladolid pidiendo Mérida -> 403 SEDE_CROSS_ACCESS', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeValladolidId,
    });

    const res = await request(app.getHttpServer())
      .get(`/sedes/${sedeMeridaId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('SEDE_CROSS_ACCESS');
  });

  it('usuario de sede Valladolid pidiendo su propia sede -> 200', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeValladolidId,
    });

    const res = await request(app.getHttpServer())
      .get(`/sedes/${sedeValladolidId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect((res.body as SedeBody).data.id).toBe(sedeValladolidId);
    expect((res.body as SedeBody).data.nombre).toBe('CESP Valladolid');
  });
});
