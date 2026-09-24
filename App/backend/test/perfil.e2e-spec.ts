import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  RolUsuario,
  TipoContacto,
  EstatusEmpleado,
  NivelPermiso,
  PuestoAdministrativo,
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

interface PerfilBody {
  data: {
    id: string;
    email: string;
    rol: RolUsuario;
    sedeId: string;
    codigoExterno: string | null;
    primerIngreso: boolean;
    activo: boolean;
    ultimoAcceso: string | null;
    sede: {
      id: string;
      nombre: string;
      direccion: string;
      ubicacionReferencia: string;
      telefono: string;
    };
    alumno: {
      id: string;
      nombres: string;
      apellidoPaterno: string;
      apellidoMaterno: string | null;
      curp: string | null;
      fechaNacimiento: string;
      matricula: string;
      correoPersonal: string;
      estatusAcademico: string;
      periodoIngreso: string;
      cuatrimestreActual: number;
      telefono: string | null;
      esMenorDeEdad: boolean;
      contactos: {
        id: string;
        tipo: 'TUTOR' | 'EMERGENCIA';
        nombre: string;
        telefono: string;
        correo: string | null;
        parentesco: string;
        orden: number;
      }[];
      carrera: {
        id: string;
        nombre: string;
        clave: string;
        duracion: number;
        nivel: string;
        modalidad: string;
        estatus: string;
        rvoe: string;
        descripcion: string;
      };
    } | null;
    maestro: {
      id: string;
      nombres: string;
      apellidoPaterno: string;
      apellidoMaterno: string | null;
      curp: string;
      cedulaProfesional: string | null;
      correoPersonal: string;
      telefono: string;
      fechaContratacion: string;
      estatus: string;
      tipoContratacion: 'BASE' | 'TEMPORAL' | 'CONTRATO' | null;
      diasTemporal: number | null;
      contratoFechaInicio: string | null;
      contratoFechaFin: string | null;
      contactos: {
        id: string;
        nombre: string;
        telefono: string;
        correo: string | null;
        parentesco: string;
        orden: number;
      }[];
    } | null;
    administrativo: {
      id: string;
      nombres: string;
      apellidoPaterno: string;
      apellidoMaterno: string | null;
      curp: string;
      correoPersonal: string;
      telefono: string;
      fechaContratacion: string;
      estatus: string;
      puesto: string;
      nivelPermiso: 'SUPER_ADMIN' | 'ADMIN' | 'AUXILIAR';
      puedeDarAltaAdministrativos: boolean;
      contactos: {
        id: string;
        nombre: string;
        telefono: string;
        correo: string | null;
        parentesco: string;
        orden: number;
      }[];
    } | null;
  };
}

/**
 * Test de integración — Fase 5, Día 16 (`GET /perfil`).
 *
 * Contra la app real (`AppModule` completo, `PrismaService` conectado a la
 * DB real de Supabase) y datos reales sembrados por `prisma/seed.ts` — mismo
 * criterio que `test/carreras.e2e-spec.ts`: no hace falta mockear Supabase
 * Auth acá (ruta de solo lectura contra Postgres, sin tocar Auth), solo el
 * JWKS de prueba (`SEDE_GUARD_ENV_OVERRIDE`) para firmar JWTs verificables.
 */
describe('PerfilController — GET /perfil (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let alumnoMenorId: string;
  let maestroId: string;
  let administrativoAuxiliarId: string;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';

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

    // Fixture nuevo (extensión `esMenorDeEdad`, 2026-08-12) — ningún alumno
    // sembrado por `prisma/seed.ts` es menor de edad a la fecha en que corre
    // este suite (`luis.chan` 2007-03-12, `mariajose.pech` 2008-07-20, ambos
    // ya mayores). Se crea un alumno directo por Prisma (mismo criterio que
    // los fixtures de `test/personas.e2e-spec.ts`) con `fechaNacimiento`
    // reciente para ejercitar el branch `esMenorDeEdad: true` de verdad.
    const carreraMerida = await prisma.carrera.findUniqueOrThrow({
      where: { clave: 'LAE-MID' },
    });
    const alumnoMenor = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.alumnomenor.${randomUUID()}@cesp-merida.edu.mx`,
        rol: RolUsuario.ALUMNO,
        sedeId: sedeMeridaId,
      },
    });
    const alumnoMenorPerfil = await prisma.perfilAlumno.create({
      data: {
        usuarioId: alumnoMenor.id,
        nombres: 'Fixture',
        apellidoPaterno: 'Menor',
        fechaNacimiento: new Date('2015-01-01'),
        matricula: `MID-2026-FIX-${randomUUID().slice(0, 8)}`,
        correoPersonal: `fixture.alumnomenor.personal.${randomUUID()}@example.com`,
        carreraId: carreraMerida.id,
        estatusAcademico: 'INSCRITO',
        periodoIngreso: '2026-1',
        cuatrimestreActual: 1,
      },
    });
    alumnoMenorId = alumnoMenor.id;

    // Fixture nuevo (gap real reportado por el usuario 2026-08-13,
    // `alumno.contactos`) — este fixture no traía contactos desde la
    // extensión del 12-ago, se agregan acá: 2 contactos (`TUTOR` primero,
    // `orden: 1`, obligatorio por ser menor de edad; `EMERGENCIA` segundo,
    // `orden: 2`) para ejercitar el orden ascendente real.
    await prisma.contactoAlumno.createMany({
      data: [
        {
          alumnoId: alumnoMenorPerfil.id,
          tipo: TipoContacto.TUTOR,
          nombre: 'Fixture Tutor',
          telefono: '9990001111',
          correo: 'fixture.tutor@example.com',
          parentesco: 'Madre',
          orden: 1,
        },
        {
          alumnoId: alumnoMenorPerfil.id,
          tipo: TipoContacto.EMERGENCIA,
          nombre: 'Fixture Emergencia',
          telefono: '9990002222',
          parentesco: 'Tía',
          orden: 2,
        },
      ],
    });

    // Fixture nuevo (Día 17, `maestro`) — `prisma/seed.ts` no siembra ningún
    // usuario con `rol: MAESTRO` todavía (Fase 4 solo cubrió alumno y
    // administrativo), así que se crea directo por Prisma acá, mismo patrón
    // que `alumnoMenor` arriba: 2 contactos (`orden` 1 y 2, sin `tipo` —
    // `ContactoMaestro` no lo tiene) para ejercitar el orden ascendente.
    const maestroUsuario = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.maestro.${randomUUID()}@cesp-merida.edu.mx`,
        rol: RolUsuario.MAESTRO,
        sedeId: sedeMeridaId,
      },
    });
    const maestroPerfil = await prisma.perfilMaestro.create({
      data: {
        usuarioId: maestroUsuario.id,
        nombres: 'Fixture',
        apellidoPaterno: 'Maestro',
        apellidoMaterno: 'Prueba',
        curp: 'FIMA800101HYNXXX05',
        cedulaProfesional: '1234567',
        correoPersonal: `fixture.maestro.personal.${randomUUID()}@example.com`,
        telefono: '9990003333',
        fechaContratacion: new Date('2024-08-01'),
        estatus: EstatusEmpleado.ACTIVO,
        // Tipo de contratación (2026-09-07) — CONTRATO con fechas para
        // ejercitar que `GET /perfil` devuelve `contratoFecha*` (Día 17
        // extendido).
        tipoContratacion: TipoContratacion.CONTRATO,
        contratoFechaInicio: new Date('2024-08-01'),
        contratoFechaFin: new Date('2025-07-31'),
      },
    });
    await prisma.contactoMaestro.createMany({
      data: [
        {
          maestroId: maestroPerfil.id,
          nombre: 'Fixture Contacto Uno',
          telefono: '9990004444',
          correo: 'fixture.contacto1@example.com',
          parentesco: 'Esposo/a',
          orden: 1,
        },
        {
          maestroId: maestroPerfil.id,
          nombre: 'Fixture Contacto Dos',
          telefono: '9990005555',
          parentesco: 'Hermano/a',
          orden: 2,
        },
      ],
    });
    maestroId = maestroUsuario.id;

    // Fixture nuevo (Día 18, `administrativo`) — `prisma/seed.ts` solo siembra
    // un administrativo con `nivelPermiso: ADMIN` (`ana.canul`, reusado en el
    // test de "ADMIN -> puedeDarAltaAdministrativos true" más abajo). Ningún
    // `AUXILIAR` sembrado — se crea directo por Prisma acá, mismo patrón que
    // `maestroUsuario` arriba, para ejercitar el branch
    // `puedeDarAltaAdministrativos: false`.
    const administrativoAuxiliarUsuario = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.administrativo.auxiliar.${randomUUID()}@cesp-merida.edu.mx`,
        rol: RolUsuario.ADMINISTRATIVO,
        sedeId: sedeMeridaId,
      },
    });
    const administrativoAuxiliarPerfil =
      await prisma.perfilAdministrativo.create({
        data: {
          usuarioId: administrativoAuxiliarUsuario.id,
          nombres: 'Fixture',
          apellidoPaterno: 'Auxiliar',
          apellidoMaterno: 'Prueba',
          curp: 'FIAX800101HYNXXX09',
          correoPersonal: `fixture.administrativo.auxiliar.personal.${randomUUID()}@example.com`,
          telefono: '9990006666',
          fechaContratacion: new Date('2024-09-01'),
          estatus: EstatusEmpleado.ACTIVO,
          puesto: PuestoAdministrativo.AUXILIAR,
          nivelPermiso: NivelPermiso.AUXILIAR,
        },
      });
    await prisma.contactoAdministrativo.createMany({
      data: [
        {
          administrativoId: administrativoAuxiliarPerfil.id,
          nombre: 'Fixture Contacto Admin Uno',
          telefono: '9990007777',
          correo: 'fixture.contacto.admin1@example.com',
          parentesco: 'Padre',
          orden: 1,
        },
        {
          administrativoId: administrativoAuxiliarPerfil.id,
          nombre: 'Fixture Contacto Admin Dos',
          telefono: '9990008888',
          parentesco: 'Hermano/a',
          orden: 2,
        },
      ],
    });
    administrativoAuxiliarId = administrativoAuxiliarUsuario.id;
  });

  afterAll(async () => {
    // Limpieza acotada a los 3 `Usuario.id` reales que creó `beforeAll` —
    // nunca por patrón de email/nombre (ese tipo de limpieza amplia ya
    // causó un bug real en Día 24, ver CLAUDE.md raíz regla 14). El
    // `onDelete: Cascade` de PerfilAlumno/PerfilMaestro/PerfilAdministrativo
    // y sus Contacto* respectivos se encarga del resto.
    await prisma.usuario.deleteMany({
      where: {
        id: { in: [alumnoMenorId, maestroId, administrativoAuxiliarId] },
      },
    });
    await app.close();
  });

  it('rol ALUMNO (seed real) -> 200, datos personales + sede + carrera correctos', async () => {
    const alumnoUsuario = await prisma.usuario.findUniqueOrThrow({
      where: { email: 'luis.chan@cesp-merida.edu.mx' },
    });

    const res = await request(app.getHttpServer())
      .get('/perfil')
      .set(
        'Authorization',
        `Bearer ${await firmarToken(alumnoUsuario.id, RolUsuario.ALUMNO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(200);
    const body = (res.body as PerfilBody).data;

    // Datos comunes (usuario + sede).
    expect(body.id).toBe(alumnoUsuario.id);
    expect(body.email).toBe('luis.chan@cesp-merida.edu.mx');
    expect(body.rol).toBe('ALUMNO');
    expect(body.sedeId).toBe(sedeMeridaId);
    expect(body.sede.id).toBe(sedeMeridaId);
    expect(body.sede.nombre).toBe('CESP Mérida');
    // Dato financiero interno, no debe filtrarse al perfil del propio usuario.
    expect(body.sede).not.toHaveProperty('costoRenta');

    // Sub-objeto de rol ALUMNO (Día 16, entregable de hoy).
    expect(body.alumno).not.toBeNull();
    expect(body.alumno?.nombres).toBe('Luis Fernando');
    expect(body.alumno?.apellidoPaterno).toBe('Chan');
    expect(body.alumno?.apellidoMaterno).toBe('Uc');
    expect(body.alumno?.matricula).toBe('MID-2026-0001');
    expect(body.alumno?.correoPersonal).toBe('luis.chan.personal@example.com');
    expect(body.alumno?.estatusAcademico).toBe('INSCRITO');
    expect(body.alumno?.periodoIngreso).toBe('2026-1');
    expect(body.alumno?.cuatrimestreActual).toBe(1);

    // `esMenorDeEdad` — calculado al vuelo, nunca persistido (regla 1 de
    // CLAUDE.md raíz). `luis.chan` nació el 2007-03-12 (prisma/seed.ts) —
    // ya es mayor de edad a la fecha en que corre este test.
    expect(body.alumno?.esMenorDeEdad).toBe(false);

    // `contactos` — gap real reportado por el usuario 2026-08-13. `luis.chan`
    // trae 1 contacto sembrado por `prisma/seed.ts` (tipo EMERGENCIA,
    // orden 1). Solo `contactos`, `infoMedica` queda fuera de alcance a
    // propósito (ver comentario de `PerfilService`).
    expect(body.alumno?.contactos).toHaveLength(1);
    expect(body.alumno?.contactos[0].tipo).toBe('EMERGENCIA');
    expect(body.alumno?.contactos[0].orden).toBe(1);
    expect(body.alumno?.contactos[0].nombre).toBe('Contacto de prueba');
    expect(body.alumno).not.toHaveProperty('infoMedica');

    // Carrera / plan de estudios (roadmap Día 16).
    expect(body.alumno?.carrera.clave).toBe('LAE-MID');
    expect(body.alumno?.carrera.nombre).toBe('Licenciatura en Administración');
    expect(body.alumno?.carrera.duracion).toBe(8);
    expect(body.alumno?.carrera.nivel).toBe('LICENCIATURA');
    expect(body.alumno?.carrera.modalidad).toBe('PRESENCIAL');

    // Reservados para Día 17/18 — no implementados todavía.
    expect(body.maestro).toBeNull();
    expect(body.administrativo).toBeNull();
  });

  it('rol ALUMNO menor de edad (fixture, fechaNacimiento 2015-01-01) -> 200, esMenorDeEdad true', async () => {
    const res = await request(app.getHttpServer())
      .get('/perfil')
      .set(
        'Authorization',
        `Bearer ${await firmarToken(alumnoMenorId, RolUsuario.ALUMNO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(200);
    const body = (res.body as PerfilBody).data;
    expect(body.alumno?.esMenorDeEdad).toBe(true);

    // `contactos` — el fixture es menor de edad, el `TUTOR` es obligatorio
    // en el alta real; acá se confirma que viene ordenado (`orden`
    // ascendente, `TUTOR` primero) y que `infoMedica` sigue fuera de alcance.
    expect(body.alumno?.contactos).toHaveLength(2);
    expect(body.alumno?.contactos[0].tipo).toBe('TUTOR');
    expect(body.alumno?.contactos[0].orden).toBe(1);
    expect(body.alumno?.contactos[1].tipo).toBe('EMERGENCIA');
    expect(body.alumno?.contactos[1].orden).toBe(2);
    expect(body.alumno).not.toHaveProperty('infoMedica');
  });

  it('rol MAESTRO (fixture) -> 200, maestro lleno con contactos ordenados, alumno/administrativo null', async () => {
    const res = await request(app.getHttpServer())
      .get('/perfil')
      .set(
        'Authorization',
        `Bearer ${await firmarToken(maestroId, RolUsuario.MAESTRO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(200);
    const body = (res.body as PerfilBody).data;

    expect(body.id).toBe(maestroId);
    expect(body.rol).toBe('MAESTRO');
    expect(body.sede.id).toBe(sedeMeridaId);

    // Sub-objeto de rol MAESTRO (Día 17, entregable de hoy).
    expect(body.maestro).not.toBeNull();
    expect(body.maestro?.nombres).toBe('Fixture');
    expect(body.maestro?.apellidoPaterno).toBe('Maestro');
    expect(body.maestro?.apellidoMaterno).toBe('Prueba');
    expect(body.maestro?.curp).toBe('FIMA800101HYNXXX05');
    expect(body.maestro?.cedulaProfesional).toBe('1234567');
    expect(body.maestro?.estatus).toBe('ACTIVO');
    expect(body.maestro).not.toHaveProperty('usuarioId');
    expect(body.maestro).not.toHaveProperty('infoMedica');

    // Tipo de contratación (2026-09-07) — fixture es CONTRATO, devuelve las
    // 2 fechas (ISO 8601), `diasTemporal` null (solo aplica a TEMPORAL).
    expect(body.maestro?.tipoContratacion).toBe('CONTRATO');
    expect(body.maestro?.diasTemporal).toBeNull();
    expect(body.maestro?.contratoFechaInicio).toBe(
      new Date('2024-08-01').toISOString(),
    );
    expect(body.maestro?.contratoFechaFin).toBe(
      new Date('2025-07-31').toISOString(),
    );

    // `contactos` — ordenados ascendente por `orden`, sin campo `tipo`
    // (exclusivo de `ContactoAlumno`).
    expect(body.maestro?.contactos).toHaveLength(2);
    expect(body.maestro?.contactos[0].orden).toBe(1);
    expect(body.maestro?.contactos[0].nombre).toBe('Fixture Contacto Uno');
    expect(body.maestro?.contactos[0]).not.toHaveProperty('tipo');
    expect(body.maestro?.contactos[1].orden).toBe(2);
    expect(body.maestro?.contactos[1].nombre).toBe('Fixture Contacto Dos');

    // No le aplican los otros sub-objetos de rol.
    expect(body.alumno).toBeNull();
    expect(body.administrativo).toBeNull();
  });

  it('rol ADMINISTRATIVO nivelPermiso ADMIN (seed real, ana.canul) -> 200, administrativo lleno, puedeDarAltaAdministrativos true', async () => {
    const adminUsuario = await prisma.usuario.findUniqueOrThrow({
      where: { email: 'ana.canul@cesp-merida.edu.mx' },
    });

    const res = await request(app.getHttpServer())
      .get('/perfil')
      .set(
        'Authorization',
        `Bearer ${await firmarToken(adminUsuario.id, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(200);
    const body = (res.body as PerfilBody).data;

    expect(body.id).toBe(adminUsuario.id);
    expect(body.rol).toBe('ADMINISTRATIVO');
    expect(body.sede.id).toBe(sedeMeridaId);
    expect(body.alumno).toBeNull();
    expect(body.maestro).toBeNull();

    // Sub-objeto de rol ADMINISTRATIVO (Día 18, entregable de hoy).
    expect(body.administrativo).not.toBeNull();
    expect(body.administrativo?.nivelPermiso).toBe('ADMIN');
    expect(body.administrativo?.puesto).toBe('COORDINADOR_ADMINISTRATIVO');
    expect(body.administrativo).not.toHaveProperty('usuarioId');
    expect(body.administrativo).not.toHaveProperty('infoMedica');
    expect(body.administrativo).not.toHaveProperty('permisos');

    // `puedeDarAltaAdministrativos` — replica solo la primera compuerta de
    // `PersonasService.verificarJerarquiaNivelPermiso`: ADMIN sí puede dar
    // de alta administrativos (no captura el tope de jerarquía sobre A
    // QUIÉN, ver nota en `perfil.service.ts`).
    expect(body.administrativo?.puedeDarAltaAdministrativos).toBe(true);

    // `contactos` — sembrado por `prisma/seed.ts`, 1 contacto (`orden: 1`).
    expect(body.administrativo?.contactos).toHaveLength(1);
    expect(body.administrativo?.contactos[0].orden).toBe(1);
    expect(body.administrativo?.contactos[0].nombre).toBe('Contacto de prueba');
    expect(body.administrativo?.contactos[0]).not.toHaveProperty('tipo');
  });

  it('rol ADMINISTRATIVO nivelPermiso AUXILIAR (fixture) -> 200, puedeDarAltaAdministrativos false, contactos ordenados', async () => {
    const res = await request(app.getHttpServer())
      .get('/perfil')
      .set(
        'Authorization',
        `Bearer ${await firmarToken(
          administrativoAuxiliarId,
          RolUsuario.ADMINISTRATIVO,
          sedeMeridaId,
        )}`,
      );

    expect(res.status).toBe(200);
    const body = (res.body as PerfilBody).data;

    expect(body.id).toBe(administrativoAuxiliarId);
    expect(body.rol).toBe('ADMINISTRATIVO');
    expect(body.administrativo).not.toBeNull();
    expect(body.administrativo?.nombres).toBe('Fixture');
    expect(body.administrativo?.apellidoPaterno).toBe('Auxiliar');
    expect(body.administrativo?.apellidoMaterno).toBe('Prueba');
    expect(body.administrativo?.curp).toBe('FIAX800101HYNXXX09');
    expect(body.administrativo?.estatus).toBe('ACTIVO');
    expect(body.administrativo?.puesto).toBe('AUXILIAR');
    expect(body.administrativo?.nivelPermiso).toBe('AUXILIAR');

    // `puedeDarAltaAdministrativos` — AUXILIAR nunca puede dar de alta
    // administrativos (regla 7 de CLAUDE.md raíz, mismo criterio que
    // `verificarJerarquiaNivelPermiso`).
    expect(body.administrativo?.puedeDarAltaAdministrativos).toBe(false);

    // `contactos` — ordenados ascendente por `orden`, sin campo `tipo`.
    expect(body.administrativo?.contactos).toHaveLength(2);
    expect(body.administrativo?.contactos[0].orden).toBe(1);
    expect(body.administrativo?.contactos[0].nombre).toBe(
      'Fixture Contacto Admin Uno',
    );
    expect(body.administrativo?.contactos[0]).not.toHaveProperty('tipo');
    expect(body.administrativo?.contactos[1].orden).toBe(2);
    expect(body.administrativo?.contactos[1].nombre).toBe(
      'Fixture Contacto Admin Dos',
    );

    // No le aplican los otros sub-objetos de rol.
    expect(body.alumno).toBeNull();
    expect(body.maestro).toBeNull();
  });

  it('actor sin fila en `usuarios` (JWT válido pero sub inexistente) -> 404 NOT_FOUND', async () => {
    const res = await request(app.getHttpServer())
      .get('/perfil')
      .set(
        'Authorization',
        `Bearer ${await firmarToken(randomUUID(), RolUsuario.ALUMNO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('sin Authorization -> 401 UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer()).get('/perfil');

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
  });
});
