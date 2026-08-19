import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { RolUsuario } from '@prisma/client';
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
    token = await firmarPlatformAdminToken({
      sub: admin.id,
      email: admin.email,
    });
  });

  afterAll(async () => {
    // Orden importa acá — cada paso depende de que el anterior haya
    // terminado antes de que la siguiente FK se vuelva imposible de
    // resolver:
    //
    // 1) Borrar TODO el rastro de auditoría de este admin de prueba por
    //    `adminPlataformaId` (no por `sedeId`, ver nota abajo) — antes de
    //    tocar sedes/admin.
    // 2) Borrar los `Usuario` de prueba que quedaron colgando de una sede
    //    (`Usuario.sedeId` es FK obligatoria SIN `onDelete` — el test
    //    "alumno dado de baja -> 409 CONFLICT igual" del bloque
    //    `DELETE /sedes/:id`, Task 2, deja a propósito un `Usuario`
    //    inactivo sin borrar: es justo el comportamiento que prueba, que el
    //    `DELETE` real falle con P2003. Sin este paso, `sede.deleteMany` de
    //    abajo revienta con el mismo P2003).
    // 3) Borrar las sedes de prueba.
    // 4) Borrar el admin de prueba.
    //
    // Por qué el paso 1 filtra por `adminPlataformaId` y no por `sedeId`
    // (como antes de Task 2): el bloque `DELETE /sedes/:id` prueba a
    // propósito que el `RegistroAuditoria` de la `ALTA` original sobrevive
    // con `sedeId: null` después de borrar la sede — esas filas ya NO
    // calzan con `sedeId: { in: idsSedesPrueba } }` (null no está "in" una
    // lista de UUIDs) y quedan huérfanas apuntando a este admin. Si después
    // se intenta borrar el admin (paso 4) con esas filas todavía vivas,
    // Postgres intenta `SET NULL` en `admin_plataforma_id` (FK opcional) y
    // el CHECK `registro_auditoria_actor_check` revienta — quedaría un
    // registro sin actor (`usuarioId` y `adminPlataformaId` null a la vez).
    // Filtrar por `adminPlataformaId` en vez de `sedeId` evita esto sin
    // importar si la sede detrás del registro sigue viva o no.
    const admin = await prisma.adminPlataforma.findFirst({
      where: { email: emailAdmin },
    });
    if (admin) {
      await prisma.registroAuditoria.deleteMany({
        where: { adminPlataformaId: admin.id },
      });
    }

    const sedesPrueba = await prisma.sede.findMany({
      where: { nombre: { startsWith: 'Sede E2E ' } },
      select: { id: true },
    });
    await prisma.usuario.deleteMany({
      where: { sedeId: { in: sedesPrueba.map((s) => s.id) } },
    });
    await prisma.sede.deleteMany({
      where: { nombre: { startsWith: 'Sede E2E ' } },
    });
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

  it('PATCH /sedes/:id edita el teléfono y audita (hay cambio real)', async () => {
    const auditoriasAntes = await prisma.registroAuditoria.count({
      where: { entidad: 'Sede', entidadId: sedeCreadaId },
    });

    const res = await request(app.getHttpServer())
      .patch(`/sedes/${sedeCreadaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ telefono: '9990000000' });

    expect(res.status).toBe(200);
    expect((res.body as { data: { telefono: string } }).data.telefono).toBe(
      '9990000000',
    );

    const auditoriasDespues = await prisma.registroAuditoria.count({
      where: { entidad: 'Sede', entidadId: sedeCreadaId },
    });
    expect(auditoriasDespues).toBe(auditoriasAntes + 1);
  });

  it('PATCH /sedes/:id vacío no audita (sin cambios reales)', async () => {
    const auditoriasAntes = await prisma.registroAuditoria.count({
      where: { entidad: 'Sede', entidadId: sedeCreadaId },
    });

    const res = await request(app.getHttpServer())
      .patch(`/sedes/${sedeCreadaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);

    const auditoriasDespues = await prisma.registroAuditoria.count({
      where: { entidad: 'Sede', entidadId: sedeCreadaId },
    });
    expect(auditoriasDespues).toBe(auditoriasAntes);
  });

  it('PATCH /sedes/:id con los mismos valores no audita (sin cambios reales)', async () => {
    const auditoriasAntes = await prisma.registroAuditoria.count({
      where: { entidad: 'Sede', entidadId: sedeCreadaId },
    });

    const res = await request(app.getHttpServer())
      .patch(`/sedes/${sedeCreadaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ telefono: '9990000000' }); // mismo valor que dejó el PATCH anterior

    expect(res.status).toBe(200);

    const auditoriasDespues = await prisma.registroAuditoria.count({
      where: { entidad: 'Sede', entidadId: sedeCreadaId },
    });
    expect(auditoriasDespues).toBe(auditoriasAntes);
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
    const res = await request(app.getHttpServer()).post('/sedes').send({
      nombre: 'x',
      direccion: 'x',
      ubicacionReferencia: 'x',
      telefono: 'x',
    });

    expect(res.status).toBe(401);
  });

  describe('DELETE /sedes/:id', () => {
    async function crearSedeDePrueba(nombre: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post('/sedes')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre,
          direccion: 'Calle Falsa 123',
          ubicacionReferencia: 'Frente al parque',
          telefono: '9991234567',
        });
      return (res.body as SedeBody).data.id;
    }

    it('sede vacía se elimina exitosamente', async () => {
      const id = await crearSedeDePrueba(`Sede E2E Delete Vacia ${Date.now()}`);

      const res = await request(app.getHttpServer())
        .delete(`/sedes/${id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect((res.body as { data: { ok: boolean } }).data.ok).toBe(true);

      const sedeEnDb = await prisma.sede.findUnique({ where: { id } });
      expect(sedeEnDb).toBeNull();
    });

    it('el RegistroAuditoria de la ALTA original sobrevive con sedeId null', async () => {
      const nombre = `Sede E2E Delete Auditoria ${Date.now()}`;
      const id = await crearSedeDePrueba(nombre);

      const registroAlta = await prisma.registroAuditoria.findFirst({
        where: { entidad: 'Sede', entidadId: id, accion: 'ALTA' },
      });
      expect(registroAlta).not.toBeNull();

      const res = await request(app.getHttpServer())
        .delete(`/sedes/${id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);

      const registroAltaDespues = await prisma.registroAuditoria.findUnique({
        where: { id: registroAlta!.id },
      });
      expect(registroAltaDespues).not.toBeNull();
      expect(registroAltaDespues!.sedeId).toBeNull();

      const registroEliminacion = await prisma.registroAuditoria.findFirst({
        where: { entidad: 'Sede', entidadId: id, accion: 'ELIMINACION' },
      });
      expect(registroEliminacion).not.toBeNull();
      expect(registroEliminacion!.sedeId).toBeNull();
      expect(registroEliminacion!.detalle).toEqual({ nombre });
    });

    it('sede con alumno activo -> 409 CONFLICT, no se borra', async () => {
      const id = await crearSedeDePrueba(
        `Sede E2E Delete AlumnoActivo ${Date.now()}`,
      );
      const usuario = await prisma.usuario.create({
        data: {
          id: randomUUID(),
          email: `fixture.delete-sede.${randomUUID()}@example.com`,
          rol: RolUsuario.ALUMNO,
          sedeId: id,
          activo: true,
        },
      });

      const res = await request(app.getHttpServer())
        .delete(`/sedes/${id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(409);
      expect((res.body as ErrorBody).code).toBe('CONFLICT');
      expect((res.body as ErrorBody).error).toMatch(/alumno/i);
      expect((res.body as ErrorBody).error).toMatch(/1 alumno/);

      const sedeEnDb = await prisma.sede.findUnique({ where: { id } });
      expect(sedeEnDb).not.toBeNull();

      await prisma.usuario.delete({ where: { id: usuario.id } });
    });

    it('sede con alumno dado de baja (activo=false) -> 409 CONFLICT igual (Usuario.sedeId sigue siendo FK sin onDelete)', async () => {
      const id = await crearSedeDePrueba(
        `Sede E2E Delete AlumnoBaja ${Date.now()}`,
      );
      await prisma.usuario.create({
        data: {
          id: randomUUID(),
          email: `fixture.delete-sede.${randomUUID()}@example.com`,
          rol: RolUsuario.ALUMNO,
          sedeId: id,
          activo: false,
        },
      });

      const res = await request(app.getHttpServer())
        .delete(`/sedes/${id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(409);
      expect((res.body as ErrorBody).code).toBe('CONFLICT');
      expect((res.body as ErrorBody).error).toMatch(
        /otros datos asociados|datos asociados/,
      );

      const sedeEnDb = await prisma.sede.findUnique({ where: { id } });
      expect(sedeEnDb).not.toBeNull();
    });

    it('sede con maestro activo -> 409 CONFLICT (protegido por el FK de Usuario, no por el chequeo explícito de alumnos)', async () => {
      const id = await crearSedeDePrueba(
        `Sede E2E Delete MaestroActivo ${Date.now()}`,
      );
      await prisma.usuario.create({
        data: {
          id: randomUUID(),
          email: `fixture.delete-sede.${randomUUID()}@example.com`,
          rol: RolUsuario.MAESTRO,
          sedeId: id,
          activo: true,
        },
      });

      const res = await request(app.getHttpServer())
        .delete(`/sedes/${id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(409);
      expect((res.body as ErrorBody).code).toBe('CONFLICT');

      const sedeEnDb = await prisma.sede.findUnique({ where: { id } });
      expect(sedeEnDb).not.toBeNull();
    });

    it('sede con una carrera asociada (sin alumnos) -> 409 CONFLICT por datos asociados', async () => {
      const id = await crearSedeDePrueba(
        `Sede E2E Delete Carrera ${Date.now()}`,
      );
      const carrera = await prisma.carrera.create({
        data: {
          sedeId: id,
          nombre: `Carrera E2E Delete ${Date.now()}`,
          clave: `CED${Date.now()}`,
          duracion: 8,
          nivel: 'LICENCIATURA',
          modalidad: 'PRESENCIAL',
          rvoe: 'RVOE-E2E-DELETE',
          descripcion: 'Carrera de prueba para el test de DELETE /sedes',
        },
      });

      const res = await request(app.getHttpServer())
        .delete(`/sedes/${id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(409);
      expect((res.body as ErrorBody).code).toBe('CONFLICT');

      const sedeEnDb = await prisma.sede.findUnique({ where: { id } });
      expect(sedeEnDb).not.toBeNull();

      await prisma.carrera.delete({ where: { id: carrera.id } });
    });

    it('id inexistente -> 404 NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .delete('/sedes/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
    });

    it('sin token -> 401 UNAUTHORIZED', async () => {
      const id = await crearSedeDePrueba(
        `Sede E2E Delete SinToken ${Date.now()}`,
      );

      const res = await request(app.getHttpServer()).delete(`/sedes/${id}`);

      expect(res.status).toBe(401);

      await prisma.registroAuditoria.deleteMany({ where: { sedeId: id } });
      await prisma.sede.delete({ where: { id } });
    });
  });
});
