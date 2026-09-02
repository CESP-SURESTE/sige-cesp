import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/load-env';
import { PrismaService } from '../src/prisma/prisma.service';
import { MAIL_FETCH_OVERRIDE } from '../src/mail/mail.service';
import { configureApp } from '../src/setup-app';

loadEnv();

interface ErrorBody {
  error: string;
  code: string;
}
interface EjecutarBody {
  data: {
    ocurrenciasProcesadas: number;
    notificacionesCreadas: number;
  };
}

/**
 * Suite e2e de `POST /internal/recordatorios/ejecutar` (Fase 15, Día 42).
 * A diferencia del resto de suites e2e de este repo, este endpoint NO usa
 * JWT — `InternalJobGuard` solo compara un header `X-Internal-Secret`
 * contra `process.env.INTERNAL_JOB_SECRET`. Sin `firmarToken`/scaffolding
 * de `jose`, sin `SEDE_GUARD_ENV_OVERRIDE` (nunca se pasa por `SedeGuard`).
 *
 * `scripts/run-e2e.js` corre todas las suites con `--runInBand` en UN
 * solo proceso Node — `process.env.INTERNAL_JOB_SECRET`/
 * `RECORDATORIOS_HABILITADO` se mutan acá para el propio endpoint bajo
 * prueba, y se restauran a su valor previo en `afterAll` para no filtrar
 * estado a otras suites que corran después en el mismo proceso.
 *
 * `generarRecordatoriosPendientes()` escanea TODOS los `EventoCalendario`
 * de la DB (sin filtrar por sede, ver docstring del service) — por eso los
 * asserts de "procesó/creó al menos N" usan `toBeGreaterThanOrEqual` en vez
 * de igualdad exacta, y por eso mismo cada evento de prueba se identifica
 * de forma inequívoca vía su propio `id` (`referenciaId` en `Notificacion`)
 * en vez de contar filas globales.
 *
 * Correo: esta suite fuerza `MAILGUN_ENVIOS_HABILITADO='true'` y sustituye
 * el `fetch` de `MailService` vía `MAIL_FETCH_OVERRIDE` (mismo patrón que
 * `personas-mail.e2e-spec.ts`) por un `jest.fn()` que por defecto responde
 * `200 OK` — así el correo real a Mailgun NUNCA se intenta, pero el caso 7
 * puede simular que un envío rechaza y verificar que el batching best-effort
 * (`enviarCorreosRecordatorioEnLotes`) igual completa el job, intenta al
 * resto de destinatarios y loguea el rechazo (regla 12). El env previo se
 * restaura en `afterAll`.
 */
describe('InternalRecordatoriosController (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const SECRETO_TEST = `secreto-e2e-recordatorios-${randomUUID()}`;

  const envPrevio = {
    INTERNAL_JOB_SECRET: process.env.INTERNAL_JOB_SECRET,
    RECORDATORIOS_HABILITADO: process.env.RECORDATORIOS_HABILITADO,
    MAILGUN_ENVIOS_HABILITADO: process.env.MAILGUN_ENVIOS_HABILITADO,
  };

  let sedeMeridaId: string;
  let adminMeridaId: string;

  // `fetch` mockeado que inyecta `MailService` vía `MAIL_FETCH_OVERRIDE`.
  // Por defecto responde `200 OK`; el caso 7 lo reprograma para que la
  // primera llamada rechace.
  let fetchMock: jest.Mock;

  function mockFetchOk(): void {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve(''),
    });
  }

  const eventoIdsCreados: string[] = [];

  function ejecutar(secreto?: string): request.Test {
    const req = request(app.getHttpServer()).post(
      '/internal/recordatorios/ejecutar',
    );
    if (secreto !== undefined) {
      req.set('X-Internal-Secret', secreto);
    }
    return req.send();
  }

  async function crearEvento(fechaInicio: Date): Promise<string> {
    const evento = await prisma.eventoCalendario.create({
      data: {
        sedeId: sedeMeridaId,
        autorUsuarioId: adminMeridaId,
        titulo: `Evento recordatorio E2E ${randomUUID().slice(0, 8)}`,
        fechaInicio,
        categoria: 'SOCIAL',
        alcanceTipo: 'SEDE',
      },
    });
    eventoIdsCreados.push(evento.id);
    return evento.id;
  }

  function fechaUtcEnDias(dias: number): Date {
    const base = new Date();
    base.setUTCDate(base.getUTCDate() + dias);
    return new Date(
      Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()),
    );
  }

  beforeAll(async () => {
    process.env.INTERNAL_JOB_SECRET = SECRETO_TEST;
    process.env.MAILGUN_ENVIOS_HABILITADO = 'true';

    fetchMock = jest.fn();
    mockFetchOk();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAIL_FETCH_OVERRIDE)
      .useValue(fetchMock)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = moduleFixture.get(PrismaService);

    sedeMeridaId = (
      await prisma.sede.findUniqueOrThrow({ where: { nombre: 'CESP Mérida' } })
    ).id;
    adminMeridaId = (
      await prisma.usuario.findFirstOrThrow({
        where: { rol: 'ADMINISTRATIVO', sedeId: sedeMeridaId, activo: true },
      })
    ).id;
  }, 30000);

  afterAll(async () => {
    if (eventoIdsCreados.length > 0) {
      await prisma.recordatorioEnviado.deleteMany({
        where: { eventoId: { in: eventoIdsCreados } },
      });
      await prisma.notificacion.deleteMany({
        where: { referenciaId: { in: eventoIdsCreados } },
      });
      await prisma.eventoCalendario.deleteMany({
        where: { id: { in: eventoIdsCreados } },
      });
    }

    if (envPrevio.INTERNAL_JOB_SECRET === undefined) {
      delete process.env.INTERNAL_JOB_SECRET;
    } else {
      process.env.INTERNAL_JOB_SECRET = envPrevio.INTERNAL_JOB_SECRET;
    }
    if (envPrevio.RECORDATORIOS_HABILITADO === undefined) {
      delete process.env.RECORDATORIOS_HABILITADO;
    } else {
      process.env.RECORDATORIOS_HABILITADO = envPrevio.RECORDATORIOS_HABILITADO;
    }
    if (envPrevio.MAILGUN_ENVIOS_HABILITADO === undefined) {
      delete process.env.MAILGUN_ENVIOS_HABILITADO;
    } else {
      process.env.MAILGUN_ENVIOS_HABILITADO =
        envPrevio.MAILGUN_ENVIOS_HABILITADO;
    }

    await app.close();
  });

  it('1. Sin header X-Internal-Secret -> 401 UNAUTHORIZED', async () => {
    const res = await ejecutar();
    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
  });

  it('2. Con header X-Internal-Secret incorrecto -> 401 UNAUTHORIZED', async () => {
    const res = await ejecutar('secreto-incorrecto-e2e');
    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
  });

  it('3. RECORDATORIOS_HABILITADO=false + secreto correcto -> 200 no-op', async () => {
    process.env.RECORDATORIOS_HABILITADO = 'false';

    const res = await ejecutar(SECRETO_TEST);
    // `@HttpCode(200)` explícito en el controller (fix posterior al review
    // de esta suite, ver docstring del controller) — mismo criterio que
    // `POST /auth/login`/`POST /platform-admin/login`, endpoints RPC/acción
    // que no crean un recurso durable.
    expect(res.status).toBe(200);
    expect((res.body as EjecutarBody).data).toEqual({
      ocurrenciasProcesadas: 0,
      notificacionesCreadas: 0,
    });
  });

  let eventoDentroDeVentanaId: string;

  it('4. RECORDATORIOS_HABILITADO=true + evento SEDE mañana -> genera ocurrencias y notificaciones', async () => {
    process.env.RECORDATORIOS_HABILITADO = 'true';

    eventoDentroDeVentanaId = await crearEvento(fechaUtcEnDias(1));

    const res = await ejecutar(SECRETO_TEST);
    expect(res.status).toBe(200);
    const data = (res.body as EjecutarBody).data;
    expect(data.ocurrenciasProcesadas).toBeGreaterThanOrEqual(1);
    expect(data.notificacionesCreadas).toBeGreaterThanOrEqual(1);

    const notificaciones = await prisma.notificacion.count({
      where: { referenciaId: eventoDentroDeVentanaId },
    });
    expect(notificaciones).toBeGreaterThanOrEqual(1);

    const recordatorio = await prisma.recordatorioEnviado.findFirst({
      where: { eventoId: eventoDentroDeVentanaId },
    });
    expect(recordatorio).not.toBeNull();
  });

  it('5. Idempotencia: segunda corrida inmediata no crea Notificacion nuevas para la misma ocurrencia', async () => {
    const antes = await prisma.notificacion.count({
      where: { referenciaId: eventoDentroDeVentanaId },
    });
    expect(antes).toBeGreaterThanOrEqual(1);

    const res = await ejecutar(SECRETO_TEST);
    expect(res.status).toBe(200);

    const despues = await prisma.notificacion.count({
      where: { referenciaId: eventoDentroDeVentanaId },
    });
    expect(despues).toBe(antes);
  });

  it('6. Evento con fechaInicio a más de 48h -> no genera nada para ese evento', async () => {
    const eventoFueraDeVentanaId = await crearEvento(fechaUtcEnDias(5));

    const res = await ejecutar(SECRETO_TEST);
    expect(res.status).toBe(200);

    const notificaciones = await prisma.notificacion.count({
      where: { referenciaId: eventoFueraDeVentanaId },
    });
    expect(notificaciones).toBe(0);

    const recordatorio = await prisma.recordatorioEnviado.findFirst({
      where: { eventoId: eventoFueraDeVentanaId },
    });
    expect(recordatorio).toBeNull();
  });

  it('7. Un correo que rechaza -> el job completa el conteo, intenta al resto de destinatarios y loguea el rechazo', async () => {
    process.env.RECORDATORIOS_HABILITADO = 'true';

    // La 1ª llamada a Mailgun rechaza (destinatario no autorizado en el
    // sandbox — el caso real más frecuente hoy); las demás responden OK.
    let numeroLlamada = 0;
    fetchMock.mockImplementation(() => {
      numeroLlamada += 1;
      if (numeroLlamada === 1) {
        return Promise.resolve({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          text: () =>
            Promise.resolve("'to' parameter is not a valid mailbox address"),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => Promise.resolve(''),
      });
    });
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      // Evento SEDE (CESP Mérida tiene >= 2 usuarios activos con perfil por
      // el seed) dentro de la ventana de 48h y aún sin `RecordatorioEnviado`.
      const eventoId = await crearEvento(fechaUtcEnDias(2));

      const res = await ejecutar(SECRETO_TEST);
      expect(res.status).toBe(200);

      // (a) el job devuelve el conteo correcto: la transacción de
      // Notificacion/RecordatorioEnviado no depende del correo.
      const notificaciones = await prisma.notificacion.count({
        where: { referenciaId: eventoId },
      });
      expect(notificaciones).toBeGreaterThanOrEqual(2);
      const data = (res.body as EjecutarBody).data;
      expect(data.notificacionesCreadas).toBeGreaterThanOrEqual(notificaciones);

      const recordatorio = await prisma.recordatorioEnviado.findFirst({
        where: { eventoId },
      });
      expect(recordatorio).not.toBeNull();

      // (b) los demás correos se intentaron pese al 1er rechazo.
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);

      // (c) el rechazo se logueó con el contexto del envío (regla 12).
      const logueoRechazo = errorSpy.mock.calls.some(
        (args) =>
          typeof args[0] === 'string' &&
          args[0].includes('fallo al enviar correo de recordatorio') &&
          args[0].includes(eventoId),
      );
      expect(logueoRechazo).toBe(true);
    } finally {
      errorSpy.mockRestore();
      fetchMock.mockReset();
      mockFetchOk();
    }
  });
});
