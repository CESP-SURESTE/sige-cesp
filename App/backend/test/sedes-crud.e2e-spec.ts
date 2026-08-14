import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/load-env';
import { firmarPlatformAdminToken } from '../src/platform-admin/platform-admin-jwt.util';
import { hashPassword } from '../src/platform-admin/password.util';
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

describe('CRUD /sedes con PlatformAdminGuard (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;
  const emailAdmin = 'e2e.sedes-crud@nexo-sd.mx';
  const nombreSedePrueba = `Sede E2E ${Date.now()}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    await prisma.adminPlataforma.deleteMany({ where: { email: emailAdmin } });
    const admin = await prisma.adminPlataforma.create({
      data: {
        email: emailAdmin,
        passwordHash: await hashPassword('password-e2e-123'),
        nombre: 'E2E Sedes',
      },
    });
    token = await firmarPlatformAdminToken({ sub: admin.id, email: admin.email });
  });

  afterAll(async () => {
    // `RegistroAuditoria.sedeId` es FK requerida sin cascade — hay que
    // limpiar los registros de auditoría que referencian las sedes de
    // prueba antes de poder borrar las sedes mismas.
    const sedesPrueba = await prisma.sede.findMany({
      where: { nombre: { startsWith: 'Sede E2E ' } },
      select: { id: true },
    });
    await prisma.registroAuditoria.deleteMany({
      where: { sedeId: { in: sedesPrueba.map((s) => s.id) } },
    });
    await prisma.sede.deleteMany({ where: { nombre: { startsWith: 'Sede E2E ' } } });
    await prisma.adminPlataforma.deleteMany({ where: { email: emailAdmin } });
    await app.close();
  });

  let sedeCreadaId: string;

  it('POST /sedes crea una sede y audita con adminPlataformaId', async () => {
    const res = await request(app.getHttpServer())
      .post('/sedes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: nombreSedePrueba,
        direccion: 'Calle Falsa 123',
        ubicacionReferencia: 'Frente al parque',
        telefono: '9991234567',
      });

    expect(res.status).toBe(201);
    expect((res.body as SedeBody).data.nombre).toBe(nombreSedePrueba);
    sedeCreadaId = (res.body as SedeBody).data.id;

    const registro = await prisma.registroAuditoria.findFirst({
      where: { entidad: 'Sede', entidadId: sedeCreadaId },
    });
    expect(registro?.adminPlataformaId).not.toBeNull();
    expect(registro?.usuarioId).toBeNull();
  });

  it('POST /sedes con nombre duplicado -> 409 CONFLICT', async () => {
    const res = await request(app.getHttpServer())
      .post('/sedes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: nombreSedePrueba,
        direccion: 'Otra dirección',
        ubicacionReferencia: 'Otra referencia',
        telefono: '9997654321',
      });

    expect(res.status).toBe(409);
    expect((res.body as ErrorBody).code).toBe('CONFLICT');
  });

  it('POST /sedes sin nombre -> 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .post('/sedes')
      .set('Authorization', `Bearer ${token}`)
      .send({ direccion: 'x', ubicacionReferencia: 'x', telefono: 'x' });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('GET /sedes incluye la sede recién creada', async () => {
    const res = await request(app.getHttpServer())
      .get('/sedes')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const nombres = (res.body as { data: { nombre: string }[] }).data.map(
      (s) => s.nombre,
    );
    expect(nombres).toContain(nombreSedePrueba);
  });

  it('PATCH /sedes/:id edita el teléfono', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/sedes/${sedeCreadaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ telefono: '9990000000' });

    expect(res.status).toBe(200);
    expect((res.body as { data: { telefono: string } }).data.telefono).toBe(
      '9990000000',
    );
  });

  it('PATCH /sedes/:id con id inexistente -> 404 NOT_FOUND', async () => {
    const res = await request(app.getHttpServer())
      .patch('/sedes/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ telefono: '9990000000' });

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('POST /sedes sin token -> 401 UNAUTHORIZED (PlatformAdminGuard sigue activo)', async () => {
    const res = await request(app.getHttpServer())
      .post('/sedes')
      .send({ nombre: 'x', direccion: 'x', ubicacionReferencia: 'x', telefono: 'x' });

    expect(res.status).toBe(401);
  });
});
