import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { RolUsuario } from '@prisma/client';
import { randomUUID } from 'node:crypto';
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
  let createSignedUrl: jest.Mock;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';

  async function firmarToken(
    claims: Record<string, unknown>,
    subject: string = actorUsuarioId,
  ): Promise<string> {
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
    createSignedUrl = jest.fn().mockResolvedValue({
      data: { signedUrl: 'https://storage.example.com/signed/mock-url' },
      error: null,
    });
    const mockSupabaseAdminClient = {
      storage: { from: () => ({ upload, createSignedUrl }) },
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

    // Limpia cualquier malla de LC-VLD que pueda existir desde ejecuciones
    // previas, para asegurar un estado limpio al inicio de los tests
    const carreraSinMallaLcVld = await prisma.carrera.findFirst({
      where: { clave: 'LC-VLD' },
    });
    if (carreraSinMallaLcVld) {
      await prisma.mallaCurricular.deleteMany({
        where: { carreraId: carreraSinMallaLcVld.id },
      });
    }
  });

  afterEach(() => {
    upload.mockClear();
    createSignedUrl.mockClear();
  });

  afterAll(async () => {
    // Limpia mallas de ambas sedes (Mérida y Valladolid) para asegurar
    // estado limpio en futuras corridas
    const carreraSinMallaLcVld = await prisma.carrera.findFirst({
      where: { clave: 'LC-VLD' },
    });
    if (carreraSinMallaLcVld) {
      await prisma.mallaCurricular.deleteMany({
        where: { carreraId: carreraSinMallaLcVld.id },
      });
    }

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

  it('GET /carreras/:id/malla sin malla previa -> 200 con data null', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeValladolidId,
      rol: RolUsuario.ADMINISTRATIVO,
    });
    const carreraSinMalla = await prisma.carrera.findUniqueOrThrow({
      where: { clave: 'LC-VLD' },
    });

    const res = await request(app.getHttpServer())
      .get(`/carreras/${carreraSinMalla.id}/malla`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect((res.body as { data: unknown }).data).toBeNull();
  });

  it('GET /carreras/:id/malla con malla previa -> 200 con nombreArchivo/subidaEn/subidaPor', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    await request(app.getHttpServer())
      .post(`/carreras/${carreraMeridaId}/malla`)
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', Buffer.from('%PDF-1.4'), {
        filename: 'malla.pdf',
        contentType: 'application/pdf',
      });

    const res = await request(app.getHttpServer())
      .get(`/carreras/${carreraMeridaId}/malla`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as {
      data: {
        nombreArchivo: string;
        subidaEn: string;
        subidaPor: { nombres: string; apellidoPaterno: string };
      };
    };
    expect(body.data.nombreArchivo).toBe('malla.pdf');
    expect(body.data.subidaPor.nombres).toBe('Ana María');
    expect(body.data.subidaPor.apellidoPaterno).toBe('Canul');
  });

  it('GET /carreras/:id/malla con carrera de otra sede -> 404 NOT_FOUND', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeValladolidId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .get(`/carreras/${carreraMeridaId}/malla`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('GET /carreras refleja tieneMalla:true tras una subida exitosa', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    await request(app.getHttpServer())
      .post(`/carreras/${carreraMeridaId}/malla`)
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', Buffer.from('%PDF-1.4'), {
        filename: 'malla.pdf',
        contentType: 'application/pdf',
      });

    const listado = await request(app.getHttpServer())
      .get('/carreras')
      .set('Authorization', `Bearer ${token}`);

    const body = listado.body as {
      data: Array<{ id: string; tieneMalla: boolean }>;
    };
    const carreraListada = body.data.find((c) => c.id === carreraMeridaId);
    expect(carreraListada?.tieneMalla).toBe(true);
  });

  describe('GET /perfil/malla (Día 24)', () => {
    let alumnoConMallaUsuarioId: string;
    let alumnoConMallaPerfilId: string;
    let alumnoSinMallaUsuarioId: string;
    let alumnoSinMallaPerfilId: string;
    let carreraSinMallaId: string;

    beforeAll(async () => {
      // Asegura una malla vigente en `carreraMeridaId` sin depender del
      // orden de ejecución de las pruebas de arriba.
      const tokenAdmin = await firmarToken({
        role: 'authenticated',
        sede_id: sedeMeridaId,
        rol: RolUsuario.ADMINISTRATIVO,
      });
      await request(app.getHttpServer())
        .post(`/carreras/${carreraMeridaId}/malla`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .attach('archivo', Buffer.from('%PDF-1.4 dia24'), {
          filename: 'malla-dia24.pdf',
          contentType: 'application/pdf',
        });

      // Crea una carrera nueva sin malla para garantizar que no hay datos
      // de base interferiendo con el test.
      const carreraSinMalla = await prisma.carrera.create({
        data: {
          nombre: `Carrera Día 24 ${randomUUID()}`,
          clave: `DIA24-${randomUUID().slice(0, 8)}`,
          duracion: 6,
          nivel: 'LICENCIATURA',
          modalidad: 'PRESENCIAL',
          rvoe: 'TEST-RVOE-DIA24',
          descripcion: 'Carrera de test para Día 24',
          sedeId: sedeValladolidId,
        },
      });
      carreraSinMallaId = carreraSinMalla.id;

      const alumnoConMalla = await prisma.usuario.create({
        data: {
          id: randomUUID(),
          email: `fixture.alumnoconmalla.${randomUUID()}@cesp-merida.edu.mx`,
          rol: RolUsuario.ALUMNO,
          sedeId: sedeMeridaId,
        },
      });
      const perfilConMalla = await prisma.perfilAlumno.create({
        data: {
          usuarioId: alumnoConMalla.id,
          nombres: 'Fixture',
          apellidoPaterno: 'ConMalla',
          fechaNacimiento: new Date('2005-01-01'),
          matricula: `MID-2026-DIA24A-${randomUUID().slice(0, 8)}`,
          correoPersonal: `fixture.alumnoconmalla.${randomUUID()}@example.com`,
          carreraId: carreraMeridaId,
          estatusAcademico: 'INSCRITO',
          periodoIngreso: '2026-1',
          semestreActual: 1,
        },
      });
      alumnoConMallaUsuarioId = alumnoConMalla.id;
      alumnoConMallaPerfilId = perfilConMalla.id;

      const alumnoSinMalla = await prisma.usuario.create({
        data: {
          id: randomUUID(),
          email: `fixture.alumnosinmalla.${randomUUID()}@cesp-valladolid.edu.mx`,
          rol: RolUsuario.ALUMNO,
          sedeId: sedeValladolidId,
        },
      });
      const perfilSinMalla = await prisma.perfilAlumno.create({
        data: {
          usuarioId: alumnoSinMalla.id,
          nombres: 'Fixture',
          apellidoPaterno: 'SinMalla',
          fechaNacimiento: new Date('2005-01-01'),
          matricula: `VLD-2026-DIA24B-${randomUUID().slice(0, 8)}`,
          correoPersonal: `fixture.alumnosinmalla.${randomUUID()}@example.com`,
          carreraId: carreraSinMalla.id,
          estatusAcademico: 'INSCRITO',
          periodoIngreso: '2026-1',
          semestreActual: 1,
        },
      });
      alumnoSinMallaUsuarioId = alumnoSinMalla.id;
      alumnoSinMallaPerfilId = perfilSinMalla.id;
    });

    afterAll(async () => {
      await prisma.perfilAlumno.delete({ where: { id: alumnoConMallaPerfilId } });
      await prisma.usuario.delete({ where: { id: alumnoConMallaUsuarioId } });
      await prisma.perfilAlumno.delete({ where: { id: alumnoSinMallaPerfilId } });
      await prisma.usuario.delete({ where: { id: alumnoSinMallaUsuarioId } });
      await prisma.carrera.delete({ where: { id: carreraSinMallaId } });
    });

    it('alumno con malla en su carrera -> 200 con url/nombreArchivo', async () => {
      const token = await firmarToken(
        { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ALUMNO },
        alumnoConMallaUsuarioId,
      );

      const res = await request(app.getHttpServer())
        .get('/perfil/malla')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const body = res.body as { data: { url: string; nombreArchivo: string } };
      expect(body.data.nombreArchivo).toBe('malla-dia24.pdf');
      expect(body.data.url).toBe('https://storage.example.com/signed/mock-url');
      expect(createSignedUrl).toHaveBeenCalledWith(
        `${carreraMeridaId}/malla.pdf`,
        300,
      );
    });

    it('alumno sin malla en su carrera -> 200 con data null', async () => {
      const token = await firmarToken(
        { role: 'authenticated', sede_id: sedeValladolidId, rol: RolUsuario.ALUMNO },
        alumnoSinMallaUsuarioId,
      );

      const res = await request(app.getHttpServer())
        .get('/perfil/malla')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect((res.body as { data: unknown }).data).toBeNull();
      expect(createSignedUrl).not.toHaveBeenCalled();
    });

    it('rol MAESTRO -> 403 ROL_NO_AUTORIZADO', async () => {
      const token = await firmarToken(
        { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.MAESTRO },
        alumnoConMallaUsuarioId,
      );

      const res = await request(app.getHttpServer())
        .get('/perfil/malla')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
    });

    it('sin Authorization -> 401 UNAUTHORIZED', async () => {
      const res = await request(app.getHttpServer()).get('/perfil/malla');

      expect(res.status).toBe(401);
      expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
    });

    it('falla de Storage al firmar la URL -> 500 SERVER_ERROR', async () => {
      createSignedUrl.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });

      const token = await firmarToken(
        { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ALUMNO },
        alumnoConMallaUsuarioId,
      );

      const res = await request(app.getHttpServer())
        .get('/perfil/malla')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(500);
      expect((res.body as ErrorBody).code).toBe('SERVER_ERROR');
    });
  });
});
