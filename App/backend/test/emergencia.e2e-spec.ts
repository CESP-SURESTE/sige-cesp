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
interface TelefonoBody {
  data: {
    id: string;
    sedeId: string;
    etiqueta: string;
    telefono: string;
    orden: number;
  };
}
interface TelefonosBody {
  data: Array<{
    id: string;
    sedeId: string;
    etiqueta: string;
    telefono: string;
    orden: number;
  }>;
}
interface OkBody {
  data: { ok: true };
}

/**
 * Módulo de emergencia — CRUD de teléfonos de emergencia por sede
 * (`TelefonoEmergenciaSede`, Task 1). Mismo andamiaje de JWKS de prueba que
 * `salones.e2e-spec.ts`: JWT firmado con `jose`, inyectado vía
 * `SEDE_GUARD_ENV_OVERRIDE`. `sub` del token = el `usuarioId` real del admin
 * ANCLA de Mérida (`ana.canul@cesp-merida.edu.mx`, ver `prisma/seed.ts`).
 */
describe('EmergenciaController — /emergencia/telefonos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let sedeValladolidId: string;
  let actorUsuarioId: string;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';
  const telefonoIdsCreados: string[] = [];

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

    const actor = await prisma.usuario.findUniqueOrThrow({
      where: { email: 'ana.canul@cesp-merida.edu.mx' },
    });
    actorUsuarioId = actor.id;
  });

  afterAll(async () => {
    await prisma.registroAuditoria.deleteMany({
      where: {
        entidad: 'TelefonoEmergenciaSede',
        entidadId: { in: telefonoIdsCreados },
      },
    });
    await prisma.telefonoEmergenciaSede.deleteMany({
      where: { id: { in: telefonoIdsCreados } },
    });
    await app.close();
  });

  it('POST /emergencia/telefonos crea con orden incremental y audita ALTA', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });
    const r1 = await request(app.getHttpServer())
      .post('/emergencia/telefonos')
      .set('Authorization', `Bearer ${token}`)
      .send({ etiqueta: 'Cruz Roja E2E', telefono: '911' })
      .expect(201);
    const r2 = await request(app.getHttpServer())
      .post('/emergencia/telefonos')
      .set('Authorization', `Bearer ${token}`)
      .send({ etiqueta: 'Bomberos E2E', telefono: '(986) 863 00 00' })
      .expect(201);
    telefonoIdsCreados.push(
      (r1.body as TelefonoBody).data.id,
      (r2.body as TelefonoBody).data.id,
    );
    expect((r2.body as TelefonoBody).data.orden).toBeGreaterThan(
      (r1.body as TelefonoBody).data.orden,
    );
    expect((r1.body as TelefonoBody).data.sedeId).toBe(sedeMeridaId);
    expect((r1.body as TelefonoBody).data.etiqueta).toBe('Cruz Roja E2E');
    expect((r1.body as TelefonoBody).data.telefono).toBe('911');

    const auditoria = await prisma.registroAuditoria.findFirst({
      where: {
        entidad: 'TelefonoEmergenciaSede',
        entidadId: (r1.body as TelefonoBody).data.id,
        accion: 'ALTA',
      },
    });
    expect(auditoria).not.toBeNull();
    expect(auditoria?.usuarioId).toBe(actorUsuarioId);
    expect(auditoria?.sedeId).toBe(sedeMeridaId);
  });

  it('GET /emergencia/telefonos devuelve solo los de la sede del actor, orden asc', async () => {
    const telValladolid = await prisma.telefonoEmergenciaSede.create({
      data: {
        sedeId: sedeValladolidId,
        etiqueta: 'Cruz Roja Valladolid E2E',
        telefono: '999',
        orden: 1,
      },
    });
    telefonoIdsCreados.push(telValladolid.id);

    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .get('/emergencia/telefonos')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as TelefonosBody;
    expect(Array.isArray(body.data)).toBe(true);
    // aislamiento por sede: el de Valladolid no aparece
    expect(body.data.some((t) => t.id === telValladolid.id)).toBe(false);
    expect(body.data.every((t) => t.sedeId === sedeMeridaId)).toBe(true);
    // orden ascendente
    const ordenes = body.data.map((t) => t.orden);
    const ordenadas = [...ordenes].sort((a, b) => a - b);
    expect(ordenes).toEqual(ordenadas);
    // los 2 creados en el test anterior están presentes
    expect(body.data.some((t) => t.etiqueta === 'Cruz Roja E2E')).toBe(true);
    expect(body.data.some((t) => t.etiqueta === 'Bomberos E2E')).toBe(true);
  });

  it('PATCH /emergencia/telefonos/:id de otra sede → 404', async () => {
    const telValladolid = await prisma.telefonoEmergenciaSede.create({
      data: {
        sedeId: sedeValladolidId,
        etiqueta: 'Proteccion Civil Valladolid E2E',
        telefono: '068',
        orden: 2,
      },
    });
    telefonoIdsCreados.push(telValladolid.id);

    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .patch(`/emergencia/telefonos/${telValladolid.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ telefono: '911' });

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');

    const sigueIgual = await prisma.telefonoEmergenciaSede.findUnique({
      where: { id: telValladolid.id },
    });
    expect(sigueIgual?.telefono).toBe('068');
  });

  it('PATCH vacío {} es válido y responde 200 sin auditar', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const creado = await request(app.getHttpServer())
      .post('/emergencia/telefonos')
      .set('Authorization', `Bearer ${token}`)
      .send({ etiqueta: 'Hospital General E2E', telefono: '065' })
      .expect(201);
    const telId = (creado.body as TelefonoBody).data.id;
    telefonoIdsCreados.push(telId);

    const antes = await prisma.registroAuditoria.count({
      where: { entidad: 'TelefonoEmergenciaSede', entidadId: telId },
    });

    const res = await request(app.getHttpServer())
      .patch(`/emergencia/telefonos/${telId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    const body = res.body as TelefonoBody;
    expect(body.data.etiqueta).toBe('Hospital General E2E');
    expect(body.data.telefono).toBe('065');

    const despues = await prisma.registroAuditoria.count({
      where: { entidad: 'TelefonoEmergenciaSede', entidadId: telId },
    });
    expect(despues).toBe(antes);
  });

  it('PATCH con cambio real responde 200 y audita EDICION', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const creado = await request(app.getHttpServer())
      .post('/emergencia/telefonos')
      .set('Authorization', `Bearer ${token}`)
      .send({ etiqueta: 'CFE E2E', telefono: '071' })
      .expect(201);
    const telId = (creado.body as TelefonoBody).data.id;
    telefonoIdsCreados.push(telId);

    const res = await request(app.getHttpServer())
      .patch(`/emergencia/telefonos/${telId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ telefono: '072' });

    expect(res.status).toBe(200);
    expect((res.body as TelefonoBody).data.telefono).toBe('072');

    const registro = await prisma.registroAuditoria.findFirst({
      where: {
        entidad: 'TelefonoEmergenciaSede',
        entidadId: telId,
        accion: 'EDICION',
      },
    });
    expect(registro).not.toBeNull();
    expect(registro?.usuarioId).toBe(actorUsuarioId);
  });

  it('DELETE /emergencia/telefonos/:id borra de verdad y audita ELIMINACION', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const creado = await request(app.getHttpServer())
      .post('/emergencia/telefonos')
      .set('Authorization', `Bearer ${token}`)
      .send({ etiqueta: 'Angeles Verdes E2E', telefono: '078' })
      .expect(201);
    const telId = (creado.body as TelefonoBody).data.id;
    telefonoIdsCreados.push(telId);

    const res = await request(app.getHttpServer())
      .delete(`/emergencia/telefonos/${telId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect((res.body as OkBody).data).toEqual({ ok: true });

    const enDb = await prisma.telefonoEmergenciaSede.findUnique({
      where: { id: telId },
    });
    expect(enDb).toBeNull();

    const registro = await prisma.registroAuditoria.findFirst({
      where: {
        entidad: 'TelefonoEmergenciaSede',
        entidadId: telId,
        accion: 'ELIMINACION',
      },
    });
    expect(registro).not.toBeNull();
    expect(registro?.usuarioId).toBe(actorUsuarioId);
  });

  it('DELETE /emergencia/telefonos/:id inexistente -> 404 NOT_FOUND', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .delete('/emergencia/telefonos/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('POST con etiqueta vacía → 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/emergencia/telefonos')
      .set('Authorization', `Bearer ${token}`)
      .send({ etiqueta: '', telefono: '911' });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('POST sin campos requeridos → 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/emergencia/telefonos')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('GET /emergencia/telefonos sin Authorization -> 401 UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer()).get('/emergencia/telefonos');

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
  });

  it('GET /emergencia/telefonos rol no ADMINISTRATIVO -> 403 ROL_NO_AUTORIZADO', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ALUMNO,
    });

    const res = await request(app.getHttpServer())
      .get('/emergencia/telefonos')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });

  it('POST /emergencia/telefonos rol no ADMINISTRATIVO -> 403 ROL_NO_AUTORIZADO', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.MAESTRO,
    });

    const res = await request(app.getHttpServer())
      .post('/emergencia/telefonos')
      .set('Authorization', `Bearer ${token}`)
      .send({ etiqueta: 'No deberia entrar', telefono: '911' });

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });
});
