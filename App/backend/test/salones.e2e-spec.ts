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
interface SalonBody {
  data: { id: string; nombre: string; capacidad: number; sedeId: string };
}
interface OkBody {
  data: { ok: true };
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
  const nombrePrueba = `Salon E2E ${Date.now()}`;

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
    await prisma.registroAuditoria.deleteMany({
      where: { entidad: 'Salon', sedeId: { in: [sedeMeridaId, sedeValladolidId] } },
    });
    await prisma.salon.deleteMany({
      where: { nombre: { startsWith: 'Salon E2E' } },
    });
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

  // --- POST /salones ---------------------------------------------------

  it('POST /salones crea un salón en la sede del actor y audita con usuarioId', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/salones')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: nombrePrueba, capacidad: 40 });

    expect(res.status).toBe(201);
    const body = res.body as SalonBody;
    expect(body.data.nombre).toBe(nombrePrueba);
    expect(body.data.capacidad).toBe(40);
    expect(body.data.sedeId).toBe(sedeMeridaId);

    const registro = await prisma.registroAuditoria.findFirst({
      where: { entidad: 'Salon', entidadId: body.data.id },
    });
    expect(registro?.usuarioId).toBe(actorUsuarioId);
    expect(registro?.accion).toBe('ALTA');
  });

  it('POST /salones con nombre duplicado en la misma sede -> 409 CONFLICT', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/salones')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: nombrePrueba, capacidad: 20 });

    expect(res.status).toBe(409);
    expect((res.body as ErrorBody).code).toBe('CONFLICT');
  });

  it('POST /salones con el mismo nombre pero en OTRA sede -> 201 (aislamiento)', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeValladolidId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/salones')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: nombrePrueba, capacidad: 20 });

    expect(res.status).toBe(201);
    const body = res.body as SalonBody;
    expect(body.data.sedeId).toBe(sedeValladolidId);
  });

  it('POST /salones con capacidad 0 -> 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/salones')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: `${nombrePrueba} capacidad-cero`, capacidad: 0 });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('POST /salones con capacidad negativa -> 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/salones')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: `${nombrePrueba} capacidad-negativa`, capacidad: -5 });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('POST /salones con capacidad no entera -> 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/salones')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: `${nombrePrueba} capacidad-no-entera`, capacidad: 12.5 });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('POST /salones sin campos requeridos -> 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/salones')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('POST /salones sin Authorization -> 401 UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer())
      .post('/salones')
      .send({ nombre: `${nombrePrueba} sin-token`, capacidad: 10 });

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
  });

  it('POST /salones rol no ADMINISTRATIVO -> 403 ROL_NO_AUTORIZADO', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ALUMNO,
    });

    const res = await request(app.getHttpServer())
      .post('/salones')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: `${nombrePrueba} rol-invalido`, capacidad: 10 });

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });

  // --- PATCH /salones/:id ------------------------------------------------

  it('PATCH /salones/:id edición parcial exitosa audita con usuarioId', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const creado = await request(app.getHttpServer())
      .post('/salones')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: `${nombrePrueba} patch-parcial`, capacidad: 15 });
    const salonId = (creado.body as SalonBody).data.id;

    const res = await request(app.getHttpServer())
      .patch(`/salones/${salonId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ capacidad: 25 });

    expect(res.status).toBe(200);
    const body = res.body as SalonBody;
    expect(body.data.capacidad).toBe(25);
    expect(body.data.nombre).toBe(`${nombrePrueba} patch-parcial`);

    const registro = await prisma.registroAuditoria.findFirst({
      where: { entidad: 'Salon', entidadId: salonId, accion: 'EDICION' },
    });
    expect(registro?.usuarioId).toBe(actorUsuarioId);
  });

  it('PATCH /salones/:id con {} vacío es válido y NO crea auditoría nueva', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const creado = await request(app.getHttpServer())
      .post('/salones')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: `${nombrePrueba} patch-vacio`, capacidad: 15 });
    const salonId = (creado.body as SalonBody).data.id;

    const antes = await prisma.registroAuditoria.count({
      where: { entidad: 'Salon', entidadId: salonId },
    });

    const res = await request(app.getHttpServer())
      .patch(`/salones/${salonId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);

    const despues = await prisma.registroAuditoria.count({
      where: { entidad: 'Salon', entidadId: salonId },
    });
    expect(despues).toBe(antes);
  });

  it('PATCH /salones/:id con id de otra sede -> 404 NOT_FOUND', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .patch(`/salones/${salonValladolidId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ capacidad: 25 });

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('PATCH /salones/:id rename a nombre duplicado -> 409 CONFLICT', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const salonA = await request(app.getHttpServer())
      .post('/salones')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: `${nombrePrueba} rename-a`, capacidad: 15 });
    const salonB = await request(app.getHttpServer())
      .post('/salones')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: `${nombrePrueba} rename-b`, capacidad: 15 });
    const salonAId = (salonA.body as SalonBody).data.id;
    const salonBNombre = (salonB.body as SalonBody).data.nombre;

    const res = await request(app.getHttpServer())
      .patch(`/salones/${salonAId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: salonBNombre });

    expect(res.status).toBe(409);
    expect((res.body as ErrorBody).code).toBe('CONFLICT');
  });

  it('PATCH /salones/:id rename al mismo nombre (sin cambio real) NO crea auditoría nueva', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const creado = await request(app.getHttpServer())
      .post('/salones')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: `${nombrePrueba} sin-cambio`, capacidad: 15 });
    const salonId = (creado.body as SalonBody).data.id;

    const antes = await prisma.registroAuditoria.count({
      where: { entidad: 'Salon', entidadId: salonId },
    });

    const res = await request(app.getHttpServer())
      .patch(`/salones/${salonId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: `${nombrePrueba} sin-cambio` });

    expect(res.status).toBe(200);

    const despues = await prisma.registroAuditoria.count({
      where: { entidad: 'Salon', entidadId: salonId },
    });
    expect(despues).toBe(antes);
  });

  // --- DELETE /salones/:id ------------------------------------------------

  it('DELETE /salones/:id borra un salón sin grupos asociados', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const creado = await request(app.getHttpServer())
      .post('/salones')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: `${nombrePrueba} para-borrar`, capacidad: 15 });
    const salonId = (creado.body as SalonBody).data.id;

    const res = await request(app.getHttpServer())
      .delete(`/salones/${salonId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect((res.body as OkBody).data).toEqual({ ok: true });

    const enDb = await prisma.salon.findUnique({ where: { id: salonId } });
    expect(enDb).toBeNull();
  });

  it('DELETE /salones/:id con grupos asociados -> 409 CONFLICT', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .delete(`/salones/${salonMeridaId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(409);
    const body = res.body as ErrorBody;
    expect(body.code).toBe('CONFLICT');
    expect(body.error).toMatch(/grupo/i);

    const sigueExistiendo = await prisma.salon.findUnique({
      where: { id: salonMeridaId },
    });
    expect(sigueExistiendo).not.toBeNull();
  });

  it('DELETE /salones/:id inexistente -> 404 NOT_FOUND', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .delete('/salones/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('DELETE /salones/:id de otra sede -> 404 NOT_FOUND (aislamiento)', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .delete(`/salones/${salonValladolidId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');

    const sigueExistiendo = await prisma.salon.findUnique({
      where: { id: salonValladolidId },
    });
    expect(sigueExistiendo).not.toBeNull();
  });
});
