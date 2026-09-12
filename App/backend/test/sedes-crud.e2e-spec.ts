import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { NivelPermiso, PuestoAdministrativo, RolUsuario } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/load-env';
import { PERSONAS_SUPABASE_CLIENT_OVERRIDE } from '../src/personas/personas.service';
import { firmarPlatformAdminToken } from '../src/platform-admin/platform-admin-jwt.util';
import { hashPassword } from '../src/platform-admin/password.util';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup-app';

loadEnv();

interface ErrorBody {
  error: string;
  code: string;
}
interface SedeConFundadoresBody {
  data: { sede: { id: string; nombre: string } };
}

describe('CRUD /sedes con PlatformAdminGuard (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;
  const emailAdmin = 'e2e.sedes-crud@nexo-sd.mx';
  const nombreSedePrueba = `Sede E2E ${Date.now()}`;
  let createUser: jest.Mock;
  let deleteUser: jest.Mock;

  function contactoValido(overrides: Record<string, unknown> = {}) {
    return {
      nombre: 'Contacto Prueba',
      telefono: '9990004444',
      parentesco: 'Padre',
      ...overrides,
    };
  }

  function infoMedicaValida(overrides: Record<string, unknown> = {}) {
    return {
      tieneCondicionMedica: false,
      tipoSangre: 'O_POSITIVO',
      ...overrides,
    };
  }

  function fundadorValido(overrides: Record<string, unknown> = {}) {
    return {
      nombres: 'Prueba',
      apellidoPaterno: 'Fundador',
      curp: `CURP${randomUUID().slice(0, 14).toUpperCase()}`,
      correoPersonal: `fundador.${randomUUID()}@example.com`,
      telefono: '9990001111',
      fechaContratacion: '2026-01-01',
      puesto: PuestoAdministrativo.DIRECTOR,
      contactos: [contactoValido()],
      infoMedica: infoMedicaValida(),
      ...overrides,
    };
  }

  function mockCreateUserExitoso() {
    createUser.mockImplementation(({ email }: { email: string }) => ({
      data: {
        user: {
          id: randomUUID(),
          email,
          aud: 'authenticated',
          role: 'authenticated',
          app_metadata: {},
          user_metadata: {},
        },
      },
      error: null,
    }));
  }

  /** Body completo de `POST /sedes` — sede + 2 fundadores válidos. */
  function bodySedeConFundadores(nombre: string) {
    return {
      sede: {
        nombre,
        direccion: 'Calle Falsa 123',
        ubicacionReferencia: 'Frente al parque',
        telefono: '9991234567',
      },
      director: fundadorValido({
        correoPersonal: `director.${randomUUID()}@example.com`,
      }),
      administrativo: fundadorValido({
        correoPersonal: `admin.${randomUUID()}@example.com`,
      }),
    };
  }

  beforeAll(async () => {
    createUser = jest.fn();
    deleteUser = jest.fn().mockResolvedValue({ data: {}, error: null });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PERSONAS_SUPABASE_CLIENT_OVERRIDE)
      .useValue({ auth: { admin: { createUser, deleteUser } } })
      .compile();

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

  it('POST /sedes crea una sede + director + administrativo, audita con adminPlataformaId', async () => {
    mockCreateUserExitoso();

    const res = await request(app.getHttpServer())
      .post('/sedes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sede: {
          nombre: nombreSedePrueba,
          direccion: 'Calle Falsa 123',
          ubicacionReferencia: 'Frente al parque',
          telefono: '9991234567',
        },
        director: fundadorValido({
          correoPersonal: `director.${randomUUID()}@example.com`,
        }),
        administrativo: fundadorValido({
          correoPersonal: `admin.${randomUUID()}@example.com`,
        }),
      });

    expect(res.status).toBe(201);
    const body = res.body as {
      data: {
        sede: { id: string; nombre: string };
        director: { usuario: { id: string } };
        administrativo: { usuario: { id: string } } | null;
      };
    };
    expect(body.data.sede.nombre).toBe(nombreSedePrueba);
    expect(body.data.director.usuario.id).toBeTruthy();
    expect(body.data.administrativo?.usuario.id).toBeTruthy();
    sedeCreadaId = body.data.sede.id;

    const registro = await prisma.registroAuditoria.findFirst({
      where: { entidad: 'Sede', entidadId: sedeCreadaId },
    });
    expect(registro?.adminPlataformaId).not.toBeNull();
    expect(registro?.usuarioId).toBeNull();

    const director = await prisma.perfilAdministrativo.findUnique({
      where: { usuarioId: body.data.director.usuario.id },
    });
    expect(director?.nivelPermiso).toBe(NivelPermiso.SUPER_ADMIN);

    const administrativo = await prisma.perfilAdministrativo.findUnique({
      where: { usuarioId: body.data.administrativo!.usuario.id },
    });
    expect(administrativo?.nivelPermiso).toBe(NivelPermiso.ADMIN);
  });

  it('POST /sedes con nombre duplicado -> 409 CONFLICT', async () => {
    const res = await request(app.getHttpServer())
      .post('/sedes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sede: {
          nombre: nombreSedePrueba,
          direccion: 'Otra dirección',
          ubicacionReferencia: 'Otra referencia',
          telefono: '9997654321',
        },
        director: fundadorValido({
          correoPersonal: `director.${randomUUID()}@example.com`,
        }),
        administrativo: fundadorValido({
          correoPersonal: `admin.${randomUUID()}@example.com`,
        }),
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

  it('POST /sedes — falla el alta del director -> la sede recién creada se borra (nada queda)', async () => {
    // El director es el primer alta que llama a Supabase Auth -> falla de
    // entrada, así que ni siquiera se intenta el administrativo.
    createUser.mockReset();
    createUser.mockImplementation(() => ({
      data: null,
      error: { code: 'unexpected_failure', status: 500, message: 'boom' },
    }));

    const nombreSedeFalla = `Sede E2E Falla Director ${Date.now()}`;

    const res = await request(app.getHttpServer())
      .post('/sedes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sede: {
          nombre: nombreSedeFalla,
          direccion: 'Calle Falsa 456',
          ubicacionReferencia: 'Frente al mercado',
          telefono: '9991234568',
        },
        director: fundadorValido({ correoPersonal: `director-falla.${randomUUID()}@example.com` }),
        administrativo: fundadorValido({
          correoPersonal: `admin-falla.${randomUUID()}@example.com`,
        }),
      });

    expect(res.status).toBe(500);

    const sedeHuerfana = await prisma.sede.findUnique({
      where: { nombre: nombreSedeFalla },
    });
    expect(sedeHuerfana).toBeNull();
  });

  it('POST /sedes — falla el alta del administrativo -> sede+director quedan, respuesta trae advertencia', async () => {
    createUser.mockReset();
    let llamada = 0;
    createUser.mockImplementation(({ email }: { email: string }) => {
      llamada += 1;
      if (llamada === 1) {
        // Director: éxito
        return {
          data: {
            user: {
              id: randomUUID(),
              email,
              aud: 'authenticated',
              role: 'authenticated',
              app_metadata: {},
              user_metadata: {},
            },
          },
          error: null,
        };
      }
      // Administrativo: falla
      return {
        data: null,
        error: { code: 'unexpected_failure', status: 500, message: 'boom' },
      };
    });

    const nombreSedeParcial = `Sede E2E Falla Administrativo ${Date.now()}`;

    const res = await request(app.getHttpServer())
      .post('/sedes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sede: {
          nombre: nombreSedeParcial,
          direccion: 'Calle Falsa 789',
          ubicacionReferencia: 'Frente a la plaza',
          telefono: '9991234569',
        },
        director: fundadorValido({
          correoPersonal: `director-parcial.${randomUUID()}@example.com`,
        }),
        administrativo: fundadorValido({
          correoPersonal: `admin-parcial.${randomUUID()}@example.com`,
        }),
      });

    expect(res.status).toBe(201);
    const body = res.body as {
      data: {
        sede: { id: string };
        director: { usuario: { id: string } };
        administrativo: null;
        advertenciaAdministrativo: string;
      };
    };
    expect(body.data.administrativo).toBeNull();
    expect(body.data.advertenciaAdministrativo).toContain('director');

    const sedeParcial = await prisma.sede.findUnique({
      where: { id: body.data.sede.id },
    });
    expect(sedeParcial).not.toBeNull();

    const director = await prisma.usuario.findUnique({
      where: { id: body.data.director.usuario.id },
    });
    expect(director).not.toBeNull();
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
    /**
     * Este `describe` prueba las reglas de `DELETE /sedes/:id` en función de
     * qué tan "vacía" está la sede — necesita poder producir una sede
     * REALMENTE vacía (0 dependientes), pero desde el 2026-09-11
     * `POST /sedes` siempre crea 2 fundadores `ADMINISTRATIVO` junto con la
     * sede (ver `SedesService.crearConFundadores`). Se borran los 2
     * fundadores inmediatamente después de crearlos para restaurar el
     * escenario "sede vacía" que este bloque necesita — los tests que
     * agregan su propio dato asociado (alumno/maestro/carrera) siguen
     * bloqueando el DELETE igual, sin importar si los fundadores están o no.
     */
    async function crearSedeDePrueba(nombre: string): Promise<string> {
      mockCreateUserExitoso();
      const res = await request(app.getHttpServer())
        .post('/sedes')
        .set('Authorization', `Bearer ${token}`)
        .send(bodySedeConFundadores(nombre));
      const body = res.body as {
        data: {
          sede: { id: string };
          director: { usuario: { id: string } };
          administrativo: { usuario: { id: string } } | null;
        };
      };
      const idsFundadores = [
        body.data.director.usuario.id,
        body.data.administrativo?.usuario.id,
      ].filter((id): id is string => Boolean(id));
      await prisma.usuario.deleteMany({ where: { id: { in: idsFundadores } } });
      return body.data.sede.id;
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

  describe('GET /platform-admin/resumen', () => {
    interface ResumenBody {
      data: {
        totalSedes: number;
        totalAlumnosActivos: number;
        totalMaestrosActivos: number;
        totalAdministrativosActivos: number;
        alumnosPorSede: { sedeId: string; nombre: string; cantidad: number }[];
      };
    }

    async function crearSedeDePrueba(nombre: string): Promise<string> {
      mockCreateUserExitoso();
      const res = await request(app.getHttpServer())
        .post('/sedes')
        .set('Authorization', `Bearer ${token}`)
        .send(bodySedeConFundadores(nombre));
      return (res.body as SedeConFundadoresBody).data.sede.id;
    }

    it('devuelve conteos globales correctos cruzando 2 sedes distintas', async () => {
      const sedeAId = await crearSedeDePrueba(
        `Sede E2E Resumen A ${Date.now()}`,
      );
      const sedeBId = await crearSedeDePrueba(
        `Sede E2E Resumen B ${Date.now()}`,
      );

      const usuariosCreados = await Promise.all([
        prisma.usuario.create({
          data: {
            id: randomUUID(),
            email: `fixture.resumen.${randomUUID()}@example.com`,
            rol: RolUsuario.ALUMNO,
            sedeId: sedeAId,
            activo: true,
          },
        }),
        prisma.usuario.create({
          data: {
            id: randomUUID(),
            email: `fixture.resumen.${randomUUID()}@example.com`,
            rol: RolUsuario.ALUMNO,
            sedeId: sedeAId,
            activo: true,
          },
        }),
        prisma.usuario.create({
          data: {
            id: randomUUID(),
            email: `fixture.resumen.${randomUUID()}@example.com`,
            rol: RolUsuario.ALUMNO,
            sedeId: sedeBId,
            activo: true,
          },
        }),
        // Alumno inactivo — no debe contar.
        prisma.usuario.create({
          data: {
            id: randomUUID(),
            email: `fixture.resumen.${randomUUID()}@example.com`,
            rol: RolUsuario.ALUMNO,
            sedeId: sedeBId,
            activo: false,
          },
        }),
        prisma.usuario.create({
          data: {
            id: randomUUID(),
            email: `fixture.resumen.${randomUUID()}@example.com`,
            rol: RolUsuario.MAESTRO,
            sedeId: sedeAId,
            activo: true,
          },
        }),
        prisma.usuario.create({
          data: {
            id: randomUUID(),
            email: `fixture.resumen.${randomUUID()}@example.com`,
            rol: RolUsuario.ADMINISTRATIVO,
            sedeId: sedeBId,
            activo: true,
          },
        }),
      ]);

      const totalSedesAntes = await prisma.sede.count();

      const res = await request(app.getHttpServer())
        .get('/platform-admin/resumen')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const data = (res.body as ResumenBody).data;
      expect(data.totalSedes).toBe(totalSedesAntes);
      expect(data.totalAlumnosActivos).toBeGreaterThanOrEqual(3);
      expect(data.totalMaestrosActivos).toBeGreaterThanOrEqual(1);
      expect(data.totalAdministrativosActivos).toBeGreaterThanOrEqual(1);

      const filaSedeA = data.alumnosPorSede.find((f) => f.sedeId === sedeAId);
      const filaSedeB = data.alumnosPorSede.find((f) => f.sedeId === sedeBId);
      expect(filaSedeA?.cantidad).toBe(2);
      expect(filaSedeB?.cantidad).toBe(1);

      await prisma.usuario.deleteMany({
        where: { id: { in: usuariosCreados.map((u) => u.id) } },
      });
    });

    it('sin JWT de plataforma válido -> 401 UNAUTHORIZED', async () => {
      const res = await request(app.getHttpServer()).get(
        '/platform-admin/resumen',
      );

      expect(res.status).toBe(401);
      expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
    });
  });
});
