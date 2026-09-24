import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { RolUsuario } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { SEDE_GUARD_ENV_OVERRIDE } from '../src/common/guards/sede.guard';
import { loadEnv } from '../src/load-env';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  CONFIGURACION_SOPORTE_ID,
  SOPORTE_SUPABASE_CLIENT_OVERRIDE,
} from '../src/soporte/soporte.service';
import { TELEGRAM_FETCH_OVERRIDE } from '../src/telegram/telegram.service';
import { configureApp } from '../src/setup-app';

loadEnv();

interface ErrorBody {
  error: string;
  code: string;
}
interface ReporteCreadoBody {
  data: { id: string };
}

describe('Soporte — POST /soporte/reportes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let adminMeridaId: string;
  let upload: jest.Mock;
  let createSignedUrls: jest.Mock;
  let telegramFetch: jest.Mock;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';
  const reportesCreados: string[] = [];

  async function firmarToken(claims: Record<string, unknown>, subject: string): Promise<string> {
    return new jose.SignJWT(claims)
      .setProtectedHeader({ alg, kid })
      .setSubject(subject)
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

    upload = jest.fn().mockResolvedValue({ data: { path: 'x' }, error: null });
    createSignedUrls = jest.fn().mockImplementation((paths: string[]) =>
      Promise.resolve({
        data: paths.map((path) => ({
          path,
          signedUrl: `https://storage.example.com/signed/${path}`,
          error: null,
        })),
        error: null,
      }),
    );
    const mockSupabaseAdminClient = {
      storage: { from: () => ({ upload, createSignedUrls }) },
    };

    telegramFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve(''),
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SEDE_GUARD_ENV_OVERRIDE)
      .useValue({ jwks: { keys: [publicJwk] } })
      .overrideProvider(SOPORTE_SUPABASE_CLIENT_OVERRIDE)
      .useValue(mockSupabaseAdminClient)
      .overrideProvider(TELEGRAM_FETCH_OVERRIDE)
      .useValue(telegramFetch)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    const merida = await prisma.sede.findUniqueOrThrow({ where: { nombre: 'CESP Mérida' } });
    sedeMeridaId = merida.id;
    const adminMerida = await prisma.usuario.findUniqueOrThrow({ where: { email: 'ana.canul@cesp-merida.edu.mx' } });
    adminMeridaId = adminMerida.id;

    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_CHAT_ID = '1';

    await prisma.configuracionSoporte.upsert({
      where: { id: CONFIGURACION_SOPORTE_ID },
      create: { id: CONFIGURACION_SOPORTE_ID, activo: true },
      update: { activo: true },
    });
  });

  afterEach(() => {
    upload.mockClear();
    createSignedUrls.mockClear();
    telegramFetch.mockClear();
  });

  afterAll(async () => {
    await prisma.reporteBug.deleteMany({ where: { id: { in: reportesCreados } } });
    await prisma.configuracionSoporte.upsert({
      where: { id: CONFIGURACION_SOPORTE_ID },
      create: { id: CONFIGURACION_SOPORTE_ID, activo: true },
      update: { activo: true },
    });
    await app.close();
  });

  it('crea un reporte sin captura y avisa por Telegram (sendMessage)', async () => {
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO },
      adminMeridaId,
    );

    const res = await request(app.getHttpServer())
      .post('/soporte/reportes')
      .set('Authorization', `Bearer ${token}`)
      .field('descripcion', 'El botón de guardar no responde');

    expect(res.status).toBe(201);
    const id = (res.body as ReporteCreadoBody).data.id;
    reportesCreados.push(id);

    const reporte = await prisma.reporteBug.findUniqueOrThrow({ where: { id } });
    expect(reporte.descripcion).toBe('El botón de guardar no responde');
    expect(reporte.capturaStoragePath).toBeNull();
    expect(reporte.estatus).toBe('NUEVO');
    expect(upload).not.toHaveBeenCalled();
    expect(telegramFetch).toHaveBeenCalledTimes(1);
    const [url] = telegramFetch.mock.calls[0] as [string];
    expect(url).toContain('/sendMessage');
  });

  it('crea un reporte con captura y avisa por Telegram (sendPhoto)', async () => {
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO },
      adminMeridaId,
    );

    const res = await request(app.getHttpServer())
      .post('/soporte/reportes')
      .set('Authorization', `Bearer ${token}`)
      .field('descripcion', 'La tabla de grupos no carga')
      .attach('captura', Buffer.from('contenido png de prueba'), {
        filename: 'captura.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(201);
    const id = (res.body as ReporteCreadoBody).data.id;
    reportesCreados.push(id);

    const reporte = await prisma.reporteBug.findUniqueOrThrow({ where: { id } });
    expect(reporte.capturaStoragePath).toBe(`${sedeMeridaId}/${id}.png`);
    expect(upload).toHaveBeenCalledWith(
      `${sedeMeridaId}/${id}.png`,
      expect.any(Buffer),
      { contentType: 'image/png' },
    );
    expect(telegramFetch).toHaveBeenCalledTimes(1);
    const [url] = telegramFetch.mock.calls[0] as [string];
    expect(url).toContain('/sendPhoto');
  });

  it('un tipo de archivo inválido responde 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO },
      adminMeridaId,
    );

    const res = await request(app.getHttpServer())
      .post('/soporte/reportes')
      .set('Authorization', `Bearer ${token}`)
      .field('descripcion', 'x')
      .attach('captura', Buffer.from('no es una imagen'), {
        filename: 'archivo.txt',
        contentType: 'text/plain',
      });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
    expect(upload).not.toHaveBeenCalled();
  });

  it('sin descripcion responde 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO },
      adminMeridaId,
    );

    const res = await request(app.getHttpServer())
      .post('/soporte/reportes')
      .set('Authorization', `Bearer ${token}`)
      .field('descripcion', '');

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('con el bot desactivado responde 409 SOPORTE_DESACTIVADO', async () => {
    await prisma.configuracionSoporte.update({
      where: { id: CONFIGURACION_SOPORTE_ID },
      data: { activo: false },
    });

    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO },
      adminMeridaId,
    );
    const res = await request(app.getHttpServer())
      .post('/soporte/reportes')
      .set('Authorization', `Bearer ${token}`)
      .field('descripcion', 'esto no debería crearse');

    expect(res.status).toBe(409);
    expect((res.body as ErrorBody).code).toBe('SOPORTE_DESACTIVADO');
    expect(telegramFetch).not.toHaveBeenCalled();

    await prisma.configuracionSoporte.update({
      where: { id: CONFIGURACION_SOPORTE_ID },
      data: { activo: true },
    });
  });

  it('rol ALUMNO responde 403 ROL_NO_AUTORIZADO', async () => {
    const alumno = await prisma.usuario.findFirstOrThrow({ where: { sedeId: sedeMeridaId, rol: RolUsuario.ALUMNO } });
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ALUMNO },
      alumno.id,
    );
    const res = await request(app.getHttpServer())
      .post('/soporte/reportes')
      .set('Authorization', `Bearer ${token}`)
      .field('descripcion', 'x');

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });

  it('si Telegram falla, el reporte igual queda guardado (best-effort)', async () => {
    telegramFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.resolve('boom'),
    });

    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO },
      adminMeridaId,
    );
    const res = await request(app.getHttpServer())
      .post('/soporte/reportes')
      .set('Authorization', `Bearer ${token}`)
      .field('descripcion', 'Telegram caído pero esto se debe guardar');

    expect(res.status).toBe(201);
    const id = (res.body as ReporteCreadoBody).data.id;
    reportesCreados.push(id);
    const reporte = await prisma.reporteBug.findUnique({ where: { id } });
    expect(reporte).not.toBeNull();
  });
});
