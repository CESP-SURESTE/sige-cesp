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
interface GrupoBody {
  data: {
    id: string;
    sedeId: string;
    carreraId: string;
    salonId: string;
    nombre: string;
    anioInicio: number;
    cicloActual: number;
    capacidad: number;
  };
}

/**
 * `POST /grupos` — Fase 9, Día 28. Mismo mecanismo de JWKS de prueba que
 * `carreras-crud.e2e-spec.ts`: JWT firmado con `jose`, inyectado vía
 * `SEDE_GUARD_ENV_OVERRIDE`. `sub` del token = el `usuarioId` real del
 * admin ANCLA de Mérida (`ana.canul@cesp-merida.edu.mx`, ver
 * `prisma/seed.ts`). Usa carrera/salón reales sembrados
 * (`prisma/seed-helpers.ts`): carrera `LAE-MID` (duracion: 8), salón
 * "Aula 101" — ambos en Mérida. `GET /grupos` se agrega en la Task 2 de
 * este mismo plan.
 */
describe('GruposController — POST /grupos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let sedeValladolidId: string;
  let carreraMeridaId: string;
  let salonMeridaId: string;
  let carreraValladolidId: string;
  let salonValladolidId: string;
  let actorUsuarioId: string;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';
  const nombrePrueba = `Grupo E2E ${Date.now()}`;

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

    const carreraMerida = await prisma.carrera.findUniqueOrThrow({
      where: { clave: 'LAE-MID' },
    });
    carreraMeridaId = carreraMerida.id;
    const salonMerida = await prisma.salon.findUniqueOrThrow({
      where: { sedeId_nombre: { sedeId: sedeMeridaId, nombre: 'Aula 101' } },
    });
    salonMeridaId = salonMerida.id;

    const carreraValladolid = await prisma.carrera.findUniqueOrThrow({
      where: { clave: 'LC-VLD' },
    });
    carreraValladolidId = carreraValladolid.id;
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
    await prisma.registroAuditoria.deleteMany({
      where: { entidad: 'Grupo', sedeId: sedeMeridaId },
    });
    await prisma.grupo.deleteMany({
      where: { nombre: { startsWith: 'Grupo E2E' } },
    });
    await app.close();
  });

  const bodyValido = () => ({
    carreraId: carreraMeridaId,
    salonId: salonMeridaId,
    nombre: nombrePrueba,
    anioInicio: 2027,
    cicloActual: 1,
    capacidad: 30,
  });

  it('POST /grupos crea un grupo en la sede del actor y audita con usuarioId', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/grupos')
      .set('Authorization', `Bearer ${token}`)
      .send(bodyValido());

    expect(res.status).toBe(201);
    const body = res.body as GrupoBody;
    expect(body.data.nombre).toBe(nombrePrueba);
    expect(body.data.sedeId).toBe(sedeMeridaId);
    expect(body.data.carreraId).toBe(carreraMeridaId);
    expect(body.data.salonId).toBe(salonMeridaId);

    const registro = await prisma.registroAuditoria.findFirst({
      where: { entidad: 'Grupo', entidadId: body.data.id },
    });
    expect(registro?.usuarioId).toBe(actorUsuarioId);
    expect(registro?.accion).toBe('ALTA');
  });

  it('POST /grupos con nombre duplicado en la misma sede+periodo -> 409 CONFLICT', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/grupos')
      .set('Authorization', `Bearer ${token}`)
      .send(bodyValido());

    expect(res.status).toBe(409);
    expect((res.body as ErrorBody).code).toBe('CONFLICT');
  });

  it('POST /grupos con el mismo nombre pero otro periodo -> 201 (no choca)', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/grupos')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...bodyValido(), cicloActual: 2 });

    expect(res.status).toBe(201);
  });

  it('POST /grupos con carreraId de otra sede -> 404 NOT_FOUND', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/grupos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...bodyValido(),
        nombre: `${nombrePrueba} carrera-otra-sede`,
        carreraId: carreraValladolidId,
      });

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('POST /grupos con salonId de otra sede -> 404 NOT_FOUND', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/grupos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...bodyValido(),
        nombre: `${nombrePrueba} salon-otra-sede`,
        salonId: salonValladolidId,
      });

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('POST /grupos con cicloActual fuera del rango de la carrera (duracion: 8) -> 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/grupos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...bodyValido(),
        nombre: `${nombrePrueba} ciclo-invalido`,
        cicloActual: 99,
      });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('POST /grupos con capacidad 0 -> 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/grupos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...bodyValido(),
        nombre: `${nombrePrueba} capacidad-cero`,
        capacidad: 0,
      });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('POST /grupos sin nombre -> 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const { nombre, ...sinNombre } = bodyValido();
    void nombre;

    const res = await request(app.getHttpServer())
      .post('/grupos')
      .set('Authorization', `Bearer ${token}`)
      .send(sinNombre);

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('POST /grupos rol no ADMINISTRATIVO -> 403 ROL_NO_AUTORIZADO', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ALUMNO,
    });

    const res = await request(app.getHttpServer())
      .post('/grupos')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...bodyValido(), nombre: `${nombrePrueba} rol-invalido` });

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });

  it('POST /grupos sin Authorization -> 401 UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer())
      .post('/grupos')
      .send(bodyValido());

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
  });

  it('GET /grupos sin filtros devuelve los grupos de la sede paginados, con carrera/salon expandidos', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .get('/grupos')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as {
      data: Array<{
        id: string;
        nombre: string;
        carrera: { id: string; nombre: string };
        salon: { id: string; nombre: string };
      }>;
      page: number;
      limit: number;
      total: number;
    };
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.total).toBeGreaterThanOrEqual(3); // 2 seed (1A/1B) + el creado en este archivo
    const creado = body.data.find((g) => g.nombre === nombrePrueba);
    expect(creado).toBeDefined();
    expect(creado?.carrera.id).toBe(carreraMeridaId);
    expect(creado?.salon.id).toBe(salonMeridaId);
  });

  it('GET /grupos?carreraId=... filtra por carrera', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .get('/grupos')
      .query({ carreraId: carreraMeridaId })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as { data: Array<{ carrera: { id: string } }> };
    expect(body.data.every((g) => g.carrera.id === carreraMeridaId)).toBe(
      true,
    );
  });

  it('GET /grupos?anioInicio=&cicloActual= filtra por periodo exacto', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .get('/grupos')
      .query({ anioInicio: 2027, cicloActual: 1 })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as {
      data: Array<{ nombre: string; anioInicio: number; cicloActual: number }>;
    };
    expect(
      body.data.every((g) => g.anioInicio === 2027 && g.cicloActual === 1),
    ).toBe(true);
    expect(body.data.some((g) => g.nombre === nombrePrueba)).toBe(true);
  });

  it('GET /grupos respeta el aislamiento por sede — grupo de Valladolid no aparece en Mérida', async () => {
    const tokenValladolid = await firmarToken({
      role: 'authenticated',
      sede_id: sedeValladolidId,
      rol: RolUsuario.ADMINISTRATIVO,
    });
    await request(app.getHttpServer())
      .post('/grupos')
      .set('Authorization', `Bearer ${tokenValladolid}`)
      .send({
        carreraId: carreraValladolidId,
        salonId: salonValladolidId,
        nombre: `Grupo E2E Valladolid ${Date.now()}`,
        anioInicio: 2027,
        cicloActual: 1,
        capacidad: 30,
      });

    const tokenMerida = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });
    const res = await request(app.getHttpServer())
      .get('/grupos')
      .query({ limit: 100 })
      .set('Authorization', `Bearer ${tokenMerida}`);

    expect(res.status).toBe(200);
    const body = res.body as { data: Array<{ nombre: string }> };
    expect(
      body.data.some((g) => g.nombre.startsWith('Grupo E2E Valladolid')),
    ).toBe(false);
  });

  it('GET /grupos con limit=1 pagina correctamente', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .get('/grupos')
      .query({ limit: 1, page: 1 })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as { data: unknown[]; limit: number; total: number };
    expect(body.data.length).toBe(1);
    expect(body.limit).toBe(1);
    expect(body.total).toBeGreaterThanOrEqual(3);
  });

  it('GET /grupos rol no ADMINISTRATIVO -> 403 ROL_NO_AUTORIZADO', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ALUMNO,
    });

    const res = await request(app.getHttpServer())
      .get('/grupos')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });

  it('GET /grupos?limit=101 fuera de rango -> 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .get('/grupos')
      .query({ limit: 101 })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('GET /grupos?page=0 fuera de rango -> 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .get('/grupos')
      .query({ page: 0 })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('GET /grupos?carreraId=not-a-uuid -> 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .get('/grupos')
      .query({ carreraId: 'not-a-uuid' })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('GET /grupos?anioInicio=abc no numérico -> 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .get('/grupos')
      .query({ anioInicio: 'abc' })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('GET /grupos?anioInicio=2027.5 no entero -> 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .get('/grupos')
      .query({ anioInicio: 2027.5 })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });
});
