# Día 34 — UI de asignación + vista del maestro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El admin asigna/quita maestros a las materias de un grupo (y crea materias) desde el detalle del grupo; el maestro ve "mis grupos y materias" en su perfil. Cierra la Fase 12.

**Architecture:** Un endpoint backend nuevo (`GET /perfil/asignaciones`, MAESTRO-only, en `PerfilController`). En el frontend admin, una sección nueva `SeccionAsignaciones` + 2 modales locales bajo `app/admin/grupos/[id]/`, más `lib/api/materias.ts` nuevo y 3 funciones nuevas en `lib/api/grupos.ts`. En el frontend maestro, una sección nueva en `app/maestro/page.tsx` que consume `obtenerMisAsignaciones` de `lib/api/perfil.ts`.

**Tech Stack:** NestJS 11 + Prisma 6.x (backend); Next.js 16 + React Query 5 + Tailwind 4 + `@headlessui/react` (frontend). e2e con Jest + supertest contra la DB real de Supabase.

## Global Constraints

- **`sedeId` SIEMPRE de `@SedeActual()`** (JWT), nunca de body/query/path (regla 2). En el frontend, `sedeId` nunca es parámetro de una función de `lib/api/*`.
- **Nunca persistir datos calculables** (regla 1).
- **Todo catch/error handler loguea antes de responder** — mínimo `console.error` con el error completo, backend y frontend (regla 12). Referencia: `PerfilService.obtenerCompanerosDeGrupo` (backend), el `queryFn` de `AdminGrupoDetallePage` (frontend).
- **Contrato de API:** JSON camelCase, fechas ISO 8601. Éxito `{ data: ... }`. Error `{ error, code }` con `code` de la lista fija (`VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`, `UNAUTHORIZED`) o `ROL_NO_AUTORIZADO` (vía `RolesGuard`). **NO se crea código de error nuevo este día.**
- **Separación total admin/alumno/maestro en frontend** — árboles independientes, sin componentes compartidos (regla 11). El trabajo de admin va en `app/admin/grupos/[id]/` + `lib/api/`; el del maestro en `app/maestro/` + `lib/api/`.
- **No agregar dependencias nuevas.**
- **Guards del endpoint nuevo:** `SedeGuard` (clase, ya está) + `RolesGuard` a nivel de MÉTODO + `@Roles(RolUsuario.MAESTRO)` — copia exacta de `GET /perfil/malla` / `GET /perfil/grupo/companeros`.
- **Comandos:** backend desde `App/backend/` — e2e completo `pnpm test:e2e`, un archivo `pnpm test:e2e <filtro>`, unit `pnpm test`, build `pnpm build`. Frontend desde `App/frontend/` — `pnpm build` (corre el type-check de Next), lint puntual `npx eslint "<archivos>"` **sin `--fix`**. **NUNCA `pnpm lint`** en ningún paquete (es `eslint --fix` y reformatea archivos ajenos — hallazgo de Día 32/33).
- **Regla 14:** el `afterAll` de cada spec e2e nuevo limpia acotado a los `id` creados en la corrida — nunca por patrón de email/nombre.
- **Entorno:** Windows + PowerShell; el shell Bash disponible acepta `/` en rutas.

---

### Task 1: Backend — `GET /perfil/asignaciones` (maestro) + e2e

**Files:**
- Modify: `App/backend/src/perfil/perfil.controller.ts` (método `obtenerAsignaciones`)
- Modify: `App/backend/src/perfil/perfil.service.ts` (método `obtenerAsignacionesPropias`)
- Test: `App/backend/test/perfil-asignaciones.e2e-spec.ts` (nuevo)
- Modify: `C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp/CLAUDE.md` (entrada de contrato)

**Interfaces:**
- Consumes: `PrismaService` (ya inyectado en `PerfilService`), decorador `@ActorUsuarioId()`, guards `SedeGuard`/`RolesGuard` + `@Roles` (ya importados en `perfil.controller.ts`), `NotFoundException` (ya importado en `perfil.service.ts`), delegado `prisma.grupoMateriaMaestro` (existe desde Día 33), `prisma.perfilMaestro`.
- Produces (lo que Task 3 replica en `lib/api/perfil.ts`):

```ts
// Respuesta: 200 { data: GrupoConMaterias[] }
interface GrupoConMaterias {
  grupoId: string;
  nombre: string;
  anioInicio: number;
  cicloActual: number;
  carrera: { id: string; nombre: string };
  salon: { id: string; nombre: string };
  materias: { id: string; nombre: string; ciclo: number }[];
}
```

- [ ] **Step 1: Escribir el spec e2e (fallará: ruta 404)**

Crear `App/backend/test/perfil-asignaciones.e2e-spec.ts`. Andamiaje calcado de
`test/perfil-companeros.e2e-spec.ts` (JWKS de prueba, `SEDE_GUARD_ENV_OVERRIDE`,
`firmarToken(sub, rol, sedeId)`, `configureApp`) y helpers de fixtures de
`test/grupos-asignaciones.e2e-spec.ts`.

```ts
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
  let carreraIngId: string; // ING-SIS-MID (Mérida)
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
      await prisma.sede.findUniqueOrThrow({ where: { nombre: 'CESP Valladolid' } })
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
    const matZ = await crearMateria(carreraLaeId, `ZZZ ${randomUUID().slice(0, 6)}`, 1);
    const matA = await crearMateria(carreraLaeId, `AAA ${randomUUID().slice(0, 6)}`, 1);
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
    const mat1 = await crearMateria(carreraLaeId, `M1 ${randomUUID().slice(0, 6)}`, 1);
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
    const matMerida = await crearMateria(carreraLaeId, `MID ${randomUUID().slice(0, 6)}`, 1);
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
    expect(
      data.flatMap((g) => g.materias.map((m) => m.id)),
    ).not.toContain(matVlld);
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
```

- [ ] **Step 2: Correr el spec y verificar que falla**

Run: `cd App/backend && pnpm test:e2e perfil-asignaciones`
Expected: FAIL — `/perfil/asignaciones` no existe (404 en los casos 200; 403/401 podrían pasar por accidente pero la mayoría falla).

- [ ] **Step 3: Implementar `PerfilService.obtenerAsignacionesPropias`**

En `App/backend/src/perfil/perfil.service.ts`, agregar a la clase `PerfilService`
(después de `obtenerCompanerosDeGrupo`), con JSDoc breve:

```ts
  /**
   * `GET /perfil/asignaciones` — Fase 12, Día 34. Grupos y materias que el
   * maestro autenticado tiene asignados (`GrupoMateriaMaestro`), agrupados
   * por grupo. Solo `MAESTRO` (el `RolesGuard(@Roles(MAESTRO))` a nivel de
   * método en `PerfilController` ya lo garantiza).
   *
   * Aislamiento por sede: implícito y total — se parte del `PerfilMaestro`
   * del actor y se navega solo por sus `GrupoMateriaMaestro`; nunca se
   * consulta `Grupo` por `sedeId` desde afuera.
   *
   * Orden: grupos por `anioInicio desc, cicloActual desc, nombre asc`;
   * `materias` por `nombre asc`.
   */
  async obtenerAsignacionesPropias(actorUsuarioId: string) {
    const perfilMaestro = await this.prisma.perfilMaestro.findUnique({
      where: { usuarioId: actorUsuarioId },
      select: { id: true },
    });

    if (!perfilMaestro) {
      // Defensivo — el `RolesGuard` ya garantizó rol MAESTRO, y la alta
      // transaccional (regla 9) garantiza que un MAESTRO siempre tiene su
      // PerfilMaestro. Si llega acá es inconsistencia de datos. Regla 12 —
      // loguear antes de responder.
      console.error(
        '[PerfilService.obtenerAsignacionesPropias] Actor MAESTRO sin PerfilMaestro — inconsistencia de datos:',
        { actorUsuarioId },
      );
      throw new NotFoundException({
        error: 'No se encontró el perfil de maestro del usuario autenticado',
        code: 'NOT_FOUND',
      });
    }

    const filas = await this.prisma.grupoMateriaMaestro.findMany({
      where: { maestroId: perfilMaestro.id },
      orderBy: [
        { grupo: { anioInicio: 'desc' } },
        { grupo: { cicloActual: 'desc' } },
        { grupo: { nombre: 'asc' } },
        { materia: { nombre: 'asc' } },
      ],
      select: {
        grupo: {
          select: {
            id: true,
            nombre: true,
            anioInicio: true,
            cicloActual: true,
            carrera: { select: { id: true, nombre: true } },
            salon: { select: { id: true, nombre: true } },
          },
        },
        materia: { select: { id: true, nombre: true, ciclo: true } },
      },
    });

    // Agrupar por grupo preservando el orden de llegada (ya ordenado por
    // grupo y luego por materia.nombre).
    const porGrupo = new Map<
      string,
      {
        grupoId: string;
        nombre: string;
        anioInicio: number;
        cicloActual: number;
        carrera: { id: string; nombre: string };
        salon: { id: string; nombre: string };
        materias: { id: string; nombre: string; ciclo: number }[];
      }
    >();

    for (const { grupo, materia } of filas) {
      let entrada = porGrupo.get(grupo.id);
      if (!entrada) {
        entrada = {
          grupoId: grupo.id,
          nombre: grupo.nombre,
          anioInicio: grupo.anioInicio,
          cicloActual: grupo.cicloActual,
          carrera: grupo.carrera,
          salon: grupo.salon,
          materias: [],
        };
        porGrupo.set(grupo.id, entrada);
      }
      entrada.materias.push(materia);
    }

    return [...porGrupo.values()];
  }
```

Si `orderBy` por relación anidada (`{ grupo: { anioInicio: 'desc' } }` / `{ materia:
{ nombre: 'asc' } }`) no compilara con la versión de Prisma 6.x del repo (no debería —
`obtenerCompanerosDeGrupo` Día 32 y `listarAsignaciones` Día 33 usan el mismo patrón),
usar `orderBy` simple y ordenar en memoria (grupos y `materias`) con comparadores
explícitos que reproduzcan el mismo orden.

- [ ] **Step 4: Implementar el método del controller**

En `App/backend/src/perfil/perfil.controller.ts`, agregar debajo de `obtenerCompaneros`:

```ts
  @Get('asignaciones')
  @UseGuards(RolesGuard)
  @Roles(RolUsuario.MAESTRO)
  async obtenerAsignaciones(@ActorUsuarioId() actorUsuarioId: string) {
    const data =
      await this.perfilService.obtenerAsignacionesPropias(actorUsuarioId);
    return { data };
  }
```

Actualizar el JSDoc de la clase `PerfilController` para mencionar
`GET /perfil/asignaciones` (MAESTRO-only) junto a `malla`/`grupo/companeros`.

- [ ] **Step 5: Correr el spec y verificar que pasa**

Run: `cd App/backend && pnpm test:e2e perfil-asignaciones`
Expected: PASS — los 8 casos en verde.

- [ ] **Step 6: Suite e2e completa + build**

Run: `cd App/backend && pnpm test:e2e`
Expected: PASS — todas las suites (crece en 1 archivo).

Run: `cd App/backend && pnpm build && npx eslint "src/perfil/**/*.ts" "test/perfil-asignaciones.e2e-spec.ts"`
Expected: sin errores de tipos ni de lint. (NO `pnpm lint`.)

- [ ] **Step 7: Documentar en `CLAUDE.md`**

En `C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp/CLAUDE.md`, sección "Contrato de
API", agregar después de la entrada de `GET /perfil/grupo/companeros`:

```
- `GET /perfil/asignaciones` (Fase 12, Día 34) — grupos y materias que el
  maestro autenticado tiene asignados (`GrupoMateriaMaestro`), agrupados por
  grupo. `SedeGuard` (clase) + `RolesGuard` a nivel de MÉTODO + `@Roles(MAESTRO)`
  (mismo patrón que `GET /perfil/malla` / `GET /perfil/grupo/companeros`).
  Actor de `@ActorUsuarioId()`, sin `:id`/query. Sin paginación. Sin código de
  error nuevo — `404 NOT_FOUND` defensivo (actor MAESTRO sin `PerfilMaestro`),
  `403 ROL_NO_AUTORIZADO` (alumno/administrativo), `401`. Éxito: `200 { data:
  GrupoConMaterias[] }` con `GrupoConMaterias = { grupoId, nombre, anioInicio,
  cicloActual, carrera: {id,nombre}, salon: {id,nombre}, materias: { id, nombre,
  ciclo }[] }`. Grupos por `anioInicio desc, cicloActual desc, nombre asc`;
  `materias` por `nombre asc`. Maestro sin asignaciones → `{ data: [] }`.
  Aislamiento cross-sede estructural (se parte del `PerfilMaestro` del actor).
```

- [ ] **Step 8: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/backend/src/perfil/perfil.controller.ts App/backend/src/perfil/perfil.service.ts App/backend/test/perfil-asignaciones.e2e-spec.ts CLAUDE.md
git commit -m "$(cat <<'EOF'
feat(perfil): GET /perfil/asignaciones — grupos y materias del maestro (Día 34)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017iN4GYdSAc7Xoa78CyaaWc
EOF
)"
```

---

### Task 2: Frontend admin — sección de asignaciones en el detalle de grupo

**Files:**
- Create: `App/frontend/src/lib/api/materias.ts`
- Modify: `App/frontend/src/lib/api/grupos.ts` (3 funciones + `AsignacionListItem` + `GrupoMateriaMaestro`)
- Create: `App/frontend/src/app/admin/grupos/[id]/SeccionAsignaciones.tsx`
- Create: `App/frontend/src/app/admin/grupos/[id]/AgregarMateriaModal.tsx`
- Create: `App/frontend/src/app/admin/grupos/[id]/ConfirmarQuitarAsignacionModal.tsx`
- Modify: `App/frontend/src/app/admin/grupos/[id]/page.tsx` (render `<SeccionAsignaciones grupo={grupo} />`)

**Interfaces:**
- Consumes: `apiFetchAuth` de `@/lib/api/http`; `useQuery`/`useMutation`/`useQueryClient` de `@tanstack/react-query`; `ApiError` de `@/lib/api/http`; `listarMaestros` + `type PersonaListItemMaestro` de `@/lib/api/personas` (existe, Día 19 — devuelve `Promise<ApiListaPaginada<PersonaListItemMaestro>>`, `PersonaListItemMaestro = { usuarioId, nombres, apellidoPaterno, apellidoMaterno, cedulaProfesional, estatus, tipoLicencia, activo }`); `type GrupoListItem` de `@/lib/api/grupos` (`{ id, nombre, anioInicio, cicloActual, capacidad, carrera: {id,nombre}, salon: {id,nombre} }`); helpers `INPUT_CLASS`/`LABEL_CLASS` de `@/components/admin/ui/persona-alta/estilos`; `resolverMensajeError`/`MENSAJE_ERROR_GENERICO` de `@/components/admin/ui/persona-alta/mensajes-error`; `toast` de `sonner`; `Select` de `@/components/admin/ui/persona-alta/Select` (`{ id, disabled, value, onChange(value:string), options: {value,label}[], placeholder }`).
- Consumes del backend: `GET /materias?carreraId=&ciclo=` (Día 33), `GET/POST/DELETE /grupos/:id/asignaciones` (Día 33), `POST /materias` (Día 33).
- Produces: nada que otra task consuma (los tipos son para uso propio + Task 3 mantiene su propio espejo).

- [ ] **Step 1: Crear `lib/api/materias.ts`**

```ts
import { apiFetchAuth } from './http';

/**
 * `GET/POST /materias` — Fase 12, Día 33 (backend) / Día 34 (frontend).
 *
 * Shape espejo de `MateriasService` (`App/backend/src/materias/`) — mantener
 * en sync a mano, mismo criterio que `lib/api/carreras.ts`/`lib/api/grupos.ts`.
 * `sedeId` NUNCA es parámetro (el backend lo saca del JWT, regla 2).
 * `GET /materias` acá siempre se llama con `carreraId` + `ciclo` (la sección
 * de asignaciones del detalle de grupo, único consumidor).
 */
export interface Materia {
  id: string;
  nombre: string;
  carreraId: string;
  ciclo: number;
}

export interface CrearMateriaInput {
  nombre: string;
  carreraId: string;
  ciclo: number;
}

export function listarMaterias(
  carreraId: string,
  ciclo: number,
): Promise<Materia[]> {
  const query = `?carreraId=${encodeURIComponent(carreraId)}&ciclo=${ciclo}`;
  return apiFetchAuth<Materia[]>(`/materias${query}`);
}

export function crearMateria(input: CrearMateriaInput): Promise<Materia> {
  return apiFetchAuth<Materia>('/materias', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
```

- [ ] **Step 2: Extender `lib/api/grupos.ts`**

Al final de `App/frontend/src/lib/api/grupos.ts`, agregar:

```ts
/**
 * `AsignacionListItem` — espejo de `App/backend/src/grupos/grupos.service.ts`
 * (Día 33). Lo que devuelve `GET /grupos/:id/asignaciones`.
 */
export interface AsignacionListItem {
  id: string;
  materia: { id: string; nombre: string; ciclo: number };
  maestro: {
    usuarioId: string;
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string | null;
  };
}

/**
 * Fila plana de `GrupoMateriaMaestro` (`schema.prisma`, Día 33) — lo que
 * devuelve `POST /grupos/:id/asignaciones` (`GruposService.asignarMaestro`).
 */
export interface GrupoMateriaMaestro {
  id: string;
  grupoId: string;
  materiaId: string;
  maestroId: string;
  asignadoEn: string;
}

/** `GET /grupos/:id/asignaciones` — Fase 12, Día 33. Sin paginar. */
export function listarAsignaciones(
  grupoId: string,
): Promise<AsignacionListItem[]> {
  return apiFetchAuth<AsignacionListItem[]>(`/grupos/${grupoId}/asignaciones`);
}

/**
 * `POST /grupos/:id/asignaciones` — Fase 12, Día 33. Devuelve la fila
 * `GrupoMateriaMaestro` PLANA. `usuarioId` es un `Usuario.id` de un maestro.
 */
export function asignarMaestro(
  grupoId: string,
  input: { materiaId: string; usuarioId: string },
): Promise<GrupoMateriaMaestro> {
  return apiFetchAuth<GrupoMateriaMaestro>(`/grupos/${grupoId}/asignaciones`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** `DELETE /grupos/:id/asignaciones/:asignacionId` — Fase 12, Día 33. */
export function eliminarAsignacion(
  grupoId: string,
  asignacionId: string,
): Promise<{ ok: true }> {
  return apiFetchAuth<{ ok: true }>(
    `/grupos/${grupoId}/asignaciones/${asignacionId}`,
    { method: 'DELETE' },
  );
}
```

- [ ] **Step 3: Crear `ConfirmarQuitarAsignacionModal.tsx`**

`App/frontend/src/app/admin/grupos/[id]/ConfirmarQuitarAsignacionModal.tsx` — calco
estructural de `ConfirmarQuitarAlumnoModal.tsx`:

```tsx
'use client';

import type { AsignacionListItem } from '@/lib/api/grupos';

interface ConfirmarQuitarAsignacionModalProps {
  asignacion: AsignacionListItem;
  quitando: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}

/**
 * Modal de confirmación local a `app/admin/grupos/[id]/` — copia estructural
 * de `./ConfirmarQuitarAlumnoModal.tsx`, adaptada a `AsignacionListItem`.
 * Sin import cruzado (regla 11, modal local por sección).
 */
export function ConfirmarQuitarAsignacionModal({
  asignacion,
  quitando,
  onConfirmar,
  onCancelar,
}: ConfirmarQuitarAsignacionModalProps) {
  const nombreMaestro = [
    asignacion.maestro.apellidoPaterno,
    asignacion.maestro.apellidoMaterno,
    asignacion.maestro.nombres,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-slate">
          Quitar maestro de la materia
        </h2>
        <p className="mt-2 text-sm text-slate/80">
          ¿Quitar a <strong>{nombreMaestro}</strong> de la materia{' '}
          <strong>{asignacion.materia.nombre}</strong>? Podrás volver a
          asignarlo después.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancelar}
            disabled={quitando}
            className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={quitando}
            className="rounded-lg bg-crimson px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-crimson/90 disabled:opacity-50"
          >
            {quitando ? 'Quitando…' : 'Quitar'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Crear `AgregarMateriaModal.tsx`**

`App/frontend/src/app/admin/grupos/[id]/AgregarMateriaModal.tsx` — form-modal minimal,
patrón de `../NuevoGrupoModal.tsx` pero de un solo campo. La mutación la maneja el
padre (`SeccionAsignaciones`); este modal solo captura `nombre`.

```tsx
'use client';

import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import {
  INPUT_CLASS,
  LABEL_CLASS,
} from '@/components/admin/ui/persona-alta/estilos';

interface AgregarMateriaModalProps {
  carreraNombre: string;
  ciclo: number;
  guardando: boolean;
  /** Error de la última mutación fallida (ej. nombre duplicado). `null` si no hay. */
  errorMensaje: string | null;
  onCrear: (nombre: string) => void;
  onCancelar: () => void;
}

/**
 * Modal "+ Nueva materia" local a `app/admin/grupos/[id]/` (regla 11). Solo
 * campo `nombre` — `ciclo` es fijo (= `grupo.cicloActual`) y la carrera sale
 * del grupo; ambos se muestran como texto. `POST /materias` lo dispara el
 * padre (`SeccionAsignaciones`).
 */
export function AgregarMateriaModal({
  carreraNombre,
  ciclo,
  guardando,
  errorMensaje,
  onCrear,
  onCancelar,
}: AgregarMateriaModalProps) {
  const [nombre, setNombre] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) {
      toast.error('El nombre de la materia es requerido.');
      return;
    }
    onCrear(nombre.trim());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-slate">
          Nueva materia
        </h2>
        <p className="mt-1 text-xs text-slate/60">
          Materia de ciclo {ciclo} · {carreraNombre}
        </p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="materia-modal-nombre" className={LABEL_CLASS}>
              Nombre
            </label>
            <input
              id="materia-modal-nombre"
              type="text"
              required
              disabled={guardando}
              className={INPUT_CLASS}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
            {errorMensaje && (
              <p className="mt-1 text-xs text-crimson">{errorMensaje}</p>
            )}
          </div>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onCancelar}
              disabled={guardando}
              className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
            >
              {guardando ? 'Creando…' : 'Crear materia'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Crear `SeccionAsignaciones.tsx`**

`App/frontend/src/app/admin/grupos/[id]/SeccionAsignaciones.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  MENSAJE_ERROR_GENERICO,
  resolverMensajeError,
} from '@/components/admin/ui/persona-alta/mensajes-error';
import { ApiError } from '@/lib/api/http';
import {
  asignarMaestro,
  eliminarAsignacion,
  listarAsignaciones,
  type AsignacionListItem,
  type GrupoListItem,
} from '@/lib/api/grupos';
import { crearMateria, listarMaterias } from '@/lib/api/materias';
import { listarMaestros, type PersonaListItemMaestro } from '@/lib/api/personas';
import { AgregarMateriaModal } from './AgregarMateriaModal';
import { ConfirmarQuitarAsignacionModal } from './ConfirmarQuitarAsignacionModal';

/**
 * Sección "Materias y maestros" del detalle de grupo — Fase 12, Día 34.
 * Una fila por materia del grupo (carrera + ciclo del grupo). Cada fila:
 * los maestros ya asignados como chips con "×" (confirmación por modal) + un
 * `<select>` de los maestros aún NO asignados a esa materia + "Agregar".
 * Botón "+ Nueva materia" en el encabezado. Co-docencia permitida (backend
 * Día 33) — varios maestros por materia.
 *
 * Regla 11: todo en `app/admin/grupos/[id]/`, modales locales, sin
 * componentes compartidos con `app/maestro/`/`app/alumno/`.
 * Regla 12: `console.error` en cada catch (queries y mutaciones).
 */
export function SeccionAsignaciones({ grupo }: { grupo: GrupoListItem }) {
  const queryClient = useQueryClient();
  const [asignacionAQuitar, setAsignacionAQuitar] =
    useState<AsignacionListItem | null>(null);
  const [modalMateriaAbierto, setModalMateriaAbierto] = useState(false);
  const [errorNuevaMateria, setErrorNuevaMateria] = useState<string | null>(
    null,
  );
  // materiaId cuyo <select> tiene una selección pendiente de "Agregar".
  const [seleccionPorMateria, setSeleccionPorMateria] = useState<
    Record<string, string>
  >({});

  const materiasQuery = useQuery({
    queryKey: ['admin', 'grupos', 'detalle', grupo.id, 'materias'],
    queryFn: async () => {
      try {
        return await listarMaterias(grupo.carrera.id, grupo.cicloActual);
      } catch (err) {
        console.error('[SeccionAsignaciones] Error al listar materias:', err);
        throw err;
      }
    },
  });

  const asignacionesQuery = useQuery({
    queryKey: ['admin', 'grupos', 'detalle', grupo.id, 'asignaciones'],
    queryFn: async () => {
      try {
        return await listarAsignaciones(grupo.id);
      } catch (err) {
        console.error(
          '[SeccionAsignaciones] Error al listar asignaciones:',
          err,
        );
        throw err;
      }
    },
  });

  const maestrosQuery = useQuery({
    queryKey: ['admin', 'maestros', 'para-asignar'],
    queryFn: async () => {
      try {
        return await listarMaestros({ limit: 100 });
      } catch (err) {
        console.error('[SeccionAsignaciones] Error al listar maestros:', err);
        throw err;
      }
    },
  });

  const maestros: PersonaListItemMaestro[] = maestrosQuery.data?.data ?? [];
  const asignaciones = asignacionesQuery.data ?? [];
  const materias = materiasQuery.data ?? [];

  const invalidarAsignaciones = () =>
    void queryClient.invalidateQueries({
      queryKey: ['admin', 'grupos', 'detalle', grupo.id, 'asignaciones'],
    });

  const asignarMutation = useMutation({
    mutationFn: (input: { materiaId: string; usuarioId: string }) =>
      asignarMaestro(grupo.id, input),
    onSuccess: (_data, input) => {
      toast.success('Maestro asignado');
      setSeleccionPorMateria((prev) => {
        const next = { ...prev };
        delete next[input.materiaId];
        return next;
      });
      invalidarAsignaciones();
    },
    onError: (err) => {
      console.error('[SeccionAsignaciones] Error al asignar maestro:', err);
      if (
        err instanceof ApiError &&
        ['VALIDATION_ERROR', 'CONFLICT', 'NOT_FOUND'].includes(err.code)
      ) {
        toast.error(err.message);
        return;
      }
      toast.error(MENSAJE_ERROR_GENERICO);
    },
  });

  const quitarMutation = useMutation({
    mutationFn: (asignacionId: string) =>
      eliminarAsignacion(grupo.id, asignacionId),
    onSuccess: () => {
      toast.success('Maestro quitado de la materia');
      setAsignacionAQuitar(null);
      invalidarAsignaciones();
    },
    onError: (err) => {
      console.error('[SeccionAsignaciones] Error al quitar asignación:', err);
      toast.error(resolverMensajeError(err) ?? MENSAJE_ERROR_GENERICO);
      setAsignacionAQuitar(null);
    },
  });

  const crearMateriaMutation = useMutation({
    mutationFn: (nombre: string) =>
      crearMateria({
        nombre,
        carreraId: grupo.carrera.id,
        ciclo: grupo.cicloActual,
      }),
    onSuccess: () => {
      toast.success('Materia creada');
      setModalMateriaAbierto(false);
      setErrorNuevaMateria(null);
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'grupos', 'detalle', grupo.id, 'materias'],
      });
    },
    onError: (err) => {
      console.error('[SeccionAsignaciones] Error al crear materia:', err);
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        setErrorNuevaMateria(err.message);
        return;
      }
      setErrorNuevaMateria(
        err instanceof ApiError ? err.message : MENSAJE_ERROR_GENERICO,
      );
    },
  });

  // asignaciones por materiaId, para no recomputar en cada fila.
  const asignacionesPorMateria = useMemo(() => {
    const map = new Map<string, AsignacionListItem[]>();
    for (const a of asignaciones) {
      const arr = map.get(a.materia.id) ?? [];
      arr.push(a);
      map.set(a.materia.id, arr);
    }
    return map;
  }, [asignaciones]);

  const nombreMaestro = (m: {
    apellidoPaterno: string;
    apellidoMaterno: string | null;
    nombres: string;
  }) =>
    [m.apellidoPaterno, m.apellidoMaterno].filter(Boolean).join(' ') +
    `, ${m.nombres}`;

  return (
    <div className="rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-navy">
          Materias y maestros
        </h2>
        <button
          type="button"
          onClick={() => {
            setErrorNuevaMateria(null);
            setModalMateriaAbierto(true);
          }}
          className="rounded-lg border border-navy px-3 py-1.5 text-sm font-medium text-navy hover:bg-navy/5"
        >
          + Nueva materia
        </button>
      </div>

      {(materiasQuery.isLoading ||
        asignacionesQuery.isLoading ||
        maestrosQuery.isLoading) && (
        <p className="mt-4 text-sm text-slate/60">Cargando…</p>
      )}

      {(materiasQuery.isError ||
        asignacionesQuery.isError ||
        maestrosQuery.isError) && (
        <p className="mt-4 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-crimson">
          No se pudo cargar la información de materias y maestros. Intenta de
          nuevo más tarde.
        </p>
      )}

      {!materiasQuery.isLoading &&
        !materiasQuery.isError &&
        materias.length === 0 && (
          <div className="mt-4 rounded-lg border border-mist bg-bone/60 p-4 text-sm text-slate/70">
            Este grupo no tiene materias registradas para el ciclo{' '}
            {grupo.cicloActual} de {grupo.carrera.nombre}. Usa{' '}
            <strong>+ Nueva materia</strong> para crear la primera.
          </div>
        )}

      {!materiasQuery.isLoading &&
        !materiasQuery.isError &&
        !asignacionesQuery.isError &&
        !maestrosQuery.isError &&
        materias.length > 0 && (
          <ul className="mt-4 divide-y divide-mist">
            {materias.map((materia) => {
              const asignadas = asignacionesPorMateria.get(materia.id) ?? [];
              const idsAsignados = new Set(
                asignadas.map((a) => a.maestro.usuarioId),
              );
              const disponibles = maestros.filter(
                (m) => !idsAsignados.has(m.usuarioId),
              );
              const seleccion = seleccionPorMateria[materia.id] ?? '';
              const filaOcupada =
                asignarMutation.isPending &&
                asignarMutation.variables?.materiaId === materia.id;

              return (
                <li key={materia.id} className="py-4">
                  <p className="text-sm font-medium text-slate">
                    {materia.nombre}
                  </p>
                  <p className="text-xs text-slate/50">Ciclo {materia.ciclo}</p>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {asignadas.length === 0 ? (
                      <span className="text-xs text-slate/50">
                        Sin maestro asignado.
                      </span>
                    ) : (
                      asignadas.map((a) => (
                        <span
                          key={a.id}
                          className="inline-flex items-center gap-1.5 rounded-full bg-mist px-2.5 py-1 text-xs text-navy"
                        >
                          {nombreMaestro(a.maestro)}
                          <button
                            type="button"
                            aria-label={`Quitar a ${nombreMaestro(a.maestro)}`}
                            onClick={() => setAsignacionAQuitar(a)}
                            className="text-crimson hover:text-crimson/70"
                          >
                            ×
                          </button>
                        </span>
                      ))
                    )}
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    {disponibles.length === 0 ? (
                      <span className="text-xs text-slate/50">
                        Todos los maestros ya están asignados a esta materia.
                      </span>
                    ) : (
                      <>
                        <select
                          value={seleccion}
                          disabled={filaOcupada || maestrosQuery.isError}
                          onChange={(e) =>
                            setSeleccionPorMateria((prev) => ({
                              ...prev,
                              [materia.id]: e.target.value,
                            }))
                          }
                          className="rounded-lg border border-mist px-2 py-1 text-sm text-slate disabled:opacity-50"
                        >
                          <option value="">Agregar maestro…</option>
                          {disponibles.map((m) => (
                            <option key={m.usuarioId} value={m.usuarioId}>
                              {nombreMaestro(m)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={!seleccion || filaOcupada}
                          onClick={() =>
                            asignarMutation.mutate({
                              materiaId: materia.id,
                              usuarioId: seleccion,
                            })
                          }
                          className="rounded-lg bg-navy px-3 py-1 text-sm font-medium text-white hover:bg-navy-deep disabled:opacity-50"
                        >
                          {filaOcupada ? 'Agregando…' : 'Agregar'}
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

      {modalMateriaAbierto && (
        <AgregarMateriaModal
          carreraNombre={grupo.carrera.nombre}
          ciclo={grupo.cicloActual}
          guardando={crearMateriaMutation.isPending}
          errorMensaje={errorNuevaMateria}
          onCrear={(nombre) => crearMateriaMutation.mutate(nombre)}
          onCancelar={() => {
            setModalMateriaAbierto(false);
            setErrorNuevaMateria(null);
          }}
        />
      )}

      {asignacionAQuitar && (
        <ConfirmarQuitarAsignacionModal
          asignacion={asignacionAQuitar}
          quitando={quitarMutation.isPending}
          onConfirmar={() => quitarMutation.mutate(asignacionAQuitar.id)}
          onCancelar={() => setAsignacionAQuitar(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Renderizar la sección en el detalle de grupo**

En `App/frontend/src/app/admin/grupos/[id]/page.tsx`:
- Agregar el import: `import { SeccionAsignaciones } from './SeccionAsignaciones';`
- En el JSX, después del bloque `{/* Tabla de matriculados */}` (el `<div className="rounded-lg border-l-4 border-navy bg-white shadow-sm">` que cierra la tabla) y ANTES de los modales (`{alumnoAConfirmar && ...}`), agregar:

```tsx
      {grupo && <SeccionAsignaciones grupo={grupo} />}
```

- [ ] **Step 7: Typecheck + build del frontend**

Run: `cd App/frontend && pnpm build`
Expected: build exitoso, sin errores de TypeScript.

- [ ] **Step 8: Lint puntual**

Run: `cd App/frontend && npx eslint "src/lib/api/materias.ts" "src/lib/api/grupos.ts" "src/app/admin/grupos/[id]/SeccionAsignaciones.tsx" "src/app/admin/grupos/[id]/AgregarMateriaModal.tsx" "src/app/admin/grupos/[id]/ConfirmarQuitarAsignacionModal.tsx" "src/app/admin/grupos/[id]/page.tsx"`
Expected: sin errores. (NO `pnpm lint`.)

- [ ] **Step 9: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/frontend/src/lib/api/materias.ts App/frontend/src/lib/api/grupos.ts "App/frontend/src/app/admin/grupos/[id]/SeccionAsignaciones.tsx" "App/frontend/src/app/admin/grupos/[id]/AgregarMateriaModal.tsx" "App/frontend/src/app/admin/grupos/[id]/ConfirmarQuitarAsignacionModal.tsx" "App/frontend/src/app/admin/grupos/[id]/page.tsx"
git commit -m "$(cat <<'EOF'
feat(admin): asignar/quitar maestros a materias del grupo + crear materia (Día 34)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017iN4GYdSAc7Xoa78CyaaWc
EOF
)"
```

---

### Task 3: Frontend maestro — sección "Mis grupos y materias"

**Files:**
- Modify: `App/frontend/src/lib/api/perfil.ts` (tipos + `obtenerMisAsignaciones`)
- Modify: `App/frontend/src/app/maestro/page.tsx` (componente `SeccionAsignaciones` local + wiring)

**Interfaces:**
- Consumes: `apiFetchAuth` de `./http` (ya usado en `perfil.ts`); `useQuery` de `@tanstack/react-query` (ya importado en `maestro/page.tsx`); `ApiError` de `@/lib/api/http` (ya importado en `maestro/page.tsx`); `obtenerMisAsignaciones` + tipos (nuevos en `perfil.ts`).
- Consumes del backend (Task 1): `GET /perfil/asignaciones` → `{ data: GrupoConMaterias[] }`.
- Produces: nada (fin de cadena).

- [ ] **Step 1: Agregar tipos + cliente en `lib/api/perfil.ts`**

Al final de `App/frontend/src/lib/api/perfil.ts` (después de `obtenerCompaneros` /
lo último que haya):

```ts
/**
 * `GET /perfil/asignaciones` — Fase 12, Día 34.
 *
 * Grupos y materias que el maestro autenticado tiene asignados, agrupados
 * por grupo. Shape espejo exacto de `PerfilService.obtenerAsignacionesPropias`
 * (`App/backend/src/perfil/perfil.service.ts`) — mismo criterio de "mantener
 * en sync a mano" que el resto de este archivo. Solo `MAESTRO`. Array vacío
 * si el maestro no tiene asignaciones.
 */
export interface MateriaAsignada {
  id: string;
  nombre: string;
  ciclo: number;
}

export interface GrupoConMaterias {
  grupoId: string;
  nombre: string;
  anioInicio: number;
  cicloActual: number;
  carrera: { id: string; nombre: string };
  salon: { id: string; nombre: string };
  materias: MateriaAsignada[];
}

export function obtenerMisAsignaciones(): Promise<GrupoConMaterias[]> {
  return apiFetchAuth<GrupoConMaterias[]>('/perfil/asignaciones');
}
```

- [ ] **Step 2: Agregar `SeccionAsignaciones` a `app/maestro/page.tsx`**

En `App/frontend/src/app/maestro/page.tsx`:

1. Ampliar el import de `@/lib/api/perfil` (ya trae `obtenerPerfil`, `type ContactoMaestro`, `type Perfil`, `type PerfilMaestro`) para incluir `obtenerMisAsignaciones`, `type GrupoConMaterias`.
2. En `PerfilContenido`, dentro del `<div className="mt-6 space-y-6">`, agregar
   `<SeccionAsignaciones />` después de `<SeccionContactos maestro={perfil.maestro} />`.
3. Agregar el componente al archivo (junto a las otras `Seccion*`):

```tsx
/**
 * Mis grupos y materias asignadas — Fase 12, Día 34. Sección propia con su
 * `useQuery` contra `GET /perfil/asignaciones` (`lib/api/perfil.ts`). Solo
 * lectura, agrupada por grupo. Regla 11: árbol `app/maestro/` propio, sin
 * componentes de admin. Regla 12: `console.error` en el catch del `queryFn`.
 */
function SeccionAsignaciones() {
  const {
    data: grupos,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['maestro', 'asignaciones'],
    queryFn: async () => {
      try {
        return await obtenerMisAsignaciones();
      } catch (err) {
        console.error(
          '[MaestroAsignaciones] Error al obtener asignaciones:',
          err,
        );
        throw err;
      }
    },
  });

  return (
    <section className="rounded-lg border border-mist p-5">
      <h2 className="text-sm font-semibold text-navy">Mis grupos y materias</h2>

      {isLoading && <p className="mt-3 text-sm text-slate/60">Cargando…</p>}

      {isError && (
        <p className="mt-3 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-crimson">
          {error instanceof ApiError
            ? error.message
            : 'No se pudieron cargar tus asignaciones. Intenta de nuevo más tarde.'}
        </p>
      )}

      {!isLoading && !isError && grupos && grupos.length === 0 && (
        <p className="mt-3 text-sm text-slate/60">
          Aún no tienes materias asignadas.
        </p>
      )}

      {!isLoading && !isError && grupos && grupos.length > 0 && (
        <div className="mt-3 space-y-4">
          {grupos.map((grupo) => (
            <GrupoAsignado key={grupo.grupoId} grupo={grupo} />
          ))}
        </div>
      )}
    </section>
  );
}

function GrupoAsignado({ grupo }: { grupo: GrupoConMaterias }) {
  return (
    <div className="rounded-lg border border-mist bg-bone/60 p-4">
      <h3 className="text-sm font-semibold text-navy">{grupo.nombre}</h3>
      <p className="mt-0.5 text-xs text-slate/60">
        {grupo.carrera.nombre} · {grupo.anioInicio}-{grupo.cicloActual} · Salón{' '}
        {grupo.salon.nombre}
      </p>
      {grupo.materias.length === 0 ? (
        <p className="mt-3 text-sm text-slate/60">
          Sin materias asignadas en este grupo.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-mist">
          {grupo.materias.map((materia) => (
            <li key={materia.id} className="py-2 first:pt-0 last:pb-0">
              <p className="text-sm font-medium text-slate">{materia.nombre}</p>
              <p className="text-xs text-slate/50">Ciclo {materia.ciclo}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + build del frontend**

Run: `cd App/frontend && pnpm build`
Expected: build exitoso, sin errores de TypeScript.

- [ ] **Step 4: Lint puntual**

Run: `cd App/frontend && npx eslint "src/lib/api/perfil.ts" "src/app/maestro/page.tsx"`
Expected: sin errores. (NO `pnpm lint`.)

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/frontend/src/lib/api/perfil.ts App/frontend/src/app/maestro/page.tsx
git commit -m "$(cat <<'EOF'
feat(maestro): sección "Mis grupos y materias" en el perfil del maestro (Día 34)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017iN4GYdSAc7Xoa78CyaaWc
EOF
)"
```

---

### Task 4: Cierre — QA y estado (cierra Fase 12)

**Files:**
- Modify: `documentacion_de_agentes/ESTADO.md` (sección Día 34)
- Modify: `docs/roadmap.md` (tachar Día 34 + **FASE 12 — COMPLETA**)
- Modify: `C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp/CLAUDE.md` (línea "Fase actual")

**Interfaces:**
- Consumes: veredictos de `qa-backend` (endpoint), `qa-alumno` (vista del maestro — el agente `alumno`/`qa-alumno` cubre alumno y maestro), `qa-admin` (sección de asignaciones).

- [ ] **Step 1: QA backend**

Dispatch `qa-backend` para auditar `GET /perfil/asignaciones` (`PerfilController`/
`PerfilService` + e2e) contra las reglas de `CLAUDE.md` raíz. Consigna veredicto en
`ESTADO.md`. No corrige código.

- [ ] **Step 2: QA de la vista del maestro**

Dispatch `qa-alumno` para auditar la sección "Mis grupos y materias"
(`app/maestro/page.tsx`, `lib/api/perfil.ts`) contra las reglas. Consigna veredicto en
`ESTADO.md`.

- [ ] **Step 3: QA de la sección de asignaciones (admin)**

Dispatch `qa-admin` para auditar `SeccionAsignaciones` + 2 modales +
`lib/api/materias.ts` + fns de `lib/api/grupos.ts` + wiring en
`app/admin/grupos/[id]/page.tsx` contra las reglas. Consigna veredicto en `ESTADO.md`.

- [ ] **Step 4: Corregir hallazgos bloqueantes (si los hay)**

Si algún QA reporta hallazgos bloqueantes: ronda de fix con el `*-coder` del dominio,
re-verificar (`pnpm test:e2e perfil-asignaciones` / `pnpm build` de frontend), volver a
QA. Observaciones menores/parked se consignan y se sigue.

- [ ] **Step 5: Marcar estado**

- `ESTADO.md`: sección nueva `### Día 34 — UI de asignación + vista para maestro — ✅
  CERRADO EN CÓDIGO (2026-08-28)` siguiendo el formato de las secciones Día 30-33:
  **Backend** (`GET /perfil/asignaciones`), **Frontend admin** (`SeccionAsignaciones` +
  2 modales + `lib/api/materias.ts` + fns de `grupos.ts` + "+ Nueva materia"),
  **Frontend maestro** (sección en `app/maestro/page.tsx`), **Fuera de alcance**,
  **Verificación** (`perfil-asignaciones` e2e, suite completa, builds + eslint puntual;
  "verificación manual en navegador PENDIENTE a cargo del usuario: admin asigna/quita/
  crea materia en el detalle de un grupo de ciclo 1 → el maestro lo ve en su perfil"),
  y `- **Fase 12 — Maestro por materia: COMPLETA** (Días 33-34).` + links spec/plan.
- `docs/roadmap.md`: tachar "Día 34 — UI de asignación + vista para maestro" y marcar
  **FASE 12 — Maestro por materia: COMPLETA (2026-08-28)** en el header (misma
  convención que FASE 7/9/10/11).
- `CLAUDE.md` raíz: actualizar la línea/párrafo "Fase actual" — Fase 12 completa
  (Días 33-34), siguiente Fase 13 (Días 35-37, QA final y despliegue). Mantener la nota
  de infra de `prisma migrate dev` y el `migrate deploy` pendiente en prod (art. 53 +
  `20260828232716_grupo_materia_maestro`).

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add documentacion_de_agentes/ESTADO.md docs/roadmap.md CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: cierre Día 34 — UI de asignación + vista del maestro (Fase 12 completa)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017iN4GYdSAc7Xoa78CyaaWc
EOF
)"
```

- [ ] **Step 7: Verificación manual en navegador (usuario)**

Pendiente para el usuario: entrar como `ADMINISTRATIVO`, ir al detalle de un grupo de
ciclo 1 → ver las materias sembradas → agregar un maestro a una materia → quitarlo con
el modal → "+ Nueva materia" (crear una) → agregarle un maestro; luego entrar como ese
maestro → "Mi perfil" → confirmar que el grupo y la materia aparecen en "Mis grupos y
materias". Luego push a `origin/dev` (junto con Días 33-34) + `prisma migrate deploy` en
prod antes de tocar `main`.

---

## Self-Review

**1. Spec coverage:**
- `GET /perfil/asignaciones` (guards de método MAESTRO, actor, shape, orden, 0→[], cross-sede estructural, códigos) → Task 1 Steps 1, 3, 4, 7. ✓
- Lógica backend (`obtenerAsignacionesPropias`, consulta anidada, agrupado en JS, defensivo 404) → Task 1 Step 3. ✓
- UI admin: `SeccionAsignaciones` (fila por materia, chips de maestros + quitar, `<select>` de disponibles + Agregar, co-docencia), `AgregarMateriaModal` (nombre; ciclo fijo), `ConfirmarQuitarAsignacionModal`, `lib/api/materias.ts`, 3 fns en `grupos.ts`, wiring en el page → Task 2 Steps 1-6. ✓
- Estado vacío de materias con hint + "+ Nueva materia" → Task 2 Step 5. ✓
- UI maestro: `obtenerMisAsignaciones` + tipos en `perfil.ts`, sección en `app/maestro/page.tsx` con loading/error/vacío, tarjeta por grupo + `<ul>` de materias → Task 3 Steps 1-2. ✓
- Pruebas e2e (8 casos: 1 grupo/2 materias, 2 grupos, 0→[], co-docencia, cross-sede, ALUMNO 403, ADMINISTRATIVO 403, sin token 401) → Task 1 Step 1. ✓
- Pruebas frontend (build + eslint puntual + manual) → Task 2 Steps 7-8, Task 3 Steps 3-4, Task 4 Step 7. ✓
- Fuera de alcance (PATCH/DELETE materias, CRUD materias, alumnos del maestro, editar asignación, `/perfil/asignaciones` para otros roles, conteo de alumnos, autocomplete) → respetado, ningún task los añade. ✓
- Ejecución SDD (backend-coder / admin-coder / alumno-coder / QA triple + tachar roadmap + CLAUDE.md Fase actual) → Task 4. ✓

**2. Placeholder scan:** Sin "TBD"/"TODO"/"manejo apropiado". El único condicional abierto (fallback de `orderBy` por relación en Task 1 Step 3) tiene instrucción concreta + precedente (Días 32/33). Todos los bloques de código son completos y copiables. ✓

**3. Type consistency:**
- `GrupoConMaterias` idéntico entre Task 1 (`Produces` + Step 3 tipo interno + Step 7 doc), Task 3 (Step 1 tipo `GrupoConMaterias` + `MateriaAsignada`). Backend usa `materias: { id, nombre, ciclo }[]` inline; frontend lo nombra `MateriaAsignada` — mismo shape, consistente. ✓
- `obtenerMisAsignaciones(): Promise<GrupoConMaterias[]>` consistente entre Task 3 Step 1 y su uso en Step 2. ✓
- `AsignacionListItem` idéntico entre Task 2 Step 2 (`grupos.ts`), Step 3 (`ConfirmarQuitarAsignacionModal` prop), Step 5 (`SeccionAsignaciones` import/uso). Shape = `{ id, materia: {id,nombre,ciclo}, maestro: {usuarioId,nombres,apellidoPaterno,apellidoMaterno} }` — espejo del contrato de Día 33. ✓
- `Materia = { id, nombre, carreraId, ciclo }` idéntico entre Task 2 Step 1 (`materias.ts`) y su uso en `SeccionAsignaciones` (Step 5). ✓
- `listarMaterias(carreraId: string, ciclo: number): Promise<Materia[]>` — firma consistente Step 1 ↔ Step 5. `crearMateria(input: CrearMateriaInput): Promise<Materia>` idem. ✓
- `asignarMaestro(grupoId, { materiaId, usuarioId }): Promise<GrupoMateriaMaestro>`, `eliminarAsignacion(grupoId, asignacionId): Promise<{ ok: true }>`, `listarAsignaciones(grupoId): Promise<AsignacionListItem[]>` — firmas consistentes Step 2 ↔ Step 5. ✓
- `PersonaListItemMaestro` (de `lib/api/personas.ts`, ya existente) — campos usados (`usuarioId`, `nombres`, `apellidoPaterno`, `apellidoMaterno`) verificados contra el archivo real. `listarMaestros({ limit: 100 })` devuelve `ApiListaPaginada<PersonaListItemMaestro>`, se lee `.data`. ✓
- `GrupoListItem` (prop de `SeccionAsignaciones`) — se usa `grupo.id`, `grupo.carrera.id`, `grupo.carrera.nombre`, `grupo.cicloActual`; todos presentes en el tipo real de `lib/api/grupos.ts`. ✓
- `obtenerAsignacionesPropias(actorUsuarioId: string)` — firma idéntica entre service (Task 1 Step 3) y controller (Step 4). ✓
