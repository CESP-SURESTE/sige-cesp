import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { NivelPermiso, PuestoAdministrativo, RolUsuario } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { SEDE_GUARD_ENV_OVERRIDE } from '../src/common/guards/sede.guard';
import { PERSONAS_SUPABASE_CLIENT_OVERRIDE } from '../src/personas/personas.service';
import { loadEnv } from '../src/load-env';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup-app';

loadEnv();

interface ErrorBody {
  error: string;
  code: string;
}

interface AltaPersonaBody {
  data: {
    usuario: { id: string; email: string; rol: string; sedeId: string };
    temporaryPassword: string;
  };
}

/**
 * Test de integración — Fase 4, Día 11.
 *
 * `POST /personas` de punta a punta contra la app real (`AppModule`
 * completo, `PrismaService` conectado a la DB real de Supabase — mismas
 * sedes/carreras/admin sembrados por `prisma/seed.ts`), pero sin pegarle al
 * Admin API real de Supabase Auth: se inyecta un mock de
 * `client.auth.admin.{createUser,deleteUser}` vía
 * `PERSONAS_SUPABASE_CLIENT_OVERRIDE` — mismo patrón que
 * `AUTH_SUPABASE_CLIENT_OVERRIDE` en `test/auth.e2e-spec.ts`.
 *
 * JWTs firmados con el mismo mecanismo que `sede-guard.e2e-spec.ts` /
 * `roles-guard.e2e-spec.ts` (JWKS de prueba generado con `jose`, inyectado
 * vía `SEDE_GUARD_ENV_OVERRIDE`).
 */
describe('PersonasController — POST /personas (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let carreraMeridaId: string;
  let actorAdminId: string;
  let actorAuxiliarId: string;
  let actorSuperAdminId: string;
  let createUser: jest.Mock;
  let deleteUser: jest.Mock;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';

  async function firmarToken(
    claims: Record<string, unknown>,
    sub: string,
  ): Promise<string> {
    return new jose.SignJWT(claims)
      .setProtectedHeader({ alg, kid })
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  async function tokenAdmin(): Promise<string> {
    return firmarToken(
      {
        role: 'authenticated',
        sede_id: sedeMeridaId,
        rol: RolUsuario.ADMINISTRATIVO,
      },
      actorAdminId,
    );
  }

  async function tokenAuxiliar(): Promise<string> {
    return firmarToken(
      {
        role: 'authenticated',
        sede_id: sedeMeridaId,
        rol: RolUsuario.ADMINISTRATIVO,
      },
      actorAuxiliarId,
    );
  }

  async function tokenSuperAdmin(): Promise<string> {
    return firmarToken(
      {
        role: 'authenticated',
        sede_id: sedeMeridaId,
        rol: RolUsuario.ADMINISTRATIVO,
      },
      actorSuperAdminId,
    );
  }

  function perfilAdministrativoValido() {
    return {
      nombres: 'Prueba',
      apellidoPaterno: 'Jerarquia',
      curp: `CURP${randomUUID().slice(0, 14).toUpperCase()}`,
      correoPersonal: `jerarquia.${randomUUID()}@example.com`,
      telefono: '9990001111',
      fechaContratacion: '2026-01-01',
      puesto: PuestoAdministrativo.RECEPCION,
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

  beforeAll(async () => {
    jose = await import('jose');
    const keyPair = await jose.generateKeyPair(alg, { extractable: true });
    privateKey = keyPair.privateKey;
    const publicJwk = await jose.exportJWK(keyPair.publicKey);
    publicJwk.kid = kid;
    publicJwk.alg = alg;
    publicJwk.use = 'sig';

    createUser = jest.fn();
    deleteUser = jest.fn().mockResolvedValue({ data: {}, error: null });
    const mockSupabaseAdminClient = {
      auth: { admin: { createUser, deleteUser } },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SEDE_GUARD_ENV_OVERRIDE)
      .useValue({ jwks: { keys: [publicJwk] } })
      .overrideProvider(PERSONAS_SUPABASE_CLIENT_OVERRIDE)
      .useValue(mockSupabaseAdminClient)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    const merida = await prisma.sede.findUniqueOrThrow({
      where: { nombre: 'CESP Mérida' },
    });
    sedeMeridaId = merida.id;

    const carrera = await prisma.carrera.findUniqueOrThrow({
      where: { clave: 'LAE-MID' },
    });
    carreraMeridaId = carrera.id;

    // Actor real: el administrativo sembrado por `prisma/seed.ts` en
    // Mérida — necesario porque `RegistroAuditoria.usuarioId` (el actor) es
    // una FK real hacia `usuarios`, no un valor arbitrario.
    const admin = await prisma.usuario.findUniqueOrThrow({
      where: { email: 'ana.canul@cesp-merida.edu.mx' },
    });
    actorAdminId = admin.id;
    // `ana.canul` está sembrada por `prisma/seed.ts` con `nivelPermiso: ADMIN`
    // (ver `prisma/seed.ts`) — sirve tal cual para el caso "ADMIN intenta
    // crear SUPER_ADMIN -> 403", no hace falta un fixture nuevo para ese rol.

    // Fixtures nuevos (observación A de QA — Día 11): actores reales con
    // `nivelPermiso` AUXILIAR y SUPER_ADMIN — el seed no trae ninguno de los
    // dos. `usuarioId` con email aleatorio (`randomUUID()`), no chocan entre
    // corridas repetidas del suite; no se limpian en `afterAll` porque el
    // resto de este archivo tampoco limpia lo que crea (ej. los alumnos de
    // "alta exitosa"), mismo criterio ya establecido en este spec.
    const auxiliar = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.auxiliar.${randomUUID()}@cesp-merida.edu.mx`,
        rol: RolUsuario.ADMINISTRATIVO,
        sedeId: sedeMeridaId,
      },
    });
    await prisma.perfilAdministrativo.create({
      data: {
        usuarioId: auxiliar.id,
        nombres: 'Fixture',
        apellidoPaterno: 'Auxiliar',
        curp: `CURP${randomUUID().slice(0, 14).toUpperCase()}`,
        correoPersonal: `fixture.auxiliar.personal.${randomUUID()}@example.com`,
        telefono: '9990002222',
        fechaContratacion: new Date('2026-01-01'),
        estatus: 'ACTIVO',
        puesto: PuestoAdministrativo.AUXILIAR,
        nivelPermiso: NivelPermiso.AUXILIAR,
      },
    });
    actorAuxiliarId = auxiliar.id;

    const superAdmin = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.superadmin.${randomUUID()}@cesp-merida.edu.mx`,
        rol: RolUsuario.ADMINISTRATIVO,
        sedeId: sedeMeridaId,
      },
    });
    await prisma.perfilAdministrativo.create({
      data: {
        usuarioId: superAdmin.id,
        nombres: 'Fixture',
        apellidoPaterno: 'SuperAdmin',
        curp: `CURP${randomUUID().slice(0, 14).toUpperCase()}`,
        correoPersonal: `fixture.superadmin.personal.${randomUUID()}@example.com`,
        telefono: '9990003333',
        fechaContratacion: new Date('2026-01-01'),
        estatus: 'ACTIVO',
        puesto: PuestoAdministrativo.DIRECTOR,
        nivelPermiso: NivelPermiso.SUPER_ADMIN,
      },
    });
    actorSuperAdminId = superAdmin.id;
  });

  afterEach(() => {
    createUser.mockReset();
    deleteUser.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('alta de alumno exitosa -> 201, con usuario + temporaryPassword y email_confirm: true', async () => {
    mockCreateUserExitoso();
    const email = `alumno.prueba.${randomUUID()}@cesp-merida.edu.mx`;

    const res = await request(app.getHttpServer())
      .post('/personas')
      .set('Authorization', `Bearer ${await tokenAdmin()}`)
      .send({
        email,
        rol: RolUsuario.ALUMNO,
        perfilAlumno: {
          nombres: 'Prueba',
          apellidoPaterno: 'Alumno',
          fechaNacimiento: '2007-05-01',
          matricula: `MID-2026-${randomUUID().slice(0, 8)}`,
          correoPersonal: 'prueba.alumno.personal@example.com',
          carreraId: carreraMeridaId,
          periodoIngreso: '2026-1',
          semestreActual: 1,
        },
      });

    expect(res.status).toBe(201);
    const body = res.body as AltaPersonaBody;
    expect(body.data.usuario.email).toBe(email);
    expect(body.data.usuario.rol).toBe(RolUsuario.ALUMNO);
    expect(body.data.usuario.sedeId).toBe(sedeMeridaId);
    expect(typeof body.data.temporaryPassword).toBe('string');
    expect(body.data.temporaryPassword.length).toBeGreaterThanOrEqual(16);

    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email, email_confirm: true }),
    );

    // Confirma que la fila real de Usuario + PerfilAlumno + RegistroAuditoria
    // quedaron insertadas (no solo el 201 HTTP).
    const usuarioCreado = await prisma.usuario.findUnique({
      where: { id: body.data.usuario.id },
      include: { perfilAlumno: true },
    });
    expect(usuarioCreado?.perfilAlumno?.matricula).toBeDefined();

    const auditoria = await prisma.registroAuditoria.findFirst({
      where: { entidad: 'Usuario', entidadId: body.data.usuario.id },
    });
    expect(auditoria?.usuarioId).toBe(actorAdminId);
    expect(auditoria?.accion).toBe('ALTA');
  });

  it('rol no administrativo -> 403 ROL_NO_AUTORIZADO, sin llamar a Supabase Auth', async () => {
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ALUMNO },
      actorAdminId,
    );

    const res = await request(app.getHttpServer())
      .post('/personas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'no-deberia-crearse@cesp-merida.edu.mx',
        rol: RolUsuario.ALUMNO,
        perfilAlumno: {
          nombres: 'X',
          apellidoPaterno: 'Y',
          fechaNacimiento: '2007-01-01',
          matricula: `MID-2026-${randomUUID().slice(0, 8)}`,
          correoPersonal: 'x@example.com',
          carreraId: carreraMeridaId,
          periodoIngreso: '2026-1',
          semestreActual: 1,
        },
      });

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
    expect(createUser).not.toHaveBeenCalled();
  });

  it('body sin perfilAlumno (campos faltantes) -> 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .post('/personas')
      .set('Authorization', `Bearer ${await tokenAdmin()}`)
      .send({ email: 'incompleto@cesp-merida.edu.mx', rol: RolUsuario.ALUMNO });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
    expect(createUser).not.toHaveBeenCalled();
  });

  it('email duplicado (ya existe en usuarios) -> 409 CONFLICT, sin llamar a Supabase Auth', async () => {
    const res = await request(app.getHttpServer())
      .post('/personas')
      .set('Authorization', `Bearer ${await tokenAdmin()}`)
      .send({
        // Email real ya sembrado por prisma/seed.ts.
        email: 'ana.canul@cesp-merida.edu.mx',
        rol: RolUsuario.ALUMNO,
        perfilAlumno: {
          nombres: 'Duplicado',
          apellidoPaterno: 'Prueba',
          fechaNacimiento: '2007-01-01',
          matricula: `MID-2026-${randomUUID().slice(0, 8)}`,
          correoPersonal: 'duplicado@example.com',
          carreraId: carreraMeridaId,
          periodoIngreso: '2026-1',
          semestreActual: 1,
        },
      });

    expect(res.status).toBe(409);
    expect((res.body as ErrorBody).code).toBe('CONFLICT');
    expect(createUser).not.toHaveBeenCalled();
  });

  it('rollback: falla el insert de Postgres tras crear el usuario en Auth -> se compensa borrando el usuario de Auth', async () => {
    mockCreateUserExitoso();

    // Actor deliberadamente inexistente en `usuarios` — provoca que el
    // insert de `RegistroAuditoria` (dentro del mismo $transaction, DESPUÉS
    // de que Usuario y PerfilAlumno ya se insertaron) falle por violación de
    // FK, ya con el usuario de Supabase Auth creado. Es el escenario real
    // que la compensación (`client.auth.admin.deleteUser`) tiene que cubrir.
    const actorInexistente = randomUUID();
    const token = await firmarToken(
      {
        role: 'authenticated',
        sede_id: sedeMeridaId,
        rol: RolUsuario.ADMINISTRATIVO,
      },
      actorInexistente,
    );

    const res = await request(app.getHttpServer())
      .post('/personas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: `rollback.${randomUUID()}@cesp-merida.edu.mx`,
        rol: RolUsuario.ALUMNO,
        perfilAlumno: {
          nombres: 'Rollback',
          apellidoPaterno: 'Prueba',
          fechaNacimiento: '2007-01-01',
          matricula: `MID-2026-${randomUUID().slice(0, 8)}`,
          correoPersonal: 'rollback@example.com',
          carreraId: carreraMeridaId,
          periodoIngreso: '2026-1',
          semestreActual: 1,
        },
      });

    expect(res.status).toBe(500);
    expect((res.body as ErrorBody).code).toBe('SERVER_ERROR');
    expect(createUser).toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledTimes(1);

    const creado = (await createUser.mock.results[0].value) as {
      data: { user: { id: string } };
    };
    expect(deleteUser).toHaveBeenCalledWith(creado.data.user.id);
  });

  it('rollback: si la compensación (deleteUser) RECHAZA la promesa (no solo {error}), igual dispara el log CRÍTICO', async () => {
    mockCreateUserExitoso();
    deleteUser.mockRejectedValueOnce(new Error('fallo de red simulado'));
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    // Mismo mecanismo de rollback que el caso anterior: actor inexistente en
    // `usuarios` fuerza el fallo del insert de `RegistroAuditoria` dentro del
    // `$transaction`, con el usuario de Supabase Auth ya creado.
    const actorInexistente = randomUUID();
    const token = await firmarToken(
      {
        role: 'authenticated',
        sede_id: sedeMeridaId,
        rol: RolUsuario.ADMINISTRATIVO,
      },
      actorInexistente,
    );

    try {
      const res = await request(app.getHttpServer())
        .post('/personas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          email: `rollback.reject.${randomUUID()}@cesp-merida.edu.mx`,
          rol: RolUsuario.ALUMNO,
          perfilAlumno: {
            nombres: 'Rollback',
            apellidoPaterno: 'Reject',
            fechaNacimiento: '2007-01-01',
            matricula: `MID-2026-${randomUUID().slice(0, 8)}`,
            correoPersonal: 'rollback.reject@example.com',
            carreraId: carreraMeridaId,
            periodoIngreso: '2026-1',
            semestreActual: 1,
          },
        });

      expect(res.status).toBe(500);
      expect((res.body as ErrorBody).code).toBe('SERVER_ERROR');
      expect(deleteUser).toHaveBeenCalledTimes(1);

      const logueoCritico = consoleErrorSpy.mock.calls.some(
        ([mensaje]) =>
          typeof mensaje === 'string' && mensaje.includes('CRÍTICO'),
      );
      expect(logueoCritico).toBe(true);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('AUXILIAR intenta dar de alta un ADMINISTRATIVO -> 403 NIVEL_PERMISO_INSUFICIENTE, sin llamar a Supabase Auth', async () => {
    const res = await request(app.getHttpServer())
      .post('/personas')
      .set('Authorization', `Bearer ${await tokenAuxiliar()}`)
      .send({
        email: `auxiliar.intenta.crear.${randomUUID()}@cesp-merida.edu.mx`,
        rol: RolUsuario.ADMINISTRATIVO,
        perfilAdministrativo: perfilAdministrativoValido(),
      });

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('NIVEL_PERMISO_INSUFICIENTE');
    expect(createUser).not.toHaveBeenCalled();
  });

  it('ADMIN intenta dar de alta un SUPER_ADMIN -> 403 NIVEL_PERMISO_INSUFICIENTE, sin llamar a Supabase Auth', async () => {
    const res = await request(app.getHttpServer())
      .post('/personas')
      .set('Authorization', `Bearer ${await tokenAdmin()}`)
      .send({
        email: `admin.crea.superadmin.${randomUUID()}@cesp-merida.edu.mx`,
        rol: RolUsuario.ADMINISTRATIVO,
        perfilAdministrativo: {
          ...perfilAdministrativoValido(),
          nivelPermiso: NivelPermiso.SUPER_ADMIN,
        },
      });

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('NIVEL_PERMISO_INSUFICIENTE');
    expect(createUser).not.toHaveBeenCalled();
  });

  it('SUPER_ADMIN da de alta un SUPER_ADMIN -> 201 (techo de la jerarquía)', async () => {
    mockCreateUserExitoso();

    const res = await request(app.getHttpServer())
      .post('/personas')
      .set('Authorization', `Bearer ${await tokenSuperAdmin()}`)
      .send({
        email: `superadmin.crea.sa.${randomUUID()}@cesp-merida.edu.mx`,
        rol: RolUsuario.ADMINISTRATIVO,
        perfilAdministrativo: {
          ...perfilAdministrativoValido(),
          nivelPermiso: NivelPermiso.SUPER_ADMIN,
        },
      });

    expect(res.status).toBe(201);
    const body = res.body as AltaPersonaBody;
    expect(body.data.usuario.rol).toBe(RolUsuario.ADMINISTRATIVO);
    expect(createUser).toHaveBeenCalledTimes(1);
  });
});
