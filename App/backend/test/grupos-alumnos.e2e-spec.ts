import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
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
interface GrupoAlumnoBody {
  data: {
    id: string;
    grupoId: string;
    alumnoId: string;
    fechaInscripcion: string;
  };
}
interface ListaBody {
  data: Array<{
    usuarioId: string;
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string | null;
    matricula: string;
    cuatrimestreActual: number;
    estatusAcademico: string;
    fechaInscripcion: string;
  }>;
}

/**
 * `POST/DELETE/GET /grupos/:id/alumnos` — Fase 10, Día 30. Primer código de
 * aplicación real sobre `GrupoAlumno` (la tabla existe desde el Día 2/5).
 * Mismo mecanismo de JWKS de prueba que `grupos.e2e-spec.ts`: JWT firmado
 * con `jose`, inyectado vía `SEDE_GUARD_ENV_OVERRIDE`. `sub` del token = el
 * `usuarioId` real del admin ANCLA de Mérida (`ana.canul@cesp-merida.edu.mx`).
 * Usa carrera/salón reales sembrados: `LAE-MID` / `ING-SIS-MID` / "Aula 101"
 * (Mérida), `LC-VLD` / "Aula 201" (Valladolid).
 */
describe('GruposController — matrícula de alumnos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let sedeValladolidId: string;
  let carreraLaeId: string; // LAE-MID (Mérida)
  let carreraIngId: string; // ING-SIS-MID (Mérida)
  let carreraValladolidId: string; // LC-VLD (Valladolid)
  let salonMeridaId: string;
  let salonValladolidId: string;
  let actorUsuarioId: string; // ana.canul (Mérida)
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';

  const usuarioIdsCreados: string[] = [];
  const grupoIdsCreados: string[] = [];
  const grupoAlumnoIdsCreados: string[] = [];

  async function firmarToken(claims: Record<string, unknown>): Promise<string> {
    return new jose.SignJWT(claims)
      .setProtectedHeader({ alg, kid })
      .setSubject((claims.sub as string) ?? actorUsuarioId)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  function tokenAdminMerida(): Promise<string> {
    return firmarToken({
      role: 'authenticated',
      rol: RolUsuario.ADMINISTRATIVO,
      sede_id: sedeMeridaId,
    });
  }

  async function crearAlumnoFixture(opts: {
    sedeId: string;
    carreraId: string;
    nombres?: string;
    apellidoPaterno?: string;
  }): Promise<string> {
    const usuario = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.matricula.${randomUUID()}@example.com`,
        rol: RolUsuario.ALUMNO,
        sedeId: opts.sedeId,
      },
    });
    await prisma.perfilAlumno.create({
      data: {
        usuarioId: usuario.id,
        nombres: opts.nombres ?? 'Fixture',
        apellidoPaterno: opts.apellidoPaterno ?? 'Matricula',
        apellidoMaterno: `Z${randomUUID().slice(0, 4)}`,
        curp: `FX${randomUUID().slice(0, 16).toUpperCase()}`,
        fechaNacimiento: new Date('2006-01-01'),
        matricula: `FXMAT${randomUUID().slice(0, 10).toUpperCase()}`,
        correoPersonal: `fixture.matricula.personal.${randomUUID()}@example.com`,
        carreraId: opts.carreraId,
        estatusAcademico: 'INSCRITO',
        periodoIngreso: '2026-1',
        cuatrimestreActual: 1,
        telefono: '9990000000',
      },
    });
    usuarioIdsCreados.push(usuario.id);
    return usuario.id;
  }

  async function crearMaestroUsuarioFixture(sedeId: string): Promise<string> {
    const usuario = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.matricula.maestro.${randomUUID()}@example.com`,
        rol: RolUsuario.MAESTRO,
        sedeId,
      },
    });
    usuarioIdsCreados.push(usuario.id);
    return usuario.id;
  }

  async function crearGrupoFixture(opts: {
    sedeId: string;
    carreraId: string;
    salonId: string;
    capacidad: number;
  }): Promise<string> {
    const grupo = await prisma.grupo.create({
      data: {
        sedeId: opts.sedeId,
        carreraId: opts.carreraId,
        salonId: opts.salonId,
        nombre: `Grupo MAT E2E ${randomUUID().slice(0, 8)}`,
        anioInicio: 2027,
        cicloActual: 1,
        capacidad: opts.capacidad,
      },
    });
    grupoIdsCreados.push(grupo.id);
    return grupo.id;
  }

  async function matricular(
    grupoId: string,
    usuarioId: string,
    token: string,
  ): Promise<request.Response> {
    const res = await request(app.getHttpServer())
      .post(`/grupos/${grupoId}/alumnos`)
      .set('Authorization', `Bearer ${token}`)
      .send({ usuarioId });
    if (res.status === 201) {
      grupoAlumnoIdsCreados.push((res.body as GrupoAlumnoBody).data.id);
    }
    return res;
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
    sedeValladolidId = (
      await prisma.sede.findUniqueOrThrow({
        where: { nombre: 'CESP Valladolid' },
      })
    ).id;
    carreraLaeId = (
      await prisma.carrera.findUniqueOrThrow({ where: { clave: 'LAE-MID' } })
    ).id;
    carreraIngId = (
      await prisma.carrera.findUniqueOrThrow({ where: { clave: 'ING-SIS-MID' } })
    ).id;
    carreraValladolidId = (
      await prisma.carrera.findUniqueOrThrow({ where: { clave: 'LC-VLD' } })
    ).id;
    salonMeridaId = (
      await prisma.salon.findUniqueOrThrow({
        where: { sedeId_nombre: { sedeId: sedeMeridaId, nombre: 'Aula 101' } },
      })
    ).id;
    salonValladolidId = (
      await prisma.salon.findUniqueOrThrow({
        where: {
          sedeId_nombre: { sedeId: sedeValladolidId, nombre: 'Aula 201' },
        },
      })
    ).id;
    actorUsuarioId = (
      await prisma.usuario.findUniqueOrThrow({
        where: { email: 'ana.canul@cesp-merida.edu.mx' },
      })
    ).id;
  }, 30000);

  afterAll(async () => {
    if (grupoAlumnoIdsCreados.length > 0) {
      await prisma.registroAuditoria.deleteMany({
        where: {
          entidad: 'GrupoAlumno',
          entidadId: { in: grupoAlumnoIdsCreados },
        },
      });
    }
    if (grupoIdsCreados.length > 0) {
      await prisma.grupoAlumno.deleteMany({
        where: { grupoId: { in: grupoIdsCreados } },
      });
      await prisma.grupo.deleteMany({ where: { id: { in: grupoIdsCreados } } });
    }
    if (usuarioIdsCreados.length > 0) {
      await prisma.perfilAlumno.deleteMany({
        where: { usuarioId: { in: usuarioIdsCreados } },
      });
      await prisma.usuario.deleteMany({
        where: { id: { in: usuarioIdsCreados } },
      });
    }
    await app.close();
  });

  it('POST /grupos/:id/alumnos con alumno de la misma carrera -> 201 y audita ALTA', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupoFixture({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
      capacidad: 30,
    });
    const alumnoUsuarioId = await crearAlumnoFixture({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
    });
    const perfil = await prisma.perfilAlumno.findUniqueOrThrow({
      where: { usuarioId: alumnoUsuarioId },
    });

    const res = await matricular(grupoId, alumnoUsuarioId, token);

    expect(res.status).toBe(201);
    const body = res.body as GrupoAlumnoBody;
    expect(body.data.grupoId).toBe(grupoId);
    expect(body.data.alumnoId).toBe(perfil.id);

    const registro = await prisma.registroAuditoria.findFirst({
      where: {
        entidad: 'GrupoAlumno',
        accion: 'ALTA',
        entidadId: body.data.id,
      },
    });
    expect(registro).not.toBeNull();
    expect(registro?.usuarioId).toBe(actorUsuarioId);
    expect((registro?.detalle as { matricula?: string })?.matricula).toBe(
      perfil.matricula,
    );
  });

  it('POST duplicado (mismo alumno, mismo grupo) -> 409 CONFLICT', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupoFixture({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
      capacidad: 30,
    });
    const alumnoUsuarioId = await crearAlumnoFixture({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
    });

    const primera = await matricular(grupoId, alumnoUsuarioId, token);
    expect(primera.status).toBe(201);

    const segunda = await matricular(grupoId, alumnoUsuarioId, token);
    expect(segunda.status).toBe(409);
    expect((segunda.body as ErrorBody).code).toBe('CONFLICT');
  });

  it('POST alumno de otra carrera -> 400 VALIDATION_ERROR', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupoFixture({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
      capacidad: 30,
    });
    const alumnoUsuarioId = await crearAlumnoFixture({
      sedeId: sedeMeridaId,
      carreraId: carreraIngId,
    });

    const res = await matricular(grupoId, alumnoUsuarioId, token);
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('POST con el grupo lleno -> 409 CAPACIDAD_EXCEDIDA', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupoFixture({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
      capacidad: 1,
    });
    const alumnoA = await crearAlumnoFixture({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
    });
    const alumnoB = await crearAlumnoFixture({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
    });

    const primera = await matricular(grupoId, alumnoA, token);
    expect(primera.status).toBe(201);

    const segunda = await matricular(grupoId, alumnoB, token);
    expect(segunda.status).toBe(409);
    expect((segunda.body as ErrorBody).code).toBe('CAPACIDAD_EXCEDIDA');
  });

  it('POST usuarioId inexistente -> 404 NOT_FOUND', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupoFixture({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
      capacidad: 30,
    });

    const res = await matricular(grupoId, randomUUID(), token);
    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('POST usuarioId de un MAESTRO -> 404 NOT_FOUND', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupoFixture({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
      capacidad: 30,
    });
    const maestroUsuarioId = await crearMaestroUsuarioFixture(sedeMeridaId);

    const res = await matricular(grupoId, maestroUsuarioId, token);
    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('POST alumno de otra sede -> 404 NOT_FOUND', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupoFixture({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
      capacidad: 30,
    });
    const alumnoValladolid = await crearAlumnoFixture({
      sedeId: sedeValladolidId,
      carreraId: carreraValladolidId,
    });

    const res = await matricular(grupoId, alumnoValladolid, token);
    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('POST sin usuarioId -> 400 VALIDATION_ERROR', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupoFixture({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
      capacidad: 30,
    });

    const res = await request(app.getHttpServer())
      .post(`/grupos/${grupoId}/alumnos`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('POST usuarioId no-UUID -> 400 VALIDATION_ERROR', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupoFixture({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
      capacidad: 30,
    });

    const res = await request(app.getHttpServer())
      .post(`/grupos/${grupoId}/alumnos`)
      .set('Authorization', `Bearer ${token}`)
      .send({ usuarioId: 'no-es-uuid' });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('POST a un grupo de otra sede -> 404 NOT_FOUND', async () => {
    const token = await tokenAdminMerida();
    const grupoValladolidId = await crearGrupoFixture({
      sedeId: sedeValladolidId,
      carreraId: carreraValladolidId,
      salonId: salonValladolidId,
      capacidad: 30,
    });
    const alumnoUsuarioId = await crearAlumnoFixture({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
    });

    const res = await matricular(grupoValladolidId, alumnoUsuarioId, token);
    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('DELETE de un alumno inscrito -> 200 y audita ELIMINACION', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupoFixture({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
      capacidad: 30,
    });
    const alumnoUsuarioId = await crearAlumnoFixture({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
    });
    const perfil = await prisma.perfilAlumno.findUniqueOrThrow({
      where: { usuarioId: alumnoUsuarioId },
    });

    const alta = await matricular(grupoId, alumnoUsuarioId, token);
    expect(alta.status).toBe(201);
    const grupoAlumnoId = (alta.body as GrupoAlumnoBody).data.id;

    const res = await request(app.getHttpServer())
      .delete(`/grupos/${grupoId}/alumnos/${alumnoUsuarioId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect((res.body as { data: { ok: true } }).data).toEqual({ ok: true });

    const fila = await prisma.grupoAlumno.findUnique({
      where: { grupoId_alumnoId: { grupoId, alumnoId: perfil.id } },
    });
    expect(fila).toBeNull();

    const registro = await prisma.registroAuditoria.findFirst({
      where: {
        entidad: 'GrupoAlumno',
        accion: 'ELIMINACION',
        entidadId: grupoAlumnoId,
      },
    });
    expect(registro).not.toBeNull();
    expect((registro?.detalle as { matricula?: string })?.matricula).toBe(
      perfil.matricula,
    );
  });

  it('DELETE de un alumno NO inscrito -> 404 NOT_FOUND', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupoFixture({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
      capacidad: 30,
    });
    const alumnoUsuarioId = await crearAlumnoFixture({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
    });

    const res = await request(app.getHttpServer())
      .delete(`/grupos/${grupoId}/alumnos/${alumnoUsuarioId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('DELETE grupo de otra sede -> 404 NOT_FOUND', async () => {
    const token = await tokenAdminMerida();
    const grupoValladolidId = await crearGrupoFixture({
      sedeId: sedeValladolidId,
      carreraId: carreraValladolidId,
      salonId: salonValladolidId,
      capacidad: 30,
    });

    const res = await request(app.getHttpServer())
      .delete(`/grupos/${grupoValladolidId}/alumnos/${randomUUID()}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('GET /grupos/:id/alumnos devuelve los inscritos ordenados por apellidoPaterno', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupoFixture({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
      capacidad: 30,
    });
    const alumnoBarrera = await crearAlumnoFixture({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      apellidoPaterno: 'Barrera',
    });
    const alumnoAzul = await crearAlumnoFixture({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      apellidoPaterno: 'Azul',
    });

    expect((await matricular(grupoId, alumnoBarrera, token)).status).toBe(201);
    expect((await matricular(grupoId, alumnoAzul, token)).status).toBe(201);

    const res = await request(app.getHttpServer())
      .get(`/grupos/${grupoId}/alumnos`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as ListaBody;
    expect(body.data).toHaveLength(2);
    expect(body.data[0].apellidoPaterno).toBe('Azul');
    expect(body.data[1].apellidoPaterno).toBe('Barrera');
    expect(Object.keys(body.data[0]).sort()).toEqual(
      [
        'apellidoMaterno',
        'apellidoPaterno',
        'estatusAcademico',
        'fechaInscripcion',
        'matricula',
        'nombres',
        'cuatrimestreActual',
        'usuarioId',
      ].sort(),
    );
  });

  it('GET de un grupo vacío -> 200 { data: [] }', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupoFixture({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
      capacidad: 30,
    });

    const res = await request(app.getHttpServer())
      .get(`/grupos/${grupoId}/alumnos`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect((res.body as ListaBody).data).toEqual([]);
  });

  it('GET grupo de otra sede -> 404 NOT_FOUND', async () => {
    const token = await tokenAdminMerida();
    const grupoValladolidId = await crearGrupoFixture({
      sedeId: sedeValladolidId,
      carreraId: carreraValladolidId,
      salonId: salonValladolidId,
      capacidad: 30,
    });

    const res = await request(app.getHttpServer())
      .get(`/grupos/${grupoValladolidId}/alumnos`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('POST /grupos/:id/alumnos con rol MAESTRO -> 403 ROL_NO_AUTORIZADO', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.MAESTRO,
    });

    const res = await request(app.getHttpServer())
      .post(`/grupos/${randomUUID()}/alumnos`)
      .set('Authorization', `Bearer ${token}`)
      .send({ usuarioId: randomUUID() });

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });

  it('DELETE /grupos/:id/alumnos/:usuarioId con rol ALUMNO -> 403 ROL_NO_AUTORIZADO', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ALUMNO,
    });

    const res = await request(app.getHttpServer())
      .delete(`/grupos/${randomUUID()}/alumnos/${randomUUID()}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });

  it('GET /grupos/:id/alumnos con rol MAESTRO -> 403 ROL_NO_AUTORIZADO', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.MAESTRO,
    });

    const res = await request(app.getHttpServer())
      .get(`/grupos/${randomUUID()}/alumnos`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });
});
