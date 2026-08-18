import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  NivelPermiso,
  PuestoAdministrativo,
  RolUsuario,
  TipoContacto,
} from '@prisma/client';
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
    matricula?: string;
    email: string;
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
 *
 * `email` (login) YA NO se manda en el body (feature 2026-08-18, ver
 * "login (Usuario.email) generado automáticamente" más abajo) — ningún
 * payload de este archivo lo incluye.
 */
describe('PersonasController — POST /personas (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let carreraMeridaId: string;
  let actorAdminId: string;
  let actorAuxiliarId: string;
  let actorSuperAdminId: string;
  let actorSinPerfilId: string;
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

  async function tokenSinPerfil(): Promise<string> {
    return firmarToken(
      {
        role: 'authenticated',
        sede_id: sedeMeridaId,
        rol: RolUsuario.ADMINISTRATIVO,
      },
      actorSinPerfilId,
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

  /**
   * Contactos de emergencia + datos de salud — extensión del alta
   * transaccional (decisión explícita del usuario, 2026-08-12: "que sea en
   * la misma transacción ya que todo se debe cargar a la vez"). Helpers
   * reutilizados en todos los payloads de este spec — antes de esta
   * extensión `contactos`/`infoMedica` no existían en el body.
   */
  function contactoAlumnoValido(overrides: Record<string, unknown> = {}) {
    return {
      tipo: TipoContacto.TUTOR,
      nombre: 'Contacto Prueba',
      telefono: '9990004444',
      parentesco: 'Padre',
      ...overrides,
    };
  }

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
      ...overrides,
    };
  }

  function perfilAdministrativoValido(overrides: Record<string, unknown> = {}) {
    return {
      nombres: 'Prueba',
      apellidoPaterno: 'Jerarquia',
      curp: `CURP${randomUUID().slice(0, 14).toUpperCase()}`,
      correoPersonal: `jerarquia.${randomUUID()}@example.com`,
      telefono: '9990001111',
      fechaContratacion: '2026-01-01',
      puesto: PuestoAdministrativo.RECEPCION,
      contactos: [contactoValido()],
      infoMedica: infoMedicaValida(),
      ...overrides,
    };
  }

  function perfilAlumnoValido(overrides: Record<string, unknown> = {}) {
    return {
      nombres: 'Prueba',
      apellidoPaterno: 'Alumno',
      fechaNacimiento: '2007-05-01',
      correoPersonal: `alumno.personal.${randomUUID()}@example.com`,
      carreraId: carreraMeridaId,
      periodoIngreso: '2026-1',
      semestreActual: 1,
      contactos: [contactoAlumnoValido()],
      infoMedica: infoMedicaValida(),
      ...overrides,
    };
  }

  function perfilMaestroValido(overrides: Record<string, unknown> = {}) {
    return {
      nombres: 'Prueba',
      apellidoPaterno: 'Maestro',
      curp: `CURP${randomUUID().slice(0, 14).toUpperCase()}`,
      correoPersonal: `maestro.personal.${randomUUID()}@example.com`,
      telefono: '9990005555',
      fechaContratacion: '2026-01-01',
      contactos: [contactoValido()],
      infoMedica: infoMedicaValida(),
      ...overrides,
    };
  }

  /**
   * Genera un par nombres/apellidoPaterno prácticamente único (feature
   * 2026-08-18, tests del algoritmo de login de MAESTRO/ADMINISTRATIVO) —
   * `normalizarParaLogin` (`PersonasService`) descarta TODO lo que no sea
   * `[a-z]` (dígitos incluidos), así que no sirve `randomUUID()` tal cual
   * para variar el nombre entre corridas del suite; esto convierte un
   * número grande y único (timestamp + random) a letras base-26
   * (`a`-`z`), sin dígitos, para que cada corrida arranque el contador de
   * colisión en 1 de verdad (nombre nunca visto antes en la DB real).
   */
  function letrasUnicas(): string {
    let n = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    let resultado = '';
    do {
      resultado = String.fromCharCode(97 + (n % 26)) + resultado;
      n = Math.floor(n / 26);
    } while (n > 0);
    return resultado;
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

    // Fixture nuevo (pendiente de QA — Día 11, re-auditoría de correcciones:
    // "el branch actor ADMINISTRATIVO SIN fila en PerfilAdministrativo no
    // tiene cobertura e2e dedicada"). A diferencia de `auxiliar` arriba (que
    // SÍ tiene fila con `nivelPermiso: AUXILIAR`), este usuario tiene `rol:
    // ADMINISTRATIVO` en `usuarios` pero deliberadamente NO tiene fila en
    // `PerfilAdministrativo` — ejercita el fallback real de
    // `verificarJerarquiaNivelPermiso` (`perfilActor?.nivelPermiso ??
    // NivelPermiso.AUXILIAR`), no solo el camino de un AUXILIAR con fila.
    const sinPerfil = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.sinperfil.${randomUUID()}@cesp-merida.edu.mx`,
        rol: RolUsuario.ADMINISTRATIVO,
        sedeId: sedeMeridaId,
      },
    });
    actorSinPerfilId = sinPerfil.id;
  });

  afterEach(() => {
    createUser.mockReset();
    deleteUser.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('alta de alumno exitosa -> 201, con usuario + temporaryPassword + matricula/email generados y email_confirm: true', async () => {
    mockCreateUserExitoso();

    const res = await request(app.getHttpServer())
      .post('/personas')
      .set('Authorization', `Bearer ${await tokenAdmin()}`)
      .send({
        rol: RolUsuario.ALUMNO,
        perfilAlumno: {
          nombres: 'Prueba',
          apellidoPaterno: 'Alumno',
          fechaNacimiento: '2007-05-01',
          correoPersonal: 'prueba.alumno.personal@example.com',
          carreraId: carreraMeridaId,
          periodoIngreso: '2026-1',
          semestreActual: 1,
          contactos: [contactoAlumnoValido()],
          infoMedica: infoMedicaValida(),
        },
      });

    expect(res.status).toBe(201);
    const body = res.body as AltaPersonaBody;
    expect(body.data.usuario.rol).toBe(RolUsuario.ALUMNO);
    expect(body.data.usuario.sedeId).toBe(sedeMeridaId);
    expect(typeof body.data.temporaryPassword).toBe('string');
    expect(body.data.temporaryPassword.length).toBeGreaterThanOrEqual(16);

    // Feature 2026-08-18: matrícula generada por el sistema, campo nuevo a
    // nivel raíz de `data`, junto a `temporaryPassword` — formato `A` + año
    // (4 dígitos) + secuencial (5 dígitos) = 9 dígitos tras la `A`.
    expect(typeof body.data.matricula).toBe('string');
    expect(body.data.matricula).toMatch(/^A\d{9}$/);
    expect(
      body.data.matricula?.startsWith(`A${new Date().getFullYear()}`),
    ).toBe(true);

    // Login generado (feature 2026-08-18, extensión del mismo día): para
    // ALUMNO es `{matricula en minúsculas}@acceso.cesp.edu.mx` — mismo
    // valor en `usuario.email` y en `data.email` (raíz, a propósito).
    expect(body.data.email).toBe(
      `${body.data.matricula?.toLowerCase()}@acceso.cesp.edu.mx`,
    );
    expect(body.data.usuario.email).toBe(body.data.email);

    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: body.data.email, email_confirm: true }),
    );

    // Confirma que la fila real de Usuario + PerfilAlumno + RegistroAuditoria
    // quedaron insertadas (no solo el 201 HTTP), y que la matrícula
    // persistida es exactamente la que devolvió la respuesta.
    const usuarioCreado = await prisma.usuario.findUnique({
      where: { id: body.data.usuario.id },
      include: { perfilAlumno: true },
    });
    expect(usuarioCreado?.email).toBe(body.data.email);
    expect(usuarioCreado?.perfilAlumno?.matricula).toBe(body.data.matricula);

    const auditoria = await prisma.registroAuditoria.findFirst({
      where: { entidad: 'Usuario', entidadId: body.data.usuario.id },
    });
    expect(auditoria?.usuarioId).toBe(actorAdminId);
    expect(auditoria?.accion).toBe('ALTA');
  });

  it('matricula ya no se acepta en el body de perfilAlumno (feature 2026-08-18) -> 400 VALIDATION_ERROR (forbidNonWhitelisted)', async () => {
    const res = await request(app.getHttpServer())
      .post('/personas')
      .set('Authorization', `Bearer ${await tokenAdmin()}`)
      .send({
        rol: RolUsuario.ALUMNO,
        perfilAlumno: perfilAlumnoValido({
          matricula: 'A202600001',
        }),
      });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
    expect(createUser).not.toHaveBeenCalled();
  });

  it('email en el body (raíz, ya no se acepta) -> 400 VALIDATION_ERROR (forbidNonWhitelisted), sin llamar a Supabase Auth', async () => {
    const res = await request(app.getHttpServer())
      .post('/personas')
      .set('Authorization', `Bearer ${await tokenAdmin()}`)
      .send({
        email: 'residual@cesp-merida.edu.mx',
        rol: RolUsuario.ALUMNO,
        perfilAlumno: perfilAlumnoValido(),
      });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
    expect(createUser).not.toHaveBeenCalled();
  });

  it('dos altas de alumno consecutivas -> matriculas y logins consecutivos y distintos, sin duplicados', async () => {
    mockCreateUserExitoso();

    const res1 = await request(app.getHttpServer())
      .post('/personas')
      .set('Authorization', `Bearer ${await tokenAdmin()}`)
      .send({
        rol: RolUsuario.ALUMNO,
        perfilAlumno: perfilAlumnoValido(),
      });
    expect(res1.status).toBe(201);

    const res2 = await request(app.getHttpServer())
      .post('/personas')
      .set('Authorization', `Bearer ${await tokenAdmin()}`)
      .send({
        rol: RolUsuario.ALUMNO,
        perfilAlumno: perfilAlumnoValido(),
      });
    expect(res2.status).toBe(201);

    const body1 = res1.body as AltaPersonaBody;
    const body2 = res2.body as AltaPersonaBody;

    expect(body1.data.matricula).toMatch(/^A\d{9}$/);
    expect(body2.data.matricula).toMatch(/^A\d{9}$/);
    expect(body1.data.matricula).not.toBe(body2.data.matricula);
    expect(body1.data.email).not.toBe(body2.data.email);

    const numero1 = Number(body1.data.matricula?.slice(-5));
    const numero2 = Number(body2.data.matricula?.slice(-5));
    expect(numero2).toBe(numero1 + 1);
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
        rol: RolUsuario.ALUMNO,
        perfilAlumno: {
          nombres: 'X',
          apellidoPaterno: 'Y',
          fechaNacimiento: '2007-01-01',
          correoPersonal: 'x@example.com',
          carreraId: carreraMeridaId,
          periodoIngreso: '2026-1',
          semestreActual: 1,
          contactos: [contactoAlumnoValido()],
          infoMedica: infoMedicaValida(),
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
      .send({ rol: RolUsuario.ALUMNO });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
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
        rol: RolUsuario.ALUMNO,
        perfilAlumno: {
          nombres: 'Rollback',
          apellidoPaterno: 'Prueba',
          fechaNacimiento: '2007-01-01',
          correoPersonal: 'rollback@example.com',
          carreraId: carreraMeridaId,
          periodoIngreso: '2026-1',
          semestreActual: 1,
          contactos: [contactoAlumnoValido()],
          infoMedica: infoMedicaValida(),
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
          rol: RolUsuario.ALUMNO,
          perfilAlumno: {
            nombres: 'Rollback',
            apellidoPaterno: 'Reject',
            fechaNacimiento: '2007-01-01',
            correoPersonal: 'rollback.reject@example.com',
            carreraId: carreraMeridaId,
            periodoIngreso: '2026-1',
            semestreActual: 1,
            contactos: [contactoAlumnoValido()],
            infoMedica: infoMedicaValida(),
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
        rol: RolUsuario.ADMINISTRATIVO,
        perfilAdministrativo: perfilAdministrativoValido(),
      });

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('NIVEL_PERMISO_INSUFICIENTE');
    expect(createUser).not.toHaveBeenCalled();
  });

  it('ADMINISTRATIVO sin fila en PerfilAdministrativo intenta dar de alta un ADMINISTRATIVO -> 403 NIVEL_PERMISO_INSUFICIENTE (fallback a AUXILIAR), sin llamar a Supabase Auth', async () => {
    const res = await request(app.getHttpServer())
      .post('/personas')
      .set('Authorization', `Bearer ${await tokenSinPerfil()}`)
      .send({
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

  /**
   * Login (`Usuario.email`) generado automáticamente — feature 2026-08-18,
   * extensión de la matrícula generada automáticamente (misma sesión de
   * trabajo). Login sintético para los 3 roles — no es un buzón real,
   * dominio placeholder `acceso.cesp.edu.mx` (elegido: "un solo dominio
   * fijo para los 3 roles", sin distinción por rol/sede).
   */
  describe('login (Usuario.email) generado automáticamente (feature 2026-08-18)', () => {
    it('MAESTRO: login = {primernombre}{primera letra apellidoPaterno}{contador}@acceso.cesp.edu.mx, contador SIEMPRE presente desde el primer registro', async () => {
      mockCreateUserExitoso();
      const nombreUnico = `Zz${letrasUnicas()}`;
      const apellidoUnico = `Qq${letrasUnicas()}`;
      const baseEsperada = `${nombreUnico.toLowerCase()}${apellidoUnico
        .charAt(0)
        .toLowerCase()}`;

      const res = await request(app.getHttpServer())
        .post('/personas')
        .set('Authorization', `Bearer ${await tokenAdmin()}`)
        .send({
          rol: RolUsuario.MAESTRO,
          perfilMaestro: perfilMaestroValido({
            nombres: `${nombreUnico} Segundo`, // nombre compuesto: solo la 1a palabra cuenta
            apellidoPaterno: apellidoUnico,
          }),
        });

      expect(res.status).toBe(201);
      const body = res.body as AltaPersonaBody;
      // Contador SIEMPRE presente desde el primer registro (nunca
      // `${base}@...` sin número).
      expect(body.data.email).toBe(`${baseEsperada}1@acceso.cesp.edu.mx`);
      expect(body.data.usuario.email).toBe(body.data.email);
    });

    it('ADMINISTRATIVO: colisión de nombre+inicial -> segundo registro recibe contador 2, distinto del primero (1)', async () => {
      mockCreateUserExitoso();
      const nombreUnico = `Yy${letrasUnicas()}`;
      const apellidoUnico = `Ww${letrasUnicas()}`;
      const baseEsperada = `${nombreUnico.toLowerCase()}${apellidoUnico
        .charAt(0)
        .toLowerCase()}`;

      const res1 = await request(app.getHttpServer())
        .post('/personas')
        .set('Authorization', `Bearer ${await tokenSuperAdmin()}`)
        .send({
          rol: RolUsuario.ADMINISTRATIVO,
          perfilAdministrativo: perfilAdministrativoValido({
            nombres: nombreUnico,
            apellidoPaterno: apellidoUnico,
          }),
        });
      expect(res1.status).toBe(201);
      const body1 = res1.body as AltaPersonaBody;
      expect(body1.data.email).toBe(`${baseEsperada}1@acceso.cesp.edu.mx`);

      // Segunda alta, MISMO nombre+apellidoPaterno exacto (mismo caso que
      // el ejemplo del encargo: "Arturo Bustamante" dos veces) -> el
      // algoritmo debe detectar la colisión contra el `Usuario.email` recién
      // insertado y subir a 2 — nunca debe repetir `${baseEsperada}1@...`.
      const res2 = await request(app.getHttpServer())
        .post('/personas')
        .set('Authorization', `Bearer ${await tokenSuperAdmin()}`)
        .send({
          rol: RolUsuario.ADMINISTRATIVO,
          perfilAdministrativo: perfilAdministrativoValido({
            nombres: nombreUnico,
            apellidoPaterno: apellidoUnico,
          }),
        });
      expect(res2.status).toBe(201);
      const body2 = res2.body as AltaPersonaBody;
      expect(body2.data.email).toBe(`${baseEsperada}2@acceso.cesp.edu.mx`);
      expect(body2.data.email).not.toBe(body1.data.email);
    });

    it('normalización: nombre con acentos/espacios genera login solo [a-z] (sin diacríticos, sin dígitos residuales)', async () => {
      mockCreateUserExitoso();
      const sufijo = letrasUnicas();

      const res = await request(app.getHttpServer())
        .post('/personas')
        .set('Authorization', `Bearer ${await tokenAdmin()}`)
        .send({
          rol: RolUsuario.MAESTRO,
          perfilMaestro: perfilMaestroValido({
            nombres: `José${sufijo}`,
            apellidoPaterno: `Bustamante${sufijo}`,
          }),
        });

      expect(res.status).toBe(201);
      const body = res.body as AltaPersonaBody;
      expect(body.data.email).toMatch(/^[a-z]+\d+@acceso\.cesp\.edu\.mx$/);
      // "José..." -> "jose..." (sin tilde), primera letra de
      // "Bustamante..." -> "b".
      expect(body.data.email?.startsWith(`jose${sufijo.toLowerCase()}b`)).toBe(
        true,
      );
    });
  });

  /**
   * Extensión (decisión explícita del usuario, 2026-08-12: "que sea en la
   * misma transacción ya que todo se debe cargar a la vez") — contactos de
   * emergencia (1-3, `orden` secuencial derivado de la posición en el array)
   * + datos de salud (`InfoMedica*`, create 1-a-1), insertados en la MISMA
   * transacción que `Usuario` + perfil + `RegistroAuditoria`.
   */
  describe('contactos de emergencia + datos de salud (extensión 2026-08-12)', () => {
    it('alta de alumno con 1 contacto -> 201, contacto insertado con orden 1', async () => {
      mockCreateUserExitoso();

      const res = await request(app.getHttpServer())
        .post('/personas')
        .set('Authorization', `Bearer ${await tokenAdmin()}`)
        .send({
          rol: RolUsuario.ALUMNO,
          perfilAlumno: perfilAlumnoValido({
            contactos: [contactoAlumnoValido({ nombre: 'Único Contacto' })],
          }),
        });

      expect(res.status).toBe(201);
      const body = res.body as AltaPersonaBody;

      const perfilAlumno = await prisma.perfilAlumno.findUniqueOrThrow({
        where: { usuarioId: body.data.usuario.id },
        include: { contactos: true },
      });
      expect(perfilAlumno.contactos).toHaveLength(1);
      expect(perfilAlumno.contactos[0].nombre).toBe('Único Contacto');
      expect(perfilAlumno.contactos[0].orden).toBe(1);
      expect(perfilAlumno.contactos[0].tipo).toBe(TipoContacto.TUTOR);
    });

    it('alta de alumno con 3 contactos -> 201, los 3 insertados con orden secuencial 1-2-3', async () => {
      mockCreateUserExitoso();

      const res = await request(app.getHttpServer())
        .post('/personas')
        .set('Authorization', `Bearer ${await tokenAdmin()}`)
        .send({
          rol: RolUsuario.ALUMNO,
          perfilAlumno: perfilAlumnoValido({
            contactos: [
              contactoAlumnoValido({ nombre: 'Contacto Uno' }),
              contactoAlumnoValido({
                nombre: 'Contacto Dos',
                tipo: TipoContacto.EMERGENCIA,
              }),
              contactoAlumnoValido({ nombre: 'Contacto Tres' }),
            ],
          }),
        });

      expect(res.status).toBe(201);
      const body = res.body as AltaPersonaBody;

      const perfilAlumno = await prisma.perfilAlumno.findUniqueOrThrow({
        where: { usuarioId: body.data.usuario.id },
        include: { contactos: { orderBy: { orden: 'asc' } } },
      });
      expect(perfilAlumno.contactos).toHaveLength(3);
      expect(perfilAlumno.contactos.map((c) => c.orden)).toEqual([1, 2, 3]);
      expect(perfilAlumno.contactos.map((c) => c.nombre)).toEqual([
        'Contacto Uno',
        'Contacto Dos',
        'Contacto Tres',
      ]);
      expect(perfilAlumno.contactos[1].tipo).toBe(TipoContacto.EMERGENCIA);
    });

    it('alta con 0 contactos -> 400 VALIDATION_ERROR, sin llamar a Supabase Auth', async () => {
      const res = await request(app.getHttpServer())
        .post('/personas')
        .set('Authorization', `Bearer ${await tokenAdmin()}`)
        .send({
          rol: RolUsuario.ALUMNO,
          perfilAlumno: perfilAlumnoValido({ contactos: [] }),
        });

      expect(res.status).toBe(400);
      expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
      expect(createUser).not.toHaveBeenCalled();
    });

    it('alta con 4 contactos -> 400 VALIDATION_ERROR, sin llamar a Supabase Auth', async () => {
      const res = await request(app.getHttpServer())
        .post('/personas')
        .set('Authorization', `Bearer ${await tokenAdmin()}`)
        .send({
          rol: RolUsuario.ALUMNO,
          perfilAlumno: perfilAlumnoValido({
            contactos: [
              contactoAlumnoValido({ nombre: 'Uno' }),
              contactoAlumnoValido({ nombre: 'Dos' }),
              contactoAlumnoValido({ nombre: 'Tres' }),
              contactoAlumnoValido({ nombre: 'Cuatro' }),
            ],
          }),
        });

      expect(res.status).toBe(400);
      expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
      expect(createUser).not.toHaveBeenCalled();
    });

    it('alta sin infoMedica -> 400 VALIDATION_ERROR', async () => {
      const perfil = perfilAlumnoValido();
      delete (perfil as Record<string, unknown>).infoMedica;

      const res = await request(app.getHttpServer())
        .post('/personas')
        .set('Authorization', `Bearer ${await tokenAdmin()}`)
        .send({
          rol: RolUsuario.ALUMNO,
          perfilAlumno: perfil,
        });

      expect(res.status).toBe(400);
      expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
      expect(createUser).not.toHaveBeenCalled();
    });

    it('datos de salud (infoMedica) guardados correctamente -> ALUMNO', async () => {
      mockCreateUserExitoso();

      const res = await request(app.getHttpServer())
        .post('/personas')
        .set('Authorization', `Bearer ${await tokenAdmin()}`)
        .send({
          rol: RolUsuario.ALUMNO,
          perfilAlumno: perfilAlumnoValido({
            infoMedica: infoMedicaValida({
              tieneCondicionMedica: true,
              padecimiento: 'Asma',
              medicamentos: 'Salbutamol',
              alergias: 'Polen',
              tratamientoAdicional: 'Ninguno',
            }),
          }),
        });

      expect(res.status).toBe(201);
      const body = res.body as AltaPersonaBody;

      const perfilAlumno = await prisma.perfilAlumno.findUniqueOrThrow({
        where: { usuarioId: body.data.usuario.id },
        include: { infoMedica: true },
      });
      expect(perfilAlumno.infoMedica?.tieneCondicionMedica).toBe(true);
      expect(perfilAlumno.infoMedica?.padecimiento).toBe('Asma');
      expect(perfilAlumno.infoMedica?.medicamentos).toBe('Salbutamol');
      expect(perfilAlumno.infoMedica?.alergias).toBe('Polen');
      expect(perfilAlumno.infoMedica?.tratamientoAdicional).toBe('Ninguno');
    });

    it('datos de salud (infoMedica) + contactos guardados correctamente -> MAESTRO', async () => {
      mockCreateUserExitoso();

      const res = await request(app.getHttpServer())
        .post('/personas')
        .set('Authorization', `Bearer ${await tokenAdmin()}`)
        .send({
          rol: RolUsuario.MAESTRO,
          perfilMaestro: perfilMaestroValido({
            contactos: [
              contactoValido({ nombre: 'Contacto Maestro Uno' }),
              contactoValido({ nombre: 'Contacto Maestro Dos' }),
            ],
            infoMedica: infoMedicaValida({
              tieneCondicionMedica: true,
              padecimiento: 'Hipertensión',
            }),
          }),
        });

      expect(res.status).toBe(201);
      const body = res.body as AltaPersonaBody;

      const perfilMaestro = await prisma.perfilMaestro.findUniqueOrThrow({
        where: { usuarioId: body.data.usuario.id },
        include: { contactos: { orderBy: { orden: 'asc' } }, infoMedica: true },
      });
      expect(perfilMaestro.contactos).toHaveLength(2);
      expect(perfilMaestro.contactos.map((c) => c.orden)).toEqual([1, 2]);
      expect(perfilMaestro.infoMedica?.tieneCondicionMedica).toBe(true);
      expect(perfilMaestro.infoMedica?.padecimiento).toBe('Hipertensión');
    });

    it('datos de salud (infoMedica) + contactos guardados correctamente -> ADMINISTRATIVO', async () => {
      mockCreateUserExitoso();

      const res = await request(app.getHttpServer())
        .post('/personas')
        .set('Authorization', `Bearer ${await tokenSuperAdmin()}`)
        .send({
          rol: RolUsuario.ADMINISTRATIVO,
          perfilAdministrativo: {
            ...perfilAdministrativoValido(),
            contactos: [contactoValido({ nombre: 'Contacto Administrativo' })],
            infoMedica: infoMedicaValida({
              tieneCondicionMedica: false,
            }),
          },
        });

      expect(res.status).toBe(201);
      const body = res.body as AltaPersonaBody;

      const perfilAdministrativo =
        await prisma.perfilAdministrativo.findUniqueOrThrow({
          where: { usuarioId: body.data.usuario.id },
          include: { contactos: true, infoMedica: true },
        });
      expect(perfilAdministrativo.contactos).toHaveLength(1);
      expect(perfilAdministrativo.contactos[0].nombre).toBe(
        'Contacto Administrativo',
      );
      expect(perfilAdministrativo.infoMedica?.tieneCondicionMedica).toBe(false);
    });
  });
});
