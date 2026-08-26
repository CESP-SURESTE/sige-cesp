import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  AccionAuditoria,
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

/**
 * Test de integración — Fase 10 (unificación CRUD admin), `PATCH
 * /personas/:id/estatus`.
 *
 * Primer código real del patrón "baja lógica" que la regla 3 de CLAUDE.md
 * raíz venía mencionando como aspiracional desde el diseño original — hasta
 * hoy ningún rol lo tenía implementado.
 *
 * Contra la app real (`AppModule` completo, `PrismaService` conectado a la
 * DB real de Supabase) — no hace falta mockear Supabase Auth
 * (`PERSONAS_SUPABASE_CLIENT_OVERRIDE`), este endpoint nunca lo toca (solo
 * escribe en Postgres). Mismo mecanismo de JWTs de prueba que
 * `test/personas-listado.e2e-spec.ts` (JWKS generado con `jose`, inyectado
 * vía `SEDE_GUARD_ENV_OVERRIDE`).
 *
 * Fixtures propios (actores con distinto `nivelPermiso` + objetivos)
 * dedicados a este archivo — NO se reutilizan/mutan usuarios reales del seed
 * (`prisma/seed.ts`) para no afectar las aserciones de otros specs que sí
 * dependen de su estado original (este proyecto no limpia fixtures en
 * `afterAll`, mismo criterio ya establecido en el resto del dominio).
 */
describe('PersonasController — PATCH /personas/:id/estatus (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let sedeValladolidId: string;
  let carreraMeridaId: string;
  let actorAdminId: string;
  let actorAuxiliarId: string;
  let actorSuperAdminId: string;
  let alumnoMeridaId: string;
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

  async function crearAdministrativoFixture(params: {
    sedeId: string;
    nivelPermiso: NivelPermiso;
    estatus?: EstatusEmpleado;
  }): Promise<string> {
    const usuario = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.estatus.${randomUUID()}@example.com`,
        rol: RolUsuario.ADMINISTRATIVO,
        sedeId: params.sedeId,
      },
    });
    await prisma.perfilAdministrativo.create({
      data: {
        usuarioId: usuario.id,
        nombres: 'Fixture',
        apellidoPaterno: 'Estatus',
        curp: `FX${randomUUID().slice(0, 16).toUpperCase()}`,
        correoPersonal: `fixture.estatus.personal.${randomUUID()}@example.com`,
        telefono: '9990009999',
        fechaContratacion: new Date('2024-01-01'),
        estatus: params.estatus ?? EstatusEmpleado.ACTIVO,
        puesto: PuestoAdministrativo.AUXILIAR,
        nivelPermiso: params.nivelPermiso,
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

    // Actores (ADMINISTRATIVO real con fila en PerfilAdministrativo, cada
    // uno con un nivelPermiso distinto) — fixtures propios de este archivo,
    // mismo patrón que `test/personas.e2e-spec.ts` (jerarquía en el alta).
    actorAuxiliarId = await crearAdministrativoFixture({
      sedeId: sedeMeridaId,
      nivelPermiso: NivelPermiso.AUXILIAR,
    });
    actorAdminId = await crearAdministrativoFixture({
      sedeId: sedeMeridaId,
      nivelPermiso: NivelPermiso.ADMIN,
    });
    actorSuperAdminId = await crearAdministrativoFixture({
      sedeId: sedeMeridaId,
      nivelPermiso: NivelPermiso.SUPER_ADMIN,
    });

    // Alumno fixture propio (para el test opcional "genérico funciona
    // también para ALUMNO") — NO se reutiliza/muta el alumno real del seed
    // (`luis.chan`), otros specs (`test/personas-listado.e2e-spec.ts`)
    // dependen de su `estatusAcademico` original.
    const usuarioAlumno = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.estatus.alumno.${randomUUID()}@example.com`,
        rol: RolUsuario.ALUMNO,
        sedeId: sedeMeridaId,
      },
    });
    await prisma.perfilAlumno.create({
      data: {
        usuarioId: usuarioAlumno.id,
        nombres: 'Fixture',
        apellidoPaterno: 'Alumno',
        curp: `FX${randomUUID().slice(0, 16).toUpperCase()}`,
        fechaNacimiento: new Date('2007-01-01'),
        matricula: `FXEST${randomUUID().slice(0, 10).toUpperCase()}`,
        correoPersonal: `fixture.estatus.alumno.personal.${randomUUID()}@example.com`,
        carreraId: carreraMeridaId,
        estatusAcademico: 'INSCRITO',
        periodoIngreso: '2026-1',
        semestreActual: 1,
        telefono: '9990009999',
      },
    });
    alumnoMeridaId = usuarioAlumno.id;
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  it('actor ADMIN cambia el estatus de un administrativo AUXILIAR -> 200, persiste el cambio y crea RegistroAuditoria', async () => {
    const objetivoId = await crearAdministrativoFixture({
      sedeId: sedeMeridaId,
      nivelPermiso: NivelPermiso.AUXILIAR,
    });

    const res = await request(app.getHttpServer())
      .patch(`/personas/${objetivoId}/estatus`)
      .send({ estatus: 'BAJA' })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(actorAdminId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(200);
    expect((res.body as { data: { ok: boolean } }).data).toEqual({
      ok: true,
    });

    const perfilActualizado = await prisma.perfilAdministrativo.findUnique({
      where: { usuarioId: objetivoId },
      select: { estatus: true },
    });
    expect(perfilActualizado?.estatus).toBe('BAJA');

    const registro = await prisma.registroAuditoria.findFirst({
      where: { entidadId: objetivoId, accion: AccionAuditoria.CAMBIO_ESTATUS },
      orderBy: { fecha: 'desc' },
    });
    expect(registro).not.toBeNull();
    expect(registro?.usuarioId).toBe(actorAdminId);
    expect(registro?.sedeId).toBe(sedeMeridaId);
    expect(registro?.entidad).toBe('Usuario');
  });

  it('actor AUXILIAR intenta cambiar el estatus de un administrativo -> 403 NIVEL_PERMISO_INSUFICIENTE', async () => {
    const objetivoId = await crearAdministrativoFixture({
      sedeId: sedeMeridaId,
      nivelPermiso: NivelPermiso.AUXILIAR,
    });

    const res = await request(app.getHttpServer())
      .patch(`/personas/${objetivoId}/estatus`)
      .send({ estatus: 'BAJA' })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(actorAuxiliarId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('NIVEL_PERMISO_INSUFICIENTE');
  });

  it('actor ADMIN intenta cambiar el estatus de un administrativo SUPER_ADMIN -> 403 NIVEL_PERMISO_INSUFICIENTE', async () => {
    const objetivoId = await crearAdministrativoFixture({
      sedeId: sedeMeridaId,
      nivelPermiso: NivelPermiso.SUPER_ADMIN,
    });

    const res = await request(app.getHttpServer())
      .patch(`/personas/${objetivoId}/estatus`)
      .send({ estatus: 'BAJA' })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(actorAdminId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('NIVEL_PERMISO_INSUFICIENTE');
  });

  it('actor SUPER_ADMIN cambia el estatus de otro SUPER_ADMIN -> 200 (techo de la jerarquía, mismo nivel permitido)', async () => {
    const objetivoId = await crearAdministrativoFixture({
      sedeId: sedeMeridaId,
      nivelPermiso: NivelPermiso.SUPER_ADMIN,
    });

    const res = await request(app.getHttpServer())
      .patch(`/personas/${objetivoId}/estatus`)
      .send({ estatus: 'LICENCIA' })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(actorSuperAdminId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(200);
  });

  it('estatus inválido (valor de EstatusAcademico, no de EstatusEmpleado) -> 400 VALIDATION_ERROR', async () => {
    const objetivoId = await crearAdministrativoFixture({
      sedeId: sedeMeridaId,
      nivelPermiso: NivelPermiso.AUXILIAR,
    });

    const res = await request(app.getHttpServer())
      .patch(`/personas/${objetivoId}/estatus`)
      .send({ estatus: 'INSCRITO' })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(actorAdminId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('estatus vacío -> 400 VALIDATION_ERROR', async () => {
    const objetivoId = await crearAdministrativoFixture({
      sedeId: sedeMeridaId,
      nivelPermiso: NivelPermiso.AUXILIAR,
    });

    const res = await request(app.getHttpServer())
      .patch(`/personas/${objetivoId}/estatus`)
      .send({ estatus: '' })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(actorAdminId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('id de un usuario de otra sede -> 404 NOT_FOUND', async () => {
    const objetivoValladolidId = await crearAdministrativoFixture({
      sedeId: sedeValladolidId,
      nivelPermiso: NivelPermiso.AUXILIAR,
    });

    const res = await request(app.getHttpServer())
      .patch(`/personas/${objetivoValladolidId}/estatus`)
      .send({ estatus: 'BAJA' })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(actorAdminId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('id inexistente -> 404 NOT_FOUND', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/personas/${randomUUID()}/estatus`)
      .send({ estatus: 'BAJA' })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(actorAdminId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('sin Authorization -> 401 UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/personas/${actorAuxiliarId}/estatus`)
      .send({ estatus: 'BAJA' });

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
  });

  it('rol distinto de ADMINISTRATIVO (ALUMNO real) -> 403 ROL_NO_AUTORIZADO', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/personas/${actorAuxiliarId}/estatus`)
      .send({ estatus: 'BAJA' })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(alumnoMeridaId, RolUsuario.ALUMNO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });

  it('endpoint genérico funciona también para ALUMNO (sin jerarquía, valida contra EstatusAcademico) -> 200', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/personas/${alumnoMeridaId}/estatus`)
      .send({ estatus: 'BAJA_TEMPORAL' })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(actorAdminId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(200);

    const perfilActualizado = await prisma.perfilAlumno.findUnique({
      where: { usuarioId: alumnoMeridaId },
      select: { estatusAcademico: true },
    });
    expect(perfilActualizado?.estatusAcademico).toBe('BAJA_TEMPORAL');
  });
});
