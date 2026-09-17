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

describe('AuthController — POST /auth/completar-reseteo (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';
  const usuarioIdsCreados: string[] = [];

  async function firmarToken(sub: string, sedeId: string): Promise<string> {
    return new jose.SignJWT({
      role: 'authenticated',
      sede_id: sedeId,
      rol: RolUsuario.ALUMNO,
    })
      .setProtectedHeader({ alg, kid })
      .setSubject(sub)
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
    const merida = await prisma.sede.findUniqueOrThrow({
      where: { nombre: 'CESP Mérida' },
    });
    sedeMeridaId = merida.id;
  });

  afterAll(async () => {
    if (usuarioIdsCreados.length > 0) {
      await prisma.registroAuditoria.deleteMany({
        where: { usuarioId: { in: usuarioIdsCreados } },
      });
      await prisma.perfilAlumno.deleteMany({
        where: { usuarioId: { in: usuarioIdsCreados } },
      });
      await prisma.usuario.deleteMany({
        where: { id: { in: usuarioIdsCreados } },
      });
    }
    await app.close();
  });

  it('pone primerIngreso en false y responde 200', async () => {
    const usuario = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.completar-reseteo.${randomUUID()}@example.com`,
        rol: RolUsuario.ALUMNO,
        sedeId: sedeMeridaId,
        primerIngreso: true,
      },
    });
    usuarioIdsCreados.push(usuario.id);

    const token = await firmarToken(usuario.id, sedeMeridaId);

    await request(app.getHttpServer() as App)
      .post('/auth/completar-reseteo')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect((res.body as { data: { ok: true } }).data.ok).toBe(true);
      });

    const actualizado = await prisma.usuario.findUniqueOrThrow({
      where: { id: usuario.id },
    });
    expect(actualizado.primerIngreso).toBe(false);
  });

  it('devuelve 401 sin JWT', async () => {
    await request(app.getHttpServer() as App)
      .post('/auth/completar-reseteo')
      .expect(401);
  });
});
