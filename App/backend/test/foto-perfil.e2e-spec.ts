import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { RolUsuario } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { SEDE_GUARD_ENV_OVERRIDE } from '../src/common/guards/sede.guard';
import { FOTO_PERFIL_SUPABASE_CLIENT_OVERRIDE } from '../src/foto-perfil/foto-perfil.service';
import { loadEnv } from '../src/load-env';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup-app';

loadEnv();

interface ErrorBody {
  error: string;
  code: string;
}
interface OkBody {
  data: { ok: true };
}

describe('FotoPerfil — POST/DELETE /perfil/foto y /personas/:id/foto (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let sedeValladolidId: string;
  let alumnoMeridaId: string;
  let adminMeridaId: string;
  let adminValladolidId: string;
  let upload: jest.Mock;
  let remove: jest.Mock;
  let createSignedUrls: jest.Mock;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';

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
    remove = jest.fn().mockResolvedValue({ data: [], error: null });
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
      storage: { from: () => ({ upload, remove, createSignedUrls }) },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SEDE_GUARD_ENV_OVERRIDE)
      .useValue({ jwks: { keys: [publicJwk] } })
      .overrideProvider(FOTO_PERFIL_SUPABASE_CLIENT_OVERRIDE)
      .useValue(mockSupabaseAdminClient)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    const merida = await prisma.sede.findUniqueOrThrow({ where: { nombre: 'CESP Mérida' } });
    sedeMeridaId = merida.id;
    const valladolid = await prisma.sede.findUniqueOrThrow({ where: { nombre: 'CESP Valladolid' } });
    sedeValladolidId = valladolid.id;
    const alumno = await prisma.usuario.findUniqueOrThrow({ where: { email: 'luis.chan@cesp-merida.edu.mx' } });
    alumnoMeridaId = alumno.id;
    const adminMerida = await prisma.usuario.findUniqueOrThrow({ where: { email: 'ana.canul@cesp-merida.edu.mx' } });
    adminMeridaId = adminMerida.id;
    const adminValladolid = await prisma.usuario.findUniqueOrThrow({ where: { email: 'jorge.ek@cesp-valladolid.edu.mx' } });
    adminValladolidId = adminValladolid.id;
  });

  afterEach(() => {
    upload.mockClear();
    remove.mockClear();
    createSignedUrls.mockClear();
  });

  afterAll(async () => {
    await prisma.registroAuditoria.deleteMany({
      where: { entidad: 'Usuario', detalle: { path: ['accion'], string_contains: 'foto_perfil' } },
    });
    await prisma.usuario.updateMany({
      where: { id: { in: [alumnoMeridaId, adminMeridaId, adminValladolidId] } },
      data: { fotoStoragePath: null },
    });
    await app.close();
  });

  it('POST /perfil/foto sube la foto propia del alumno', async () => {
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ALUMNO },
      alumnoMeridaId,
    );

    const res = await request(app.getHttpServer())
      .post('/perfil/foto')
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', Buffer.from('contenido jpg de prueba'), {
        filename: 'foto.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(200);
    expect((res.body as OkBody).data).toEqual({ ok: true });
    expect(upload).toHaveBeenCalledWith(
      `${alumnoMeridaId}/foto.jpg`,
      expect.any(Buffer),
      { contentType: 'image/jpeg', upsert: true },
    );

    const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: alumnoMeridaId } });
    expect(usuario.fotoStoragePath).toBe(`${alumnoMeridaId}/foto.jpg`);

    const registro = await prisma.registroAuditoria.findFirst({
      where: { entidad: 'Usuario', entidadId: alumnoMeridaId, accion: 'EDICION' },
      orderBy: { fecha: 'desc' },
    });
    expect(registro?.usuarioId).toBe(alumnoMeridaId);
  });

  it('POST /perfil/foto con un tipo de archivo inválido responde 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ALUMNO },
      alumnoMeridaId,
    );

    const res = await request(app.getHttpServer())
      .post('/perfil/foto')
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', Buffer.from('no es una imagen'), {
        filename: 'archivo.txt',
        contentType: 'text/plain',
      });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
    expect(upload).not.toHaveBeenCalled();
  });

  it('GET /perfil trae fotoUrl null si no hay foto, y la URL firmada tras subir una', async () => {
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeValladolidId, rol: RolUsuario.ADMINISTRATIVO },
      adminValladolidId,
    );

    const antes = await request(app.getHttpServer())
      .get('/perfil')
      .set('Authorization', `Bearer ${token}`);
    expect((antes.body as { data: { fotoUrl: string | null } }).data.fotoUrl).toBeNull();

    await request(app.getHttpServer())
      .post('/perfil/foto')
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', Buffer.from('contenido png de prueba'), {
        filename: 'foto.png',
        contentType: 'image/png',
      });

    const despues = await request(app.getHttpServer())
      .get('/perfil')
      .set('Authorization', `Bearer ${token}`);
    const body = despues.body as { data: { fotoUrl: string | null } };
    expect(body.data.fotoUrl).toBe(
      `https://storage.example.com/signed/${adminValladolidId}/foto.png`,
    );
  });

  it('DELETE /perfil/foto quita la foto y GET /perfil vuelve a traer fotoUrl null', async () => {
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ALUMNO },
      alumnoMeridaId,
    );

    await request(app.getHttpServer())
      .post('/perfil/foto')
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', Buffer.from('x'), { filename: 'foto.webp', contentType: 'image/webp' });

    const del = await request(app.getHttpServer())
      .delete('/perfil/foto')
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect(remove).toHaveBeenCalled();

    const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: alumnoMeridaId } });
    expect(usuario.fotoStoragePath).toBeNull();
  });
});
