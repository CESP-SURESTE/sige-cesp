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
interface TelefonoBody {
  data: {
    id: string;
    sedeId: string;
    etiqueta: string;
    telefono: string;
    orden: number;
  };
}
interface TelefonosBody {
  data: Array<{
    id: string;
    sedeId: string;
    etiqueta: string;
    telefono: string;
    orden: number;
  }>;
}
interface OkBody {
  data: { ok: true };
}
interface BusquedaBody {
  data: Array<{
    tipo: string;
    perfilId: string;
    nombreCompleto: string;
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string | null;
    referencia: string;
    activo: boolean;
  }>;
}
interface ExpedienteBody {
  data: {
    tipo: string;
    perfilId: string;
    identidad: {
      nombres: string;
      apellidoPaterno: string;
      apellidoMaterno: string | null;
      curp: string | null;
      telefono: string | null;
      correoPersonal: string | null;
      referencia: string;
      fechaNacimiento: string | null;
      edad: number | null;
      activo: boolean;
    };
    infoMedica: {
      tieneCondicionMedica: boolean;
      tipoSangre: string | null;
      padecimiento: string | null;
      medicamentos: string | null;
      alergias: string | null;
      tratamientoAdicional: string | null;
    } | null;
    contactos: Array<{
      nombre: string;
      telefono: string;
      correo: string | null;
      parentesco: string;
      tipo: 'TUTOR' | 'EMERGENCIA' | null;
      orden: number;
    }>;
  };
}

/**
 * Andamiaje compartido por los `describe` de Task 3 (`/emergencia/buscar` y
 * `/emergencia/expediente/...`) — mismo patrón de JWKS de prueba que el
 * bloque de `/emergencia/telefonos` de Task 2, extraído a nivel de módulo
 * para no duplicar el arranque de la app NestJS en cada bloque nuevo.
 */
const TEST_KID = 'test-key-1';
const TEST_ALG = 'ES256';

async function bootEmergenciaApp(): Promise<{
  app: INestApplication<App>;
  prisma: PrismaService;
  jose: typeof import('jose');
  privateKey: CryptoKey;
}> {
  const jose = await import('jose');
  const keyPair = await jose.generateKeyPair(TEST_ALG, { extractable: true });
  const publicJwk = await jose.exportJWK(keyPair.publicKey);
  publicJwk.kid = TEST_KID;
  publicJwk.alg = TEST_ALG;
  publicJwk.use = 'sig';

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(SEDE_GUARD_ENV_OVERRIDE)
    .useValue({ jwks: { keys: [publicJwk] } })
    .compile();

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();

  const prisma = moduleFixture.get(PrismaService);
  return { app, prisma, jose, privateKey: keyPair.privateKey };
}

/**
 * Módulo de emergencia — CRUD de teléfonos de emergencia por sede
 * (`TelefonoEmergenciaSede`, Task 1). Mismo andamiaje de JWKS de prueba que
 * `salones.e2e-spec.ts`: JWT firmado con `jose`, inyectado vía
 * `SEDE_GUARD_ENV_OVERRIDE`. `sub` del token = el `usuarioId` real del admin
 * ANCLA de Mérida (`ana.canul@cesp-merida.edu.mx`, ver `prisma/seed.ts`).
 */
describe('EmergenciaController — /emergencia/telefonos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let sedeValladolidId: string;
  let actorUsuarioId: string;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';
  const telefonoIdsCreados: string[] = [];

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
      where: {
        entidad: 'TelefonoEmergenciaSede',
        entidadId: { in: telefonoIdsCreados },
      },
    });
    await prisma.telefonoEmergenciaSede.deleteMany({
      where: { id: { in: telefonoIdsCreados } },
    });
    await app.close();
  });

  it('POST /emergencia/telefonos crea con orden incremental y audita ALTA', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });
    const r1 = await request(app.getHttpServer())
      .post('/emergencia/telefonos')
      .set('Authorization', `Bearer ${token}`)
      .send({ etiqueta: 'Cruz Roja E2E', telefono: '911' })
      .expect(201);
    const r2 = await request(app.getHttpServer())
      .post('/emergencia/telefonos')
      .set('Authorization', `Bearer ${token}`)
      .send({ etiqueta: 'Bomberos E2E', telefono: '(986) 863 00 00' })
      .expect(201);
    telefonoIdsCreados.push(
      (r1.body as TelefonoBody).data.id,
      (r2.body as TelefonoBody).data.id,
    );
    expect((r2.body as TelefonoBody).data.orden).toBeGreaterThan(
      (r1.body as TelefonoBody).data.orden,
    );
    expect((r1.body as TelefonoBody).data.sedeId).toBe(sedeMeridaId);
    expect((r1.body as TelefonoBody).data.etiqueta).toBe('Cruz Roja E2E');
    expect((r1.body as TelefonoBody).data.telefono).toBe('911');

    const auditoria = await prisma.registroAuditoria.findFirst({
      where: {
        entidad: 'TelefonoEmergenciaSede',
        entidadId: (r1.body as TelefonoBody).data.id,
        accion: 'ALTA',
      },
    });
    expect(auditoria).not.toBeNull();
    expect(auditoria?.usuarioId).toBe(actorUsuarioId);
    expect(auditoria?.sedeId).toBe(sedeMeridaId);
  });

  it('GET /emergencia/telefonos devuelve solo los de la sede del actor, orden asc', async () => {
    const telValladolid = await prisma.telefonoEmergenciaSede.create({
      data: {
        sedeId: sedeValladolidId,
        etiqueta: 'Cruz Roja Valladolid E2E',
        telefono: '999',
        orden: 1,
      },
    });
    telefonoIdsCreados.push(telValladolid.id);

    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .get('/emergencia/telefonos')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as TelefonosBody;
    expect(Array.isArray(body.data)).toBe(true);
    // aislamiento por sede: el de Valladolid no aparece
    expect(body.data.some((t) => t.id === telValladolid.id)).toBe(false);
    expect(body.data.every((t) => t.sedeId === sedeMeridaId)).toBe(true);
    // orden ascendente
    const ordenes = body.data.map((t) => t.orden);
    const ordenadas = [...ordenes].sort((a, b) => a - b);
    expect(ordenes).toEqual(ordenadas);
    // los 2 creados en el test anterior están presentes
    expect(body.data.some((t) => t.etiqueta === 'Cruz Roja E2E')).toBe(true);
    expect(body.data.some((t) => t.etiqueta === 'Bomberos E2E')).toBe(true);
  });

  it('PATCH /emergencia/telefonos/:id de otra sede → 404', async () => {
    const telValladolid = await prisma.telefonoEmergenciaSede.create({
      data: {
        sedeId: sedeValladolidId,
        etiqueta: 'Proteccion Civil Valladolid E2E',
        telefono: '068',
        orden: 2,
      },
    });
    telefonoIdsCreados.push(telValladolid.id);

    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .patch(`/emergencia/telefonos/${telValladolid.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ telefono: '911' });

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');

    const sigueIgual = await prisma.telefonoEmergenciaSede.findUnique({
      where: { id: telValladolid.id },
    });
    expect(sigueIgual?.telefono).toBe('068');
  });

  it('PATCH vacío {} es válido y responde 200 sin auditar', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const creado = await request(app.getHttpServer())
      .post('/emergencia/telefonos')
      .set('Authorization', `Bearer ${token}`)
      .send({ etiqueta: 'Hospital General E2E', telefono: '065' })
      .expect(201);
    const telId = (creado.body as TelefonoBody).data.id;
    telefonoIdsCreados.push(telId);

    const antes = await prisma.registroAuditoria.count({
      where: { entidad: 'TelefonoEmergenciaSede', entidadId: telId },
    });

    const res = await request(app.getHttpServer())
      .patch(`/emergencia/telefonos/${telId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    const body = res.body as TelefonoBody;
    expect(body.data.etiqueta).toBe('Hospital General E2E');
    expect(body.data.telefono).toBe('065');

    const despues = await prisma.registroAuditoria.count({
      where: { entidad: 'TelefonoEmergenciaSede', entidadId: telId },
    });
    expect(despues).toBe(antes);
  });

  it('PATCH con cambio real responde 200 y audita EDICION', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const creado = await request(app.getHttpServer())
      .post('/emergencia/telefonos')
      .set('Authorization', `Bearer ${token}`)
      .send({ etiqueta: 'CFE E2E', telefono: '071' })
      .expect(201);
    const telId = (creado.body as TelefonoBody).data.id;
    telefonoIdsCreados.push(telId);

    const res = await request(app.getHttpServer())
      .patch(`/emergencia/telefonos/${telId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ telefono: '072' });

    expect(res.status).toBe(200);
    expect((res.body as TelefonoBody).data.telefono).toBe('072');

    const registro = await prisma.registroAuditoria.findFirst({
      where: {
        entidad: 'TelefonoEmergenciaSede',
        entidadId: telId,
        accion: 'EDICION',
      },
    });
    expect(registro).not.toBeNull();
    expect(registro?.usuarioId).toBe(actorUsuarioId);
  });

  it('DELETE /emergencia/telefonos/:id borra de verdad y audita ELIMINACION', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const creado = await request(app.getHttpServer())
      .post('/emergencia/telefonos')
      .set('Authorization', `Bearer ${token}`)
      .send({ etiqueta: 'Angeles Verdes E2E', telefono: '078' })
      .expect(201);
    const telId = (creado.body as TelefonoBody).data.id;
    telefonoIdsCreados.push(telId);

    const res = await request(app.getHttpServer())
      .delete(`/emergencia/telefonos/${telId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect((res.body as OkBody).data).toEqual({ ok: true });

    const enDb = await prisma.telefonoEmergenciaSede.findUnique({
      where: { id: telId },
    });
    expect(enDb).toBeNull();

    const registro = await prisma.registroAuditoria.findFirst({
      where: {
        entidad: 'TelefonoEmergenciaSede',
        entidadId: telId,
        accion: 'ELIMINACION',
      },
    });
    expect(registro).not.toBeNull();
    expect(registro?.usuarioId).toBe(actorUsuarioId);
  });

  it('DELETE /emergencia/telefonos/:id inexistente -> 404 NOT_FOUND', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .delete('/emergencia/telefonos/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('POST con etiqueta vacía → 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/emergencia/telefonos')
      .set('Authorization', `Bearer ${token}`)
      .send({ etiqueta: '', telefono: '911' });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('POST sin campos requeridos → 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/emergencia/telefonos')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('GET /emergencia/telefonos sin Authorization -> 401 UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer()).get('/emergencia/telefonos');

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
  });

  it('GET /emergencia/telefonos rol no ADMINISTRATIVO -> 403 ROL_NO_AUTORIZADO', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ALUMNO,
    });

    const res = await request(app.getHttpServer())
      .get('/emergencia/telefonos')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });

  it('POST /emergencia/telefonos rol no ADMINISTRATIVO -> 403 ROL_NO_AUTORIZADO', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.MAESTRO,
    });

    const res = await request(app.getHttpServer())
      .post('/emergencia/telefonos')
      .set('Authorization', `Bearer ${token}`)
      .send({ etiqueta: 'No deberia entrar', telefono: '911' });

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });
});

/**
 * Task 3 — buscador cross-rol. Usa personas ANCLA ya sembradas de CESP
 * Mérida/Valladolid (`prisma/seed-helpers.ts`, `EMAILS_ANCLA`) + un
 * `PersonalServicios` de Mérida resuelto por sede. Esos registros son
 * fixtures permanentes: NO se crean ni se borran acá.
 */
describe('EmergenciaController — GET /emergencia/buscar (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jose: typeof import('jose');
  let privateKey: CryptoKey;
  let sedeMeridaId: string;
  let sedeValladolidId: string;
  let actorUsuarioId: string;

  let alumnoMerida: { id: string; apellidoPaterno: string; matricula: string };
  let maestroMerida: {
    id: string;
    apellidoPaterno: string;
    cedulaProfesional: string | null;
  };
  let administrativoMerida: { id: string; apellidoPaterno: string };
  let personalMerida: { id: string; apellidoPaterno: string };
  let administrativoValladolid: { id: string; apellidoPaterno: string };

  async function firmarToken(claims: Record<string, unknown>): Promise<string> {
    return new jose.SignJWT(claims)
      .setProtectedHeader({ alg: TEST_ALG, kid: TEST_KID })
      .setSubject(actorUsuarioId)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  beforeAll(async () => {
    const booted = await bootEmergenciaApp();
    app = booted.app;
    prisma = booted.prisma;
    jose = booted.jose;
    privateKey = booted.privateKey;

    sedeMeridaId = (
      await prisma.sede.findUniqueOrThrow({ where: { nombre: 'CESP Mérida' } })
    ).id;
    sedeValladolidId = (
      await prisma.sede.findUniqueOrThrow({
        where: { nombre: 'CESP Valladolid' },
      })
    ).id;
    actorUsuarioId = (
      await prisma.usuario.findUniqueOrThrow({
        where: { email: 'ana.canul@cesp-merida.edu.mx' },
      })
    ).id;

    alumnoMerida = await prisma.perfilAlumno.findFirstOrThrow({
      where: { usuario: { email: 'luis.chan@cesp-merida.edu.mx' } },
      select: { id: true, apellidoPaterno: true, matricula: true },
    });
    maestroMerida = await prisma.perfilMaestro.findFirstOrThrow({
      where: { usuario: { email: 'mario.loeza@cesp-merida.edu.mx' } },
      select: { id: true, apellidoPaterno: true, cedulaProfesional: true },
    });
    administrativoMerida = await prisma.perfilAdministrativo.findFirstOrThrow({
      where: { usuario: { email: 'ana.canul@cesp-merida.edu.mx' } },
      select: { id: true, apellidoPaterno: true },
    });
    personalMerida = await prisma.personalServicios.findFirstOrThrow({
      where: { sede: { nombre: 'CESP Mérida' } },
      select: { id: true, apellidoPaterno: true },
    });
    administrativoValladolid =
      await prisma.perfilAdministrativo.findFirstOrThrow({
        where: { usuario: { email: 'jorge.ek@cesp-valladolid.edu.mx' } },
        select: { id: true, apellidoPaterno: true },
      });
  });

  afterAll(async () => {
    await app.close();
  });

  it('encuentra por apellido en los 4 roles dentro de la sede', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const casos = [
      { tipo: 'ALUMNO', ...alumnoMerida },
      { tipo: 'MAESTRO', ...maestroMerida },
      { tipo: 'ADMINISTRATIVO', ...administrativoMerida },
      { tipo: 'PERSONAL_SERVICIOS', ...personalMerida },
    ];

    for (const caso of casos) {
      const res = await request(app.getHttpServer())
        .get('/emergencia/buscar')
        .query({ q: caso.apellidoPaterno })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as BusquedaBody;
      expect(Array.isArray(body.data)).toBe(true);
      const item = body.data.find((r) => r.perfilId === caso.id);
      expect(item).toBeDefined();
      expect(item?.tipo).toBe(caso.tipo);
      expect(typeof item?.nombreCompleto).toBe('string');
      expect(typeof item?.referencia).toBe('string');
      expect(typeof item?.activo).toBe('boolean');
    }
  });

  it('encuentra alumno por matrícula', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .get('/emergencia/buscar')
      .query({ q: alumnoMerida.matricula })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const item = (res.body as BusquedaBody).data.find(
      (r) => r.perfilId === alumnoMerida.id,
    );
    expect(item).toBeDefined();
    expect(item?.tipo).toBe('ALUMNO');
    expect(item?.referencia).toBe(alumnoMerida.matricula);
  });

  it('encuentra maestro por cédula', async () => {
    expect(maestroMerida.cedulaProfesional).toBeTruthy();
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .get('/emergencia/buscar')
      .query({ q: maestroMerida.cedulaProfesional as string })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const item = (res.body as BusquedaBody).data.find(
      (r) => r.perfilId === maestroMerida.id,
    );
    expect(item).toBeDefined();
    expect(item?.tipo).toBe('MAESTRO');
    expect(item?.referencia).toBe(maestroMerida.cedulaProfesional);
  });

  it('devuelve los resultados ordenados por apellido paterno (merge de los 4 roles)', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    // 'a' matchea a gente de varios roles en Mérida — el merge debe salir en
    // orden apellido paterno → materno → nombres, no por nombre visible ni
    // por el orden de concatenación de los 4 arrays (test que habría cazado I2).
    const res = await request(app.getHttpServer())
      .get('/emergencia/buscar')
      .query({ q: 'an', limit: 50 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const data = (res.body as BusquedaBody).data;
    expect(data.length).toBeGreaterThan(2);

    const clave = (r: BusquedaBody['data'][number]) =>
      `${r.apellidoPaterno} ${r.apellidoMaterno ?? ''} ${r.nombres}`.toLocaleLowerCase(
        'es',
      );
    for (let i = 1; i < data.length; i++) {
      expect(
        clave(data[i - 1]).localeCompare(clave(data[i]), 'es'),
      ).toBeLessThanOrEqual(0);
    }
  });

  it('NO devuelve personas de otra sede', async () => {
    const tokenMerida = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });
    const resMerida = await request(app.getHttpServer())
      .get('/emergencia/buscar')
      .query({ q: administrativoValladolid.apellidoPaterno })
      .set('Authorization', `Bearer ${tokenMerida}`)
      .expect(200);
    expect(
      (resMerida.body as BusquedaBody).data.some(
        (r) => r.perfilId === administrativoValladolid.id,
      ),
    ).toBe(false);

    // control positivo: el mismo término, con token de Valladolid, sí lo trae
    const tokenValladolid = await firmarToken({
      role: 'authenticated',
      sede_id: sedeValladolidId,
      rol: RolUsuario.ADMINISTRATIVO,
    });
    const resValladolid = await request(app.getHttpServer())
      .get('/emergencia/buscar')
      .query({ q: administrativoValladolid.apellidoPaterno })
      .set('Authorization', `Bearer ${tokenValladolid}`)
      .expect(200);
    expect(
      (resValladolid.body as BusquedaBody).data.some(
        (r) => r.perfilId === administrativoValladolid.id,
      ),
    ).toBe(true);
  });

  it('q de 1 caracter → 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });
    await request(app.getHttpServer())
      .get('/emergencia/buscar')
      .query({ q: 'a' })
      .set('Authorization', `Bearer ${token}`)
      .expect(400)
      .expect((r) => expect((r.body as ErrorBody).code).toBe('VALIDATION_ERROR'));
  });

  it('respeta limit', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const acotado = await request(app.getHttpServer())
      .get('/emergencia/buscar')
      .query({ q: 'an', limit: 2 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((acotado.body as BusquedaBody).data.length).toBeLessThanOrEqual(2);
    expect((acotado.body as BusquedaBody).data.length).toBeGreaterThan(0);

    const amplio = await request(app.getHttpServer())
      .get('/emergencia/buscar')
      .query({ q: 'an', limit: 50 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    // el término 'an' matchea a más de 2 personas en Mérida — prueba que el
    // limit=2 de arriba realmente recortó
    expect((amplio.body as BusquedaBody).data.length).toBeGreaterThan(2);
  });

  it('limit fuera de rango → 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });
    await request(app.getHttpServer())
      .get('/emergencia/buscar')
      .query({ q: 'chan', limit: 999 })
      .set('Authorization', `Bearer ${token}`)
      .expect(400)
      .expect((r) => expect((r.body as ErrorBody).code).toBe('VALIDATION_ERROR'));
  });

  it('sin Authorization → 401 UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer())
      .get('/emergencia/buscar')
      .query({ q: 'chan' });
    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
  });

  it('rol no ADMINISTRATIVO → 403 ROL_NO_AUTORIZADO', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.MAESTRO,
    });
    const res = await request(app.getHttpServer())
      .get('/emergencia/buscar')
      .query({ q: 'chan' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });
});

/**
 * Task 3 — expediente de emergencia. Cada consulta exitosa escribe un
 * `RegistroAuditoria` `CONSULTA_EMERGENCIA`; los ids creados se juntan en
 * `auditoriaIdsCreados` y se borran por id en `afterAll` (nunca por patrón).
 * Fixtures ancla de Mérida/Valladolid NO se tocan; el único registro creado
 * es un `PersonalServicios` sin `InfoMedica*` para el caso `infoMedica: null`
 * (se borra en `afterAll`).
 */
describe('EmergenciaController — GET /emergencia/expediente/:tipo/:perfilId (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jose: typeof import('jose');
  let privateKey: CryptoKey;
  let sedeMeridaId: string;
  let actorUsuarioId: string;

  let perfilAlumnoId: string;
  let perfilMaestroId: string;
  let perfilAdministrativoId: string;
  let perfilPersonalId: string;
  let perfilAlumnoValladolidId: string;
  let personalSinInfoMedicaId: string;

  const auditoriaIdsCreados: string[] = [];

  async function firmarToken(claims: Record<string, unknown>): Promise<string> {
    return new jose.SignJWT(claims)
      .setProtectedHeader({ alg: TEST_ALG, kid: TEST_KID })
      .setSubject(actorUsuarioId)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  beforeAll(async () => {
    const booted = await bootEmergenciaApp();
    app = booted.app;
    prisma = booted.prisma;
    jose = booted.jose;
    privateKey = booted.privateKey;

    sedeMeridaId = (
      await prisma.sede.findUniqueOrThrow({ where: { nombre: 'CESP Mérida' } })
    ).id;
    actorUsuarioId = (
      await prisma.usuario.findUniqueOrThrow({
        where: { email: 'ana.canul@cesp-merida.edu.mx' },
      })
    ).id;

    perfilAlumnoId = (
      await prisma.perfilAlumno.findFirstOrThrow({
        where: { usuario: { email: 'luis.chan@cesp-merida.edu.mx' } },
        select: { id: true },
      })
    ).id;
    perfilMaestroId = (
      await prisma.perfilMaestro.findFirstOrThrow({
        where: { usuario: { email: 'mario.loeza@cesp-merida.edu.mx' } },
        select: { id: true },
      })
    ).id;
    perfilAdministrativoId = (
      await prisma.perfilAdministrativo.findFirstOrThrow({
        where: { usuario: { email: 'fatima.sosa@cesp-merida.edu.mx' } },
        select: { id: true },
      })
    ).id;
    perfilPersonalId = (
      await prisma.personalServicios.findFirstOrThrow({
        where: { sede: { nombre: 'CESP Mérida' } },
        select: { id: true },
      })
    ).id;
    perfilAlumnoValladolidId = (
      await prisma.perfilAlumno.findFirstOrThrow({
        where: { usuario: { email: 'mariajose.pech@cesp-valladolid.edu.mx' } },
        select: { id: true },
      })
    ).id;

    const creado = await prisma.personalServicios.create({
      data: {
        sedeId: sedeMeridaId,
        nombres: 'Persona',
        apellidoPaterno: 'SinExpedienteMedico',
        apellidoMaterno: 'E2E',
        curp: 'XEXX010101HNEXXXA4',
        area: 'OTRO',
        telefono: '9990000000',
        fechaContratacion: new Date('2023-01-01'),
        estatus: 'ACTIVO',
      },
      select: { id: true },
    });
    personalSinInfoMedicaId = creado.id;
  });

  afterAll(async () => {
    if (auditoriaIdsCreados.length > 0) {
      await prisma.registroAuditoria.deleteMany({
        where: { id: { in: auditoriaIdsCreados } },
      });
    }
    if (personalSinInfoMedicaId) {
      await prisma.personalServicios.delete({
        where: { id: personalSinInfoMedicaId },
      });
    }
    await app.close();
  });

  it('devuelve identidad + infoMedica + contactos para un ALUMNO y audita CONSULTA_EMERGENCIA', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });
    const res = await request(app.getHttpServer())
      .get(`/emergencia/expediente/ALUMNO/${perfilAlumnoId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as ExpedienteBody;
    expect(body.data.tipo).toBe('ALUMNO');
    expect(body.data.perfilId).toBe(perfilAlumnoId);
    expect(body.data.identidad).toHaveProperty('referencia');
    expect(body.data.identidad).toHaveProperty('edad');
    expect(typeof body.data.identidad.edad).toBe('number');
    expect(body.data.identidad.fechaNacimiento).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.data).toHaveProperty('infoMedica');
    expect(Array.isArray(body.data.contactos)).toBe(true);
    expect(body.data.contactos.length).toBeGreaterThan(0);
    for (const c of body.data.contactos) {
      expect(['TUTOR', 'EMERGENCIA']).toContain(c.tipo);
    }

    const audit = await prisma.registroAuditoria.findFirst({
      where: {
        accion: 'CONSULTA_EMERGENCIA',
        entidad: 'ExpedienteEmergencia',
        entidadId: perfilAlumnoId,
        usuarioId: actorUsuarioId,
      },
      orderBy: { fecha: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.sedeId).toBe(sedeMeridaId);
    auditoriaIdsCreados.push(audit!.id);
  });

  it('MAESTRO / ADMINISTRATIVO / PERSONAL_SERVICIOS: cada uno responde 200 con su shape', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const casos = [
      { tipo: 'MAESTRO', perfilId: perfilMaestroId },
      { tipo: 'ADMINISTRATIVO', perfilId: perfilAdministrativoId },
      { tipo: 'PERSONAL_SERVICIOS', perfilId: perfilPersonalId },
    ];

    for (const caso of casos) {
      const res = await request(app.getHttpServer())
        .get(`/emergencia/expediente/${caso.tipo}/${caso.perfilId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as ExpedienteBody;
      expect(body.data.tipo).toBe(caso.tipo);
      expect(body.data.perfilId).toBe(caso.perfilId);
      expect(body.data.identidad.fechaNacimiento).toBeNull();
      expect(body.data.identidad.edad).toBeNull();
      expect(typeof body.data.identidad.referencia).toBe('string');
      expect(body.data.identidad).toHaveProperty('activo');
      expect(body.data).toHaveProperty('infoMedica');
      expect(Array.isArray(body.data.contactos)).toBe(true);
      for (const c of body.data.contactos) {
        expect(c.tipo).toBeNull();
      }

      const audit = await prisma.registroAuditoria.findFirst({
        where: {
          accion: 'CONSULTA_EMERGENCIA',
          entidad: 'ExpedienteEmergencia',
          entidadId: caso.perfilId,
          usuarioId: actorUsuarioId,
        },
        orderBy: { fecha: 'desc' },
      });
      expect(audit).not.toBeNull();
      auditoriaIdsCreados.push(audit!.id);
    }
  });

  it('infoMedica es null cuando la persona no tiene fila InfoMedica*', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });
    const res = await request(app.getHttpServer())
      .get(`/emergencia/expediente/PERSONAL_SERVICIOS/${personalSinInfoMedicaId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as ExpedienteBody;
    expect(body.data.tipo).toBe('PERSONAL_SERVICIOS');
    expect(body.data.infoMedica).toBeNull();
    expect(body.data.contactos).toEqual([]);

    const audit = await prisma.registroAuditoria.findFirst({
      where: {
        accion: 'CONSULTA_EMERGENCIA',
        entidadId: personalSinInfoMedicaId,
        usuarioId: actorUsuarioId,
      },
      orderBy: { fecha: 'desc' },
    });
    expect(audit).not.toBeNull();
    auditoriaIdsCreados.push(audit!.id);
  });

  it('expediente de un perfil de otra sede → 404 NOT_FOUND (nunca 403)', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });
    const res = await request(app.getHttpServer())
      .get(`/emergencia/expediente/ALUMNO/${perfilAlumnoValladolidId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');

    // no debe haberse auditado una consulta que nunca devolvió expediente
    const audit = await prisma.registroAuditoria.findFirst({
      where: {
        accion: 'CONSULTA_EMERGENCIA',
        entidadId: perfilAlumnoValladolidId,
      },
    });
    expect(audit).toBeNull();
  });

  it('tipo inválido → 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });
    const res = await request(app.getHttpServer())
      .get(
        '/emergencia/expediente/PROFESOR/00000000-0000-0000-0000-000000000000',
      )
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('rol no ADMINISTRATIVO → 403 ROL_NO_AUTORIZADO', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.MAESTRO,
    });
    const res = await request(app.getHttpServer())
      .get(`/emergencia/expediente/ALUMNO/${perfilAlumnoId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });
});
