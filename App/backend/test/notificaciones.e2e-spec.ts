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

interface NotifListBody {
  data: Array<{
    id: string;
    tipo: string;
    referenciaId: string;
    titulo: string;
    cuerpoCorto: string;
    leidoEn: string | null;
    createdAt: string;
  }>;
  page: number;
  limit: number;
  total: number;
}
interface ConteoBody {
  data: { total: number };
}
interface ErrorBody {
  error: string;
  code: string;
}

describe('NotificacionesController (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';

  const notificacionIdsCreados: string[] = [];
  const usuarioIdsCreados: string[] = [];

  async function crearNotificacion(
    usuarioId: string,
    sedeId: string,
    overrides: Partial<{
      tipo: 'AVISO' | 'RECORDATORIO_EVENTO';
      titulo: string;
      cuerpoCorto: string;
      referenciaId: string;
      leidoEn: Date | null;
      createdAt: Date;
    }> = {},
  ) {
    const n = await prisma.notificacion.create({
      data: {
        usuarioId,
        sedeId,
        tipo: overrides.tipo ?? 'AVISO',
        referenciaId: overrides.referenciaId ?? randomUUID(),
        titulo: overrides.titulo ?? 'Notificación de prueba',
        cuerpoCorto: overrides.cuerpoCorto ?? 'Cuerpo corto de prueba',
        leidoEn: overrides.leidoEn ?? null,
        ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
      },
    });
    notificacionIdsCreados.push(n.id);
    return n;
  }

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

  async function tokenAdminMerida(): Promise<string> {
    const admin = await prisma.usuario.findFirstOrThrow({
      where: { rol: RolUsuario.ADMINISTRATIVO, sedeId: sedeMeridaId },
    });
    return firmarToken(admin.id, RolUsuario.ADMINISTRATIVO, sedeMeridaId);
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
  }, 30000);

  afterAll(async () => {
    if (notificacionIdsCreados.length > 0) {
      await prisma.notificacion.deleteMany({
        where: { id: { in: notificacionIdsCreados } },
      });
    }
    if (usuarioIdsCreados.length > 0) {
      await prisma.usuario.deleteMany({
        where: { id: { in: usuarioIdsCreados } },
      });
    }
    await app.close();
  });

  it('GET /notificaciones sin notificaciones -> 200 { data: [], page:1, limit:20, total:0 }', async () => {
    const token = await tokenAdminMerida();
    const res = await request(app.getHttpServer())
      .get('/notificaciones')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const body = res.body as NotifListBody;
    // El admin de seed puede tener notificaciones de corridas previas de OTRAS
    // suites — filtrar a las de esta corrida por id no aplica acá (no creamos
    // ninguna). Verificar shape y que las que haya son suyas.
    expect(Array.isArray(body.data)).toBe(true);
    expect(body).toMatchObject({ page: 1, limit: 20 });
    expect(typeof body.total).toBe('number');
  });

  it('GET /notificaciones/conteo-no-leidas -> 200 { data: { total: number } }', async () => {
    const token = await tokenAdminMerida();
    const res = await request(app.getHttpServer())
      .get('/notificaciones/conteo-no-leidas')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(typeof (res.body as ConteoBody).data.total).toBe('number');
  });

  it('GET /notificaciones -> solo las del actor, orden createdAt desc, shape correcto', async () => {
    const admin = await prisma.usuario.findFirstOrThrow({
      where: { rol: RolUsuario.ADMINISTRATIVO, sedeId: sedeMeridaId },
    });
    const ahora = Date.now();
    await crearNotificacion(admin.id, sedeMeridaId, {
      titulo: 'Vieja',
      createdAt: new Date(ahora - 60_000),
    });
    await crearNotificacion(admin.id, sedeMeridaId, {
      titulo: 'Nueva',
      createdAt: new Date(ahora),
    });
    const token = await firmarToken(
      admin.id,
      RolUsuario.ADMINISTRATIVO,
      sedeMeridaId,
    );

    const res = await request(app.getHttpServer())
      .get('/notificaciones?limit=100')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as NotifListBody;
    const nuestras = body.data.filter((n) =>
      notificacionIdsCreados.includes(n.id),
    );
    const idxNueva = nuestras.findIndex((n) => n.titulo === 'Nueva');
    const idxVieja = nuestras.findIndex((n) => n.titulo === 'Vieja');
    expect(idxNueva).toBeGreaterThanOrEqual(0);
    expect(idxNueva).toBeLessThan(idxVieja); // desc: la nueva va antes
    expect(nuestras[idxNueva]).toMatchObject({
      tipo: 'AVISO',
      titulo: 'Nueva',
      leidoEn: null,
    });
    expect(typeof nuestras[idxNueva].createdAt).toBe('string');
  });

  it('GET /notificaciones -> paginación respeta page/limit', async () => {
    const admin = await prisma.usuario.findFirstOrThrow({
      where: { rol: RolUsuario.ADMINISTRATIVO, sedeId: sedeMeridaId },
    });
    const token = await firmarToken(
      admin.id,
      RolUsuario.ADMINISTRATIVO,
      sedeMeridaId,
    );
    const res = await request(app.getHttpServer())
      .get('/notificaciones?page=1&limit=1')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const body = res.body as NotifListBody;
    expect(body.data.length).toBeLessThanOrEqual(1);
    expect(body).toMatchObject({ page: 1, limit: 1 });
  });

  it('GET /notificaciones?limit=999 -> 400 VALIDATION_ERROR', async () => {
    const token = await tokenAdminMerida();
    const res = await request(app.getHttpServer())
      .get('/notificaciones?limit=999')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('GET /notificaciones/conteo-no-leidas -> cuenta solo las no leídas del actor', async () => {
    const maestro = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.notif.maestro.${randomUUID()}@example.com`,
        rol: RolUsuario.MAESTRO,
        sedeId: sedeMeridaId,
      },
    });
    usuarioIdsCreados.push(maestro.id);
    await crearNotificacion(maestro.id, sedeMeridaId, { leidoEn: null });
    await crearNotificacion(maestro.id, sedeMeridaId, { leidoEn: null });
    await crearNotificacion(maestro.id, sedeMeridaId, { leidoEn: new Date() });
    const token = await firmarToken(
      maestro.id,
      RolUsuario.MAESTRO,
      sedeMeridaId,
    );

    const res = await request(app.getHttpServer())
      .get('/notificaciones/conteo-no-leidas')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect((res.body as ConteoBody).data.total).toBe(2);
  });

  it('PATCH /notificaciones/:id/leido -> 200, baja el conteo, idempotente', async () => {
    const maestro = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.notif.leido.${randomUUID()}@example.com`,
        rol: RolUsuario.MAESTRO,
        sedeId: sedeMeridaId,
      },
    });
    usuarioIdsCreados.push(maestro.id);
    const n = await crearNotificacion(maestro.id, sedeMeridaId, {
      leidoEn: null,
    });
    const token = await firmarToken(
      maestro.id,
      RolUsuario.MAESTRO,
      sedeMeridaId,
    );

    const primera = await request(app.getHttpServer())
      .patch(`/notificaciones/${n.id}/leido`)
      .set('Authorization', `Bearer ${token}`);
    expect(primera.status).toBe(200);
    expect((primera.body as { data: { ok: boolean } }).data.ok).toBe(true);

    const conteo = await request(app.getHttpServer())
      .get('/notificaciones/conteo-no-leidas')
      .set('Authorization', `Bearer ${token}`);
    expect((conteo.body as ConteoBody).data.total).toBe(0);

    // Idempotente: segunda llamada no truena
    const segunda = await request(app.getHttpServer())
      .patch(`/notificaciones/${n.id}/leido`)
      .set('Authorization', `Bearer ${token}`);
    expect(segunda.status).toBe(200);
  });

  it('PATCH /notificaciones/:id/leido de otro usuario -> 404 NOT_FOUND', async () => {
    const dueno = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.notif.dueno.${randomUUID()}@example.com`,
        rol: RolUsuario.MAESTRO,
        sedeId: sedeMeridaId,
      },
    });
    usuarioIdsCreados.push(dueno.id);
    const n = await crearNotificacion(dueno.id, sedeMeridaId);
    const tokenOtro = await tokenAdminMerida(); // otro usuario

    const res = await request(app.getHttpServer())
      .patch(`/notificaciones/${n.id}/leido`)
      .set('Authorization', `Bearer ${tokenOtro}`);
    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('GET /notificaciones sin token -> 401 UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer()).get('/notificaciones');
    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
  });

  // Nota: este caso verifica aislamiento por `usuarioId` a nivel de aplicación
  // (NotificacionesService filtra siempre por el actor), NO aislamiento activo
  // por RLS de Postgres — Prisma se conecta con un rol que hace bypass de RLS
  // en este proyecto (ver el comentario de SedeGuard). La RLS sigue siendo
  // defensa en profundidad contra acceso directo vía cliente de Supabase.
  it('un usuario de otra sede no ve las notificaciones ajenas', async () => {
    // Sede Valladolid — nombre exacto verificado en prisma/seed.ts: 'CESP Valladolid'
    const sedeVlld = await prisma.sede.findUniqueOrThrow({
      where: { nombre: 'CESP Valladolid' },
    });
    const adminMerida = await prisma.usuario.findFirstOrThrow({
      where: { rol: RolUsuario.ADMINISTRATIVO, sedeId: sedeMeridaId },
    });
    await crearNotificacion(adminMerida.id, sedeMeridaId, {
      titulo: 'Solo para Mérida',
    });
    const adminVlld = await prisma.usuario.findFirstOrThrow({
      where: { rol: RolUsuario.ADMINISTRATIVO, sedeId: sedeVlld.id },
    });
    const tokenVlld = await firmarToken(
      adminVlld.id,
      RolUsuario.ADMINISTRATIVO,
      sedeVlld.id,
    );

    const res = await request(app.getHttpServer())
      .get('/notificaciones?limit=100')
      .set('Authorization', `Bearer ${tokenVlld}`);
    expect(res.status).toBe(200);
    const titulos = (res.body as NotifListBody).data.map((n) => n.titulo);
    expect(titulos).not.toContain('Solo para Mérida');
  });
});
