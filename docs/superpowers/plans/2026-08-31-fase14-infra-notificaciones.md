# Fase 14 — Infraestructura de notificaciones — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modelo `Notificacion` + endpoints de feed/conteo/marcar-leído + campana con badge de no-leídos en los 3 árboles de frontend (admin, alumno, maestro), como capa compartida que consumirán Calendario (Fase 15) y Avisos (Fase 16).

**Architecture:** Un módulo NestJS nuevo `src/notificaciones/` con `SedeGuard` (sin `RolesGuard` — cualquier rol autenticado ve las suyas, mismo criterio que `GET /perfil`). El actor sale siempre de `@ActorUsuarioId()` (JWT `sub`), nunca de la ruta. Tabla `notificaciones` con `sede_id` + RLS calcada de las policies directas por sede + filtro por dueño (`usuarioId`) a nivel de service. En frontend, un componente `NotificacionesBell` por árbol (regla 11 — sin componente compartido entre árboles), cada uno con su propio `useQuery` + `refetchInterval` sobre el conteo; el cliente de API `lib/api/notificaciones.ts` sí es compartido (mismo criterio que `lib/api/perfil.ts`). `MailService` gana un método genérico `enviarNotificacion(...)` que todavía no tiene caller (lo usan las Fases 15/16).

**Tech Stack:** NestJS 11 + Prisma 6.x + PostgreSQL/Supabase (backend) · Next.js (App Router, versión con breaking changes — ver Global Constraints) + `@tanstack/react-query` + Tailwind (frontend).

**Spec de referencia:** `docs/superpowers/specs/2026-08-31-calendario-avisos-notificaciones-design.md` (sección "FASE 14").

## Global Constraints

- **Contrato de API:** éxito `{ data: ... }` (+ `page`/`limit`/`total` en listas paginadas); error `{ error: "mensaje", code: "TIPO" }`. JSON camelCase, fechas ISO 8601. Códigos fijos: `VALIDATION_ERROR`, `NOT_FOUND`, `UNAUTHORIZED`, `CONFLICT`, `SERVER_ERROR`. **Esta fase NO agrega códigos de dominio nuevos.**
- **Regla 1:** nunca persistir lo calculable — el conteo de no-leídas se deriva con `count`, no se guarda.
- **Regla 2:** doble capa RLS (Postgres) + guard (NestJS). El guard saca `sede_id` del JWT, jamás del body/query/path. `notificaciones` lleva RLS por `sede_id` **y** el service filtra siempre por `usuarioId` del actor (un usuario nunca ve notificaciones de otro de su misma sede).
- **Regla 5:** `RegistroAuditoria` solo inserción. **La `Notificacion` NO se audita** (alto volumen, es estado de entrega derivado, no una acción de negocio) — decisión explícita del spec, documentar en el service.
- **Regla 11:** separación total admin/alumno/maestro en frontend — árboles independientes, sin componentes compartidos. `lib/api/*` sí es infra compartida.
- **Regla 12:** todo catch/error handler loguea el error completo (`console.error`) antes de responder, backend y frontend.
- **Regla 14:** los e2e limpian en `afterAll` acotado a los `id`s reales que la corrida creó — NUNCA por patrón de email/nombre.
- **Migraciones:** `prisma migrate dev` está roto en el repo (`P3006`, la shadow DB no tiene el schema `auth` de Supabase). Las migraciones se generan con `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` y se aplican con `prisma migrate deploy`, nunca `migrate dev`.
- **Frontend Next.js:** es una versión con breaking changes respecto al Next.js conocido. Antes de escribir código de frontend, leer la guía relevante en `App/frontend/node_modules/next/dist/docs/` (resuelto desde `App/frontend/`). El bloque de aviso en `App/frontend/AGENTS.md` lo re-escribe `next dev` — si aparece en el diff, commitearlo con el trabajo, no borrarlo.
- **Terminal:** PowerShell 7 (`pwsh`). `pnpm`/`npx`/`prisma` funcionan igual. Los comandos `Run:` de este plan usan sintaxis POSIX para el Bash tool; si se corren en `pwsh`, adaptar `>` / rutas.
- **Lint backend:** `pnpm lint` del repo es `eslint --fix` y reformatea archivos ajenos. Al verificar lint de archivos nuevos usar `npx eslint "<archivos>"` **sin `--fix`** (hallazgo del Día 32).
- **Tests backend:** unit con `pnpm test`, e2e con `pnpm test:e2e` (corren contra la DB real de dev). Frontend: no hay suite de componentes — la verificación es `pnpm build` + `pnpm lint` + revisión manual en navegador (patrón establecido del proyecto).
- **Commits:** en `dev`. Mensajes terminan con los trailers `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` y `Claude-Session: https://claude.ai/code/session_01Ybz7jkzjiorsr82P95UQnH`.

---

## File Structure

**Backend (`App/backend/`):**
- `prisma/schema.prisma` — MODIFY: modelo `Notificacion` + enum `TipoNotificacion` + back-relations en `Usuario` y `Sede`.
- `prisma/migrations/<timestamp>_notificaciones/migration.sql` — CREATE: DDL generado + bloque RLS a mano.
- `src/notificaciones/notificaciones.module.ts` — CREATE.
- `src/notificaciones/notificaciones.controller.ts` — CREATE: `GET /notificaciones`, `GET /notificaciones/conteo-no-leidas`, `PATCH /notificaciones/:id/leido`.
- `src/notificaciones/notificaciones.service.ts` — CREATE: `listar`, `contarNoLeidas`, `marcarLeida`.
- `src/notificaciones/dto/listar-notificaciones.query.dto.ts` — CREATE: `page`/`limit`.
- `src/app.module.ts` — MODIFY: registrar `NotificacionesModule`.
- `src/mail/mail.service.ts` — MODIFY: método `enviarNotificacion(...)` genérico.
- `src/mail/mail.service.spec.ts` — MODIFY: casos para `enviarNotificacion`.
- `test/notificaciones.e2e-spec.ts` — CREATE.

**Frontend (`App/frontend/`):**
- `src/lib/api/notificaciones.ts` — CREATE: tipos + `listarNotificaciones`, `conteoNoLeidas`, `marcarLeida` (compartido).
- `src/components/admin/ui/shell/NotificacionesBell.tsx` — CREATE.
- `src/components/alumno/ui/shell/NotificacionesBell.tsx` — CREATE.
- `src/components/maestro/ui/shell/NotificacionesBell.tsx` — CREATE.
- `src/components/admin/ui/shell/AdminShell.tsx` — MODIFY: montar el bell en `Topbar`.
- `src/components/alumno/ui/shell/Header.tsx` — MODIFY: montar el bell.
- `src/components/maestro/ui/shell/Header.tsx` — MODIFY: montar el bell.

---

## Task 1: Modelo `Notificacion` + migración

**Files:**
- Modify: `App/backend/prisma/schema.prisma` (enums block ~línea 108; `Usuario` model ~línea 283; `Sede` model ~línea 114; agregar el modelo nuevo al final de la sección de infraestructura o junto a `RegistroAuditoria`)
- Create: `App/backend/prisma/migrations/<timestamp>_notificaciones/migration.sql`

**Interfaces:**
- Produces: tabla `notificaciones` y enum `TipoNotificacion` en la DB de dev; modelo Prisma `Notificacion` con campos `id: string`, `usuarioId: string`, `sedeId: string`, `tipo: TipoNotificacion` (`'AVISO' | 'RECORDATORIO_EVENTO'`), `referenciaId: string`, `titulo: string`, `cuerpoCorto: string`, `leidoEn: Date | null`, `createdAt: Date`. Índice `@@index([usuarioId, leidoEn])`.

- [ ] **Step 1: Escribir el modelo y el enum en `schema.prisma`**

En el bloque de enums (después de `AreaPersonalServicios`, ~línea 108) agregar:

```prisma
enum TipoNotificacion {
  AVISO
  RECORDATORIO_EVENTO
}
```

Agregar el modelo (ubicarlo junto a `RegistroAuditoria`, ~línea 566, o al final del archivo):

```prisma
/// Notificación in-app para un usuario — Fase 14, Día 38. Capa compartida:
/// la crean el fan-out de avisos (Fase 16) y el job de recordatorios de
/// calendario (Fase 15). NO se audita (regla 5 aplica a acciones de
/// negocio; esto es estado de entrega derivado, alto volumen). `leidoEn`
/// null = no leída; el badge cuenta esas. `referenciaId` apunta a
/// `Aviso.id` o `EventoCalendario.id` según `tipo` — sin FK (las entidades
/// referidas no existen todavía en la Fase 14 y el borrado en cascada lo
/// maneja cada módulo dueño al borrar su entidad).
model Notificacion {
  id           String           @id @default(uuid())
  usuarioId    String           @map("usuario_id")
  usuario      Usuario          @relation(fields: [usuarioId], references: [id])
  sedeId       String           @map("sede_id")
  sede         Sede             @relation(fields: [sedeId], references: [id])
  tipo         TipoNotificacion
  referenciaId String           @map("referencia_id")
  titulo       String
  cuerpoCorto  String           @map("cuerpo_corto")
  leidoEn      DateTime?        @map("leido_en")
  createdAt    DateTime         @default(now()) @map("created_at")

  @@index([usuarioId, leidoEn])
  @@map("notificaciones")
}
```

En `model Usuario` (~línea 297-301, bloque de relaciones) agregar:

```prisma
  notificaciones       Notificacion[]
```

En `model Sede` (~línea 124-130, bloque de relaciones) agregar:

```prisma
  notificaciones      Notificacion[]
```

- [ ] **Step 2: Generar el cliente Prisma y verificar que compila el schema**

Run: `cd App/backend && npx prisma generate`
Expected: `✔ Generated Prisma Client`, sin errores de validación del schema.

- [ ] **Step 3: Generar el diff SQL contra la DB real de dev**

Run:
```bash
cd App/backend
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > /tmp/notificaciones.sql
cat /tmp/notificaciones.sql
```
Expected: SQL con ~4 statements — `CREATE TYPE "TipoNotificacion" AS ENUM (...)`, `CREATE TABLE "notificaciones" (...)`, `CREATE INDEX "notificaciones_usuario_id_leido_en_idx" ON "notificaciones"(...)`, 2× `ALTER TABLE "notificaciones" ADD CONSTRAINT ... FOREIGN KEY` (a `usuarios` y `sedes`). Verificar que los nombres sean los de la DB (`notificaciones`, `usuario_id`, `sede_id`, `leido_en`), no los de Prisma.

- [ ] **Step 4: Guardar la migración en el repo y anexar el bloque RLS**

```bash
cd App/backend
mkdir -p "prisma/migrations/$(date +%Y%m%d%H%M%S)_notificaciones"
```

Copiar el contenido de `/tmp/notificaciones.sql` a `prisma/migrations/<ese-timestamp>_notificaciones/migration.sql` y **anexar al final** este bloque (calcado de `sede_isolation_grupos` en `20260806224102_rls_multisede/migration.sql` — policy directa por `sede_id`, función `public.current_sede_id()` ya existe):

```sql
-- ============================================================
-- NOTIFICACIONES (sede_id directo)
-- ============================================================
ALTER TABLE "notificaciones" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "notificaciones" TO authenticated;

CREATE POLICY "sede_isolation_notificaciones" ON "notificaciones"
  FOR ALL
  USING (sede_id = public.current_sede_id())
  WITH CHECK (sede_id = public.current_sede_id());
```

- [ ] **Step 5: Aplicar la migración contra la DB real de dev**

Run: `cd App/backend && npx prisma migrate deploy`
Expected: `The following migration(s) have been applied: ... _notificaciones`, sin errores.

- [ ] **Step 6: Verificar estado de migraciones**

Run: `cd App/backend && npx prisma migrate status`
Expected: `Database schema is up to date!`

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/backend/prisma/schema.prisma App/backend/prisma/migrations/
git commit -m "feat(backend): modelo Notificacion + RLS por sede (Fase 14, Dia 38)

Capa compartida para Calendario (Fase 15) y Avisos (Fase 16). Tabla
notificaciones con sede_id + policy sede_isolation_notificaciones calcada
de sede_isolation_grupos. Sin FK a Aviso/EventoCalendario (no existen aun).
No se audita (estado de entrega derivado, regla 5 no aplica).

Migracion generada via 'prisma migrate diff' + 'migrate deploy' (migrate dev
sigue roto por P3006 shadow-DB).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ybz7jkzjiorsr82P95UQnH"
```

---

## Task 2: `NotificacionesModule` — service + controller + DTO

**Files:**
- Create: `App/backend/src/notificaciones/dto/listar-notificaciones.query.dto.ts`
- Create: `App/backend/src/notificaciones/notificaciones.service.ts`
- Create: `App/backend/src/notificaciones/notificaciones.controller.ts`
- Create: `App/backend/src/notificaciones/notificaciones.module.ts`
- Modify: `App/backend/src/app.module.ts` (imports array)

**Interfaces:**
- Consumes: `PrismaService` (de `../prisma/prisma.service`), `SedeGuard` (de `../common/guards/sede.guard`), `@ActorUsuarioId()` (de `../common/decorators/actor-usuario-id.decorator`), `@SedeActual()` (de `../common/decorators/sede-actual.decorator`).
- Produces:
  - `NotificacionesService.listar(usuarioId: string, page: number, limit: number): Promise<{ data: NotificacionItem[]; page: number; limit: number; total: number }>`
  - `NotificacionesService.contarNoLeidas(usuarioId: string): Promise<{ total: number }>`
  - `NotificacionesService.marcarLeida(id: string, usuarioId: string): Promise<{ ok: true }>` (lanza `NotFoundException` con `{ error, code: 'NOT_FOUND' }` si la notificación no existe o no es del actor)
  - `NotificacionItem = { id: string; tipo: 'AVISO' | 'RECORDATORIO_EVENTO'; referenciaId: string; titulo: string; cuerpoCorto: string; leidoEn: string | null; createdAt: string }`
  - Rutas: `GET /notificaciones?page=&limit=` → `{ data: NotificacionItem[], page, limit, total }`; `GET /notificaciones/conteo-no-leidas` → `{ data: { total: number } }`; `PATCH /notificaciones/:id/leido` → `{ data: { ok: true } }`.

- [ ] **Step 1: Escribir el DTO de query**

Create `App/backend/src/notificaciones/dto/listar-notificaciones.query.dto.ts` (calcado del bloque `page`/`limit` de `src/grupos/dto/listar-grupos.query.dto.ts`):

```ts
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Query params de `GET /notificaciones` — Fase 14, Día 38. Mismo shape de
 * paginación que `ListarGruposQueryDto` (`page`/`limit` con
 * `@Type(() => Number)`; el `ValidationPipe` global con `transform: true`
 * coerciona el query param). Defaults (1 / 20) se aplican en el service.
 */
export class ListarNotificacionesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page debe ser un entero' })
  @Min(1, { message: 'page debe ser al menos 1' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit debe ser un entero' })
  @Min(1, { message: 'limit debe ser al menos 1' })
  @Max(100, { message: 'limit debe ser máximo 100' })
  limit?: number;
}
```

- [ ] **Step 2: Escribir el test e2e que falla — feed vacío y conteo cero**

> Nota: el andamiaje completo del spec se arma en la Task 3. Para el ciclo TDD de esta task, escribir primero solo estos 2 casos en `test/notificaciones.e2e-spec.ts` con el mismo `beforeAll` de firma de JWT que `test/materias.e2e-spec.ts` (copiar el bloque `beforeAll`/`firmarToken`/`SEDE_GUARD_ENV_OVERRIDE` tal cual, cambiando solo los ids de seed que haga falta). Los casos:

```ts
it('GET /notificaciones sin notificaciones -> 200 { data: [], page:1, limit:20, total:0 }', async () => {
  const token = await tokenAdminMerida();
  const res = await request(app.getHttpServer())
    .get('/notificaciones')
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  const body = res.body as NotifListBody;
  // El admin de seed puede tener notificaciones de corridas previas de OTRAS
  // suites — filtrar a las de esta corrida por id no aplica acá (no creamos
  // ninguna). Verificar shape y que las que haya son suyas.
  expect(Array.isArray(body.data)).toBe(true);
  expect(body).toMatchObject({ page: 1, limit: 20 });
  expect(typeof body.total).toBe('number');
});

it('GET /notificaciones/conteo-no-leidas -> 200 { data: { total: number } }', async () => {
  const token = await tokenAdminMerida();
  const res = await request(app.getHttpServer())
    .get('/notificaciones/conteo-no-leidas')
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  expect(typeof (res.body as ConteoBody).data.total).toBe('number');
});
```

Con las interfaces auxiliares arriba del `describe`:

```ts
interface NotifListBody {
  data: Array<{
    id: string;
    tipo: string;
    referenciaId: string;
    titulo: string;
    cuerpoCorto: string;
    leidoEn: string | null;
    createdAt: string;
  }>;
  page: number;
  limit: number;
  total: number;
}
interface ConteoBody { data: { total: number } }
interface ErrorBody { error: string; code: string }
```

- [ ] **Step 3: Correr el test para verificar que falla**

Run: `cd App/backend && npx jest --config test/jest-e2e.json notificaciones --runInBand`
Expected: FAIL — `404` en ambas rutas (el módulo aún no existe / no está registrado).

- [ ] **Step 4: Escribir el service**

Create `App/backend/src/notificaciones/notificaciones.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface NotificacionItem {
  id: string;
  tipo: 'AVISO' | 'RECORDATORIO_EVENTO';
  referenciaId: string;
  titulo: string;
  cuerpoCorto: string;
  leidoEn: Date | null;
  createdAt: Date;
}

/**
 * `NotificacionesService` — Fase 14, Día 38.
 *
 * Feed in-app del usuario autenticado. El `usuarioId` SIEMPRE viene de
 * `@ActorUsuarioId()` (JWT `sub`) en el controller, nunca de la ruta. La
 * `Notificacion` NO se audita (regla 5 aplica a acciones de negocio; esto
 * es estado de entrega derivado, alto volumen).
 *
 * Doble capa de aislamiento (regla 2): RLS por `sede_id` en Postgres +
 * este filtro por `usuarioId` a nivel de aplicación — un usuario nunca ve
 * las notificaciones de otro de su misma sede.
 */
@Injectable()
export class NotificacionesService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(
    usuarioId: string,
    page: number,
    limit: number,
  ): Promise<{
    data: NotificacionItem[];
    page: number;
    limit: number;
    total: number;
  }> {
    const skip = (page - 1) * limit;
    const [total, filas] = await this.prisma.$transaction([
      this.prisma.notificacion.count({ where: { usuarioId } }),
      this.prisma.notificacion.findMany({
        where: { usuarioId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          tipo: true,
          referenciaId: true,
          titulo: true,
          cuerpoCorto: true,
          leidoEn: true,
          createdAt: true,
        },
      }),
    ]);
    return { data: filas, page, limit, total };
  }

  async contarNoLeidas(usuarioId: string): Promise<{ total: number }> {
    const total = await this.prisma.notificacion.count({
      where: { usuarioId, leidoEn: null },
    });
    return { total };
  }

  /**
   * Marca una notificación como leída. Idempotente: si ya estaba leída, no
   * es error (se re-escribe `leidoEn` con la fecha actual — aceptable, el
   * caso normal es un solo click). 404 si la notificación no existe o no
   * pertenece al actor (mismo criterio "no distinguir" que el resto de la
   * API).
   */
  async marcarLeida(id: string, usuarioId: string): Promise<{ ok: true }> {
    const existente = await this.prisma.notificacion.findFirst({
      where: { id, usuarioId },
      select: { id: true },
    });
    if (!existente) {
      throw new NotFoundException({
        error: 'Notificación no encontrada',
        code: 'NOT_FOUND',
      });
    }
    await this.prisma.notificacion.update({
      where: { id },
      data: { leidoEn: new Date() },
    });
    return { ok: true };
  }
}
```

- [ ] **Step 5: Escribir el controller**

Create `App/backend/src/notificaciones/notificaciones.controller.ts`:

```ts
import { Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ActorUsuarioId } from '../common/decorators/actor-usuario-id.decorator';
import { SedeGuard } from '../common/guards/sede.guard';
import { ListarNotificacionesQueryDto } from './dto/listar-notificaciones.query.dto';
import { NotificacionesService } from './notificaciones.service';

/**
 * `GET /notificaciones`, `GET /notificaciones/conteo-no-leidas`,
 * `PATCH /notificaciones/:id/leido` — Fase 14, Día 38.
 *
 * Solo `SedeGuard` (sin `RolesGuard`) — cualquier rol autenticado ve/gestiona
 * SUS notificaciones, mismo criterio que `GET /perfil`. El actor sale de
 * `@ActorUsuarioId()`, nunca de la ruta. `conteo-no-leidas` se declara como
 * segmento fijo ANTES de cualquier futura ruta con `:id` (hoy no hay `GET
 * /:id`, pero se respeta el orden por si se agrega).
 */
@Controller('notificaciones')
@UseGuards(SedeGuard)
export class NotificacionesController {
  constructor(private readonly notificacionesService: NotificacionesService) {}

  @Get()
  async listar(
    @Query() query: ListarNotificacionesQueryDto,
    @ActorUsuarioId() usuarioId: string,
  ) {
    return this.notificacionesService.listar(
      usuarioId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  @Get('conteo-no-leidas')
  async conteoNoLeidas(@ActorUsuarioId() usuarioId: string) {
    const data = await this.notificacionesService.contarNoLeidas(usuarioId);
    return { data };
  }

  @Patch(':id/leido')
  async marcarLeida(
    @Param('id') id: string,
    @ActorUsuarioId() usuarioId: string,
  ) {
    const data = await this.notificacionesService.marcarLeida(id, usuarioId);
    return { data };
  }
}
```

- [ ] **Step 6: Escribir el módulo y registrarlo**

Create `App/backend/src/notificaciones/notificaciones.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { NotificacionesController } from './notificaciones.controller';
import { NotificacionesService } from './notificaciones.service';

@Module({
  controllers: [NotificacionesController],
  providers: [NotificacionesService],
})
export class NotificacionesModule {}
```

Modify `App/backend/src/app.module.ts` — agregar el import y meterlo en el array `imports` (después de `MateriasModule`):

```ts
import { NotificacionesModule } from './notificaciones/notificaciones.module';
```
```ts
    MateriasModule,
    NotificacionesModule,
```

- [ ] **Step 7: Correr los tests y verificar que pasan**

Run: `cd App/backend && npx jest --config test/jest-e2e.json notificaciones --runInBand`
Expected: PASS (2/2).

- [ ] **Step 8: Verificar build y lint de lo nuevo**

Run: `cd App/backend && npx tsc --noEmit && npx eslint "src/notificaciones/**/*.ts"`
Expected: sin errores, sin warnings.

- [ ] **Step 9: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/backend/src/notificaciones/ App/backend/src/app.module.ts App/backend/test/notificaciones.e2e-spec.ts
git commit -m "feat(backend): endpoints de notificaciones (feed / conteo / marcar leido) (Fase 14, Dia 38)

GET /notificaciones (paginado), GET /notificaciones/conteo-no-leidas,
PATCH /notificaciones/:id/leido. Solo SedeGuard (cualquier rol ve las
suyas); actor de @ActorUsuarioId(). Filtro por usuarioId a nivel de
service ademas de la RLS por sede.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ybz7jkzjiorsr82P95UQnH"
```

---

## Task 3: Suite e2e completa de `notificaciones`

**Files:**
- Modify: `App/backend/test/notificaciones.e2e-spec.ts` (agregar casos a los 2 de la Task 2)

**Interfaces:**
- Consumes: rutas de la Task 2. Helpers de seed: `prisma.sede.findUniqueOrThrow({ where: { nombre: 'CESP Mérida' } })`, `prisma.usuario.findFirst({ where: { rol: 'ADMINISTRATIVO', sedeId } })` (patrón de `materias.e2e-spec.ts`). Para `CESP Valladolid` usar el mismo patrón que `carreraValladolidId` en `materias.e2e-spec.ts` (buscar la sede por nombre `'CESP Valladolid'` — verificar el nombre exacto en `prisma/seed.ts` antes).
- Produces: cobertura de feed paginado + orden, conteo, marcar leído idempotente, aislamiento por usuario y por sede, 401.

- [ ] **Step 1: Agregar helper para crear notificaciones de prueba y su limpieza**

En el `describe`, junto a los arrays de ids (patrón `materiaIdsCreados` de `materias.e2e-spec.ts`):

```ts
const notificacionIdsCreados: string[] = [];
const usuarioIdsCreados: string[] = [];

async function crearNotificacion(
  usuarioId: string,
  sedeId: string,
  overrides: Partial<{
    tipo: 'AVISO' | 'RECORDATORIO_EVENTO';
    titulo: string;
    cuerpoCorto: string;
    referenciaId: string;
    leidoEn: Date | null;
    createdAt: Date;
  }> = {},
) {
  const n = await prisma.notificacion.create({
    data: {
      usuarioId,
      sedeId,
      tipo: overrides.tipo ?? 'AVISO',
      referenciaId: overrides.referenciaId ?? randomUUID(),
      titulo: overrides.titulo ?? 'Notificación de prueba',
      cuerpoCorto: overrides.cuerpoCorto ?? 'Cuerpo corto de prueba',
      leidoEn: overrides.leidoEn ?? null,
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
    },
  });
  notificacionIdsCreados.push(n.id);
  return n;
}
```

En `afterAll` (regla 14 — acotado a ids, nunca por patrón):

```ts
afterAll(async () => {
  if (notificacionIdsCreados.length > 0) {
    await prisma.notificacion.deleteMany({
      where: { id: { in: notificacionIdsCreados } },
    });
  }
  if (usuarioIdsCreados.length > 0) {
    await prisma.usuario.deleteMany({
      where: { id: { in: usuarioIdsCreados } },
    });
  }
  await app.close();
});
```

- [ ] **Step 2: Escribir el resto de los casos**

```ts
it('GET /notificaciones -> solo las del actor, orden createdAt desc, shape correcto', async () => {
  const admin = await prisma.usuario.findFirstOrThrow({
    where: { rol: RolUsuario.ADMINISTRATIVO, sedeId: sedeMeridaId },
  });
  const ahora = Date.now();
  await crearNotificacion(admin.id, sedeMeridaId, {
    titulo: 'Vieja',
    createdAt: new Date(ahora - 60_000),
  });
  await crearNotificacion(admin.id, sedeMeridaId, {
    titulo: 'Nueva',
    createdAt: new Date(ahora),
  });
  const token = await firmarToken(
    admin.id,
    RolUsuario.ADMINISTRATIVO,
    sedeMeridaId,
  );

  const res = await request(app.getHttpServer())
    .get('/notificaciones?limit=100')
    .set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(200);
  const body = res.body as NotifListBody;
  const nuestras = body.data.filter((n) =>
    notificacionIdsCreados.includes(n.id),
  );
  const idxNueva = nuestras.findIndex((n) => n.titulo === 'Nueva');
  const idxVieja = nuestras.findIndex((n) => n.titulo === 'Vieja');
  expect(idxNueva).toBeGreaterThanOrEqual(0);
  expect(idxNueva).toBeLessThan(idxVieja); // desc: la nueva va antes
  expect(nuestras[idxNueva]).toMatchObject({
    tipo: 'AVISO',
    titulo: 'Nueva',
    leidoEn: null,
  });
  expect(typeof nuestras[idxNueva].createdAt).toBe('string');
});

it('GET /notificaciones -> paginación respeta page/limit', async () => {
  const admin = await prisma.usuario.findFirstOrThrow({
    where: { rol: RolUsuario.ADMINISTRATIVO, sedeId: sedeMeridaId },
  });
  const token = await firmarToken(
    admin.id,
    RolUsuario.ADMINISTRATIVO,
    sedeMeridaId,
  );
  const res = await request(app.getHttpServer())
    .get('/notificaciones?page=1&limit=1')
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  const body = res.body as NotifListBody;
  expect(body.data.length).toBeLessThanOrEqual(1);
  expect(body).toMatchObject({ page: 1, limit: 1 });
});

it('GET /notificaciones?limit=999 -> 400 VALIDATION_ERROR', async () => {
  const token = await tokenAdminMerida();
  const res = await request(app.getHttpServer())
    .get('/notificaciones?limit=999')
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(400);
  expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
});

it('GET /notificaciones/conteo-no-leidas -> cuenta solo las no leídas del actor', async () => {
  const maestro = await prisma.usuario.create({
    data: {
      id: randomUUID(),
      email: `fixture.notif.maestro.${randomUUID()}@example.com`,
      rol: RolUsuario.MAESTRO,
      sedeId: sedeMeridaId,
    },
  });
  usuarioIdsCreados.push(maestro.id);
  await crearNotificacion(maestro.id, sedeMeridaId, { leidoEn: null });
  await crearNotificacion(maestro.id, sedeMeridaId, { leidoEn: null });
  await crearNotificacion(maestro.id, sedeMeridaId, { leidoEn: new Date() });
  const token = await firmarToken(
    maestro.id,
    RolUsuario.MAESTRO,
    sedeMeridaId,
  );

  const res = await request(app.getHttpServer())
    .get('/notificaciones/conteo-no-leidas')
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  expect((res.body as ConteoBody).data.total).toBe(2);
});

it('PATCH /notificaciones/:id/leido -> 200, baja el conteo, idempotente', async () => {
  const maestro = await prisma.usuario.create({
    data: {
      id: randomUUID(),
      email: `fixture.notif.leido.${randomUUID()}@example.com`,
      rol: RolUsuario.MAESTRO,
      sedeId: sedeMeridaId,
    },
  });
  usuarioIdsCreados.push(maestro.id);
  const n = await crearNotificacion(maestro.id, sedeMeridaId, { leidoEn: null });
  const token = await firmarToken(
    maestro.id,
    RolUsuario.MAESTRO,
    sedeMeridaId,
  );

  const primera = await request(app.getHttpServer())
    .patch(`/notificaciones/${n.id}/leido`)
    .set('Authorization', `Bearer ${token}`);
  expect(primera.status).toBe(200);
  expect((primera.body as { data: { ok: boolean } }).data.ok).toBe(true);

  const conteo = await request(app.getHttpServer())
    .get('/notificaciones/conteo-no-leidas')
    .set('Authorization', `Bearer ${token}`);
  expect((conteo.body as ConteoBody).data.total).toBe(0);

  // Idempotente: segunda llamada no truena
  const segunda = await request(app.getHttpServer())
    .patch(`/notificaciones/${n.id}/leido`)
    .set('Authorization', `Bearer ${token}`);
  expect(segunda.status).toBe(200);
});

it('PATCH /notificaciones/:id/leido de otro usuario -> 404 NOT_FOUND', async () => {
  const dueno = await prisma.usuario.create({
    data: {
      id: randomUUID(),
      email: `fixture.notif.dueno.${randomUUID()}@example.com`,
      rol: RolUsuario.MAESTRO,
      sedeId: sedeMeridaId,
    },
  });
  usuarioIdsCreados.push(dueno.id);
  const n = await crearNotificacion(dueno.id, sedeMeridaId);
  const tokenOtro = await tokenAdminMerida(); // otro usuario

  const res = await request(app.getHttpServer())
    .patch(`/notificaciones/${n.id}/leido`)
    .set('Authorization', `Bearer ${tokenOtro}`);
  expect(res.status).toBe(404);
  expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
});

it('GET /notificaciones sin token -> 401 UNAUTHORIZED', async () => {
  const res = await request(app.getHttpServer()).get('/notificaciones');
  expect(res.status).toBe(401);
  expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
});

it('un usuario de otra sede no ve las notificaciones ajenas', async () => {
  // Sede Valladolid — verificar el nombre exacto en prisma/seed.ts
  const sedeVlld = await prisma.sede.findUniqueOrThrow({
    where: { nombre: 'CESP Valladolid' },
  });
  const adminMerida = await prisma.usuario.findFirstOrThrow({
    where: { rol: RolUsuario.ADMINISTRATIVO, sedeId: sedeMeridaId },
  });
  await crearNotificacion(adminMerida.id, sedeMeridaId, {
    titulo: 'Solo para Mérida',
  });
  const adminVlld = await prisma.usuario.findFirstOrThrow({
    where: { rol: RolUsuario.ADMINISTRATIVO, sedeId: sedeVlld.id },
  });
  const tokenVlld = await firmarToken(
    adminVlld.id,
    RolUsuario.ADMINISTRATIVO,
    sedeVlld.id,
  );

  const res = await request(app.getHttpServer())
    .get('/notificaciones?limit=100')
    .set('Authorization', `Bearer ${tokenVlld}`);
  expect(res.status).toBe(200);
  const titulos = (res.body as NotifListBody).data.map((n) => n.titulo);
  expect(titulos).not.toContain('Solo para Mérida');
});
```

- [ ] **Step 3: Correr la suite de notificaciones**

Run: `cd App/backend && npx jest --config test/jest-e2e.json notificaciones --runInBand`
Expected: PASS (todos los casos).

- [ ] **Step 4: Correr la suite e2e completa (no romper nada)**

Run: `cd App/backend && pnpm test:e2e`
Expected: todas las suites en verde (la línea de `notificaciones` suma sus casos al total).

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/backend/test/notificaciones.e2e-spec.ts
git commit -m "test(backend): suite e2e de notificaciones (Fase 14, Dia 38)

Feed paginado + orden, conteo de no leidas, marcar leido idempotente,
aislamiento por usuario y por sede, 401. afterAll acotado a ids (regla 14).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ybz7jkzjiorsr82P95UQnH"
```

---

## Task 4: `MailService.enviarNotificacion` genérico

**Files:**
- Modify: `App/backend/src/mail/mail.service.ts`
- Modify: `App/backend/src/mail/mail.service.spec.ts`

**Interfaces:**
- Consumes: el mismo flag `MAILGUN_ENVIOS_HABILITADO`, `MAIL_FETCH_OVERRIDE`, y config `MAILGUN_API_KEY`/`MAILGUN_DOMAIN`/`MAILGUN_BASE_URL` que `enviarCorreoBienvenida`.
- Produces: `MailService.enviarNotificacion(params: EnviarNotificacionParams): Promise<void>` donde `EnviarNotificacionParams = { correoDestino: string; asunto: string; cuerpoTexto: string; cuerpoHtml?: string }`. Mismo contrato que `enviarCorreoBienvenida`: lanza si Mailgun rechaza / red falla / falta config; **no** hace la petición si el flag está apagado (loguea y retorna). El caller (Fases 15/16) envuelve en su propio try/catch best-effort.

- [ ] **Step 1: Escribir los tests que fallan**

En `App/backend/src/mail/mail.service.spec.ts`, agregar un `describe('enviarNotificacion', ...)` siguiendo el estilo de los tests existentes de `enviarCorreoBienvenida` (revisar el archivo para el patrón exacto de mock de `fetch` vía `MAIL_FETCH_OVERRIDE` y de set/unset de `process.env.MAILGUN_ENVIOS_HABILITADO`):

```ts
describe('enviarNotificacion', () => {
  it('con el flag apagado -> no llama fetch, resuelve', async () => {
    process.env.MAILGUN_ENVIOS_HABILITADO = 'false';
    const fetchMock = jest.fn();
    const service = new MailService(fetchMock as unknown as typeof fetch);
    await expect(
      service.enviarNotificacion({
        correoDestino: 'x@example.com',
        asunto: 'Hola',
        cuerpoTexto: 'Cuerpo',
      }),
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('con el flag prendido -> hace POST a Mailgun con to/subject/text', async () => {
    process.env.MAILGUN_ENVIOS_HABILITADO = 'true';
    process.env.MAILGUN_API_KEY = 'key-test';
    process.env.MAILGUN_DOMAIN = 'sandbox.mailgun.org';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    const service = new MailService(fetchMock as unknown as typeof fetch);

    await service.enviarNotificacion({
      correoDestino: 'dest@example.com',
      asunto: 'Nuevo aviso',
      cuerpoTexto: 'Tienes un aviso nuevo',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v3/sandbox.mailgun.org/messages');
    expect(String(init.body)).toContain('to=dest%40example.com');
    expect(String(init.body)).toContain('subject=Nuevo+aviso');
  });

  it('si Mailgun responde no-ok -> lanza', async () => {
    process.env.MAILGUN_ENVIOS_HABILITADO = 'true';
    process.env.MAILGUN_API_KEY = 'key-test';
    process.env.MAILGUN_DOMAIN = 'sandbox.mailgun.org';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: () => Promise.resolve('forbidden'),
    });
    const service = new MailService(fetchMock as unknown as typeof fetch);
    await expect(
      service.enviarNotificacion({
        correoDestino: 'd@example.com',
        asunto: 'x',
        cuerpoTexto: 'y',
      }),
    ).rejects.toThrow('Mailgun respondió 401');
  });
});
```

> Si el archivo de spec ya restablece `process.env` en un `afterEach`, no dupliques ese cleanup — reutilízalo.

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd App/backend && npx jest src/mail/mail.service.spec.ts`
Expected: FAIL — `service.enviarNotificacion is not a function`.

- [ ] **Step 3: Implementar el método**

En `App/backend/src/mail/mail.service.ts`, agregar la interfaz cerca de `EnviarCorreoBienvenidaParams`:

```ts
export interface EnviarNotificacionParams {
  /** Destino real del envío (`to:`). Normalmente `correoPersonal` del perfil. */
  correoDestino: string;
  asunto: string;
  cuerpoTexto: string;
  /** Opcional — si falta, se manda solo `text`. */
  cuerpoHtml?: string;
}
```

Y el método dentro de la clase `MailService` (después de `enviarCorreoBienvenida`):

```ts
/**
 * Envío genérico de notificación por correo — Fase 14, Día 38. Lo usan el
 * fan-out de avisos (Fase 16) y el job de recordatorios (Fase 15) como
 * efecto best-effort: el CALLER envuelve en su propio try/catch y no deja
 * que un fallo de Mailgun tumbe la operación (mismo criterio que
 * `enviarCorreoBienvenida` + `PersonasService.altaPersona`).
 *
 * Mismo comportamiento del flag `MAILGUN_ENVIOS_HABILITADO` (falla cerrado):
 * apagado -> loguea y retorna sin pegarle a Mailgun.
 */
async enviarNotificacion(params: EnviarNotificacionParams): Promise<void> {
  if (!enviosHabilitados()) {
    console.log(
      '[MailService] Envío deshabilitado (MAILGUN_ENVIOS_HABILITADO=false) — se hubiera enviado a:',
      params.correoDestino,
    );
    return;
  }

  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const baseUrl = process.env.MAILGUN_BASE_URL ?? 'https://api.mailgun.net';

  if (!apiKey || !domain) {
    throw new Error('Falta MAILGUN_API_KEY o MAILGUN_DOMAIN en el entorno');
  }

  const body = new URLSearchParams({
    from: `SIGE CESP <postmaster@${domain}>`,
    to: params.correoDestino,
    subject: params.asunto,
    text: params.cuerpoTexto,
    ...(params.cuerpoHtml ? { html: params.cuerpoHtml } : {}),
  });

  const auth = Buffer.from(`api:${apiKey}`).toString('base64');
  const clientFetch = this.getFetch();
  const response = await clientFetch(`${baseUrl}/v3/${domain}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const detalle = await response.text().catch(() => '');
    throw new Error(
      `Mailgun respondió ${response.status} ${response.statusText}: ${detalle}`,
    );
  }
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd App/backend && npx jest src/mail/mail.service.spec.ts`
Expected: PASS (todos, incluidos los de `enviarCorreoBienvenida` que ya existían).

- [ ] **Step 5: Verificar build/lint**

Run: `cd App/backend && npx tsc --noEmit && npx eslint "src/mail/**/*.ts"`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/backend/src/mail/
git commit -m "feat(backend): MailService.enviarNotificacion generico (Fase 14, Dia 38)

Metodo generico para el fan-out de avisos (Fase 16) y el job de
recordatorios (Fase 15). Mismo flag MAILGUN_ENVIOS_HABILITADO y contrato
'lanza, el caller decide best-effort' que enviarCorreoBienvenida. Sin
caller todavia.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ybz7jkzjiorsr82P95UQnH"
```

---

## Task 5: `lib/api/notificaciones.ts` (cliente de API compartido)

**Files:**
- Create: `App/frontend/src/lib/api/notificaciones.ts`

**Interfaces:**
- Consumes: `apiFetchAuth`, `apiFetchAuthPaginado`, `ApiListaPaginada` de `./http`.
- Produces:
  - `TipoNotificacion = 'AVISO' | 'RECORDATORIO_EVENTO'`
  - `Notificacion = { id: string; tipo: TipoNotificacion; referenciaId: string; titulo: string; cuerpoCorto: string; leidoEn: string | null; createdAt: string }`
  - `listarNotificaciones(page?: number, limit?: number): Promise<ApiListaPaginada<Notificacion>>`
  - `conteoNoLeidas(): Promise<{ total: number }>`
  - `marcarLeida(id: string): Promise<{ ok: true }>`

- [ ] **Step 1: Escribir el archivo**

Create `App/frontend/src/lib/api/notificaciones.ts`:

```ts
import { apiFetchAuth, apiFetchAuthPaginado, type ApiListaPaginada } from './http';

/**
 * `GET /notificaciones`, `GET /notificaciones/conteo-no-leidas`,
 * `PATCH /notificaciones/:id/leido` — Fase 14, Día 38/39.
 *
 * Cliente de API COMPARTIDO entre los 3 árboles (admin/alumno/maestro) —
 * mismo criterio que `lib/api/perfil.ts` (lo usan los 3 `SedeBadge`). Regla
 * 11 aplica a componentes, no a `lib/api/*`. Shape espejo de
 * `NotificacionesService` (`App/backend/src/notificaciones/`), mantener en
 * sync a mano.
 */
export type TipoNotificacion = 'AVISO' | 'RECORDATORIO_EVENTO';

export interface Notificacion {
  id: string;
  tipo: TipoNotificacion;
  referenciaId: string;
  titulo: string;
  cuerpoCorto: string;
  leidoEn: string | null;
  createdAt: string;
}

export function listarNotificaciones(
  page = 1,
  limit = 20,
): Promise<ApiListaPaginada<Notificacion>> {
  return apiFetchAuthPaginado<Notificacion>(
    `/notificaciones?page=${page}&limit=${limit}`,
  );
}

export function conteoNoLeidas(): Promise<{ total: number }> {
  return apiFetchAuth<{ total: number }>('/notificaciones/conteo-no-leidas');
}

export function marcarLeida(id: string): Promise<{ ok: true }> {
  return apiFetchAuth<{ ok: true }>(
    `/notificaciones/${encodeURIComponent(id)}/leido`,
    { method: 'PATCH' },
  );
}
```

- [ ] **Step 2: Verificar que compila y linta**

Run: `cd App/frontend && npx tsc --noEmit && npx eslint src/lib/api/notificaciones.ts`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/frontend/src/lib/api/notificaciones.ts
git commit -m "feat(frontend): cliente de API de notificaciones (compartido) (Fase 14, Dia 39)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ybz7jkzjiorsr82P95UQnH"
```

---

## Task 6: `NotificacionesBell` del árbol admin + montaje

**Files:**
- Create: `App/frontend/src/components/admin/ui/shell/NotificacionesBell.tsx`
- Modify: `App/frontend/src/components/admin/ui/shell/AdminShell.tsx` (función `Topbar`, ~línea 154-182)
- Reference: `App/frontend/node_modules/next/dist/docs/` (leer lo relevante de App Router / client components antes de escribir)
- Reference: `App/frontend/src/components/admin/ui/shell/AdminShell.tsx` (patrón `SedeBadge` con `useQuery` + `console.error` en el catch), `App/frontend/src/components/admin/ui/shell/icons.tsx` (íconos existentes)

**Interfaces:**
- Consumes: `conteoNoLeidas`, `listarNotificaciones`, `marcarLeida`, `Notificacion` de `@/lib/api/notificaciones`. `useQuery`, `useQueryClient` de `@tanstack/react-query`.
- Produces: componente `NotificacionesBell` (default o named export — seguir la convención del archivo hermano `ProfileDropdown.tsx`), sin props. Montado en `Topbar` de `AdminShell` a la izquierda de `<ProfileDropdown />`.

- [ ] **Step 1: Revisar el ícono de campana disponible**

Run: `cd App/frontend && grep -n "export function Icon" src/components/admin/ui/shell/icons.tsx`
Expected: lista de íconos. Si no hay una campana (`IconCampana`/`IconBell`), agregar uno nuevo a `icons.tsx` siguiendo el formato exacto de los existentes (SVG inline, `className` passthrough, `viewBox="0 0 24 24"`, `stroke="currentColor"` o `fill`). Path de campana estándar (Heroicons outline "bell"):
```
M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0
```

- [ ] **Step 2: Escribir el componente**

Create `App/frontend/src/components/admin/ui/shell/NotificacionesBell.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  conteoNoLeidas,
  listarNotificaciones,
  marcarLeida,
  type Notificacion,
} from '@/lib/api/notificaciones';
import { IconCampana } from './icons';

/**
 * Campana de notificaciones del navbar ADMIN — Fase 14, Día 39.
 *
 * Regla 11 de `CLAUDE.md` raíz: cada árbol (admin/alumno/maestro) tiene su
 * PROPIO componente de campana; este no se comparte con
 * `components/{alumno,maestro}/ui/shell/NotificacionesBell.tsx` aunque sean
 * casi idénticos. El cliente de API (`lib/api/notificaciones.ts`) sí es
 * compartido.
 *
 * Polling: `useQuery` sobre el conteo con `refetchInterval` (60s) — sin
 * websockets (el volumen de un ERP escolar no lo justifica; estabilidad >
 * todo). La lista completa solo se pide al abrir el dropdown.
 *
 * En la Fase 14 no existen `Aviso` ni `EventoCalendario`, así que un ítem
 * del dropdown solo se marca como leído al hacer click (no navega a ningún
 * lado todavía). El deep-link por `tipo` lo agregan las Fases 15/16.
 */
export function NotificacionesBell() {
  const queryClient = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);

  const { data: conteo } = useQuery({
    queryKey: ['notificaciones', 'conteo'],
    queryFn: async () => {
      try {
        return await conteoNoLeidas();
      } catch (err) {
        console.error('[NotificacionesBell] Error al obtener el conteo:', err);
        throw err;
      }
    },
    refetchInterval: 60_000,
  });

  const { data: lista } = useQuery({
    queryKey: ['notificaciones', 'lista'],
    queryFn: async () => {
      try {
        return await listarNotificaciones(1, 10);
      } catch (err) {
        console.error('[NotificacionesBell] Error al obtener la lista:', err);
        throw err;
      }
    },
    enabled: abierto,
  });

  // Cerrar al hacer click fuera / con Escape (mismo criterio que
  // MobileDrawer en AdminShell — foco-lite sin librería nueva).
  useEffect(() => {
    if (!abierto) return;
    function onClickFuera(e: MouseEvent) {
      if (
        contenedorRef.current &&
        !contenedorRef.current.contains(e.target as Node)
      ) {
        setAbierto(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setAbierto(false);
    }
    window.addEventListener('mousedown', onClickFuera);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClickFuera);
      window.removeEventListener('keydown', onKey);
    };
  }, [abierto]);

  const noLeidas = conteo?.total ?? 0;

  async function onClickItem(n: Notificacion) {
    if (n.leidoEn) return;
    try {
      await marcarLeida(n.id);
      await queryClient.invalidateQueries({ queryKey: ['notificaciones'] });
    } catch (err) {
      console.error('[NotificacionesBell] Error al marcar leída:', err);
    }
  }

  return (
    <div ref={contenedorRef} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-label={
          noLeidas > 0
            ? `Notificaciones (${noLeidas} sin leer)`
            : 'Notificaciones'
        }
        className="relative rounded-lg p-1.5 text-slate transition-colors hover:bg-mist/50 focus-visible:ring-2 focus-visible:ring-navy focus-visible:outline-none"
      >
        <IconCampana className="size-5" />
        {noLeidas > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-crimson px-1 text-[10px] font-semibold text-white">
            {noLeidas > 9 ? '9+' : noLeidas}
          </span>
        )}
      </button>

      {abierto && (
        <div className="absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-lg border border-mist bg-white shadow-lg">
          <div className="border-b border-mist px-4 py-2.5 text-xs font-semibold tracking-wide text-slate uppercase">
            Notificaciones
          </div>
          <ul className="max-h-96 divide-y divide-mist overflow-y-auto">
            {(lista?.data.length ?? 0) === 0 && (
              <li className="px-4 py-6 text-center text-sm text-slate/60">
                No tienes notificaciones
              </li>
            )}
            {lista?.data.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onClickItem(n)}
                  className={[
                    'block w-full px-4 py-3 text-left transition-colors hover:bg-bone',
                    n.leidoEn ? 'opacity-60' : '',
                  ].join(' ')}
                >
                  <p className="text-sm font-medium text-slate">{n.titulo}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-slate/70">
                    {n.cuerpoCorto}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

> Ajustar el nombre de los tokens de color (`text-slate`, `bg-crimson`, `border-mist`, `bg-bone`) si `grep -rn "bg-crimson\|text-slate" src/components/admin/` muestra que el árbol admin usa otros. Verificar antes de dar por bueno.

- [ ] **Step 3: Montar el bell en `AdminShell` → `Topbar`**

Modify `App/frontend/src/components/admin/ui/shell/AdminShell.tsx`. En el import block (~línea 9), agregar:

```ts
import { NotificacionesBell } from './NotificacionesBell';
```

En la función `Topbar` (~línea 177-179), el bloque final `justify-self-end`:

```tsx
      <div className="flex shrink-0 items-center gap-1 justify-self-end">
        <NotificacionesBell />
        <ProfileDropdown email={email} />
      </div>
```

- [ ] **Step 4: Verificar build y lint**

Run: `cd App/frontend && npx tsc --noEmit && npx eslint "src/components/admin/ui/shell/**/*.tsx"`
Expected: sin errores.

- [ ] **Step 5: Build de producción del frontend**

Run: `cd App/frontend && pnpm build`
Expected: build exitoso.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/frontend/src/components/admin/ui/shell/
git commit -m "feat(frontend): campana de notificaciones en el navbar admin (Fase 14, Dia 39)

Badge de no-leidas con polling (60s) + dropdown con las ultimas 10, marca
leido al hacer click. Regla 11: componente propio del arbol admin.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ybz7jkzjiorsr82P95UQnH"
```

---

## Task 7: `NotificacionesBell` de alumno y maestro + montaje + verificación final

**Files:**
- Create: `App/frontend/src/components/alumno/ui/shell/NotificacionesBell.tsx`
- Create: `App/frontend/src/components/maestro/ui/shell/NotificacionesBell.tsx`
- Modify: `App/frontend/src/components/alumno/ui/shell/Header.tsx`
- Modify: `App/frontend/src/components/maestro/ui/shell/Header.tsx`
- Reference: `App/frontend/src/components/{alumno,maestro}/ui/shell/icons.tsx`

**Interfaces:**
- Consumes: mismo `@/lib/api/notificaciones` que Task 6.
- Produces: `NotificacionesBell` en cada uno de los 2 árboles (named export, misma firma que la de admin — sin props). Montado en el `<header>` de cada `Header.tsx`, entre el badge de sede y `<ProfileDropdown />`.

- [ ] **Step 1: Crear el componente para alumno**

Create `App/frontend/src/components/alumno/ui/shell/NotificacionesBell.tsx` — **copia exacta** del componente de la Task 6, con estos cambios:
- El comentario de cabecera dice "navbar ALUMNO" y referencia `components/{admin,maestro}/...`.
- El import del ícono: `import { IconCampana } from './icons';` — verificar que exista en `src/components/alumno/ui/shell/icons.tsx`; si no, agregarlo con el mismo path SVG de la Task 6 Step 1, en el formato de ese archivo.
- Ajustar tokens de color a los que use el árbol alumno (`grep -rn "bg-crimson\|text-slate\|border-mist" src/components/alumno/`).

- [ ] **Step 2: Crear el componente para maestro**

Create `App/frontend/src/components/maestro/ui/shell/NotificacionesBell.tsx` — igual que el Step 1 pero para el árbol maestro (comentario "navbar MAESTRO", `icons.tsx` de maestro, tokens de maestro).

- [ ] **Step 3: Montar en el Header de alumno**

Modify `App/frontend/src/components/alumno/ui/shell/Header.tsx`:

```tsx
import { ProfileDropdown } from './ProfileDropdown';
import { SedeCarreraBadge } from './SedeCarreraBadge';
import { NotificacionesBell } from './NotificacionesBell';
```

En el `<div className="flex items-center justify-between gap-4">`, cambiar el bloque final:

```tsx
        <SedeCarreraBadge />
        <div className="flex items-center gap-1">
          <NotificacionesBell />
          <ProfileDropdown email={email} />
        </div>
```

- [ ] **Step 4: Montar en el Header de maestro**

Modify `App/frontend/src/components/maestro/ui/shell/Header.tsx` — mismo cambio que el Step 3 pero con `SedeBadge` (no `SedeCarreraBadge`):

```tsx
import { ProfileDropdown } from './ProfileDropdown';
import { SedeBadge } from './SedeBadge';
import { NotificacionesBell } from './NotificacionesBell';
```
```tsx
        <SedeBadge />
        <div className="flex items-center gap-1">
          <NotificacionesBell />
          <ProfileDropdown email={email} />
        </div>
```

- [ ] **Step 5: Verificar build y lint del frontend completo**

Run: `cd App/frontend && npx tsc --noEmit && pnpm lint && pnpm build`
Expected: los 3 en verde. (`pnpm lint` de frontend — confirmar si es `next lint`/`eslint` sin `--fix`; si reformatea archivos ajenos, usar `npx eslint "src/components/{alumno,maestro}/ui/shell/**/*.tsx"` en su lugar.)

- [ ] **Step 6: Verificación manual en navegador (a cargo del usuario)**

Documentar para el usuario los pasos: con el backend (`pnpm start:dev` en `App/backend`) y el frontend (`pnpm dev` en `App/frontend`) corriendo, y una notificación insertada a mano en la DB de dev para un usuario de prueba de cada rol (ej. vía Prisma Studio o un `INSERT`), verificar:
  1. Login como admin → la campana muestra el badge con el conteo correcto; abrir el dropdown lista la notificación; click la marca leída y el badge baja.
  2. Igual como alumno y como maestro.
  3. Un usuario sin notificaciones ve la campana sin badge y el dropdown dice "No tienes notificaciones".
  4. El badge se actualiza solo (~60s) tras insertar otra notificación sin recargar la página.

> Regla 14: máximo 3 escrituras reales a la DB para esta verificación manual — insertar 1 notificación por rol (3 en total) y reutilizarlas.

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/frontend/src/components/alumno/ui/shell/ App/frontend/src/components/maestro/ui/shell/
git commit -m "feat(frontend): campana de notificaciones en navbar de alumno y maestro (Fase 14, Dia 39)

Componente propio por arbol (regla 11), cliente de API compartido. Cierra
la Fase 14 en codigo — verificacion manual en navegador pendiente del usuario.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ybz7jkzjiorsr82P95UQnH"
```

---

## Cierre de fase (después de la review final + QA)

- [ ] `qa-frontend` (cubre `lib/api/`) + `qa-admin` + `qa-alumno` auditan y consignan veredicto en `documentacion_de_agentes/ESTADO.md`. `qa-backend` audita el módulo `notificaciones`.
- [ ] Marcar los checkboxes de Día 38 y Día 39 en `ESTADO.md`.
- [ ] Documentar en `CLAUDE.md` raíz (sección "Contrato de API"): las 3 rutas de `/notificaciones`; en "CRUD por tipo de entidad" agregar `Notificacion` como "Negocio (no CRUD)". Env vars: ninguna nueva en esta fase (`INTERNAL_JOB_SECRET`/`RECORDATORIOS_HABILITADO` entran en la Fase 15).
- [ ] `roadmap.md`: **no** tachar todavía — la Fase 14 no tiene línea de "fase completa" propia con verificación de usuario; se marca cuando el usuario confirme la verificación manual del Step 6 de la Task 7.
- [ ] Migración pendiente para prod: `_notificaciones` se suma a la lista del Día 50 (Fase 17) / o del Día 37 si aún no se corrió. Anotarlo en `ESTADO.md`.

## Self-Review (hecho al escribir el plan)

- **Spec coverage:** Día 38 (modelo + RLS → Task 1; endpoints → Task 2; e2e → Task 3; `MailService.enviarNotificacion` → Task 4). Día 39 (`lib/api` → Task 5; bell admin → Task 6; bell alumno+maestro → Task 7; polling `refetchInterval` → Tasks 6/7; QA ligero → Cierre). Sin gaps.
- **Placeholder scan:** sin "TBD"/"TODO" en código. El único "pendiente" real (deep-link por `tipo` en el dropdown) es alcance explícito de Fases 15/16, documentado en el comentario del componente, no un placeholder.
- **Type consistency:** `NotificacionItem` (backend service) ↔ `Notificacion` (frontend `lib/api`) — mismos campos, `leidoEn`/`createdAt` son `Date` en backend (se serializan a `string` ISO en el JSON) y `string` en el tipo de frontend. `conteoNoLeidas()` devuelve `{ total: number }` en ambos lados. `marcarLeida(id)` → `{ ok: true }`. Consistente.
