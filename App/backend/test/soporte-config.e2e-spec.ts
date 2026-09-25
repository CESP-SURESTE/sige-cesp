import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { RolUsuario } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { SEDE_GUARD_ENV_OVERRIDE } from '../src/common/guards/sede.guard';
import { firmarPlatformAdminToken } from '../src/platform-admin/platform-admin-jwt.util';
import { hashPassword } from '../src/platform-admin/password.util';
import { loadEnv } from '../src/load-env';
import { PrismaService } from '../src/prisma/prisma.service';
import { CONFIGURACION_SOPORTE_ID } from '../src/soporte/soporte.service';
import { configureApp } from '../src/setup-app';

loadEnv();

interface ErrorBody {
  error: string;
  code: string;
}
interface ConfigBody {
  data: { activo: boolean };
}

describe('Soporte — GET/PATCH /soporte/config (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let adminMeridaId: string;
  let maestroMeridaId: string;
  let platformAdminId: string;
  let platformToken: string;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';
  const emailPlatformAdmin = 'e2e-soporte-config@example.com';

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
    const merida = await prisma.sede.findUniqueOrThrow({ where: { nombre: 'CESP Mérida' } });
    sedeMeridaId = merida.id;
    const adminMerida = await prisma.usuario.findUniqueOrThrow({ where: { email: 'ana.canul@cesp-merida.edu.mx' } });
    adminMeridaId = adminMerida.id;
    const maestroMerida = await prisma.usuario.findFirstOrThrow({ where: { sedeId: sedeMeridaId, rol: RolUsuario.MAESTRO } });
    maestroMeridaId = maestroMerida.id;

    await prisma.adminPlataforma.deleteMany({ where: { email: emailPlatformAdmin } });
    const platformAdmin = await prisma.adminPlataforma.create({
      data: {
        email: emailPlatformAdmin,
        passwordHash: await hashPassword('password-e2e-123'),
        nombre: 'E2E Soporte Config',
      },
    });
    platformAdminId = platformAdmin.id;
    platformToken = await firmarPlatformAdminToken({
      sub: platformAdmin.id,
      email: platformAdmin.email,
    });
  });

  afterAll(async () => {
    // Deja el toggle en su estado por default para no afectar otras suites.
    await prisma.configuracionSoporte.upsert({
      where: { id: CONFIGURACION_SOPORTE_ID },
      create: { id: CONFIGURACION_SOPORTE_ID, activo: true },
      update: { activo: true },
    });
    await prisma.registroAuditoria.deleteMany({
      where: { adminPlataformaId: platformAdminId },
    });
    await prisma.adminPlataforma.delete({ where: { id: platformAdminId } });
    await app.close();
  });

  it('GET /soporte/config responde activo:true por default (ADMINISTRATIVO)', async () => {
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO },
      adminMeridaId,
    );
    const res = await request(app.getHttpServer())
      .get('/soporte/config')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect((res.body as ConfigBody).data.activo).toBe(true);
  });

  it('GET /soporte/config también responde para MAESTRO', async () => {
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.MAESTRO },
      maestroMeridaId,
    );
    const res = await request(app.getHttpServer())
      .get('/soporte/config')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('GET /soporte/config con rol ALUMNO responde 403 ROL_NO_AUTORIZADO', async () => {
    const alumno = await prisma.usuario.findFirstOrThrow({ where: { sedeId: sedeMeridaId, rol: RolUsuario.ALUMNO } });
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ALUMNO },
      alumno.id,
    );
    const res = await request(app.getHttpServer())
      .get('/soporte/config')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });

  it('GET /soporte/config/plataforma responde con el token de plataforma', async () => {
    const res = await request(app.getHttpServer())
      .get('/soporte/config/plataforma')
      .set('Authorization', `Bearer ${platformToken}`);
    expect(res.status).toBe(200);
    expect(typeof (res.body as ConfigBody).data.activo).toBe('boolean');
  });

  it('GET /soporte/config/plataforma con JWT de Supabase (no de plataforma) responde 401', async () => {
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO },
      adminMeridaId,
    );
    const res = await request(app.getHttpServer())
      .get('/soporte/config/plataforma')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('PATCH /soporte/config con JWT de Supabase (no de plataforma) responde 401', async () => {
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO },
      adminMeridaId,
    );
    const res = await request(app.getHttpServer())
      .patch('/soporte/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ activo: false });
    expect(res.status).toBe(401);
  });

  it('PATCH /soporte/config apaga y GET refleja el cambio', async () => {
    const patch = await request(app.getHttpServer())
      .patch('/soporte/config')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ activo: false });
    expect(patch.status).toBe(200);
    expect((patch.body as ConfigBody).data.activo).toBe(false);

    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO },
      adminMeridaId,
    );
    const get = await request(app.getHttpServer())
      .get('/soporte/config')
      .set('Authorization', `Bearer ${token}`);
    expect((get.body as ConfigBody).data.activo).toBe(false);

    const registro = await prisma.registroAuditoria.findFirst({
      where: { entidad: 'ConfiguracionSoporte', accion: 'EDICION' },
      orderBy: { fecha: 'desc' },
    });
    expect(registro?.adminPlataformaId).toBe(platformAdminId);
  });
});
