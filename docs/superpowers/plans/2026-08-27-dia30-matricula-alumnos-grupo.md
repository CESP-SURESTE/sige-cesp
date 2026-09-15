# Día 30 — Matrícula de alumnos en grupo (backend) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un `ADMINISTRATIVO` pueda matricular y quitar alumnos de un grupo, y listar los inscritos, vía la API — todo scopeado a su sede.

**Architecture:** 3 métodos nuevos en `GruposController`/`GruposService` (`POST`/`DELETE`/`GET /grupos/:id/alumnos`). Un helper privado resuelve el `usuarioId` del request a un `PerfilAlumno` de la sede del actor. La matrícula (pre-check de duplicado + `count` de capacidad + `create` + auditoría) corre dentro de un `$transaction`. `GrupoAlumno` ya existe en el schema desde el Día 2/5 — es la primera vez que se le pone código de aplicación.

**Tech Stack:** NestJS + Prisma 6.x (Postgres/Supabase). Jest e2e (`pnpm test:e2e` → `node scripts/run-e2e.js`), unit (`pnpm test`).

## Global Constraints

- Mismos guards que el resto de `GruposController`: `@UseGuards(SedeGuard, RolesGuard)` a nivel de clase, `@Roles(RolUsuario.ADMINISTRATIVO)` por método. Sin jerarquía de `nivelPermiso`.
- `sedeId` SIEMPRE de `@SedeActual()`. `actorUsuarioId` SIEMPRE de `@ActorUsuarioId()`. Nunca del body/param (más allá de los `:id`/`:usuarioId` de ruta).
- El request identifica al alumno por `Usuario.id` (`usuarioId`) — en el body del `POST` y en el path del `DELETE`. El backend lo resuelve a `PerfilAlumno.id` internamente.
- Código de error de dominio NUEVO: `CAPACIDAD_EXCEDIDA` (409). Todos los demás reutilizan los fijos (`NOT_FOUND`, `VALIDATION_ERROR`, `CONFLICT`, `SERVER_ERROR`).
- `RegistroAuditoria` solo inserción (regla 5), dentro de la misma `$transaction` que la escritura. `entidad: 'GrupoAlumno'`, `detalle: { grupoId, alumnoId, matricula }`.
- DELETE real de la fila `GrupoAlumno` (fila de unión, no una persona — regla 3 de baja lógica NO aplica; `CLAUDE.md` ya lista `GrupoAlumno` como "solo POST/DELETE").
- Todo catch loguea con `console.error` el error completo antes de responder (regla 12).
- **NO se enforza** "un alumno no duplicado en el mismo periodo" (decisión explícita del usuario, 2026-08-27). Solo aplica el `@@unique([grupoId, alumnoId])`: no dos veces en el MISMO grupo. No se valida `estatusAcademico`, ni `Usuario.activo`, ni `semestreActual` vs `cicloActual`.
- Capacidad: `count` + `create` dentro del `$transaction`, sin `SELECT ... FOR UPDATE` (riesgo de carrera residual aceptado, mismo criterio que `Carrera.nombre`).
- e2e: fixtures que registran cada `id` creado; limpieza en `afterAll` acotada a esos `id`s, NUNCA por patrón de email/nombre (regla 14, bug de Día 24).
- Prisma 6.x — no subir a Prisma 7. El `@@unique([grupoId, alumnoId])` genera el accessor compuesto `grupoId_alumnoId` en el client.

---

### Task 1: Backend — DTO, servicio, controller y e2e

**Files:**
- Create: `App/backend/src/grupos/dto/matricular-alumno.dto.ts`
- Modify: `App/backend/src/grupos/grupos.service.ts` (agregar helper privado + 3 métodos públicos + interface `GrupoAlumnoListItem`)
- Modify: `App/backend/src/grupos/grupos.controller.ts` (3 handlers nuevos)
- Create: `App/backend/test/grupos-alumnos.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`; decoradores `@SedeActual()` / `@ActorUsuarioId()` / `@Roles()`; guards `SedeGuard` / `RolesGuard` (todos ya usados en `grupos.controller.ts`).
- Produces:
  ```ts
  // grupos.service.ts
  export interface GrupoAlumnoListItem {
    usuarioId: string;
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string | null;
    matricula: string;
    semestreActual: number;
    estatusAcademico: import('@prisma/client').EstatusAcademico;
    fechaInscripcion: string; // ISO
  }
  class GruposService {
    matricular(grupoId: string, usuarioId: string, sedeId: string, actorUsuarioId: string): Promise<import('@prisma/client').GrupoAlumno>;
    desmatricular(grupoId: string, usuarioId: string, sedeId: string, actorUsuarioId: string): Promise<{ ok: true }>;
    listarAlumnos(grupoId: string, sedeId: string): Promise<GrupoAlumnoListItem[]>;
  }
  ```
  Rutas: `POST /grupos/:id/alumnos` → `201 { data: GrupoAlumno }`; `DELETE /grupos/:id/alumnos/:usuarioId` → `200 { data: { ok: true } }`; `GET /grupos/:id/alumnos` → `200 { data: GrupoAlumnoListItem[] }`.

- [ ] **Step 1: Escribir el e2e que falla — `grupos-alumnos.e2e-spec.ts`**

Crear `App/backend/test/grupos-alumnos.e2e-spec.ts`. Copiar el bloque `beforeAll` de infraestructura (JWKS de prueba, `SEDE_GUARD_ENV_OVERRIDE`, `configureApp`) tal cual de `App/backend/test/grupos.e2e-spec.ts:66-86` — es idéntico. Luego este setup de datos y helpers:

```ts
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

describe('GruposController — matrícula de alumnos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let sedeValladolidId: string;
  let carreraLaeId: string; // LAE-MID
  let carreraIngId: string; // ING-SIS-MID
  let salonMeridaId: string;
  let actorUsuarioId: string; // ana.canul (Mérida)
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';

  const usuarioIdsCreados: string[] = [];
  const grupoIdsCreados: string[] = [];

  async function firmarToken(claims: Record<string, unknown>): Promise<string> {
    return new jose.SignJWT(claims)
      .setProtectedHeader({ alg, kid })
      .setSubject((claims.sub as string) ?? actorUsuarioId)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  function tokenAdminMerida(): Promise<string> {
    return firmarToken({ role: 'authenticated', rol: RolUsuario.ADMINISTRATIVO, sede_id: sedeMeridaId });
  }

  async function crearAlumnoFixture(opts: {
    sedeId: string;
    carreraId: string;
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
        nombres: 'Fixture',
        apellidoPaterno: 'Matricula',
        apellidoMaterno: `Z${randomUUID().slice(0, 4)}`,
        curp: `FX${randomUUID().slice(0, 16).toUpperCase()}`,
        fechaNacimiento: new Date('2006-01-01'),
        matricula: `FXMAT${randomUUID().slice(0, 10).toUpperCase()}`,
        correoPersonal: `fixture.matricula.personal.${randomUUID()}@example.com`,
        carreraId: opts.carreraId,
        estatusAcademico: 'INSCRITO',
        periodoIngreso: '2026-1',
        semestreActual: 1,
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

  beforeAll(async () => {
    // ... bloque JWKS idéntico a grupos.e2e-spec.ts:66-86 ...
    // tras app.init():
    prisma = moduleFixture.get(PrismaService);
    sedeMeridaId = (await prisma.sede.findUniqueOrThrow({ where: { nombre: 'CESP Mérida' } })).id;
    sedeValladolidId = (await prisma.sede.findUniqueOrThrow({ where: { nombre: 'CESP Valladolid' } })).id;
    carreraLaeId = (await prisma.carrera.findUniqueOrThrow({ where: { clave: 'LAE-MID' } })).id;
    carreraIngId = (await prisma.carrera.findUniqueOrThrow({ where: { clave: 'ING-SIS-MID' } })).id;
    salonMeridaId = (await prisma.salon.findUniqueOrThrow({ where: { sedeId_nombre: { sedeId: sedeMeridaId, nombre: 'Aula 101' } } })).id;
    actorUsuarioId = (await prisma.usuario.findUniqueOrThrow({ where: { email: 'ana.canul@cesp-merida.edu.mx' } })).id;
  }, 30000);

  afterAll(async () => {
    if (usuarioIdsCreados.length > 0 || grupoIdsCreados.length > 0) {
      await prisma.registroAuditoria.deleteMany({
        where: { entidad: 'GrupoAlumno', entidadId: { not: undefined }, usuarioId: { in: [actorUsuarioId] } },
      });
      await prisma.grupoAlumno.deleteMany({ where: { grupoId: { in: grupoIdsCreados } } });
      await prisma.grupo.deleteMany({ where: { id: { in: grupoIdsCreados } } });
      await prisma.perfilAlumno.deleteMany({ where: { usuarioId: { in: usuarioIdsCreados } } });
      await prisma.usuario.deleteMany({ where: { id: { in: usuarioIdsCreados } } });
    }
    await app.close();
  });
```

> Nota sobre la limpieza de `RegistroAuditoria`: la línea de arriba borra por `usuarioId: actorUsuarioId` + `entidad: 'GrupoAlumno'`. `actorUsuarioId` es `ana.canul`, un admin real del seed — pero `entidad: 'GrupoAlumno'` sólo lo produce ESTE endpoint, y ningún otro spec matricula alumnos con ese actor, así que el borrado queda acotado en la práctica. Si el implementador prefiere, puede capturar los `entidadId` de las filas `GrupoAlumno` creadas y borrar por `entidadId: { in: [...] }` — cualquiera de las dos cumple la regla 14; NO borrar por patrón de nombre/fecha.

Casos `it(...)` a escribir (todos con `tokenAdminMerida()` salvo el de cross-sede). Para cada uno, el status y `code` exactos:

1. `POST /grupos/:id/alumnos con alumno de la misma carrera -> 201` — body `{ usuarioId: alumnoLae }`; assert `res.status === 201`, `res.body.data.grupoId === grupo`, `res.body.data.alumnoId` es el `PerfilAlumno.id` (resolver vía `prisma.perfilAlumno.findUniqueOrThrow({ where: { usuarioId: alumnoLae } })`), y que existe un `RegistroAuditoria` `{ entidad: 'GrupoAlumno', accion: 'ALTA', entidadId: res.body.data.id }` cuyo `detalle.matricula` coincide con la matrícula real del alumno.
2. `POST duplicado (mismo alumno, mismo grupo) -> 409 CONFLICT` — matricular dos veces; la segunda `res.status === 409`, `code === 'CONFLICT'`.
3. `POST alumno de otra carrera -> 400 VALIDATION_ERROR` — grupo de `carreraLaeId`, alumno de `carreraIngId`.
4. `POST con el grupo lleno -> 409 CAPACIDAD_EXCEDIDA` — `crearGrupoFixture({ capacidad: 1 })`, matricular 1 alumno OK, matricular un 2º → `res.status === 409`, `code === 'CAPACIDAD_EXCEDIDA'`.
5. `POST usuarioId inexistente -> 404 NOT_FOUND` — `usuarioId: randomUUID()`.
6. `POST usuarioId de un MAESTRO -> 404 NOT_FOUND` — `crearMaestroUsuarioFixture(sedeMeridaId)`.
7. `POST alumno de otra sede -> 404 NOT_FOUND` — `crearAlumnoFixture({ sedeId: sedeValladolidId, carreraId: <carrera de Valladolid, clave 'LC-VLD'> })`; contra un grupo de Mérida → 404 (el `where` del resolver incluye `sedeId`).
8. `POST sin usuarioId -> 400 VALIDATION_ERROR` — body `{}`.
9. `POST usuarioId no-UUID -> 400 VALIDATION_ERROR` — body `{ usuarioId: 'no-es-uuid' }`.
10. `POST a un grupo de otra sede -> 404 NOT_FOUND` — crear grupo en Valladolid (`crearGrupoFixture({ sedeId: sedeValladolidId, carreraId: <LC-VLD>, salonId: <Aula 201 de Valladolid> })`), `POST` con `tokenAdminMerida()` → 404.
11. `DELETE de un alumno inscrito -> 200` — matricular, luego `DELETE /grupos/:id/alumnos/:usuarioId`; `res.status === 200`, `res.body.data.ok === true`; la fila `grupoAlumno` ya no existe; hay `RegistroAuditoria` `{ entidad: 'GrupoAlumno', accion: 'ELIMINACION' }`.
12. `DELETE de un alumno NO inscrito -> 404 NOT_FOUND`.
13. `DELETE grupo de otra sede -> 404 NOT_FOUND`.
14. `GET /grupos/:id/alumnos devuelve los inscritos ordenados` — matricular 2 alumnos (crear con `apellidoPaterno` distintos, p. ej. "Ba..." y "Az..."); `GET`; assert `res.body.data` tiene 2 elementos, ordenados por `apellidoPaterno asc`, cada uno con las llaves `usuarioId, nombres, apellidoPaterno, apellidoMaterno, matricula, semestreActual, estatusAcademico, fechaInscripcion`.
15. `GET de un grupo vacío -> 200 { data: [] }`.
16. `GET grupo de otra sede -> 404 NOT_FOUND`.

- [ ] **Step 2: Correr el e2e y verificar que falla**

Run: `cd App/backend && pnpm test:e2e -- grupos-alumnos`
Expected: FALLA — las rutas `/grupos/:id/alumnos` no existen aún, todos los `POST`/`GET`/`DELETE` responden `404` de Nest (no el `{ code: 'NOT_FOUND' }` del contrato) o `400` por otras razones. Confirma que la suite carga (no hay error de compilación/import en el spec).

- [ ] **Step 3: Crear el DTO**

Crear `App/backend/src/grupos/dto/matricular-alumno.dto.ts`:

```ts
import { IsUUID } from 'class-validator';

/**
 * Body de `POST /grupos/:id/alumnos` (Fase 10, Día 30). El alumno se
 * identifica por su `Usuario.id` (lo que devuelve `GET /personas?rol=ALUMNO`,
 * que alimenta el autocomplete del Día 31) — el service lo resuelve a
 * `PerfilAlumno.id`. Los `Usuario.id` vienen de Supabase Auth y son UUID.
 */
export class MatricularAlumnoDto {
  @IsUUID(undefined, { message: 'usuarioId debe ser un UUID válido' })
  usuarioId!: string;
}
```

- [ ] **Step 4: Implementar el servicio**

En `App/backend/src/grupos/grupos.service.ts`:

Agregar al import de `@prisma/client`: `EstatusAcademico`, `GrupoAlumno`, `RolUsuario` (mantener los que ya están: `AccionAuditoria`, `Prisma`, `Grupo`).

Agregar la interface exportada, junto a `GrupoListItem`:

```ts
export interface GrupoAlumnoListItem {
  usuarioId: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  matricula: string;
  semestreActual: number;
  estatusAcademico: EstatusAcademico;
  fechaInscripcion: string;
}
```

Agregar estos métodos a la clase `GruposService` (después de `eliminar`):

```ts
  /**
   * Resuelve un `Usuario.id` a su `PerfilAlumno`, exigiendo que sea un
   * `ALUMNO` de la sede del actor. Cubre en un solo query: id inexistente,
   * alumno de otra sede (`sedeId` en el where), un `Usuario` que es
   * MAESTRO/ADMINISTRATIVO (`rol` en el where), y un ALUMNO sin fila de
   * perfil (defensivo).
   */
  private async resolverAlumnoEnSede(usuarioId: string, sedeId: string) {
    const usuario = await this.prisma.usuario.findFirst({
      where: { id: usuarioId, sedeId, rol: RolUsuario.ALUMNO },
      include: { perfilAlumno: true },
    });
    if (!usuario || !usuario.perfilAlumno) {
      throw new NotFoundException({
        error: 'Alumno no encontrado en tu sede',
        code: 'NOT_FOUND',
      });
    }
    return usuario.perfilAlumno;
  }

  private async obtenerGrupoEnSede(id: string, sedeId: string) {
    const grupo = await this.prisma.grupo.findFirst({ where: { id, sedeId } });
    if (!grupo) {
      throw new NotFoundException({
        error: 'Grupo no encontrado en tu sede',
        code: 'NOT_FOUND',
      });
    }
    return grupo;
  }

  /**
   * `POST /grupos/:id/alumnos` — Fase 10, Día 30. Valida grupo∈sede,
   * alumno∈sede (mismo `rol: ALUMNO`), y que `alumno.carreraId ===
   * grupo.carreraId` (400 VALIDATION_ERROR). Dentro de una `$transaction`:
   * pre-check de duplicado en ESTE grupo (409 CONFLICT), `count` vs
   * `grupo.capacidad` (409 CAPACIDAD_EXCEDIDA), `create`, y auditoría de
   * `ALTA`. NO valida "un grupo por periodo", ni `estatusAcademico`, ni
   * `Usuario.activo` (decisión explícita del usuario). Carrera de capacidad
   * concurrente aceptada (sin `SELECT ... FOR UPDATE`).
   */
  async matricular(
    grupoId: string,
    usuarioId: string,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<GrupoAlumno> {
    const grupo = await this.obtenerGrupoEnSede(grupoId, sedeId);
    const alumno = await this.resolverAlumnoEnSede(usuarioId, sedeId);

    if (alumno.carreraId !== grupo.carreraId) {
      throw new BadRequestException({
        error: 'El alumno pertenece a otra carrera',
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const yaInscrito = await tx.grupoAlumno.findUnique({
          where: { grupoId_alumnoId: { grupoId, alumnoId: alumno.id } },
          select: { id: true },
        });
        if (yaInscrito) {
          throw new ConflictException({
            error: 'El alumno ya está inscrito en este grupo',
            code: 'CONFLICT',
          });
        }

        const inscritos = await tx.grupoAlumno.count({ where: { grupoId } });
        if (inscritos >= grupo.capacidad) {
          throw new ConflictException({
            error: `El grupo ya alcanzó su capacidad de ${grupo.capacidad} alumno(s)`,
            code: 'CAPACIDAD_EXCEDIDA',
          });
        }

        const fila = await tx.grupoAlumno.create({
          data: { grupoId, alumnoId: alumno.id },
        });

        await tx.registroAuditoria.create({
          data: {
            usuarioId: actorUsuarioId,
            sedeId,
            accion: AccionAuditoria.ALTA,
            entidad: 'GrupoAlumno',
            entidadId: fila.id,
            detalle: {
              grupoId,
              alumnoId: alumno.id,
              matricula: alumno.matricula,
            },
          },
        });

        return fila;
      });
    } catch (err) {
      if (
        err instanceof ConflictException ||
        err instanceof BadRequestException ||
        err instanceof NotFoundException
      ) {
        throw err;
      }
      console.error('[GruposService.matricular] error inesperado:', err);
      throw err;
    }
  }

  /**
   * `DELETE /grupos/:id/alumnos/:usuarioId` — DELETE real de la fila de
   * unión (regla 3 de baja lógica no aplica a `GrupoAlumno`). Audita
   * `ELIMINACION` ANTES del `delete`, en la misma transacción.
   */
  async desmatricular(
    grupoId: string,
    usuarioId: string,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<{ ok: true }> {
    await this.obtenerGrupoEnSede(grupoId, sedeId);
    const alumno = await this.resolverAlumnoEnSede(usuarioId, sedeId);

    const fila = await this.prisma.grupoAlumno.findUnique({
      where: { grupoId_alumnoId: { grupoId, alumnoId: alumno.id } },
      select: { id: true },
    });
    if (!fila) {
      throw new NotFoundException({
        error: 'El alumno no está inscrito en este grupo',
        code: 'NOT_FOUND',
      });
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.registroAuditoria.create({
          data: {
            usuarioId: actorUsuarioId,
            sedeId,
            accion: AccionAuditoria.ELIMINACION,
            entidad: 'GrupoAlumno',
            entidadId: fila.id,
            detalle: {
              grupoId,
              alumnoId: alumno.id,
              matricula: alumno.matricula,
            },
          },
        });
        await tx.grupoAlumno.delete({ where: { id: fila.id } });
      });
    } catch (err) {
      console.error('[GruposService.desmatricular] error inesperado:', err);
      throw new InternalServerErrorException({
        error: 'Error inesperado al desmatricular al alumno',
        code: 'SERVER_ERROR',
      });
    }

    return { ok: true };
  }

  /**
   * `GET /grupos/:id/alumnos` — inscritos de un grupo. Sin paginar
   * (catálogo chico, ≤ capacidad). Orden `apellidoPaterno, apellidoMaterno,
   * nombres` (igual que `GET /personas`).
   */
  async listarAlumnos(
    grupoId: string,
    sedeId: string,
  ): Promise<GrupoAlumnoListItem[]> {
    await this.obtenerGrupoEnSede(grupoId, sedeId);

    try {
      const filas = await this.prisma.grupoAlumno.findMany({
        where: { grupoId },
        orderBy: [
          { alumno: { apellidoPaterno: 'asc' } },
          { alumno: { apellidoMaterno: 'asc' } },
          { alumno: { nombres: 'asc' } },
        ],
        select: {
          fechaInscripcion: true,
          alumno: {
            select: {
              usuarioId: true,
              nombres: true,
              apellidoPaterno: true,
              apellidoMaterno: true,
              matricula: true,
              semestreActual: true,
              estatusAcademico: true,
            },
          },
        },
      });

      return filas.map((f) => ({
        usuarioId: f.alumno.usuarioId,
        nombres: f.alumno.nombres,
        apellidoPaterno: f.alumno.apellidoPaterno,
        apellidoMaterno: f.alumno.apellidoMaterno,
        matricula: f.alumno.matricula,
        semestreActual: f.alumno.semestreActual,
        estatusAcademico: f.alumno.estatusAcademico,
        fechaInscripcion: f.fechaInscripcion.toISOString(),
      }));
    } catch (err) {
      console.error('[GruposService.listarAlumnos] error inesperado:', err);
      throw err;
    }
  }
```

> `InternalServerErrorException` ya está importado en el archivo (lo usa `eliminar`). `BadRequestException`, `ConflictException`, `NotFoundException` también.

- [ ] **Step 5: Implementar los handlers del controller**

En `App/backend/src/grupos/grupos.controller.ts`, agregar el import del DTO:

```ts
import { MatricularAlumnoDto } from './dto/matricular-alumno.dto';
```

Agregar estos 3 métodos a `GruposController` (después de `eliminar`):

```ts
  @Get(':id/alumnos')
  @Roles(RolUsuario.ADMINISTRATIVO)
  async listarAlumnos(
    @Param('id') id: string,
    @SedeActual() sedeId: string,
  ) {
    const data = await this.gruposService.listarAlumnos(id, sedeId);
    return { data };
  }

  @Post(':id/alumnos')
  @HttpCode(201)
  @Roles(RolUsuario.ADMINISTRATIVO)
  async matricular(
    @Param('id') id: string,
    @Body() body: MatricularAlumnoDto,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    const data = await this.gruposService.matricular(
      id,
      body.usuarioId,
      sedeId,
      actorUsuarioId,
    );
    return { data };
  }

  @Delete(':id/alumnos/:usuarioId')
  @Roles(RolUsuario.ADMINISTRATIVO)
  async desmatricular(
    @Param('id') id: string,
    @Param('usuarioId') usuarioId: string,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    const data = await this.gruposService.desmatricular(
      id,
      usuarioId,
      sedeId,
      actorUsuarioId,
    );
    return { data };
  }
```

> Ordenamiento de rutas: `@Delete(':id')` y `@Delete(':id/alumnos/:usuarioId')` no colisionan (distinto número de segmentos); `@Get()` y `@Get(':id/alumnos')` tampoco. No hace falta reordenar.

- [ ] **Step 6: Correr el e2e nuevo y verificar que pasa**

Run: `cd App/backend && pnpm test:e2e -- grupos-alumnos`
Expected: los 16 casos PASAN.

- [ ] **Step 7: Correr toda la suite e2e + unit + build**

Run: `cd App/backend && pnpm test:e2e && pnpm test && pnpm build`
Expected: toda la suite e2e del backend en verde (no se rompió ningún spec existente — en particular `grupos.e2e-spec.ts`), unit en verde, build OK.

- [ ] **Step 8: Commit**

```bash
git add App/backend/src/grupos App/backend/test/grupos-alumnos.e2e-spec.ts
git commit -m "feat(grupos): matrícula de alumnos en grupo (POST/DELETE/GET /grupos/:id/alumnos)"
```

---

### Task 2: Documentación

**Files:**
- Modify: `CLAUDE.md` (sección "Contrato de API": lista de códigos de dominio + bloque nuevo; tabla "CRUD por tipo de entidad")
- Modify: `docs/roadmap.md` (marcar checkboxes del Día 30)
- Modify: `documentacion_de_agentes/ESTADO.md` (entrada de cierre)

**Interfaces:**
- Consumes: nombres finales de Task 1 (`CAPACIDAD_EXCEDIDA`, rutas `/grupos/:id/alumnos`).
- Produces: nada.

- [ ] **Step 1: `CLAUDE.md` — código de dominio nuevo**

En `CLAUDE.md`, en la lista "Códigos de dominio ya en uso" (después de `CORREO_NO_CONFIRMADO`), agregar:

```
- `CAPACIDAD_EXCEDIDA` (409, `POST /grupos/:id/alumnos` — Fase 10 Día 30: el grupo ya
  tiene `Grupo.capacidad` alumnos inscritos; se cuenta dentro de la misma transacción
  de la matrícula).
```

- [ ] **Step 2: `CLAUDE.md` — bloque de contrato de los endpoints**

En la sección "Contrato de API", después del bloque de `DELETE /grupos/:id`, agregar:

```
- `POST/DELETE/GET /grupos/:id/alumnos` (Fase 10, Día 30) — matrícula de alumnos en
  un grupo. Mismos guards que el resto de `GruposController`
  (`SedeGuard`+`RolesGuard(ADMINISTRATIVO)`), `sedeId` siempre de `@SedeActual()`. El
  alumno se identifica por `Usuario.id` (`usuarioId` en el body del `POST`, `:usuarioId`
  en el path del `DELETE`) — el service lo resuelve a `PerfilAlumno.id` exigiendo
  `rol: ALUMNO` y `sedeId` del actor (id inexistente / alumno de otra sede / un
  MAESTRO-ADMINISTRATIVO → `404 NOT_FOUND`). `POST`: valida `alumno.carreraId ===
  grupo.carreraId` (`400 VALIDATION_ERROR`), no-duplicado en ESE grupo
  (`@@unique([grupoId, alumnoId])`, pre-check → `409 CONFLICT`), y capacidad
  (`count(GrupoAlumno) >= Grupo.capacidad` dentro de la transacción →
  `409 CAPACIDAD_EXCEDIDA`). NO valida "un grupo por periodo" (decisión explícita del
  usuario 2026-08-27 — un alumno puede estar en varios grupos del mismo
  `anioInicio`+`cicloActual`), ni `estatusAcademico`, ni `Usuario.activo`. Audita
  `ALTA` en la misma transacción (`entidad: 'GrupoAlumno'`, `detalle: { grupoId,
  alumnoId, matricula }`). Éxito: `201 { data: GrupoAlumno }` (fila plana). `DELETE`:
  DELETE real de la fila de unión (regla 3 no aplica a `GrupoAlumno`); inscripción
  inexistente → `404 NOT_FOUND`; audita `ELIMINACION` antes del delete. Éxito:
  `200 { data: { ok: true } }`. `GET`: sin paginar (catálogo chico, ≤ capacidad),
  éxito `200 { data: GrupoAlumnoListItem[] }` con `{ usuarioId, nombres,
  apellidoPaterno, apellidoMaterno, matricula, semestreActual, estatusAcademico,
  fechaInscripcion }`, orden `apellidoPaterno asc, apellidoMaterno asc, nombres asc`;
  grupo vacío → `200 { data: [] }`. Sin `GET /grupos/:id` (la UI del Día 31 prellena
  los datos del grupo desde el caché de React Query del listado, mismo patrón que
  Carreras).
```

- [ ] **Step 3: `CLAUDE.md` — tabla "CRUD por tipo de entidad"**

En la fila "Negocio (no CRUD)", cambiar `GrupoAlumno` (solo POST/DELETE)` por
`GrupoAlumno` (POST/DELETE + GET de listado)`.

- [ ] **Step 4: `docs/roadmap.md` — marcar Día 30**

En `docs/roadmap.md`, en "### Día 30 — Matrícula de alumnos en grupo", cambiar los 3
`- [ ]` por `- [x]`, y agregar debajo del bloque:

```
- [x] `POST /grupos/:id/alumnos` (admin, sede vía guard) y `DELETE /grupos/:id/alumnos/:usuarioId`
- [x] Validación: no exceder capacidad del grupo (`409 CAPACIDAD_EXCEDIDA`); alumno no duplicado en el mismo grupo; alumno de la misma carrera y sede
- [x] `GET /grupos/:id/alumnos` agregado al alcance (la vista de detalle del Día 31 lo necesita — mismo criterio que `GET /salones` en el Día 29)

**Nota de alcance:** "alumno no duplicado en el mismo periodo" (texto original de este
día) NO se implementó — decisión explícita del usuario (2026-08-27): un alumno puede
estar en varios grupos del mismo `anioInicio`+`cicloActual`. Solo aplica el `@@unique`
de "no dos veces en el mismo grupo". Detalle en
`docs/superpowers/specs/2026-08-27-dia30-matricula-alumnos-grupo-design.md`.

**Entregable visible:** alumno de prueba matriculado y removido de un grupo, con auditoría, respetando capacidad y carrera — 16 casos e2e en verde.
```

- [ ] **Step 5: `documentacion_de_agentes/ESTADO.md` — entrada de cierre**

En `documentacion_de_agentes/ESTADO.md`, después de la entrada del tooltip (última de
2026-08-27), agregar:

```markdown
### Día 30 — Matrícula de alumnos en grupo (backend) — ✅ CERRADO EN CÓDIGO (2026-08-27)

- **Contexto**: `GrupoAlumno` existía en el schema desde el Día 2/5 sin código de
  aplicación. Primer código real. Arranca la Fase 10.
- **Endpoints** (en `GruposController`, mismos guards): `POST /grupos/:id/alumnos`
  (body `{ usuarioId }`), `DELETE /grupos/:id/alumnos/:usuarioId`,
  `GET /grupos/:id/alumnos` (sin paginar). El `usuarioId` (un `Usuario.id`) se
  resuelve server-side a `PerfilAlumno` exigiendo `rol: ALUMNO` + `sedeId` del actor.
- **Validaciones del `POST`**: grupo∈sede (404), alumno∈sede+rol ALUMNO (404), carrera
  del alumno == carrera del grupo (400 VALIDATION_ERROR), no-duplicado en ese grupo
  (409 CONFLICT), capacidad `count >= Grupo.capacidad` dentro de la transacción
  (409 `CAPACIDAD_EXCEDIDA` — código de dominio nuevo). Auditoría `ALTA`/`ELIMINACION`
  en la misma `$transaction`, `entidad: 'GrupoAlumno'`.
- **Fuera de alcance (decisión del usuario, 2026-08-27)**: NO se enforza "un grupo por
  periodo" — un alumno puede estar en varios grupos del mismo `anioInicio`+`cicloActual`.
  Tampoco se valida `estatusAcademico`, `Usuario.activo`, ni `semestreActual` vs
  `cicloActual`. Carrera de capacidad concurrente aceptada (sin `SELECT ... FOR UPDATE`).
- **Tests**: `grupos-alumnos.e2e-spec.ts` — 16 casos (alta + auditoría, duplicado,
  otra carrera, capacidad llena, usuarioId inexistente / de un MAESTRO / de otra sede,
  body inválido, grupo de otra sede, DELETE OK / no inscrito / grupo ajeno, GET con
  orden y campos / vacío / grupo ajeno). Suite e2e completa del backend + unit + build
  en verde.
- **Pendiente**: Día 31 (UI de detalle de grupo + autocomplete para matricular).
  Verificación manual en navegador se hará junto con el Día 31.
- Spec → `docs/superpowers/specs/2026-08-27-dia30-matricula-alumnos-grupo-design.md`,
  plan → `docs/superpowers/plans/2026-08-27-dia30-matricula-alumnos-grupo.md`.
```

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/roadmap.md documentacion_de_agentes/ESTADO.md
git commit -m "docs: Día 30 — matrícula de alumnos en grupo (contrato + roadmap + estado)"
```

---

## Self-Review

**1. Spec coverage:**
- Spec §"Endpoints nuevos" (`POST`/`DELETE`/`GET /grupos/:id/alumnos`, shapes) → Task 1 Steps 4-5. ✅
- Spec §"Validaciones y códigos de error" (orden de checks, `CAPACIDAD_EXCEDIDA`, carrera, dup, 404s) → Task 1 Step 4 (`matricular`/`desmatricular`/`resolverAlumnoEnSede`). ✅
- Spec §"Auditoría y transaccionalidad" (`$transaction`, `ALTA`/`ELIMINACION`, `detalle`, sin `FOR UPDATE`) → Task 1 Step 4. ✅
- Spec §"Fuera de alcance" (sin "un grupo por periodo", sin estatus/activo, sin `GET /grupos/:id`) → Global Constraints + no se implementa; documentado en Task 2 Steps 2/4/5. ✅
- Spec §"Testing" (16 casos enumerados, fixtures con limpieza acotada) → Task 1 Step 1. ✅
- Spec §"Contrato de API — texto a agregar" → Task 2 Steps 1-3. ✅

**2. Placeholder scan:** El bloque JWKS de `beforeAll` se referencia como "idéntico a grupos.e2e-spec.ts:66-86" en vez de repetirse — es ~20 líneas de boilerplate de infra ya existente en el repo, y el Step 1 dice explícitamente copiarlo textual de ese archivo; no es un "TODO", es una instrucción concreta con la fuente exacta. El resto del código (DTO, servicio, controller, setup del spec, y las aserciones clave de cada caso) está literal. Los 16 casos `it()` dan status + code exactos aunque no repiten el andamiaje de `request(...)` en cada uno — el patrón está en el caso 1 y en `grupos.e2e-spec.ts`. ✅ (aceptable: repetir 16 bloques `request().set().send()` casi idénticos sería ruido, no señal).

**3. Type consistency:**
- `GrupoAlumnoListItem` — definido en Task 1 Step 4, mismas 8 llaves en la interface, el `select`, el `.map`, el bloque de contrato de `CLAUDE.md` (Task 2 Step 2) y la entrada de `ESTADO.md`. ✅
- `matricular(grupoId, usuarioId, sedeId, actorUsuarioId)` / `desmatricular(...)` / `listarAlumnos(grupoId, sedeId)` — firmas idénticas entre el bloque "Produces", el servicio (Step 4) y las llamadas del controller (Step 5). ✅
- `grupoId_alumnoId` — accessor compuesto de Prisma para `@@unique([grupoId, alumnoId])`; usado consistente en `matricular` y `desmatricular`. ✅
- Excepciones (`BadRequestException`, `ConflictException`, `NotFoundException`, `InternalServerErrorException`) — todas ya importadas en `grupos.service.ts` (las usa el código existente). ✅
- Claims del token de prueba: `{ role, rol, sede_id }` + `sub` — mismo shape que `grupos.e2e-spec.ts` (que usa `rol` + `sede_id` y `setSubject(actorUsuarioId)`). ✅
