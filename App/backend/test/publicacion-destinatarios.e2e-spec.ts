import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { App } from 'supertest/types';
import { AlcanceDestino, RolUsuario } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { resolverDestinatarios } from '../src/common/publicacion/alcance-publicacion.util';
import { loadEnv } from '../src/load-env';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup-app';

loadEnv();

/**
 * Cobertura de `resolverDestinatarios` (`src/common/publicacion/
 * alcance-publicacion.util.ts`) para las ramas `CARRERA` y `GRUPO` — Fase 15,
 * pendiente Important 2. Avisos (Fase 16) va a importar este helper tal cual
 * para su fan-out, así que sus ramas más complejas (`CARRERA` resuelve
 * maestros vía `GrupoMateriaMaestro -> Grupo.carreraId`) necesitaban cobertura
 * propia; hasta hoy solo la rama `SEDE` estaba ejercitada, e indirectamente,
 * vía el job de `internal-recordatorios.e2e-spec.ts`.
 *
 * Estilo: e2e con fixtures reales (mismo patrón que `grupos-asignaciones.e2e-spec.ts`
 * / `calendario.e2e-spec.ts`) — no hay spec unit con Prisma mockeado en este
 * repo para este helper. En vez de pasar por HTTP se llama a
 * `resolverDestinatarios` directo con el `PrismaService` real del contenedor
 * de Nest: no existe endpoint que lo exponga de forma aislada (el job de
 * recordatorios lo llama pero con ventana de 48h y expansión de ocurrencias
 * de por medio, ruido innecesario para verificar la resolución de
 * destinatarios).
 *
 * Todos los fixtures se crean bajo carreras/grupos NUEVOS (no los del seed)
 * para poder afirmar el conjunto EXACTO de destinatarios, y se limpian en
 * `afterAll` acotado a los `id` creados (regla 14 — nunca por patrón de
 * nombre/email).
 */
describe('resolverDestinatarios — ramas CARRERA y GRUPO (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let sedeMeridaId: string;
  let salonMeridaId: string;

  // Carreras fixture (todas en Mérida).
  let carreraAId: string;
  let carreraBId: string;
  let carreraVaciaId: string;

  // Grupos fixture.
  let grupoA1Id: string;
  let grupoA2Id: string;
  let grupoB1Id: string;
  let grupoTargetId: string; // en carrera B, sujeto de la rama GRUPO
  let grupoOtroId: string; // en carrera B, para aislamiento de la rama GRUPO
  let grupoVacioId: string;

  // Destinatarios esperados / no esperados de la rama CARRERA (carrera A).
  let alumnoActivoCarreraAUsuarioId: string;
  let alumnoInactivoCarreraAUsuarioId: string;
  let alumnoCarreraBUsuarioId: string;
  let maestroVariasMateriasUsuarioId: string; // 2 materias del mismo grupo de carrera A -> 1 sola vez
  let maestroCruzadoUsuarioId: string; // grupo de carrera A y grupo de carrera B -> sí cuenta para A
  let maestroSoloCarreraBUsuarioId: string; // solo grupo de carrera B -> no cuenta para A
  let maestroInactivoCarreraAUsuarioId: string; // grupo de carrera A pero Usuario.activo=false

  // Destinatarios esperados / no esperados de la rama GRUPO (grupoTarget).
  let alumnoActivoGrupoTargetUsuarioId: string;
  let alumnoInactivoGrupoTargetUsuarioId: string;
  let alumnoGrupoOtroUsuarioId: string;
  let maestroGrupoTargetUsuarioId: string; // 2 materias en grupoTarget -> 1 sola vez
  let maestroGrupoOtroUsuarioId: string;
  let maestroInactivoGrupoTargetUsuarioId: string;

  const carreraIdsCreados: string[] = [];
  const grupoIdsCreados: string[] = [];
  const materiaIdsCreados: string[] = [];
  const usuarioIdsCreados: string[] = [];

  async function crearCarrera(): Promise<string> {
    const c = await prisma.carrera.create({
      data: {
        nombre: `Carrera PUB-DEST ${randomUUID().slice(0, 8)}`,
        clave: `PUB-DEST-${randomUUID().slice(0, 12).toUpperCase()}`,
        sedeId: sedeMeridaId,
        duracion: 8,
        nivel: 'LICENCIATURA',
        modalidad: 'PRESENCIAL',
        rvoe: 'RVOE-TEST',
        descripcion: 'Fixture de cobertura de resolverDestinatarios',
      },
    });
    carreraIdsCreados.push(c.id);
    return c.id;
  }

  async function crearGrupo(carreraId: string, ciclo = 1): Promise<string> {
    const g = await prisma.grupo.create({
      data: {
        sedeId: sedeMeridaId,
        carreraId,
        salonId: salonMeridaId,
        nombre: `Grupo PUB-DEST ${randomUUID().slice(0, 8)}`,
        anioInicio: 2027,
        cicloActual: ciclo,
        capacidad: 40,
      },
    });
    grupoIdsCreados.push(g.id);
    return g.id;
  }

  async function crearMateria(carreraId: string, ciclo = 1): Promise<string> {
    const m = await prisma.materia.create({
      data: {
        carreraId,
        nombre: `Materia PUB-DEST ${randomUUID().slice(0, 8)}`,
        ciclo,
      },
    });
    materiaIdsCreados.push(m.id);
    return m.id;
  }

  async function crearAlumno(opts: {
    carreraId: string;
    activo: boolean;
  }): Promise<{ usuarioId: string; perfilId: string }> {
    const usuario = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.pubdest.alumno.${randomUUID()}@example.com`,
        rol: RolUsuario.ALUMNO,
        sedeId: sedeMeridaId,
        activo: opts.activo,
      },
    });
    usuarioIdsCreados.push(usuario.id);
    const perfil = await prisma.perfilAlumno.create({
      data: {
        usuarioId: usuario.id,
        nombres: 'Fixture',
        apellidoPaterno: 'PubDest',
        fechaNacimiento: new Date('2004-01-01'),
        matricula: `APD${randomUUID().slice(0, 12).toUpperCase()}`,
        correoPersonal: `fixture.pubdest.alumno.p.${randomUUID()}@example.com`,
        carreraId: opts.carreraId,
        estatusAcademico: 'INSCRITO',
        periodoIngreso: '2027-1',
        semestreActual: 1,
      },
    });
    return { usuarioId: usuario.id, perfilId: perfil.id };
  }

  async function crearMaestro(opts: {
    activo: boolean;
  }): Promise<{ usuarioId: string; perfilId: string }> {
    const usuario = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.pubdest.maestro.${randomUUID()}@example.com`,
        rol: RolUsuario.MAESTRO,
        sedeId: sedeMeridaId,
        activo: opts.activo,
      },
    });
    usuarioIdsCreados.push(usuario.id);
    const perfil = await prisma.perfilMaestro.create({
      data: {
        usuarioId: usuario.id,
        nombres: 'Fixture',
        apellidoPaterno: 'PubDest',
        curp: `FXPD${randomUUID().slice(0, 14).toUpperCase()}`,
        cedulaProfesional: `${randomUUID().slice(0, 7)}`,
        correoPersonal: `fixture.pubdest.maestro.p.${randomUUID()}@example.com`,
        telefono: '9990000000',
        fechaContratacion: new Date('2024-08-01'),
        estatus: 'ACTIVO',
      },
    });
    return { usuarioId: usuario.id, perfilId: perfil.id };
  }

  async function matricular(
    grupoId: string,
    alumnoPerfilId: string,
  ): Promise<void> {
    await prisma.grupoAlumno.create({
      data: { grupoId, alumnoId: alumnoPerfilId },
    });
  }

  async function asignar(
    grupoId: string,
    materiaId: string,
    maestroPerfilId: string,
  ): Promise<void> {
    await prisma.grupoMateriaMaestro.create({
      data: { grupoId, materiaId, maestroId: maestroPerfilId },
    });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = moduleFixture.get(PrismaService);

    sedeMeridaId = (
      await prisma.sede.findUniqueOrThrow({ where: { nombre: 'CESP Mérida' } })
    ).id;
    salonMeridaId = (
      await prisma.salon.findUniqueOrThrow({
        where: { sedeId_nombre: { sedeId: sedeMeridaId, nombre: 'Aula 101' } },
      })
    ).id;

    carreraAId = await crearCarrera();
    carreraBId = await crearCarrera();
    carreraVaciaId = await crearCarrera();

    grupoA1Id = await crearGrupo(carreraAId);
    grupoA2Id = await crearGrupo(carreraAId);
    grupoB1Id = await crearGrupo(carreraBId);
    // grupoTarget / grupoOtro viven en carrera B a propósito: así sus
    // alumnos/maestros (fixtures de la rama GRUPO) no contaminan el conjunto
    // EXACTO que se afirma para la rama CARRERA sobre carrera A.
    grupoTargetId = await crearGrupo(carreraBId);
    grupoOtroId = await crearGrupo(carreraBId);
    grupoVacioId = await crearGrupo(carreraAId);

    const materiaA1 = await crearMateria(carreraAId);
    const materiaA2 = await crearMateria(carreraAId);
    const materiaB1 = await crearMateria(carreraBId);
    const materiaTarget1 = await crearMateria(carreraBId);
    const materiaTarget2 = await crearMateria(carreraBId);
    const materiaOtro1 = await crearMateria(carreraBId);

    // ---- Fixtures rama CARRERA (carrera A) ----
    alumnoActivoCarreraAUsuarioId = (
      await crearAlumno({ carreraId: carreraAId, activo: true })
    ).usuarioId;
    alumnoInactivoCarreraAUsuarioId = (
      await crearAlumno({ carreraId: carreraAId, activo: false })
    ).usuarioId;
    alumnoCarreraBUsuarioId = (
      await crearAlumno({ carreraId: carreraBId, activo: true })
    ).usuarioId;

    const maestroVariasMaterias = await crearMaestro({ activo: true });
    maestroVariasMateriasUsuarioId = maestroVariasMaterias.usuarioId;
    // 2 materias del MISMO grupo de carrera A -> debe aparecer 1 sola vez.
    await asignar(grupoA1Id, materiaA1, maestroVariasMaterias.perfilId);
    await asignar(grupoA1Id, materiaA2, maestroVariasMaterias.perfilId);

    const maestroCruzado = await crearMaestro({ activo: true });
    maestroCruzadoUsuarioId = maestroCruzado.usuarioId;
    // Un grupo de carrera A y otro de carrera B -> sí cuenta para A.
    await asignar(grupoA2Id, materiaA1, maestroCruzado.perfilId);
    await asignar(grupoB1Id, materiaB1, maestroCruzado.perfilId);

    const maestroSoloCarreraB = await crearMaestro({ activo: true });
    maestroSoloCarreraBUsuarioId = maestroSoloCarreraB.usuarioId;
    await asignar(grupoB1Id, materiaB1, maestroSoloCarreraB.perfilId);

    const maestroInactivoCarreraA = await crearMaestro({ activo: false });
    maestroInactivoCarreraAUsuarioId = maestroInactivoCarreraA.usuarioId;
    await asignar(grupoA1Id, materiaA1, maestroInactivoCarreraA.perfilId);

    // ---- Fixtures rama GRUPO (grupoTarget, en carrera B) ----
    const alumnoActivoGrupoTarget = await crearAlumno({
      carreraId: carreraBId,
      activo: true,
    });
    alumnoActivoGrupoTargetUsuarioId = alumnoActivoGrupoTarget.usuarioId;
    await matricular(grupoTargetId, alumnoActivoGrupoTarget.perfilId);

    const alumnoInactivoGrupoTarget = await crearAlumno({
      carreraId: carreraBId,
      activo: false,
    });
    alumnoInactivoGrupoTargetUsuarioId = alumnoInactivoGrupoTarget.usuarioId;
    await matricular(grupoTargetId, alumnoInactivoGrupoTarget.perfilId);

    const alumnoGrupoOtro = await crearAlumno({
      carreraId: carreraBId,
      activo: true,
    });
    alumnoGrupoOtroUsuarioId = alumnoGrupoOtro.usuarioId;
    await matricular(grupoOtroId, alumnoGrupoOtro.perfilId);

    const maestroGrupoTarget = await crearMaestro({ activo: true });
    maestroGrupoTargetUsuarioId = maestroGrupoTarget.usuarioId;
    // 2 materias en el MISMO grupo -> 1 sola vez.
    await asignar(grupoTargetId, materiaTarget1, maestroGrupoTarget.perfilId);
    await asignar(grupoTargetId, materiaTarget2, maestroGrupoTarget.perfilId);

    const maestroGrupoOtro = await crearMaestro({ activo: true });
    maestroGrupoOtroUsuarioId = maestroGrupoOtro.usuarioId;
    await asignar(grupoOtroId, materiaOtro1, maestroGrupoOtro.perfilId);

    const maestroInactivoGrupoTarget = await crearMaestro({ activo: false });
    maestroInactivoGrupoTargetUsuarioId = maestroInactivoGrupoTarget.usuarioId;
    await asignar(
      grupoTargetId,
      materiaTarget1,
      maestroInactivoGrupoTarget.perfilId,
    );
  }, 60000);

  afterAll(async () => {
    if (grupoIdsCreados.length > 0) {
      await prisma.grupoMateriaMaestro.deleteMany({
        where: { grupoId: { in: grupoIdsCreados } },
      });
      await prisma.grupoAlumno.deleteMany({
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
      await prisma.perfilAlumno.deleteMany({
        where: { usuarioId: { in: usuarioIdsCreados } },
      });
      await prisma.usuario.deleteMany({
        where: { id: { in: usuarioIdsCreados } },
      });
    }
    if (carreraIdsCreados.length > 0) {
      await prisma.carrera.deleteMany({
        where: { id: { in: carreraIdsCreados } },
      });
    }
    await app.close();
  });

  describe('CARRERA', () => {
    it('devuelve exactamente alumnos de la carrera + maestros asignados a algún grupo de esa carrera (activos, sin duplicados)', async () => {
      const destinatarios = await resolverDestinatarios(
        prisma,
        sedeMeridaId,
        AlcanceDestino.CARRERA,
        carreraAId,
      );
      const set = new Set(destinatarios);

      // Sin duplicados aunque un maestro dé 2 materias de la misma carrera.
      expect(destinatarios.length).toBe(set.size);

      // Presentes.
      expect(set.has(alumnoActivoCarreraAUsuarioId)).toBe(true);
      expect(set.has(maestroVariasMateriasUsuarioId)).toBe(true);
      expect(set.has(maestroCruzadoUsuarioId)).toBe(true);

      // Ausentes.
      expect(set.has(alumnoInactivoCarreraAUsuarioId)).toBe(false);
      expect(set.has(alumnoCarreraBUsuarioId)).toBe(false);
      expect(set.has(maestroSoloCarreraBUsuarioId)).toBe(false);
      expect(set.has(maestroInactivoCarreraAUsuarioId)).toBe(false);

      // Conjunto EXACTO acotado a los fixtures de esta suite (la carrera es
      // nueva, así que no hay nadie más que estos).
      expect(new Set(destinatarios)).toEqual(
        new Set([
          alumnoActivoCarreraAUsuarioId,
          maestroVariasMateriasUsuarioId,
          maestroCruzadoUsuarioId,
        ]),
      );
    });

    it('el maestro que aparece 2 veces (2 materias del mismo grupo) figura una sola vez', async () => {
      const destinatarios = await resolverDestinatarios(
        prisma,
        sedeMeridaId,
        AlcanceDestino.CARRERA,
        carreraAId,
      );
      const apariciones = destinatarios.filter(
        (id) => id === maestroVariasMateriasUsuarioId,
      );
      expect(apariciones).toHaveLength(1);
    });

    it('carrera sin alumnos ni asignaciones -> lista vacía, sin lanzar', async () => {
      const destinatarios = await resolverDestinatarios(
        prisma,
        sedeMeridaId,
        AlcanceDestino.CARRERA,
        carreraVaciaId,
      );
      expect(destinatarios).toEqual([]);
    });
  });

  describe('GRUPO', () => {
    it('devuelve exactamente alumnos matriculados + maestros asignados al grupo (activos, sin duplicados)', async () => {
      const destinatarios = await resolverDestinatarios(
        prisma,
        sedeMeridaId,
        AlcanceDestino.GRUPO,
        grupoTargetId,
      );
      const set = new Set(destinatarios);

      expect(destinatarios.length).toBe(set.size);

      // Presentes.
      expect(set.has(alumnoActivoGrupoTargetUsuarioId)).toBe(true);
      expect(set.has(maestroGrupoTargetUsuarioId)).toBe(true);

      // Ausentes: inactivos y todo lo de otro grupo.
      expect(set.has(alumnoInactivoGrupoTargetUsuarioId)).toBe(false);
      expect(set.has(alumnoGrupoOtroUsuarioId)).toBe(false);
      expect(set.has(maestroGrupoOtroUsuarioId)).toBe(false);
      expect(set.has(maestroInactivoGrupoTargetUsuarioId)).toBe(false);

      expect(new Set(destinatarios)).toEqual(
        new Set([
          alumnoActivoGrupoTargetUsuarioId,
          maestroGrupoTargetUsuarioId,
        ]),
      );
    });

    it('el maestro con 2 materias en el mismo grupo figura una sola vez', async () => {
      const destinatarios = await resolverDestinatarios(
        prisma,
        sedeMeridaId,
        AlcanceDestino.GRUPO,
        grupoTargetId,
      );
      const apariciones = destinatarios.filter(
        (id) => id === maestroGrupoTargetUsuarioId,
      );
      expect(apariciones).toHaveLength(1);
    });

    it('grupo sin matriculados ni asignaciones -> lista vacía, sin lanzar', async () => {
      const destinatarios = await resolverDestinatarios(
        prisma,
        sedeMeridaId,
        AlcanceDestino.GRUPO,
        grupoVacioId,
      );
      expect(destinatarios).toEqual([]);
    });
  });
});
