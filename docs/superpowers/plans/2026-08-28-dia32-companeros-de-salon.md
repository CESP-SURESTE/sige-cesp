# Día 32 — Compañeros de salón — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un alumno ve, desde una sección nueva de su perfil, la lista de compañeros matriculados en su(s) grupo(s), agrupada por grupo.

**Architecture:** Endpoint dedicado `GET /perfil/grupo/companeros` en `PerfilController` (guard `@Roles(ALUMNO)` a nivel de método, copia del patrón de `GET /perfil/malla`). Una sola consulta Prisma anidada resuelve grupos del actor → compañeros por grupo, excluyendo al actor. En el frontend, quinta sección real (`'companeros'`) del sidebar de `app/alumno/page.tsx`, con su propio `useQuery` que dispara al abrir la sección.

**Tech Stack:** NestJS 11 + Prisma 6.x + Supabase (backend); Next.js 16 + React Query 5 + Tailwind 4 (frontend). Tests e2e con Jest + supertest contra la DB real de Supabase.

## Global Constraints

- **`sedeId` jamás del body/query/path** — sale del JWT vía `SedeGuard` / `@ActorUsuarioId()` (regla 2 de `CLAUDE.md` raíz).
- **Nunca persistir datos calculables** — derivar al vuelo (regla 1).
- **Todo catch/error handler loguea antes de responder** — mínimo `console.error` con el error completo, backend y frontend (regla 12).
- **Separación total admin/alumno en frontend** — árboles independientes, sin componentes compartidos (regla 11). Esta feature toca solo `app/alumno/` + `lib/api/`.
- **Contrato de API:** JSON camelCase, fechas ISO 8601. Éxito `{ data: ... }`. Error `{ error, code }` con `code` de la lista fija (`VALIDATION_ERROR`, `NOT_FOUND`, `UNAUTHORIZED`, `CONFLICT`, `SERVER_ERROR`) o de dominio ya existente (`ROL_NO_AUTORIZADO`). **No se crea código nuevo en este día.**
- **No agregar dependencias nuevas** (regla global del usuario).
- **Máximo 3 escrituras reales a la DB si el agente verifica algo a mano** (regla 14). Los tests e2e Jest sí corren completos; su `afterAll` debe limpiar acotado a los `id` creados en la corrida — nunca por patrón de email/nombre.
- **Comandos de test:** backend e2e → `pnpm test:e2e <filtro>` desde `App/backend/` (corre serial, `--runInBand`, contra Supabase real). Frontend typecheck+build → `pnpm build` desde `App/frontend/` (Next corre el chequeo de tipos). Lint → `pnpm lint`.
- **Entorno:** Windows + PowerShell. Rutas con `/` funcionan en el shell Bash disponible.

---

### Task 1: Backend — endpoint `GET /perfil/grupo/companeros`

**Files:**
- Modify: `App/backend/src/perfil/perfil.controller.ts` (agregar método `obtenerCompaneros`)
- Modify: `App/backend/src/perfil/perfil.service.ts` (agregar método `obtenerCompanerosDeGrupo`)
- Test: `App/backend/test/perfil-companeros.e2e-spec.ts` (nuevo)
- Modify: `C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp/CLAUDE.md` (entrada de contrato)

**Interfaces:**
- Consumes: `PrismaService` (ya inyectado en `PerfilService`); decorador `@ActorUsuarioId()`; guards `SedeGuard` (clase), `RolesGuard` + `@Roles()` (`src/common/...`), todos ya importados en `perfil.controller.ts`.
- Produces (lo que el frontend replica en `lib/api/perfil.ts`):

```ts
// Respuesta: 200 { data: GrupoConCompaneros[] }
interface GrupoConCompaneros {
  grupoId: string;
  nombre: string;
  anioInicio: number;
  cicloActual: number;
  carrera: { id: string; nombre: string };
  salon: { id: string; nombre: string };
  companeros: CompaneroItem[];
}
interface CompaneroItem {
  usuarioId: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  matricula: string;
  semestreActual: number;
}
```

- [ ] **Step 1: Escribir el archivo de test e2e (fallará: ruta 404)**

Crear `App/backend/test/perfil-companeros.e2e-spec.ts`. Basar el andamiaje (JWKS de prueba, `SEDE_GUARD_ENV_OVERRIDE`, `firmarToken`, `configureApp`) en `test/perfil.e2e-spec.ts` y `test/grupos-alumnos.e2e-spec.ts`. Fixtures creados por Prisma directo; **`afterAll` limpia por `id` creados** (regla 14).

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
    usuarioIdsCreados.push(usuario.id);
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

  async function inscribir(grupoId: string, alumnoPerfilId: string): Promise<void> {
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
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd App/backend && pnpm test:e2e perfil-companeros`
Expected: FAIL — la ruta `GET /perfil/grupo/companeros` no existe todavía (404 en los casos 200; los `expect(200)` fallan).

- [ ] **Step 3: Implementar `PerfilService.obtenerCompanerosDeGrupo`**

En `App/backend/src/perfil/perfil.service.ts`, agregar el método a la clase `PerfilService` (después de `obtenerPerfilPropio`). Añadir un bloque JSDoc breve arriba explicando: Día 32, Fase 11; solo `ALUMNO`; devuelve todos los grupos del actor con sus compañeros (excluye al actor); regla 4 no aplica literalmente (no es sub-recurso de un perfil ajeno, es la vista del propio alumno). Importar `NotFoundException` ya está.

```ts
async obtenerCompanerosDeGrupo(actorUsuarioId: string) {
  const perfilAlumno = await this.prisma.perfilAlumno.findUnique({
    where: { usuarioId: actorUsuarioId },
    select: { id: true },
  });

  if (!perfilAlumno) {
    // Defensivo — el `RolesGuard(@Roles(ALUMNO))` ya garantizó rol ALUMNO,
    // y la alta transaccional (regla 9) garantiza que un ALUMNO siempre
    // tiene su PerfilAlumno. Si llega acá es inconsistencia de datos.
    // Regla 12 — loguear antes de responder.
    console.error(
      '[PerfilService.obtenerCompanerosDeGrupo] Actor ALUMNO sin PerfilAlumno — inconsistencia de datos:',
      { actorUsuarioId },
    );
    throw new NotFoundException({
      error: 'No se encontró el perfil de alumno del usuario autenticado',
      code: 'NOT_FOUND',
    });
  }

  const inscripciones = await this.prisma.grupoAlumno.findMany({
    where: { alumnoId: perfilAlumno.id },
    orderBy: [
      { grupo: { anioInicio: 'desc' } },
      { grupo: { cicloActual: 'desc' } },
      { grupo: { nombre: 'asc' } },
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
          alumnos: {
            where: { alumnoId: { not: perfilAlumno.id } },
            orderBy: [
              { alumno: { apellidoPaterno: 'asc' } },
              { alumno: { apellidoMaterno: 'asc' } },
              { alumno: { nombres: 'asc' } },
            ],
            select: {
              alumno: {
                select: {
                  usuarioId: true,
                  nombres: true,
                  apellidoPaterno: true,
                  apellidoMaterno: true,
                  matricula: true,
                  semestreActual: true,
                },
              },
            },
          },
        },
      },
    },
  });

  return inscripciones.map(({ grupo }) => ({
    grupoId: grupo.id,
    nombre: grupo.nombre,
    anioInicio: grupo.anioInicio,
    cicloActual: grupo.cicloActual,
    carrera: grupo.carrera,
    salon: grupo.salon,
    companeros: grupo.alumnos.map((ga) => ga.alumno),
  }));
}
```

Si `orderBy` por relación anidada (`{ grupo: { anioInicio: 'desc' } }` o `{ alumno: { ... } }`) no compila / no lo soporta la versión de Prisma 6.x del repo: usar `orderBy` simple donde se pueda y ordenar en memoria tras el `map` con un comparador explícito (arrays chicos). No cambia el contrato.

- [ ] **Step 4: Implementar el método del controller**

En `App/backend/src/perfil/perfil.controller.ts`, agregar debajo de `obtenerUrlDescargaMalla` (mismo patrón: `RolesGuard` + `@Roles(ALUMNO)` a nivel de método):

```ts
@Get('grupo/companeros')
@UseGuards(RolesGuard)
@Roles(RolUsuario.ALUMNO)
async obtenerCompaneros(@ActorUsuarioId() actorUsuarioId: string) {
  const data =
    await this.perfilService.obtenerCompanerosDeGrupo(actorUsuarioId);
  return { data };
}
```

Actualizar el JSDoc de la clase `PerfilController` para mencionar la nueva ruta ALUMNO-only junto a la nota que ya existe sobre `GET /perfil/malla`.

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `cd App/backend && pnpm test:e2e perfil-companeros`
Expected: PASS — los 9 casos en verde.

- [ ] **Step 6: Correr la suite e2e completa (no romper nada)**

Run: `cd App/backend && pnpm test:e2e`
Expected: PASS — todas las suites en verde (la suite crece en 1 archivo). Si `perfil.e2e-spec.ts` u otra falla por interferencia de datos, revisar que el `afterAll` nuevo limpió bien.

- [ ] **Step 7: Build + lint del backend**

Run: `cd App/backend && pnpm build && pnpm lint`
Expected: sin errores de tipos ni de lint.

- [ ] **Step 8: Documentar en `CLAUDE.md`**

En `C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp/CLAUDE.md`, sección "Contrato de API", agregar una entrada después de la de `GET /perfil/malla`:

```
- `GET /perfil/grupo/companeros` (Fase 11, Día 32) — lista de compañeros
  matriculados en el/los grupo(s) del propio alumno. `SedeGuard` (clase) +
  `RolesGuard` a nivel de MÉTODO + `@Roles(ALUMNO)` (mismo patrón que
  `GET /perfil/malla`). Actor de `@ActorUsuarioId()`, sin `:id`/query. Sin
  paginación (catálogo chico). Sin código de error nuevo — `404 NOT_FOUND`
  defensivo (actor ALUMNO sin `PerfilAlumno`), `403 ROL_NO_AUTORIZADO`
  (maestro/administrativo), `401`. Éxito: `200 { data: GrupoConCompaneros[] }`
  con `GrupoConCompaneros = { grupoId, nombre, anioInicio, cicloActual,
  carrera: {id,nombre}, salon: {id,nombre}, companeros: CompaneroItem[] }` y
  `CompaneroItem = { usuarioId, nombres, apellidoPaterno, apellidoMaterno,
  matricula, semestreActual }`. Excluye SOLO al propio actor; NO filtra por
  `Usuario.activo`/`estatusAcademico` (consistente con Día 30). Grupos por
  `anioInicio desc, cicloActual desc, nombre asc`; `companeros` por
  `apellidoPaterno asc, apellidoMaterno asc, nombres asc`. Alumno en 0 grupos
  → `{ data: [] }`; grupo donde es el único → aparece con `companeros: []`.
```

- [ ] **Step 9: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/backend/src/perfil/perfil.controller.ts App/backend/src/perfil/perfil.service.ts App/backend/test/perfil-companeros.e2e-spec.ts CLAUDE.md
git commit -m "$(cat <<'EOF'
feat(perfil): GET /perfil/grupo/companeros — compañeros de salón del alumno (Día 32)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017iN4GYdSAc7Xoa78CyaaWc
EOF
)"
```

---

### Task 2: Frontend — sección "Compañeros" en el perfil del alumno

**Files:**
- Modify: `App/frontend/src/lib/api/perfil.ts` (tipos + `obtenerCompaneros`)
- Modify: `App/frontend/src/app/alumno/page.tsx` (nueva sección + wiring)

**Interfaces:**
- Consumes: `apiFetchAuth` de `./http` (ya usado en el archivo); `useQuery` de `@tanstack/react-query`; `ApiError` de `@/lib/api/http`; helpers ya presentes en `page.tsx` (`Campo`, `nombreCompletoDe`).
- Consumes del backend (Task 1): `GET /perfil/grupo/companeros` → `{ data: GrupoConCompaneros[] }`.
- Produces: nada que otra task consuma (fin de la cadena).

- [ ] **Step 1: Agregar tipos + cliente en `lib/api/perfil.ts`**

Al final de `App/frontend/src/lib/api/perfil.ts`, después de `obtenerUrlDescargaMalla`:

```ts
/**
 * `GET /perfil/grupo/companeros` — Fase 11, Día 32.
 *
 * Compañeros matriculados en el/los grupo(s) del propio alumno, agrupados
 * por grupo. Shape espejo exacto de `PerfilService.obtenerCompanerosDeGrupo`
 * (`App/backend/src/perfil/perfil.service.ts`) — mismo criterio de "mantener
 * en sync a mano" que el resto de este archivo. Excluye al propio alumno.
 * NO filtra por estatus/activo (consistente con Día 30). Array vacío si el
 * alumno no está en ningún grupo; un grupo puede venir con `companeros: []`
 * si es el único inscrito.
 */
export interface CompaneroItem {
  usuarioId: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  matricula: string;
  semestreActual: number;
}

export interface GrupoConCompaneros {
  grupoId: string;
  nombre: string;
  anioInicio: number;
  cicloActual: number;
  carrera: { id: string; nombre: string };
  salon: { id: string; nombre: string };
  companeros: CompaneroItem[];
}

export function obtenerCompaneros(): Promise<GrupoConCompaneros[]> {
  return apiFetchAuth<GrupoConCompaneros[]>('/perfil/grupo/companeros');
}
```

- [ ] **Step 2: Ampliar `SeccionId` y `SECCIONES_REALES` en `page.tsx`**

En `App/frontend/src/app/alumno/page.tsx`:

```ts
type SeccionId = 'datos' | 'sede' | 'carrera' | 'contactos' | 'companeros';

const SECCIONES_REALES: { id: SeccionId; etiqueta: string }[] = [
  { id: 'datos', etiqueta: 'Datos personales' },
  { id: 'sede', etiqueta: 'Sede' },
  { id: 'carrera', etiqueta: 'Carrera' },
  { id: 'contactos', etiqueta: 'Contactos' },
  { id: 'companeros', etiqueta: 'Compañeros' },
];
```

- [ ] **Step 3: Enrutar la sección en `PanelSeccion`**

En el `switch (seccion)` de `PanelSeccion`, agregar antes del `default`:

```tsx
    case 'companeros':
      return <SeccionCompaneros />;
```

El guard de exhaustividad `const _exhaustivo: never = seccion;` queda igual y ahora obliga a haber cubierto `'companeros'`.

- [ ] **Step 4: Añadir el import y el componente `SeccionCompaneros`**

Ampliar el import de `@/lib/api/perfil` (ya existe en el archivo) para incluir `obtenerCompaneros`, `type GrupoConCompaneros`, `type CompaneroItem`. Añadir `useQuery` al import de `@tanstack/react-query` (ya está para el `AlumnoPerfilPage`).

Agregar el componente junto a las otras `Seccion*` (p. ej. después de `SeccionContactos`):

```tsx
/**
 * Compañeros de salón — Fase 11, Día 32. Sección propia con su `useQuery`
 * (dispara al montarse; React Query cachea, volver a la sección no
 * re-fetchea). Consume `GET /perfil/grupo/companeros` — ver
 * `lib/api/perfil.ts`. Solo lectura, datos mínimos (nombre + matrícula +
 * semestre). Regla 11: árbol propio de alumno, sin componentes de admin.
 */
function SeccionCompaneros() {
  const {
    data: grupos,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['alumno', 'companeros'],
    queryFn: async () => {
      try {
        return await obtenerCompaneros();
      } catch (err) {
        // Regla 12 de CLAUDE.md raíz — loguear antes de que la UI muestre
        // el mensaje genérico.
        console.error('[SeccionCompaneros] Error al obtener compañeros:', err);
        throw err;
      }
    },
  });

  return (
    <section className="rounded-lg border border-mist p-5">
      <h2 className="text-sm font-semibold text-navy">Compañeros de salón</h2>

      {isLoading && <p className="mt-3 text-sm text-slate/60">Cargando…</p>}

      {isError && (
        <p className="mt-3 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-crimson">
          {error instanceof ApiError
            ? error.message
            : 'No se pudieron cargar tus compañeros. Intenta de nuevo más tarde.'}
        </p>
      )}

      {!isLoading && !isError && grupos && grupos.length === 0 && (
        <p className="mt-3 text-sm text-slate/60">
          No estás matriculado en ningún grupo todavía.
        </p>
      )}

      {!isLoading && !isError && grupos && grupos.length > 0 && (
        <div className="mt-3 space-y-4">
          {grupos.map((grupo) => (
            <GrupoCompaneros key={grupo.grupoId} grupo={grupo} />
          ))}
        </div>
      )}
    </section>
  );
}

function GrupoCompaneros({ grupo }: { grupo: GrupoConCompaneros }) {
  return (
    <div className="rounded-lg border border-mist bg-bone/60 p-4">
      <h3 className="text-sm font-semibold text-navy">{grupo.nombre}</h3>
      <p className="mt-0.5 text-xs text-slate/60">
        {grupo.carrera.nombre} · {grupo.anioInicio}-{grupo.cicloActual} · Salón{' '}
        {grupo.salon.nombre}
      </p>
      {grupo.companeros.length === 0 ? (
        <p className="mt-3 text-sm text-slate/60">
          Aún no hay más alumnos en este grupo.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-mist">
          {grupo.companeros.map((companero) => (
            <li key={companero.usuarioId} className="py-2 first:pt-0 last:pb-0">
              <p className="text-sm font-medium text-slate">
                {nombreCompletoDe(companero)}
              </p>
              <p className="text-xs text-slate/50">
                {companero.matricula} · Semestre {companero.semestreActual}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Ajustar `nombreCompletoDe` para aceptar el shape de compañero**

`nombreCompletoDe` hoy está tipado como `(alumno: PerfilAlumno)`. `CompaneroItem` tiene los tres campos que usa (`nombres`, `apellidoPaterno`, `apellidoMaterno`). Cambiar la firma a un tipo estructural mínimo para reusarlo sin duplicar:

```tsx
function nombreCompletoDe(persona: {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
}): string {
  return [persona.nombres, persona.apellidoPaterno, persona.apellidoMaterno]
    .filter(Boolean)
    .join(' ');
}
```

`PerfilAlumno` sigue siendo asignable a ese parámetro, así que las llamadas existentes (`EncabezadoPerfil`, `SeccionDatosPersonales`) no cambian.

- [ ] **Step 6: Typecheck + build del frontend**

Run: `cd App/frontend && pnpm build`
Expected: build exitoso, sin errores de TypeScript (Next corre el chequeo de tipos en `build`). Revisar que no haya warning de exhaustividad en el `switch` de `PanelSeccion`.

- [ ] **Step 7: Lint del frontend**

Run: `cd App/frontend && pnpm lint`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/frontend/src/lib/api/perfil.ts App/frontend/src/app/alumno/page.tsx
git commit -m "$(cat <<'EOF'
feat(alumno): sección "Compañeros" en el perfil del alumno (Día 32)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017iN4GYdSAc7Xoa78CyaaWc
EOF
)"
```

---

### Task 3: Cierre — QA y estado

**Files:**
- Modify: `documentacion_de_agentes/ESTADO.md` (checkboxes de Día 32 en dominios backend y alumno)
- Modify: `docs/roadmap.md` (tachar Día 32 / Fase 11 si queda completa)
- Modify: `C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp/CLAUDE.md` (línea "Fase actual" si Fase 11 cierra)

**Interfaces:**
- Consumes: veredictos de `qa-backend` y `qa-alumno`.
- Produces: nada de código.

- [ ] **Step 1: QA backend**

Dispatch `qa-backend` para auditar `GET /perfil/grupo/companeros` (controller, service, e2e spec) contra las reglas de `CLAUDE.md` raíz. Consigna veredicto en `ESTADO.md`. No corrige código.

- [ ] **Step 2: QA alumno**

Dispatch `qa-alumno` para auditar la sección "Compañeros" (`app/alumno/page.tsx`, `lib/api/perfil.ts`) contra las reglas. Consigna veredicto en `ESTADO.md`.

- [ ] **Step 3: Corregir hallazgos bloqueantes (si los hay)**

Si QA reporta hallazgos bloqueantes: crear una ronda de fix (subagent del dominio correspondiente), re-verificar (`pnpm test:e2e perfil-companeros` / `pnpm build`), volver a QA. Si solo hay observaciones menores/parked, dejarlas consignadas y seguir.

- [ ] **Step 4: Marcar estado**

- `ESTADO.md`: marcar el checkbox de Día 32 en los dominios backend y alumno.
- `docs/roadmap.md`: tachar "Día 32 — Vista de compañeros para el alumno" y, como Fase 11 es un solo día, marcar **FASE 11 — Compañeros de salón: COMPLETA**.
- `CLAUDE.md` raíz: actualizar la línea "Fase actual" — Fase 11 completa, siguiente Fase 12 (Días 33-34, Maestro por materia).

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add documentacion_de_agentes/ESTADO.md docs/roadmap.md CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: cierre Día 32 — compañeros de salón (Fase 11 completa)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017iN4GYdSAc7Xoa78CyaaWc
EOF
)"
```

- [ ] **Step 6: Verificación manual en navegador (usuario)**

Pendiente para el usuario, junto con el click-through de Grupos (Días 30-31): iniciar sesión como un alumno de `seed-variado.ts` matriculado en un grupo, abrir "Mi perfil" → sección "Compañeros", confirmar que ve la lista de su grupo y ningún dato de otro grupo. Luego push a `origin/dev`.

---

## Self-Review

**1. Spec coverage:**
- Contrato del endpoint (ruta, guards, actor, sin paginación, códigos, shape, orden, casos borde) → Task 1 Steps 1, 3, 4, 8. ✓
- Lógica backend (`obtenerCompanerosDeGrupo`, consulta anidada, sin transacción, sin auditoría, RLS) → Task 1 Step 3. ✓
- UI: `SeccionId`, `SECCIONES_REALES`, `PanelSeccion`, `SeccionCompaneros`, estados loading/error/vacío, sub-tarjeta por grupo, `lib/api/perfil.ts` → Task 2 Steps 1-5. ✓
- Pruebas e2e (los 9 casos del spec) → Task 1 Step 1. ✓
- Pruebas frontend (build + lint + manual) → Task 2 Steps 6-7, Task 3 Step 6. ✓
- Fuera de alcance (sin `:id`, sin datos sensibles, sin foto, sin filtro, no maestro, sin cambios a `GET /perfil`) → respetado; el plan no añade ninguna de esas cosas. ✓
- Ejecución (SDD: backend → frontend → review → QA; marcar `ESTADO.md`/`roadmap.md`/`CLAUDE.md`) → Task 3. ✓

**2. Placeholder scan:** Sin "TBD"/"TODO"/"añadir manejo apropiado". La única bifurcación abierta (fallback de `orderBy` por relación) tiene instrucción concreta y default claro. ✓

**3. Type consistency:** `GrupoConCompaneros` / `CompaneroItem` idénticos entre Task 1 (`Produces`, Step 3 return, Step 8 doc) y Task 2 (Step 1 tipos, Step 4 uso). `obtenerCompaneros(): Promise<GrupoConCompaneros[]>` consistente. `obtenerCompanerosDeGrupo(actorUsuarioId: string)` consistente entre service (Step 3) y controller (Step 4). `nombreCompletoDe` re-tipado a estructural, compatible con llamadas previas (Step 5). ✓
