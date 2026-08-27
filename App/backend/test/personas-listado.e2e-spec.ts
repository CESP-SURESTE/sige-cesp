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

interface AlumnoListItem {
  usuarioId: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  matricula: string;
  carrera: { id: string; nombre: string };
  estatusAcademico: string;
  semestreActual: number;
  activo: boolean;
}

interface MaestroListItem {
  usuarioId: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  cedulaProfesional: string | null;
  estatus: string;
  activo: boolean;
}

interface AdministrativoListItem {
  usuarioId: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  puesto: string;
  nivelPermiso: string;
  estatus: string;
  activo: boolean;
}

interface ListadoBody<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
}

/**
 * Test de integración — Fase 5, Día 19 (`GET /personas`).
 *
 * "Listados PARA administrativos" (de ALUMNO/MAESTRO, no de ADMINISTRATIVO
 * mismos, ver encargo del día). Contra la app real (`AppModule` completo,
 * `PrismaService` conectado a la DB real de Supabase) — mismo criterio que
 * `test/carreras.e2e-spec.ts`/`test/perfil.e2e-spec.ts`: ruta de solo
 * lectura contra Postgres, no hace falta mockear Supabase Auth, solo el
 * JWKS de prueba (`SEDE_GUARD_ENV_OVERRIDE`).
 *
 * `prisma/seed.ts` no siembra ningún `MAESTRO` (Fase 4 solo cubrió alumno y
 * administrativo, ver `test/perfil.e2e-spec.ts`) — se crean fixtures propios
 * directo por Prisma, mismo patrón ya establecido en el resto del proyecto.
 * Cada fixture usa un `marker` único (`randomUUID().slice(0, 8)`) embebido
 * en `nombres`/`cedulaProfesional` para que las aserciones de `buscar` y
 * `total` sean exactas sin importar cuántas otras filas ya existan en la
 * sede por corridas previas de OTROS specs (este archivo SÍ limpia sus
 * propios fixtures en `afterAll` desde 2026-08-25 — corrección real, antes
 * no lo hacía, ver `usuarioIdsCreados` abajo y `documentacion_de_agentes/
 * ESTADO.md`; `test/personas.e2e-spec.ts` tiene el mismo mecanismo).
 */
describe('PersonasController — GET /personas (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let sedeValladolidId: string;
  let carreraMeridaId: string;
  let adminMeridaId: string;
  let adminValladolidId: string;
  let alumnoMeridaId: string;
  let alumnoValladolidId: string;
  let alumnoValladolidMatricula: string;
  let markerMerida: string;
  let markerValladolid: string;
  let markerAdminMerida: string;
  let markerAdminValladolid: string;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';

  // Cleanup real (corrección 2026-08-25 — este spec acumulaba usuarios de
  // prueba reales sin límite en la DB de dev, ver `documentacion_de_agentes/
  // ESTADO.md`). Cada `usuarioId` real creado directo por `prisma.usuario
  // .create()` en este archivo (fixtures MAESTRO/ADMINISTRATIVO, tanto los
  // del `beforeAll` como los del describe de `GET /personas/resumen`) se
  // agrega aquí; `afterAll` los borra al final. NUNCA incluye a los actores
  // REALES del seed (`ana.canul`, `jorge.ek`, `luis.chan`,
  // `mariajose.pech`) — esos no los crea este archivo, solo los consulta.
  const usuarioIdsCreados: string[] = [];

  async function firmarToken(
    sub: string,
    rol: RolUsuario,
    sedeId: string,
  ): Promise<string> {
    return new jose.SignJWT({
      role: 'authenticated',
      sede_id: sedeId,
      rol,
    })
      .setProtectedHeader({ alg, kid })
      .setSubject(sub)
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

    const adminMerida = await prisma.usuario.findUniqueOrThrow({
      where: { email: 'ana.canul@cesp-merida.edu.mx' },
    });
    adminMeridaId = adminMerida.id;
    const adminValladolid = await prisma.usuario.findUniqueOrThrow({
      where: { email: 'jorge.ek@cesp-valladolid.edu.mx' },
    });
    adminValladolidId = adminValladolid.id;

    const alumnoMerida = await prisma.usuario.findUniqueOrThrow({
      where: { email: 'luis.chan@cesp-merida.edu.mx' },
    });
    alumnoMeridaId = alumnoMerida.id;

    // Ancla de Día 25 (aislamiento cruzado) — alumno REAL de Valladolid
    // (`prisma/seed.ts`), usado para probar que `GET /personas?rol=ALUMNO`
    // nunca lo devuelve a un admin de Mérida, ni siquiera con un `buscar`
    // genérico que calza con su nombre.
    const alumnoValladolid = await prisma.usuario.findUniqueOrThrow({
      where: { email: 'mariajose.pech@cesp-valladolid.edu.mx' },
      include: { perfilAlumno: { select: { matricula: true } } },
    });
    alumnoValladolidId = alumnoValladolid.id;
    alumnoValladolidMatricula = alumnoValladolid.perfilAlumno!.matricula;

    // --- Fixtures MAESTRO en Mérida (búsqueda/estatus/paginación) ---
    markerMerida = `QA19MID${randomUUID().slice(0, 8)}`;

    async function crearMaestroFixture(params: {
      sedeId: string;
      apellidoPaterno: string;
      nombres: string;
      estatus: EstatusEmpleado;
      cedulaProfesional?: string;
    }) {
      const usuario = await prisma.usuario.create({
        data: {
          id: randomUUID(),
          email: `fixture.listado.${randomUUID()}@example.com`,
          rol: RolUsuario.MAESTRO,
          sedeId: params.sedeId,
        },
      });
      await prisma.perfilMaestro.create({
        data: {
          usuarioId: usuario.id,
          nombres: params.nombres,
          apellidoPaterno: params.apellidoPaterno,
          curp: `FX${randomUUID().slice(0, 16).toUpperCase()}`,
          cedulaProfesional: params.cedulaProfesional,
          correoPersonal: `fixture.listado.personal.${randomUUID()}@example.com`,
          telefono: '9990009999',
          fechaContratacion: new Date('2024-01-01'),
          estatus: params.estatus,
        },
      });
      usuarioIdsCreados.push(usuario.id);
      return usuario.id;
    }

    // 3 maestros con el mismo marker en `nombres`, apellidoPaterno distinto
    // (orden esperado ascendente: Aaron, Beltran, Castro) y estatus variado.
    await crearMaestroFixture({
      sedeId: sedeMeridaId,
      apellidoPaterno: 'Aaron',
      nombres: `Fixture ${markerMerida}`,
      estatus: EstatusEmpleado.ACTIVO,
    });
    await crearMaestroFixture({
      sedeId: sedeMeridaId,
      apellidoPaterno: 'Beltran',
      nombres: `Fixture ${markerMerida}`,
      estatus: EstatusEmpleado.BAJA,
    });
    await crearMaestroFixture({
      sedeId: sedeMeridaId,
      apellidoPaterno: 'Castro',
      nombres: `Fixture ${markerMerida}`,
      estatus: EstatusEmpleado.LICENCIA,
    });
    // Maestro con la cédula marcada, para probar la búsqueda por
    // `cedulaProfesional` (nombre/apellido sin relación con el marker).
    await crearMaestroFixture({
      sedeId: sedeMeridaId,
      apellidoPaterno: 'Zeta',
      nombres: 'Sin relación con el marker',
      estatus: EstatusEmpleado.ACTIVO,
      cedulaProfesional: `CED-${markerMerida}`,
    });

    // --- Fixture MAESTRO en Valladolid (aislamiento por sede) ---
    markerValladolid = `QA19VLD${randomUUID().slice(0, 8)}`;
    await crearMaestroFixture({
      sedeId: sedeValladolidId,
      apellidoPaterno: 'Uno',
      nombres: `Fixture ${markerValladolid}`,
      estatus: EstatusEmpleado.ACTIVO,
    });

    // --- Fixtures ADMINISTRATIVO en Mérida (búsqueda/estatus/paginación) ---
    // Fase 10 (unificación CRUD admin) — mismo patrón de fixtures que
    // MAESTRO arriba, sin un campo tipo `cedulaProfesional`
    // (`PerfilAdministrativo` no tiene un identificador externo
    // equivalente, `buscar` solo cubre nombres/apellidos acá).
    markerAdminMerida = `QA28MID${randomUUID().slice(0, 8)}`;

    async function crearAdministrativoFixture(params: {
      sedeId: string;
      apellidoPaterno: string;
      nombres: string;
      estatus: EstatusEmpleado;
      nivelPermiso?: NivelPermiso;
    }) {
      const usuario = await prisma.usuario.create({
        data: {
          id: randomUUID(),
          email: `fixture.listado.admin.${randomUUID()}@example.com`,
          rol: RolUsuario.ADMINISTRATIVO,
          sedeId: params.sedeId,
        },
      });
      await prisma.perfilAdministrativo.create({
        data: {
          usuarioId: usuario.id,
          nombres: params.nombres,
          apellidoPaterno: params.apellidoPaterno,
          curp: `FX${randomUUID().slice(0, 16).toUpperCase()}`,
          correoPersonal: `fixture.listado.admin.personal.${randomUUID()}@example.com`,
          telefono: '9990009999',
          fechaContratacion: new Date('2024-01-01'),
          estatus: params.estatus,
          puesto: PuestoAdministrativo.AUXILIAR,
          nivelPermiso: params.nivelPermiso ?? NivelPermiso.AUXILIAR,
        },
      });
      usuarioIdsCreados.push(usuario.id);
      return usuario.id;
    }

    // 3 administrativos con el mismo marker en `nombres`, apellidoPaterno
    // distinto (orden esperado ascendente: Aaron, Beltran, Castro) y estatus
    // variado.
    await crearAdministrativoFixture({
      sedeId: sedeMeridaId,
      apellidoPaterno: 'Aaron',
      nombres: `Fixture ${markerAdminMerida}`,
      estatus: EstatusEmpleado.ACTIVO,
    });
    await crearAdministrativoFixture({
      sedeId: sedeMeridaId,
      apellidoPaterno: 'Beltran',
      nombres: `Fixture ${markerAdminMerida}`,
      estatus: EstatusEmpleado.BAJA,
    });
    await crearAdministrativoFixture({
      sedeId: sedeMeridaId,
      apellidoPaterno: 'Castro',
      nombres: `Fixture ${markerAdminMerida}`,
      estatus: EstatusEmpleado.LICENCIA,
    });

    // --- Fixture ADMINISTRATIVO en Valladolid (aislamiento por sede) ---
    markerAdminValladolid = `QA28VLD${randomUUID().slice(0, 8)}`;
    await crearAdministrativoFixture({
      sedeId: sedeValladolidId,
      apellidoPaterno: 'Uno',
      nombres: `Fixture ${markerAdminValladolid}`,
      estatus: EstatusEmpleado.ACTIVO,
    });
    // Timeout explícito (default de Jest, 5000 ms, no alcanza) — este
    // `beforeAll` hace más round-trips de DB que el resto de los specs de
    // este dominio (5 lookups + 9 fixtures entre MAESTRO/ADMINISTRATIVO,
    // cada una con su propio `Usuario` + perfil), sobre la DB real de
    // Supabase.
  }, 30000);

  afterAll(async () => {
    if (usuarioIdsCreados.length > 0) {
      await prisma.registroAuditoria.deleteMany({
        where: { usuarioId: { in: usuarioIdsCreados } },
      });
      await prisma.usuario.deleteMany({
        where: { id: { in: usuarioIdsCreados } },
      });
    }
    await app.close();
  });

  it('rol=ALUMNO -> 200, solo alumnos (seed real, luis.chan) con el shape esperado', async () => {
    // `buscar` por matrícula exacta — aísla el resultado de cualquier otro
    // alumno acumulado en la sede por corridas previas de este u otros specs
    // (fixtures de este archivo sí se limpian en `afterAll`, pero fixtures
    // de OTROS specs que también siembren alumnos en Mérida podrían seguir
    // presentes).
    const res = await request(app.getHttpServer())
      .get('/personas')
      .query({ rol: 'ALUMNO', buscar: 'MID-2026-0001' })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(200);
    const body = res.body as ListadoBody<AlumnoListItem>;
    const luis = body.data.find((a) => a.matricula === 'MID-2026-0001');
    expect(luis).toBeDefined();
    expect(luis?.nombres).toBe('Luis Fernando');
    expect(luis?.apellidoPaterno).toBe('Chan');
    expect(luis?.carrera).toEqual({
      id: carreraMeridaId,
      nombre: 'Licenciatura en Administración',
    });
    expect(luis?.estatusAcademico).toBe('INSCRITO');
    expect(luis?.semestreActual).toBe(1);
    expect(luis?.activo).toBe(true);
    expect(Object.keys(luis!).sort()).toEqual(
      [
        'usuarioId',
        'nombres',
        'apellidoPaterno',
        'apellidoMaterno',
        'matricula',
        'carrera',
        'estatusAcademico',
        'semestreActual',
        'activo',
      ].sort(),
    );
  });

  it('rol=MAESTRO -> 200, solo trae los maestros del marker (búsqueda + orden alfabético apellidoPaterno asc)', async () => {
    // `buscar` matchea `markerMerida` tanto en `nombres` (3 fixtures) como
    // en `cedulaProfesional` del fixture `Zeta` (`CED-${markerMerida}`) —
    // comportamiento esperado, `buscar` cubre `cedulaProfesional` para
    // rol=MAESTRO (ver contrato del endpoint), por eso el total es 4.
    const res = await request(app.getHttpServer())
      .get('/personas')
      .query({ rol: 'MAESTRO', buscar: markerMerida, limit: 100 })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(200);
    const body = res.body as ListadoBody<MaestroListItem>;
    expect(body.total).toBe(4);
    expect(body.data.map((m) => m.apellidoPaterno)).toEqual([
      'Aaron',
      'Beltran',
      'Castro',
      'Zeta',
    ]);
    expect(body.data.map((m) => m.estatus)).toEqual([
      'ACTIVO',
      'BAJA',
      'LICENCIA',
      'ACTIVO',
    ]);
    for (const maestro of body.data) {
      expect(Object.keys(maestro).sort()).toEqual(
        [
          'usuarioId',
          'nombres',
          'apellidoPaterno',
          'apellidoMaterno',
          'cedulaProfesional',
          'estatus',
          'activo',
        ].sort(),
      );
    }
  });

  it('buscar por cedulaProfesional (rol=MAESTRO) -> 200, encuentra el fixture correcto', async () => {
    const res = await request(app.getHttpServer())
      .get('/personas')
      .query({ rol: 'MAESTRO', buscar: `CED-${markerMerida}` })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(200);
    const body = res.body as ListadoBody<MaestroListItem>;
    expect(body.total).toBe(1);
    expect(body.data[0].apellidoPaterno).toBe('Zeta');
    expect(body.data[0].cedulaProfesional).toBe(`CED-${markerMerida}`);
  });

  it('filtro estatus válido (rol=MAESTRO) -> 200, solo el maestro con ese estatus', async () => {
    const res = await request(app.getHttpServer())
      .get('/personas')
      .query({ rol: 'MAESTRO', buscar: markerMerida, estatus: 'BAJA' })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(200);
    const body = res.body as ListadoBody<MaestroListItem>;
    expect(body.total).toBe(1);
    expect(body.data[0].apellidoPaterno).toBe('Beltran');
  });

  it('estatus inválido para rol=MAESTRO (valor de EstatusAcademico, no de EstatusEmpleado) -> 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .get('/personas')
      .query({ rol: 'MAESTRO', estatus: 'INSCRITO' })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('estatus inválido para rol=ALUMNO (valor de EstatusEmpleado, no de EstatusAcademico) -> 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .get('/personas')
      .query({ rol: 'ALUMNO', estatus: 'ACTIVO' })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('paginación (rol=MAESTRO, limit=2) -> page 1 y page 2 correctas, mismo total', async () => {
    const resPagina1 = await request(app.getHttpServer())
      .get('/personas')
      .query({ rol: 'MAESTRO', buscar: markerMerida, page: 1, limit: 2 })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(resPagina1.status).toBe(200);
    const body1 = resPagina1.body as ListadoBody<MaestroListItem>;
    expect(body1.page).toBe(1);
    expect(body1.limit).toBe(2);
    // `total` = 4 — `markerMerida` matchea 3 fixtures por `nombres` + el
    // fixture `Zeta` por `cedulaProfesional`, ver test anterior.
    expect(body1.total).toBe(4);
    expect(body1.data.map((m) => m.apellidoPaterno)).toEqual([
      'Aaron',
      'Beltran',
    ]);

    const resPagina2 = await request(app.getHttpServer())
      .get('/personas')
      .query({ rol: 'MAESTRO', buscar: markerMerida, page: 2, limit: 2 })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(resPagina2.status).toBe(200);
    const body2 = resPagina2.body as ListadoBody<MaestroListItem>;
    expect(body2.page).toBe(2);
    expect(body2.total).toBe(4);
    expect(body2.data.map((m) => m.apellidoPaterno)).toEqual([
      'Castro',
      'Zeta',
    ]);
  });

  it('limit fuera de rango (101) -> 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .get('/personas')
      .query({ rol: 'MAESTRO', limit: 101 })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('page fuera de rango (0) -> 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .get('/personas')
      .query({ rol: 'MAESTRO', page: 0 })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('rol ausente -> 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .get('/personas')
      .set(
        'Authorization',
        `Bearer ${await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('rol=ADMINISTRATIVO -> 200, solo trae los administrativos del marker (búsqueda + orden alfabético apellidoPaterno asc)', async () => {
    const res = await request(app.getHttpServer())
      .get('/personas')
      .query({ rol: 'ADMINISTRATIVO', buscar: markerAdminMerida, limit: 100 })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(200);
    const body = res.body as ListadoBody<AdministrativoListItem>;
    expect(body.total).toBe(3);
    expect(body.data.map((a) => a.apellidoPaterno)).toEqual([
      'Aaron',
      'Beltran',
      'Castro',
    ]);
    expect(body.data.map((a) => a.estatus)).toEqual([
      'ACTIVO',
      'BAJA',
      'LICENCIA',
    ]);
    for (const administrativo of body.data) {
      expect(Object.keys(administrativo).sort()).toEqual(
        [
          'usuarioId',
          'nombres',
          'apellidoPaterno',
          'apellidoMaterno',
          'puesto',
          'nivelPermiso',
          'estatus',
          'tipoLicencia',
          'activo',
        ].sort(),
      );
    }
  });

  it('filtro estatus válido (rol=ADMINISTRATIVO) -> 200, solo el administrativo con ese estatus', async () => {
    const res = await request(app.getHttpServer())
      .get('/personas')
      .query({
        rol: 'ADMINISTRATIVO',
        buscar: markerAdminMerida,
        estatus: 'BAJA',
      })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(200);
    const body = res.body as ListadoBody<AdministrativoListItem>;
    expect(body.total).toBe(1);
    expect(body.data[0].apellidoPaterno).toBe('Beltran');
  });

  it('estatus inválido para rol=ADMINISTRATIVO (valor de EstatusAcademico, no de EstatusEmpleado) -> 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .get('/personas')
      .query({ rol: 'ADMINISTRATIVO', estatus: 'INSCRITO' })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('paginación (rol=ADMINISTRATIVO, limit=2) -> page 1 y page 2 correctas, mismo total', async () => {
    const resPagina1 = await request(app.getHttpServer())
      .get('/personas')
      .query({
        rol: 'ADMINISTRATIVO',
        buscar: markerAdminMerida,
        page: 1,
        limit: 2,
      })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(resPagina1.status).toBe(200);
    const body1 = resPagina1.body as ListadoBody<AdministrativoListItem>;
    expect(body1.page).toBe(1);
    expect(body1.limit).toBe(2);
    expect(body1.total).toBe(3);
    expect(body1.data.map((a) => a.apellidoPaterno)).toEqual([
      'Aaron',
      'Beltran',
    ]);

    const resPagina2 = await request(app.getHttpServer())
      .get('/personas')
      .query({
        rol: 'ADMINISTRATIVO',
        buscar: markerAdminMerida,
        page: 2,
        limit: 2,
      })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(resPagina2.status).toBe(200);
    const body2 = resPagina2.body as ListadoBody<AdministrativoListItem>;
    expect(body2.page).toBe(2);
    expect(body2.total).toBe(3);
    expect(body2.data.map((a) => a.apellidoPaterno)).toEqual(['Castro']);
  });

  it('aislamiento por sede (rol=ADMINISTRATIVO) -> admin de Valladolid no ve los fixtures sembrados en Mérida', async () => {
    const res = await request(app.getHttpServer())
      .get('/personas')
      .query({ rol: 'ADMINISTRATIVO', buscar: markerAdminMerida })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(adminValladolidId, RolUsuario.ADMINISTRATIVO, sedeValladolidId)}`,
      );

    expect(res.status).toBe(200);
    const body = res.body as ListadoBody<AdministrativoListItem>;
    expect(body.total).toBe(0);
  });

  it('aislamiento por sede (rol=ADMINISTRATIVO) -> admin de Mérida no ve el fixture sembrado en Valladolid', async () => {
    const res = await request(app.getHttpServer())
      .get('/personas')
      .query({ rol: 'ADMINISTRATIVO', buscar: markerAdminValladolid })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(200);
    const body = res.body as ListadoBody<AdministrativoListItem>;
    expect(body.total).toBe(0);
  });

  it('aislamiento por sede (rol=ADMINISTRATIVO) -> admin de Valladolid SÍ ve su propio fixture (confirma el filtro, no solo la ausencia)', async () => {
    const res = await request(app.getHttpServer())
      .get('/personas')
      .query({ rol: 'ADMINISTRATIVO', buscar: markerAdminValladolid })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(adminValladolidId, RolUsuario.ADMINISTRATIVO, sedeValladolidId)}`,
      );

    expect(res.status).toBe(200);
    const body = res.body as ListadoBody<AdministrativoListItem>;
    expect(body.total).toBe(1);
    expect(body.data[0].apellidoPaterno).toBe('Uno');
  });

  it('aislamiento por sede -> admin de Valladolid no ve los fixtures sembrados en Mérida', async () => {
    const res = await request(app.getHttpServer())
      .get('/personas')
      .query({ rol: 'MAESTRO', buscar: markerMerida })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(adminValladolidId, RolUsuario.ADMINISTRATIVO, sedeValladolidId)}`,
      );

    expect(res.status).toBe(200);
    const body = res.body as ListadoBody<MaestroListItem>;
    expect(body.total).toBe(0);
    expect(body.data).toHaveLength(0);
  });

  it('aislamiento por sede -> admin de Mérida no ve el fixture sembrado en Valladolid', async () => {
    const res = await request(app.getHttpServer())
      .get('/personas')
      .query({ rol: 'MAESTRO', buscar: markerValladolid })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(200);
    const body = res.body as ListadoBody<MaestroListItem>;
    expect(body.total).toBe(0);
  });

  it('aislamiento por sede -> admin de Valladolid SÍ ve su propio fixture (confirma el filtro, no solo la ausencia)', async () => {
    const res = await request(app.getHttpServer())
      .get('/personas')
      .query({ rol: 'MAESTRO', buscar: markerValladolid })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(adminValladolidId, RolUsuario.ADMINISTRATIVO, sedeValladolidId)}`,
      );

    expect(res.status).toBe(200);
    const body = res.body as ListadoBody<MaestroListItem>;
    expect(body.total).toBe(1);
    expect(body.data[0].apellidoPaterno).toBe('Uno');
  });

  it('aislamiento por sede (Día 25, rol=ALUMNO) -> admin de Mérida no ve un alumno REAL de Valladolid, ni con un buscar genérico que calza con su nombre', async () => {
    // `buscar: 'a'` es a propósito un término genérico que calza con
    // "María José Pech Tun" (y con prácticamente cualquier otro nombre real
    // sembrado) — si el filtro de sede fallara, este alumno de Valladolid
    // aparecería en la lista de un admin de Mérida solo por la coincidencia
    // de texto. `limit: 100` para no depender del orden/paginación.
    const res = await request(app.getHttpServer())
      .get('/personas')
      .query({ rol: 'ALUMNO', buscar: 'a', limit: 100 })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(200);
    const body = res.body as ListadoBody<AlumnoListItem>;
    expect(body.data.some((a) => a.usuarioId === alumnoValladolidId)).toBe(
      false,
    );
    expect(
      body.data.some((a) => a.matricula === alumnoValladolidMatricula),
    ).toBe(false);
  });

  it('aislamiento por sede (Día 25, rol=ALUMNO) -> admin de Valladolid SÍ ve su propio alumno con el mismo buscar genérico (confirma el filtro, no solo la ausencia)', async () => {
    const res = await request(app.getHttpServer())
      .get('/personas')
      .query({ rol: 'ALUMNO', buscar: 'a', limit: 100 })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(adminValladolidId, RolUsuario.ADMINISTRATIVO, sedeValladolidId)}`,
      );

    expect(res.status).toBe(200);
    const body = res.body as ListadoBody<AlumnoListItem>;
    expect(body.data.some((a) => a.usuarioId === alumnoValladolidId)).toBe(
      true,
    );
  });

  it('rol distinto de ADMINISTRATIVO (ALUMNO real, luis.chan) -> 403 ROL_NO_AUTORIZADO', async () => {
    const res = await request(app.getHttpServer())
      .get('/personas')
      .query({ rol: 'ALUMNO' })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(alumnoMeridaId, RolUsuario.ALUMNO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });

  it('sin Authorization -> 401 UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer())
      .get('/personas')
      .query({ rol: 'ALUMNO' });

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
  });

  /**
   * `GET /personas/resumen` — dashboard de admin por sede.
   *
   * Reutiliza el mismo `beforeAll` (sedes/carreras/admins/fixtures de este
   * archivo) — no siembra fixtures propios de ALUMNO/ADMINISTRATIVO nuevos
   * porque el seed real (`prisma/seed.ts`) ya tiene alumnos/administrativos
   * en Mérida (`luis.chan`/`ana.canul`, usados arriba); los conteos de este
   * describe se comparan contra lo que el propio endpoint reporta al inicio
   * de esta suite en vez de contra números fijos, para no quedar frágiles
   * ante fixtures de OTROS specs que no limpian los suyos — solo se valida
   * que agregar un maestro nuevo en Mérida SUMA exactamente 1 al conteo
   * previo. Los fixtures que este describe crea (`nuevoUsuario`/`maestro`
   * abajo) sí se limpian en el `afterAll` de este archivo (2026-08-25).
   */
  describe('GET /personas/resumen', () => {
    interface ResumenBody {
      data: {
        totalAlumnosActivos: number;
        totalMaestrosActivos: number;
        totalAdministrativosActivos: number;
        totalCarreras: number;
        alumnosPorCarrera: {
          carreraId: string;
          nombre: string;
          cantidad: number;
        }[];
        altasRecientes: {
          usuarioId: string;
          nombreCompleto: string;
          rol: RolUsuario;
          fecha: string;
        }[];
      };
    }

    it('devuelve los conteos correctos — un maestro nuevo suma 1 al total de maestros activos de la sede', async () => {
      const antes = await request(app.getHttpServer())
        .get('/personas/resumen')
        .set(
          'Authorization',
          `Bearer ${await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
        );
      expect(antes.status).toBe(200);
      const totalMaestrosAntes = (antes.body as ResumenBody).data
        .totalMaestrosActivos;

      const nuevoUsuario = await prisma.usuario.create({
        data: {
          id: randomUUID(),
          email: `fixture.resumen.${randomUUID()}@example.com`,
          rol: RolUsuario.MAESTRO,
          sedeId: sedeMeridaId,
        },
      });
      usuarioIdsCreados.push(nuevoUsuario.id);
      const marcaNueva = `QARESUMEN${randomUUID().slice(0, 8)}`;
      await prisma.perfilMaestro.create({
        data: {
          usuarioId: nuevoUsuario.id,
          nombres: `Fixture ${marcaNueva}`,
          apellidoPaterno: 'Resumen',
          curp: `FX${randomUUID().slice(0, 16).toUpperCase()}`,
          correoPersonal: `fixture.resumen.personal.${randomUUID()}@example.com`,
          telefono: '9990009999',
          fechaContratacion: new Date('2024-01-01'),
          estatus: EstatusEmpleado.ACTIVO,
        },
      });

      const despues = await request(app.getHttpServer())
        .get('/personas/resumen')
        .set(
          'Authorization',
          `Bearer ${await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
        );

      expect(despues.status).toBe(200);
      const body = (despues.body as ResumenBody).data;
      expect(body.totalMaestrosActivos).toBe(totalMaestrosAntes + 1);
      expect(body.totalCarreras).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(body.alumnosPorCarrera)).toBe(true);
      expect(body.alumnosPorCarrera.length).toBeLessThanOrEqual(5);
      expect(Array.isArray(body.altasRecientes)).toBe(true);
      expect(body.altasRecientes.length).toBeLessThanOrEqual(5);
      // El maestro recién creado es el alta más reciente de la sede — debe
      // aparecer primero en `altasRecientes` (orden desc por `createdAt`).
      const primeraAlta = body.altasRecientes[0];
      expect(typeof primeraAlta.fecha).toBe('string');
      expect({ ...primeraAlta, fecha: undefined }).toEqual({
        usuarioId: nuevoUsuario.id,
        nombreCompleto: `Fixture ${marcaNueva} Resumen`,
        rol: 'MAESTRO',
        fecha: undefined,
      });
    });

    it('aislamiento por sede -> no cuenta datos de otra sede (Valladolid ve sus propios totales, no los de Mérida)', async () => {
      const resMerida = await request(app.getHttpServer())
        .get('/personas/resumen')
        .set(
          'Authorization',
          `Bearer ${await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
        );
      const resValladolid = await request(app.getHttpServer())
        .get('/personas/resumen')
        .set(
          'Authorization',
          `Bearer ${await firmarToken(adminValladolidId, RolUsuario.ADMINISTRATIVO, sedeValladolidId)}`,
        );

      expect(resMerida.status).toBe(200);
      expect(resValladolid.status).toBe(200);
      const bodyMerida = (resMerida.body as ResumenBody).data;
      const bodyValladolid = (resValladolid.body as ResumenBody).data;

      // Mérida tiene fixtures de sobra (este describe + el resto del
      // archivo) — Valladolid solo tiene 1 fixture de maestro sembrado
      // arriba, así que sus totales deben ser estrictamente menores.
      expect(bodyValladolid.totalMaestrosActivos).toBeLessThan(
        bodyMerida.totalMaestrosActivos,
      );
      // Ningún alta reciente de Valladolid debe coincidir con un
      // `usuarioId` de las altas recientes de Mérida.
      const idsMerida = new Set(
        bodyMerida.altasRecientes.map((a) => a.usuarioId),
      );
      for (const alta of bodyValladolid.altasRecientes) {
        expect(idsMerida.has(alta.usuarioId)).toBe(false);
      }
    });

    it('aislamiento por sede (Día 25) -> los 3 totales de cada sede coinciden EXACTO con un count directo por sede en DB', async () => {
      const [resMerida, resValladolid] = await Promise.all([
        request(app.getHttpServer())
          .get('/personas/resumen')
          .set(
            'Authorization',
            `Bearer ${await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
          ),
        request(app.getHttpServer())
          .get('/personas/resumen')
          .set(
            'Authorization',
            `Bearer ${await firmarToken(adminValladolidId, RolUsuario.ADMINISTRATIVO, sedeValladolidId)}`,
          ),
      ]);

      expect(resMerida.status).toBe(200);
      expect(resValladolid.status).toBe(200);
      const bodyMerida = (resMerida.body as ResumenBody).data;
      const bodyValladolid = (resValladolid.body as ResumenBody).data;

      const contarPorSedeYRol = (sedeId: string, rol: RolUsuario) =>
        prisma.usuario.count({ where: { sedeId, rol, activo: true } });

      const [
        alumnosMeridaDirecto,
        maestrosMeridaDirecto,
        administrativosMeridaDirecto,
        alumnosValladolidDirecto,
        maestrosValladolidDirecto,
        administrativosValladolidDirecto,
      ] = await Promise.all([
        contarPorSedeYRol(sedeMeridaId, RolUsuario.ALUMNO),
        contarPorSedeYRol(sedeMeridaId, RolUsuario.MAESTRO),
        contarPorSedeYRol(sedeMeridaId, RolUsuario.ADMINISTRATIVO),
        contarPorSedeYRol(sedeValladolidId, RolUsuario.ALUMNO),
        contarPorSedeYRol(sedeValladolidId, RolUsuario.MAESTRO),
        contarPorSedeYRol(sedeValladolidId, RolUsuario.ADMINISTRATIVO),
      ]);

      expect(bodyMerida.totalAlumnosActivos).toBe(alumnosMeridaDirecto);
      expect(bodyMerida.totalMaestrosActivos).toBe(maestrosMeridaDirecto);
      expect(bodyMerida.totalAdministrativosActivos).toBe(
        administrativosMeridaDirecto,
      );
      expect(bodyValladolid.totalAlumnosActivos).toBe(alumnosValladolidDirecto);
      expect(bodyValladolid.totalMaestrosActivos).toBe(
        maestrosValladolidDirecto,
      );
      expect(bodyValladolid.totalAdministrativosActivos).toBe(
        administrativosValladolidDirecto,
      );

      // Confirma que las 2 sedes tienen datos reales (no ambas en 0, lo que
      // haría la comparación de arriba trivial/sin valor). No se compara
      // que los totales sean DISTINTOS entre sedes a propósito — en una DB
      // recién sembrada (antes de que otros specs de este dominio agreguen
      // fixtures propios que tampoco tocan este archivo) ambas sedes parten
      // con el mismo número de alumnos reales de `seed.ts` (8 y 8), así que
      // esa igualdad sería un falso negativo, no un bug.
      expect(alumnosMeridaDirecto).toBeGreaterThan(0);
      expect(alumnosValladolidDirecto).toBeGreaterThan(0);
    });

    it('rol MAESTRO (no ADMINISTRATIVO) -> 403 ROL_NO_AUTORIZADO', async () => {
      const maestro = await prisma.usuario.create({
        data: {
          id: randomUUID(),
          email: `fixture.resumen.maestro.${randomUUID()}@example.com`,
          rol: RolUsuario.MAESTRO,
          sedeId: sedeMeridaId,
        },
      });
      usuarioIdsCreados.push(maestro.id);

      const res = await request(app.getHttpServer())
        .get('/personas/resumen')
        .set(
          'Authorization',
          `Bearer ${await firmarToken(maestro.id, RolUsuario.MAESTRO, sedeMeridaId)}`,
        );

      expect(res.status).toBe(403);
      expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
    });

    it('rol ALUMNO (no ADMINISTRATIVO) -> 403 ROL_NO_AUTORIZADO', async () => {
      const res = await request(app.getHttpServer())
        .get('/personas/resumen')
        .set(
          'Authorization',
          `Bearer ${await firmarToken(alumnoMeridaId, RolUsuario.ALUMNO, sedeMeridaId)}`,
        );

      expect(res.status).toBe(403);
      expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
    });

    it('sin Authorization -> 401 UNAUTHORIZED', async () => {
      const res = await request(app.getHttpServer()).get('/personas/resumen');

      expect(res.status).toBe(401);
      expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
    });
  });
});
