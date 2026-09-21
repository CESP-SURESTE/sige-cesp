import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  EstatusEmpleado,
  NivelPermiso,
  PuestoAdministrativo,
  RolUsuario,
  TipoContratacion,
} from '@prisma/client';
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

interface OkBody {
  data: { ok: true };
}

/**
 * Test de integración — feature "Edición de datos de persona" (2026-09-20).
 *
 * `GET /personas/:id` (Task 1) + `PATCH /personas/:id` (Task 2, agregado en
 * ese mismo archivo). Contra la app real (`AppModule` completo,
 * `PrismaService` conectado a la DB real de Supabase) — sin mockear
 * Supabase Auth/Storage: ninguno de los 2 endpoints los toca (a diferencia
 * de `POST /personas`/`foto-perfil`), mismo criterio que
 * `personas-listado.e2e-spec.ts`.
 */
describe('PersonasController — GET/PATCH /personas/:id (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let sedeValladolidId: string;
  let carreraMeridaId: string;
  let adminMeridaId: string;
  let adminValladolidId: string;

  // Cleanup real (mismo criterio que `personas-listado.e2e-spec.ts`, regla
  // 14 de `CLAUDE.md` raíz) — cada `usuarioId` real creado directo por
  // `prisma.usuario.create()` en este archivo se agrega acá; `afterAll` los
  // borra al final. NUNCA incluye a los actores reales del seed.
  const usuarioIdsCreados: string[] = [];

  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';

  async function firmarToken(
    sub: string,
    rol: RolUsuario,
    sedeId: string,
  ): Promise<string> {
    return new jose.SignJWT({ role: 'authenticated', sede_id: sedeId, rol })
      .setProtectedHeader({ alg, kid })
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  async function crearAlumnoFixture(sedeId: string, carreraId: string) {
    const usuario = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.editar.${randomUUID()}@example.com`,
        rol: RolUsuario.ALUMNO,
        sedeId,
      },
    });
    const perfil = await prisma.perfilAlumno.create({
      data: {
        usuarioId: usuario.id,
        nombres: 'Fixture Editar',
        apellidoPaterno: 'Original',
        curp: `FX${randomUUID().slice(0, 16).toUpperCase()}`,
        fechaNacimiento: new Date('2005-01-01'),
        matricula: `A2026${randomUUID().slice(0, 5).toUpperCase()}`,
        correoPersonal: `fixture.editar.personal.${randomUUID()}@example.com`,
        carreraId,
        estatusAcademico: 'INSCRITO',
        periodoIngreso: '2026-1',
        cuatrimestreActual: 1,
        telefono: '9990001111',
      },
    });
    await prisma.contactoAlumno.create({
      data: {
        alumnoId: perfil.id,
        tipo: 'TUTOR',
        nombre: 'Tutor Original',
        telefono: '9990002222',
        parentesco: 'Madre',
        orden: 1,
      },
    });
    await prisma.infoMedicaAlumno.create({
      data: { alumnoId: perfil.id, tieneCondicionMedica: false, tipoSangre: 'O_POSITIVO' },
    });
    usuarioIdsCreados.push(usuario.id);
    return usuario.id;
  }

  async function crearAdministrativoFixture(
    sedeId: string,
    nivelPermiso: NivelPermiso,
  ) {
    const usuario = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.editar.admin.${randomUUID()}@example.com`,
        rol: RolUsuario.ADMINISTRATIVO,
        sedeId,
      },
    });
    const perfil = await prisma.perfilAdministrativo.create({
      data: {
        usuarioId: usuario.id,
        nombres: 'Fixture Editar Admin',
        apellidoPaterno: 'Original',
        curp: `FX${randomUUID().slice(0, 16).toUpperCase()}`,
        correoPersonal: `fixture.editar.admin.personal.${randomUUID()}@example.com`,
        telefono: '9990003333',
        fechaContratacion: new Date('2024-01-01'),
        estatus: EstatusEmpleado.ACTIVO,
        puesto: PuestoAdministrativo.AUXILIAR,
        nivelPermiso,
      },
    });
    await prisma.contactoAdministrativo.create({
      data: {
        administrativoId: perfil.id,
        nombre: 'Contacto Original',
        telefono: '9990004444',
        parentesco: 'Padre',
        orden: 1,
      },
    });
    await prisma.infoMedicaAdministrativo.create({
      data: { administrativoId: perfil.id, tieneCondicionMedica: false, tipoSangre: 'A_POSITIVO' },
    });
    usuarioIdsCreados.push(usuario.id);
    return usuario.id;
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

    const merida = await prisma.sede.findUniqueOrThrow({ where: { nombre: 'CESP Mérida' } });
    sedeMeridaId = merida.id;
    const valladolid = await prisma.sede.findUniqueOrThrow({ where: { nombre: 'CESP Valladolid' } });
    sedeValladolidId = valladolid.id;
    const carreraMerida = await prisma.carrera.findUniqueOrThrow({ where: { clave: 'LAE-MID' } });
    carreraMeridaId = carreraMerida.id;

    const adminMerida = await prisma.usuario.findUniqueOrThrow({
      where: { email: 'ana.canul@cesp-merida.edu.mx' },
    });
    adminMeridaId = adminMerida.id;
    const adminValladolid = await prisma.usuario.findUniqueOrThrow({
      where: { email: 'jorge.ek@cesp-valladolid.edu.mx' },
    });
    adminValladolidId = adminValladolid.id;
  });

  afterAll(async () => {
    await prisma.registroAuditoria.deleteMany({
      where: { usuarioId: { in: usuarioIdsCreados } },
    });
    await prisma.usuario.deleteMany({ where: { id: { in: usuarioIdsCreados } } });
    await app.close();
  });

  describe('GET /personas/:id', () => {
    it('trae los datos editables de un alumno, con contactos e infoMedica', async () => {
      const alumnoId = await crearAlumnoFixture(sedeMeridaId, carreraMeridaId);
      const token = await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId);

      const res = await request(app.getHttpServer())
        .get(`/personas/${alumnoId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const body = res.body as {
        data: {
          rol: string;
          perfilAlumno: { nombres: string; carreraId: string };
          contactos: { nombre: string; tipo?: string }[];
          infoMedica: { tipoSangre: string | null };
        };
      };
      expect(body.data.rol).toBe('ALUMNO');
      expect(body.data.perfilAlumno.nombres).toBe('Fixture Editar');
      expect(body.data.perfilAlumno.carreraId).toBe(carreraMeridaId);
      expect(body.data.contactos).toHaveLength(1);
      expect(body.data.contactos[0].tipo).toBe('TUTOR');
      expect(body.data.infoMedica.tipoSangre).toBe('O_POSITIVO');
    });

    it('responde 404 NOT_FOUND si la persona es de otra sede', async () => {
      const alumnoId = await crearAlumnoFixture(sedeMeridaId, carreraMeridaId);
      const token = await firmarToken(
        adminValladolidId,
        RolUsuario.ADMINISTRATIVO,
        sedeValladolidId,
      );

      const res = await request(app.getHttpServer())
        .get(`/personas/${alumnoId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
    });

    it('responde 404 NOT_FOUND si el id no existe', async () => {
      const token = await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId);

      const res = await request(app.getHttpServer())
        .get(`/personas/${randomUUID()}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
    });
  });

  describe('PATCH /personas/:id', () => {
    it('edita nombres/apellidos/CURP/contactos/infoMedica de un alumno', async () => {
      const alumnoId = await crearAlumnoFixture(sedeMeridaId, carreraMeridaId);
      const token = await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId);

      const res = await request(app.getHttpServer())
        .patch(`/personas/${alumnoId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          perfilAlumno: {
            nombres: 'Fixture Editar CORREGIDO',
            apellidoPaterno: 'Corregido',
            fechaNacimiento: '2005-01-01',
            correoPersonal: 'corregido@example.com',
            carreraId: carreraMeridaId,
            periodoIngreso: '2026-1',
            cuatrimestreActual: 2,
            contactos: [
              { nombre: 'Tutor Nuevo', telefono: '9991110000', parentesco: 'Padre', tipo: 'TUTOR' },
            ],
            infoMedica: { tieneCondicionMedica: false, tipoSangre: 'B_NEGATIVO' },
          },
        });

      expect(res.status).toBe(200);
      expect((res.body as OkBody).data).toEqual({ ok: true });

      const perfil = await prisma.perfilAlumno.findUniqueOrThrow({
        where: { usuarioId: alumnoId },
        include: { contactos: true, infoMedica: true },
      });
      expect(perfil.nombres).toBe('Fixture Editar CORREGIDO');
      expect(perfil.apellidoPaterno).toBe('Corregido');
      expect(perfil.cuatrimestreActual).toBe(2);
      expect(perfil.contactos).toHaveLength(1);
      expect(perfil.contactos[0].nombre).toBe('Tutor Nuevo');
      expect(perfil.infoMedica?.tipoSangre).toBe('B_NEGATIVO');

      const registro = await prisma.registroAuditoria.findFirst({
        where: { entidad: 'Usuario', entidadId: alumnoId, accion: 'EDICION' },
        orderBy: { fecha: 'desc' },
      });
      expect(registro?.usuarioId).toBe(adminMeridaId);
    });

    it('responde 400 VALIDATION_ERROR si cuatrimestreActual excede la duración de la carrera', async () => {
      const alumnoId = await crearAlumnoFixture(sedeMeridaId, carreraMeridaId);
      const token = await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId);
      const carrera = await prisma.carrera.findUniqueOrThrow({ where: { id: carreraMeridaId } });

      const res = await request(app.getHttpServer())
        .patch(`/personas/${alumnoId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          perfilAlumno: {
            nombres: 'X',
            apellidoPaterno: 'Y',
            fechaNacimiento: '2005-01-01',
            correoPersonal: 'x@example.com',
            carreraId: carreraMeridaId,
            periodoIngreso: '2026-1',
            cuatrimestreActual: carrera.duracion + 1,
            contactos: [{ nombre: 'T', telefono: '1', parentesco: 'P', tipo: 'TUTOR' }],
            infoMedica: { tieneCondicionMedica: false, tipoSangre: 'O_POSITIVO' },
          },
        });

      expect(res.status).toBe(400);
      expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
    });

    it('responde 404 NOT_FOUND si la persona es de otra sede', async () => {
      const alumnoId = await crearAlumnoFixture(sedeMeridaId, carreraMeridaId);
      const token = await firmarToken(adminValladolidId, RolUsuario.ADMINISTRATIVO, sedeValladolidId);

      const res = await request(app.getHttpServer())
        .patch(`/personas/${alumnoId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          perfilAlumno: {
            nombres: 'X',
            apellidoPaterno: 'Y',
            fechaNacimiento: '2005-01-01',
            correoPersonal: 'x@example.com',
            carreraId: carreraMeridaId,
            periodoIngreso: '2026-1',
            cuatrimestreActual: 1,
            contactos: [{ nombre: 'T', telefono: '1', parentesco: 'P', tipo: 'TUTOR' }],
            infoMedica: { tieneCondicionMedica: false, tipoSangre: 'O_POSITIVO' },
          },
        });

      expect(res.status).toBe(404);
      expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
    });

    it('un AUXILIAR no puede editar a un ADMINISTRATIVO (403 NIVEL_PERMISO_INSUFICIENTE)', async () => {
      const targetId = await crearAdministrativoFixture(sedeMeridaId, NivelPermiso.AUXILIAR);
      const auxiliarId = await crearAdministrativoFixture(sedeMeridaId, NivelPermiso.AUXILIAR);
      const token = await firmarToken(auxiliarId, RolUsuario.ADMINISTRATIVO, sedeMeridaId);

      const res = await request(app.getHttpServer())
        .patch(`/personas/${targetId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          perfilAdministrativo: {
            nombres: 'X',
            apellidoPaterno: 'Y',
            curp: 'CURPCURPCURPCURPCU',
            correoPersonal: 'x@example.com',
            telefono: '9990000000',
            fechaContratacion: '2024-01-01',
            puesto: 'AUXILIAR',
            contactos: [{ nombre: 'T', telefono: '1', parentesco: 'P' }],
            infoMedica: { tieneCondicionMedica: false, tipoSangre: 'O_POSITIVO' },
          },
        });

      expect(res.status).toBe(403);
      expect((res.body as ErrorBody).code).toBe('NIVEL_PERMISO_INSUFICIENTE');
    });

    it('cambiar nivelPermiso audita CAMBIO_PERMISO además de EDICION', async () => {
      const targetId = await crearAdministrativoFixture(sedeMeridaId, NivelPermiso.AUXILIAR);
      const token = await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId);

      const res = await request(app.getHttpServer())
        .patch(`/personas/${targetId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          perfilAdministrativo: {
            nombres: 'X',
            apellidoPaterno: 'Y',
            curp: 'CURPCURPCURPCURPCU',
            correoPersonal: 'x@example.com',
            telefono: '9990000000',
            fechaContratacion: '2024-01-01',
            puesto: 'AUXILIAR',
            nivelPermiso: 'ADMIN',
            contactos: [{ nombre: 'T', telefono: '1', parentesco: 'P' }],
            infoMedica: { tieneCondicionMedica: false, tipoSangre: 'O_POSITIVO' },
          },
        });

      expect(res.status).toBe(200);

      const perfil = await prisma.perfilAdministrativo.findUniqueOrThrow({
        where: { usuarioId: targetId },
      });
      expect(perfil.nivelPermiso).toBe('ADMIN');

      const registroCambioPermiso = await prisma.registroAuditoria.findFirst({
        where: { entidad: 'Usuario', entidadId: targetId, accion: 'CAMBIO_PERMISO' },
      });
      expect(registroCambioPermiso).not.toBeNull();
      const registroEdicion = await prisma.registroAuditoria.findFirst({
        where: { entidad: 'Usuario', entidadId: targetId, accion: 'EDICION' },
      });
      expect(registroEdicion).not.toBeNull();
    });
  });
});
