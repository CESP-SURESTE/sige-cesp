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

interface PerfilBody {
  data: {
    id: string;
    email: string;
    rol: RolUsuario;
    sedeId: string;
    codigoExterno: string | null;
    primerIngreso: boolean;
    activo: boolean;
    ultimoAcceso: string | null;
    sede: {
      id: string;
      nombre: string;
      direccion: string;
      ubicacionReferencia: string;
      telefono: string;
    };
    alumno: {
      id: string;
      nombres: string;
      apellidoPaterno: string;
      apellidoMaterno: string | null;
      curp: string | null;
      fechaNacimiento: string;
      matricula: string;
      correoPersonal: string;
      estatusAcademico: string;
      periodoIngreso: string;
      semestreActual: number;
      telefono: string | null;
      esMenorDeEdad: boolean;
      carrera: {
        id: string;
        nombre: string;
        clave: string;
        duracion: number;
        nivel: string;
        modalidad: string;
        estatus: string;
        rvoe: string;
        descripcion: string;
      };
    } | null;
    maestro: null;
    administrativo: null;
  };
}

/**
 * Test de integración — Fase 5, Día 16 (`GET /perfil`).
 *
 * Contra la app real (`AppModule` completo, `PrismaService` conectado a la
 * DB real de Supabase) y datos reales sembrados por `prisma/seed.ts` — mismo
 * criterio que `test/carreras.e2e-spec.ts`: no hace falta mockear Supabase
 * Auth acá (ruta de solo lectura contra Postgres, sin tocar Auth), solo el
 * JWKS de prueba (`SEDE_GUARD_ENV_OVERRIDE`) para firmar JWTs verificables.
 */
describe('PerfilController — GET /perfil (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let alumnoMenorId: string;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';

  async function firmarToken(
    sub: string,
    rol: RolUsuario,
    sedeId: string,
  ): Promise<string> {
    return new jose.SignJWT({
      role: 'authenticated',
      sede_id: sedeId,
      rol,
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

    // Fixture nuevo (extensión `esMenorDeEdad`, 2026-08-12) — ningún alumno
    // sembrado por `prisma/seed.ts` es menor de edad a la fecha en que corre
    // este suite (`luis.chan` 2007-03-12, `mariajose.pech` 2008-07-20, ambos
    // ya mayores). Se crea un alumno directo por Prisma (mismo criterio que
    // los fixtures de `test/personas.e2e-spec.ts`) con `fechaNacimiento`
    // reciente para ejercitar el branch `esMenorDeEdad: true` de verdad.
    const carreraMerida = await prisma.carrera.findUniqueOrThrow({
      where: { clave: 'LAE-MID' },
    });
    const alumnoMenor = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.alumnomenor.${randomUUID()}@cesp-merida.edu.mx`,
        rol: RolUsuario.ALUMNO,
        sedeId: sedeMeridaId,
      },
    });
    await prisma.perfilAlumno.create({
      data: {
        usuarioId: alumnoMenor.id,
        nombres: 'Fixture',
        apellidoPaterno: 'Menor',
        fechaNacimiento: new Date('2015-01-01'),
        matricula: `MID-2026-FIX-${randomUUID().slice(0, 8)}`,
        correoPersonal: `fixture.alumnomenor.personal.${randomUUID()}@example.com`,
        carreraId: carreraMerida.id,
        estatusAcademico: 'INSCRITO',
        periodoIngreso: '2026-1',
        semestreActual: 1,
      },
    });
    alumnoMenorId = alumnoMenor.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rol ALUMNO (seed real) -> 200, datos personales + sede + carrera correctos', async () => {
    const alumnoUsuario = await prisma.usuario.findUniqueOrThrow({
      where: { email: 'luis.chan@cesp-merida.edu.mx' },
    });

    const res = await request(app.getHttpServer())
      .get('/perfil')
      .set(
        'Authorization',
        `Bearer ${await firmarToken(alumnoUsuario.id, RolUsuario.ALUMNO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(200);
    const body = (res.body as PerfilBody).data;

    // Datos comunes (usuario + sede).
    expect(body.id).toBe(alumnoUsuario.id);
    expect(body.email).toBe('luis.chan@cesp-merida.edu.mx');
    expect(body.rol).toBe('ALUMNO');
    expect(body.sedeId).toBe(sedeMeridaId);
    expect(body.sede.id).toBe(sedeMeridaId);
    expect(body.sede.nombre).toBe('CESP Mérida');
    // Dato financiero interno, no debe filtrarse al perfil del propio usuario.
    expect(body.sede).not.toHaveProperty('costoRenta');

    // Sub-objeto de rol ALUMNO (Día 16, entregable de hoy).
    expect(body.alumno).not.toBeNull();
    expect(body.alumno?.nombres).toBe('Luis Fernando');
    expect(body.alumno?.apellidoPaterno).toBe('Chan');
    expect(body.alumno?.apellidoMaterno).toBe('Uc');
    expect(body.alumno?.matricula).toBe('MID-2026-0001');
    expect(body.alumno?.correoPersonal).toBe('luis.chan.personal@example.com');
    expect(body.alumno?.estatusAcademico).toBe('INSCRITO');
    expect(body.alumno?.periodoIngreso).toBe('2026-1');
    expect(body.alumno?.semestreActual).toBe(1);

    // `esMenorDeEdad` — calculado al vuelo, nunca persistido (regla 1 de
    // CLAUDE.md raíz). `luis.chan` nació el 2007-03-12 (prisma/seed.ts) —
    // ya es mayor de edad a la fecha en que corre este test.
    expect(body.alumno?.esMenorDeEdad).toBe(false);

    // Carrera / plan de estudios (roadmap Día 16).
    expect(body.alumno?.carrera.clave).toBe('LAE-MID');
    expect(body.alumno?.carrera.nombre).toBe('Licenciatura en Administración');
    expect(body.alumno?.carrera.duracion).toBe(8);
    expect(body.alumno?.carrera.nivel).toBe('LICENCIATURA');
    expect(body.alumno?.carrera.modalidad).toBe('PRESENCIAL');

    // Reservados para Día 17/18 — no implementados todavía.
    expect(body.maestro).toBeNull();
    expect(body.administrativo).toBeNull();
  });

  it('rol ALUMNO menor de edad (fixture, fechaNacimiento 2015-01-01) -> 200, esMenorDeEdad true', async () => {
    const res = await request(app.getHttpServer())
      .get('/perfil')
      .set(
        'Authorization',
        `Bearer ${await firmarToken(alumnoMenorId, RolUsuario.ALUMNO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(200);
    const body = (res.body as PerfilBody).data;
    expect(body.alumno?.esMenorDeEdad).toBe(true);
  });

  it('rol ADMINISTRATIVO (seed real) -> 200, alumno queda null (no le aplica)', async () => {
    const adminUsuario = await prisma.usuario.findUniqueOrThrow({
      where: { email: 'ana.canul@cesp-merida.edu.mx' },
    });

    const res = await request(app.getHttpServer())
      .get('/perfil')
      .set(
        'Authorization',
        `Bearer ${await firmarToken(adminUsuario.id, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(200);
    const body = (res.body as PerfilBody).data;

    expect(body.id).toBe(adminUsuario.id);
    expect(body.rol).toBe('ADMINISTRATIVO');
    expect(body.sede.id).toBe(sedeMeridaId);
    expect(body.alumno).toBeNull();
    expect(body.maestro).toBeNull();
    expect(body.administrativo).toBeNull();
  });

  it('actor sin fila en `usuarios` (JWT válido pero sub inexistente) -> 404 NOT_FOUND', async () => {
    const res = await request(app.getHttpServer())
      .get('/perfil')
      .set(
        'Authorization',
        `Bearer ${await firmarToken(randomUUID(), RolUsuario.ALUMNO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('sin Authorization -> 401 UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer()).get('/perfil');

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
  });
});
