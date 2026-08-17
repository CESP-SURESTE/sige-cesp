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

interface ListarCarrerasBody {
  data: Array<{ id: string; nombre: string; clave: string }>;
}

/**
 * Test de integración — agregado mínimo `GET /carreras` (ver bitácora del
 * día que desbloquea el dropdown de `carreraId` en el formulario de alta de
 * alumno del frontend, Día 14). NO cubre `POST`/`PUT`/`DELETE` — no existen
 * todavía, el CRUD completo de `Carrera` queda para su propio día futuro.
 *
 * Mismo mecanismo de JWKS de prueba que `roles-guard.e2e-spec.ts` /
 * `personas.e2e-spec.ts`: JWT firmado con `jose`, inyectado vía
 * `SEDE_GUARD_ENV_OVERRIDE`.
 */
describe('CarrerasController — GET /carreras (e2e)', () => {
  let app: INestApplication<App>;
  let sedeMeridaId: string;
  let sedeValladolidId: string;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';

  async function firmarToken(claims: Record<string, unknown>): Promise<string> {
    return new jose.SignJWT(claims)
      .setProtectedHeader({ alg, kid })
      .setSubject('33333333-3333-3333-3333-333333333333')
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
    sedeMeridaId = merida.id;
    const valladolid = await prisma.sede.findUniqueOrThrow({
      where: { nombre: 'CESP Valladolid' },
    });
    sedeValladolidId = valladolid.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('caso feliz -> 200, solo las carreras de la sede del actor (seed real, 2 sedes)', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .get('/carreras')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as ListarCarrerasBody;
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.map((c) => c.clave).sort()).toEqual([
      'ING-SIS-MID',
      'LAE-MID',
    ]);
    // Ninguna carrera de Valladolid se filtra al admin de Mérida.
    expect(body.data.map((c) => c.clave)).not.toContain('LC-VLD');
    expect(body.data.map((c) => c.clave)).not.toContain('ING-IND-VLD');
    // Extendido en Día 21: objeto Carrera completo (antes solo
    // id/nombre/clave). El dropdown de alta de alumno sigue leyendo solo
    // esos 3 campos e ignora el resto, sin cambio de comportamiento ahí.
    for (const carrera of body.data) {
      const claves = Object.keys(carrera).sort();
      expect(claves).toContain('id');
      expect(claves).toContain('nombre');
      expect(claves).toContain('clave');
      expect(claves).toContain('sedeId');
      expect(claves).toContain('duracion');
      expect(claves).toContain('nivel');
      expect(claves).toContain('modalidad');
      expect(claves).toContain('estatus');
      expect(claves).toContain('rvoe');
      expect(claves).toContain('descripcion');
    }
  });

  it('sede distinta -> 200, solo trae las carreras de esa otra sede (confirma el filtro, no solo la ausencia)', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeValladolidId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .get('/carreras')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as ListarCarrerasBody;
    expect(body.data.map((c) => c.clave).sort()).toEqual([
      'ING-IND-VLD',
      'LC-VLD',
    ]);
  });

  it('rol no ADMINISTRATIVO -> 403 ROL_NO_AUTORIZADO', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ALUMNO,
    });

    const res = await request(app.getHttpServer())
      .get('/carreras')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });

  it('sin Authorization -> 401 UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer()).get('/carreras');

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
  });
});
