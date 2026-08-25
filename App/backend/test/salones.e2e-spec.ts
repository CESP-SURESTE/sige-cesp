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
interface SalonesBody {
  data: Array<{ id: string; nombre: string; capacidad: number }>;
}

/**
 * `GET /salones` — Fase 9, Día 29 (gap de backend descubierto al planear la
 * UI de creación de grupos). Mismo mecanismo de JWKS de prueba que
 * `grupos.e2e-spec.ts`: JWT firmado con `jose`, inyectado vía
 * `SEDE_GUARD_ENV_OVERRIDE`. `sub` del token = el `usuarioId` real del
 * admin ANCLA de Mérida (`ana.canul@cesp-merida.edu.mx`, ver
 * `prisma/seed.ts`). Usa salones reales sembrados (`prisma/seed-helpers.ts`):
 * "Aula 101" en Mérida, "Aula 201" en Valladolid.
 */
describe('SalonesController — GET /salones (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let sedeValladolidId: string;
  let salonMeridaId: string;
  let salonValladolidId: string;
  let actorUsuarioId: string;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';

  async function firmarToken(claims: Record<string, unknown>): Promise<string> {
    return new jose.SignJWT(claims)
      .setProtectedHeader({ alg, kid })
      .setSubject(actorUsuarioId)
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
    const valladolid = await prisma.sede.findUniqueOrThrow({
      where: { nombre: 'CESP Valladolid' },
    });
    sedeValladolidId = valladolid.id;

    const salonMerida = await prisma.salon.findUniqueOrThrow({
      where: { sedeId_nombre: { sedeId: sedeMeridaId, nombre: 'Aula 101' } },
    });
    salonMeridaId = salonMerida.id;

    const salonValladolid = await prisma.salon.findUniqueOrThrow({
      where: {
        sedeId_nombre: { sedeId: sedeValladolidId, nombre: 'Aula 201' },
      },
    });
    salonValladolidId = salonValladolid.id;

    const actor = await prisma.usuario.findUniqueOrThrow({
      where: { email: 'ana.canul@cesp-merida.edu.mx' },
    });
    actorUsuarioId = actor.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /salones devuelve los salones de la sede del actor con shape { id, nombre, capacidad }', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .get('/salones')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as SalonesBody;
    expect(Array.isArray(body.data)).toBe(true);
    const encontrado = body.data.find((s) => s.id === salonMeridaId);
    expect(encontrado).toBeDefined();
    expect(Object.keys(encontrado ?? {}).sort()).toEqual(
      ['capacidad', 'id', 'nombre'].sort(),
    );
    expect(encontrado?.nombre).toBe('Aula 101');
    expect(typeof encontrado?.capacidad).toBe('number');
  });

  it('GET /salones respeta el aislamiento por sede — salón de Valladolid no aparece en Mérida', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .get('/salones')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as SalonesBody;
    expect(body.data.some((s) => s.id === salonValladolidId)).toBe(false);
  });

  it('GET /salones sin Authorization -> 401 UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer()).get('/salones');

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
  });

  it('GET /salones rol no ADMINISTRATIVO -> 403 ROL_NO_AUTORIZADO', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ALUMNO,
    });

    const res = await request(app.getHttpServer())
      .get('/salones')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });
});
