# Fase 16 — Avisos y mensajes (backend, Días 45-46) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend completo de Avisos — modelo `Aviso`, publicación transaccional con fan-out de `Notificacion`, y los 5 endpoints (`POST/GET/GET :id/GET :id/recibos/DELETE`), con recibo de lectura sobre `Notificacion.leidoEn`.

**Architecture:** Módulo NestJS nuevo `src/avisos/` con el mismo patrón que `src/materias/` y `src/calendario/` (`SedeGuard` + `RolesGuard`, `@Roles` por método, `sedeId` de `@SedeActual()`, `rol` de `req.jwtClaims['rol']`). La publicación reutiliza **sin duplicar** los helpers de Fase 15 `validarAlcancePublicacion` y `resolverDestinatarios` (`src/common/publicacion/alcance-publicacion.util.ts`). El recibo de lectura NO es una tabla nueva: es la fila `Notificacion` (`tipo: AVISO`, `referenciaId: aviso.id`) de cada destinatario, con su `leidoEn`. `Notificacion.referenciaId` no tiene FK, así que `DELETE /avisos/:id` borra a mano las `Notificacion` asociadas dentro de la transacción.

**Tech Stack:** NestJS 11 + Prisma 6 + PostgreSQL/Supabase · class-validator/class-transformer para DTOs · Jest + supertest para e2e · `jose` para firmar JWT en tests.

## Global Constraints

- **Contrato de API:** éxito `{ data: ... }` (listas paginadas: `+ { page, limit, total }`); error `{ error: "mensaje", code: "TIPO" }`. camelCase. Fechas ISO 8601. — copiado de `CLAUDE.md`.
- **Sin códigos de error nuevos.** Reusar `VALIDATION_ERROR` (400), `NOT_FOUND` (404), `ROL_NO_AUTORIZADO` (403), `CONFLICT` (409). — spec Día 46.
- **Regla 2 (doble capa):** RLS por `sede_id` en Postgres + el service filtra además por `usuarioId`/`sedeId` donde aplique. El guard saca `sede_id` del JWT, jamás de body/query/path.
- **Regla 5 (auditoría solo inserción):** `AvisosService.publicar` audita `ALTA` y `eliminar` audita `ELIMINACION`, ambas **en la misma transacción** de la escritura. `entidad: 'Aviso'`.
- **Regla 12 (todo catch loguea):** cada `catch` hace `console.error('[AvisosService.<método>] ...', err)` con el error completo antes de responder.
- **Regla 14 (máx. 3 escrituras manuales a DB al verificar):** no aplica a la suite Jest (que corre completa y limpia sola); sí al agente si verifica algo a mano.
- **Migraciones:** `prisma migrate dev` está ROTO en el repo (`P3006` shadow-DB "schema auth does not exist"). Se genera con `prisma migrate diff --from-schema-datasource ... --to-schema-datamodel ... --script` y se aplica con `prisma migrate deploy`. NUNCA `migrate dev`.
- **`pnpm`** (no `npm`). Backend en `App/backend/`. Comandos de test: `pnpm test:e2e` (todo), o `pnpm test:e2e -- avisos` (una suite).
- **`prisma/seed.ts`** ya siembra sedes `CESP Mérida` / `CESP Valladolid` con `ADMINISTRATIVO`/`MAESTRO`/`ALUMNO` reales por sede. Fixtures nuevas (grupo/maestro/alumno) se crean desde cero en `beforeAll` y se limpian en `afterAll` **acotado a los ids exactos creados** (nunca por patrón de nombre/email — ese tipo de limpieza ya causó un bug en Día 24).

---

## File Structure

**Crear:**
- `App/backend/src/avisos/avisos.module.ts` — módulo, registra controller + service.
- `App/backend/src/avisos/avisos.controller.ts` — 5 rutas, guards, decorators.
- `App/backend/src/avisos/avisos.service.ts` — `publicar`, `feedDelActor`, `verDetalleYMarcarLeido`, `obtenerRecibos`, `eliminar`.
- `App/backend/src/avisos/dto/crear-aviso.dto.ts` — body de `POST /avisos`.
- `App/backend/src/avisos/dto/listar-avisos.query.dto.ts` — query de `GET /avisos` (`page`/`limit`).
- `App/backend/src/common/publicacion/correos-destinatarios.util.ts` — helper compartido `obtenerCorreosPersonales(prisma, usuarioIds)` (standalone, recibe `prisma` como arg — mismo estilo que `alcance-publicacion.util.ts`). Hoy lo consume solo Avisos; `CalendarioService.obtenerCorreosPersonales` (private, idéntico) queda SIN tocar este round por estabilidad — se anota para que Fase 17 unifique.
- `App/backend/prisma/migrations/<timestamp>_avisos/migration.sql` — `CREATE TABLE "avisos"` + FKs + bloque RLS anexado a mano.
- `App/backend/test/avisos.e2e-spec.ts` — suite e2e, scaffolding calcado de `test/calendario.e2e-spec.ts`.

**Modificar:**
- `App/backend/prisma/schema.prisma` — `model Aviso` nuevo + backrefs `avisosCreados Aviso[]` en `model Usuario` y `avisos Aviso[]` en `model Sede`.
- `App/backend/src/app.module.ts` — importar y registrar `AvisosModule`.
- `CLAUDE.md` — sección "Contrato de API" (5 rutas nuevas) + tabla "CRUD por tipo de entidad" (`Aviso` en "Negocio (no CRUD)") + "Fase actual".
- `documentacion_de_agentes/ESTADO.md` — entrada Días 45-46.
- `docs/roadmap.md` — marcar checkboxes de Días 45-46.

---

## Task 1: Modelo `Aviso` + migración + RLS

**Files:**
- Modify: `App/backend/prisma/schema.prisma`
- Create: `App/backend/prisma/migrations/<timestamp>_avisos/migration.sql`

**Interfaces:**
- Consumes: enum `AlcanceDestino` (`SEDE`/`CARRERA`/`GRUPO`), ya existe en el schema desde Fase 15.
- Produces: modelo Prisma `Aviso { id, sedeId, autorUsuarioId, titulo, cuerpo, alcanceTipo, alcanceId, createdAt }` + relaciones `sede`, `autor`. Tabla DB `avisos` con RLS `sede_isolation_avisos`.

- [ ] **Step 1: Agregar `model Aviso` al schema**

En `App/backend/prisma/schema.prisma`, después de `model EventoCalendario` / `model RecordatorioEnviado` (bloque de Fase 15), agregar:

```prisma
/// Aviso — Fase 16, Día 45. Broadcast de una vía con recibo de lectura.
/// El recibo NO vive acá: es la fila `Notificacion` (`tipo: AVISO`,
/// `referenciaId: aviso.id`) de cada destinatario, con su `leidoEn`.
/// `alcanceId` apunta a `Carrera.id` o `Grupo.id` según `alcanceTipo`, o
/// es null si `SEDE` — sin FK (el alcance se valida en
/// `validarAlcancePublicacion`, mismo criterio que `EventoCalendario`).
model Aviso {
  id             String         @id @default(uuid())
  sedeId         String         @map("sede_id")
  sede           Sede           @relation(fields: [sedeId], references: [id])
  autorUsuarioId String         @map("autor_usuario_id")
  autor          Usuario        @relation(fields: [autorUsuarioId], references: [id])
  titulo         String
  cuerpo         String
  alcanceTipo    AlcanceDestino @map("alcance_tipo")
  alcanceId      String?        @map("alcance_id")
  createdAt      DateTime       @default(now()) @map("created_at")

  @@index([sedeId, createdAt])
  @@map("avisos")
}
```

- [ ] **Step 2: Agregar los backrefs en `Usuario` y `Sede`**

En `model Usuario`, junto a `eventosCalendario   EventoCalendario[]`:

```prisma
  avisosCreados       Aviso[]
```

En `model Sede`, junto a `eventosCreados       EventoCalendario[]`:

```prisma
  avisos               Aviso[]
```

- [ ] **Step 3: Regenerar el cliente Prisma**

Run: `cd App/backend && pnpm exec prisma generate`
Expected: `✔ Generated Prisma Client`, sin errores de validación del schema.

- [ ] **Step 4: Generar el diff SQL contra la DB real de dev**

Run:
```bash
cd App/backend
pnpm exec prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > /tmp/avisos.sql
cat /tmp/avisos.sql
```
Expected: `CREATE TABLE "avisos"` con columnas `id`, `sede_id`, `autor_usuario_id`, `titulo`, `cuerpo`, `alcance_tipo` (tipo `"AlcanceDestino"`), `alcance_id`, `created_at`; `CREATE INDEX` para `(sede_id, created_at)`; 2 `ADD CONSTRAINT ... FOREIGN KEY` (`sede_id` → `sedes`, `autor_usuario_id` → `usuarios`). NO debe aparecer `CREATE TYPE "AlcanceDestino"` (ya existe). Si aparece, borrá esa línea del `.sql` antes de guardarlo.

- [ ] **Step 5: Guardar la migración y anexar el bloque RLS**

```bash
cd App/backend
mkdir -p "prisma/migrations/$(date +%Y%m%d%H%M%S)_avisos"
```
Copiar `/tmp/avisos.sql` a `prisma/migrations/<ese-timestamp>_avisos/migration.sql` (sin encabezado extra — el SQL generado ya trae los comentarios `-- CreateTable` / `-- CreateIndex` / `-- AddForeignKey`). Anexar al final (calcado de `sede_isolation_eventos_calendario` — RLS directa por `sede_id`):

```sql
-- ============================================================
-- AVISOS (sede_id directo)
-- ============================================================
ALTER TABLE "avisos" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "avisos" TO authenticated;

CREATE POLICY "sede_isolation_avisos" ON "avisos"
  FOR ALL
  USING (sede_id = public.current_sede_id())
  WITH CHECK (sede_id = public.current_sede_id());
```

- [ ] **Step 6: Aplicar contra la DB real de dev**

Run: `cd App/backend && pnpm exec prisma migrate deploy`
Expected: `The following migration(s) have been applied: ... <timestamp>_avisos`, sin errores.

- [ ] **Step 7: Verificar estado**

Run: `cd App/backend && pnpm exec prisma migrate status`
Expected: `Database schema is up to date!`

- [ ] **Step 8: Verificar que compila**

Run: `cd App/backend && pnpm build`
Expected: `nest build` sin errores de TypeScript.

- [ ] **Step 9: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/backend/prisma/schema.prisma App/backend/prisma/migrations/
git commit -m "$(cat <<'EOF'
feat(backend): modelo Aviso + migración + RLS (Fase 16, Día 45)

Tabla avisos con sede_id directo y RLS sede_isolation_avisos calcada de
eventos_calendario. alcanceId sin FK (se valida en validarAlcancePublicacion).
El recibo de lectura no es tabla nueva: es Notificacion.leidoEn por
destinatario. Migración vía migrate diff + migrate deploy (migrate dev roto,
P3006).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Dq42quDpEqPhLGmWRzyjbz
EOF
)"
```

---

## Task 2: `POST /avisos` — scaffold del módulo + `publicar` + fan-out

**Files:**
- Create: `App/backend/src/avisos/avisos.module.ts`
- Create: `App/backend/src/avisos/avisos.controller.ts`
- Create: `App/backend/src/avisos/avisos.service.ts`
- Create: `App/backend/src/avisos/dto/crear-aviso.dto.ts`
- Create: `App/backend/src/common/publicacion/correos-destinatarios.util.ts`
- Modify: `App/backend/src/app.module.ts`
- Create: `App/backend/test/avisos.e2e-spec.ts`

**Interfaces:**
- Consumes:
  - `validarAlcancePublicacion(prisma: PrismaService, actor: { usuarioId: string; rol: RolUsuario; sedeId: string }, alcanceTipo: AlcanceDestino, alcanceId: string | null): Promise<void>` — de `src/common/publicacion/alcance-publicacion.util.ts`. Lanza `ForbiddenException({error, code:'ROL_NO_AUTORIZADO'})` / `BadRequestException({..., code:'VALIDATION_ERROR'})` / `NotFoundException({..., code:'NOT_FOUND'})`.
  - `resolverDestinatarios(prisma: PrismaService, sedeId: string, alcanceTipo: AlcanceDestino, alcanceId: string | null): Promise<string[]>` — mismo archivo. Solo `Usuario.activo: true`, sin duplicados.
  - `MailService.enviarNotificacion({ correoDestino: string; asunto: string; cuerpoTexto: string; cuerpoHtml?: string }): Promise<void>` — de `src/mail/mail.service.ts`. No lanza si `MAILGUN_ENVIOS_HABILITADO` está apagado (loguea y retorna). Registrar `MailModule` en los imports de `AvisosModule`.
  - Decorators `@SedeActual()`, `@ActorUsuarioId()`, `@Roles()` de `src/common/decorators/`; guards `SedeGuard`, `RolesGuard` de `src/common/guards/`.
- Produces:
  - `AvisosService.publicar(dto: CrearAvisoDto, actor: { usuarioId: string; rol: RolUsuario; sedeId: string }): Promise<AvisoDto>` con `AvisoDto = { id: string; sedeId: string; autorUsuarioId: string; titulo: string; cuerpo: string; alcanceTipo: AlcanceDestino; alcanceId: string | null; createdAt: Date }`.
  - `obtenerCorreosPersonales(prisma: PrismaService, usuarioIds: string[]): Promise<{ usuarioId: string; correoPersonal: string }[]>` en `correos-destinatarios.util.ts`.
  - Ruta `POST /avisos`.

- [ ] **Step 1: Escribir la suite e2e con los casos de publicación (failing)**

Crear `App/backend/test/avisos.e2e-spec.ts`. Calcar el scaffolding EXACTO de `test/calendario.e2e-spec.ts` (imports, `loadEnv()`, `firmarToken(sub, rol, sedeId)` que firma `{ role:'authenticated', sede_id, rol }` con `jose` ES256 `kid:'test-key-1'`, `beforeAll` que hace `Test.createTestingModule({ imports:[AppModule] }).overrideProvider(SEDE_GUARD_ENV_OVERRIDE).useValue({ jwks:{ keys:[publicJwk] } })`, `configureApp(app)`, y ubica `sedeMeridaId`/`sedeValladolidId` con `prisma.sede.findUniqueOrThrow({ where:{ nombre:'CESP Mérida' } })` etc.).

Fixtures a crear desde cero en `beforeAll` (calcar `crearGrupo`/`crearMateria`/`crearMaestro` de `calendario.e2e-spec.ts`, más un `crearAlumnoMatriculado`):
- `sedeMeridaId`, `sedeValladolidId`.
- `adminMeridaId`, `adminValladolidId` — de seed (`prisma.usuario.findFirstOrThrow({ where:{ rol:'ADMINISTRATIVO', sedeId: sedeMeridaId } })`).
- Una carrera + salón de Mérida (de seed: `prisma.carrera.findFirstOrThrow({ where:{ sedeId: sedeMeridaId } })`, idem salón).
- `grupoId` (Mérida) vía `prisma.grupo.create` — guardar en `grupoIdsCreados`.
- `maestroConAsignacionId` — `crearMaestro(sedeMeridaId)` + `POST /grupos/:grupoId/asignaciones` (necesita una `materia` del ciclo del grupo) para que tenga fila real en `GrupoMateriaMaestro`.
- `alumnoMatriculadoId` — crear `Usuario`+`PerfilAlumno` (carrera = la del grupo) y `prisma.grupoAlumno.create({ data:{ grupoId, alumnoId: <perfilAlumno.id> } })`.
- `otroAlumnoMeridaId` — alumno de Mérida NO matriculado en el grupo (para verificar que un aviso de alcance `GRUPO` no le llega).
- Arrays `avisoIdsCreados`, `grupoIdsCreados`, `materiaIdsCreados`, `usuarioIdsCreados`, `perfilAlumnoIdsCreados`, `grupoAlumnoIdsCreados`, `asignacionIdsCreados` para el `afterAll`.

`afterAll` — borrar en orden inverso de dependencia, acotado a esos ids: `notificacion.deleteMany({ where:{ referenciaId:{ in: avisoIdsCreados } } })`, `aviso.deleteMany({ where:{ id:{ in: avisoIdsCreados } } })`, `registroAuditoria.deleteMany({ where:{ entidad:'Aviso', entidadId:{ in: avisoIdsCreados } } })`, luego `grupoMateriaMaestro`/`grupoAlumno`/`grupo`/`materia`/`perfilAlumno`/`perfilMaestro`/`usuario` por id, y `await app.close()`.

Helper:
```ts
async function postAviso(token: string, body: Record<string, unknown>) {
  const res = await request(app.getHttpServer())
    .post('/avisos')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  if (res.status === 201) avisoIdsCreados.push((res.body as AvisoBody).data.id);
  return res;
}
```

Casos (`describe('POST /avisos')`):

```ts
it('admin publica a un GRUPO: 201, crea una Notificacion por matriculado + maestro asignado, excluye al autor', async () => {
  const res = await postAviso(await tokenAdminMerida(), {
    titulo: 'Junta de padres', cuerpo: 'El viernes a las 5pm en el auditorio.',
    alcanceTipo: 'GRUPO', alcanceId: grupoId,
  });
  expect(res.status).toBe(201);
  expect(res.body.data).toMatchObject({
    titulo: 'Junta de padres', alcanceTipo: 'GRUPO', alcanceId: grupoId,
    sedeId: sedeMeridaId, autorUsuarioId: adminMeridaId,
  });
  const notifs = await prisma.notificacion.findMany({
    where: { referenciaId: res.body.data.id, tipo: 'AVISO' },
  });
  const destinatarios = notifs.map((n) => n.usuarioId).sort();
  // alumno matriculado + maestro asignado; NO el autor, NO otroAlumnoMerida
  expect(destinatarios).toEqual([alumnoMatriculadoId, maestroConAsignacionId].sort());
  expect(destinatarios).not.toContain(adminMeridaId);
  notifs.forEach((n) => {
    expect(n.titulo).toBe('Junta de padres');
    expect(n.cuerpoCorto.length).toBeLessThanOrEqual(140);
    expect(n.leidoEn).toBeNull();
    expect(n.sedeId).toBe(sedeMeridaId);
  });
});

it('audita ALTA en la misma transacción', async () => {
  const res = await postAviso(await tokenAdminMerida(), {
    titulo: 'Aviso auditado', cuerpo: 'x', alcanceTipo: 'SEDE',
  });
  const audit = await prisma.registroAuditoria.findFirst({
    where: { entidad: 'Aviso', entidadId: res.body.data.id },
  });
  expect(audit).not.toBeNull();
  expect(audit!.accion).toBe('ALTA');
  expect(audit!.usuarioId).toBe(adminMeridaId);
  expect(audit!.sedeId).toBe(sedeMeridaId);
});

it('maestro publica a un GRUPO donde tiene asignación: 201', async () => {
  const res = await postAviso(await tokenMaestro(), {
    titulo: 'Traer calculadora', cuerpo: 'Para el examen del martes.',
    alcanceTipo: 'GRUPO', alcanceId: grupoId,
  });
  expect(res.status).toBe(201);
});

it('maestro publica a SEDE: 403 ROL_NO_AUTORIZADO', async () => {
  const res = await postAviso(await tokenMaestro(), {
    titulo: 'x', cuerpo: 'x', alcanceTipo: 'SEDE',
  });
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('ROL_NO_AUTORIZADO');
});

it('maestro publica a un grupo ajeno: 403', async () => {
  const grupoAjeno = await prisma.grupo.create({ data: { /* Mérida, sin asignación de este maestro */
    sedeId: sedeMeridaId, carreraId, salonId, nombre: `Ajeno ${randomUUID().slice(0,8)}`,
    anioInicio: 2027, cicloActual: 1, capacidad: 10,
  } });
  grupoIdsCreados.push(grupoAjeno.id);
  const res = await postAviso(await tokenMaestro(), {
    titulo: 'x', cuerpo: 'x', alcanceTipo: 'GRUPO', alcanceId: grupoAjeno.id,
  });
  expect(res.status).toBe(403);
});

it('alumno publica: 403', async () => {
  const res = await postAviso(await tokenAlumno(), {
    titulo: 'x', cuerpo: 'x', alcanceTipo: 'SEDE',
  });
  expect(res.status).toBe(403);
});

it('alcanceTipo GRUPO sin alcanceId: 400 VALIDATION_ERROR', async () => {
  const res = await postAviso(await tokenAdminMerida(), {
    titulo: 'x', cuerpo: 'x', alcanceTipo: 'GRUPO',
  });
  expect(res.status).toBe(400);
  expect(res.body.code).toBe('VALIDATION_ERROR');
});

it('alcanceTipo SEDE con alcanceId: 400 VALIDATION_ERROR', async () => {
  const res = await postAviso(await tokenAdminMerida(), {
    titulo: 'x', cuerpo: 'x', alcanceTipo: 'SEDE', alcanceId: grupoId,
  });
  expect(res.status).toBe(400);
});

it('titulo vacío: 400', async () => {
  const res = await postAviso(await tokenAdminMerida(), {
    titulo: '', cuerpo: 'x', alcanceTipo: 'SEDE',
  });
  expect(res.status).toBe(400);
});

it('admin de Valladolid publica a un grupo de Mérida: 404 (cross-sede)', async () => {
  const res = await postAviso(await tokenAdminValladolid(), {
    titulo: 'x', cuerpo: 'x', alcanceTipo: 'GRUPO', alcanceId: grupoId,
  });
  expect(res.status).toBe(404);
});

it('sin Authorization: 401', async () => {
  const res = await request(app.getHttpServer()).post('/avisos').send({
    titulo: 'x', cuerpo: 'x', alcanceTipo: 'SEDE',
  });
  expect(res.status).toBe(401);
});
```

- [ ] **Step 2: Correr la suite y verificar que falla**

Run: `cd App/backend && pnpm test:e2e -- avisos`
Expected: FAIL — todos los casos dan 404 (ruta `/avisos` no existe todavía).

- [ ] **Step 3: Crear el helper compartido de correos**

Crear `App/backend/src/common/publicacion/correos-destinatarios.util.ts`:

```ts
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Resuelve `correoPersonal` para una lista de `Usuario.id`, cualquiera que
 * sea su rol — el correo real/legible SIEMPRE es `correoPersonal` del
 * perfil, nunca `Usuario.email` (login sintético, ver Fase 4). Usuarios
 * sin ningún perfil se omiten silenciosamente (no hay a dónde escribir).
 * Devuelve el par `usuarioId`/`correoPersonal` para poder identificar en
 * el log a qué destinatario correspondió un envío fallido (regla 12).
 *
 * Standalone (recibe `prisma` como arg, igual que `resolverDestinatarios`
 * en `alcance-publicacion.util.ts`). `CalendarioService.obtenerCorreosPersonales`
 * es una copia private idéntica — se deja sin tocar por estabilidad; Fase 17
 * la unifica contra esta función.
 */
export async function obtenerCorreosPersonales(
  prisma: PrismaService,
  usuarioIds: string[],
): Promise<{ usuarioId: string; correoPersonal: string }[]> {
  if (usuarioIds.length === 0) return [];
  const [alumnos, maestros, administrativos] = await Promise.all([
    prisma.perfilAlumno.findMany({
      where: { usuarioId: { in: usuarioIds } },
      select: { usuarioId: true, correoPersonal: true },
    }),
    prisma.perfilMaestro.findMany({
      where: { usuarioId: { in: usuarioIds } },
      select: { usuarioId: true, correoPersonal: true },
    }),
    prisma.perfilAdministrativo.findMany({
      where: { usuarioId: { in: usuarioIds } },
      select: { usuarioId: true, correoPersonal: true },
    }),
  ]);
  return [...alumnos, ...maestros, ...administrativos];
}
```

- [ ] **Step 4: Crear el DTO de `POST /avisos`**

Crear `App/backend/src/avisos/dto/crear-aviso.dto.ts`:

```ts
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AlcanceDestino } from '@prisma/client';

/**
 * `POST /avisos` — Fase 16, Día 46. `sedeId` NUNCA va acá (regla 2 — sale
 * de `@SedeActual()`). La coherencia `alcanceTipo` ↔ `alcanceId` (SEDE sin
 * id, CARRERA/GRUPO con id) la valida `validarAlcancePublicacion` en el
 * service — acá solo el shape de cada campo.
 */
export class CrearAvisoDto {
  @IsString()
  @IsNotEmpty({ message: 'titulo es requerido' })
  @MaxLength(160, { message: 'titulo no puede exceder 160 caracteres' })
  titulo!: string;

  @IsString()
  @IsNotEmpty({ message: 'cuerpo es requerido' })
  @MaxLength(5000, { message: 'cuerpo no puede exceder 5000 caracteres' })
  cuerpo!: string;

  @IsEnum(AlcanceDestino, { message: 'alcanceTipo debe ser SEDE, CARRERA o GRUPO' })
  alcanceTipo!: AlcanceDestino;

  @IsOptional()
  @IsUUID('4', { message: 'alcanceId debe ser un UUID válido' })
  alcanceId?: string;
}
```

- [ ] **Step 5: Crear el service con `publicar`**

Crear `App/backend/src/avisos/avisos.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { AccionAuditoria, AlcanceDestino, RolUsuario } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  resolverDestinatarios,
  validarAlcancePublicacion,
} from '../common/publicacion/alcance-publicacion.util';
import { obtenerCorreosPersonales } from '../common/publicacion/correos-destinatarios.util';
import type { CrearAvisoDto } from './dto/crear-aviso.dto';

export interface ActorAviso {
  usuarioId: string;
  rol: RolUsuario;
  sedeId: string;
}

export interface AvisoDto {
  id: string;
  sedeId: string;
  autorUsuarioId: string;
  titulo: string;
  cuerpo: string;
  alcanceTipo: AlcanceDestino;
  alcanceId: string | null;
  createdAt: Date;
}

/** Lote para el fan-out best-effort del correo (mismo criterio que el job
 * de recordatorios, `LOTE_CORREOS_RECORDATORIO` = 20). */
const LOTE_CORREOS_AVISO = 20;

@Injectable()
export class AvisosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  /**
   * `POST /avisos` — Fase 16. Todo en una transacción: valida alcance →
   * crea `Aviso` → resuelve destinatarios (excluye al autor) → `createMany`
   * de `Notificacion` (`tipo: AVISO`, `cuerpoCorto` = primeros 140 chars) →
   * audita `ALTA`. Después de confirmar: correo best-effort por lotes, cada
   * fallo logueado, ninguno tumba la publicación (patrón `altaPersona`).
   */
  async publicar(dto: CrearAvisoDto, actor: ActorAviso): Promise<AvisoDto> {
    const alcanceId = dto.alcanceId ?? null;
    await validarAlcancePublicacion(
      this.prisma,
      actor,
      dto.alcanceTipo,
      alcanceId,
    );

    let aviso: AvisoDto;
    let destinatarios: string[];
    try {
      const resultado = await this.prisma.$transaction(async (tx) => {
        const creado = await tx.aviso.create({
          data: {
            sedeId: actor.sedeId,
            autorUsuarioId: actor.usuarioId,
            titulo: dto.titulo,
            cuerpo: dto.cuerpo,
            alcanceTipo: dto.alcanceTipo,
            alcanceId,
          },
        });

        const todos = await resolverDestinatarios(
          tx as unknown as PrismaService,
          actor.sedeId,
          dto.alcanceTipo,
          alcanceId,
        );
        const dest = todos.filter((id) => id !== actor.usuarioId);

        if (dest.length > 0) {
          await tx.notificacion.createMany({
            data: dest.map((usuarioId) => ({
              usuarioId,
              sedeId: actor.sedeId,
              tipo: 'AVISO' as const,
              referenciaId: creado.id,
              titulo: creado.titulo,
              cuerpoCorto: creado.cuerpo.slice(0, 140),
            })),
          });
        }

        await tx.registroAuditoria.create({
          data: {
            usuarioId: actor.usuarioId,
            sedeId: actor.sedeId,
            accion: AccionAuditoria.ALTA,
            entidad: 'Aviso',
            entidadId: creado.id,
            detalle: { titulo: creado.titulo, alcanceTipo: creado.alcanceTipo },
          },
        });

        return { creado, dest };
      });
      aviso = resultado.creado;
      destinatarios = resultado.dest;
    } catch (err) {
      console.error('[AvisosService.publicar] error inesperado:', err);
      throw err;
    }

    // Efecto best-effort: correo. Un fallo acá NO tumba la publicación.
    try {
      if (destinatarios.length > 0) {
        const correos = await obtenerCorreosPersonales(
          this.prisma,
          destinatarios,
        );
        for (let i = 0; i < correos.length; i += LOTE_CORREOS_AVISO) {
          const lote = correos.slice(i, i + LOTE_CORREOS_AVISO);
          const resultados = await Promise.allSettled(
            lote.map((c) =>
              this.mailService.enviarNotificacion({
                correoDestino: c.correoPersonal,
                asunto: `Nuevo aviso: ${aviso.titulo}`,
                cuerpoTexto: aviso.cuerpo,
              }),
            ),
          );
          resultados.forEach((r, idx) => {
            if (r.status === 'rejected') {
              console.error(
                `[AvisosService.publicar] fallo al enviar correo de aviso ${aviso.id} a usuarioId ${lote[idx].usuarioId}:`,
                r.reason,
              );
            }
          });
        }
      }
    } catch (err) {
      console.error(
        `[AvisosService.publicar] fallo en el fan-out de correo del aviso ${aviso.id}:`,
        err,
      );
    }

    return aviso;
  }
}
```

Nota: `resolverDestinatarios` está tipado para `PrismaService` pero solo usa métodos de modelo (`.usuario.findMany`, etc.) que el cliente transaccional `tx` también expone — el cast `tx as unknown as PrismaService` es seguro y mantiene el fan-out DENTRO de la transacción. Si el cast molesta al lint, alternativa: resolver destinatarios con `this.prisma` justo ANTES de abrir la transacción (el trade-off es una lectura fuera de la tx; aceptable porque el alcance no cambia en milisegundos). Elegir la primera opción salvo que `pnpm lint` la rechace.

- [ ] **Step 6: Crear el controller**

Crear `App/backend/src/avisos/avisos.controller.ts`:

```ts
import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { RolUsuario } from '@prisma/client';
import { ActorUsuarioId } from '../common/decorators/actor-usuario-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SedeActual } from '../common/decorators/sede-actual.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { SedeGuard } from '../common/guards/sede.guard';
import { CrearAvisoDto } from './dto/crear-aviso.dto';
import { AvisosService } from './avisos.service';

/**
 * Avisos — Fase 16. `SedeGuard` (clase) + `RolesGuard`; `@Roles` por
 * método. `sedeId` de `@SedeActual()`, `rol` de `req.jwtClaims['rol']`
 * (mismo patrón que `CalendarioController` — no hay decorator `@ActorRol()`
 * en el repo).
 */
@Controller('avisos')
@UseGuards(SedeGuard, RolesGuard)
export class AvisosController {
  constructor(private readonly avisosService: AvisosService) {}

  @Post()
  @HttpCode(201)
  @Roles(RolUsuario.ADMINISTRATIVO, RolUsuario.MAESTRO)
  async publicar(
    @Body() body: CrearAvisoDto,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
    @Req() req: Request,
  ) {
    const rol = req.jwtClaims?.['rol'] as RolUsuario;
    const data = await this.avisosService.publicar(body, {
      usuarioId: actorUsuarioId,
      rol,
      sedeId,
    });
    return { data };
  }
}
```

- [ ] **Step 7: Crear el módulo y registrarlo**

Crear `App/backend/src/avisos/avisos.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { AvisosController } from './avisos.controller';
import { AvisosService } from './avisos.service';

@Module({
  imports: [MailModule],
  controllers: [AvisosController],
  providers: [AvisosService],
})
export class AvisosModule {}
```

En `App/backend/src/app.module.ts`: agregar `import { AvisosModule } from './avisos/avisos.module';` con los otros imports y `AvisosModule,` en el array `imports` de `@Module` (después de `CalendarioModule,`).

- [ ] **Step 8: Correr la suite y verificar que pasa**

Run: `cd App/backend && pnpm test:e2e -- avisos`
Expected: PASS — todos los casos de `describe('POST /avisos')` en verde.

- [ ] **Step 9: Verificar build + lint**

Run: `cd App/backend && pnpm build && pnpm lint`
Expected: sin errores.

- [ ] **Step 10: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/backend/src/avisos/ App/backend/src/common/publicacion/correos-destinatarios.util.ts App/backend/src/app.module.ts App/backend/test/avisos.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(backend): POST /avisos — publicación con fan-out de Notificacion (Fase 16, Día 46)

Módulo src/avisos/ nuevo. publicar() en una transacción: valida alcance con
validarAlcancePublicacion (reusa Fase 15) -> crea Aviso -> resolverDestinatarios
excluyendo al autor -> createMany de Notificacion (tipo AVISO, cuerpoCorto 140
chars) -> audita ALTA. Correo best-effort por lotes tras confirmar. Helper
compartido obtenerCorreosPersonales en src/common/publicacion/.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Dq42quDpEqPhLGmWRzyjbz
EOF
)"
```

---

## Task 3: `GET /avisos` (feed del actor) + `GET /avisos/:id` (detalle + marca leído)

**Files:**
- Modify: `App/backend/src/avisos/avisos.controller.ts`
- Modify: `App/backend/src/avisos/avisos.service.ts`
- Create: `App/backend/src/avisos/dto/listar-avisos.query.dto.ts`
- Modify: `App/backend/test/avisos.e2e-spec.ts`

**Interfaces:**
- Consumes: `AvisosService` (Task 2), fixtures del `beforeAll` (Task 2).
- Produces:
  - `AvisosService.feedDelActor(actorUsuarioId: string, page: number, limit: number): Promise<{ data: FeedItem[]; page: number; limit: number; total: number }>` con `FeedItem = { id: string; titulo: string; cuerpo: string; autor: { nombres: string; apellidoPaterno: string }; createdAt: Date; leidoEn: Date | null }`.
  - `AvisosService.verDetalleYMarcarLeido(id: string, actorUsuarioId: string): Promise<FeedItem>` — lanza `NotFoundException({..., code:'NOT_FOUND'})` si el actor no tiene `Notificacion` `tipo: AVISO` para ese aviso.
  - Rutas `GET /avisos`, `GET /avisos/:id`.

- [ ] **Step 1: Escribir los casos e2e de feed + detalle (failing)**

Agregar a `test/avisos.e2e-spec.ts` un `describe('GET /avisos y GET /avisos/:id')`. Usar `tokenAlumno()` (alumno matriculado, destinatario) y `tokenAdminMerida()`.

```ts
it('el feed del alumno trae solo los avisos que le llegaron, orden createdAt desc', async () => {
  // publica 2 avisos a GRUPO (el alumno es destinatario) + 1 a un grupo ajeno
  await postAviso(await tokenAdminMerida(), { titulo: 'Feed A', cuerpo: 'aaa', alcanceTipo: 'GRUPO', alcanceId: grupoId });
  await postAviso(await tokenAdminMerida(), { titulo: 'Feed B', cuerpo: 'bbb', alcanceTipo: 'GRUPO', alcanceId: grupoId });
  const res = await request(app.getHttpServer())
    .get('/avisos?page=1&limit=50')
    .set('Authorization', `Bearer ${await tokenAlumno()}`);
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('page', 1);
  expect(res.body).toHaveProperty('total');
  const titulos = res.body.data.map((a: { titulo: string }) => a.titulo);
  expect(titulos).toEqual(expect.arrayContaining(['Feed A', 'Feed B']));
  // orden desc: el índice de 'Feed B' (más nuevo) es menor que el de 'Feed A'
  expect(titulos.indexOf('Feed B')).toBeLessThan(titulos.indexOf('Feed A'));
  res.body.data.forEach((a: { autor: unknown; leidoEn: unknown }) => {
    expect(a.autor).toHaveProperty('apellidoPaterno');
  });
});

it('GET /avisos/:id devuelve el aviso completo y marca leído (leidoEn pasa de null a fecha)', async () => {
  const pub = await postAviso(await tokenAdminMerida(), { titulo: 'Para leer', cuerpo: 'contenido completo', alcanceTipo: 'GRUPO', alcanceId: grupoId });
  const antes = await prisma.notificacion.findFirst({ where: { referenciaId: pub.body.data.id, usuarioId: alumnoMatriculadoId } });
  expect(antes!.leidoEn).toBeNull();

  const res = await request(app.getHttpServer())
    .get(`/avisos/${pub.body.data.id}`)
    .set('Authorization', `Bearer ${await tokenAlumno()}`);
  expect(res.status).toBe(200);
  expect(res.body.data).toMatchObject({ titulo: 'Para leer', cuerpo: 'contenido completo' });
  expect(res.body.data.leidoEn).not.toBeNull();

  const despues = await prisma.notificacion.findFirst({ where: { referenciaId: pub.body.data.id, usuarioId: alumnoMatriculadoId } });
  expect(despues!.leidoEn).not.toBeNull();
});

it('GET /avisos/:id es idempotente: una segunda lectura no cambia leidoEn', async () => {
  const pub = await postAviso(await tokenAdminMerida(), { titulo: 'Idem', cuerpo: 'x', alcanceTipo: 'GRUPO', alcanceId: grupoId });
  await request(app.getHttpServer()).get(`/avisos/${pub.body.data.id}`).set('Authorization', `Bearer ${await tokenAlumno()}`);
  const primera = await prisma.notificacion.findFirst({ where: { referenciaId: pub.body.data.id, usuarioId: alumnoMatriculadoId } });
  await new Promise((r) => setTimeout(r, 10));
  await request(app.getHttpServer()).get(`/avisos/${pub.body.data.id}`).set('Authorization', `Bearer ${await tokenAlumno()}`);
  const segunda = await prisma.notificacion.findFirst({ where: { referenciaId: pub.body.data.id, usuarioId: alumnoMatriculadoId } });
  expect(segunda!.leidoEn!.getTime()).toBe(primera!.leidoEn!.getTime());
});

it('GET /avisos/:id por alguien que NO era destinatario: 404', async () => {
  const pub = await postAviso(await tokenAdminMerida(), { titulo: 'No para ti', cuerpo: 'x', alcanceTipo: 'GRUPO', alcanceId: grupoId });
  // otroAlumnoMerida NO está matriculado en grupoId -> no tiene Notificacion
  const res = await request(app.getHttpServer())
    .get(`/avisos/${pub.body.data.id}`)
    .set('Authorization', `Bearer ${await firmarToken(otroAlumnoMeridaId, RolUsuario.ALUMNO, sedeMeridaId)}`);
  expect(res.status).toBe(404);
});

it('GET /avisos/:id inexistente: 404', async () => {
  const res = await request(app.getHttpServer())
    .get(`/avisos/${randomUUID()}`)
    .set('Authorization', `Bearer ${await tokenAlumno()}`);
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd App/backend && pnpm test:e2e -- avisos`
Expected: FAIL — los casos nuevos dan 404 (rutas GET no existen); los de Task 2 siguen en verde.

- [ ] **Step 3: Crear el query DTO**

Crear `App/backend/src/avisos/dto/listar-avisos.query.dto.ts` (calcar `ListarEventosListadoQueryDto` / el patrón de `GET /grupos`):

```ts
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Query de `GET /avisos` — Fase 16. Paginación estándar del contrato. */
export class ListarAvisosQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page debe ser un entero' })
  @Min(1, { message: 'page debe ser al menos 1' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit debe ser un entero' })
  @Min(1, { message: 'limit debe ser al menos 1' })
  @Max(100, { message: 'limit no puede exceder 100' })
  limit?: number;
}
```

- [ ] **Step 4: Agregar `feedDelActor` y `verDetalleYMarcarLeido` al service**

En `AvisosService`, agregar el tipo `FeedItem` y los 2 métodos. Importar `NotFoundException` de `@nestjs/common`.

```ts
export interface FeedItem {
  id: string;
  titulo: string;
  cuerpo: string;
  autor: { nombres: string; apellidoPaterno: string };
  createdAt: Date;
  leidoEn: Date | null;
}

/**
 * `GET /avisos` — feed del actor: los avisos que le llegaron (join contra
 * sus `Notificacion` `tipo: AVISO`). Doble filtro (regla 2): RLS por sede +
 * `usuarioId` del actor. Orden `createdAt desc` del aviso. `leidoEn` sale
 * de la `Notificacion` del actor.
 */
async feedDelActor(
  actorUsuarioId: string,
  page: number,
  limit: number,
): Promise<{ data: FeedItem[]; page: number; limit: number; total: number }> {
  try {
    const where = {
      notificaciones: {
        some: { usuarioId: actorUsuarioId, tipo: 'AVISO' as const },
      },
    };
    const [total, avisos] = await Promise.all([
      this.prisma.aviso.count({ where }),
      this.prisma.aviso.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          titulo: true,
          cuerpo: true,
          createdAt: true,
          autor: { select: { /* ver nota abajo */ } },
          notificaciones: {
            where: { usuarioId: actorUsuarioId, tipo: 'AVISO' as const },
            select: { leidoEn: true },
          },
        },
      }),
    ]);
    const data: FeedItem[] = avisos.map((a) => ({
      id: a.id,
      titulo: a.titulo,
      cuerpo: a.cuerpo,
      autor: this.nombreAutor(a.autor),
      createdAt: a.createdAt,
      leidoEn: a.notificaciones[0]?.leidoEn ?? null,
    }));
    return { data, page, limit, total };
  } catch (err) {
    console.error('[AvisosService.feedDelActor] error inesperado:', err);
    throw err;
  }
}
```

**Nota sobre `autor` (`Usuario` no tiene `nombres`/`apellidoPaterno` — viven en los 3 perfiles).** Agregar un helper privado que resuelve el nombre desde el perfil que exista:

```ts
/** El nombre legible vive en `PerfilAlumno`/`PerfilMaestro`/`PerfilAdministrativo`,
 * no en `Usuario`. El autor de un aviso es siempre ADMINISTRATIVO o MAESTRO,
 * pero se cubren los 3 por robustez. */
private async resolverNombresAutores(
  autorIds: string[],
): Promise<Map<string, { nombres: string; apellidoPaterno: string }>> {
  const [al, ma, ad] = await Promise.all([
    this.prisma.perfilAlumno.findMany({
      where: { usuarioId: { in: autorIds } },
      select: { usuarioId: true, nombres: true, apellidoPaterno: true },
    }),
    this.prisma.perfilMaestro.findMany({
      where: { usuarioId: { in: autorIds } },
      select: { usuarioId: true, nombres: true, apellidoPaterno: true },
    }),
    this.prisma.perfilAdministrativo.findMany({
      where: { usuarioId: { in: autorIds } },
      select: { usuarioId: true, nombres: true, apellidoPaterno: true },
    }),
  ]);
  const map = new Map<string, { nombres: string; apellidoPaterno: string }>();
  [...al, ...ma, ...ad].forEach((p) =>
    map.set(p.usuarioId, { nombres: p.nombres, apellidoPaterno: p.apellidoPaterno }),
  );
  return map;
}
```

Ajustar `feedDelActor`: quitar el `autor: { select: ... }` del `select` de Prisma, quedarse con `autorUsuarioId: true`; después del `findMany`, llamar `resolverNombresAutores([...new Set(avisos.map(a => a.autorUsuarioId))])` y mapear `autor: map.get(a.autorUsuarioId) ?? { nombres: '', apellidoPaterno: '' }`.

```ts
/**
 * `GET /avisos/:id` — devuelve el aviso completo Y marca la `Notificacion`
 * del actor como leída (`leidoEn = now()` si estaba null) — esto ES el
 * registro del recibo. Actor sin `Notificacion` para este aviso → 404
 * (no era destinatario; mismo criterio de "no revelar" que el resto).
 */
async verDetalleYMarcarLeido(
  id: string,
  actorUsuarioId: string,
): Promise<FeedItem> {
  try {
    const notif = await this.prisma.notificacion.findFirst({
      where: { referenciaId: id, usuarioId: actorUsuarioId, tipo: 'AVISO' },
      select: { id: true, leidoEn: true },
    });
    if (!notif) {
      throw new NotFoundException({ error: 'Aviso no encontrado', code: 'NOT_FOUND' });
    }
    const aviso = await this.prisma.aviso.findUniqueOrThrow({
      where: { id },
      select: { id: true, titulo: true, cuerpo: true, createdAt: true, autorUsuarioId: true },
    });
    let leidoEn = notif.leidoEn;
    if (leidoEn === null) {
      const upd = await this.prisma.notificacion.update({
        where: { id: notif.id },
        data: { leidoEn: new Date() },
        select: { leidoEn: true },
      });
      leidoEn = upd.leidoEn;
    }
    const nombres = await this.resolverNombresAutores([aviso.autorUsuarioId]);
    return {
      id: aviso.id,
      titulo: aviso.titulo,
      cuerpo: aviso.cuerpo,
      autor: nombres.get(aviso.autorUsuarioId) ?? { nombres: '', apellidoPaterno: '' },
      createdAt: aviso.createdAt,
      leidoEn,
    };
  } catch (err) {
    if (err instanceof NotFoundException) throw err;
    console.error('[AvisosService.verDetalleYMarcarLeido] error inesperado:', err);
    throw err;
  }
}
```

- [ ] **Step 5: Agregar las rutas al controller**

En `AvisosController`, agregar imports `Get`, `Param`, `Query`, `ListarAvisosQueryDto`, y:

```ts
@Get()
async feed(
  @Query() query: ListarAvisosQueryDto,
  @ActorUsuarioId() actorUsuarioId: string,
) {
  return this.avisosService.feedDelActor(
    actorUsuarioId,
    query.page ?? 1,
    query.limit ?? 20,
  );
}

@Get(':id')
async detalle(
  @Param('id') id: string,
  @ActorUsuarioId() actorUsuarioId: string,
) {
  const data = await this.avisosService.verDetalleYMarcarLeido(id, actorUsuarioId);
  return { data };
}
```

Sin `@Roles` en ninguna de las 2 (los 3 roles pueden leer sus propios avisos — mismo criterio que `GET /perfil` / `GET /notificaciones`). `feedDelActor` ya devuelve la forma `{ data, page, limit, total }` — no re-envolver.

- [ ] **Step 6: Correr la suite completa de avisos**

Run: `cd App/backend && pnpm test:e2e -- avisos`
Expected: PASS — `POST` (Task 2) + `GET`/`GET :id` (Task 3), todo en verde.

- [ ] **Step 7: Build + lint**

Run: `cd App/backend && pnpm build && pnpm lint`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/backend/src/avisos/ App/backend/test/avisos.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(backend): GET /avisos (feed) + GET /avisos/:id (detalle + marca leído) (Fase 16, Día 46)

Feed del actor por join contra sus Notificacion tipo AVISO, paginado, orden
createdAt desc. GET /:id devuelve el aviso completo y setea leidoEn=now() si
estaba null (registra el recibo), idempotente; no-destinatario -> 404. Nombre
del autor resuelto desde el perfil (Usuario no lo tiene).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Dq42quDpEqPhLGmWRzyjbz
EOF
)"
```

---

## Task 4: `GET /avisos/:id/recibos` + `DELETE /avisos/:id`

**Files:**
- Modify: `App/backend/src/avisos/avisos.controller.ts`
- Modify: `App/backend/src/avisos/avisos.service.ts`
- Modify: `App/backend/test/avisos.e2e-spec.ts`

**Interfaces:**
- Consumes: `AvisosService`, fixtures del `beforeAll`.
- Produces:
  - `AvisosService.obtenerRecibos(id: string, actor: ActorAviso): Promise<{ total: number; leidos: number; noLeidos: number; destinatarios: { usuarioId: string; nombreCompleto: string; rol: RolUsuario; leidoEn: Date | null }[] }>` — `ForbiddenException({..., code:'ROL_NO_AUTORIZADO'})` si el actor no es el autor ni un `ADMINISTRATIVO`; `NotFoundException` si el aviso no existe o es de otra sede.
  - `AvisosService.eliminar(id: string, actor: ActorAviso): Promise<{ ok: true }>` — `NotFoundException` si no existe / otra sede; `ForbiddenException` si no es autor ni `ADMINISTRATIVO`. DELETE real del `Aviso` + `deleteMany` de sus `Notificacion`, audita `ELIMINACION`, todo en una transacción.
  - Rutas `GET /avisos/:id/recibos`, `DELETE /avisos/:id`.

- [ ] **Step 1: Escribir los casos e2e de recibos + delete (failing)**

Agregar `describe('GET /avisos/:id/recibos y DELETE /avisos/:id')`:

```ts
it('el autor ve los recibos: total, leidos, noLeidos y la lista con leidoEn', async () => {
  const pub = await postAviso(await tokenAdminMerida(), { titulo: 'Con recibos', cuerpo: 'x', alcanceTipo: 'GRUPO', alcanceId: grupoId });
  // el alumno lo abre -> queda leído; el maestro no
  await request(app.getHttpServer()).get(`/avisos/${pub.body.data.id}`).set('Authorization', `Bearer ${await tokenAlumno()}`);

  const res = await request(app.getHttpServer())
    .get(`/avisos/${pub.body.data.id}/recibos`)
    .set('Authorization', `Bearer ${await tokenAdminMerida()}`);
  expect(res.status).toBe(200);
  expect(res.body.data.total).toBe(2);
  expect(res.body.data.leidos).toBe(1);
  expect(res.body.data.noLeidos).toBe(1);
  const alumno = res.body.data.destinatarios.find((d: { usuarioId: string }) => d.usuarioId === alumnoMatriculadoId);
  expect(alumno.leidoEn).not.toBeNull();
  expect(alumno).toHaveProperty('nombreCompleto');
  expect(alumno).toHaveProperty('rol', 'ALUMNO');
  const maestro = res.body.data.destinatarios.find((d: { usuarioId: string }) => d.usuarioId === maestroConAsignacionId);
  expect(maestro.leidoEn).toBeNull();
});

it('un ADMINISTRATIVO de la sede que NO es el autor ve los recibos', async () => {
  const pub = await postAviso(await tokenMaestro(), { titulo: 'Del maestro', cuerpo: 'x', alcanceTipo: 'GRUPO', alcanceId: grupoId });
  const res = await request(app.getHttpServer())
    .get(`/avisos/${pub.body.data.id}/recibos`)
    .set('Authorization', `Bearer ${await tokenAdminMerida()}`);
  expect(res.status).toBe(200);
});

it('un MAESTRO que no es el autor: 403', async () => {
  const pub = await postAviso(await tokenAdminMerida(), { titulo: 'x', cuerpo: 'x', alcanceTipo: 'GRUPO', alcanceId: grupoId });
  const otroMaestro = await crearMaestro(sedeMeridaId);
  const res = await request(app.getHttpServer())
    .get(`/avisos/${pub.body.data.id}/recibos`)
    .set('Authorization', `Bearer ${await firmarToken(otroMaestro, RolUsuario.MAESTRO, sedeMeridaId)}`);
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('ROL_NO_AUTORIZADO');
});

it('un ALUMNO destinatario: 403 en /recibos', async () => {
  const pub = await postAviso(await tokenAdminMerida(), { titulo: 'x', cuerpo: 'x', alcanceTipo: 'GRUPO', alcanceId: grupoId });
  const res = await request(app.getHttpServer())
    .get(`/avisos/${pub.body.data.id}/recibos`)
    .set('Authorization', `Bearer ${await tokenAlumno()}`);
  expect(res.status).toBe(403);
});

it('recibos de un aviso de otra sede: 404', async () => {
  const pub = await postAviso(await tokenAdminMerida(), { titulo: 'x', cuerpo: 'x', alcanceTipo: 'SEDE' });
  const res = await request(app.getHttpServer())
    .get(`/avisos/${pub.body.data.id}/recibos`)
    .set('Authorization', `Bearer ${await tokenAdminValladolid()}`);
  expect(res.status).toBe(404);
});

it('el autor borra su aviso: 200, se van el Aviso y sus Notificacion, audita ELIMINACION', async () => {
  const pub = await postAviso(await tokenAdminMerida(), { titulo: 'Borrable', cuerpo: 'x', alcanceTipo: 'GRUPO', alcanceId: grupoId });
  const avisoId = pub.body.data.id;
  const res = await request(app.getHttpServer())
    .delete(`/avisos/${avisoId}`)
    .set('Authorization', `Bearer ${await tokenAdminMerida()}`);
  expect(res.status).toBe(200);
  expect(res.body.data).toEqual({ ok: true });
  expect(await prisma.aviso.findUnique({ where: { id: avisoId } })).toBeNull();
  expect(await prisma.notificacion.count({ where: { referenciaId: avisoId } })).toBe(0);
  const audit = await prisma.registroAuditoria.findFirst({ where: { entidad: 'Aviso', entidadId: avisoId, accion: 'ELIMINACION' } });
  expect(audit).not.toBeNull();
  // quitar de avisoIdsCreados para que el afterAll no falle al re-borrar
  const i = avisoIdsCreados.indexOf(avisoId);
  if (i >= 0) avisoIdsCreados.splice(i, 1);
});

it('un ADMINISTRATIVO de la sede borra un aviso ajeno (de un maestro): 200', async () => {
  const pub = await postAviso(await tokenMaestro(), { titulo: 'x', cuerpo: 'x', alcanceTipo: 'GRUPO', alcanceId: grupoId });
  const res = await request(app.getHttpServer())
    .delete(`/avisos/${pub.body.data.id}`)
    .set('Authorization', `Bearer ${await tokenAdminMerida()}`);
  expect(res.status).toBe(200);
  const i = avisoIdsCreados.indexOf(pub.body.data.id);
  if (i >= 0) avisoIdsCreados.splice(i, 1);
});

it('un MAESTRO que no es el autor no puede borrar: 403', async () => {
  const pub = await postAviso(await tokenAdminMerida(), { titulo: 'x', cuerpo: 'x', alcanceTipo: 'GRUPO', alcanceId: grupoId });
  const otroMaestro = await crearMaestro(sedeMeridaId);
  const res = await request(app.getHttpServer())
    .delete(`/avisos/${pub.body.data.id}`)
    .set('Authorization', `Bearer ${await firmarToken(otroMaestro, RolUsuario.MAESTRO, sedeMeridaId)}`);
  expect(res.status).toBe(403);
});

it('DELETE de un aviso de otra sede: 404', async () => {
  const pub = await postAviso(await tokenAdminMerida(), { titulo: 'x', cuerpo: 'x', alcanceTipo: 'SEDE' });
  const res = await request(app.getHttpServer())
    .delete(`/avisos/${pub.body.data.id}`)
    .set('Authorization', `Bearer ${await tokenAdminValladolid()}`);
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd App/backend && pnpm test:e2e -- avisos`
Expected: FAIL en los casos nuevos (404 / rutas ausentes); Tasks 2-3 en verde.

- [ ] **Step 3: Agregar `obtenerRecibos` y `eliminar` al service**

Importar `ForbiddenException`. Helper privado para cargar el aviso exigiendo sede del actor:

```ts
private async obtenerAvisoEnSede(id: string, sedeId: string) {
  const aviso = await this.prisma.aviso.findFirst({
    where: { id, sedeId },
    select: { id: true, autorUsuarioId: true, sedeId: true },
  });
  if (!aviso) {
    throw new NotFoundException({ error: 'Aviso no encontrado', code: 'NOT_FOUND' });
  }
  return aviso;
}

/** Autor del aviso, o cualquier `ADMINISTRATIVO` de la sede del aviso.
 * `MAESTRO`/`ALUMNO` no-autor → 403. */
private verificarPuedeGestionar(
  aviso: { autorUsuarioId: string },
  actor: ActorAviso,
) {
  const esAutor = aviso.autorUsuarioId === actor.usuarioId;
  const esAdmin = actor.rol === RolUsuario.ADMINISTRATIVO;
  if (!esAutor && !esAdmin) {
    throw new ForbiddenException({
      error: 'Solo el autor o un administrativo pueden gestionar este aviso',
      code: 'ROL_NO_AUTORIZADO',
    });
  }
}
```

```ts
export interface ReciboItem {
  usuarioId: string;
  nombreCompleto: string;
  rol: RolUsuario;
  leidoEn: Date | null;
}

/**
 * `GET /avisos/:id/recibos` — solo autor o `ADMINISTRATIVO` de la sede del
 * aviso. El snapshot de destinatarios es el set de `Notificacion`
 * `tipo: AVISO` de ese aviso (fijado al publicar). `nombreCompleto` y `rol`
 * se resuelven del `Usuario` + su perfil.
 */
async obtenerRecibos(id: string, actor: ActorAviso) {
  try {
    const aviso = await this.obtenerAvisoEnSede(id, actor.sedeId);
    this.verificarPuedeGestionar(aviso, actor);

    const notifs = await this.prisma.notificacion.findMany({
      where: { referenciaId: id, tipo: 'AVISO' },
      select: { usuarioId: true, leidoEn: true },
    });
    const usuarioIds = notifs.map((n) => n.usuarioId);
    const [usuarios, nombres] = await Promise.all([
      this.prisma.usuario.findMany({
        where: { id: { in: usuarioIds } },
        select: { id: true, rol: true },
      }),
      this.resolverNombresCompletos(usuarioIds),
    ]);
    const rolPorId = new Map(usuarios.map((u) => [u.id, u.rol]));

    const destinatarios: ReciboItem[] = notifs.map((n) => ({
      usuarioId: n.usuarioId,
      nombreCompleto: nombres.get(n.usuarioId) ?? '',
      rol: rolPorId.get(n.usuarioId) ?? RolUsuario.ALUMNO,
      leidoEn: n.leidoEn,
    }));
    destinatarios.sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto));

    const leidos = destinatarios.filter((d) => d.leidoEn !== null).length;
    return {
      total: destinatarios.length,
      leidos,
      noLeidos: destinatarios.length - leidos,
      destinatarios,
    };
  } catch (err) {
    if (err instanceof NotFoundException || err instanceof ForbiddenException) throw err;
    console.error('[AvisosService.obtenerRecibos] error inesperado:', err);
    throw err;
  }
}

/**
 * `DELETE /avisos/:id` — DELETE real (`Aviso` está en "CRUD" de negocio,
 * no baja lógica — regla 3 es solo para personas). Autor o `ADMINISTRATIVO`
 * de la sede. Borra el `Aviso` + sus `Notificacion` (referenciaId, sin FK)
 * y audita `ELIMINACION`, todo en una transacción.
 */
async eliminar(id: string, actor: ActorAviso): Promise<{ ok: true }> {
  try {
    const aviso = await this.obtenerAvisoEnSede(id, actor.sedeId);
    this.verificarPuedeGestionar(aviso, actor);

    await this.prisma.$transaction(async (tx) => {
      await tx.registroAuditoria.create({
        data: {
          usuarioId: actor.usuarioId,
          sedeId: actor.sedeId,
          accion: AccionAuditoria.ELIMINACION,
          entidad: 'Aviso',
          entidadId: id,
        },
      });
      await tx.notificacion.deleteMany({
        where: { referenciaId: id, tipo: 'AVISO' },
      });
      await tx.aviso.delete({ where: { id } });
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof NotFoundException || err instanceof ForbiddenException) throw err;
    console.error('[AvisosService.eliminar] error inesperado:', err);
    throw err;
  }
}
```

Agregar el helper `resolverNombresCompletos(usuarioIds): Promise<Map<string, string>>` — igual que `resolverNombresAutores` pero devolviendo `` `${nombres} ${apellidoPaterno} ${apellidoMaterno}`.trim() `` (traer `apellidoMaterno` también en los 3 `select`). Si preferís, refactorizá `resolverNombresAutores` para que use este y derive `{ nombres, apellidoPaterno }` — pero no es obligatorio, el duplicado es chico.

- [ ] **Step 4: Agregar las rutas al controller**

```ts
@Get(':id/recibos')
async recibos(
  @Param('id') id: string,
  @SedeActual() sedeId: string,
  @ActorUsuarioId() actorUsuarioId: string,
  @Req() req: Request,
) {
  const rol = req.jwtClaims?.['rol'] as RolUsuario;
  const data = await this.avisosService.obtenerRecibos(id, {
    usuarioId: actorUsuarioId, rol, sedeId,
  });
  return { data };
}

@Delete(':id')
@Roles(RolUsuario.ADMINISTRATIVO, RolUsuario.MAESTRO)
async eliminar(
  @Param('id') id: string,
  @SedeActual() sedeId: string,
  @ActorUsuarioId() actorUsuarioId: string,
  @Req() req: Request,
) {
  const rol = req.jwtClaims?.['rol'] as RolUsuario;
  const data = await this.avisosService.eliminar(id, {
    usuarioId: actorUsuarioId, rol, sedeId,
  });
  return { data };
}
```

Agregar `Delete` a los imports de `@nestjs/common`. **`GET /avisos/:id/recibos` debe declararse ANTES de `GET /avisos/:id`** en el archivo — Nest resuelve por orden y `:id/recibos` es más específico (en la práctica Nest lo maneja bien porque el segmento extra distingue, pero mantener el orden específico→genérico es la convención del repo, ver `GET /eventos/listado` antes de `GET /eventos`). Sin `@Roles` en `/recibos` (la autorización fina la hace `verificarPuedeGestionar` — un ALUMNO llega al service y sale con 403 `ROL_NO_AUTORIZADO`, mismo código). `DELETE` sí lleva `@Roles(ADMINISTRATIVO, MAESTRO)` (un ALUMNO ni entra).

- [ ] **Step 5: Correr la suite completa de avisos**

Run: `cd App/backend && pnpm test:e2e -- avisos`
Expected: PASS — los 4 grupos de casos en verde.

- [ ] **Step 6: Correr la suite e2e COMPLETA (regresión)**

Run: `cd App/backend && pnpm test:e2e`
Expected: todas las suites en verde (las ~20 previas + `avisos`). Ninguna suite de `calendario`/`notificaciones`/`publicacion-destinatarios` se rompe.

- [ ] **Step 7: Build + lint**

Run: `cd App/backend && pnpm build && pnpm lint`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/backend/src/avisos/ App/backend/test/avisos.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(backend): GET /avisos/:id/recibos + DELETE /avisos/:id (Fase 16, Día 46)

recibos: solo autor o ADMINISTRATIVO de la sede -> { total, leidos, noLeidos,
destinatarios[] } con leidoEn por destinatario; no-autor no-admin -> 403,
otra sede -> 404. DELETE real del Aviso + sus Notificacion (referenciaId sin
FK, deleteMany en la tx) + audita ELIMINACION. Suite e2e avisos completa
(POST/GET/GET :id/recibos/DELETE) + regresión e2e completa en verde.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Dq42quDpEqPhLGmWRzyjbz
EOF
)"
```

---

## Task 5: Documentación (CLAUDE.md + ESTADO.md + roadmap)

**Files:**
- Modify: `CLAUDE.md`
- Modify: `documentacion_de_agentes/ESTADO.md`
- Modify: `docs/roadmap.md`

**Interfaces:**
- Consumes: el comportamiento final de las 5 rutas (Tasks 2-4).
- Produces: nada de código — cierra el contrato documental.

- [ ] **Step 1: CLAUDE.md — sección "Contrato de API"**

Agregar, después del bloque de `GET /notificaciones...` (o junto a los otros de Fase 14/15), un bloque de viñetas para las 5 rutas:

```markdown
- `POST/GET /avisos`, `GET /avisos/:id`, `GET /avisos/:id/recibos`,
  `DELETE /avisos/:id` (Fase 16, Días 45-46) — broadcast de una vía con recibo
  de lectura. `SedeGuard` (clase) + `RolesGuard`; `sedeId` SIEMPRE de
  `@SedeActual()`, `rol` de `req.jwtClaims['rol']`. Modelo `Aviso` (`sedeId`,
  `autorUsuarioId`, `titulo`, `cuerpo`, `alcanceTipo`, `alcanceId?`,
  `createdAt`) + RLS `sede_isolation_avisos` directa. El recibo de lectura NO
  es tabla nueva: es la fila `Notificacion` (`tipo: AVISO`,
  `referenciaId: aviso.id`) de cada destinatario, con su `leidoEn`.
  - `POST /avisos` — `@Roles(ADMINISTRATIVO, MAESTRO)`. Body: `titulo`,
    `cuerpo`, `alcanceTipo`, `alcanceId?`. `AvisosService.publicar` en una
    transacción: `validarAlcancePublicacion` (reusa Fase 15 —
    `ADMINISTRATIVO` a SEDE/CARRERA/GRUPO de su sede sin jerarquía de
    `nivelPermiso`; `MAESTRO` solo a GRUPO donde tiene fila en
    `GrupoMateriaMaestro`, cualquier otro caso → `403 ROL_NO_AUTORIZADO`;
    alcance malformado → `400 VALIDATION_ERROR`; `alcanceId` inexistente/de
    otra sede → `404 NOT_FOUND`) → `create` del `Aviso` →
    `resolverDestinatarios` (solo `Usuario.activo: true`, autor excluido) →
    `createMany` de `Notificacion` (`titulo` = título del aviso, `cuerpoCorto`
    = primeros 140 chars) → audita `ALTA` (`entidad: 'Aviso'`). Después de la
    transacción: correo best-effort por lotes de 20 vía
    `MailService.enviarNotificacion`, cada fallo logueado, ninguno tumba la
    publicación (patrón `altaPersona`). `201 { data: Aviso }`.
  - `GET /avisos?page=&limit=` — los 3 roles (sin `@Roles`, mismo criterio
    que `GET /perfil`/`GET /notificaciones`). Feed del actor: los avisos que
    le llegaron (join contra sus `Notificacion` `tipo: AVISO`), orden
    `createdAt desc`, paginado (`page` default 1, `limit` default 20 máx 100).
    `200 { data: FeedItem[], page, limit, total }` con `FeedItem = { id,
    titulo, cuerpo, autor: { nombres, apellidoPaterno }, createdAt, leidoEn }`
    — `autor` se resuelve del perfil (ADMINISTRATIVO/MAESTRO), no de
    `Usuario`.
  - `GET /avisos/:id` — los 3 roles. Devuelve el aviso completo (mismo shape
    `FeedItem`) y marca la `Notificacion` del actor como leída
    (`leidoEn = now()` si estaba null) — esto ES el registro del recibo.
    Idempotente (una segunda lectura no mueve `leidoEn`). Actor sin
    `Notificacion` para ese aviso (no era destinatario) → `404 NOT_FOUND`.
  - `GET /avisos/:id/recibos` — solo el autor o cualquier `ADMINISTRATIVO`
    de la sede del aviso; `MAESTRO`/`ALUMNO` no-autor → `403 ROL_NO_AUTORIZADO`
    (autorización fina en el service, sin `@Roles` en la ruta). Aviso
    inexistente/de otra sede → `404 NOT_FOUND`. `200 { data: { total, leidos,
    noLeidos, destinatarios: { usuarioId, nombreCompleto, rol, leidoEn }[] } }`
    — `destinatarios` ordenado por `nombreCompleto`, es el snapshot fijado al
    publicar.
  - `DELETE /avisos/:id` — `@Roles(ADMINISTRATIVO, MAESTRO)`; el service
    exige además autor o `ADMINISTRATIVO` de la sede (si no → `403`). Aviso
    de otra sede → `404` (nunca `403`, no revelar). DELETE real del `Aviso`
    (está en "CRUD" de negocio, no baja lógica — regla 3 es solo personas) +
    `deleteMany` de sus `Notificacion` (`referenciaId` sin FK) + audita
    `ELIMINACION`, todo en una transacción. `200 { data: { ok: true } }`.
  - Sin códigos de error nuevos. `Notificacion` no gana FK a `Aviso`
    (`referenciaId` sigue sin FK, mismo criterio que con `EventoCalendario`).
```

- [ ] **Step 2: CLAUDE.md — tabla "CRUD por tipo de entidad"**

En la fila "Negocio (no CRUD)", agregar `Aviso` a la lista de entidades:
`... , \`Aviso\` (POST/GET/GET :id/GET :id/recibos/DELETE — broadcast con recibo de lectura vía \`Notificacion.leidoEn\`, Fase 16), ...`

- [ ] **Step 3: CLAUDE.md — línea "Fase actual"**

Agregar al final del párrafo de fase actual:
`**Fase 16 — Avisos y mensajes: Días 45-46 (backend — modelo \`Aviso\` + \`AvisosService.publicar\` con fan-out + 5 endpoints \`POST/GET/GET :id/GET :id/recibos/DELETE /avisos\`) CERRADO EN CÓDIGO** (2026-09-03, vía Subagent-Driven Development, N tasks — <resumen de hallazgos del review>). Suite e2e \`avisos\` <M>/<M>, regresión e2e completa en verde. UI de publicación/recepción (Días 47-48) pendiente — el feed del alumno vivirá en ruta propia \`app/alumno/avisos/\` (decisión 2026-09-03, rompe el patrón de sección apilada, mismo criterio que Calendario).`

- [ ] **Step 4: ESTADO.md — entrada Días 45-46**

Agregar al final del archivo, siguiendo el formato de las entradas previas ("### Días 45-46 — Fase 16, Avisos (backend) — ✅ CERRADO EN CÓDIGO (2026-09-03)"), un resumen con: qué se construyó (modelo, migración, helpers reusados, 5 endpoints), decisiones (recibo = `Notificacion.leidoEn`, `obtenerCorreosPersonales` compartido nuevo con `CalendarioService` sin unificar aún, ruta `app/alumno/avisos/` para Día 48), números de test, y hallazgos del review final si los hubo. Bloque "Siguiente:" apuntando a Días 47-48 (UI).

- [ ] **Step 5: roadmap.md — checkboxes de Días 45-46**

En la sección `## FASE 16 — Avisos y mensajes`, marcar `[x]` los 3 checkboxes del Día 45 y los 4 del Día 46 (backend). Si algún ítem del Día 46 quedó fuera de esta tanda (p. ej. algún detalle de UI mezclado), dejarlo `[ ]`. NO tachar la fase entera (Días 47-48 siguen pendientes). Agregar una nota `> Backend (Días 45-46) cerrado en código 2026-09-03; UI (47-48) pendiente.`

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add CLAUDE.md documentacion_de_agentes/ESTADO.md docs/roadmap.md
git commit -m "$(cat <<'EOF'
docs: contrato de API + estado de Avisos backend (Fase 16, Días 45-46)

Documenta POST/GET/GET :id/GET :id/recibos/DELETE /avisos en CLAUDE.md,
agrega Aviso a la tabla CRUD (Negocio no-CRUD), entrada en ESTADO.md y
checkboxes de Días 45-46 en el roadmap. UI (47-48) sigue pendiente.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Dq42quDpEqPhLGmWRzyjbz
EOF
)"
```

---

## Self-Review

**1. Spec coverage (design spec `2026-08-31-...`, sección "FASE 16 — Días 45-46"):**
- Modelo `Aviso` (prisma block exacto del spec) → Task 1. ✅
- RLS `sede_isolation_avisos` directa → Task 1, Step 5. ✅
- `AvisosService.publicar` transacción: `validarAlcancePublicacion` → `create` → `resolverDestinatarios` → `createMany` `Notificacion` (`tipo: AVISO`, `referenciaId`, `titulo`, `cuerpoCorto` ~140) → audita `ALTA` → Task 2, Step 5. ✅
- Autor excluido del fan-out → Task 2, Step 5 (`.filter((id) => id !== actor.usuarioId)`) + test. ✅
- Correo best-effort tras la transacción, cada fallo logueado, no tumba → Task 2, Step 5. ✅
- `POST /avisos` roles `ADMINISTRATIVO`/`MAESTRO`, body, `201 { data: Aviso }` → Task 2. ✅
- `GET /avisos?page=&limit=` feed del actor, join contra `Notificacion`, orden `createdAt desc`, item `{ id, titulo, cuerpo, autor, createdAt, leidoEn }` → Task 3. ✅
- `GET /avisos/:id` marca leído, no-destinatario → 404 → Task 3. ✅
- `GET /avisos/:id/recibos` autor o `ADMINISTRATIVO` de la sede, shape `{ total, leidos, noLeidos, destinatarios[] }`, otro rol / no-autor → 403 → Task 4. ✅
- `DELETE /avisos/:id` autor o `ADMINISTRATIVO`, DELETE real + `Notificacion` en cascada, audita `ELIMINACION`, `200 { data: { ok: true } }` → Task 4. ✅
- e2e `test/avisos.e2e-spec.ts` con todos los casos del spec (fan-out, marca leído, recibos 403, maestro a SEDE/grupo ajeno 403, alumno 403, DELETE cascada, cross-sede), `afterAll` acotado a ids (regla 14) → Tasks 2-4. ✅
- Sin códigos de error nuevos → confirmado en Global Constraints + cada task. ✅

**2. Placeholder scan:** El único `<...>` es en Task 5 Steps 3-4 (`N tasks`, `<resumen de hallazgos>`, `<M>/<M>`) — son valores que el implementador solo conoce al terminar (conteo real de tests / hallazgos del review). Es correcto dejarlos como campos a llenar al momento, no como trabajo sin especificar. Todo lo demás tiene código real.

**3. Type consistency:**
- `ActorAviso = { usuarioId, rol, sedeId }` — definido en Task 2, usado en Tasks 2/4 con el mismo shape. ✅
- `AvisoDto` / `FeedItem` / `ReciboItem` — definidos una vez, campos consistentes entre service y tests. ✅
- `firmarToken(sub, rol, sedeId)` — firma de `calendario.e2e-spec.ts`, usada igual en todos los casos e2e. ✅
- `validarAlcancePublicacion(prisma, actor, alcanceTipo, alcanceId)` / `resolverDestinatarios(prisma, sedeId, alcanceTipo, alcanceId)` — firmas verificadas contra `src/common/publicacion/alcance-publicacion.util.ts` (líneas 47 y 116). ✅
- `MailService.enviarNotificacion({ correoDestino, asunto, cuerpoTexto, cuerpoHtml? })` — verificada contra `src/mail/mail.service.ts` línea 76. ✅
- `obtenerCorreosPersonales(prisma, usuarioIds)` — definida en Task 2, usada en Task 2. ✅
- `resolverNombresAutores` (Task 3) vs `resolverNombresCompletos` (Task 4) — nombres distintos a propósito (uno devuelve `{ nombres, apellidoPaterno }`, el otro un string completo); Task 4 Step 3 nota que se puede refactorizar uno sobre el otro pero no obliga. ✅

Sin issues abiertos.

---

## Execution Handoff

Plan completo y guardado en `docs/superpowers/plans/2026-09-03-fase16-avisos-backend.md`.

**5 tasks:**
1. Modelo `Aviso` + migración (`migrate diff` + `deploy`) + RLS
2. `POST /avisos` — módulo + `publicar` + fan-out + e2e
3. `GET /avisos` (feed) + `GET /avisos/:id` (detalle + marca leído) + e2e
4. `GET /avisos/:id/recibos` + `DELETE /avisos/:id` + e2e + regresión completa
5. Documentación (CLAUDE.md + ESTADO.md + roadmap)
