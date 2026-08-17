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
interface CarreraBody {
  data: {
    id: string;
    nombre: string;
    clave: string;
    duracion: number;
    nivel: string;
    modalidad: string;
    estatus: string;
    rvoe: string;
    descripcion: string;
    sedeId: string;
  };
}

/**
 * `POST`/`PATCH /carreras` — Fase 6, Día 21. Mismo mecanismo de JWKS de
 * prueba que `carreras.e2e-spec.ts` (`GET /carreras`, Día 14): JWT firmado
 * con `jose`, inyectado vía `SEDE_GUARD_ENV_OVERRIDE`. `sub` del token = el
 * `usuarioId` real del admin ANCLA de Mérida (`ana.canul@cesp-merida.edu.mx`,
 * ver `prisma/seed.ts`) — actor real para `RegistroAuditoria.usuarioId`.
 */
describe('CarrerasController — POST/PATCH /carreras (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let sedeValladolidId: string;
  let actorUsuarioId: string;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';
  const clavePrueba = `CRUD-E2E-${Date.now()}`;
  const nombrePrueba = `Carrera CRUD E2E ${Date.now()}`;

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
      where: { entidad: 'Carrera', sedeId: sedeMeridaId },
    });
    await prisma.carrera.deleteMany({
      where: { clave: { startsWith: 'CRUD-E2E-' } },
    });
    await app.close();
  });

  let carreraCreadaId: string;

  const bodyValido = {
    nombre: nombrePrueba,
    clave: clavePrueba,
    duracion: 8,
    nivel: 'LICENCIATURA',
    modalidad: 'PRESENCIAL',
    rvoe: 'RVOE-E2E-001',
    descripcion: 'Carrera de prueba e2e para el CRUD de Día 21.',
  };

  it('POST /carreras crea una carrera en la sede del actor, estatus ACTIVA por default, y audita con usuarioId', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/carreras')
      .set('Authorization', `Bearer ${token}`)
      .send(bodyValido);

    expect(res.status).toBe(201);
    const body = res.body as CarreraBody;
    expect(body.data.nombre).toBe(nombrePrueba);
    expect(body.data.clave).toBe(clavePrueba);
    expect(body.data.estatus).toBe('ACTIVA');
    expect(body.data.sedeId).toBe(sedeMeridaId);
    carreraCreadaId = body.data.id;

    const registro = await prisma.registroAuditoria.findFirst({
      where: { entidad: 'Carrera', entidadId: carreraCreadaId },
    });
    expect(registro?.usuarioId).toBe(actorUsuarioId);
    expect(registro?.adminPlataformaId).toBeNull();
    expect(registro?.accion).toBe('ALTA');
  });

  it('POST /carreras con clave duplicada -> 409 CONFLICT', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/carreras')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...bodyValido, nombre: `${nombrePrueba} otro nombre` });

    expect(res.status).toBe(409);
    expect((res.body as ErrorBody).code).toBe('CONFLICT');
  });

  it('POST /carreras con nombre duplicado en la misma sede -> 409 CONFLICT', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/carreras')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...bodyValido, clave: `${clavePrueba}-OTRA` });

    expect(res.status).toBe(409);
    expect((res.body as ErrorBody).code).toBe('CONFLICT');
  });

  it('POST /carreras con el mismo nombre pero en otra sede -> 201 (aislamiento por sede)', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeValladolidId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/carreras')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...bodyValido, clave: `${clavePrueba}-VLD` });

    expect(res.status).toBe(201);
    expect((res.body as CarreraBody).data.sedeId).toBe(sedeValladolidId);
  });

  it('POST /carreras sin nombre -> 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const { nombre, ...sinNombre } = bodyValido;
    void nombre;

    const res = await request(app.getHttpServer())
      .post('/carreras')
      .set('Authorization', `Bearer ${token}`)
      .send(sinNombre);

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('POST /carreras con duracion no entera -> 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/carreras')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...bodyValido, clave: `${clavePrueba}-BAD`, duracion: 8.5 });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('POST /carreras con nivel fuera del enum -> 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/carreras')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...bodyValido, clave: `${clavePrueba}-BAD2`, nivel: 'PRIMARIA' });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('POST /carreras rol no ADMINISTRATIVO -> 403 ROL_NO_AUTORIZADO', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ALUMNO,
    });

    const res = await request(app.getHttpServer())
      .post('/carreras')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...bodyValido, clave: `${clavePrueba}-ROL` });

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });

  it('PATCH /carreras/:id edita la descripción y audita (hay cambio real)', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const auditoriasAntes = await prisma.registroAuditoria.count({
      where: { entidad: 'Carrera', entidadId: carreraCreadaId },
    });

    const res = await request(app.getHttpServer())
      .patch(`/carreras/${carreraCreadaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ descripcion: 'Descripción editada por el e2e.' });

    expect(res.status).toBe(200);
    expect((res.body as CarreraBody).data.descripcion).toBe(
      'Descripción editada por el e2e.',
    );

    const auditoriasDespues = await prisma.registroAuditoria.count({
      where: { entidad: 'Carrera', entidadId: carreraCreadaId },
    });
    expect(auditoriasDespues).toBe(auditoriasAntes + 1);

    const ultimoRegistro = await prisma.registroAuditoria.findFirst({
      where: { entidad: 'Carrera', entidadId: carreraCreadaId },
      orderBy: { fecha: 'desc' },
    });
    expect(ultimoRegistro?.accion).toBe('EDICION');
    expect(ultimoRegistro?.usuarioId).toBe(actorUsuarioId);
  });

  it('PATCH /carreras/:id vacío no audita (sin cambios reales)', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const auditoriasAntes = await prisma.registroAuditoria.count({
      where: { entidad: 'Carrera', entidadId: carreraCreadaId },
    });

    const res = await request(app.getHttpServer())
      .patch(`/carreras/${carreraCreadaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);

    const auditoriasDespues = await prisma.registroAuditoria.count({
      where: { entidad: 'Carrera', entidadId: carreraCreadaId },
    });
    expect(auditoriasDespues).toBe(auditoriasAntes);
  });

  it('PATCH /carreras/:id puede cambiar estatus a INACTIVA', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .patch(`/carreras/${carreraCreadaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ estatus: 'INACTIVA' });

    expect(res.status).toBe(200);
    expect((res.body as CarreraBody).data.estatus).toBe('INACTIVA');
  });

  it('PATCH /carreras/:id con id inexistente -> 404 NOT_FOUND', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .patch('/carreras/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ descripcion: 'x' });

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('PATCH /carreras/:id con id de otra sede -> 404 NOT_FOUND (no filtra existencia cross-sede)', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeValladolidId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .patch(`/carreras/${carreraCreadaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ descripcion: 'x' });

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('PATCH /carreras/:id con campo vacío -> 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .patch(`/carreras/${carreraCreadaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: '' });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('POST /carreras sin Authorization -> 401 UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer())
      .post('/carreras')
      .send(bodyValido);

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
  });
});
