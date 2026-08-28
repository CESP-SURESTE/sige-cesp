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
interface AsignacionBody {
  data: {
    id: string;
    grupoId: string;
    materiaId: string;
    maestroId: string;
    asignadoEn: string;
  };
}
interface AsignacionListBody {
  data: Array<{
    id: string;
    materia: { id: string; nombre: string; ciclo: number };
    maestro: {
      usuarioId: string;
      nombres: string;
      apellidoPaterno: string;
      apellidoMaterno: string | null;
    };
  }>;
}

describe('GruposController — asignaciones de maestro por materia (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let sedeValladolidId: string;
  let carreraLaeId: string; // LAE-MID (Mérida), duracion 8
  let carreraIngId: string; // ING-SIS-MID (Mérida)
  let carreraValladolidId: string; // LC-VLD (Valladolid)
  let salonMeridaId: string;
  let salonValladolidId: string;
  let actorAdminMeridaId: string;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';

  const asignacionIdsCreados: string[] = [];
  const grupoIdsCreados: string[] = [];
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

  function tokenAdminMerida(): Promise<string> {
    return firmarToken(
      actorAdminMeridaId,
      RolUsuario.ADMINISTRATIVO,
      sedeMeridaId,
    );
  }

  async function crearGrupo(opts: {
    sedeId: string;
    carreraId: string;
    salonId: string;
    cicloActual?: number;
  }): Promise<string> {
    const g = await prisma.grupo.create({
      data: {
        sedeId: opts.sedeId,
        carreraId: opts.carreraId,
        salonId: opts.salonId,
        nombre: `Grupo ASG E2E ${randomUUID().slice(0, 8)}`,
        anioInicio: 2027,
        cicloActual: opts.cicloActual ?? 1,
        capacidad: 30,
      },
    });
    grupoIdsCreados.push(g.id);
    return g.id;
  }

  async function crearMateria(
    carreraId: string,
    ciclo: number,
  ): Promise<string> {
    const m = await prisma.materia.create({
      data: {
        carreraId,
        nombre: `Materia ASG ${randomUUID().slice(0, 8)}`,
        ciclo,
      },
    });
    materiaIdsCreados.push(m.id);
    return m.id;
  }

  async function crearMaestro(
    sedeId: string,
    apellidoPaterno = 'Asignado',
  ): Promise<string> {
    const usuario = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.asg.maestro.${randomUUID()}@example.com`,
        rol: RolUsuario.MAESTRO,
        sedeId,
      },
    });
    await prisma.perfilMaestro.create({
      data: {
        usuarioId: usuario.id,
        nombres: 'Fixture',
        apellidoPaterno,
        apellidoMaterno: `Z${randomUUID().slice(0, 4)}`,
        curp: `FX${randomUUID().slice(0, 16).toUpperCase()}`,
        cedulaProfesional: `${randomUUID().slice(0, 7)}`,
        correoPersonal: `fixture.asg.maestro.p.${randomUUID()}@example.com`,
        telefono: '9990000000',
        fechaContratacion: new Date('2024-08-01'),
        estatus: 'ACTIVO',
      },
    });
    usuarioIdsCreados.push(usuario.id);
    return usuario.id;
  }

  async function crearAlumnoUsuario(sedeId: string): Promise<string> {
    const usuario = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.asg.alumno.${randomUUID()}@example.com`,
        rol: RolUsuario.ALUMNO,
        sedeId,
      },
    });
    usuarioIdsCreados.push(usuario.id);
    return usuario.id;
  }

  async function asignar(
    grupoId: string,
    materiaId: string,
    usuarioId: string,
    token: string,
  ): Promise<request.Response> {
    const res = await request(app.getHttpServer())
      .post(`/grupos/${grupoId}/asignaciones`)
      .set('Authorization', `Bearer ${token}`)
      .send({ materiaId, usuarioId });
    if (res.status === 201) {
      asignacionIdsCreados.push((res.body as AsignacionBody).data.id);
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
      await prisma.carrera.findUniqueOrThrow({
        where: { clave: 'ING-SIS-MID' },
      })
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
    actorAdminMeridaId = (
      await prisma.usuario.findFirstOrThrow({
        where: { rol: RolUsuario.ADMINISTRATIVO, sedeId: sedeMeridaId },
      })
    ).id;
  }, 30000);

  afterAll(async () => {
    if (asignacionIdsCreados.length > 0) {
      await prisma.registroAuditoria.deleteMany({
        where: {
          entidad: 'GrupoMateriaMaestro',
          entidadId: { in: asignacionIdsCreados },
        },
      });
    }
    if (grupoIdsCreados.length > 0) {
      await prisma.grupoMateriaMaestro.deleteMany({
        where: { grupoId: { in: grupoIdsCreados } },
      });
      await prisma.grupo.deleteMany({ where: { id: { in: grupoIdsCreados } } });
    }
    if (materiaIdsCreados.length > 0) {
      await prisma.materia.deleteMany({
        where: { id: { in: materiaIdsCreados } },
      });
    }
    if (usuarioIdsCreados.length > 0) {
      await prisma.perfilMaestro.deleteMany({
        where: { usuarioId: { in: usuarioIdsCreados } },
      });
      await prisma.usuario.deleteMany({
        where: { id: { in: usuarioIdsCreados } },
      });
    }
    await app.close();
  });

  it('POST asignación válida (maestro y materia de la sede/carrera/ciclo del grupo) -> 201 y audita ALTA', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
      cicloActual: 1,
    });
    const materiaId = await crearMateria(carreraLaeId, 1);
    const maestroUsuarioId = await crearMaestro(sedeMeridaId);

    const res = await asignar(grupoId, materiaId, maestroUsuarioId, token);
    expect(res.status).toBe(201);
    expect((res.body as AsignacionBody).data.grupoId).toBe(grupoId);
    expect((res.body as AsignacionBody).data.materiaId).toBe(materiaId);

    const registro = await prisma.registroAuditoria.findFirst({
      where: {
        entidad: 'GrupoMateriaMaestro',
        accion: 'ALTA',
        entidadId: (res.body as AsignacionBody).data.id,
      },
    });
    expect(registro).not.toBeNull();
  });

  it('POST co-docencia (2º maestro distinto, misma materia y grupo) -> 201', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
    });
    const materiaId = await crearMateria(carreraLaeId, 1);
    const m1 = await crearMaestro(sedeMeridaId);
    const m2 = await crearMaestro(sedeMeridaId);

    expect((await asignar(grupoId, materiaId, m1, token)).status).toBe(201);
    expect((await asignar(grupoId, materiaId, m2, token)).status).toBe(201);
  });

  it('POST triple duplicado exacto -> 409 CONFLICT', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
    });
    const materiaId = await crearMateria(carreraLaeId, 1);
    const maestro = await crearMaestro(sedeMeridaId);

    expect((await asignar(grupoId, materiaId, maestro, token)).status).toBe(
      201,
    );
    const dup = await asignar(grupoId, materiaId, maestro, token);
    expect(dup.status).toBe(409);
    expect((dup.body as ErrorBody).code).toBe('CONFLICT');
  });

  it('POST materia de otra carrera -> 400 VALIDATION_ERROR', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
    });
    const materiaOtraCarrera = await crearMateria(carreraIngId, 1);
    const maestro = await crearMaestro(sedeMeridaId);

    const res = await asignar(grupoId, materiaOtraCarrera, maestro, token);
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('POST materia de la carrera correcta pero otro ciclo -> 400 VALIDATION_ERROR', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
      cicloActual: 1,
    });
    const materiaCiclo3 = await crearMateria(carreraLaeId, 3);
    const maestro = await crearMaestro(sedeMeridaId);

    const res = await asignar(grupoId, materiaCiclo3, maestro, token);
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('POST usuarioId de un ALUMNO -> 404', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
    });
    const materiaId = await crearMateria(carreraLaeId, 1);
    const alumnoUsuarioId = await crearAlumnoUsuario(sedeMeridaId);

    const res = await asignar(grupoId, materiaId, alumnoUsuarioId, token);
    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('POST maestro de otra sede -> 404', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
    });
    const materiaId = await crearMateria(carreraLaeId, 1);
    const maestroValladolid = await crearMaestro(sedeValladolidId);

    const res = await asignar(grupoId, materiaId, maestroValladolid, token);
    expect(res.status).toBe(404);
  });

  it('POST grupo de otra sede -> 404', async () => {
    const token = await tokenAdminMerida();
    const grupoValladolid = await crearGrupo({
      sedeId: sedeValladolidId,
      carreraId: carreraValladolidId,
      salonId: salonValladolidId,
    });
    const materiaId = await crearMateria(carreraValladolidId, 1);
    const maestro = await crearMaestro(sedeMeridaId);

    const res = await asignar(grupoValladolid, materiaId, maestro, token);
    expect(res.status).toBe(404);
  });

  it('GET /grupos/:id/asignaciones -> shape + orden; vacío -> []', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
    });

    const vacio = await request(app.getHttpServer())
      .get(`/grupos/${grupoId}/asignaciones`)
      .set('Authorization', `Bearer ${token}`);
    expect(vacio.status).toBe(200);
    expect((vacio.body as AsignacionListBody).data).toEqual([]);

    const materiaId = await crearMateria(carreraLaeId, 1);
    const maestroB = await crearMaestro(sedeMeridaId, 'Balam');
    const maestroA = await crearMaestro(sedeMeridaId, 'Aguilar');
    await asignar(grupoId, materiaId, maestroB, token);
    await asignar(grupoId, materiaId, maestroA, token);

    const res = await request(app.getHttpServer())
      .get(`/grupos/${grupoId}/asignaciones`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const data = (res.body as AsignacionListBody).data;
    expect(data).toHaveLength(2);
    // misma materia -> desempata por maestro.apellidoPaterno asc
    expect(data.map((a) => a.maestro.apellidoPaterno)).toEqual([
      'Aguilar',
      'Balam',
    ]);
    expect(data[0].materia).toMatchObject({ id: materiaId, ciclo: 1 });
    expect(data[0].maestro.usuarioId).toBe(maestroA);
  });

  it('DELETE /grupos/:id/asignaciones/:asignacionId -> 200 y audita ELIMINACION', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
    });
    const materiaId = await crearMateria(carreraLaeId, 1);
    const maestro = await crearMaestro(sedeMeridaId);
    const creada = await asignar(grupoId, materiaId, maestro, token);
    const asignacionId = (creada.body as AsignacionBody).data.id;

    const res = await request(app.getHttpServer())
      .delete(`/grupos/${grupoId}/asignaciones/${asignacionId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { ok: true } });

    const registro = await prisma.registroAuditoria.findFirst({
      where: {
        entidad: 'GrupoMateriaMaestro',
        accion: 'ELIMINACION',
        entidadId: asignacionId,
      },
    });
    expect(registro).not.toBeNull();
  });

  it('DELETE asignacionId inexistente -> 404', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
    });
    const res = await request(app.getHttpServer())
      .delete(`/grupos/${grupoId}/asignaciones/${randomUUID()}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('DELETE asignacionId que pertenece a OTRO grupo -> 404', async () => {
    const token = await tokenAdminMerida();
    const grupoA = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
    });
    const grupoB = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
    });
    const materiaId = await crearMateria(carreraLaeId, 1);
    const maestro = await crearMaestro(sedeMeridaId);
    const creada = await asignar(grupoA, materiaId, maestro, token);
    const asignacionId = (creada.body as AsignacionBody).data.id;

    const res = await request(app.getHttpServer())
      .delete(`/grupos/${grupoB}/asignaciones/${asignacionId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('las 3 rutas con rol MAESTRO -> 403 ROL_NO_AUTORIZADO', async () => {
    const grupoId = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
    });
    const maestroUsuarioId = await crearMaestro(sedeMeridaId);
    const token = await firmarToken(
      maestroUsuarioId,
      RolUsuario.MAESTRO,
      sedeMeridaId,
    );

    const post = await request(app.getHttpServer())
      .post(`/grupos/${grupoId}/asignaciones`)
      .set('Authorization', `Bearer ${token}`)
      .send({ materiaId: randomUUID(), usuarioId: randomUUID() });
    expect(post.status).toBe(403);
    expect((post.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');

    const get = await request(app.getHttpServer())
      .get(`/grupos/${grupoId}/asignaciones`)
      .set('Authorization', `Bearer ${token}`);
    expect(get.status).toBe(403);

    const del = await request(app.getHttpServer())
      .delete(`/grupos/${grupoId}/asignaciones/${randomUUID()}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(403);
  });
});
