import { randomUUID } from 'node:crypto';
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
interface EventoBody {
  data: {
    id: string;
    sedeId: string;
    autorUsuarioId: string;
    titulo: string;
    alcanceTipo: string;
    alcanceId: string | null;
    recurrenciaRegla: unknown;
    recurrenciaHasta: string | null;
  };
}
interface OcurrenciaListBody {
  data: Array<{
    eventoId: string;
    titulo: string;
    fecha: string;
    alcanceTipo: string;
    alcanceId: string | null;
    esRecurrente: boolean;
    puedeEditar: boolean;
  }>;
}

/**
 * Suite e2e de `calendario` (Fase 15, Día 41). Sigue el mismo scaffolding
 * que `test/materias.e2e-spec.ts` (JWT firmado con `jose`, sedes/personas
 * reales de `prisma/seed.ts` ubicadas por rol+sede en `beforeAll`, sin
 * hardcodear emails).
 *
 * Para el caso de `MAESTRO` con `GrupoMateriaMaestro` (Día 41, casos 6/7) se
 * construye la fixture completa DESDE CERO en `beforeAll` — `Grupo` +
 * `Materia` + `Usuario`/`PerfilMaestro` propios + la asignación real vía
 * `POST /grupos/:id/asignaciones` — calcando el patrón de
 * `test/grupos-asignaciones.e2e-spec.ts` (`crearGrupo`/`crearMateria`/
 * `crearMaestro`/`asignar`). Corrección de un hallazgo de review: la
 * versión original de este archivo reutilizaba una fila AMBIENTAL de
 * `GrupoMateriaMaestro` ya existente en la DB de dev (de la verificación
 * manual de Fase 12, Días 33-34) — `prisma/seed.ts` NUNCA crea esa tabla,
 * así que un `migrate reset` + reseed rutinario habría tumbado los 18
 * casos de este archivo en `beforeAll`. Todo lo que se crea acá
 * (`Grupo`/`Materia`/`Usuario`/`PerfilMaestro`/`GrupoMateriaMaestro`,
 * además de `EventoCalendario`) se limpia en `afterAll` acotado a los ids
 * exactos creados en esta corrida (regla 14) — nunca por patrón de
 * nombre/email.
 */
describe('CalendarioController (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let sedeMeridaId: string;
  let sedeValladolidId: string;
  let adminMeridaId: string;
  let adminValladolidId: string;
  let carreraLaeId: string; // LAE-MID (Mérida), para la fixture de grupo/materia
  let salonMeridaId: string;
  let maestroConAsignacionId: string;
  let grupoConAsignacionId: string;
  let grupoSinAsignacionId: string;
  let alumnoMatriculadoId: string;
  let grupoMatriculadoId: string;
  let grupoNoMatriculadoId: string;
  let grupoValladolidId: string;

  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';

  const eventoIdsCreados: string[] = [];
  const grupoIdsCreados: string[] = [];
  const materiaIdsCreados: string[] = [];
  const usuarioIdsCreados: string[] = [];
  const asignacionIdsCreados: string[] = [];

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

  const tokenAdminMerida = () =>
    firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId);
  const tokenAdminValladolid = () =>
    firmarToken(adminValladolidId, RolUsuario.ADMINISTRATIVO, sedeValladolidId);
  const tokenMaestro = () =>
    firmarToken(maestroConAsignacionId, RolUsuario.MAESTRO, sedeMeridaId);
  const tokenAlumno = () =>
    firmarToken(alumnoMatriculadoId, RolUsuario.ALUMNO, sedeMeridaId);

  async function postEvento(
    token: string,
    body: Record<string, unknown>,
  ): Promise<request.Response> {
    const res = await request(app.getHttpServer())
      .post('/eventos')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    if (res.status === 201) {
      eventoIdsCreados.push((res.body as EventoBody).data.id);
    }
    return res;
  }

  function getEventos(
    token: string,
    desde: string,
    hasta: string,
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .get(`/eventos?desde=${desde}&hasta=${hasta}`)
      .set('Authorization', `Bearer ${token}`);
  }

  // --- Fixtures desde cero de Grupo/Materia/Maestro/asignación —
  // calcadas de `test/grupos-asignaciones.e2e-spec.ts` (mismos nombres de
  // función, mismo shape de datos) para que un `MAESTRO` tenga una
  // asignación real de `GrupoMateriaMaestro` sin depender de ninguna fila
  // ambiental de la DB de dev. ---

  async function crearGrupo(opts: {
    sedeId: string;
    carreraId: string;
    salonId: string;
    cicloActual?: number;
  }): Promise<string> {
    const g = await prisma.grupo.create({
      data: {
        sedeId: opts.sedeId,
        carreraId: opts.carreraId,
        salonId: opts.salonId,
        nombre: `Grupo CAL E2E ${randomUUID().slice(0, 8)}`,
        anioInicio: 2027,
        cicloActual: opts.cicloActual ?? 1,
        capacidad: 30,
      },
    });
    grupoIdsCreados.push(g.id);
    return g.id;
  }

  async function crearMateria(
    carreraId: string,
    ciclo: number,
  ): Promise<string> {
    const m = await prisma.materia.create({
      data: {
        carreraId,
        nombre: `Materia CAL E2E ${randomUUID().slice(0, 8)}`,
        ciclo,
      },
    });
    materiaIdsCreados.push(m.id);
    return m.id;
  }

  async function crearMaestro(sedeId: string): Promise<string> {
    const usuario = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.cal.maestro.${randomUUID()}@example.com`,
        rol: RolUsuario.MAESTRO,
        sedeId,
      },
    });
    usuarioIdsCreados.push(usuario.id);
    await prisma.perfilMaestro.create({
      data: {
        usuarioId: usuario.id,
        nombres: 'Fixture',
        apellidoPaterno: 'Calendario',
        apellidoMaterno: `Z${randomUUID().slice(0, 4)}`,
        curp: `FX${randomUUID().slice(0, 16).toUpperCase()}`,
        cedulaProfesional: `${randomUUID().slice(0, 7)}`,
        correoPersonal: `fixture.cal.maestro.p.${randomUUID()}@example.com`,
        telefono: '9990000000',
        fechaContratacion: new Date('2024-08-01'),
        estatus: 'ACTIVO',
      },
    });
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

    sedeMeridaId = (
      await prisma.sede.findUniqueOrThrow({ where: { nombre: 'CESP Mérida' } })
    ).id;
    sedeValladolidId = (
      await prisma.sede.findUniqueOrThrow({
        where: { nombre: 'CESP Valladolid' },
      })
    ).id;

    adminMeridaId = (
      await prisma.usuario.findFirstOrThrow({
        where: { rol: RolUsuario.ADMINISTRATIVO, sedeId: sedeMeridaId },
      })
    ).id;
    adminValladolidId = (
      await prisma.usuario.findFirstOrThrow({
        where: { rol: RolUsuario.ADMINISTRATIVO, sedeId: sedeValladolidId },
      })
    ).id;

    carreraLaeId = (
      await prisma.carrera.findUniqueOrThrow({ where: { clave: 'LAE-MID' } })
    ).id;
    salonMeridaId = (
      await prisma.salon.findUniqueOrThrow({
        where: { sedeId_nombre: { sedeId: sedeMeridaId, nombre: 'Aula 101' } },
      })
    ).id;

    // Fixture desde cero de un MAESTRO con una asignación real de
    // GrupoMateriaMaestro (Grupo + Materia + Usuario/PerfilMaestro propios,
    // asignados vía el endpoint real POST /grupos/:id/asignaciones) — NO se
    // depende de ninguna fila ambiental de la DB de dev, ver docstring de
    // este archivo.
    grupoConAsignacionId = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
      cicloActual: 1,
    });
    const materiaFixtureId = await crearMateria(carreraLaeId, 1);
    maestroConAsignacionId = await crearMaestro(sedeMeridaId);

    const tokenAdminParaFixture = await firmarToken(
      adminMeridaId,
      RolUsuario.ADMINISTRATIVO,
      sedeMeridaId,
    );
    const asignacionRes = await request(app.getHttpServer())
      .post(`/grupos/${grupoConAsignacionId}/asignaciones`)
      .set('Authorization', `Bearer ${tokenAdminParaFixture}`)
      .send({ materiaId: materiaFixtureId, usuarioId: maestroConAsignacionId });
    if (asignacionRes.status !== 201) {
      throw new Error(
        `No se pudo crear la fixture de GrupoMateriaMaestro: ${JSON.stringify(
          asignacionRes.body,
        )}`,
      );
    }
    asignacionIdsCreados.push(
      (asignacionRes.body as { data: { id: string } }).data.id,
    );

    // Un grupo REAL de la misma sede donde ESE maestro (recién creado, sin
    // ninguna otra asignación en toda la DB) no tiene asignación — sirve
    // para el caso "MAESTRO sin asignación a ese grupo".
    grupoSinAsignacionId = (
      await prisma.grupo.findFirstOrThrow({
        where: { sedeId: sedeMeridaId, id: { not: grupoConAsignacionId } },
      })
    ).id;

    // Alumno real matriculado (GrupoAlumno) en Mérida, y el grupo donde SÍ
    // está matriculado.
    const matriculaReal = await prisma.grupoAlumno.findFirstOrThrow({
      where: { grupo: { sedeId: sedeMeridaId } },
      select: { grupoId: true, alumno: { select: { usuarioId: true } } },
    });
    alumnoMatriculadoId = matriculaReal.alumno.usuarioId;
    grupoMatriculadoId = matriculaReal.grupoId;

    // Un grupo de la misma sede donde ESE alumno NO está matriculado.
    grupoNoMatriculadoId = (
      await prisma.grupo.findFirstOrThrow({
        where: {
          sedeId: sedeMeridaId,
          id: { not: grupoMatriculadoId },
          alumnos: { none: { alumno: { usuarioId: alumnoMatriculadoId } } },
        },
      })
    ).id;

    grupoValladolidId = (
      await prisma.grupo.findFirstOrThrow({
        where: { sedeId: sedeValladolidId },
      })
    ).id;
  }, 30000);

  afterAll(async () => {
    if (eventoIdsCreados.length > 0) {
      await prisma.registroAuditoria.deleteMany({
        where: {
          entidad: 'EventoCalendario',
          entidadId: { in: eventoIdsCreados },
        },
      });
      await prisma.recordatorioEnviado.deleteMany({
        where: { eventoId: { in: eventoIdsCreados } },
      });
      await prisma.eventoCalendario.deleteMany({
        where: { id: { in: eventoIdsCreados } },
      });
    }
    // Mismo orden FK-safe que `test/grupos-asignaciones.e2e-spec.ts`:
    // auditoría de la asignación -> GrupoMateriaMaestro (por grupoId) ->
    // Grupo -> Materia -> PerfilMaestro -> Usuario.
    if (asignacionIdsCreados.length > 0) {
      await prisma.registroAuditoria.deleteMany({
        where: {
          entidad: 'GrupoMateriaMaestro',
          entidadId: { in: asignacionIdsCreados },
        },
      });
    }
    if (grupoIdsCreados.length > 0) {
      await prisma.grupoMateriaMaestro.deleteMany({
        where: { grupoId: { in: grupoIdsCreados } },
      });
      await prisma.grupo.deleteMany({ where: { id: { in: grupoIdsCreados } } });
    }
    if (materiaIdsCreados.length > 0) {
      await prisma.materia.deleteMany({
        where: { id: { in: materiaIdsCreados } },
      });
    }
    if (usuarioIdsCreados.length > 0) {
      await prisma.perfilMaestro.deleteMany({
        where: { usuarioId: { in: usuarioIdsCreados } },
      });
      await prisma.usuario.deleteMany({
        where: { id: { in: usuarioIdsCreados } },
      });
    }
    await app.close();
  });

  it('1. POST /eventos alcanceTipo SEDE por ADMINISTRATIVO -> 201, data.id presente', async () => {
    const token = await tokenAdminMerida();
    const res = await postEvento(token, {
      titulo: 'Evento SEDE E2E',
      fechaInicio: '2027-02-01',
      categoria: 'SOCIAL',
      alcanceTipo: 'SEDE',
    });
    expect(res.status).toBe(201);
    expect((res.body as EventoBody).data.id).toEqual(expect.any(String));
  });

  it('2. POST con recurrenciaRegla presente y recurrenciaHasta ausente -> 400 VALIDATION_ERROR', async () => {
    const token = await tokenAdminMerida();
    const res = await postEvento(token, {
      titulo: 'Evento sin recurrenciaHasta',
      fechaInicio: '2027-02-02',
      categoria: 'SOCIAL',
      alcanceTipo: 'SEDE',
      recurrenciaRegla: { frecuencia: 'SEMANAL', intervalo: 1 },
    });
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('3. POST alcanceTipo GRUPO con alcanceId de un grupo de otra sede -> 404 NOT_FOUND', async () => {
    const token = await tokenAdminMerida();
    const res = await postEvento(token, {
      titulo: 'Evento grupo otra sede',
      fechaInicio: '2027-02-03',
      categoria: 'SOCIAL',
      alcanceTipo: 'GRUPO',
      alcanceId: grupoValladolidId,
    });
    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('4. POST alcanceTipo SEDE con alcanceId presente -> 400 VALIDATION_ERROR', async () => {
    const token = await tokenAdminMerida();
    const res = await postEvento(token, {
      titulo: 'Evento sede con alcanceId',
      fechaInicio: '2027-02-04',
      categoria: 'SOCIAL',
      alcanceTipo: 'SEDE',
      alcanceId: randomUUID(),
    });
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('5. POST por MAESTRO con alcanceTipo SEDE -> 403 ROL_NO_AUTORIZADO', async () => {
    const token = await tokenMaestro();
    const res = await postEvento(token, {
      titulo: 'Evento maestro sede',
      fechaInicio: '2027-02-05',
      categoria: 'SOCIAL',
      alcanceTipo: 'SEDE',
    });
    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });

  it('6. POST por MAESTRO con alcanceTipo GRUPO de un grupo donde NO tiene asignación -> 403', async () => {
    const token = await tokenMaestro();
    const res = await postEvento(token, {
      titulo: 'Evento maestro grupo sin asignacion',
      fechaInicio: '2027-02-06',
      categoria: 'SOCIAL',
      alcanceTipo: 'GRUPO',
      alcanceId: grupoSinAsignacionId,
    });
    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });

  it('7. POST por MAESTRO con alcanceTipo GRUPO de un grupo donde SÍ tiene asignación -> 201', async () => {
    const token = await tokenMaestro();
    const res = await postEvento(token, {
      titulo: 'Evento maestro grupo con asignacion',
      fechaInicio: '2027-02-07',
      categoria: 'SOCIAL',
      alcanceTipo: 'GRUPO',
      alcanceId: grupoConAsignacionId,
    });
    expect(res.status).toBe(201);
  });

  it('8. POST por ALUMNO -> 403 ROL_NO_AUTORIZADO', async () => {
    const token = await tokenAlumno();
    const res = await postEvento(token, {
      titulo: 'Evento alumno',
      fechaInicio: '2027-02-08',
      categoria: 'SOCIAL',
      alcanceTipo: 'SEDE',
    });
    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });

  it('9. GET expande ocurrencias semanales en un rango de 3 semanas', async () => {
    const token = await tokenAdminMerida();
    // 2026-09-07 es lunes (getUTCDay() === 1), verificado a mano.
    const creado = await postEvento(token, {
      titulo: 'Evento semanal E2E',
      fechaInicio: '2026-09-07',
      categoria: 'OTRO',
      alcanceTipo: 'SEDE',
      recurrenciaRegla: {
        frecuencia: 'SEMANAL',
        intervalo: 1,
        diasSemana: [1],
      },
      recurrenciaHasta: '2026-12-31',
    });
    expect(creado.status).toBe(201);
    const eventoId = (creado.body as EventoBody).data.id;

    const res = await getEventos(token, '2026-09-07', '2026-09-21');
    expect(res.status).toBe(200);
    const ocurrencias = (res.body as OcurrenciaListBody).data.filter(
      (o) => o.eventoId === eventoId,
    );
    expect(ocurrencias).toHaveLength(3);
    expect(ocurrencias.map((o) => o.fecha)).toEqual([
      '2026-09-07',
      '2026-09-14',
      '2026-09-21',
    ]);
    for (const o of ocurrencias) {
      expect(o.esRecurrente).toBe(true);
    }
  });

  it('10. GET filtra por alcance GRUPO según matrícula real del alumno', async () => {
    const tokenAdmin = await tokenAdminMerida();
    const enMatriculado = await postEvento(tokenAdmin, {
      titulo: 'Evento grupo matriculado E2E',
      fechaInicio: '2027-03-01',
      categoria: 'OTRO',
      alcanceTipo: 'GRUPO',
      alcanceId: grupoMatriculadoId,
    });
    const enNoMatriculado = await postEvento(tokenAdmin, {
      titulo: 'Evento grupo no matriculado E2E',
      fechaInicio: '2027-03-01',
      categoria: 'OTRO',
      alcanceTipo: 'GRUPO',
      alcanceId: grupoNoMatriculadoId,
    });
    expect(enMatriculado.status).toBe(201);
    expect(enNoMatriculado.status).toBe(201);
    const idMatriculado = (enMatriculado.body as EventoBody).data.id;
    const idNoMatriculado = (enNoMatriculado.body as EventoBody).data.id;

    const tokenAlumnoActual = await tokenAlumno();
    const res = await getEventos(tokenAlumnoActual, '2027-03-01', '2027-03-01');
    expect(res.status).toBe(200);
    const ids = (res.body as OcurrenciaListBody).data.map((o) => o.eventoId);
    expect(ids).toContain(idMatriculado);
    expect(ids).not.toContain(idNoMatriculado);
  });

  it('11. GET con rango mayor a 62 días -> 400 VALIDATION_ERROR', async () => {
    const token = await tokenAdminMerida();
    const res = await getEventos(token, '2026-01-01', '2026-12-31');
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('12. PATCH por el autor cambiando titulo -> 200, audita EDICION', async () => {
    const token = await tokenAdminMerida();
    const creado = await postEvento(token, {
      titulo: 'Evento a editar E2E',
      fechaInicio: '2027-04-01',
      categoria: 'OTRO',
      alcanceTipo: 'SEDE',
    });
    expect(creado.status).toBe(201);
    const id = (creado.body as EventoBody).data.id;

    const res = await request(app.getHttpServer())
      .patch(`/eventos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ titulo: 'Evento editado E2E' });
    expect(res.status).toBe(200);
    expect((res.body as EventoBody).data.titulo).toBe('Evento editado E2E');

    const registro = await prisma.registroAuditoria.findFirst({
      where: { entidad: 'EventoCalendario', accion: 'EDICION', entidadId: id },
    });
    expect(registro).not.toBeNull();
  });

  it('13. PATCH sin cambios reales -> 200, sin fila nueva de auditoría', async () => {
    const token = await tokenAdminMerida();
    const creado = await postEvento(token, {
      titulo: 'Evento sin cambios E2E',
      fechaInicio: '2027-04-02',
      categoria: 'OTRO',
      alcanceTipo: 'SEDE',
    });
    expect(creado.status).toBe(201);
    const id = (creado.body as EventoBody).data.id;

    const antes = await prisma.registroAuditoria.count({
      where: { entidad: 'EventoCalendario', entidadId: id },
    });

    const res = await request(app.getHttpServer())
      .patch(`/eventos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ titulo: 'Evento sin cambios E2E' });
    expect(res.status).toBe(200);

    const despues = await prisma.registroAuditoria.count({
      where: { entidad: 'EventoCalendario', entidadId: id },
    });
    expect(despues).toBe(antes);
  });

  it('14. PATCH por un MAESTRO que no es autor ni ADMINISTRATIVO -> 403', async () => {
    const tokenAdmin = await tokenAdminMerida();
    const creado = await postEvento(tokenAdmin, {
      titulo: 'Evento de otro autor E2E',
      fechaInicio: '2027-04-03',
      categoria: 'OTRO',
      alcanceTipo: 'SEDE',
    });
    expect(creado.status).toBe(201);
    const id = (creado.body as EventoBody).data.id;

    const tokenM = await tokenMaestro();
    const res = await request(app.getHttpServer())
      .patch(`/eventos/${id}`)
      .set('Authorization', `Bearer ${tokenM}`)
      .send({ titulo: 'Intento no autorizado' });
    expect(res.status).toBe(403);
  });

  it('15. DELETE por el autor -> 200 { data: { ok: true } }; ya no aparece en GET', async () => {
    const token = await tokenAdminMerida();
    const creado = await postEvento(token, {
      titulo: 'Evento a borrar E2E',
      fechaInicio: '2027-04-04',
      categoria: 'OTRO',
      alcanceTipo: 'SEDE',
    });
    expect(creado.status).toBe(201);
    const id = (creado.body as EventoBody).data.id;

    const res = await request(app.getHttpServer())
      .delete(`/eventos/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { ok: true } });

    const posterior = await getEventos(token, '2027-04-04', '2027-04-04');
    const ids = (posterior.body as OcurrenciaListBody).data.map(
      (o) => o.eventoId,
    );
    expect(ids).not.toContain(id);
  });

  it('16. DELETE de un evento de otra sede -> 404 NOT_FOUND', async () => {
    const tokenValladolid = await tokenAdminValladolid();
    const creado = await postEvento(tokenValladolid, {
      titulo: 'Evento Valladolid E2E',
      fechaInicio: '2027-04-05',
      categoria: 'OTRO',
      alcanceTipo: 'SEDE',
    });
    expect(creado.status).toBe(201);
    const id = (creado.body as EventoBody).data.id;

    const tokenMerida = await tokenAdminMerida();
    const res = await request(app.getHttpServer())
      .delete(`/eventos/${id}`)
      .set('Authorization', `Bearer ${tokenMerida}`);
    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('17. Aislamiento cross-sede: un ADMINISTRATIVO de Valladolid no ve un evento SEDE de Mérida', async () => {
    const tokenMerida = await tokenAdminMerida();
    const creado = await postEvento(tokenMerida, {
      titulo: 'Evento sede Merida E2E',
      fechaInicio: '2027-04-06',
      categoria: 'OTRO',
      alcanceTipo: 'SEDE',
    });
    expect(creado.status).toBe(201);
    const id = (creado.body as EventoBody).data.id;

    const tokenValladolid = await tokenAdminValladolid();
    const res = await getEventos(tokenValladolid, '2027-04-06', '2027-04-06');
    expect(res.status).toBe(200);
    const ids = (res.body as OcurrenciaListBody).data.map((o) => o.eventoId);
    expect(ids).not.toContain(id);
  });

  it('18. GET /eventos sin token -> 401 UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer()).get(
      '/eventos?desde=2027-04-06&hasta=2027-04-06',
    );
    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
  });

  // --- Fix wave (revisión final Fase 15, 2026-09-01) ---

  it('19. POST con recurrenciaHasta anterior a fechaInicio -> 400 VALIDATION_ERROR', async () => {
    const token = await tokenAdminMerida();
    const res = await postEvento(token, {
      titulo: 'Evento recurrenciaHasta invalida E2E',
      fechaInicio: '2027-05-10',
      categoria: 'OTRO',
      alcanceTipo: 'SEDE',
      recurrenciaRegla: { frecuencia: 'DIARIA', intervalo: 1 },
      recurrenciaHasta: '2027-05-01',
    });
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('20. POST con fechaFin anterior a fechaInicio -> 400 VALIDATION_ERROR', async () => {
    const token = await tokenAdminMerida();
    const res = await postEvento(token, {
      titulo: 'Evento fechaFin invalida E2E',
      fechaInicio: '2027-05-10',
      fechaFin: '2027-05-01',
      categoria: 'OTRO',
      alcanceTipo: 'SEDE',
    });
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('21. PATCH que cruza recurrenciaHasta (existente) con una fechaInicio nueva posterior -> 400 VALIDATION_ERROR', async () => {
    const token = await tokenAdminMerida();
    const creado = await postEvento(token, {
      titulo: 'Evento a mover con recurrencia E2E',
      fechaInicio: '2027-05-10',
      categoria: 'OTRO',
      alcanceTipo: 'SEDE',
      recurrenciaRegla: { frecuencia: 'DIARIA', intervalo: 1 },
      recurrenciaHasta: '2027-05-20',
    });
    expect(creado.status).toBe(201);
    const id = (creado.body as EventoBody).data.id;

    const res = await request(app.getHttpServer())
      .patch(`/eventos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fechaInicio: '2027-05-25' });
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('22. PATCH que cruza fechaFin (existente) con una fechaInicio nueva posterior -> 400 VALIDATION_ERROR', async () => {
    const token = await tokenAdminMerida();
    const creado = await postEvento(token, {
      titulo: 'Evento a mover con fechaFin E2E',
      fechaInicio: '2027-05-10',
      fechaFin: '2027-05-12',
      categoria: 'OTRO',
      alcanceTipo: 'SEDE',
    });
    expect(creado.status).toBe(201);
    const id = (creado.body as EventoBody).data.id;

    const res = await request(app.getHttpServer())
      .patch(`/eventos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fechaInicio: '2027-05-15' });
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('23. GET /eventos?desde=2026-13-45&hasta=2026-13-45 -> 400 VALIDATION_ERROR (regex acotado)', async () => {
    const token = await tokenAdminMerida();
    const res = await getEventos(token, '2026-13-45', '2026-13-45');
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('24. POST con fechaInicio 2026-02-30 (mes/dia individualmente en rango, fecha inexistente) -> 400 VALIDATION_ERROR, no rollover ni 500', async () => {
    const token = await tokenAdminMerida();
    const res = await postEvento(token, {
      titulo: 'Evento fecha inexistente E2E',
      fechaInicio: '2026-02-30',
      categoria: 'OTRO',
      alcanceTipo: 'SEDE',
    });
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  // --- Tarea 3 (Fase 15 pendientes Important, 2026-09-02):
  // `puedeEditar: boolean` en cada `OcurrenciaEvento` de `GET /eventos` —
  // misma regla que `PATCH`/`DELETE /eventos/:id` (autor del evento, o
  // `ADMINISTRATIVO` de la sede del evento), derivada por request. ---

  it('25. GET: un ADMINISTRATIVO ve puedeEditar=true en todo evento de su sede (recurrentes y de otros autores incluidos)', async () => {
    const token = await tokenAdminMerida();

    // Evento recurrente propio del admin — `puedeEditar` debe propagarse a
    // TODAS sus ocurrencias con el mismo valor.
    const recurrente = await postEvento(token, {
      titulo: 'Evento admin recurrente puedeEditar E2E',
      fechaInicio: '2027-06-07',
      categoria: 'OTRO',
      alcanceTipo: 'SEDE',
      recurrenciaRegla: {
        frecuencia: 'SEMANAL',
        intervalo: 1,
        diasSemana: [1],
      },
      recurrenciaHasta: '2027-06-30',
    });
    expect(recurrente.status).toBe(201);
    const recurrenteId = (recurrente.body as EventoBody).data.id;

    // Evento de OTRO autor (el maestro con asignación) en un grupo de la
    // sede del admin — el admin igual puede editarlo.
    const tokenM = await tokenMaestro();
    const deMaestro = await postEvento(tokenM, {
      titulo: 'Evento de maestro visto por admin E2E',
      fechaInicio: '2027-06-08',
      categoria: 'OTRO',
      alcanceTipo: 'GRUPO',
      alcanceId: grupoConAsignacionId,
    });
    expect(deMaestro.status).toBe(201);
    const deMaestroId = (deMaestro.body as EventoBody).data.id;

    const res = await getEventos(token, '2027-06-07', '2027-06-30');
    expect(res.status).toBe(200);
    const data = (res.body as OcurrenciaListBody).data;

    const ocurrenciasRecurrente = data.filter(
      (o) => o.eventoId === recurrenteId,
    );
    expect(ocurrenciasRecurrente.length).toBeGreaterThanOrEqual(2);
    for (const o of ocurrenciasRecurrente) {
      expect(o.puedeEditar).toBe(true);
    }

    const ocurrenciasDeMaestro = data.filter((o) => o.eventoId === deMaestroId);
    expect(ocurrenciasDeMaestro).toHaveLength(1);
    expect(ocurrenciasDeMaestro[0].puedeEditar).toBe(true);

    // Invariante: un ADMINISTRATIVO puede editar TODO lo que ve (solo su
    // sede).
    for (const o of data) {
      expect(o.puedeEditar).toBe(true);
    }
  });

  it('26. GET: un MAESTRO ve puedeEditar=true solo en eventos que creó; false en SEDE de un admin y en eventos de otro maestro', async () => {
    const tokenAdmin = await tokenAdminMerida();
    const tokenM = await tokenMaestro();

    // (a) Evento SEDE creado por el admin.
    const sedeDeAdmin = await postEvento(tokenAdmin, {
      titulo: 'Evento SEDE admin para maestro E2E',
      fechaInicio: '2027-06-15',
      categoria: 'OTRO',
      alcanceTipo: 'SEDE',
    });
    expect(sedeDeAdmin.status).toBe(201);
    const sedeDeAdminId = (sedeDeAdmin.body as EventoBody).data.id;

    // (b) Evento GRUPO creado por ESTE maestro en su grupo asignado.
    const propioDelMaestro = await postEvento(tokenM, {
      titulo: 'Evento GRUPO propio del maestro E2E',
      fechaInicio: '2027-06-15',
      categoria: 'OTRO',
      alcanceTipo: 'GRUPO',
      alcanceId: grupoConAsignacionId,
    });
    expect(propioDelMaestro.status).toBe(201);
    const propioDelMaestroId = (propioDelMaestro.body as EventoBody).data.id;

    // (c) Segundo maestro co-asignado al MISMO grupo (co-docencia) crea otro
    // evento GRUPO — el primer maestro lo VE (comparte grupo) pero NO puede
    // editarlo.
    const segundoMaestroId = await crearMaestro(sedeMeridaId);
    const materiaCoId = await crearMateria(carreraLaeId, 1);
    const asignacionCo = await request(app.getHttpServer())
      .post(`/grupos/${grupoConAsignacionId}/asignaciones`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ materiaId: materiaCoId, usuarioId: segundoMaestroId });
    expect(asignacionCo.status).toBe(201);
    asignacionIdsCreados.push(
      (asignacionCo.body as { data: { id: string } }).data.id,
    );

    const tokenSegundoMaestro = await firmarToken(
      segundoMaestroId,
      RolUsuario.MAESTRO,
      sedeMeridaId,
    );
    const deOtroMaestro = await postEvento(tokenSegundoMaestro, {
      titulo: 'Evento GRUPO de otro maestro E2E',
      fechaInicio: '2027-06-15',
      categoria: 'OTRO',
      alcanceTipo: 'GRUPO',
      alcanceId: grupoConAsignacionId,
    });
    expect(deOtroMaestro.status).toBe(201);
    const deOtroMaestroId = (deOtroMaestro.body as EventoBody).data.id;

    const res = await getEventos(tokenM, '2027-06-15', '2027-06-15');
    expect(res.status).toBe(200);
    const data = (res.body as OcurrenciaListBody).data;
    const porId = (id: string) => data.find((o) => o.eventoId === id);

    expect(porId(propioDelMaestroId)?.puedeEditar).toBe(true);
    expect(porId(sedeDeAdminId)?.puedeEditar).toBe(false);
    expect(porId(deOtroMaestroId)?.puedeEditar).toBe(false);
  });

  it('27. GET: un ALUMNO ve puedeEditar=false en todo evento (SEDE y de su grupo)', async () => {
    const tokenAdmin = await tokenAdminMerida();

    const sedeEvt = await postEvento(tokenAdmin, {
      titulo: 'Evento SEDE para alumno puedeEditar E2E',
      fechaInicio: '2027-07-01',
      categoria: 'OTRO',
      alcanceTipo: 'SEDE',
    });
    expect(sedeEvt.status).toBe(201);
    const grupoEvt = await postEvento(tokenAdmin, {
      titulo: 'Evento GRUPO para alumno puedeEditar E2E',
      fechaInicio: '2027-07-01',
      categoria: 'OTRO',
      alcanceTipo: 'GRUPO',
      alcanceId: grupoMatriculadoId,
    });
    expect(grupoEvt.status).toBe(201);
    const sedeEvtId = (sedeEvt.body as EventoBody).data.id;
    const grupoEvtId = (grupoEvt.body as EventoBody).data.id;

    const tokenA = await tokenAlumno();
    const res = await getEventos(tokenA, '2027-07-01', '2027-07-01');
    expect(res.status).toBe(200);
    const data = (res.body as OcurrenciaListBody).data;
    expect(data.map((o) => o.eventoId)).toEqual(
      expect.arrayContaining([sedeEvtId, grupoEvtId]),
    );
    for (const o of data) {
      expect(o.puedeEditar).toBe(false);
    }
  });

  // --- Task 4 (Fase 15 polish, 2026-09-02): notificación in-app
  // `EVENTO_NUEVO` best-effort al crear un evento. Un fallo del efecto NO
  // tumba el `POST /eventos` (mismo criterio que el correo de bienvenida
  // en `PersonasService`). El shape de la respuesta NO cambia. ---
  describe('POST /eventos — notificación EVENTO_NUEVO', () => {
    let grupoNotifId: string;
    let grupoVacioId: string;
    let maestroNotifUsuarioId: string;
    const alumnoNotifUsuarioIds: string[] = [];
    const alumnoNotifPerfilIds: string[] = [];
    const eventoIdsNotif: string[] = [];

    async function crearAlumnoMatriculado(
      grupoId: string,
      carreraId: string,
      sedeId: string,
    ): Promise<{ usuarioId: string; perfilId: string }> {
      const usuario = await prisma.usuario.create({
        data: {
          id: randomUUID(),
          email: `fixture.cal.alumno.${randomUUID()}@example.com`,
          rol: RolUsuario.ALUMNO,
          sedeId,
        },
      });
      usuarioIdsCreados.push(usuario.id);
      const perfil = await prisma.perfilAlumno.create({
        data: {
          usuarioId: usuario.id,
          nombres: 'Fixture',
          apellidoPaterno: 'CalAlumno',
          apellidoMaterno: `Z${randomUUID().slice(0, 4)}`,
          curp: `FA${randomUUID().slice(0, 16).toUpperCase()}`,
          fechaNacimiento: new Date('2005-01-01'),
          matricula: `ACALE2E${randomUUID().slice(0, 8).toUpperCase()}`,
          correoPersonal: `fixture.cal.alumno.p.${randomUUID()}@example.com`,
          carreraId,
          estatusAcademico: 'INSCRITO',
          periodoIngreso: '2027-1',
          semestreActual: 1,
        },
      });
      await prisma.grupoAlumno.create({
        data: { grupoId, alumnoId: perfil.id },
      });
      return { usuarioId: usuario.id, perfilId: perfil.id };
    }

    beforeAll(async () => {
      grupoNotifId = await crearGrupo({
        sedeId: sedeMeridaId,
        carreraId: carreraLaeId,
        salonId: salonMeridaId,
        cicloActual: 1,
      });
      grupoVacioId = await crearGrupo({
        sedeId: sedeMeridaId,
        carreraId: carreraLaeId,
        salonId: salonMeridaId,
        cicloActual: 1,
      });

      // 2 alumnos matriculados en el grupo con notificación.
      for (let i = 0; i < 2; i++) {
        const { usuarioId, perfilId } = await crearAlumnoMatriculado(
          grupoNotifId,
          carreraLaeId,
          sedeMeridaId,
        );
        alumnoNotifUsuarioIds.push(usuarioId);
        alumnoNotifPerfilIds.push(perfilId);
      }

      // 1 maestro asignado (GrupoMateriaMaestro) al mismo grupo.
      const materiaId = await crearMateria(carreraLaeId, 1);
      maestroNotifUsuarioId = await crearMaestro(sedeMeridaId);
      const maestroPerfil = await prisma.perfilMaestro.findUniqueOrThrow({
        where: { usuarioId: maestroNotifUsuarioId },
      });
      await prisma.grupoMateriaMaestro.create({
        data: {
          grupoId: grupoNotifId,
          materiaId,
          maestroId: maestroPerfil.id,
        },
      });
    }, 30000);

    afterAll(async () => {
      // Orden FK-safe, acotado a los ids exactos de esta corrida (regla 14):
      // notificaciones de estos eventos -> GrupoAlumno de estos grupos.
      // Los `EventoCalendario`/`Grupo`/`Materia`/`PerfilMaestro`/`Usuario`
      // (con cascade a `PerfilAlumno`) los limpia el `afterAll` externo por
      // sus arrays compartidos.
      if (eventoIdsNotif.length > 0) {
        await prisma.notificacion.deleteMany({
          where: { referenciaId: { in: eventoIdsNotif } },
        });
      }
      if (alumnoNotifPerfilIds.length > 0) {
        await prisma.grupoAlumno.deleteMany({
          where: { alumnoId: { in: alumnoNotifPerfilIds } },
        });
      }
    });

    it('A. POST /eventos GRUPO por ADMINISTRATIVO -> 201 (shape intacto) + 1 Notificacion EVENTO_NUEVO por destinatario, ninguna para el autor', async () => {
      const token = await tokenAdminMerida();
      const res = await postEvento(token, {
        titulo: 'Evento con notificacion E2E',
        fechaInicio: '2027-08-01',
        categoria: 'SOCIAL',
        alcanceTipo: 'GRUPO',
        alcanceId: grupoNotifId,
      });
      expect(res.status).toBe(201);
      const body = res.body as EventoBody;
      expect(body.data.id).toEqual(expect.any(String));
      expect(body.data.titulo).toBe('Evento con notificacion E2E');
      // El shape de la respuesta NO gana campos nuevos.
      expect(body.data).not.toHaveProperty('notificacionesCreadas');
      expect(body.data).not.toHaveProperty('destinatarios');

      const eventoId = body.data.id;
      eventoIdsNotif.push(eventoId);

      const notifs = await prisma.notificacion.findMany({
        where: { referenciaId: eventoId, tipo: 'EVENTO_NUEVO' },
      });
      expect(notifs).toHaveLength(3);

      const destinatarios = notifs.map((n) => n.usuarioId).sort();
      expect(destinatarios).toEqual(
        [...alumnoNotifUsuarioIds, maestroNotifUsuarioId].sort(),
      );
      expect(destinatarios).not.toContain(adminMeridaId);

      for (const n of notifs) {
        expect(n.titulo.startsWith('Nuevo evento: ')).toBe(true);
        expect(n.cuerpoCorto.length).toBeGreaterThan(0);
        expect(n.sedeId).toBe(sedeMeridaId);
      }
    });

    it('B. POST /eventos GRUPO sin alumnos ni maestros -> 201 y 0 notificaciones, sin fallar', async () => {
      const token = await tokenAdminMerida();
      const res = await postEvento(token, {
        titulo: 'Evento grupo vacio E2E',
        fechaInicio: '2027-08-02',
        categoria: 'SOCIAL',
        alcanceTipo: 'GRUPO',
        alcanceId: grupoVacioId,
      });
      expect(res.status).toBe(201);
      const eventoId = (res.body as EventoBody).data.id;
      eventoIdsNotif.push(eventoId);

      const total = await prisma.notificacion.count({
        where: { referenciaId: eventoId },
      });
      expect(total).toBe(0);
    });
  });

  // --- Task 6 (Fase 15 polish, 2026-09-02): `GET /eventos/listado` —
  // un row por evento BASE (no ocurrencias, a diferencia de `GET /eventos`),
  // con filtros `desde`/`hasta`/`alcanceTipo`/`categoria` + paginación, sin
  // tope de rango. Solo `ADMINISTRATIVO`. `recurrenciaResumen`/`alcanceNombre`/
  // `autorNombre` derivados por request (regla 1). Fixtures propias en una
  // sede FRESCA (el resto de la suite ensucia `sedeMeridaId` con decenas de
  // eventos, incompatible con `total === 3`). ---
  describe('GET /eventos/listado', () => {
    interface ListadoBody {
      data: Array<{
        id: string;
        titulo: string;
        descripcion: string | null;
        fechaInicio: string;
        fechaFin: string | null;
        horaInicio: string | null;
        categoria: string;
        alcanceTipo: string;
        alcanceId: string | null;
        alcanceNombre: string;
        esRecurrente: boolean;
        recurrenciaResumen: string | null;
        recurrenciaHasta: string | null;
        autorNombre: string;
        createdAt: string;
      }>;
      page: number;
      limit: number;
      total: number;
    }

    let sedeAId: string;
    let carreraAId: string;
    let carreraANombre: string;
    let salonAId: string;
    let grupoAId: string;
    let grupoANombre: string;
    let adminAUsuarioId: string;

    let eventoSedeId: string;
    let eventoCarreraId: string;
    let eventoGrupoId: string;
    let eventoOtraSedeId: string;

    const listadoSedeIds: string[] = [];
    const listadoCarreraIds: string[] = [];
    const listadoSalonIds: string[] = [];
    const listadoGrupoIds: string[] = [];
    const listadoUsuarioIds: string[] = [];
    const listadoEventoIds: string[] = [];

    const tokenAdminA = () =>
      firmarToken(adminAUsuarioId, RolUsuario.ADMINISTRATIVO, sedeAId);

    function getListado(token: string, qs = ''): Promise<request.Response> {
      return request(app.getHttpServer())
        .get(`/eventos/listado${qs}`)
        .set('Authorization', `Bearer ${token}`);
    }

    async function postEventoA(
      token: string,
      body: Record<string, unknown>,
    ): Promise<string> {
      const res = await request(app.getHttpServer())
        .post('/eventos')
        .set('Authorization', `Bearer ${token}`)
        .send(body);
      if (res.status !== 201) {
        throw new Error(
          `No se pudo crear la fixture de evento: ${JSON.stringify(res.body)}`,
        );
      }
      const id = (res.body as EventoBody).data.id;
      listadoEventoIds.push(id);
      return id;
    }

    beforeAll(async () => {
      const sede = await prisma.sede.create({
        data: {
          nombre: `CESP Listado E2E ${randomUUID().slice(0, 8)}`,
          direccion: 'Calle Fixture 1',
          ubicacionReferencia: 'Fixture',
          telefono: '9990000000',
        },
      });
      sedeAId = sede.id;
      listadoSedeIds.push(sede.id);

      const carrera = await prisma.carrera.create({
        data: {
          nombre: `Carrera Listado E2E ${randomUUID().slice(0, 8)}`,
          clave: `LST-${randomUUID().slice(0, 12).toUpperCase()}`,
          sedeId: sedeAId,
          duracion: 8,
          nivel: 'LICENCIATURA',
          modalidad: 'PRESENCIAL',
          rvoe: 'RVOE-TEST',
          descripcion: 'Fixture de GET /eventos/listado',
        },
      });
      carreraAId = carrera.id;
      carreraANombre = carrera.nombre;
      listadoCarreraIds.push(carrera.id);

      const salon = await prisma.salon.create({
        data: { sedeId: sedeAId, nombre: 'Aula Listado E2E', capacidad: 30 },
      });
      salonAId = salon.id;
      listadoSalonIds.push(salon.id);

      const grupo = await prisma.grupo.create({
        data: {
          sedeId: sedeAId,
          carreraId: carreraAId,
          salonId: salonAId,
          nombre: `Grupo Listado E2E ${randomUUID().slice(0, 8)}`,
          anioInicio: 2027,
          cicloActual: 1,
          capacidad: 30,
        },
      });
      grupoAId = grupo.id;
      grupoANombre = grupo.nombre;
      listadoGrupoIds.push(grupo.id);

      const admin = await prisma.usuario.create({
        data: {
          id: randomUUID(),
          email: `fixture.cal.listado.admin.${randomUUID()}@example.com`,
          rol: RolUsuario.ADMINISTRATIVO,
          sedeId: sedeAId,
        },
      });
      adminAUsuarioId = admin.id;
      listadoUsuarioIds.push(admin.id);

      const token = await tokenAdminA();

      eventoSedeId = await postEventoA(token, {
        titulo: 'Listado SEDE E2E',
        descripcion: 'Evento de alcance sede',
        fechaInicio: '2027-10-05',
        categoria: 'SOCIAL',
        alcanceTipo: 'SEDE',
      });
      eventoCarreraId = await postEventoA(token, {
        titulo: 'Listado CARRERA E2E',
        fechaInicio: '2027-10-10',
        categoria: 'EXAMEN',
        alcanceTipo: 'CARRERA',
        alcanceId: carreraAId,
      });
      eventoGrupoId = await postEventoA(token, {
        titulo: 'Listado GRUPO recurrente E2E',
        fechaInicio: '2027-10-04',
        categoria: 'OTRO',
        alcanceTipo: 'GRUPO',
        alcanceId: grupoAId,
        recurrenciaRegla: {
          frecuencia: 'SEMANAL',
          intervalo: 1,
          diasSemana: [1, 3],
        },
        recurrenciaHasta: '2027-12-31',
      });

      // 2ª sede con su propio admin y 1 evento (aislamiento cross-sede).
      const tokenValladolid = await tokenAdminValladolid();
      eventoOtraSedeId = await postEventoA(tokenValladolid, {
        titulo: 'Listado otra sede E2E',
        fechaInicio: '2027-10-06',
        categoria: 'SOCIAL',
        alcanceTipo: 'SEDE',
      });
    }, 30000);

    afterAll(async () => {
      // Orden FK-safe, acotado a los ids exactos de esta corrida (regla 14).
      if (listadoEventoIds.length > 0) {
        await prisma.registroAuditoria.deleteMany({
          where: {
            entidad: 'EventoCalendario',
            entidadId: { in: listadoEventoIds },
          },
        });
        await prisma.notificacion.deleteMany({
          where: { referenciaId: { in: listadoEventoIds } },
        });
        await prisma.recordatorioEnviado.deleteMany({
          where: { eventoId: { in: listadoEventoIds } },
        });
        await prisma.eventoCalendario.deleteMany({
          where: { id: { in: listadoEventoIds } },
        });
      }
      if (listadoGrupoIds.length > 0) {
        await prisma.grupo.deleteMany({
          where: { id: { in: listadoGrupoIds } },
        });
      }
      if (listadoSalonIds.length > 0) {
        await prisma.salon.deleteMany({
          where: { id: { in: listadoSalonIds } },
        });
      }
      if (listadoCarreraIds.length > 0) {
        await prisma.carrera.deleteMany({
          where: { id: { in: listadoCarreraIds } },
        });
      }
      if (listadoUsuarioIds.length > 0) {
        await prisma.usuario.deleteMany({
          where: { id: { in: listadoUsuarioIds } },
        });
      }
      if (listadoSedeIds.length > 0) {
        await prisma.registroAuditoria.deleteMany({
          where: { sedeId: { in: listadoSedeIds } },
        });
        await prisma.sede.deleteMany({
          where: { id: { in: listadoSedeIds } },
        });
      }
    });

    it('A. ADMINISTRATIVO lista sin filtros -> los 3 eventos de su sede, no el de la otra; shape { data, page, limit, total }', async () => {
      const res = await getListado(await tokenAdminA());
      expect(res.status).toBe(200);
      const body = res.body as ListadoBody;
      expect(Array.isArray(body.data)).toBe(true);
      expect(body).toHaveProperty('page');
      expect(body).toHaveProperty('limit');
      expect(body.total).toBe(3);
      const ids = body.data.map((e) => e.id);
      expect(ids).toEqual(
        expect.arrayContaining([eventoSedeId, eventoCarreraId, eventoGrupoId]),
      );
      expect(ids).not.toContain(eventoOtraSedeId);
    });

    it('B. recurrenciaResumen + alcanceNombre derivados', async () => {
      const res = await getListado(await tokenAdminA());
      expect(res.status).toBe(200);
      const body = res.body as ListadoBody;

      const grupo = body.data.find((e) => e.id === eventoGrupoId);
      expect(grupo).toBeDefined();
      expect(grupo?.esRecurrente).toBe(true);
      expect(grupo?.recurrenciaResumen).toContain('semana');
      expect(grupo?.recurrenciaResumen).toContain('Lun');
      expect(grupo?.recurrenciaResumen).toContain('Mié');
      expect(grupo?.recurrenciaHasta).toBe('2027-12-31');
      expect(grupo?.alcanceNombre).toBe(grupoANombre);

      const carrera = body.data.find((e) => e.id === eventoCarreraId);
      expect(carrera?.alcanceNombre).toBe(carreraANombre);

      const sedeEvt = body.data.find((e) => e.id === eventoSedeId);
      expect(sedeEvt?.alcanceNombre).toBe('Toda la sede');
      expect(sedeEvt?.esRecurrente).toBe(false);
      expect(sedeEvt?.recurrenciaResumen).toBeNull();
    });

    it('C. filtro alcanceTipo=CARRERA -> solo el evento CARRERA', async () => {
      const res = await getListado(await tokenAdminA(), '?alcanceTipo=CARRERA');
      expect(res.status).toBe(200);
      const body = res.body as ListadoBody;
      expect(body.total).toBe(1);
      expect(body.data.map((e) => e.id)).toEqual([eventoCarreraId]);
    });

    it('D. filtro categoria=EXAMEN -> solo el evento EXAMEN', async () => {
      const res = await getListado(await tokenAdminA(), '?categoria=EXAMEN');
      expect(res.status).toBe(200);
      const body = res.body as ListadoBody;
      expect(body.total).toBe(1);
      expect(body.data.map((e) => e.id)).toEqual([eventoCarreraId]);
    });

    it('E. paginación ?limit=1&page=2 -> 1 fila, page 2, total 3', async () => {
      const res = await getListado(await tokenAdminA(), '?limit=1&page=2');
      expect(res.status).toBe(200);
      const body = res.body as ListadoBody;
      expect(body.data).toHaveLength(1);
      expect(body.page).toBe(2);
      expect(body.limit).toBe(1);
      expect(body.total).toBe(3);
    });

    it('F. un MAESTRO y un ALUMNO -> 403', async () => {
      const resMaestro = await getListado(await tokenMaestro());
      expect(resMaestro.status).toBe(403);
      expect((resMaestro.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');

      const resAlumno = await getListado(await tokenAlumno());
      expect(resAlumno.status).toBe(403);
      expect((resAlumno.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
    });

    it('G. query inválida ?limit=999 -> 400 VALIDATION_ERROR', async () => {
      const res = await getListado(await tokenAdminA(), '?limit=999');
      expect(res.status).toBe(400);
      expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
    });
  });
});
