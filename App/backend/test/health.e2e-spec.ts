import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { configureApp } from './../src/setup-app';

/**
 * `GET /health` — Prisma mockeado a propósito: este e2e NO toca la DB real
 * (corre sin red ni credenciales de Supabase).
 */
describe('GET /health (e2e)', () => {
  let app: INestApplication<App>;
  const queryRaw = jest.fn();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $queryRaw: queryRaw,
        $connect: jest.fn(),
        $disconnect: jest.fn(),
      })
      .compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  beforeEach(() => {
    queryRaw.mockReset();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    await app.close();
  });

  it('200 { status: "ok" } sin Authorization', async () => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('503 { status: "error" } sin filtrar detalles si la DB falla', async () => {
    queryRaw.mockRejectedValue(new Error('password authentication failed'));
    const res = await request(app.getHttpServer()).get('/health').expect(503);
    expect(res.body).toEqual({ status: 'error' });
    expect(JSON.stringify(res.body)).not.toContain('password');
  });
});
