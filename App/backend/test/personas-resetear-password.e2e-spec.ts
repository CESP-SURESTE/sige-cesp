import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  EstatusEmpleado,
  NivelPermiso,
  PuestoAdministrativo,
  RolUsuario,
} from '@prisma/client';
import { AppModule } from '../src/app.module';
import { SEDE_GUARD_ENV_OVERRIDE } from '../src/common/guards/sede.guard';
import { PERSONAS_SUPABASE_CLIENT_OVERRIDE } from '../src/personas/personas.service';
import { MAIL_FETCH_OVERRIDE } from '../src/mail/mail.service';
import { loadEnv } from '../src/load-env';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup-app';

loadEnv();

interface ErrorBody {
  error: string;
  code: string;
}

describe('PersonasController — POST /personas/:id/resetear-password (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let sedeValladolidId: string;
  let actorAdminId: string;
  let actorAuxiliarId: string;
  let generateLink: jest.Mock;
  let mailFetch: jest.Mock;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';
  const flagOriginal = process.env.MAILGUN_ENVIOS_HABILITADO;
  const usuarioIdsCreados: string[] = [];

  async function firmarToken(sub: string, sedeId: string): Promise<string> {
    return new jose.SignJWT({
      role: 'authenticated',
      sede_id: sedeId,
      rol: RolUsuario.ADMINISTRATIVO,
    })
      .setProtectedHeader({ alg, kid })
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  async function crearAdministrativoFixture(params: {
    sedeId: string;
    nivelPermiso: NivelPermiso;
  }): Promise<string> {
    const usuario = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.reseteo.${randomUUID()}@example.com`,
        rol: RolUsuario.ADMINISTRATIVO,
        sedeId: params.sedeId,
      },
    });
    await prisma.perfilAdministrativo.create({
      data: {
        usuarioId: usuario.id,
        nombres: 'Fixture',
        apellidoPaterno: 'Reseteo',
        curp: `FX${randomUUID().slice(0, 16).toUpperCase()}`,
        correoPersonal: `fixture.reseteo.personal.${randomUUID()}@example.com`,
        telefono: '9990009999',
        fechaContratacion: new Date('2024-01-01'),
        estatus: EstatusEmpleado.ACTIVO,
        puesto: PuestoAdministrativo.AUXILIAR,
        nivelPermiso: params.nivelPermiso,
      },
    });
    usuarioIdsCreados.push(usuario.id);
    return usuario.id;
  }

  /**
   * Fixture MAESTRO (Important 1 del review, fix round 1) — necesaria para
   * probar que la jerarquía de `nivelPermiso` (regla 7) NUNCA se evalúa
   * cuando el target `Usuario.rol !== ADMINISTRATIVO`. Se elige MAESTRO en
   * vez de ALUMNO porque no requiere una `carreraId` real (menos setup).
   */
  async function crearMaestroFixture(params: {
    sedeId: string;
  }): Promise<string> {
    const usuario = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.reseteo.maestro.${randomUUID()}@example.com`,
        rol: RolUsuario.MAESTRO,
        sedeId: params.sedeId,
      },
    });
    await prisma.perfilMaestro.create({
      data: {
        usuarioId: usuario.id,
        nombres: 'Fixture',
        apellidoPaterno: 'ReseteoMaestro',
        curp: `FX${randomUUID().slice(0, 16).toUpperCase()}`,
        cedulaProfesional: `${randomUUID().slice(0, 7)}`,
        correoPersonal: `fixture.reseteo.maestro.personal.${randomUUID()}@example.com`,
        telefono: '9990009998',
        fechaContratacion: new Date('2024-01-01'),
        estatus: EstatusEmpleado.ACTIVO,
      },
    });
    usuarioIdsCreados.push(usuario.id);
    return usuario.id;
  }

  beforeAll(async () => {
    process.env.MAILGUN_ENVIOS_HABILITADO = 'true';

    jose = await import('jose');
    const keyPair = await jose.generateKeyPair(alg, { extractable: true });
    privateKey = keyPair.privateKey;
    const publicJwk = await jose.exportJWK(keyPair.publicKey);
    publicJwk.kid = kid;
    publicJwk.alg = alg;
    publicJwk.use = 'sig';

    generateLink = jest.fn();
    const mockSupabaseAdminClient = {
      auth: { admin: { generateLink } },
    };
    mailFetch = jest.fn();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SEDE_GUARD_ENV_OVERRIDE)
      .useValue({ jwks: { keys: [publicJwk] } })
      .overrideProvider(PERSONAS_SUPABASE_CLIENT_OVERRIDE)
      .useValue(mockSupabaseAdminClient)
      .overrideProvider(MAIL_FETCH_OVERRIDE)
      .useValue(mailFetch)
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

    actorAdminId = await crearAdministrativoFixture({
      sedeId: sedeMeridaId,
      nivelPermiso: NivelPermiso.ADMIN,
    });
    actorAuxiliarId = await crearAdministrativoFixture({
      sedeId: sedeMeridaId,
      nivelPermiso: NivelPermiso.AUXILIAR,
    });
  });

  afterEach(() => {
    generateLink.mockReset();
    mailFetch.mockReset();
  });

  afterAll(async () => {
    process.env.MAILGUN_ENVIOS_HABILITADO = flagOriginal;
    if (usuarioIdsCreados.length > 0) {
      await prisma.registroAuditoria.deleteMany({
        where: { entidadId: { in: usuarioIdsCreados } },
      });
      await prisma.registroAuditoria.deleteMany({
        where: { usuarioId: { in: usuarioIdsCreados } },
      });
      await prisma.perfilAdministrativo.deleteMany({
        where: { usuarioId: { in: usuarioIdsCreados } },
      });
      await prisma.perfilMaestro.deleteMany({
        where: { usuarioId: { in: usuarioIdsCreados } },
      });
      await prisma.usuario.deleteMany({
        where: { id: { in: usuarioIdsCreados } },
      });
    }
    await app.close();
  });

  it('devuelve 200 y llama a Mailgun con el link generado por Supabase', async () => {
    const objetivoId = await crearAdministrativoFixture({
      sedeId: sedeMeridaId,
      nivelPermiso: NivelPermiso.AUXILIAR,
    });
    generateLink.mockResolvedValue({
      data: { properties: { hashed_token: 'hash_token_prueba_abc' } },
      error: null,
    });
    mailFetch.mockResolvedValue({
      ok: true,
      text: async () => '',
    } as unknown as Response);

    const token = await firmarToken(actorAdminId, sedeMeridaId);

    await request(app.getHttpServer() as App)
      .post(`/personas/${objetivoId}/resetear-password`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect((res.body as { data: { ok: true } }).data.ok).toBe(true);
      });

    expect(generateLink).toHaveBeenCalledWith({
      type: 'recovery',
      email: expect.stringContaining('fixture.reseteo.'),
      options: { redirectTo: expect.stringContaining('/restablecer-password') },
    });
    expect(mailFetch).toHaveBeenCalledTimes(1);

    // Important 2 del review (fix round 1) — regla 5 (RegistroAuditoria solo
    // inserción) + requisito explícito de que el link/token de recuperación
    // NUNCA se persiste. Se busca el registro por `entidadId`/`accion` en vez
    // de asumir que es el único de la sede (la suite completa reutiliza la
    // misma DB real).
    const registro = await prisma.registroAuditoria.findFirstOrThrow({
      where: {
        entidad: 'Usuario',
        entidadId: objetivoId,
        accion: 'RESETEO_PASSWORD',
      },
    });
    expect(registro.usuarioId).toBe(actorAdminId);
    expect(registro.sedeId).toBe(sedeMeridaId);
    expect(registro.detalle).toEqual({ rol: RolUsuario.ADMINISTRATIVO });
    // El `hashed_token` generado por el mock (`hash_token_prueba_abc`), usado
    // para construir el link propio de reseteo, NUNCA debe aparecer en
    // `detalle` — ni el link completo ni el token.
    const detalleSerializado = JSON.stringify(registro.detalle);
    expect(detalleSerializado).not.toContain('restablecer-password');
    expect(detalleSerializado).not.toContain('hash_token_prueba_abc');
  });

  it('devuelve 200 cuando un AUXILIAR resetea la contraseña de un MAESTRO (la jerarquía de nivelPermiso NUNCA aplica a targets no-ADMINISTRATIVO)', async () => {
    const objetivoMaestroId = await crearMaestroFixture({
      sedeId: sedeMeridaId,
    });
    generateLink.mockResolvedValue({
      data: { properties: { hashed_token: 'hash_token_prueba_xyz' } },
      error: null,
    });
    mailFetch.mockResolvedValue({
      ok: true,
      text: async () => '',
    } as unknown as Response);

    const token = await firmarToken(actorAuxiliarId, sedeMeridaId);

    await request(app.getHttpServer() as App)
      .post(`/personas/${objetivoMaestroId}/resetear-password`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect((res.body as { data: { ok: true } }).data.ok).toBe(true);
      });

    expect(generateLink).toHaveBeenCalledWith({
      type: 'recovery',
      email: expect.stringContaining('fixture.reseteo.maestro.'),
      options: { redirectTo: expect.stringContaining('/restablecer-password') },
    });
    expect(mailFetch).toHaveBeenCalledTimes(1);

    const registro = await prisma.registroAuditoria.findFirstOrThrow({
      where: {
        entidad: 'Usuario',
        entidadId: objetivoMaestroId,
        accion: 'RESETEO_PASSWORD',
      },
    });
    expect(registro.usuarioId).toBe(actorAuxiliarId);
    expect(registro.detalle).toEqual({ rol: RolUsuario.MAESTRO });
  });

  it('devuelve 404 si la persona es de otra sede', async () => {
    const objetivoOtraSedeId = await crearAdministrativoFixture({
      sedeId: sedeValladolidId,
      nivelPermiso: NivelPermiso.AUXILIAR,
    });
    const token = await firmarToken(actorAdminId, sedeMeridaId);

    await request(app.getHttpServer() as App)
      .post(`/personas/${objetivoOtraSedeId}/resetear-password`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404)
      .expect((res) => {
        expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
      });

    expect(generateLink).not.toHaveBeenCalled();
  });

  it('devuelve 403 NIVEL_PERMISO_INSUFICIENTE si un AUXILIAR intenta resetear a un administrativo', async () => {
    const objetivoId = await crearAdministrativoFixture({
      sedeId: sedeMeridaId,
      nivelPermiso: NivelPermiso.ADMIN,
    });
    const token = await firmarToken(actorAuxiliarId, sedeMeridaId);

    await request(app.getHttpServer() as App)
      .post(`/personas/${objetivoId}/resetear-password`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403)
      .expect((res) => {
        expect((res.body as ErrorBody).code).toBe('NIVEL_PERMISO_INSUFICIENTE');
      });

    expect(generateLink).not.toHaveBeenCalled();
  });

  it('devuelve 500 SERVER_ERROR si Mailgun falla (el correo no es best-effort acá)', async () => {
    const objetivoId = await crearAdministrativoFixture({
      sedeId: sedeMeridaId,
      nivelPermiso: NivelPermiso.AUXILIAR,
    });
    generateLink.mockResolvedValue({
      data: { properties: { hashed_token: 'hash_token_prueba_mailgun_caido' } },
      error: null,
    });
    mailFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'mailgun caído',
    } as unknown as Response);

    const token = await firmarToken(actorAdminId, sedeMeridaId);

    await request(app.getHttpServer() as App)
      .post(`/personas/${objetivoId}/resetear-password`)
      .set('Authorization', `Bearer ${token}`)
      .expect(500)
      .expect((res) => {
        expect((res.body as ErrorBody).code).toBe('SERVER_ERROR');
      });
  });
});
