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
interface CompanerosBody {
  data: Array<{
    grupoId: string;
    nombre: string;
    anioInicio: number;
    cicloActual: number;
    carrera: { id: string; nombre: string };
    salon: { id: string; nombre: string };
    companeros: Array<{
      usuarioId: string;
      nombres: string;
      apellidoPaterno: string;
      apellidoMaterno: string | null;
      matricula: string;
      semestreActual: number;
    }>;
  }>;
}

describe('PerfilController — GET /perfil/grupo/companeros (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let sedeValladolidId: string;
  let carreraLaeId: string; // LAE-MID (Mérida)
  let carreraIngId: string; // ING-SIS-MID (Mérida)
  let salonMeridaId: string;
  let salonValladolidId: string;
  let carreraValladolidId: string; // LC-VLD
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';

  const usuarioIdsCreados: string[] = [];
  const grupoIdsCreados: string[] = [];

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

  async function crearAlumno(opts: {
    sedeId: string;
    carreraId: string;
    apellidoPaterno?: string;
    apellidoMaterno?: string;
    nombres?: string;
    semestreActual?: number;
  }): Promise<{ usuarioId: string; perfilId: string; matricula: string }> {
    const usuario = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.companeros.${randomUUID()}@example.com`,
        rol: RolUsuario.ALUMNO,
        sedeId: opts.sedeId,
      },
    });
    usuarioIdsCreados.push(usuario.id);
    const matricula = `FXCOMP${randomUUID().slice(0, 10).toUpperCase()}`;
    const perfil = await prisma.perfilAlumno.create({
      data: {
        usuarioId: usuario.id,
        nombres: opts.nombres ?? 'Fixture',
        apellidoPaterno: opts.apellidoPaterno ?? 'Companeros',
        apellidoMaterno: opts.apellidoMaterno ?? `Z${randomUUID().slice(0, 4)}`,
        curp: `FX${randomUUID().slice(0, 16).toUpperCase()}`,
        fechaNacimiento: new Date('2006-01-01'),
        matricula,
        correoPersonal: `fixture.companeros.personal.${randomUUID()}@example.com`,
        carreraId: opts.carreraId,
        estatusAcademico: 'INSCRITO',
        periodoIngreso: '2026-1',
        semestreActual: opts.semestreActual ?? 1,
        telefono: '9990000000',
      },
    });
    return { usuarioId: usuario.id, perfilId: perfil.id, matricula };
  }

  async function crearGrupo(opts: {
    sedeId: string;
    carreraId: string;
    salonId: string;
    nombre?: string;
    anioInicio?: number;
    cicloActual?: number;
  }): Promise<string> {
    const grupo = await prisma.grupo.create({
      data: {
        sedeId: opts.sedeId,
        carreraId: opts.carreraId,
        salonId: opts.salonId,
        nombre: opts.nombre ?? `Grupo COMP E2E ${randomUUID().slice(0, 8)}`,
        anioInicio: opts.anioInicio ?? 2027,
        cicloActual: opts.cicloActual ?? 1,
        capacidad: 30,
      },
    });
    grupoIdsCreados.push(grupo.id);
    return grupo.id;
  }

  async function inscribir(
    grupoId: string,
    alumnoPerfilId: string,
  ): Promise<void> {
    await prisma.grupoAlumno.create({
      data: { grupoId, alumnoId: alumnoPerfilId },
    });
  }

  function pedir(token: string): Promise<request.Response> {
    return request(app.getHttpServer())
      .get('/perfil/grupo/companeros')
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
  }, 30000);

  afterAll(async () => {
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

  it('alumno en 1 grupo -> ve a sus compañeros y NO se ve a sí mismo', async () => {
    const grupoId = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
    });
    const actor = await crearAlumno({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      apellidoPaterno: 'Zavala',
    });
    const compaA = await crearAlumno({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      apellidoPaterno: 'Aguilar',
    });
    const compaB = await crearAlumno({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      apellidoPaterno: 'Balam',
    });
    await inscribir(grupoId, actor.perfilId);
    await inscribir(grupoId, compaA.perfilId);
    await inscribir(grupoId, compaB.perfilId);

    const res = await pedir(
      await firmarToken(actor.usuarioId, RolUsuario.ALUMNO, sedeMeridaId),
    );

    expect(res.status).toBe(200);
    const data = (res.body as CompanerosBody).data;
    expect(data).toHaveLength(1);
    expect(data[0].grupoId).toBe(grupoId);
    expect(data[0].carrera.id).toBe(carreraLaeId);
    expect(data[0].salon.id).toBe(salonMeridaId);
    const ids = data[0].companeros.map((c) => c.usuarioId);
    expect(ids).toEqual([compaA.usuarioId, compaB.usuarioId]); // orden apellidoPaterno asc
    expect(ids).not.toContain(actor.usuarioId);
    expect(data[0].companeros[0]).toMatchObject({
      matricula: compaA.matricula,
      apellidoPaterno: 'Aguilar',
      semestreActual: 1,
    });
  });

  it('alumno en 2 grupos del mismo periodo -> 2 grupos, orden por nombre asc', async () => {
    const grupoB = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
      nombre: `ZZZ COMP ${randomUUID().slice(0, 6)}`,
      anioInicio: 2028,
      cicloActual: 2,
    });
    const grupoA = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
      nombre: `AAA COMP ${randomUUID().slice(0, 6)}`,
      anioInicio: 2028,
      cicloActual: 2,
    });
    const actor = await crearAlumno({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
    });
    const otro = await crearAlumno({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
    });
    await inscribir(grupoA, actor.perfilId);
    await inscribir(grupoB, actor.perfilId);
    await inscribir(grupoA, otro.perfilId);

    const res = await pedir(
      await firmarToken(actor.usuarioId, RolUsuario.ALUMNO, sedeMeridaId),
    );

    expect(res.status).toBe(200);
    const data = (res.body as CompanerosBody).data;
    const nuestros = data.filter((g) => [grupoA, grupoB].includes(g.grupoId));
    expect(nuestros.map((g) => g.grupoId)).toEqual([grupoA, grupoB]); // nombre asc
    expect(nuestros[0].companeros.map((c) => c.usuarioId)).toEqual([
      otro.usuarioId,
    ]);
    expect(nuestros[1].companeros).toEqual([]);
  });

  it('alumno en 0 grupos -> { data: [] }', async () => {
    const actor = await crearAlumno({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
    });
    const res = await pedir(
      await firmarToken(actor.usuarioId, RolUsuario.ALUMNO, sedeMeridaId),
    );
    expect(res.status).toBe(200);
    expect((res.body as CompanerosBody).data).toEqual([]);
  });

  it('alumno solo en su grupo -> grupo presente con companeros: []', async () => {
    const grupoId = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraIngId,
      salonId: salonMeridaId,
    });
    const actor = await crearAlumno({
      sedeId: sedeMeridaId,
      carreraId: carreraIngId,
    });
    await inscribir(grupoId, actor.perfilId);

    const res = await pedir(
      await firmarToken(actor.usuarioId, RolUsuario.ALUMNO, sedeMeridaId),
    );
    expect(res.status).toBe(200);
    const g = (res.body as CompanerosBody).data.find(
      (x) => x.grupoId === grupoId,
    );
    expect(g).toBeDefined();
    expect(g?.companeros).toEqual([]);
  });

  it('aislamiento cross-sede: no ve alumnos de un grupo homónimo en otra sede', async () => {
    const nombreCompartido = `COMP CROSS ${randomUUID().slice(0, 6)}`;
    const grupoMerida = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
      nombre: nombreCompartido,
    });
    const grupoValladolid = await crearGrupo({
      sedeId: sedeValladolidId,
      carreraId: carreraValladolidId,
      salonId: salonValladolidId,
      nombre: nombreCompartido,
    });
    const actor = await crearAlumno({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
    });
    const ajeno = await crearAlumno({
      sedeId: sedeValladolidId,
      carreraId: carreraValladolidId,
    });
    await inscribir(grupoMerida, actor.perfilId);
    await inscribir(grupoValladolid, ajeno.perfilId);

    const res = await pedir(
      await firmarToken(actor.usuarioId, RolUsuario.ALUMNO, sedeMeridaId),
    );
    expect(res.status).toBe(200);
    const data = (res.body as CompanerosBody).data;
    const todosLosCompaneros = data.flatMap((g) =>
      g.companeros.map((c) => c.usuarioId),
    );
    expect(todosLosCompaneros).not.toContain(ajeno.usuarioId);
    expect(data.some((g) => g.grupoId === grupoValladolid)).toBe(false);
  });

  it('rol MAESTRO -> 403 ROL_NO_AUTORIZADO', async () => {
    const maestro = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.companeros.maestro.${randomUUID()}@example.com`,
        rol: RolUsuario.MAESTRO,
        sedeId: sedeMeridaId,
      },
    });
    usuarioIdsCreados.push(maestro.id);
    const res = await pedir(
      await firmarToken(maestro.id, RolUsuario.MAESTRO, sedeMeridaId),
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
    const res = await request(app.getHttpServer()).get(
      '/perfil/grupo/companeros',
    );
    expect(res.status).toBe(401);
  });
});
