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
interface AvisoBody {
  data: {
    id: string;
    sedeId: string;
    autorUsuarioId: string;
    titulo: string;
    cuerpo: string;
    alcanceTipo: string;
    alcanceId: string | null;
    createdAt: string;
  };
}
interface FeedItemBody {
  id: string;
  titulo: string;
  cuerpo: string;
  autor: { nombres: string; apellidoPaterno: string };
  createdAt: string;
  leidoEn: string | null;
}
interface FeedBody {
  data: FeedItemBody[];
  page: number;
  limit: number;
  total: number;
}
interface AvisoPublicadoItemBody {
  id: string;
  titulo: string;
  cuerpo: string;
  alcanceTipo: string;
  alcanceId: string | null;
  alcanceNombre: string | null;
  createdAt: string;
  totalDestinatarios: number;
  leidos: number;
}
interface DetalleBody {
  data: FeedItemBody;
}
interface ReciboItemBody {
  usuarioId: string;
  nombreCompleto: string;
  rol: string;
  leidoEn: string | null;
}
interface RecibosBody {
  data: {
    total: number;
    leidos: number;
    noLeidos: number;
    destinatarios: ReciboItemBody[];
  };
}
interface OkBody {
  data: { ok: true };
}

/**
 * Suite e2e de `avisos` (Fase 16, Día 46 — Task 2: `POST /avisos`). Calca
 * el scaffolding de `test/calendario.e2e-spec.ts` (JWT firmado con `jose`
 * ES256 `kid:'test-key-1'`, sedes/personas reales de `prisma/seed.ts`
 * ubicadas en `beforeAll`, override de `SEDE_GUARD_ENV_OVERRIDE`).
 *
 * La fixture de un GRUPO con un alumno matriculado + un maestro asignado
 * (`GrupoMateriaMaestro`) se construye DESDE CERO — `Grupo` + `Materia` +
 * `Usuario`/`PerfilMaestro`/`PerfilAlumno` propios + la asignación vía el
 * endpoint real `POST /grupos/:id/asignaciones` — para no depender de
 * ninguna fila ambiental de la DB de dev. Todo lo creado se limpia en
 * `afterAll` acotado a los ids exactos de esta corrida (regla 14), nunca
 * por patrón de nombre/email, en orden inverso de dependencia.
 */
describe('AvisosController (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let sedeMeridaId: string;
  let sedeValladolidId: string;
  let adminMeridaId: string;
  let adminValladolidId: string;
  let carreraId: string;
  let salonId: string;
  let grupoId: string;
  let maestroConAsignacionId: string;
  let alumnoMatriculadoId: string;
  let otroAlumnoMeridaId: string;

  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';

  const avisoIdsCreados: string[] = [];
  // Avisos que un caso de test ya borró vía DELETE /avisos/:id: salen de
  // `avisoIdsCreados` para que el `afterAll` no re-borre, pero sus filas de
  // `RegistroAuditoria` (ALTA del autor + ELIMINACION) siguen en la DB y hay
  // que limpiarlas igual (acotado a ids exactos, regla 14).
  const avisoIdsBorradosEnTest: string[] = [];
  const grupoIdsCreados: string[] = [];
  const materiaIdsCreados: string[] = [];
  const usuarioIdsCreados: string[] = [];
  const perfilAlumnoIdsCreados: string[] = [];
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

  async function postAviso(
    token: string,
    body: Record<string, unknown>,
  ): Promise<request.Response> {
    const res = await request(app.getHttpServer())
      .post('/avisos')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    if (res.status === 201) {
      avisoIdsCreados.push((res.body as AvisoBody).data.id);
    }
    return res;
  }

  async function crearMaestro(sedeId: string): Promise<string> {
    const usuario = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.avisos.maestro.${randomUUID()}@example.com`,
        rol: RolUsuario.MAESTRO,
        sedeId,
      },
    });
    usuarioIdsCreados.push(usuario.id);
    await prisma.perfilMaestro.create({
      data: {
        usuarioId: usuario.id,
        nombres: 'Fixture',
        apellidoPaterno: 'AvisosMaestro',
        apellidoMaterno: `Z${randomUUID().slice(0, 4)}`,
        curp: `FX${randomUUID().slice(0, 16).toUpperCase()}`,
        cedulaProfesional: `${randomUUID().slice(0, 7)}`,
        correoPersonal: `fixture.avisos.maestro.p.${randomUUID()}@example.com`,
        telefono: '9990000000',
        fechaContratacion: new Date('2024-08-01'),
        estatus: 'ACTIVO',
      },
    });
    return usuario.id;
  }

  async function crearAlumnoMatriculado(
    grupoDestinoId: string,
    carreraDestinoId: string,
    sedeId: string,
    matricular: boolean,
  ): Promise<string> {
    const usuario = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.avisos.alumno.${randomUUID()}@example.com`,
        rol: RolUsuario.ALUMNO,
        sedeId,
      },
    });
    usuarioIdsCreados.push(usuario.id);
    const perfil = await prisma.perfilAlumno.create({
      data: {
        usuarioId: usuario.id,
        nombres: 'Fixture',
        apellidoPaterno: 'AvisosAlumno',
        apellidoMaterno: `Z${randomUUID().slice(0, 4)}`,
        curp: `FA${randomUUID().slice(0, 16).toUpperCase()}`,
        fechaNacimiento: new Date('2005-01-01'),
        matricula: `AAVISE2E${randomUUID().slice(0, 8).toUpperCase()}`,
        correoPersonal: `fixture.avisos.alumno.p.${randomUUID()}@example.com`,
        carreraId: carreraDestinoId,
        estatusAcademico: 'INSCRITO',
        periodoIngreso: '2027-1',
        cuatrimestreActual: 1,
      },
    });
    perfilAlumnoIdsCreados.push(perfil.id);
    if (matricular) {
      await prisma.grupoAlumno.create({
        data: { grupoId: grupoDestinoId, alumnoId: perfil.id },
      });
    }
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

    carreraId = (
      await prisma.carrera.findFirstOrThrow({ where: { sedeId: sedeMeridaId } })
    ).id;
    salonId = (
      await prisma.salon.findFirstOrThrow({ where: { sedeId: sedeMeridaId } })
    ).id;

    const grupo = await prisma.grupo.create({
      data: {
        sedeId: sedeMeridaId,
        carreraId,
        salonId,
        nombre: `Grupo AVISO E2E ${randomUUID().slice(0, 8)}`,
        anioInicio: 2027,
        cicloActual: 1,
        capacidad: 10,
      },
    });
    grupoId = grupo.id;
    grupoIdsCreados.push(grupo.id);

    const materia = await prisma.materia.create({
      data: {
        carreraId,
        nombre: `Materia AVISO E2E ${randomUUID().slice(0, 8)}`,
        ciclo: 1,
      },
    });
    materiaIdsCreados.push(materia.id);

    maestroConAsignacionId = await crearMaestro(sedeMeridaId);

    const asignacionRes = await request(app.getHttpServer())
      .post(`/grupos/${grupoId}/asignaciones`)
      .set('Authorization', `Bearer ${await tokenAdminMerida()}`)
      .send({ materiaId: materia.id, usuarioId: maestroConAsignacionId });
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

    // Alumno matriculado en el grupo + un segundo alumno de Mérida NO
    // matriculado (para verificar que un aviso de alcance GRUPO no le llega).
    alumnoMatriculadoId = await crearAlumnoMatriculado(
      grupoId,
      carreraId,
      sedeMeridaId,
      true,
    );
    otroAlumnoMeridaId = await crearAlumnoMatriculado(
      grupoId,
      carreraId,
      sedeMeridaId,
      false,
    );
  }, 30000);

  afterAll(async () => {
    const todosLosAvisoIds = [...avisoIdsCreados, ...avisoIdsBorradosEnTest];
    if (todosLosAvisoIds.length > 0) {
      await prisma.notificacion.deleteMany({
        where: { referenciaId: { in: todosLosAvisoIds } },
      });
      await prisma.aviso.deleteMany({
        where: { id: { in: todosLosAvisoIds } },
      });
      await prisma.registroAuditoria.deleteMany({
        where: { entidad: 'Aviso', entidadId: { in: todosLosAvisoIds } },
      });
    }
    // Audits cuyo actor es una persona-fixture de esta corrida (p. ej. el
    // ALTA de un aviso publicado por un maestro que luego se borró): sin
    // esto, borrar el `Usuario` dispara `ON DELETE SET NULL` y viola el
    // CHECK XOR `registro_auditoria_actor_check`.
    if (usuarioIdsCreados.length > 0) {
      await prisma.registroAuditoria.deleteMany({
        where: { usuarioId: { in: usuarioIdsCreados } },
      });
    }
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
      await prisma.grupoAlumno.deleteMany({
        where: { grupoId: { in: grupoIdsCreados } },
      });
      await prisma.grupo.deleteMany({ where: { id: { in: grupoIdsCreados } } });
    }
    if (materiaIdsCreados.length > 0) {
      await prisma.materia.deleteMany({
        where: { id: { in: materiaIdsCreados } },
      });
    }
    if (perfilAlumnoIdsCreados.length > 0) {
      await prisma.perfilAlumno.deleteMany({
        where: { id: { in: perfilAlumnoIdsCreados } },
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

  describe('POST /avisos', () => {
    it('admin publica a un GRUPO: 201, crea una Notificacion por matriculado + maestro asignado, excluye al autor', async () => {
      const res = await postAviso(await tokenAdminMerida(), {
        titulo: 'Junta de padres',
        cuerpo: 'El viernes a las 5pm en el auditorio.',
        alcanceTipo: 'GRUPO',
        alcanceId: grupoId,
      });
      expect(res.status).toBe(201);
      expect((res.body as AvisoBody).data).toMatchObject({
        titulo: 'Junta de padres',
        alcanceTipo: 'GRUPO',
        alcanceId: grupoId,
        sedeId: sedeMeridaId,
        autorUsuarioId: adminMeridaId,
      });

      const avisoId = (res.body as AvisoBody).data.id;
      const notifs = await prisma.notificacion.findMany({
        where: { referenciaId: avisoId, tipo: 'AVISO' },
      });
      const destinatarios = notifs.map((n) => n.usuarioId).sort();
      expect(destinatarios).toEqual(
        [alumnoMatriculadoId, maestroConAsignacionId].sort(),
      );
      expect(destinatarios).not.toContain(adminMeridaId);
      notifs.forEach((n) => {
        expect(n.titulo).toBe('Junta de padres');
        expect(n.cuerpoCorto.length).toBeLessThanOrEqual(140);
        expect(n.leidoEn).toBeNull();
        expect(n.sedeId).toBe(sedeMeridaId);
      });
    });

    it('cuerpo de más de 140 chars: cuerpoCorto se trunca a los primeros 140', async () => {
      const cuerpoLargo = 'L'.repeat(200);
      const res = await postAviso(await tokenAdminMerida(), {
        titulo: 'Aviso largo',
        cuerpo: cuerpoLargo,
        alcanceTipo: 'GRUPO',
        alcanceId: grupoId,
      });
      expect(res.status).toBe(201);
      const notifs = await prisma.notificacion.findMany({
        where: { referenciaId: (res.body as AvisoBody).data.id, tipo: 'AVISO' },
      });
      expect(notifs.length).toBeGreaterThan(0);
      notifs.forEach((n) => {
        expect(n.cuerpoCorto.length).toBe(140);
        expect(n.cuerpoCorto).toBe(cuerpoLargo.slice(0, 140));
      });
    });

    it('audita ALTA en la misma transacción', async () => {
      const res = await postAviso(await tokenAdminMerida(), {
        titulo: 'Aviso auditado',
        cuerpo: 'x',
        alcanceTipo: 'GRUPO',
        alcanceId: grupoId,
      });
      expect(res.status).toBe(201);
      const audit = await prisma.registroAuditoria.findFirst({
        where: { entidad: 'Aviso', entidadId: (res.body as AvisoBody).data.id },
      });
      expect(audit).not.toBeNull();
      expect(audit!.accion).toBe('ALTA');
      expect(audit!.usuarioId).toBe(adminMeridaId);
      expect(audit!.sedeId).toBe(sedeMeridaId);
    });

    it('maestro publica a un GRUPO donde tiene asignación: 201', async () => {
      const res = await postAviso(await tokenMaestro(), {
        titulo: 'Traer calculadora',
        cuerpo: 'Para el examen del martes.',
        alcanceTipo: 'GRUPO',
        alcanceId: grupoId,
      });
      expect(res.status).toBe(201);
    });

    it('maestro publica a SEDE: 403 ROL_NO_AUTORIZADO', async () => {
      const res = await postAviso(await tokenMaestro(), {
        titulo: 'x',
        cuerpo: 'x',
        alcanceTipo: 'SEDE',
      });
      expect(res.status).toBe(403);
      expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
    });

    it('maestro publica a un grupo ajeno: 403', async () => {
      const grupoAjeno = await prisma.grupo.create({
        data: {
          sedeId: sedeMeridaId,
          carreraId,
          salonId,
          nombre: `Ajeno ${randomUUID().slice(0, 8)}`,
          anioInicio: 2027,
          cicloActual: 1,
          capacidad: 10,
        },
      });
      grupoIdsCreados.push(grupoAjeno.id);
      const res = await postAviso(await tokenMaestro(), {
        titulo: 'x',
        cuerpo: 'x',
        alcanceTipo: 'GRUPO',
        alcanceId: grupoAjeno.id,
      });
      expect(res.status).toBe(403);
    });

    it('alumno publica: 403', async () => {
      const res = await postAviso(await tokenAlumno(), {
        titulo: 'x',
        cuerpo: 'x',
        alcanceTipo: 'SEDE',
      });
      expect(res.status).toBe(403);
    });

    it('alcanceTipo GRUPO sin alcanceId: 400 VALIDATION_ERROR', async () => {
      const res = await postAviso(await tokenAdminMerida(), {
        titulo: 'x',
        cuerpo: 'x',
        alcanceTipo: 'GRUPO',
      });
      expect(res.status).toBe(400);
      expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
    });

    it('alcanceTipo SEDE con alcanceId: 400 VALIDATION_ERROR', async () => {
      const res = await postAviso(await tokenAdminMerida(), {
        titulo: 'x',
        cuerpo: 'x',
        alcanceTipo: 'SEDE',
        alcanceId: grupoId,
      });
      expect(res.status).toBe(400);
    });

    it('titulo vacío: 400', async () => {
      const res = await postAviso(await tokenAdminMerida(), {
        titulo: '',
        cuerpo: 'x',
        alcanceTipo: 'SEDE',
      });
      expect(res.status).toBe(400);
    });

    it('admin de Valladolid publica a un grupo de Mérida: 404 (cross-sede)', async () => {
      const res = await postAviso(await tokenAdminValladolid(), {
        titulo: 'x',
        cuerpo: 'x',
        alcanceTipo: 'GRUPO',
        alcanceId: grupoId,
      });
      expect(res.status).toBe(404);
    });

    it('sin Authorization: 401', async () => {
      const res = await request(app.getHttpServer()).post('/avisos').send({
        titulo: 'x',
        cuerpo: 'x',
        alcanceTipo: 'SEDE',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /avisos y GET /avisos/:id', () => {
    it('el feed del alumno trae solo los avisos que le llegaron, orden createdAt desc', async () => {
      await postAviso(await tokenAdminMerida(), {
        titulo: 'Feed A',
        cuerpo: 'aaa',
        alcanceTipo: 'GRUPO',
        alcanceId: grupoId,
      });
      await postAviso(await tokenAdminMerida(), {
        titulo: 'Feed B',
        cuerpo: 'bbb',
        alcanceTipo: 'GRUPO',
        alcanceId: grupoId,
      });
      const res = await request(app.getHttpServer())
        .get('/avisos?page=1&limit=50')
        .set('Authorization', `Bearer ${await tokenAlumno()}`);
      expect(res.status).toBe(200);
      const body = res.body as FeedBody;
      expect(body.page).toBe(1);
      expect(body).toHaveProperty('total');
      const titulos = body.data.map((a) => a.titulo);
      expect(titulos).toEqual(expect.arrayContaining(['Feed A', 'Feed B']));
      expect(titulos.indexOf('Feed B')).toBeLessThan(titulos.indexOf('Feed A'));
      body.data.forEach((a) => {
        expect(a.autor).toHaveProperty('apellidoPaterno');
      });
    });

    it('GET /avisos/:id devuelve el aviso completo y marca leído (leidoEn pasa de null a fecha)', async () => {
      const pub = await postAviso(await tokenAdminMerida(), {
        titulo: 'Para leer',
        cuerpo: 'contenido completo',
        alcanceTipo: 'GRUPO',
        alcanceId: grupoId,
      });
      const avisoId = (pub.body as AvisoBody).data.id;
      const antes = await prisma.notificacion.findFirst({
        where: { referenciaId: avisoId, usuarioId: alumnoMatriculadoId },
      });
      expect(antes!.leidoEn).toBeNull();

      const res = await request(app.getHttpServer())
        .get(`/avisos/${avisoId}`)
        .set('Authorization', `Bearer ${await tokenAlumno()}`);
      expect(res.status).toBe(200);
      const body = res.body as DetalleBody;
      expect(body.data).toMatchObject({
        titulo: 'Para leer',
        cuerpo: 'contenido completo',
      });
      expect(body.data.leidoEn).not.toBeNull();

      const despues = await prisma.notificacion.findFirst({
        where: { referenciaId: avisoId, usuarioId: alumnoMatriculadoId },
      });
      expect(despues!.leidoEn).not.toBeNull();
    });

    it('GET /avisos/:id es idempotente: una segunda lectura no cambia leidoEn', async () => {
      const pub = await postAviso(await tokenAdminMerida(), {
        titulo: 'Idem',
        cuerpo: 'x',
        alcanceTipo: 'GRUPO',
        alcanceId: grupoId,
      });
      const avisoId = (pub.body as AvisoBody).data.id;
      await request(app.getHttpServer())
        .get(`/avisos/${avisoId}`)
        .set('Authorization', `Bearer ${await tokenAlumno()}`);
      const primera = await prisma.notificacion.findFirst({
        where: { referenciaId: avisoId, usuarioId: alumnoMatriculadoId },
      });
      await new Promise((r) => setTimeout(r, 10));
      await request(app.getHttpServer())
        .get(`/avisos/${avisoId}`)
        .set('Authorization', `Bearer ${await tokenAlumno()}`);
      const segunda = await prisma.notificacion.findFirst({
        where: { referenciaId: avisoId, usuarioId: alumnoMatriculadoId },
      });
      expect(segunda!.leidoEn!.getTime()).toBe(primera!.leidoEn!.getTime());
    });

    it('GET /avisos/:id por alguien que NO era destinatario: 404', async () => {
      const pub = await postAviso(await tokenAdminMerida(), {
        titulo: 'No para ti',
        cuerpo: 'x',
        alcanceTipo: 'GRUPO',
        alcanceId: grupoId,
      });
      const avisoId = (pub.body as AvisoBody).data.id;
      const res = await request(app.getHttpServer())
        .get(`/avisos/${avisoId}`)
        .set(
          'Authorization',
          `Bearer ${await firmarToken(
            otroAlumnoMeridaId,
            RolUsuario.ALUMNO,
            sedeMeridaId,
          )}`,
        );
      expect(res.status).toBe(404);
    });

    it('GET /avisos/:id inexistente: 404', async () => {
      const res = await request(app.getHttpServer())
        .get(`/avisos/${randomUUID()}`)
        .set('Authorization', `Bearer ${await tokenAlumno()}`);
      expect(res.status).toBe(404);
    });

    it('el feed del alumno NO incluye avisos de grupos donde no está matriculado', async () => {
      const grupoSinElAlumno = await prisma.grupo.create({
        data: {
          sedeId: sedeMeridaId,
          carreraId,
          salonId,
          nombre: `Grupo sin el alumno ${randomUUID().slice(0, 8)}`,
          anioInicio: 2027,
          cicloActual: 1,
          capacidad: 10,
        },
      });
      grupoIdsCreados.push(grupoSinElAlumno.id);
      await postAviso(await tokenAdminMerida(), {
        titulo: 'Aviso de grupo ajeno para el feed',
        cuerpo: 'el alumno no deberia ver esto',
        alcanceTipo: 'GRUPO',
        alcanceId: grupoSinElAlumno.id,
      });

      const res = await request(app.getHttpServer())
        .get('/avisos?page=1&limit=100')
        .set('Authorization', `Bearer ${await tokenAlumno()}`);
      expect(res.status).toBe(200);
      const titulos = (res.body as FeedBody).data.map((a) => a.titulo);
      expect(titulos).not.toContain('Aviso de grupo ajeno para el feed');
    });
  });

  describe('GET /avisos/:id/recibos y DELETE /avisos/:id', () => {
    it('el autor ve los recibos: total, leidos, noLeidos y la lista con leidoEn', async () => {
      const pub = await postAviso(await tokenAdminMerida(), {
        titulo: 'Con recibos',
        cuerpo: 'x',
        alcanceTipo: 'GRUPO',
        alcanceId: grupoId,
      });
      // el alumno lo abre -> queda leído; el maestro no
      await request(app.getHttpServer())
        .get(`/avisos/${(pub.body as AvisoBody).data.id}`)
        .set('Authorization', `Bearer ${await tokenAlumno()}`);

      const res = await request(app.getHttpServer())
        .get(`/avisos/${(pub.body as AvisoBody).data.id}/recibos`)
        .set('Authorization', `Bearer ${await tokenAdminMerida()}`);
      expect(res.status).toBe(200);
      const data = (res.body as RecibosBody).data;
      expect(data.total).toBe(2);
      expect(data.leidos).toBe(1);
      expect(data.noLeidos).toBe(1);
      const alumno = data.destinatarios.find(
        (d) => d.usuarioId === alumnoMatriculadoId,
      );
      expect(alumno!.leidoEn).not.toBeNull();
      expect(alumno).toHaveProperty('nombreCompleto');
      expect(alumno).toHaveProperty('rol', 'ALUMNO');
      const maestro = data.destinatarios.find(
        (d) => d.usuarioId === maestroConAsignacionId,
      );
      expect(maestro!.leidoEn).toBeNull();
    });

    it('un ADMINISTRATIVO de la sede que NO es el autor ve los recibos', async () => {
      const pub = await postAviso(await tokenMaestro(), {
        titulo: 'Del maestro',
        cuerpo: 'x',
        alcanceTipo: 'GRUPO',
        alcanceId: grupoId,
      });
      const res = await request(app.getHttpServer())
        .get(`/avisos/${(pub.body as AvisoBody).data.id}/recibos`)
        .set('Authorization', `Bearer ${await tokenAdminMerida()}`);
      expect(res.status).toBe(200);
    });

    it('un MAESTRO que no es el autor: 403', async () => {
      const pub = await postAviso(await tokenAdminMerida(), {
        titulo: 'x',
        cuerpo: 'x',
        alcanceTipo: 'GRUPO',
        alcanceId: grupoId,
      });
      const otroMaestro = await crearMaestro(sedeMeridaId);
      const res = await request(app.getHttpServer())
        .get(`/avisos/${(pub.body as AvisoBody).data.id}/recibos`)
        .set(
          'Authorization',
          `Bearer ${await firmarToken(
            otroMaestro,
            RolUsuario.MAESTRO,
            sedeMeridaId,
          )}`,
        );
      expect(res.status).toBe(403);
      expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
    });

    it('un ALUMNO destinatario: 403 en /recibos', async () => {
      const pub = await postAviso(await tokenAdminMerida(), {
        titulo: 'x',
        cuerpo: 'x',
        alcanceTipo: 'GRUPO',
        alcanceId: grupoId,
      });
      const res = await request(app.getHttpServer())
        .get(`/avisos/${(pub.body as AvisoBody).data.id}/recibos`)
        .set('Authorization', `Bearer ${await tokenAlumno()}`);
      expect(res.status).toBe(403);
    });

    it('recibos de un aviso de otra sede: 404', async () => {
      const pub = await postAviso(await tokenAdminMerida(), {
        titulo: 'x',
        cuerpo: 'x',
        alcanceTipo: 'SEDE',
      });
      const res = await request(app.getHttpServer())
        .get(`/avisos/${(pub.body as AvisoBody).data.id}/recibos`)
        .set('Authorization', `Bearer ${await tokenAdminValladolid()}`);
      expect(res.status).toBe(404);
    });

    it('el autor borra su aviso: 200, se van el Aviso y sus Notificacion, audita ELIMINACION', async () => {
      const pub = await postAviso(await tokenAdminMerida(), {
        titulo: 'Borrable',
        cuerpo: 'x',
        alcanceTipo: 'GRUPO',
        alcanceId: grupoId,
      });
      const avisoId = (pub.body as AvisoBody).data.id;
      const res = await request(app.getHttpServer())
        .delete(`/avisos/${avisoId}`)
        .set('Authorization', `Bearer ${await tokenAdminMerida()}`);
      expect(res.status).toBe(200);
      expect((res.body as OkBody).data).toEqual({ ok: true });
      expect(
        await prisma.aviso.findUnique({ where: { id: avisoId } }),
      ).toBeNull();
      expect(
        await prisma.notificacion.count({ where: { referenciaId: avisoId } }),
      ).toBe(0);
      const audit = await prisma.registroAuditoria.findFirst({
        where: { entidad: 'Aviso', entidadId: avisoId, accion: 'ELIMINACION' },
      });
      expect(audit).not.toBeNull();
      // quitar de avisoIdsCreados para que el afterAll no falle al re-borrar
      const i = avisoIdsCreados.indexOf(avisoId);
      if (i >= 0) avisoIdsCreados.splice(i, 1);
      avisoIdsBorradosEnTest.push(avisoId);
    });

    it('un ADMINISTRATIVO de la sede borra un aviso ajeno (de un maestro): 200', async () => {
      const pub = await postAviso(await tokenMaestro(), {
        titulo: 'x',
        cuerpo: 'x',
        alcanceTipo: 'GRUPO',
        alcanceId: grupoId,
      });
      const res = await request(app.getHttpServer())
        .delete(`/avisos/${(pub.body as AvisoBody).data.id}`)
        .set('Authorization', `Bearer ${await tokenAdminMerida()}`);
      expect(res.status).toBe(200);
      const i = avisoIdsCreados.indexOf((pub.body as AvisoBody).data.id);
      if (i >= 0) avisoIdsCreados.splice(i, 1);
      avisoIdsBorradosEnTest.push((pub.body as AvisoBody).data.id);
    });

    it('un MAESTRO que no es el autor no puede borrar: 403', async () => {
      const pub = await postAviso(await tokenAdminMerida(), {
        titulo: 'x',
        cuerpo: 'x',
        alcanceTipo: 'GRUPO',
        alcanceId: grupoId,
      });
      const otroMaestro = await crearMaestro(sedeMeridaId);
      const res = await request(app.getHttpServer())
        .delete(`/avisos/${(pub.body as AvisoBody).data.id}`)
        .set(
          'Authorization',
          `Bearer ${await firmarToken(
            otroMaestro,
            RolUsuario.MAESTRO,
            sedeMeridaId,
          )}`,
        );
      expect(res.status).toBe(403);
    });

    it('DELETE de un aviso de otra sede: 404', async () => {
      const pub = await postAviso(await tokenAdminMerida(), {
        titulo: 'x',
        cuerpo: 'x',
        alcanceTipo: 'SEDE',
      });
      const res = await request(app.getHttpServer())
        .delete(`/avisos/${(pub.body as AvisoBody).data.id}`)
        .set('Authorization', `Bearer ${await tokenAdminValladolid()}`);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /avisos/publicados', () => {
    it('el autor ve solo los avisos que publicó, no los de otro admin de la misma sede', async () => {
      // Aviso del admin de Mérida
      await postAviso(await tokenAdminMerida(), {
        titulo: 'Publicado por admin Mérida',
        cuerpo: 'x',
        alcanceTipo: 'GRUPO',
        alcanceId: grupoId,
      });
      // Aviso de un maestro de la misma sede (otro autor)
      await postAviso(await tokenMaestro(), {
        titulo: 'Publicado por maestro',
        cuerpo: 'y',
        alcanceTipo: 'GRUPO',
        alcanceId: grupoId,
      });

      const res = await request(app.getHttpServer())
        .get('/avisos/publicados?page=1&limit=50')
        .set('Authorization', `Bearer ${await tokenAdminMerida()}`);

      expect(res.status).toBe(200);
      const body = res.body as {
        data: { titulo: string }[];
        page: number;
        limit: number;
        total: number;
      };
      const titulos = body.data.map((a) => a.titulo);
      expect(titulos).toContain('Publicado por admin Mérida');
      expect(titulos).not.toContain('Publicado por maestro');
      expect(body.page).toBe(1);
    });

    it('no incluye avisos de otra sede', async () => {
      const res = await request(app.getHttpServer())
        .get('/avisos/publicados?page=1&limit=50')
        .set('Authorization', `Bearer ${await tokenAdminValladolid()}`);
      expect(res.status).toBe(200);
      const body = res.body as { data: { id: string }[] };
      // El admin de Valladolid no ha publicado nada en esta suite
      expect(body.data).toEqual([]);
    });

    it('totalDestinatarios y leidos son correctos tras una lectura', async () => {
      const pub = await postAviso(await tokenAdminMerida(), {
        titulo: 'Con recibo',
        cuerpo: 'z',
        alcanceTipo: 'GRUPO',
        alcanceId: grupoId,
      });
      const avisoId = (pub.body as AvisoBody).data.id;

      // El alumno matriculado lo abre → 1 recibo leído
      await request(app.getHttpServer())
        .get(`/avisos/${avisoId}`)
        .set('Authorization', `Bearer ${await tokenAlumno()}`);

      const res = await request(app.getHttpServer())
        .get('/avisos/publicados?page=1&limit=50')
        .set('Authorization', `Bearer ${await tokenAdminMerida()}`);
      const row = (res.body as { data: (AvisoPublicadoItemBody & { id: string })[] }).data.find(
        (a) => a.id === avisoId,
      );
      expect(row).toBeDefined();
      expect(row!.totalDestinatarios).toBeGreaterThanOrEqual(1);
      expect(row!.leidos).toBeGreaterThanOrEqual(1);
      expect(row!.leidos).toBeLessThanOrEqual(row!.totalDestinatarios);
    });

    it('alcanceNombre: "Toda la sede" para SEDE, nombre de grupo para GRUPO', async () => {
      await postAviso(await tokenAdminMerida(), {
        titulo: 'A toda la sede',
        cuerpo: 'a',
        alcanceTipo: 'SEDE',
      });
      const res = await request(app.getHttpServer())
        .get('/avisos/publicados?page=1&limit=50')
        .set('Authorization', `Bearer ${await tokenAdminMerida()}`);
      const data = (res.body as { data: AvisoPublicadoItemBody[] }).data;
      const sede = data.find((a) => a.titulo === 'A toda la sede');
      expect(sede!.alcanceNombre).toBe('Toda la sede');
      const grupo = data.find((a) => a.alcanceTipo === 'GRUPO');
      expect(typeof grupo!.alcanceNombre).toBe('string');
      expect(grupo!.alcanceNombre!.length).toBeGreaterThan(0);
    });

    it('un ALUMNO recibe 403 ROL_NO_AUTORIZADO', async () => {
      const res = await request(app.getHttpServer())
        .get('/avisos/publicados')
        .set('Authorization', `Bearer ${await tokenAlumno()}`);
      expect(res.status).toBe(403);
      expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
    });

    it('limit fuera de rango: 400 VALIDATION_ERROR', async () => {
      const res = await request(app.getHttpServer())
        .get('/avisos/publicados?limit=999')
        .set('Authorization', `Bearer ${await tokenAdminMerida()}`);
      expect(res.status).toBe(400);
      expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
    });
  });
});
