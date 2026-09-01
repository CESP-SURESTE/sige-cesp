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
});
