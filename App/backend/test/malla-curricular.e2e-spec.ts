import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { RolUsuario } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { SEDE_GUARD_ENV_OVERRIDE } from '../src/common/guards/sede.guard';
import { MALLA_SUPABASE_CLIENT_OVERRIDE } from '../src/malla-curricular/malla-curricular.service';
import { loadEnv } from '../src/load-env';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup-app';

loadEnv();

interface ErrorBody {
  error: string;
  code: string;
}
interface MallaBody {
  data: {
    id: string;
    carreraId: string;
    nombreArchivo: string;
    subidaPorId: string;
  };
}

describe('MallaCurricularController — POST /carreras/:id/malla (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let sedeValladolidId: string;
  let carreraMeridaId: string;
  let actorUsuarioId: string;
  let upload: jest.Mock;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';

  async function firmarToken(claims: Record<string, unknown>): Promise<string> {
    return new jose.SignJWT(claims)
      .setProtectedHeader({ alg, kid })
      .setSubject(actorUsuarioId)
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
    const mockSupabaseAdminClient = {
      storage: { from: () => ({ upload }) },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SEDE_GUARD_ENV_OVERRIDE)
      .useValue({ jwks: { keys: [publicJwk] } })
      .overrideProvider(MALLA_SUPABASE_CLIENT_OVERRIDE)
      .useValue(mockSupabaseAdminClient)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    const merida = await prisma.sede.findUniqueOrThrow({
      where: { nombre: 'CESP Mérida' },
    });
    sedeMeridaId = merida.id;
    const valladolid = await prisma.sede.findUniqueOrThrow({
      where: { nombre: 'CESP Valladolid' },
    });
    sedeValladolidId = valladolid.id;
    const carrera = await prisma.carrera.findUniqueOrThrow({
      where: { clave: 'LAE-MID' },
    });
    carreraMeridaId = carrera.id;
    const actor = await prisma.usuario.findUniqueOrThrow({
      where: { email: 'ana.canul@cesp-merida.edu.mx' },
    });
    actorUsuarioId = actor.id;
  });

  afterEach(() => {
    upload.mockClear();
  });

  afterAll(async () => {
    await prisma.registroAuditoria.deleteMany({
      where: { entidad: 'MallaCurricular', sedeId: sedeMeridaId },
    });
    await prisma.mallaCurricular.deleteMany({
      where: { carreraId: carreraMeridaId },
    });
    await app.close();
  });

  it('POST /carreras/:id/malla sube un PDF y crea el registro (primera vez)', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post(`/carreras/${carreraMeridaId}/malla`)
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', Buffer.from('%PDF-1.4 contenido de prueba'), {
        filename: 'malla.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(200);
    const body = res.body as MallaBody;
    expect(body.data.carreraId).toBe(carreraMeridaId);
    expect(body.data.nombreArchivo).toBe('malla.pdf');
    expect(body.data.subidaPorId).toBe(actorUsuarioId);
    expect(upload).toHaveBeenCalledWith(
      `${carreraMeridaId}/malla.pdf`,
      expect.any(Buffer),
      { contentType: 'application/pdf', upsert: true },
    );

    const registro = await prisma.registroAuditoria.findFirst({
      where: { entidad: 'MallaCurricular', entidadId: body.data.id },
    });
    expect(registro?.usuarioId).toBe(actorUsuarioId);
    expect(registro?.accion).toBe('ALTA');
  });

  it('POST /carreras/:id/malla una segunda vez actualiza (upsert, no duplica)', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    await request(app.getHttpServer())
      .post(`/carreras/${carreraMeridaId}/malla`)
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', Buffer.from('%PDF-1.4 v1'), {
        filename: 'v1.pdf',
        contentType: 'application/pdf',
      });

    const res = await request(app.getHttpServer())
      .post(`/carreras/${carreraMeridaId}/malla`)
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', Buffer.from('%PDF-1.4 v2'), {
        filename: 'v2.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(200);
    expect((res.body as MallaBody).data.nombreArchivo).toBe('v2.pdf');

    const total = await prisma.mallaCurricular.count({
      where: { carreraId: carreraMeridaId },
    });
    expect(total).toBe(1);

    const registroEdicion = await prisma.registroAuditoria.findFirst({
      where: {
        entidad: 'MallaCurricular',
        entidadId: (res.body as MallaBody).data.id,
      },
      orderBy: { fecha: 'desc' },
    });
    expect(registroEdicion?.accion).toBe('EDICION');
  });

  it('POST /carreras/:id/malla sin archivo -> 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post(`/carreras/${carreraMeridaId}/malla`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('POST /carreras/:id/malla con archivo que no es PDF -> 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post(`/carreras/${carreraMeridaId}/malla`)
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', Buffer.from('no soy un pdf'), {
        filename: 'malla.txt',
        contentType: 'text/plain',
      });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
    expect(upload).not.toHaveBeenCalled();
  });

  it('POST /carreras/:id/malla con carrera de otra sede -> 404 NOT_FOUND', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeValladolidId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post(`/carreras/${carreraMeridaId}/malla`)
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', Buffer.from('%PDF-1.4'), {
        filename: 'malla.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('POST /carreras/:id/malla rol no ADMINISTRATIVO -> 403 ROL_NO_AUTORIZADO', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ALUMNO,
    });

    const res = await request(app.getHttpServer())
      .post(`/carreras/${carreraMeridaId}/malla`)
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', Buffer.from('%PDF-1.4'), {
        filename: 'malla.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });

  it('POST /carreras/:id/malla sin Authorization -> 401 UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer())
      .post(`/carreras/${carreraMeridaId}/malla`)
      .attach('archivo', Buffer.from('%PDF-1.4'), {
        filename: 'malla.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
  });

  it('POST /carreras/:id/malla con archivo mayor a 5MB -> 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const archivoGrande = Buffer.alloc(6 * 1024 * 1024, 'a');
    const res = await request(app.getHttpServer())
      .post(`/carreras/${carreraMeridaId}/malla`)
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', archivoGrande, {
        filename: 'grande.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('POST /carreras/:id/malla con falla de Storage -> 500 SERVER_ERROR', async () => {
    upload.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });

    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });
    const res = await request(app.getHttpServer())
      .post(`/carreras/${carreraMeridaId}/malla`)
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', Buffer.from('%PDF-1.4'), {
        filename: 'malla.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(500);
    expect((res.body as ErrorBody).code).toBe('SERVER_ERROR');
  });
});
