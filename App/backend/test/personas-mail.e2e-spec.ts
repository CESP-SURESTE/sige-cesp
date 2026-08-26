import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { RolUsuario } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { SEDE_GUARD_ENV_OVERRIDE } from '../src/common/guards/sede.guard';
import { PERSONAS_SUPABASE_CLIENT_OVERRIDE } from '../src/personas/personas.service';
import { MAIL_FETCH_OVERRIDE } from '../src/mail/mail.service';
import { loadEnv } from '../src/load-env';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup-app';

loadEnv();

interface AltaPersonaBody {
  data: {
    usuario: { id: string; email: string; rol: string; sedeId: string };
    temporaryPassword: string;
    matricula?: string;
    email: string;
  };
}

/**
 * Test de integración — Fase 4, Día 13 (desbloqueado 2026-08-17).
 *
 * Enganche real de `POST /personas` -> `MailService.enviarCorreoBienvenida`
 * — best-effort, NUNCA debe afectar la respuesta HTTP del alta. Archivo
 * separado de `personas.e2e-spec.ts` (que ya cubre el resto de `POST
 * /personas` a fondo) para no duplicar todo ese setup — solo lo mínimo para
 * ejercitar el correo.
 *
 * `MAIL_FETCH_OVERRIDE` mockea `fetch` (mismo patrón que
 * `PERSONAS_SUPABASE_CLIENT_OVERRIDE` para Supabase Auth) — ningún test de
 * este archivo (ni de ningún otro) le pega a Mailgun real.
 *
 * `MAILGUN_ENVIOS_HABILITADO` se fuerza a `'true'` en este archivo
 * (`beforeAll`/`afterAll`) porque el flag (Día 13, pedido explícito del
 * usuario 2026-08-17) viene apagado por defecto en `.env` — sin esto,
 * `MailService` haría skip antes de siquiera llamar al `fetch` mockeado, y
 * no se podría verificar el payload real armado por
 * `PersonasService.altaPersona`. El resto de la suite (`personas.e2e-spec.ts`
 * y cualquier otro spec que dispare un alta) sigue corriendo con el flag
 * apagado como viene en `.env` — no le pegan a `fetch` en absoluto,
 * independientemente de si mockean `MAIL_FETCH_OVERRIDE` o no.
 *
 * Cambio de destino (feature 2026-08-18) — el correo YA NO se manda al login
 * (`dto.email` / el login generado); se manda SIEMPRE a `correoPersonal` del
 * perfil, para los 3 roles por igual. `payloadAlumno` (abajo) ya no acepta
 * `email` (ese campo ni siquiera existe más en el DTO — el login se genera
 * internamente); en su lugar deja variar `correoPersonal` vía `overrides`.
 */
describe('PersonasController — POST /personas + correo de bienvenida (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let carreraMeridaId: string;
  let actorAdminId: string;
  let createUser: jest.Mock;
  let deleteUser: jest.Mock;
  let mailFetch: jest.Mock;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';
  const flagOriginal = process.env.MAILGUN_ENVIOS_HABILITADO;

  // Cleanup real (corrección 2026-08-25 — este spec acumulaba usuarios de
  // prueba reales sin límite en la DB de dev, ver `documentacion_de_agentes/
  // ESTADO.md`). Cada `usuarioId` real creado por las 3 altas exitosas de
  // este archivo se agrega aquí; `afterAll` los borra al final. Acotado a
  // los ids que ESTE archivo crea.
  const usuarioIdsCreados: string[] = [];

  async function tokenAdmin(): Promise<string> {
    return new jose.SignJWT({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    })
      .setProtectedHeader({ alg, kid })
      .setSubject(actorAdminId)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  function contactoAlumnoValido() {
    return {
      tipo: 'TUTOR',
      nombre: 'Contacto Prueba',
      telefono: '9990004444',
      parentesco: 'Padre',
    };
  }

  function infoMedicaValida() {
    return { tieneCondicionMedica: false };
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

  function mockMailFetchOk() {
    mailFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve(''),
    });
  }

  function mockMailFetchRechazado() {
    // Comportamiento real más probable en el sandbox de Mailgun hoy —
    // destinatario no autorizado manualmente en el dashboard.
    mailFetch.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: () =>
        Promise.resolve("'to' parameter is not a valid mailbox address"),
    });
  }

  function payloadAlumno(overrides: Record<string, unknown> = {}) {
    return {
      rol: RolUsuario.ALUMNO,
      perfilAlumno: {
        nombres: 'Correo',
        apellidoPaterno: 'Bienvenida',
        apellidoMaterno: 'Prueba',
        fechaNacimiento: '2007-05-01',
        correoPersonal: `alumno.personal.${randomUUID()}@example.com`,
        carreraId: carreraMeridaId,
        periodoIngreso: '2026-1',
        semestreActual: 1,
        contactos: [contactoAlumnoValido()],
        infoMedica: infoMedicaValida(),
        ...overrides,
      },
    };
  }

  beforeAll(async () => {
    process.env.MAILGUN_ENVIOS_HABILITADO = 'true';

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

    mailFetch = jest.fn();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SEDE_GUARD_ENV_OVERRIDE)
      .useValue({ jwks: { keys: [publicJwk] } })
      .overrideProvider(PERSONAS_SUPABASE_CLIENT_OVERRIDE)
      .useValue(mockSupabaseAdminClient)
      .overrideProvider(MAIL_FETCH_OVERRIDE)
      .useValue(mailFetch)
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

    const admin = await prisma.usuario.findUniqueOrThrow({
      where: { email: 'ana.canul@cesp-merida.edu.mx' },
    });
    actorAdminId = admin.id;
  });

  afterEach(() => {
    createUser.mockReset();
    mailFetch.mockReset();
  });

  afterAll(async () => {
    process.env.MAILGUN_ENVIOS_HABILITADO = flagOriginal;
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

  it('alta exitosa -> llama a Mailgun con el payload correcto: "to" es correoPersonal (NO el login), el cuerpo muestra el login generado', async () => {
    mockCreateUserExitoso();
    mockMailFetchOk();
    const correoPersonal = `mail.exitoso.personal.${randomUUID()}@example.com`;

    const res = await request(app.getHttpServer())
      .post('/personas')
      .set('Authorization', `Bearer ${await tokenAdmin()}`)
      .send(payloadAlumno({ correoPersonal }));

    expect(res.status).toBe(201);
    const body = res.body as AltaPersonaBody;
    usuarioIdsCreados.push(body.data.usuario.id);

    expect(mailFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mailFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/messages');
    expect(init.method).toBe('POST');

    const sentBody = new URLSearchParams(init.body as string);
    // Destino REAL del envío (feature 2026-08-18) — `correoPersonal`, NO el
    // login generado (`body.data.email` / `body.data.usuario.email`).
    expect(sentBody.get('to')).toBe(correoPersonal);
    expect(sentBody.get('to')).not.toBe(body.data.email);
    expect(sentBody.get('text')).toContain('Correo Bienvenida Prueba');
    // El CUERPO del correo sigue mostrando el login generado como texto —
    // es el dato real con el que la persona debe iniciar sesión.
    expect(sentBody.get('text')).toContain(body.data.email);
    expect(sentBody.get('text')).toContain(body.data.temporaryPassword);
  });

  it('Mailgun rechaza el envío (sandbox) -> el alta de todos modos completa con 201 y temporaryPassword', async () => {
    mockCreateUserExitoso();
    mockMailFetchRechazado();
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      const res = await request(app.getHttpServer())
        .post('/personas')
        .set('Authorization', `Bearer ${await tokenAdmin()}`)
        .send(payloadAlumno());

      expect(res.status).toBe(201);
      const body = res.body as AltaPersonaBody;
      usuarioIdsCreados.push(body.data.usuario.id);
      expect(body.data.usuario.email).toBe(body.data.email);
      expect(typeof body.data.temporaryPassword).toBe('string');
      expect(body.data.temporaryPassword.length).toBeGreaterThanOrEqual(16);
      expect(mailFetch).toHaveBeenCalledTimes(1);

      // Regla 12 de CLAUDE.md raíz — el fallo del correo se loguea, nunca se
      // traga en silencio.
      const logueoCorreo = consoleErrorSpy.mock.calls.some(
        ([mensaje]) =>
          typeof mensaje === 'string' &&
          mensaje.includes('Error enviando correo de bienvenida'),
      );
      expect(logueoCorreo).toBe(true);

      // La persona SÍ quedó dada de alta en la DB pese al fallo del correo.
      const usuarioCreado = await prisma.usuario.findUnique({
        where: { id: body.data.usuario.id },
      });
      expect(usuarioCreado).not.toBeNull();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('fetch de Mailgun rechaza la promesa (falla de red) -> el alta de todos modos completa con 201', async () => {
    mockCreateUserExitoso();
    mailFetch.mockRejectedValue(new Error('network down'));
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      const res = await request(app.getHttpServer())
        .post('/personas')
        .set('Authorization', `Bearer ${await tokenAdmin()}`)
        .send(payloadAlumno());

      expect(res.status).toBe(201);
      const body = res.body as AltaPersonaBody;
      usuarioIdsCreados.push(body.data.usuario.id);
      expect(typeof body.data.temporaryPassword).toBe('string');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
