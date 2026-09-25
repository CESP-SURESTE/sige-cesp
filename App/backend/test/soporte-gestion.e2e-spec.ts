import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { SEDE_GUARD_ENV_OVERRIDE } from '../src/common/guards/sede.guard';
import { firmarPlatformAdminToken } from '../src/platform-admin/platform-admin-jwt.util';
import { hashPassword } from '../src/platform-admin/password.util';
import { loadEnv } from '../src/load-env';
import { PrismaService } from '../src/prisma/prisma.service';
import { SOPORTE_SUPABASE_CLIENT_OVERRIDE } from '../src/soporte/soporte.service';
import { configureApp } from '../src/setup-app';

loadEnv();

interface ErrorBody {
  error: string;
  code: string;
}
interface ListaBody {
  data: { id: string; estatus: string; sede: { id: string } }[];
  page: number;
  limit: number;
  total: number;
}

describe('Soporte — GET/PATCH reportes (gestión, e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let adminMeridaId: string;
  let platformAdminId: string;
  let platformToken: string;
  let reporteId: string;
  const emailPlatformAdmin = 'e2e-soporte-gestion@example.com';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SEDE_GUARD_ENV_OVERRIDE)
      .useValue({ jwks: { keys: [] } })
      .overrideProvider(SOPORTE_SUPABASE_CLIENT_OVERRIDE)
      .useValue({ storage: { from: () => ({ createSignedUrls: () => Promise.resolve({ data: [], error: null }) }) } })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    const merida = await prisma.sede.findUniqueOrThrow({ where: { nombre: 'CESP Mérida' } });
    sedeMeridaId = merida.id;
    const adminMerida = await prisma.usuario.findUniqueOrThrow({ where: { email: 'ana.canul@cesp-merida.edu.mx' } });
    adminMeridaId = adminMerida.id;

    await prisma.adminPlataforma.deleteMany({ where: { email: emailPlatformAdmin } });
    const platformAdmin = await prisma.adminPlataforma.create({
      data: {
        email: emailPlatformAdmin,
        passwordHash: await hashPassword('password-e2e-123'),
        nombre: 'E2E Soporte Gestión',
      },
    });
    platformAdminId = platformAdmin.id;
    platformToken = await firmarPlatformAdminToken({
      sub: platformAdmin.id,
      email: platformAdmin.email,
    });

    const reporte = await prisma.reporteBug.create({
      data: {
        sedeId: sedeMeridaId,
        usuarioId: adminMeridaId,
        descripcion: 'Fixture de test — gestión de reportes',
      },
    });
    reporteId = reporte.id;
  });

  afterAll(async () => {
    await prisma.reporteBug.delete({ where: { id: reporteId } }).catch(() => undefined);
    await prisma.registroAuditoria.deleteMany({
      where: { adminPlataformaId: platformAdminId },
    });
    await prisma.adminPlataforma.delete({ where: { id: platformAdminId } });
    await app.close();
  });

  it('GET /soporte/reportes sin PlatformAdminGuard responde 401', async () => {
    const res = await request(app.getHttpServer()).get('/soporte/reportes');
    expect(res.status).toBe(401);
  });

  it('GET /soporte/reportes lista cross-sede, paginado', async () => {
    const res = await request(app.getHttpServer())
      .get('/soporte/reportes')
      .set('Authorization', `Bearer ${platformToken}`);

    expect(res.status).toBe(200);
    const body = res.body as ListaBody;
    expect(typeof body.total).toBe('number');
    expect(body.data.some((r) => r.id === reporteId)).toBe(true);
  });

  it('GET /soporte/reportes?estatus=NUEVO filtra', async () => {
    const res = await request(app.getHttpServer())
      .get('/soporte/reportes?estatus=NUEVO')
      .set('Authorization', `Bearer ${platformToken}`);

    expect(res.status).toBe(200);
    const body = res.body as ListaBody;
    expect(body.data.every((r) => r.estatus === 'NUEVO')).toBe(true);
  });

  it('GET /soporte/reportes?estatus=INVALIDO responde 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .get('/soporte/reportes?estatus=INVALIDO')
      .set('Authorization', `Bearer ${platformToken}`);

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('PATCH /soporte/reportes/:id/estatus cambia el estatus y audita', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/soporte/reportes/${reporteId}/estatus`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ estatus: 'EN_REVISION' });

    expect(res.status).toBe(200);
    const reporte = await prisma.reporteBug.findUniqueOrThrow({ where: { id: reporteId } });
    expect(reporte.estatus).toBe('EN_REVISION');

    const registro = await prisma.registroAuditoria.findFirst({
      where: { entidad: 'ReporteBug', entidadId: reporteId },
      orderBy: { fecha: 'desc' },
    });
    expect(registro?.adminPlataformaId).toBe(platformAdminId);
    expect(registro?.sedeId).toBe(sedeMeridaId);
  });

  it('PATCH con estatus inválido responde 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/soporte/reportes/${reporteId}/estatus`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ estatus: 'NO_EXISTE' });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('PATCH contra un id inexistente responde 404 NOT_FOUND', async () => {
    const res = await request(app.getHttpServer())
      .patch('/soporte/reportes/00000000-0000-0000-0000-000000000000/estatus')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ estatus: 'RESUELTO' });

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });
});
