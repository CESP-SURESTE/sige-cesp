import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/load-env';
import { hashPassword } from '../src/platform-admin/password.util';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup-app';

loadEnv();

interface ErrorBody {
  error: string;
  code: string;
}
interface LoginBody {
  data: { token: string };
}

describe('POST /platform-admin/login (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const email = 'e2e.platform-admin-login@nexo-sd.mx';
  const password = 'password-de-prueba-e2e-123';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    await prisma.adminPlataforma.deleteMany({ where: { email } });
    await prisma.adminPlataforma.create({
      data: {
        email,
        passwordHash: await hashPassword(password),
        nombre: 'E2E Platform Admin',
      },
    });
  });

  afterAll(async () => {
    await prisma.adminPlataforma.deleteMany({ where: { email } });
    await app.close();
  });

  it('credenciales correctas -> 200 con token', async () => {
    const res = await request(app.getHttpServer())
      .post('/platform-admin/login')
      .send({ email, password });

    expect(res.status).toBe(200);
    expect(typeof (res.body as LoginBody).data.token).toBe('string');
  });

  it('password incorrecta -> 401 UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer())
      .post('/platform-admin/login')
      .send({ email, password: 'password-equivocada' });

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
  });

  it('email inexistente -> 401 UNAUTHORIZED (mismo código, no revela cuál falló)', async () => {
    const res = await request(app.getHttpServer())
      .post('/platform-admin/login')
      .send({ email: 'no-existe@nexo-sd.mx', password });

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
  });

  it('body inválido -> 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .post('/platform-admin/login')
      .send({ email: 'no-es-un-email', password: '' });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });
});
