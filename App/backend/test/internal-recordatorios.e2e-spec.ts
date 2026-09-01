import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/load-env';
import { PrismaService } from '../src/prisma/prisma.service';
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
 * `MAILGUN_ENVIOS_HABILITADO` ya está en `false` en `.env` de este repo (el
 * mismo criterio "falla cerrado" que usan las suites que pasan por
 * `PersonasService.altaPersona`) — no hace falta mockear `MailService` acá,
 * el correo real nunca se intenta.
 */
describe('InternalRecordatoriosController (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const SECRETO_TEST = `secreto-e2e-recordatorios-${randomUUID()}`;

  const envPrevio = {
    INTERNAL_JOB_SECRET: process.env.INTERNAL_JOB_SECRET,
    RECORDATORIOS_HABILITADO: process.env.RECORDATORIOS_HABILITADO,
  };

  let sedeMeridaId: string;
  let adminMeridaId: string;

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

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
});
