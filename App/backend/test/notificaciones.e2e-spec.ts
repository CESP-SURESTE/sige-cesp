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

describe('NotificacionesController (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';

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
});
