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
interface AsignacionesBody {
  data: Array<{
    grupoId: string;
    nombre: string;
    anioInicio: number;
    cicloActual: number;
    carrera: { id: string; nombre: string };
    salon: { id: string; nombre: string };
    materias: Array<{ id: string; nombre: string; ciclo: number }>;
  }>;
}

describe('PerfilController — GET /perfil/asignaciones (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let sedeValladolidId: string;
  let carreraLaeId: string; // LAE-MID (Mérida)
  let carreraValladolidId: string; // LC-VLD (Valladolid)
  let salonMeridaId: string;
  let salonValladolidId: string;
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

  async function crearMaestro(sedeId: string): Promise<{
    usuarioId: string;
    perfilId: string;
  }> {
    const usuario = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.asig.maestro.${randomUUID()}@example.com`,
        rol: RolUsuario.MAESTRO,
        sedeId,
      },
    });
    usuarioIdsCreados.push(usuario.id);
    const perfil = await prisma.perfilMaestro.create({
      data: {
        usuarioId: usuario.id,
        nombres: 'Fixture',
        apellidoPaterno: 'AsigMaestro',
        apellidoMaterno: `Z${randomUUID().slice(0, 4)}`,
        curp: `FX${randomUUID().slice(0, 16).toUpperCase()}`,
        cedulaProfesional: `${randomUUID().slice(0, 7)}`,
        correoPersonal: `fixture.asig.maestro.p.${randomUUID()}@example.com`,
        telefono: '9990000000',
        fechaContratacion: new Date('2024-08-01'),
        estatus: 'ACTIVO',
      },
    });
    return { usuarioId: usuario.id, perfilId: perfil.id };
  }

  async function crearAlumnoUsuario(sedeId: string): Promise<string> {
    const usuario = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.asig.alumno.${randomUUID()}@example.com`,
        rol: RolUsuario.ALUMNO,
        sedeId,
      },
    });
    usuarioIdsCreados.push(usuario.id);
    return usuario.id;
  }

  async function crearGrupo(opts: {
    sedeId: string;
    carreraId: string;
    salonId: string;
    nombre?: string;
    anioInicio?: number;
    cicloActual?: number;
  }): Promise<string> {
    const g = await prisma.grupo.create({
      data: {
        sedeId: opts.sedeId,
        carreraId: opts.carreraId,
        salonId: opts.salonId,
        nombre: opts.nombre ?? `Grupo ASIG E2E ${randomUUID().slice(0, 8)}`,
        anioInicio: opts.anioInicio ?? 2027,
        cicloActual: opts.cicloActual ?? 1,
        capacidad: 30,
      },
    });
    grupoIdsCreados.push(g.id);
    return g.id;
  }

  async function crearMateria(
    carreraId: string,
    nombre: string,
    ciclo = 1,
  ): Promise<string> {
    const m = await prisma.materia.create({
      data: { carreraId, nombre, ciclo },
    });
    materiaIdsCreados.push(m.id);
    return m.id;
  }

  async function asignar(
    grupoId: string,
    materiaId: string,
    maestroPerfilId: string,
  ): Promise<void> {
    const fila = await prisma.grupoMateriaMaestro.create({
      data: { grupoId, materiaId, maestroId: maestroPerfilId },
    });
    asignacionIdsCreados.push(fila.id);
  }

  function pedir(token: string): Promise<request.Response> {
    return request(app.getHttpServer())
      .get('/perfil/asignaciones')
      .set('Authorization', `Bearer ${token}`);
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
  }, 30000);

  afterAll(async () => {
    if (asignacionIdsCreados.length > 0) {
      await prisma.grupoMateriaMaestro.deleteMany({
        where: { id: { in: asignacionIdsCreados } },
      });
    }
    if (grupoIdsCreados.length > 0) {
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

  it('maestro con asignaciones en 1 grupo (2 materias) -> agrupadas, materias nombre asc', async () => {
    const maestro = await crearMaestro(sedeMeridaId);
    const grupoId = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
      cicloActual: 1,
    });
    const matZ = await crearMateria(
      carreraLaeId,
      `ZZZ ${randomUUID().slice(0, 6)}`,
      1,
    );
    const matA = await crearMateria(
      carreraLaeId,
      `AAA ${randomUUID().slice(0, 6)}`,
      1,
    );
    await asignar(grupoId, matZ, maestro.perfilId);
    await asignar(grupoId, matA, maestro.perfilId);

    const res = await pedir(
      await firmarToken(maestro.usuarioId, RolUsuario.MAESTRO, sedeMeridaId),
    );
    expect(res.status).toBe(200);
    const data = (res.body as AsignacionesBody).data;
    expect(data).toHaveLength(1);
    expect(data[0].grupoId).toBe(grupoId);
    expect(data[0].carrera.id).toBe(carreraLaeId);
    expect(data[0].salon.id).toBe(salonMeridaId);
    expect(data[0].materias.map((m) => m.id)).toEqual([matA, matZ]); // nombre asc
  });

  it('maestro con asignaciones en 2 grupos -> 2 grupos, orden anioInicio/cicloActual desc, nombre asc', async () => {
    const maestro = await crearMaestro(sedeMeridaId);
    const grupoNuevo = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
      anioInicio: 2029,
      cicloActual: 1,
    });
    const grupoViejo = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
      anioInicio: 2026,
      cicloActual: 1,
    });
    const mat1 = await crearMateria(
      carreraLaeId,
      `M1 ${randomUUID().slice(0, 6)}`,
      1,
    );
    await asignar(grupoNuevo, mat1, maestro.perfilId);
    await asignar(grupoViejo, mat1, maestro.perfilId);

    const res = await pedir(
      await firmarToken(maestro.usuarioId, RolUsuario.MAESTRO, sedeMeridaId),
    );
    expect(res.status).toBe(200);
    const data = (res.body as AsignacionesBody).data;
    const nuestros = data.filter((g) =>
      [grupoNuevo, grupoViejo].includes(g.grupoId),
    );
    expect(nuestros.map((g) => g.grupoId)).toEqual([grupoNuevo, grupoViejo]); // anioInicio desc
  });

  it('maestro sin asignaciones -> { data: [] }', async () => {
    const maestro = await crearMaestro(sedeMeridaId);
    const res = await pedir(
      await firmarToken(maestro.usuarioId, RolUsuario.MAESTRO, sedeMeridaId),
    );
    expect(res.status).toBe(200);
    expect((res.body as AsignacionesBody).data).toEqual([]);
  });

  it('co-docencia: el maestro solo ve su propia asignación, no la de otro maestro', async () => {
    const maestroA = await crearMaestro(sedeMeridaId);
    const maestroB = await crearMaestro(sedeMeridaId);
    const grupoId = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
      cicloActual: 1,
    });
    const materiaCompartida = await crearMateria(
      carreraLaeId,
      `Compartida ${randomUUID().slice(0, 6)}`,
      1,
    );
    const materiaSoloB = await crearMateria(
      carreraLaeId,
      `SoloB ${randomUUID().slice(0, 6)}`,
      1,
    );
    await asignar(grupoId, materiaCompartida, maestroA.perfilId);
    await asignar(grupoId, materiaCompartida, maestroB.perfilId);
    await asignar(grupoId, materiaSoloB, maestroB.perfilId);

    const res = await pedir(
      await firmarToken(maestroA.usuarioId, RolUsuario.MAESTRO, sedeMeridaId),
    );
    expect(res.status).toBe(200);
    const grupo = (res.body as AsignacionesBody).data.find(
      (g) => g.grupoId === grupoId,
    );
    expect(grupo).toBeDefined();
    expect(grupo!.materias.map((m) => m.id)).toEqual([materiaCompartida]);
  });

  it('aislamiento cross-sede: no ve asignaciones de un grupo de otra sede', async () => {
    const maestroMerida = await crearMaestro(sedeMeridaId);
    const maestroValladolid = await crearMaestro(sedeValladolidId);
    const grupoMerida = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
      cicloActual: 1,
    });
    const grupoValladolid = await crearGrupo({
      sedeId: sedeValladolidId,
      carreraId: carreraValladolidId,
      salonId: salonValladolidId,
      cicloActual: 1,
    });
    const matMerida = await crearMateria(
      carreraLaeId,
      `MID ${randomUUID().slice(0, 6)}`,
      1,
    );
    const matVlld = await crearMateria(
      carreraValladolidId,
      `VLLD ${randomUUID().slice(0, 6)}`,
      1,
    );
    await asignar(grupoMerida, matMerida, maestroMerida.perfilId);
    await asignar(grupoValladolid, matVlld, maestroValladolid.perfilId);

    const res = await pedir(
      await firmarToken(
        maestroMerida.usuarioId,
        RolUsuario.MAESTRO,
        sedeMeridaId,
      ),
    );
    expect(res.status).toBe(200);
    const data = (res.body as AsignacionesBody).data;
    expect(data.some((g) => g.grupoId === grupoValladolid)).toBe(false);
    expect(data.flatMap((g) => g.materias.map((m) => m.id))).not.toContain(
      matVlld,
    );
  });

  it('rol ALUMNO -> 403 ROL_NO_AUTORIZADO', async () => {
    const alumnoUsuarioId = await crearAlumnoUsuario(sedeMeridaId);
    const res = await pedir(
      await firmarToken(alumnoUsuarioId, RolUsuario.ALUMNO, sedeMeridaId),
    );
    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });

  it('rol ADMINISTRATIVO -> 403 ROL_NO_AUTORIZADO', async () => {
    const admin = await prisma.usuario.findFirstOrThrow({
      where: { rol: RolUsuario.ADMINISTRATIVO, sedeId: sedeMeridaId },
    });
    const res = await pedir(
      await firmarToken(admin.id, RolUsuario.ADMINISTRATIVO, sedeMeridaId),
    );
    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });

  it('sin Authorization -> 401', async () => {
    const res = await request(app.getHttpServer()).get('/perfil/asignaciones');
    expect(res.status).toBe(401);
  });
});
