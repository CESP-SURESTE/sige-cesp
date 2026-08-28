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

interface ErrorBody {
  error: string;
  code: string;
}
interface MateriaBody {
  data: { id: string; nombre: string; carreraId: string; ciclo: number };
}
interface MateriaListBody {
  data: Array<{ id: string; nombre: string; carreraId: string; ciclo: number }>;
}

describe('MateriasController (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let carreraLaeId: string; // LAE-MID (Mérida), duracion 8
  let carreraValladolidId: string; // LC-VLD (Valladolid)
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';

  const materiaIdsCreados: string[] = [];
  const usuarioIdsCreados: string[] = [];

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

  async function crearMateria(
    carreraId: string,
    nombre: string,
    ciclo: number,
  ) {
    const m = await prisma.materia.create({
      data: { carreraId, nombre, ciclo },
    });
    materiaIdsCreados.push(m.id);
    return m;
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
    carreraLaeId = (
      await prisma.carrera.findUniqueOrThrow({ where: { clave: 'LAE-MID' } })
    ).id;
    carreraValladolidId = (
      await prisma.carrera.findUniqueOrThrow({ where: { clave: 'LC-VLD' } })
    ).id;
  }, 30000);

  afterAll(async () => {
    if (materiaIdsCreados.length > 0) {
      await prisma.registroAuditoria.deleteMany({
        where: { entidad: 'Materia', entidadId: { in: materiaIdsCreados } },
      });
      await prisma.materia.deleteMany({
        where: { id: { in: materiaIdsCreados } },
      });
    }
    if (usuarioIdsCreados.length > 0) {
      await prisma.usuario.deleteMany({
        where: { id: { in: usuarioIdsCreados } },
      });
    }
    await app.close();
  });

  it('GET /materias?carreraId= -> 200, ordenado ciclo asc, nombre asc', async () => {
    await crearMateria(carreraLaeId, 'ZZZ Materia', 2);
    await crearMateria(carreraLaeId, 'AAA Materia', 2);
    await crearMateria(carreraLaeId, 'MMM Materia', 1);
    const token = await tokenAdminMerida();

    const res = await request(app.getHttpServer())
      .get(`/materias?carreraId=${carreraLaeId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const data = (res.body as MateriaListBody).data;
    const nuestras = data.filter((m) => materiaIdsCreados.includes(m.id));
    // ciclo 1 antes que ciclo 2; dentro del mismo ciclo, nombre asc
    expect(nuestras.map((m) => m.nombre)).toEqual([
      'MMM Materia',
      'AAA Materia',
      'ZZZ Materia',
    ]);
    expect(nuestras[0]).toMatchObject({ carreraId: carreraLaeId, ciclo: 1 });
  });

  it('GET /materias?carreraId=&ciclo=1 -> filtra por ciclo', async () => {
    const token = await tokenAdminMerida();
    const res = await request(app.getHttpServer())
      .get(`/materias?carreraId=${carreraLaeId}&ciclo=1`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    for (const m of (res.body as MateriaListBody).data) {
      expect(m.ciclo).toBe(1);
    }
  });

  it('GET /materias sin carreraId -> 400 VALIDATION_ERROR', async () => {
    const token = await tokenAdminMerida();
    const res = await request(app.getHttpServer())
      .get('/materias')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('GET /materias con carreraId de otra sede -> 404 NOT_FOUND', async () => {
    const token = await tokenAdminMerida();
    const res = await request(app.getHttpServer())
      .get(`/materias?carreraId=${carreraValladolidId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('POST /materias -> 201 y audita ALTA', async () => {
    const token = await tokenAdminMerida();
    const nombre = `Materia E2E ${randomUUID().slice(0, 8)}`;
    const res = await request(app.getHttpServer())
      .post('/materias')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre, carreraId: carreraLaeId, ciclo: 3 });

    expect(res.status).toBe(201);
    const body = res.body as MateriaBody;
    materiaIdsCreados.push(body.data.id);
    expect(body.data).toMatchObject({
      nombre,
      carreraId: carreraLaeId,
      ciclo: 3,
    });

    const registro = await prisma.registroAuditoria.findFirst({
      where: { entidad: 'Materia', accion: 'ALTA', entidadId: body.data.id },
    });
    expect(registro).not.toBeNull();
  });

  it('POST /materias con ciclo fuera de 1..duracion -> 400', async () => {
    const token = await tokenAdminMerida();
    // LAE-MID tiene duracion 8 en el seed
    const res = await request(app.getHttpServer())
      .post('/materias')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'Fuera de rango', carreraId: carreraLaeId, ciclo: 99 });
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('POST /materias con nombre duplicado en misma carrera+ciclo -> 409', async () => {
    const token = await tokenAdminMerida();
    const nombre = `Dup ${randomUUID().slice(0, 8)}`;
    const primera = await request(app.getHttpServer())
      .post('/materias')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre, carreraId: carreraLaeId, ciclo: 2 });
    expect(primera.status).toBe(201);
    materiaIdsCreados.push((primera.body as MateriaBody).data.id);

    const segunda = await request(app.getHttpServer())
      .post('/materias')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: nombre.toUpperCase(),
        carreraId: carreraLaeId,
        ciclo: 2,
      });
    expect(segunda.status).toBe(409);
    expect((segunda.body as ErrorBody).code).toBe('CONFLICT');
  });

  it('POST /materias con carreraId de otra sede -> 404', async () => {
    const token = await tokenAdminMerida();
    const res = await request(app.getHttpServer())
      .post('/materias')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'X', carreraId: carreraValladolidId, ciclo: 1 });
    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('GET/POST /materias con rol MAESTRO -> 403 ROL_NO_AUTORIZADO', async () => {
    const maestro = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.materias.maestro.${randomUUID()}@example.com`,
        rol: RolUsuario.MAESTRO,
        sedeId: sedeMeridaId,
      },
    });
    usuarioIdsCreados.push(maestro.id);
    const token = await firmarToken(
      maestro.id,
      RolUsuario.MAESTRO,
      sedeMeridaId,
    );

    const get = await request(app.getHttpServer())
      .get(`/materias?carreraId=${carreraLaeId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(get.status).toBe(403);
    expect((get.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');

    const post = await request(app.getHttpServer())
      .post('/materias')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'X', carreraId: carreraLaeId, ciclo: 1 });
    expect(post.status).toBe(403);
  });
});
