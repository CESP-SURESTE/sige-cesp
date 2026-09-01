# Fase 15 — Calendario — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calendario escolar con eventos por categoría, alcance (sede/carrera/grupo) y
recurrencia (diaria/semanal/mensual), con recordatorios automáticos vía la infra de
`Notificacion` (Fase 14), y una vista mensual por rol en los 3 árboles de frontend
(admin/maestro pueden crear y editar; alumno solo lee).

**Architecture:** Módulo NestJS nuevo `src/calendario/` (mismo patrón que
`src/grupos/`): `SedeGuard` + `RolesGuard`, `sedeId` siempre de `@SedeActual()`. Las
ocurrencias de un evento recurrente NUNCA se materializan como filas (regla 1) — se
expanden al vuelo con una función pura (`recurrencia.util.ts`) dentro del rango que pida
cada `GET /eventos`. Dos helpers compartidos (`src/common/publicacion/`) —
`validarAlcancePublicacion` y `resolverDestinatarios` — encapsulan la lógica de permisos
y de "a quién le toca este alcance", reutilizada tal cual por Avisos (Fase 16). El job de
recordatorios corre detrás de un endpoint interno protegido por secreto compartido (no
JWT), disparado por `pg_cron`/`pg_net` de Supabase — sin agregar `@nestjs/schedule` ni
ninguna dependencia nueva (Render free tier duerme el proceso, un cron interno del
proceso no dispararía confiable). En frontend, Calendario gana **ruta propia en los 3
árboles** (`app/{admin,maestro,alumno}/calendario/page.tsx`) — decisión explícita del
usuario del 2026-09-01: un calendario mensual (grid + navegación + modal) es demasiado
grande para la convención anterior de "sección apilada en el perfil" que usaron
Compañeros/Asignaciones (Días 32/34); alumno y maestro ganan así su primer link de
navegación real fuera de su página única.

**Tech Stack:** NestJS 11 + Prisma 6.x + PostgreSQL/Supabase (backend) · Next.js (App
Router) + `@tanstack/react-query` + Tailwind (frontend) · Supabase `pg_cron`/`pg_net`
(disparador del job, configurado fuera del ciclo de código).

## Global Constraints

- **Contrato de API:** éxito `{ data: ... }` (+ `page`/`limit`/`total` en listas
  paginadas — `GET /eventos` NO pagina, ver Task 3). Error `{ error: "mensaje", code:
  "TIPO" }`. Códigos fijos: `VALIDATION_ERROR`, `NOT_FOUND`, `UNAUTHORIZED`, `CONFLICT`,
  `SERVER_ERROR`, más `ROL_NO_AUTORIZADO` (ya existente, `RolesGuard`) reutilizado para el
  cross-scope de `validarAlcancePublicacion`. Esta fase no agrega códigos de dominio
  nuevos.
- **Regla 1:** las ocurrencias de eventos recurrentes NUNCA se persisten — se expanden al
  vuelo (`recurrencia.util.ts`) dentro del rango pedido.
- **Regla 2:** doble capa RLS (Postgres) + guard (NestJS). El guard saca `sede_id` del
  JWT, jamás del body/query/path. `eventos_calendario` lleva RLS directa por `sede_id`;
  `recordatorio_enviado` aísla indirecto vía `eventos_calendario.sede_id` (calco de
  `sede_isolation_grupo_alumnos`).
- **Regla 5:** crear/editar/borrar un `EventoCalendario` audita (`ALTA`/`EDICION`/
  `ELIMINACION`) en la misma transacción — mismo patrón que `GruposService`. `PATCH` solo
  audita si hay cambios reales (`hayCambiosReales`, patrón de `CarrerasService`).
- **Regla 11:** separación total admin/alumno/maestro en frontend — cada árbol tiene su
  propia página de calendario, su propio modal, su propio helper de grid mensual (código
  duplicado a propósito entre árboles). `lib/api/calendario.ts` SÍ es infra compartida
  (mismo criterio que `lib/api/grupos.ts`).
- **Regla 12:** todo catch loguea el error completo (`console.error`) antes de responder,
  backend y frontend. El job de recordatorios loguea cada fallo de correo sin tumbar el
  job (best-effort, patrón `altaPersona` + Mailgun).
- **Regla 13:** la pantalla de admin/maestro es tabla-como-grid + modal único de
  alta/edición (no dos modales distintos por entidad).
- **Corrección deliberada al spec de diseño** (`docs/superpowers/specs/2026-08-31-calendario-avisos-notificaciones-design.md`):
  el spec sugiere `src/comun/alcance-publicacion.ts` — este proyecto usa `src/common/`
  (inglés) para toda infraestructura cross-cutting (`decorators/`, `guards/`, `pipes/`,
  `types/`), sin ningún `src/comun/` existente. Los helpers de esta fase van en
  `src/common/publicacion/` para no introducir una segunda convención de nombres.
- **`EventoCalendario.fechaFin` es informativo, no genera ocurrencias adicionales.** El
  spec define `expandirOcurrencias(evento: { fechaInicio, recurrenciaRegla,
  recurrenciaHasta }, rango)` — `fechaFin` NO forma parte de la firma. Se interpreta
  literal: un evento sin recurrencia con `fechaFin` (ej. "Suspensión de clases, 3 días")
  produce UNA sola ocurrencia en `fechaInicio`; `fechaFin` viaja como metadato en
  `OcurrenciaEvento` para que la UI lo muestre en el detalle ("hasta: X"), sin dibujar un
  marcador por cada día intermedio. Si se necesita expansión día-a-día de rangos simples
  en el futuro, es una decisión nueva, no algo que este plan deba inventar.
- **Migraciones:** `prisma migrate dev` sigue roto en el repo (`P3006`, shadow DB sin
  schema `auth`). Se generan con `prisma migrate diff --from-schema-datasource
  prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` y se aplican
  con `prisma migrate deploy`, nunca `migrate dev`.
- **Terminal:** PowerShell 7 (`pwsh`) en Windows. Los comandos `Run:` de este plan usan
  sintaxis POSIX para el Bash tool.
- **Lint backend:** verificar archivos nuevos con `npx eslint "<archivos>"` **sin**
  `--fix` (el `pnpm lint` del repo es `eslint --fix` y reformatea archivos ajenos).
- **Tests backend:** unit con `pnpm test` (o `npx jest <archivo>` para uno solo), e2e con
  `NODE_OPTIONS=--experimental-vm-modules npx jest --config test/jest-e2e.json <patrón>
  --runInBand` (el `NODE_OPTIONS` es necesario por el `import('jose')` en el `beforeAll`
  de los specs e2e) o `pnpm test:e2e` para la suite completa.
- **Tests frontend:** no hay suite de componentes — verificación es `npx tsc --noEmit` +
  `npx eslint "<archivos>"` (sin `--fix`) + `pnpm build` de producción + verificación
  manual en navegador (patrón establecido del proyecto).
- **Commits:** en `dev`, con los trailers `Co-Authored-By: Claude Sonnet 5
  <noreply@anthropic.com>` y `Claude-Session:
  https://claude.ai/code/session_01AGjjFjoqQ1gmLwoZsox6Lw`.
- **`App/frontend/AGENTS.md`** puede aparecer reescrito por `next dev` con un bloque de
  aviso sobre `node_modules/next/dist/docs/` — comportamiento conocido del repo, no una
  inyección de instrucciones; si aparece en el diff, commitearlo tal cual.

---

## File Structure

**Backend (`App/backend/`):**
- `prisma/schema.prisma` — MODIFY: modelos `EventoCalendario`/`RecordatorioEnviado` +
  enums `CategoriaEvento`/`AlcanceDestino` + back-relations en `Usuario`/`Sede`.
- `prisma/migrations/<timestamp>_calendario/migration.sql` — CREATE.
- `src/calendario/recurrencia.util.ts` — CREATE: función pura `expandirOcurrencias`.
- `src/calendario/recurrencia.util.spec.ts` — CREATE: unit tests.
- `src/common/publicacion/alcance-publicacion.util.ts` — CREATE: `validarAlcancePublicacion`
  + `resolverDestinatarios`, reutilizado por Avisos (Fase 16).
- `src/calendario/dto/regla-recurrencia.dto.ts` — CREATE.
- `src/calendario/dto/crear-evento.dto.ts` — CREATE.
- `src/calendario/dto/actualizar-evento.dto.ts` — CREATE.
- `src/calendario/dto/listar-eventos.query.dto.ts` — CREATE.
- `src/calendario/calendario.service.ts` — CREATE.
- `src/calendario/calendario.controller.ts` — CREATE.
- `src/calendario/calendario.module.ts` — CREATE.
- `src/app.module.ts` — MODIFY: registrar `CalendarioModule`.
- `test/calendario.e2e-spec.ts` — CREATE.
- `src/common/guards/internal-job.guard.ts` — CREATE.
- `src/common/guards/internal-job-guard.module.ts` — CREATE.
- `src/calendario/internal-recordatorios.controller.ts` — CREATE: `POST
  /internal/recordatorios/ejecutar`.
- `test/internal-recordatorios.e2e-spec.ts` — CREATE.
- `.env.example` — MODIFY: `INTERNAL_JOB_SECRET`, `RECORDATORIOS_HABILITADO`.
- `docs/setup-backend-recordatorios-cron.md` — CREATE: instrucciones para configurar
  `pg_cron`/`pg_net` en Supabase (tarea manual del usuario, fuera del ciclo de review).

**Frontend (`App/frontend/`):**
- `src/lib/api/calendario.ts` — CREATE: cliente compartido.
- `src/app/admin/calendario/page.tsx` — CREATE.
- `src/app/admin/calendario/EventoModal.tsx` — CREATE.
- `src/app/admin/calendario/ConfirmarEliminarEventoModal.tsx` — CREATE.
- `src/app/admin/calendario/mes-grid.util.ts` — CREATE.
- `src/components/admin/ui/shell/Sidebar.tsx` — MODIFY: link nuevo "Calendario".
- `src/components/admin/ui/shell/icons.tsx` — MODIFY: `IconCalendario` si no existe.
- `src/app/maestro/calendario/page.tsx` — CREATE.
- `src/app/maestro/calendario/EventoModal.tsx` — CREATE.
- `src/app/maestro/calendario/ConfirmarEliminarEventoModal.tsx` — CREATE.
- `src/app/maestro/calendario/mes-grid.util.ts` — CREATE.
- `src/components/maestro/ui/shell/Header.tsx` — MODIFY: nav "Mi perfil"/"Calendario".
- `src/components/maestro/ui/shell/icons.tsx` — MODIFY: `IconCalendario` si no existe.
- `src/app/alumno/calendario/page.tsx` — CREATE.
- `src/app/alumno/calendario/DetalleEventoModal.tsx` — CREATE.
- `src/app/alumno/calendario/mes-grid.util.ts` — CREATE.
- `src/components/alumno/ui/shell/Header.tsx` — MODIFY: nav "Mi perfil"/"Calendario".
- `src/components/alumno/ui/shell/icons.tsx` — MODIFY: `IconCalendario` si no existe.

---

## Task 1: Modelo `EventoCalendario` + `RecordatorioEnviado` + migración + RLS

**Files:**
- Modify: `App/backend/prisma/schema.prisma`
- Create: `App/backend/prisma/migrations/<timestamp>_calendario/migration.sql`

**Interfaces:**
- Produces: modelo Prisma `EventoCalendario` (`id`, `sedeId`, `autorUsuarioId`, `titulo`,
  `descripcion?`, `fechaInicio: Date`, `horaInicio?: string`, `fechaFin?: Date`,
  `categoria: CategoriaEvento`, `alcanceTipo: AlcanceDestino`, `alcanceId?: string`,
  `recurrenciaRegla?: Prisma.JsonValue`, `recurrenciaHasta?: Date`, `createdAt`,
  `updatedAt`); modelo `RecordatorioEnviado` (`id`, `eventoId`, `fechaOcurrencia: Date`,
  `enviadoEn`); enums `CategoriaEvento` (`EXAMEN`, `SOCIAL`, `ADMINISTRATIVO`,
  `SUSPENSION_CLASES`, `OTRO`) y `AlcanceDestino` (`SEDE`, `CARRERA`, `GRUPO`).

- [ ] **Step 1: Escribir los enums y modelos en `schema.prisma`**

En el bloque de enums (junto a `TipoNotificacion`) agregar:

```prisma
enum CategoriaEvento {
  EXAMEN
  SOCIAL
  ADMINISTRATIVO
  SUSPENSION_CLASES
  OTRO
}

/// Compartido con Aviso (Fase 16) — mismo shape de "a quién le toca esto".
enum AlcanceDestino {
  SEDE
  CARRERA
  GRUPO
}
```

Agregar los modelos (junto a `Notificacion`, sección de infraestructura):

```prisma
/// Evento de calendario escolar — Fase 15, Día 40. `alcanceId` apunta a
/// `Carrera.id` o `Grupo.id` según `alcanceTipo`, o es null si `SEDE` — sin
/// FK (el alcance se valida en `validarAlcancePublicacion`, no vía
/// constraint de DB, mismo criterio que `Notificacion.referenciaId`).
/// `recurrenciaRegla` es `Json?` (shape `ReglaRecurrencia` de
/// `recurrencia.util.ts`, validado en el DTO — no en la DB); las
/// ocurrencias NUNCA se persisten (regla 1), se expanden al vuelo.
/// `fechaFin` es informativo (ver Global Constraints) — no genera
/// ocurrencias adicionales.
model EventoCalendario {
  id               String          @id @default(uuid())
  sedeId           String          @map("sede_id")
  sede             Sede            @relation(fields: [sedeId], references: [id])
  autorUsuarioId   String          @map("autor_usuario_id")
  autor            Usuario         @relation(fields: [autorUsuarioId], references: [id])
  titulo           String
  descripcion      String?
  fechaInicio      DateTime        @map("fecha_inicio") @db.Date
  horaInicio       String?         @map("hora_inicio")
  fechaFin         DateTime?       @map("fecha_fin") @db.Date
  categoria        CategoriaEvento
  alcanceTipo      AlcanceDestino  @map("alcance_tipo")
  alcanceId        String?         @map("alcance_id")
  recurrenciaRegla Json?           @map("recurrencia_regla")
  recurrenciaHasta DateTime?       @map("recurrencia_hasta") @db.Date
  createdAt        DateTime        @default(now()) @map("created_at")
  updatedAt        DateTime        @updatedAt @map("updated_at")

  recordatoriosEnviados RecordatorioEnviado[]

  @@map("eventos_calendario")
}

/// Idempotencia del job de recordatorios — Fase 15, Día 42. Una fila por
/// ocurrencia ya notificada (`@@unique` la hace segura ante corridas
/// solapadas del cron). `onDelete: Cascade` — si se borra el evento, sus
/// recordatorios enviados dejan de tener sentido (no son historial de
/// negocio, regla 5 no aplica).
model RecordatorioEnviado {
  id              String           @id @default(uuid())
  eventoId        String           @map("evento_id")
  evento          EventoCalendario @relation(fields: [eventoId], references: [id], onDelete: Cascade)
  fechaOcurrencia DateTime         @map("fecha_ocurrencia") @db.Date
  enviadoEn       DateTime         @default(now()) @map("enviado_en")

  @@unique([eventoId, fechaOcurrencia])
  @@map("recordatorio_enviado")
}
```

En `model Usuario` (bloque de relaciones, junto a `notificaciones`):

```prisma
  eventosCreados       EventoCalendario[]
```

En `model Sede` (bloque de relaciones):

```prisma
  eventosCalendario   EventoCalendario[]
```

- [ ] **Step 2: Generar el cliente Prisma y verificar que compila el schema**

Run: `cd App/backend && npx prisma generate`
Expected: `✔ Generated Prisma Client`, sin errores de validación.

- [ ] **Step 3: Generar el diff SQL contra la DB real de dev**

```bash
cd App/backend
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > /tmp/calendario.sql
cat /tmp/calendario.sql
```
Expected: `CREATE TYPE "CategoriaEvento"`, `CREATE TYPE "AlcanceDestino"`, `CREATE TABLE
"eventos_calendario"`, `CREATE TABLE "recordatorio_enviado"`, `CREATE UNIQUE INDEX` para
`(evento_id, fecha_ocurrencia)`, FKs — la de `recordatorio_enviado.evento_id` con `ON
DELETE CASCADE` (verificar que el SQL generado la incluya; si Prisma no la refleja al
diff por algún motivo, agregarla a mano en el `.sql` final).

- [ ] **Step 4: Guardar la migración y anexar el bloque RLS**

```bash
cd App/backend
mkdir -p "prisma/migrations/$(date +%Y%m%d%H%M%S)_calendario"
```

Copiar `/tmp/calendario.sql` a `prisma/migrations/<timestamp>_calendario/migration.sql` y
anexar (calcado de `sede_isolation_notificaciones` para la directa, y de
`sede_isolation_grupo_alumnos` para la indirecta):

```sql
-- ============================================================
-- EVENTOS_CALENDARIO (sede_id directo)
-- ============================================================
ALTER TABLE "eventos_calendario" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "eventos_calendario" TO authenticated;

CREATE POLICY "sede_isolation_eventos_calendario" ON "eventos_calendario"
  FOR ALL
  USING (sede_id = public.current_sede_id())
  WITH CHECK (sede_id = public.current_sede_id());

-- ============================================================
-- RECORDATORIO_ENVIADO (sede_id indirecto vía eventos_calendario)
-- ============================================================
ALTER TABLE "recordatorio_enviado" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "recordatorio_enviado" TO authenticated;

CREATE POLICY "sede_isolation_recordatorio_enviado" ON "recordatorio_enviado"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "eventos_calendario" e
      WHERE e.id = "recordatorio_enviado".evento_id
        AND e.sede_id = public.current_sede_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "eventos_calendario" e
      WHERE e.id = "recordatorio_enviado".evento_id
        AND e.sede_id = public.current_sede_id()
    )
  );
```

- [ ] **Step 5: Aplicar la migración**

Run: `cd App/backend && npx prisma migrate deploy`
Expected: `The following migration(s) have been applied: ..._calendario`.

- [ ] **Step 6: Verificar estado**

Run: `cd App/backend && npx prisma migrate status`
Expected: `Database schema is up to date!`

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/backend/prisma/schema.prisma App/backend/prisma/migrations/
git commit -m "feat(backend): modelo EventoCalendario + RecordatorioEnviado + RLS (Fase 15, Dia 40)

Ocurrencias de eventos recurrentes NUNCA se persisten (regla 1) - se
expanden al vuelo (Task 2). RLS directa por sede_id en
eventos_calendario, indirecta via eventos_calendario.sede_id en
recordatorio_enviado (calco de grupo_alumnos). RecordatorioEnviado.evento
ON DELETE CASCADE (no es historial de negocio).

Migracion via 'prisma migrate diff' + 'migrate deploy' (migrate dev
sigue roto por P3006 shadow-DB).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AGjjFjoqQ1gmLwoZsox6Lw"
```

---

## Task 2: Motor de recurrencia (`recurrencia.util.ts`)

**Files:**
- Create: `App/backend/src/calendario/recurrencia.util.ts`
- Create: `App/backend/src/calendario/recurrencia.util.spec.ts`

**Interfaces:**
- Produces: `type ReglaRecurrencia = { frecuencia: 'DIARIA' | 'SEMANAL' | 'MENSUAL';
  intervalo: number; diasSemana?: number[]; diaMes?: number }`; `MAX_OCURRENCIAS = 366`
  (exportada, la usa el test); `expandirOcurrencias(evento: { fechaInicio: Date;
  recurrenciaRegla: ReglaRecurrencia | null; recurrenciaHasta: Date | null }, rango: {
  desde: Date; hasta: Date }): Date[]`.
- Consumes: nada (función pura, sin DB, sin NestJS DI — un archivo `.ts` plano).

Todas las fechas son **UTC puro** (`Date.UTC(...)` / métodos `getUTC*`/`setUTC*`) — los
campos `@db.Date` de Prisma llegan como `Date` a medianoche UTC; mezclar con métodos de
hora local (`getDate()`, `setDate()`) desplazaría el día según la zona horaria del
proceso. Nunca usar `getDate`/`setDate`/`getDay`/`getMonth` sin el prefijo `UTC` en este
archivo.

- [ ] **Step 1: Escribir los tests que fallan**

Create `App/backend/src/calendario/recurrencia.util.spec.ts`:

```ts
import { expandirOcurrencias, MAX_OCURRENCIAS } from './recurrencia.util';

function fecha(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

describe('expandirOcurrencias', () => {
  it('sin regla, fechaInicio dentro del rango -> [fechaInicio]', () => {
    const resultado = expandirOcurrencias(
      { fechaInicio: fecha('2026-10-15'), recurrenciaRegla: null, recurrenciaHasta: null },
      { desde: fecha('2026-10-01'), hasta: fecha('2026-10-31') },
    );
    expect(resultado).toEqual([fecha('2026-10-15')]);
  });

  it('sin regla, fechaInicio fuera del rango -> []', () => {
    const resultado = expandirOcurrencias(
      { fechaInicio: fecha('2026-11-05'), recurrenciaRegla: null, recurrenciaHasta: null },
      { desde: fecha('2026-10-01'), hasta: fecha('2026-10-31') },
    );
    expect(resultado).toEqual([]);
  });

  it('DIARIA cada 2 dias, dentro de un rango de 10 dias', () => {
    const resultado = expandirOcurrencias(
      {
        fechaInicio: fecha('2026-10-01'),
        recurrenciaRegla: { frecuencia: 'DIARIA', intervalo: 2 },
        recurrenciaHasta: fecha('2026-12-31'),
      },
      { desde: fecha('2026-10-01'), hasta: fecha('2026-10-10') },
    );
    expect(resultado).toEqual(
      ['2026-10-01', '2026-10-03', '2026-10-05', '2026-10-07', '2026-10-09'].map(fecha),
    );
  });

  it('SEMANAL cada 2 semanas, lunes y miercoles', () => {
    // 2026-10-05 es lunes.
    const resultado = expandirOcurrencias(
      {
        fechaInicio: fecha('2026-10-05'),
        recurrenciaRegla: { frecuencia: 'SEMANAL', intervalo: 2, diasSemana: [1, 3] },
        recurrenciaHasta: fecha('2026-12-31'),
      },
      { desde: fecha('2026-10-01'), hasta: fecha('2026-11-04') },
    );
    // Semana 1 (5-11 oct): lun 5, mie 7. Semana 3 (19-25 oct, +2 semanas): lun 19, mie 21.
    // Semana 5 (1-7 nov, +2 semanas): lun 2 nov, mie 4 nov — 4 nov ES el borde superior
    // del rango (hasta = 4 nov) y el rango es INCLUSIVO en ambos extremos, así que entra.
    expect(resultado).toEqual(
      ['2026-10-05', '2026-10-07', '2026-10-19', '2026-10-21', '2026-11-02', '2026-11-04'].map(
        fecha,
      ),
    );
  });

  it('MENSUAL dia -1 (ultimo dia del mes), 3 meses', () => {
    const resultado = expandirOcurrencias(
      {
        fechaInicio: fecha('2026-10-01'),
        recurrenciaRegla: { frecuencia: 'MENSUAL', intervalo: 1, diaMes: -1 },
        recurrenciaHasta: fecha('2026-12-31'),
      },
      { desde: fecha('2026-10-01'), hasta: fecha('2026-12-31') },
    );
    expect(resultado).toEqual(['2026-10-31', '2026-11-30', '2026-12-31'].map(fecha));
  });

  it('MENSUAL con diaMes fuera de rango del mes (31 en febrero) -> clamp al ultimo dia', () => {
    const resultado = expandirOcurrencias(
      {
        fechaInicio: fecha('2027-01-31'),
        recurrenciaRegla: { frecuencia: 'MENSUAL', intervalo: 1, diaMes: 31 },
        recurrenciaHasta: fecha('2027-03-31'),
      },
      { desde: fecha('2027-01-01'), hasta: fecha('2027-03-31') },
    );
    // Enero 31, Febrero clamp a 28 (2027 no es bisiesto), Marzo 31.
    expect(resultado).toEqual(['2027-01-31', '2027-02-28', '2027-03-31'].map(fecha));
  });

  it('respeta recurrenciaHasta aunque el rango consultado sea mas amplio', () => {
    const resultado = expandirOcurrencias(
      {
        fechaInicio: fecha('2026-10-01'),
        recurrenciaRegla: { frecuencia: 'DIARIA', intervalo: 1 },
        recurrenciaHasta: fecha('2026-10-03'),
      },
      { desde: fecha('2026-10-01'), hasta: fecha('2026-10-31') },
    );
    expect(resultado).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'].map(fecha));
  });

  it('trunca a MAX_OCURRENCIAS ocurrencias y no truena', () => {
    const resultado = expandirOcurrencias(
      {
        fechaInicio: fecha('2020-01-01'),
        recurrenciaRegla: { frecuencia: 'DIARIA', intervalo: 1 },
        recurrenciaHasta: fecha('2030-01-01'),
      },
      { desde: fecha('2020-01-01'), hasta: fecha('2030-01-01') },
    );
    expect(resultado.length).toBeLessThanOrEqual(MAX_OCURRENCIAS);
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd App/backend && npx jest src/calendario/recurrencia.util.spec.ts`
Expected: FAIL — `Cannot find module './recurrencia.util'`.

- [ ] **Step 3: Implementar `recurrencia.util.ts`**

Create `App/backend/src/calendario/recurrencia.util.ts`:

```ts
/**
 * Motor de recurrencia — Fase 15, Día 40. Función pura, sin DB ni DI: dado
 * un evento (con o sin regla) y un rango de fechas, devuelve las fechas de
 * inicio de cada ocurrencia dentro de ese rango. Regla 1 de `CLAUDE.md`
 * raíz — las ocurrencias NUNCA se persisten, se calculan al vuelo.
 *
 * Todas las fechas son UTC puro — ver nota en el archivo de tests. Sin
 * "primer viernes de mes" ni `BYSETPOS` de iCal — solo DIARIA/SEMANAL/
 * MENSUAL con intervalo, documentado como límite de alcance explícito.
 * Sin excepciones por ocurrencia (mover/cancelar una fecha suelta de una
 * serie) — fuera de alcance de v1.
 */
export interface ReglaRecurrencia {
  frecuencia: 'DIARIA' | 'SEMANAL' | 'MENSUAL';
  /** Cada N unidades de la frecuencia. Mínimo 1 (validado en el DTO). */
  intervalo: number;
  /** Solo SEMANAL. 0 = domingo .. 6 = sábado. Si falta, se usa el día de
   * la semana de `fechaInicio`. */
  diasSemana?: number[];
  /** Solo MENSUAL. 1..31, o -1 = último día del mes. Si falta, se usa el
   * día del mes de `fechaInicio`. */
  diaMes?: number;
}

interface EventoParaExpandir {
  fechaInicio: Date;
  recurrenciaRegla: ReglaRecurrencia | null;
  recurrenciaHasta: Date | null;
}

interface RangoFechas {
  desde: Date;
  hasta: Date;
}

/** Tope duro de ocurrencias por expansión — defensa contra rango +
 * intervalo abusivos (ej. intervalo=1 con un rango de 10 años). */
export const MAX_OCURRENCIAS = 366;

function addDiasUTC(fecha: Date, dias: number): Date {
  const resultado = new Date(fecha);
  resultado.setUTCDate(resultado.getUTCDate() + dias);
  return resultado;
}

function inicioDeSemanaUTC(fecha: Date): Date {
  return addDiasUTC(fecha, -fecha.getUTCDay());
}

function ultimoDiaDelMesUTC(anio: number, mesIndiceCero: number): number {
  // Día 0 del mes siguiente == último día del mes actual.
  return new Date(Date.UTC(anio, mesIndiceCero + 1, 0)).getUTCDate();
}

function fechaDelMesUTC(primerDiaDelMes: Date, diaMes: number): Date {
  const anio = primerDiaDelMes.getUTCFullYear();
  const mes = primerDiaDelMes.getUTCMonth();
  const ultimoDia = ultimoDiaDelMesUTC(anio, mes);
  const dia = diaMes === -1 ? ultimoDia : Math.min(diaMes, ultimoDia);
  return new Date(Date.UTC(anio, mes, dia));
}

function expandirDiaria(
  fechaInicio: Date,
  limite: Date,
  intervalo: number,
): Date[] {
  const candidatos: Date[] = [];
  let cursor = new Date(fechaInicio);
  while (cursor.getTime() <= limite.getTime() && candidatos.length < MAX_OCURRENCIAS) {
    candidatos.push(new Date(cursor));
    cursor = addDiasUTC(cursor, intervalo);
  }
  return candidatos;
}

function expandirSemanal(
  fechaInicio: Date,
  limite: Date,
  intervalo: number,
  diasSemana: number[],
): Date[] {
  const dias = diasSemana.length > 0 ? diasSemana : [fechaInicio.getUTCDay()];
  const candidatos: Date[] = [];
  let semanaCursor = inicioDeSemanaUTC(fechaInicio);

  while (semanaCursor.getTime() <= limite.getTime() && candidatos.length < MAX_OCURRENCIAS) {
    for (const dia of dias) {
      const fecha = addDiasUTC(semanaCursor, dia);
      if (fecha.getTime() >= fechaInicio.getTime() && fecha.getTime() <= limite.getTime()) {
        candidatos.push(fecha);
      }
      if (candidatos.length >= MAX_OCURRENCIAS) break;
    }
    semanaCursor = addDiasUTC(semanaCursor, 7 * intervalo);
  }

  candidatos.sort((a, b) => a.getTime() - b.getTime());
  return candidatos;
}

function expandirMensual(
  fechaInicio: Date,
  limite: Date,
  intervalo: number,
  diaMes: number,
): Date[] {
  const candidatos: Date[] = [];
  let mesCursor = new Date(Date.UTC(fechaInicio.getUTCFullYear(), fechaInicio.getUTCMonth(), 1));

  while (candidatos.length < MAX_OCURRENCIAS) {
    const fecha = fechaDelMesUTC(mesCursor, diaMes);
    if (fecha.getTime() > limite.getTime()) break;
    if (fecha.getTime() >= fechaInicio.getTime()) {
      candidatos.push(fecha);
    }
    mesCursor = new Date(
      Date.UTC(mesCursor.getUTCFullYear(), mesCursor.getUTCMonth() + intervalo, 1),
    );
  }

  return candidatos;
}

export function expandirOcurrencias(
  evento: EventoParaExpandir,
  rango: RangoFechas,
): Date[] {
  if (!evento.recurrenciaRegla) {
    const f = evento.fechaInicio;
    if (f.getTime() >= rango.desde.getTime() && f.getTime() <= rango.hasta.getTime()) {
      return [f];
    }
    return [];
  }

  const regla = evento.recurrenciaRegla;
  // `recurrenciaHasta` es requerido por el DTO (Task 3) cuando hay regla —
  // este fallback a `rango.hasta` es solo defensivo para esta función pura.
  const limiteSerie = evento.recurrenciaHasta ?? rango.hasta;
  const limiteEfectivo =
    limiteSerie.getTime() < rango.hasta.getTime() ? limiteSerie : rango.hasta;

  let candidatos: Date[];
  if (regla.frecuencia === 'DIARIA') {
    candidatos = expandirDiaria(evento.fechaInicio, limiteEfectivo, regla.intervalo);
  } else if (regla.frecuencia === 'SEMANAL') {
    candidatos = expandirSemanal(
      evento.fechaInicio,
      limiteEfectivo,
      regla.intervalo,
      regla.diasSemana ?? [],
    );
  } else {
    candidatos = expandirMensual(
      evento.fechaInicio,
      limiteEfectivo,
      regla.intervalo,
      regla.diaMes ?? evento.fechaInicio.getUTCDate(),
    );
  }

  if (candidatos.length >= MAX_OCURRENCIAS) {
    console.warn(
      `[recurrencia] expansión truncada a ${MAX_OCURRENCIAS} ocurrencias (evento con fechaInicio ${evento.fechaInicio.toISOString()})`,
    );
  }

  return candidatos.filter(
    (f) => f.getTime() >= rango.desde.getTime() && f.getTime() <= rango.hasta.getTime(),
  );
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd App/backend && npx jest src/calendario/recurrencia.util.spec.ts`
Expected: PASS, 8/8. Si el test SEMANAL no cuadra con tu cálculo mental de fechas,
verifica con `date -d` o un REPL de Node cuál es el día de la semana ISO real de
`2026-10-05` antes de asumir que el test está mal — no ajustes el test para que pase sin
verificar la fecha real primero.

- [ ] **Step 5: Verificar lint**

Run: `cd App/backend && npx eslint "src/calendario/recurrencia.util.ts" "src/calendario/recurrencia.util.spec.ts"`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/backend/src/calendario/recurrencia.util.ts App/backend/src/calendario/recurrencia.util.spec.ts
git commit -m "feat(backend): motor de recurrencia de calendario (Fase 15, Dia 40)

Funcion pura expandirOcurrencias (sin DB) - DIARIA/SEMANAL/MENSUAL con
intervalo, tope duro de 366 ocurrencias (regla 1: nunca se persisten).
Fechas en UTC puro para evitar corrimiento de dia por zona horaria del
proceso. Sin excepciones por ocurrencia ni BYSETPOS - limite de alcance
explicito de v1.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AGjjFjoqQ1gmLwoZsox6Lw"
```

---

## Task 3: Helpers compartidos + CRUD de eventos (`CalendarioModule`)

**Files:**
- Create: `App/backend/src/common/publicacion/alcance-publicacion.util.ts`
- Create: `App/backend/src/calendario/dto/regla-recurrencia.dto.ts`
- Create: `App/backend/src/calendario/dto/crear-evento.dto.ts`
- Create: `App/backend/src/calendario/dto/actualizar-evento.dto.ts`
- Create: `App/backend/src/calendario/dto/listar-eventos.query.dto.ts`
- Create: `App/backend/src/calendario/calendario.service.ts`
- Create: `App/backend/src/calendario/calendario.controller.ts`
- Create: `App/backend/src/calendario/calendario.module.ts`
- Modify: `App/backend/src/app.module.ts`

**Interfaces:**
- Consumes: `expandirOcurrencias`/`ReglaRecurrencia` (Task 2), `PrismaService`,
  `SedeGuard`, `RolesGuard`, `@Roles`, `@ActorUsuarioId`, `@SedeActual`.
- Produces:
  - `validarAlcancePublicacion(prisma: PrismaService, actor: { usuarioId: string; rol:
    RolUsuario; sedeId: string }, alcanceTipo: AlcanceDestino, alcanceId: string | null):
    Promise<void>` — lanza `BadRequestException`/`ForbiddenException`/`NotFoundException`
    según corresponda; no retorna nada si es válido.
  - `resolverDestinatarios(prisma: PrismaService, sedeId: string, alcanceTipo:
    AlcanceDestino, alcanceId: string | null): Promise<string[]>` — `Usuario.id[]`, sin
    duplicados.
  - Rutas: `POST /eventos`, `GET /eventos?desde=&hasta=`, `PATCH /eventos/:id`, `DELETE
    /eventos/:id`.
  - `OcurrenciaEvento = { eventoId: string; titulo: string; descripcion: string | null;
    fecha: string; horaInicio: string | null; fechaFin: string | null; categoria:
    CategoriaEvento; alcanceTipo: AlcanceDestino; alcanceId: string | null; esRecurrente:
    boolean }` (fechas como ISO `YYYY-MM-DD`).

- [ ] **Step 1: Escribir `alcance-publicacion.util.ts`**

Create `App/backend/src/common/publicacion/alcance-publicacion.util.ts`:

```ts
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AlcanceDestino, RolUsuario } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Helpers compartidos de "quién puede publicar a quién" — Fase 15, Día 41.
 * Los usa Calendario (`EventoCalendario`) y los reutiliza Avisos (`Aviso`,
 * Fase 16) tal cual, sin duplicar la lógica de permisos ni de resolución
 * de destinatarios.
 */

const ERROR_ROL_NO_AUTORIZADO = {
  error: 'Tu rol no tiene acceso a este recurso',
  code: 'ROL_NO_AUTORIZADO',
} as const;

interface ActorPublicacion {
  usuarioId: string;
  rol: RolUsuario;
  sedeId: string;
}

/**
 * Valida que `actor` puede publicar (crear/editar un evento o aviso) con
 * el alcance `(alcanceTipo, alcanceId)`. Lanza si no puede; no retorna
 * nada si sí puede.
 *
 * - `alcanceTipo === SEDE` exige `alcanceId` ausente; `CARRERA`/`GRUPO`
 *   exigen `alcanceId` presente -> 400 `VALIDATION_ERROR` si no.
 * - `ALUMNO` siempre 403 -> defensivo (las rutas ya lo bloquean con
 *   `@Roles(ADMINISTRATIVO, MAESTRO)` a nivel de guard; este chequeo es
 *   la segunda capa, mismo criterio de "belt and suspenders" que el resto
 *   de la app).
 * - `MAESTRO` solo puede `GRUPO`, y solo si tiene una fila en
 *   `GrupoMateriaMaestro` para ese grupo -> 403 en cualquier otro caso
 *   (la API nunca distingue "no autorizado" de "no existe" para el
 *   cross-scope de un maestro, mismo criterio que el resto de esta app).
 * - `ADMINISTRATIVO`: `SEDE` no requiere más validación; `CARRERA`/`GRUPO`
 *   deben existir y pertenecer a la sede del actor -> 404 `NOT_FOUND` si
 *   no. Sin jerarquía de `nivelPermiso` (mismo criterio que
 *   Carreras/Grupos/Salones).
 */
export async function validarAlcancePublicacion(
  prisma: PrismaService,
  actor: ActorPublicacion,
  alcanceTipo: AlcanceDestino,
  alcanceId: string | null,
): Promise<void> {
  if (alcanceTipo === AlcanceDestino.SEDE && alcanceId) {
    throw new BadRequestException({
      error: 'alcanceId no debe enviarse cuando alcanceTipo es SEDE',
      code: 'VALIDATION_ERROR',
    });
  }
  if (alcanceTipo !== AlcanceDestino.SEDE && !alcanceId) {
    throw new BadRequestException({
      error: 'alcanceId es requerido para este alcanceTipo',
      code: 'VALIDATION_ERROR',
    });
  }

  if (actor.rol === RolUsuario.ALUMNO) {
    throw new ForbiddenException(ERROR_ROL_NO_AUTORIZADO);
  }

  if (actor.rol === RolUsuario.MAESTRO) {
    if (alcanceTipo !== AlcanceDestino.GRUPO) {
      throw new ForbiddenException(ERROR_ROL_NO_AUTORIZADO);
    }
    const asignacion = await prisma.grupoMateriaMaestro.findFirst({
      where: { grupoId: alcanceId!, maestro: { usuarioId: actor.usuarioId } },
      select: { id: true },
    });
    if (!asignacion) {
      throw new ForbiddenException(ERROR_ROL_NO_AUTORIZADO);
    }
    return;
  }

  // ADMINISTRATIVO.
  if (alcanceTipo === AlcanceDestino.CARRERA) {
    const carrera = await prisma.carrera.findFirst({
      where: { id: alcanceId!, sedeId: actor.sedeId },
      select: { id: true },
    });
    if (!carrera) {
      throw new NotFoundException({
        error: 'Carrera no encontrada en tu sede',
        code: 'NOT_FOUND',
      });
    }
  } else if (alcanceTipo === AlcanceDestino.GRUPO) {
    const grupo = await prisma.grupo.findFirst({
      where: { id: alcanceId!, sedeId: actor.sedeId },
      select: { id: true },
    });
    if (!grupo) {
      throw new NotFoundException({
        error: 'Grupo no encontrado en tu sede',
        code: 'NOT_FOUND',
      });
    }
  }
}

/**
 * Resuelve los `Usuario.id` a los que les toca un alcance dado — lo usan
 * el job de recordatorios (Fase 15, Día 42) y el fan-out de avisos (Fase
 * 16). Solo `Usuario.activo: true` en los 3 casos. Sin duplicados (un
 * usuario nunca aparece 2 veces aunque calce por más de una vía).
 */
export async function resolverDestinatarios(
  prisma: PrismaService,
  sedeId: string,
  alcanceTipo: AlcanceDestino,
  alcanceId: string | null,
): Promise<string[]> {
  if (alcanceTipo === AlcanceDestino.SEDE) {
    const usuarios = await prisma.usuario.findMany({
      where: { sedeId, activo: true },
      select: { id: true },
    });
    return usuarios.map((u) => u.id);
  }

  const ids = new Set<string>();

  if (alcanceTipo === AlcanceDestino.CARRERA) {
    const [alumnos, maestros] = await Promise.all([
      prisma.perfilAlumno.findMany({
        where: { carreraId: alcanceId!, usuario: { activo: true } },
        select: { usuarioId: true },
      }),
      prisma.perfilMaestro.findMany({
        where: {
          usuario: { activo: true },
          asignaciones: { some: { grupo: { carreraId: alcanceId! } } },
        },
        select: { usuarioId: true },
      }),
    ]);
    alumnos.forEach((a) => ids.add(a.usuarioId));
    maestros.forEach((m) => ids.add(m.usuarioId));
    return [...ids];
  }

  // GRUPO.
  const [alumnos, maestros] = await Promise.all([
    prisma.grupoAlumno.findMany({
      where: { grupoId: alcanceId!, alumno: { usuario: { activo: true } } },
      select: { alumno: { select: { usuarioId: true } } },
    }),
    prisma.grupoMateriaMaestro.findMany({
      where: { grupoId: alcanceId!, maestro: { usuario: { activo: true } } },
      select: { maestro: { select: { usuarioId: true } } },
    }),
  ]);
  alumnos.forEach((a) => ids.add(a.alumno.usuarioId));
  maestros.forEach((m) => ids.add(m.maestro.usuarioId));
  return [...ids];
}
```

- [ ] **Step 2: Escribir los DTOs**

Create `App/backend/src/calendario/dto/regla-recurrencia.dto.ts`:

```ts
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

/**
 * Nested DTO de `recurrenciaRegla` — Fase 15, Día 41. Mismo shape que
 * `ReglaRecurrencia` de `recurrencia.util.ts` (Task 2) — mantener en sync
 * a mano si uno cambia.
 */
export class ReglaRecurrenciaDto {
  @IsIn(['DIARIA', 'SEMANAL', 'MENSUAL'], {
    message: 'frecuencia debe ser DIARIA, SEMANAL o MENSUAL',
  })
  frecuencia!: 'DIARIA' | 'SEMANAL' | 'MENSUAL';

  @IsInt({ message: 'intervalo debe ser un entero' })
  @Min(1, { message: 'intervalo debe ser al menos 1' })
  intervalo!: number;

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true, message: 'diasSemana debe ser un arreglo de enteros' })
  @Min(0, { each: true, message: 'diasSemana: cada valor debe ser 0-6' })
  @Max(6, { each: true, message: 'diasSemana: cada valor debe ser 0-6' })
  diasSemana?: number[];

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'diaMes debe ser un entero' })
  @Min(-1, { message: 'diaMes debe ser -1 (último día) o 1-31' })
  @Max(31, { message: 'diaMes debe ser -1 (último día) o 1-31' })
  diaMes?: number;
}
```

Create `App/backend/src/calendario/dto/crear-evento.dto.ts`:

```ts
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';
import { AlcanceDestino, CategoriaEvento } from '@prisma/client';
import { ReglaRecurrenciaDto } from './regla-recurrencia.dto';

/**
 * `POST /eventos` — Fase 15, Día 41. `sedeId`/`autorUsuarioId` NUNCA van
 * acá (regla 2 — salen de `@SedeActual()`/`@ActorUsuarioId()`).
 * Validaciones cross-campo (alcance válido, `recurrenciaRegla` ⇒
 * `recurrenciaHasta` requerido) viven en `CalendarioService.crear`, no
 * acá — mismo criterio que `PersonasService`/`GruposService`.
 */
export class CrearEventoDto {
  @IsString()
  @IsNotEmpty({ message: 'titulo es requerido' })
  titulo!: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsDateString({}, { message: 'fechaInicio debe ser una fecha ISO (YYYY-MM-DD)' })
  fechaInicio!: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'horaInicio debe tener formato HH:MM (24h)',
  })
  horaInicio?: string;

  @IsOptional()
  @IsDateString({}, { message: 'fechaFin debe ser una fecha ISO (YYYY-MM-DD)' })
  fechaFin?: string;

  @IsEnum(CategoriaEvento, { message: 'categoria inválida' })
  categoria!: CategoriaEvento;

  @IsEnum(AlcanceDestino, { message: 'alcanceTipo inválido' })
  alcanceTipo!: AlcanceDestino;

  @IsOptional()
  @IsUUID('4', { message: 'alcanceId debe ser un UUID válido' })
  alcanceId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReglaRecurrenciaDto)
  recurrenciaRegla?: ReglaRecurrenciaDto;

  @IsOptional()
  @IsDateString({}, { message: 'recurrenciaHasta debe ser una fecha ISO (YYYY-MM-DD)' })
  recurrenciaHasta?: string;
}
```

Create `App/backend/src/calendario/dto/actualizar-evento.dto.ts` (todos opcionales,
mismo patrón que `ActualizarCarreraDto`):

```ts
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';
import { AlcanceDestino, CategoriaEvento } from '@prisma/client';
import { ReglaRecurrenciaDto } from './regla-recurrencia.dto';

export class ActualizarEventoDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'titulo no puede quedar vacío' })
  titulo?: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsDateString({}, { message: 'fechaInicio debe ser una fecha ISO (YYYY-MM-DD)' })
  fechaInicio?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'horaInicio debe tener formato HH:MM (24h)',
  })
  horaInicio?: string;

  @IsOptional()
  @IsDateString({}, { message: 'fechaFin debe ser una fecha ISO (YYYY-MM-DD)' })
  fechaFin?: string;

  @IsOptional()
  @IsEnum(CategoriaEvento, { message: 'categoria inválida' })
  categoria?: CategoriaEvento;

  @IsOptional()
  @IsEnum(AlcanceDestino, { message: 'alcanceTipo inválido' })
  alcanceTipo?: AlcanceDestino;

  @IsOptional()
  @IsUUID('4', { message: 'alcanceId debe ser un UUID válido' })
  alcanceId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReglaRecurrenciaDto)
  recurrenciaRegla?: ReglaRecurrenciaDto;

  @IsOptional()
  @IsDateString({}, { message: 'recurrenciaHasta debe ser una fecha ISO (YYYY-MM-DD)' })
  recurrenciaHasta?: string;
}
```

Create `App/backend/src/calendario/dto/listar-eventos.query.dto.ts`:

```ts
import { IsDateString } from 'class-validator';

/**
 * `GET /eventos?desde=&hasta=` — ambos requeridos. El rango máximo (62
 * días) se valida en el service (depende de comparar las 2 fechas, no de
 * una sola), no acá.
 */
export class ListarEventosQueryDto {
  @IsDateString({}, { message: 'desde debe ser una fecha ISO (YYYY-MM-DD)' })
  desde!: string;

  @IsDateString({}, { message: 'hasta debe ser una fecha ISO (YYYY-MM-DD)' })
  hasta!: string;
}
```

- [ ] **Step 3: Escribir `calendario.service.ts`**

Create `App/backend/src/calendario/calendario.service.ts`:

```ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  AccionAuditoria,
  AlcanceDestino,
  RolUsuario,
  type EventoCalendario,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  validarAlcancePublicacion,
} from '../common/publicacion/alcance-publicacion.util';
import { expandirOcurrencias, type ReglaRecurrencia } from './recurrencia.util';
import type { ActualizarEventoDto } from './dto/actualizar-evento.dto';
import type { CrearEventoDto } from './dto/crear-evento.dto';

export interface OcurrenciaEvento {
  eventoId: string;
  titulo: string;
  descripcion: string | null;
  fecha: string;
  horaInicio: string | null;
  fechaFin: string | null;
  categoria: EventoCalendario['categoria'];
  alcanceTipo: AlcanceDestino;
  alcanceId: string | null;
  esRecurrente: boolean;
}

interface Actor {
  usuarioId: string;
  rol: RolUsuario;
  sedeId: string;
}

const MAX_DIAS_RANGO = 62;

function aFechaUTC(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function aISO(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/**
 * `hayCambiosReales` — patrón de `CarrerasService`/`SedesService`: un
 * `PATCH` sin cambios reales no cuenta como edición auditable. Solo
 * compara los campos escalares directos; `recurrenciaRegla` se compara
 * por JSON.stringify (suficiente para este caso — el DTO ya normaliza el
 * shape via class-validator).
 */
function hayCambiosReales(
  dto: ActualizarEventoDto,
  existente: EventoCalendario,
): boolean {
  if (dto.titulo !== undefined && dto.titulo !== existente.titulo) return true;
  if (dto.descripcion !== undefined && dto.descripcion !== existente.descripcion)
    return true;
  if (
    dto.fechaInicio !== undefined &&
    aFechaUTC(dto.fechaInicio).getTime() !== existente.fechaInicio.getTime()
  )
    return true;
  if (dto.horaInicio !== undefined && dto.horaInicio !== existente.horaInicio)
    return true;
  if (
    dto.fechaFin !== undefined &&
    (existente.fechaFin === null ||
      aFechaUTC(dto.fechaFin).getTime() !== existente.fechaFin.getTime())
  )
    return true;
  if (dto.categoria !== undefined && dto.categoria !== existente.categoria)
    return true;
  if (dto.alcanceTipo !== undefined && dto.alcanceTipo !== existente.alcanceTipo)
    return true;
  if (dto.alcanceId !== undefined && dto.alcanceId !== existente.alcanceId)
    return true;
  if (
    dto.recurrenciaRegla !== undefined &&
    JSON.stringify(dto.recurrenciaRegla) !== JSON.stringify(existente.recurrenciaRegla)
  )
    return true;
  if (
    dto.recurrenciaHasta !== undefined &&
    (existente.recurrenciaHasta === null ||
      aFechaUTC(dto.recurrenciaHasta).getTime() !== existente.recurrenciaHasta.getTime())
  )
    return true;
  return false;
}

@Injectable()
export class CalendarioService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `POST /eventos` — Fase 15, Día 41. Orden: (1) `validarAlcancePublicacion`
   * (permiso + existencia/sede del alcance), (2) `recurrenciaRegla`
   * presente ⇒ `recurrenciaHasta` requerido, (3) crear + auditar `ALTA` en
   * la misma transacción.
   */
  async crear(
    dto: CrearEventoDto,
    actor: Actor,
  ): Promise<EventoCalendario> {
    await validarAlcancePublicacion(
      this.prisma,
      actor,
      dto.alcanceTipo,
      dto.alcanceId ?? null,
    );

    if (dto.recurrenciaRegla && !dto.recurrenciaHasta) {
      throw new BadRequestException({
        error: 'recurrenciaHasta es requerido cuando recurrenciaRegla está presente',
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const evento = await tx.eventoCalendario.create({
          data: {
            sedeId: actor.sedeId,
            autorUsuarioId: actor.usuarioId,
            titulo: dto.titulo,
            descripcion: dto.descripcion,
            fechaInicio: aFechaUTC(dto.fechaInicio),
            horaInicio: dto.horaInicio,
            fechaFin: dto.fechaFin ? aFechaUTC(dto.fechaFin) : null,
            categoria: dto.categoria,
            alcanceTipo: dto.alcanceTipo,
            alcanceId: dto.alcanceId ?? null,
            recurrenciaRegla: dto.recurrenciaRegla
              ? (dto.recurrenciaRegla as unknown as object)
              : undefined,
            recurrenciaHasta: dto.recurrenciaHasta
              ? aFechaUTC(dto.recurrenciaHasta)
              : null,
          },
        });

        await tx.registroAuditoria.create({
          data: {
            usuarioId: actor.usuarioId,
            sedeId: actor.sedeId,
            accion: AccionAuditoria.ALTA,
            entidad: 'EventoCalendario',
            entidadId: evento.id,
            detalle: { titulo: evento.titulo, alcanceTipo: evento.alcanceTipo },
          },
        });

        return evento;
      });
    } catch (err) {
      console.error('[CalendarioService.crear] error inesperado:', err);
      throw err;
    }
  }

  /**
   * `GET /eventos?desde=&hasta=` — Fase 15, Día 41. Filtra por lo que le
   * toca ver al actor (SEDE siempre visible; CARRERA/GRUPO según su
   * propio alcance) y expande ocurrencias con `expandirOcurrencias`
   * (Task 2). `ADMINISTRATIVO` ve TODOS los eventos de su sede sin
   * filtrar por alcance (mismo criterio que el resto de la app: el rol de
   * gestión ve todo).
   */
  async listar(
    desdeISO: string,
    hastaISO: string,
    actor: Actor,
  ): Promise<OcurrenciaEvento[]> {
    const desde = aFechaUTC(desdeISO);
    const hasta = aFechaUTC(hastaISO);

    if (hasta.getTime() < desde.getTime()) {
      throw new BadRequestException({
        error: 'hasta debe ser posterior o igual a desde',
        code: 'VALIDATION_ERROR',
      });
    }
    const diasDeRango = (hasta.getTime() - desde.getTime()) / 86_400_000;
    if (diasDeRango > MAX_DIAS_RANGO) {
      throw new BadRequestException({
        error: `El rango desde/hasta no puede superar ${MAX_DIAS_RANGO} días`,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      const eventos = await this.prisma.eventoCalendario.findMany({
        where: await this.condicionVisibilidad(actor),
      });

      const ocurrencias: OcurrenciaEvento[] = [];
      for (const evento of eventos) {
        const fechas = expandirOcurrencias(
          {
            fechaInicio: evento.fechaInicio,
            recurrenciaRegla: evento.recurrenciaRegla as ReglaRecurrencia | null,
            recurrenciaHasta: evento.recurrenciaHasta,
          },
          { desde, hasta },
        );
        for (const fecha of fechas) {
          ocurrencias.push({
            eventoId: evento.id,
            titulo: evento.titulo,
            descripcion: evento.descripcion,
            fecha: aISO(fecha),
            horaInicio: evento.horaInicio,
            fechaFin: evento.fechaFin ? aISO(evento.fechaFin) : null,
            categoria: evento.categoria,
            alcanceTipo: evento.alcanceTipo,
            alcanceId: evento.alcanceId,
            esRecurrente: evento.recurrenciaRegla !== null,
          });
        }
      }

      ocurrencias.sort((a, b) => {
        if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
        if (a.horaInicio === b.horaInicio) return 0;
        if (a.horaInicio === null) return -1;
        if (b.horaInicio === null) return 1;
        return a.horaInicio < b.horaInicio ? -1 : 1;
      });

      return ocurrencias;
    } catch (err) {
      console.error('[CalendarioService.listar] error inesperado:', err);
      throw err;
    }
  }

  /**
   * Construye el `where` de Prisma según el rol del actor. `ADMINISTRATIVO`
   * ve todo de su sede; `MAESTRO`/`ALUMNO` ven SEDE siempre + su propio
   * alcance de CARRERA/GRUPO.
   */
  private async condicionVisibilidad(actor: Actor) {
    if (actor.rol === RolUsuario.ADMINISTRATIVO) {
      return { sedeId: actor.sedeId };
    }

    if (actor.rol === RolUsuario.MAESTRO) {
      const asignaciones = await this.prisma.grupoMateriaMaestro.findMany({
        where: { maestro: { usuarioId: actor.usuarioId } },
        select: { grupoId: true, grupo: { select: { carreraId: true } } },
      });
      const gruposVisibles = asignaciones.map((a) => a.grupoId);
      const carrerasVisibles = [...new Set(asignaciones.map((a) => a.grupo.carreraId))];
      return {
        sedeId: actor.sedeId,
        OR: [
          { alcanceTipo: AlcanceDestino.SEDE },
          { alcanceTipo: AlcanceDestino.CARRERA, alcanceId: { in: carrerasVisibles } },
          { alcanceTipo: AlcanceDestino.GRUPO, alcanceId: { in: gruposVisibles } },
        ],
      };
    }

    // ALUMNO.
    const perfil = await this.prisma.perfilAlumno.findUnique({
      where: { usuarioId: actor.usuarioId },
      select: { carreraId: true },
    });
    if (!perfil) {
      throw new NotFoundException({
        error: 'Perfil de alumno no encontrado',
        code: 'NOT_FOUND',
      });
    }
    const matriculas = await this.prisma.grupoAlumno.findMany({
      where: { alumno: { usuarioId: actor.usuarioId } },
      select: { grupoId: true },
    });
    const gruposVisibles = matriculas.map((m) => m.grupoId);
    return {
      sedeId: actor.sedeId,
      OR: [
        { alcanceTipo: AlcanceDestino.SEDE },
        { alcanceTipo: AlcanceDestino.CARRERA, alcanceId: perfil.carreraId },
        { alcanceTipo: AlcanceDestino.GRUPO, alcanceId: { in: gruposVisibles } },
      ],
    };
  }

  private async obtenerPropioODeSede(
    id: string,
    actor: Actor,
  ): Promise<EventoCalendario> {
    const evento = await this.prisma.eventoCalendario.findFirst({
      where: { id, sedeId: actor.sedeId },
    });
    if (!evento) {
      throw new NotFoundException({
        error: 'Evento no encontrado en tu sede',
        code: 'NOT_FOUND',
      });
    }
    if (evento.autorUsuarioId !== actor.usuarioId && actor.rol !== RolUsuario.ADMINISTRATIVO) {
      throw new ForbiddenException({
        error: 'Solo el autor o un administrativo pueden modificar este evento',
        code: 'ROL_NO_AUTORIZADO',
      });
    }
    return evento;
  }

  /**
   * `PATCH /eventos/:id` — Fase 15, Día 41. Solo el autor o un
   * `ADMINISTRATIVO` de la sede. Re-valida alcance si `alcanceTipo`/
   * `alcanceId` cambian (con los valores MERGEADOS, no solo el que venga
   * en el body). Audita `EDICION` solo si `hayCambiosReales`.
   */
  async actualizar(
    id: string,
    dto: ActualizarEventoDto,
    actor: Actor,
  ): Promise<EventoCalendario> {
    const existente = await this.obtenerPropioODeSede(id, actor);

    if (dto.alcanceTipo !== undefined || dto.alcanceId !== undefined) {
      const alcanceTipoFinal = dto.alcanceTipo ?? existente.alcanceTipo;
      const alcanceIdFinal =
        dto.alcanceId !== undefined ? dto.alcanceId : existente.alcanceId;
      await validarAlcancePublicacion(this.prisma, actor, alcanceTipoFinal, alcanceIdFinal);
    }

    const reglaFinal =
      dto.recurrenciaRegla !== undefined ? dto.recurrenciaRegla : existente.recurrenciaRegla;
    const hastaFinal =
      dto.recurrenciaHasta !== undefined ? dto.recurrenciaHasta : existente.recurrenciaHasta;
    if (reglaFinal && !hastaFinal) {
      throw new BadRequestException({
        error: 'recurrenciaHasta es requerido cuando recurrenciaRegla está presente',
        code: 'VALIDATION_ERROR',
      });
    }

    if (!hayCambiosReales(dto, existente)) {
      return existente;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const actualizado = await tx.eventoCalendario.update({
          where: { id },
          data: {
            ...(dto.titulo !== undefined ? { titulo: dto.titulo } : {}),
            ...(dto.descripcion !== undefined ? { descripcion: dto.descripcion } : {}),
            ...(dto.fechaInicio !== undefined
              ? { fechaInicio: aFechaUTC(dto.fechaInicio) }
              : {}),
            ...(dto.horaInicio !== undefined ? { horaInicio: dto.horaInicio } : {}),
            ...(dto.fechaFin !== undefined
              ? { fechaFin: dto.fechaFin ? aFechaUTC(dto.fechaFin) : null }
              : {}),
            ...(dto.categoria !== undefined ? { categoria: dto.categoria } : {}),
            ...(dto.alcanceTipo !== undefined ? { alcanceTipo: dto.alcanceTipo } : {}),
            ...(dto.alcanceId !== undefined ? { alcanceId: dto.alcanceId } : {}),
            ...(dto.recurrenciaRegla !== undefined
              ? { recurrenciaRegla: dto.recurrenciaRegla as unknown as object }
              : {}),
            ...(dto.recurrenciaHasta !== undefined
              ? {
                  recurrenciaHasta: dto.recurrenciaHasta
                    ? aFechaUTC(dto.recurrenciaHasta)
                    : null,
                }
              : {}),
          },
        });

        await tx.registroAuditoria.create({
          data: {
            usuarioId: actor.usuarioId,
            sedeId: actor.sedeId,
            accion: AccionAuditoria.EDICION,
            entidad: 'EventoCalendario',
            entidadId: id,
            detalle: { camposModificados: Object.keys(dto) },
          },
        });

        return actualizado;
      });
    } catch (err) {
      console.error('[CalendarioService.actualizar] error inesperado:', err);
      throw err;
    }
  }

  /**
   * `DELETE /eventos/:id` — Fase 15, Día 41. Solo autor o
   * `ADMINISTRATIVO`. DELETE real (`EventoCalendario` es CRUD completo).
   * `RecordatorioEnviado` se borra en cascada por el FK (Task 1), no hace
   * falta borrarlo a mano acá.
   */
  async eliminar(id: string, actor: Actor): Promise<{ ok: true }> {
    const evento = await this.obtenerPropioODeSede(id, actor);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.registroAuditoria.create({
          data: {
            usuarioId: actor.usuarioId,
            sedeId: actor.sedeId,
            accion: AccionAuditoria.ELIMINACION,
            entidad: 'EventoCalendario',
            entidadId: evento.id,
            detalle: { titulo: evento.titulo },
          },
        });
        await tx.eventoCalendario.delete({ where: { id } });
      });
      return { ok: true };
    } catch (err) {
      console.error('[CalendarioService.eliminar] error inesperado:', err);
      throw err;
    }
  }
}
```

- [ ] **Step 4: Escribir `calendario.controller.ts`**

Create `App/backend/src/calendario/calendario.controller.ts`:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RolUsuario } from '@prisma/client';
import { ActorUsuarioId } from '../common/decorators/actor-usuario-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SedeActual } from '../common/decorators/sede-actual.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { SedeGuard } from '../common/guards/sede.guard';
import type { Request } from 'express';
import { Req } from '@nestjs/common';
import { CalendarioService } from './calendario.service';
import { ActualizarEventoDto } from './dto/actualizar-evento.dto';
import { CrearEventoDto } from './dto/crear-evento.dto';
import { ListarEventosQueryDto } from './dto/listar-eventos.query.dto';

/**
 * `POST/PATCH/DELETE /eventos` (Fase 15, Día 41) — solo
 * `ADMINISTRATIVO`/`MAESTRO` (`ALUMNO` siempre 403, `@Roles` a nivel de
 * método). `GET /eventos` — los 3 roles, sin `@Roles` (mismo criterio que
 * `GET /perfil`: `RolesGuard` deja pasar sin restringir si la ruta no
 * declara `@Roles`). El `rol` del actor sale de `request.jwtClaims.rol`
 * (mismo claim que usa `RolesGuard`) — no hay un decorator `@ActorRol()`
 * en el repo todavía, así que se lee directo del `Request` acá.
 */
@Controller('eventos')
@UseGuards(SedeGuard, RolesGuard)
export class CalendarioController {
  constructor(private readonly calendarioService: CalendarioService) {}

  @Post()
  @HttpCode(201)
  @Roles(RolUsuario.ADMINISTRATIVO, RolUsuario.MAESTRO)
  async crear(
    @Body() body: CrearEventoDto,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
    @Req() req: Request,
  ) {
    const rol = req.jwtClaims?.['rol'] as RolUsuario;
    const data = await this.calendarioService.crear(body, {
      usuarioId: actorUsuarioId,
      rol,
      sedeId,
    });
    return { data };
  }

  @Get()
  async listar(
    @Query() query: ListarEventosQueryDto,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
    @Req() req: Request,
  ) {
    const rol = req.jwtClaims?.['rol'] as RolUsuario;
    const data = await this.calendarioService.listar(query.desde, query.hasta, {
      usuarioId: actorUsuarioId,
      rol,
      sedeId,
    });
    return { data };
  }

  @Patch(':id')
  @Roles(RolUsuario.ADMINISTRATIVO, RolUsuario.MAESTRO)
  async actualizar(
    @Param('id') id: string,
    @Body() body: ActualizarEventoDto,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
    @Req() req: Request,
  ) {
    const rol = req.jwtClaims?.['rol'] as RolUsuario;
    const data = await this.calendarioService.actualizar(id, body, {
      usuarioId: actorUsuarioId,
      rol,
      sedeId,
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
    const data = await this.calendarioService.eliminar(id, {
      usuarioId: actorUsuarioId,
      rol,
      sedeId,
    });
    return { data };
  }
}
```

> Antes de dar este controller por bueno: verificar en `src/common/types/express.d.ts`
> que `Request.jwtClaims` ya está tipado como `Record<string, unknown> | undefined` (o
> similar) — si el tipo real difiere, ajustar el cast `as RolUsuario` acorde. Si el repo
> ya tiene un decorator `@ActorRol()` que no apareció en la exploración de este plan,
> úsalo en vez de leer `req.jwtClaims` a mano (más consistente con el resto del código) y
> documenta el cambio en tu reporte.

- [ ] **Step 5: Escribir el módulo y registrarlo**

Create `App/backend/src/calendario/calendario.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CalendarioController } from './calendario.controller';
import { CalendarioService } from './calendario.service';

@Module({
  controllers: [CalendarioController],
  providers: [CalendarioService],
  exports: [CalendarioService],
})
export class CalendarioModule {}
```

> `exports: [CalendarioService]` — lo necesitará `InternalRecordatoriosController`
> (Task 5), que vive en el mismo módulo o en uno que importe `CalendarioModule`.

Modify `App/backend/src/app.module.ts`:

```ts
import { CalendarioModule } from './calendario/calendario.module';
```
```ts
    NotificacionesModule,
    CalendarioModule,
```

- [ ] **Step 6: Verificar build y lint**

Run: `cd App/backend && npx tsc --noEmit && npx eslint "src/calendario/**/*.ts" "src/common/publicacion/**/*.ts"`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/backend/src/calendario/ App/backend/src/common/publicacion/ App/backend/src/app.module.ts
git commit -m "feat(backend): CRUD de eventos de calendario + helpers de alcance (Fase 15, Dia 41)

POST/GET/PATCH/DELETE /eventos. validarAlcancePublicacion +
resolverDestinatarios en src/common/publicacion/ (compartido con Avisos,
Fase 16 - correccion deliberada al spec, que sugeria src/comun/, para no
introducir una segunda convencion junto a src/common/ ya existente).

GET filtra por lo que le toca ver al actor (ADMINISTRATIVO ve todo de su
sede; MAESTRO/ALUMNO ven SEDE + su propio alcance de CARRERA/GRUPO) y
expande ocurrencias con expandirOcurrencias (Task 2) dentro del rango
pedido (max 62 dias).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AGjjFjoqQ1gmLwoZsox6Lw"
```

---

## Task 4: Suite e2e de `calendario`

**Files:**
- Create: `App/backend/test/calendario.e2e-spec.ts`

**Interfaces:**
- Consumes: rutas de Task 3. Copiar el `beforeAll`/`firmarToken`/scaffolding de JWT tal
  cual de `test/materias.e2e-spec.ts` (mismo patrón que toda la Fase 14 — buscar sedes
  por nombre `'CESP Mérida'`/`'CESP Valladolid'` en `prisma/seed.ts`, firmar tokens con
  `jose`).

- [ ] **Step 1: Escribir los casos**

Create `App/backend/test/calendario.e2e-spec.ts` cubriendo (adaptar el scaffolding de
`materias.e2e-spec.ts`; usar `prisma.usuario.findFirst`/`findFirstOrThrow` para ubicar un
`ADMINISTRATIVO`, un `MAESTRO` y un `ALUMNO` reales de la sede de Mérida sembrados por
`seed.ts`, y crear/eliminar solo lo que la corrida necesite, `afterAll` acotado a ids —
regla 14):

1. `POST /eventos` con `alcanceTipo: SEDE` por un `ADMINISTRATIVO` → `201`, `data.id`
   presente.
2. `POST /eventos` con `recurrenciaRegla` presente y `recurrenciaHasta` ausente → `400
   VALIDATION_ERROR`.
3. `POST /eventos` con `alcanceTipo: GRUPO` y `alcanceId` de un grupo que NO pertenece a
   la sede del actor → `404 NOT_FOUND`.
4. `POST /eventos` con `alcanceTipo: SEDE` y `alcanceId` presente (malformado) → `400
   VALIDATION_ERROR`.
5. `POST /eventos` por un `MAESTRO` con `alcanceTipo: SEDE` → `403 ROL_NO_AUTORIZADO`.
6. `POST /eventos` por un `MAESTRO` con `alcanceTipo: GRUPO` de un grupo donde NO tiene
   asignación (`GrupoMateriaMaestro`) → `403 ROL_NO_AUTORIZADO`.
7. `POST /eventos` por un `MAESTRO` con `alcanceTipo: GRUPO` de un grupo donde SÍ tiene
   asignación → `201`.
8. `POST /eventos` por un `ALUMNO` (cualquier alcance) → `403 ROL_NO_AUTORIZADO`.
9. `GET /eventos?desde=&hasta=` — crear un evento semanal (cada 1 semana, lunes) con
   `fechaInicio`/`recurrenciaHasta` conocidos, pedir un rango de 3 semanas y verificar
   que aparecen exactamente 3 ocurrencias con el mismo `eventoId` y fechas correctas
   (`esRecurrente: true`).
10. `GET /eventos` — un evento con `alcanceTipo: GRUPO` de un grupo donde el alumno de
    prueba NO está matriculado no aparece en su listado; uno donde SÍ está matriculado sí
    aparece.
11. `GET /eventos?desde=2026-01-01&hasta=2026-12-31` (rango > 62 días) → `400
    VALIDATION_ERROR`.
12. `PATCH /eventos/:id` por el autor, cambiando `titulo` → `200`, `RegistroAuditoria`
    nueva con `accion: EDICION` (verificar con una query directa a `prisma`, mismo
    patrón que otros e2e de este repo que verifican auditoría).
13. `PATCH /eventos/:id` sin cambios reales (mismo `titulo` que ya tenía) → `200`, SIN
    fila nueva de auditoría (contar `registroAuditoria` antes/después).
14. `PATCH /eventos/:id` por un `MAESTRO` que no es el autor y no es `ADMINISTRATIVO` →
    `403`.
15. `DELETE /eventos/:id` por el autor → `200 { data: { ok: true } }`; el evento ya no
    aparece en un `GET` posterior.
16. `DELETE /eventos/:id` de otra sede → `404 NOT_FOUND`.
17. Aislamiento cross-sede: un `ADMINISTRATIVO` de Valladolid no ve un evento `SEDE` de
    Mérida en su `GET /eventos`.
18. `GET /eventos` sin token → `401 UNAUTHORIZED`.

- [ ] **Step 2: Correr la suite**

Run: `cd App/backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config test/jest-e2e.json calendario --runInBand`
Expected: PASS, 18/18.

- [ ] **Step 3: Correr la suite e2e completa (no romper nada)**

Run: `cd App/backend && pnpm test:e2e`
Expected: todas las suites en verde (22 + 1 nueva = 23 suites).

- [ ] **Step 4: Lint**

Run: `cd App/backend && npx eslint "test/calendario.e2e-spec.ts"`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/backend/test/calendario.e2e-spec.ts
git commit -m "test(backend): suite e2e de calendario (Fase 15, Dia 41)

Alta con/sin recurrencia, validacion de alcance (SEDE/CARRERA/GRUPO),
permisos por rol (administrativo/maestro/alumno), expansion de
ocurrencias en un rango real, PATCH con hayCambiosReales, DELETE,
aislamiento cross-sede. afterAll acotado a ids (regla 14).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AGjjFjoqQ1gmLwoZsox6Lw"
```

---

## Task 5: Job de recordatorios (`InternalJobGuard` + endpoint interno)

**Files:**
- Create: `App/backend/src/common/guards/internal-job.guard.ts`
- Create: `App/backend/src/common/guards/internal-job-guard.module.ts`
- Modify: `App/backend/src/calendario/calendario.service.ts` (agregar
  `generarRecordatoriosPendientes`)
- Create: `App/backend/src/calendario/internal-recordatorios.controller.ts`
- Modify: `App/backend/src/calendario/calendario.module.ts` (registrar el controller +
  importar `MailModule`)
- Modify: `App/backend/src/app.module.ts` (registrar `InternalJobGuardModule`)
- Modify: `App/backend/.env.example`
- Create: `App/backend/docs/setup-backend-recordatorios-cron.md` (o
  `App/backend/../../docs/setup-backend-recordatorios-cron.md` — verificar dónde viven
  los demás `docs/setup-backend-*.md` del repo antes de elegir la ruta exacta)

**Interfaces:**
- Consumes: `resolverDestinatarios` (Task 3), `expandirOcurrencias` (Task 2),
  `MailService.enviarNotificacion` (Fase 14, ya existe).
- Produces: `CalendarioService.generarRecordatoriosPendientes(): Promise<{
  ocurrenciasProcesadas: number; notificacionesCreadas: number }>`; `InternalJobGuard`
  (compara el header `X-Internal-Secret` contra `process.env.INTERNAL_JOB_SECRET`); ruta
  `POST /internal/recordatorios/ejecutar`.

- [ ] **Step 1: Verificar dónde viven los `docs/setup-backend-*.md` existentes**

Run: `find "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp/docs" -iname "setup-backend-*"`
Usar esa misma carpeta para el archivo nuevo del Step 7.

- [ ] **Step 2: Escribir `InternalJobGuard`**

Create `App/backend/src/common/guards/internal-job.guard.ts`:

```ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Guard del endpoint interno del job de recordatorios — Fase 15, Día 42.
 * NO pasa por `SedeGuard`/`RolesGuard` (no hay JWT de usuario ni de
 * `AdminPlataforma` acá — lo dispara `pg_cron`/`pg_net` de Supabase, o una
 * GitHub Action, no un humano logueado). Exige un header
 * `X-Internal-Secret` que coincida exactamente con
 * `process.env.INTERNAL_JOB_SECRET`.
 *
 * Mismo criterio de "no distinguir el motivo del rechazo" que el resto de
 * la app: falta el header, header incorrecto, o `INTERNAL_JOB_SECRET` sin
 * configurar en el entorno — los 3 casos devuelven el mismo 401.
 */
@Injectable()
export class InternalJobGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const secretoEsperado = process.env.INTERNAL_JOB_SECRET;
    const secretoRecibido = request.headers['x-internal-secret'];

    if (
      !secretoEsperado ||
      typeof secretoRecibido !== 'string' ||
      secretoRecibido !== secretoEsperado
    ) {
      throw new UnauthorizedException({
        error: 'Secreto interno inválido o ausente',
        code: 'UNAUTHORIZED',
      });
    }

    return true;
  }
}
```

Create `App/backend/src/common/guards/internal-job-guard.module.ts` (mismo patrón
`@Global()` que `SedeGuardModule`):

```ts
import { Global, Module } from '@nestjs/common';
import { InternalJobGuard } from './internal-job.guard';

@Global()
@Module({
  providers: [InternalJobGuard],
  exports: [InternalJobGuard],
})
export class InternalJobGuardModule {}
```

Modify `App/backend/src/app.module.ts` — agregar el import y meterlo en `imports` (junto
a los otros guard modules):

```ts
import { InternalJobGuardModule } from './common/guards/internal-job-guard.module';
```
```ts
    PlatformAdminGuardModule,
    InternalJobGuardModule,
```

- [ ] **Step 3: Agregar `generarRecordatoriosPendientes` a `CalendarioService`**

Modify `App/backend/src/calendario/calendario.service.ts` — agregar el import de
`MailService` y el método. Primero, en el constructor:

```ts
import { MailService } from '../mail/mail.service';
```
```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}
```

Agregar el método (después de `eliminar`):

```ts
function enviosDeRecordatoriosHabilitados(): boolean {
  return process.env.RECORDATORIOS_HABILITADO === 'true';
}
```

> Poner esta función fuera de la clase, junto a las demás funciones sueltas del archivo
> (mismo lugar que `hayCambiosReales`).

```ts
  /**
   * Job de recordatorios — Fase 15, Día 42. Para cada evento con al menos
   * una ocurrencia en las próximas 24-48h (expandiendo recurrencia), por
   * cada ocurrencia sin fila en `RecordatorioEnviado(eventoId,
   * fechaOcurrencia)`: resuelve destinatarios, crea las `Notificacion`
   * (tipo `RECORDATORIO_EVENTO`) + el `RecordatorioEnviado` en la MISMA
   * transacción (el `@@unique` lo hace idempotente si 2 corridas se
   * solapan), y DESPUÉS de confirmar manda el correo best-effort por
   * destinatario (patrón `altaPersona` + Mailgun — un fallo de correo
   * nunca revierte ni tumba el resto del job).
   *
   * `RECORDATORIOS_HABILITADO` en falso (default) hace que el método
   * retorne de inmediato sin tocar la DB — mismo criterio "falla cerrado"
   * que `MAILGUN_ENVIOS_HABILITADO`.
   */
  async generarRecordatoriosPendientes(): Promise<{
    ocurrenciasProcesadas: number;
    notificacionesCreadas: number;
  }> {
    if (!enviosDeRecordatoriosHabilitados()) {
      console.log(
        '[CalendarioService] Recordatorios deshabilitados (RECORDATORIOS_HABILITADO=false) — job no-op.',
      );
      return { ocurrenciasProcesadas: 0, notificacionesCreadas: 0 };
    }

    const ahora = new Date();
    const desde = new Date(ahora.getTime());
    const hasta = new Date(ahora.getTime() + 48 * 60 * 60 * 1000);

    let ocurrenciasProcesadas = 0;
    let notificacionesCreadas = 0;

    try {
      const eventos = await this.prisma.eventoCalendario.findMany({
        where: { sedeId: undefined }, // sin filtro de sede: el job corre para TODAS las sedes.
      });

      for (const evento of eventos) {
        const fechas = expandirOcurrencias(
          {
            fechaInicio: evento.fechaInicio,
            recurrenciaRegla: evento.recurrenciaRegla as ReglaRecurrencia | null,
            recurrenciaHasta: evento.recurrenciaHasta,
          },
          { desde, hasta },
        );

        for (const fechaOcurrencia of fechas) {
          ocurrenciasProcesadas++;

          const yaEnviado = await this.prisma.recordatorioEnviado.findUnique({
            where: {
              eventoId_fechaOcurrencia: { eventoId: evento.id, fechaOcurrencia },
            },
          });
          if (yaEnviado) continue;

          const destinatarios = await resolverDestinatarios(
            this.prisma,
            evento.sedeId,
            evento.alcanceTipo,
            evento.alcanceId,
          );

          const resultado = await this.prisma.$transaction(async (tx) => {
            await tx.recordatorioEnviado.create({
              data: { eventoId: evento.id, fechaOcurrencia },
            });
            if (destinatarios.length === 0) {
              return { creadas: 0 };
            }
            await tx.notificacion.createMany({
              data: destinatarios.map((usuarioId) => ({
                usuarioId,
                sedeId: evento.sedeId,
                tipo: 'RECORDATORIO_EVENTO' as const,
                referenciaId: evento.id,
                titulo: evento.titulo,
                cuerpoCorto: `Recordatorio: ${evento.titulo} — ${fechaOcurrencia
                  .toISOString()
                  .slice(0, 10)}`,
              })),
            });
            return { creadas: destinatarios.length };
          });

          notificacionesCreadas += resultado.creadas;

          if (destinatarios.length > 0) {
            const perfiles = await this.obtenerCorreosPersonales(destinatarios);
            for (const correo of perfiles) {
              try {
                await this.mailService.enviarNotificacion({
                  correoDestino: correo,
                  asunto: `Recordatorio: ${evento.titulo}`,
                  cuerpoTexto: `Tienes un evento próximo: ${evento.titulo} el ${fechaOcurrencia
                    .toISOString()
                    .slice(0, 10)}.`,
                });
              } catch (err) {
                console.error(
                  '[CalendarioService.generarRecordatoriosPendientes] fallo al enviar correo:',
                  err,
                );
              }
            }
          }
        }
      }

      return { ocurrenciasProcesadas, notificacionesCreadas };
    } catch (err) {
      console.error(
        '[CalendarioService.generarRecordatoriosPendientes] error inesperado:',
        err,
      );
      throw err;
    }
  }

  /**
   * Resuelve `correoPersonal` para una lista de `Usuario.id`, cualquiera
   * que sea su rol — el correo de bienvenida (Fase 4) ya estableció que
   * el correo real/legible SIEMPRE es `correoPersonal` del perfil, nunca
   * `Usuario.email` (login sintético). Usuarios sin ningún perfil
   * (no debería pasar en la práctica) se omiten silenciosamente — no hay
   * a dónde mandarles el correo.
   */
  private async obtenerCorreosPersonales(usuarioIds: string[]): Promise<string[]> {
    const [alumnos, maestros, administrativos] = await Promise.all([
      this.prisma.perfilAlumno.findMany({
        where: { usuarioId: { in: usuarioIds } },
        select: { correoPersonal: true },
      }),
      this.prisma.perfilMaestro.findMany({
        where: { usuarioId: { in: usuarioIds } },
        select: { correoPersonal: true },
      }),
      this.prisma.perfilAdministrativo.findMany({
        where: { usuarioId: { in: usuarioIds } },
        select: { correoPersonal: true },
      }),
    ]);
    return [...alumnos, ...maestros, ...administrativos].map((p) => p.correoPersonal);
  }
```

> El `where: { sedeId: undefined }` en el `findMany` de arriba es intencional (Prisma
> ignora una condición `undefined` — equivale a sin filtro) y está para dejar explícito
> en el código que el job recorre TODAS las sedes a propósito, no un descuido. Si el
> linter/reviewer lo marca como redundante, está bien reemplazarlo por `{}` — pero deja
> el comentario.

- [ ] **Step 4: Escribir el endpoint interno**

Create `App/backend/src/calendario/internal-recordatorios.controller.ts`:

```ts
import { Controller, Post, UseGuards } from '@nestjs/common';
import { InternalJobGuard } from '../common/guards/internal-job.guard';
import { CalendarioService } from './calendario.service';

/**
 * `POST /internal/recordatorios/ejecutar` — Fase 15, Día 42. Disparado
 * por `pg_cron`/`pg_net` de Supabase (o una GitHub Action equivalente),
 * NUNCA por un cliente humano — ver `docs/setup-backend-recordatorios-cron.md`
 * para cómo se programa. `InternalJobGuard`, no `SedeGuard`/`RolesGuard`.
 */
@Controller('internal/recordatorios')
@UseGuards(InternalJobGuard)
export class InternalRecordatoriosController {
  constructor(private readonly calendarioService: CalendarioService) {}

  @Post('ejecutar')
  async ejecutar() {
    const data = await this.calendarioService.generarRecordatoriosPendientes();
    return { data };
  }
}
```

Modify `App/backend/src/calendario/calendario.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { CalendarioController } from './calendario.controller';
import { CalendarioService } from './calendario.service';
import { InternalRecordatoriosController } from './internal-recordatorios.controller';

@Module({
  imports: [MailModule],
  controllers: [CalendarioController, InternalRecordatoriosController],
  providers: [CalendarioService],
  exports: [CalendarioService],
})
export class CalendarioModule {}
```

> Verificar el nombre real del export de `MailModule` (`src/mail/mail.module.ts`) antes
> de importar — si `MailService` no es un provider exportado de ese módulo, ajustarlo ahí
> en vez de improvisar un import directo del service sin pasar por su módulo.

- [ ] **Step 5: Agregar las env vars**

Modify `App/backend/.env.example` — agregar al final, sección nueva:

```
# --- Job de recordatorios de calendario (Fase 15, Día 42) ---

# 🔒 SECRETA — cualquiera que la tenga puede disparar el job manualmente.
# Genera un valor random largo, igual que PLATFORM_ADMIN_JWT_SECRET:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Debe coincidir EXACTAMENTE con el que se configure en el cron.schedule
# de Supabase (ver docs/setup-backend-recordatorios-cron.md).
INTERNAL_JOB_SECRET="genera-un-valor-random-largo-aqui"

# ✅ No es secreto — flag propio de este proyecto (true/false). Falla
# CERRADO (apagado) por defecto, mismo criterio que MAILGUN_ENVIOS_HABILITADO
# — actívalo solo cuando el cron esté configurado y quieras que el job
# realmente cree Notificacion/mande correo en vez de ser un no-op.
RECORDATORIOS_HABILITADO=false
```

- [ ] **Step 6: Verificar build y lint**

Run: `cd App/backend && npx tsc --noEmit && npx eslint "src/calendario/**/*.ts" "src/common/guards/internal-job*.ts"`
Expected: sin errores.

- [ ] **Step 7: Documentar el disparador de Supabase**

Create `docs/setup-backend-recordatorios-cron.md` (en la carpeta que confirmó el Step 1)
con instrucciones para que EL USUARIO (no un agente) configure, cuando esté listo:

```markdown
# Disparador del job de recordatorios (`pg_cron` + `pg_net`)

Este documento es para configurar manualmente en el SQL Editor de Supabase — no es
código que se despliega, es una tarea de infraestructura fuera del ciclo normal de
review de código. Requiere que el backend ya esté desplegado (dev o prod) con
`INTERNAL_JOB_SECRET` configurado en las env vars del hosting.

## 1. Habilitar las extensiones (una sola vez por proyecto de Supabase)

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
```

## 2. Programar el cron diario

Reemplaza `<URL_DEL_BACKEND>` por la URL real del backend desplegado (ej.
`https://sige-cesp-backend.onrender.com`) y `<INTERNAL_JOB_SECRET>` por el valor real
configurado en las env vars del backend (NUNCA lo pegues en un commit ni en un chat):

```sql
select cron.schedule(
  'recordatorios-calendario-diario',
  '0 7 * * *',  -- 07:00 UTC todos los días — ajustar a la hora que se quiera
  $$
  select net.http_post(
    url := '<URL_DEL_BACKEND>/internal/recordatorios/ejecutar',
    headers := jsonb_build_object('X-Internal-Secret', '<INTERNAL_JOB_SECRET>'),
    body := '{}'::jsonb
  );
  $$
);
```

## 3. Verificar que corrió

```sql
select * from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'recordatorios-calendario-diario')
order by start_time desc
limit 5;
```

## 4. Desactivar/eliminar

```sql
select cron.unschedule('recordatorios-calendario-diario');
```

## Alternativa equivalente

Si se prefiere no depender de `pg_cron`, una GitHub Action con `schedule` que haga un
`curl -X POST <URL_DEL_BACKEND>/internal/recordatorios/ejecutar -H "X-Internal-Secret:
..."` diario cumple la misma función, sin tocar la DB de Supabase. Elegir una u otra, no
ambas (evita duplicar notificaciones — aunque el job es idempotente por `RecordatorioEnviado`,
correrlo 2 veces es trabajo de más sin beneficio).
```

- [ ] **Step 8: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/backend/src/common/guards/internal-job* App/backend/src/calendario/ App/backend/src/app.module.ts App/backend/.env.example docs/setup-backend-recordatorios-cron.md
git commit -m "feat(backend): job de recordatorios de calendario + endpoint interno (Fase 15, Dia 42)

CalendarioService.generarRecordatoriosPendientes(): para cada ocurrencia
en las proximas 48h sin RecordatorioEnviado, crea Notificacion
(tipo RECORDATORIO_EVENTO) + RecordatorioEnviado en una transaccion
(idempotente por @@unique), correo best-effort despues via
MailService.enviarNotificacion. RECORDATORIOS_HABILITADO falla cerrado.

POST /internal/recordatorios/ejecutar detras de InternalJobGuard (header
X-Internal-Secret, sin JWT) - disenado para pg_cron/pg_net de Supabase,
documentado en docs/setup-backend-recordatorios-cron.md (tarea manual
del usuario, fuera del ciclo de review de codigo).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AGjjFjoqQ1gmLwoZsox6Lw"
```

---

## Task 6: e2e del job de recordatorios

**Files:**
- Create: `App/backend/test/internal-recordatorios.e2e-spec.ts`

**Interfaces:**
- Consumes: `POST /internal/recordatorios/ejecutar` (Task 5).

- [ ] **Step 1: Escribir los casos**

Create `App/backend/test/internal-recordatorios.e2e-spec.ts` (scaffolding de `app`/
`prisma` igual al resto de e2e de este repo, pero SIN `firmarToken` — este endpoint no
usa JWT):

1. Sin header `X-Internal-Secret` → `401 UNAUTHORIZED`.
2. Con header incorrecto → `401 UNAUTHORIZED`.
3. Con `RECORDATORIOS_HABILITADO` sin setear (o `'false'`) y header correcto → `200 {
   data: { ocurrenciasProcesadas: 0, notificacionesCreadas: 0 } }` — verificar seteando
   `process.env.RECORDATORIOS_HABILITADO` explícitamente a `'false'` en el test (no
   confiar en que ya esté así por default del entorno de CI).
4. Con `RECORDATORIOS_HABILITADO='true'` y header correcto: crear un evento de prueba
   `fechaInicio` = mañana, `alcanceTipo: SEDE`, sin recurrencia, en la sede de Mérida →
   llamar el endpoint → `200`, `ocurrenciasProcesadas >= 1`, `notificacionesCreadas >= 1`
   (al menos los usuarios activos de esa sede). Mockear `MailService` (usar
   `MAIL_FETCH_OVERRIDE`/`MAILGUN_ENVIOS_HABILITADO='false'`, mismo patrón que
   `mail.service.spec.ts`, para no intentar un envío real) o simplemente dejar
   `MAILGUN_ENVIOS_HABILITADO` apagado en el entorno de test — verificar cuál ya aplica
   en `test/jest-e2e.json`/setup antes de decidir.
5. Idempotencia: llamar el endpoint una segunda vez inmediatamente después del caso 4 →
   `200`, pero SIN `Notificacion` nuevas para esa misma ocurrencia (verificar contando
   filas de `notificacion` con `referenciaId = evento.id` antes/después de la segunda
   llamada — debe ser igual).
6. Un evento con `fechaInicio` a más de 48h → el endpoint no genera nada para ese evento
   (verificar que no aparece ninguna `Notificacion` con su `referenciaId`).
7. `afterAll` acotado a ids (regla 14) — borrar el/los `EventoCalendario` de prueba (el
   `RecordatorioEnviado` y las `Notificacion` se van en cascada por los FKs de Task 1/las
   Fase 14).

- [ ] **Step 2: Correr la suite**

Run: `cd App/backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config test/jest-e2e.json internal-recordatorios --runInBand`
Expected: PASS, 7/7.

- [ ] **Step 3: Correr la suite e2e completa**

Run: `cd App/backend && pnpm test:e2e`
Expected: todas las suites en verde.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/backend/test/internal-recordatorios.e2e-spec.ts
git commit -m "test(backend): suite e2e del job de recordatorios (Fase 15, Dia 42)

401 sin/con secreto incorrecto, no-op con el flag apagado, generacion
real con el flag prendido, idempotencia entre 2 corridas, evento fuera
de la ventana de 48h no genera nada. afterAll acotado a ids (regla 14).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AGjjFjoqQ1gmLwoZsox6Lw"
```

---

## Task 7: `lib/api/calendario.ts` (cliente de API compartido)

**Files:**
- Create: `App/frontend/src/lib/api/calendario.ts`

**Interfaces:**
- Consumes: `apiFetchAuth` de `./http` (verificar el nombre/shape real antes de asumir —
  mismo patrón de Task 5 de la Fase 14).
- Produces:
  - `CategoriaEvento = 'EXAMEN' | 'SOCIAL' | 'ADMINISTRATIVO' | 'SUSPENSION_CLASES' |
    'OTRO'`
  - `AlcanceDestino = 'SEDE' | 'CARRERA' | 'GRUPO'`
  - `ReglaRecurrencia = { frecuencia: 'DIARIA' | 'SEMANAL' | 'MENSUAL'; intervalo:
    number; diasSemana?: number[]; diaMes?: number }`
  - `OcurrenciaEvento = { eventoId: string; titulo: string; descripcion: string | null;
    fecha: string; horaInicio: string | null; fechaFin: string | null; categoria:
    CategoriaEvento; alcanceTipo: AlcanceDestino; alcanceId: string | null; esRecurrente:
    boolean }`
  - `CrearEventoInput`/`ActualizarEventoInput` (mismos campos que los DTOs del backend,
    `fechaInicio`/`fechaFin`/`recurrenciaHasta` como `string` ISO).
  - `listarEventos(desde: string, hasta: string): Promise<OcurrenciaEvento[]>`
  - `crearEvento(input: CrearEventoInput): Promise<{ id: string }>`
  - `actualizarEvento(id: string, input: ActualizarEventoInput): Promise<{ id: string }>`
  - `eliminarEvento(id: string): Promise<{ ok: true }>`

- [ ] **Step 1: Escribir el archivo**

Create `App/frontend/src/lib/api/calendario.ts`:

```ts
import { apiFetchAuth } from './http';

/**
 * `POST/GET/PATCH/DELETE /eventos` — Fase 15, Días 41-44. Cliente
 * COMPARTIDO entre los 3 árboles (admin/maestro/alumno) — mismo criterio
 * que `lib/api/grupos.ts`. Shape espejo de `CalendarioService`
 * (`App/backend/src/calendario/`), mantener en sync a mano.
 */
export type CategoriaEvento =
  | 'EXAMEN'
  | 'SOCIAL'
  | 'ADMINISTRATIVO'
  | 'SUSPENSION_CLASES'
  | 'OTRO';

export type AlcanceDestino = 'SEDE' | 'CARRERA' | 'GRUPO';

export interface ReglaRecurrencia {
  frecuencia: 'DIARIA' | 'SEMANAL' | 'MENSUAL';
  intervalo: number;
  diasSemana?: number[];
  diaMes?: number;
}

export interface OcurrenciaEvento {
  eventoId: string;
  titulo: string;
  descripcion: string | null;
  fecha: string;
  horaInicio: string | null;
  fechaFin: string | null;
  categoria: CategoriaEvento;
  alcanceTipo: AlcanceDestino;
  alcanceId: string | null;
  esRecurrente: boolean;
}

export interface CrearEventoInput {
  titulo: string;
  descripcion?: string;
  fechaInicio: string;
  horaInicio?: string;
  fechaFin?: string;
  categoria: CategoriaEvento;
  alcanceTipo: AlcanceDestino;
  alcanceId?: string;
  recurrenciaRegla?: ReglaRecurrencia;
  recurrenciaHasta?: string;
}

export type ActualizarEventoInput = Partial<CrearEventoInput>;

export function listarEventos(
  desde: string,
  hasta: string,
): Promise<OcurrenciaEvento[]> {
  return apiFetchAuth<OcurrenciaEvento[]>(
    `/eventos?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`,
  );
}

export function crearEvento(input: CrearEventoInput): Promise<{ id: string }> {
  return apiFetchAuth<{ id: string }>('/eventos', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function actualizarEvento(
  id: string,
  input: ActualizarEventoInput,
): Promise<{ id: string }> {
  return apiFetchAuth<{ id: string }>(`/eventos/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function eliminarEvento(id: string): Promise<{ ok: true }> {
  return apiFetchAuth<{ ok: true }>(`/eventos/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
```

> Verificar contra `App/frontend/src/lib/api/http.ts` real: (1) si `apiFetchAuth` ya
> inyecta `Content-Type: application/json` para requests con `body`, o si hace falta
> pasarlo a mano en las `options`; (2) si `GET /eventos` devuelve `{ data: [...] }` (sin
> paginar) y `apiFetchAuth` ya desenvuelve `.data` — si no lo hace automáticamente,
> ajustar las funciones de arriba para desenvolverlo acá. Ver cómo lo resolvió `lib/api/notificaciones.ts`
> (Fase 14) como referencia — ese archivo NO pagina en `conteoNoLeidas`/`marcarLeida` y sí
> usa `apiFetchAuth` liso para esos casos.

- [ ] **Step 2: Verificar que compila y linta**

Run: `cd App/frontend && npx tsc --noEmit && npx eslint src/lib/api/calendario.ts`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/frontend/src/lib/api/calendario.ts
git commit -m "feat(frontend): cliente de API de calendario (compartido) (Fase 15, Dia 43)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AGjjFjoqQ1gmLwoZsox6Lw"
```

---

## Task 8: UI de calendario — árbol ADMIN

**Files:**
- Create: `App/frontend/src/app/admin/calendario/mes-grid.util.ts`
- Create: `App/frontend/src/app/admin/calendario/EventoModal.tsx`
- Create: `App/frontend/src/app/admin/calendario/ConfirmarEliminarEventoModal.tsx`
- Create: `App/frontend/src/app/admin/calendario/page.tsx`
- Modify: `App/frontend/src/components/admin/ui/shell/Sidebar.tsx`
- Modify: `App/frontend/src/components/admin/ui/shell/icons.tsx` (si falta un ícono de
  calendario)
- Reference: `App/frontend/src/app/admin/carreras/CarreraModal.tsx` (patrón de modal
  único alta/edición, regla 13), `App/frontend/src/app/admin/grupos/ConfirmarEliminarGrupoModal.tsx`
  (patrón de modal de confirmación), `App/frontend/node_modules/next/dist/docs/`
  (Next.js con breaking changes, leer antes de escribir).

**Interfaces:**
- Consumes: `listarEventos`/`crearEvento`/`actualizarEvento`/`eliminarEvento` de
  `@/lib/api/calendario`; `listarCarreras`/`listarGrupos` ya existentes (para los
  `<select>` de alcance) — verificar sus nombres reales en `lib/api/carreras.ts` /
  `lib/api/grupos.ts` antes de asumir.
- Produces: página `/admin/calendario` con grid mensual + modal alta/edición + modal de
  confirmación de borrado; link "Calendario" en el Sidebar.

- [ ] **Step 1: Escribir el generador de grid mensual**

Create `App/frontend/src/app/admin/calendario/mes-grid.util.ts`:

```ts
/**
 * Genera el grid de 6 semanas x 7 días para la vista mensual de
 * calendario — Fase 15, Día 43. Función pura, duplicada a propósito en
 * los 3 árboles (regla 11 — sin componente/util compartido entre admin/
 * maestro/alumno más allá de `lib/api/*`).
 *
 * Las celdas de días fuera del mes (relleno antes del día 1 o después del
 * último día) SÍ se generan, para que el grid sea siempre 6x7 = 42 celdas
 * — necesario para que el layout no salte de alto entre meses. `enElMes`
 * distingue cuáles son del mes actual para pintarlas atenuadas.
 */
export interface CeldaMes {
  /** ISO `YYYY-MM-DD`, UTC. */
  fecha: string;
  enElMes: boolean;
  esHoy: boolean;
}

export function generarGridMensual(anio: number, mesIndiceCero: number): CeldaMes[] {
  const primerDiaDelMes = new Date(Date.UTC(anio, mesIndiceCero, 1));
  const inicioGrid = new Date(primerDiaDelMes);
  inicioGrid.setUTCDate(inicioGrid.getUTCDate() - primerDiaDelMes.getUTCDay());

  const hoy = new Date();
  const hoyISO = new Date(
    Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()),
  )
    .toISOString()
    .slice(0, 10);

  const celdas: CeldaMes[] = [];
  const cursor = new Date(inicioGrid);
  for (let i = 0; i < 42; i++) {
    const iso = cursor.toISOString().slice(0, 10);
    celdas.push({
      fecha: iso,
      enElMes: cursor.getUTCMonth() === mesIndiceCero,
      esHoy: iso === hoyISO,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return celdas;
}

/** Primer y último día ISO cubiertos por el grid de un mes — el rango que
 * se le pide a `GET /eventos?desde=&hasta=`. Puede ser más ancho que el
 * mes calendario real (incluye el relleno de semanas vecinas). */
export function rangoDelGrid(anio: number, mesIndiceCero: number): { desde: string; hasta: string } {
  const celdas = generarGridMensual(anio, mesIndiceCero);
  return { desde: celdas[0].fecha, hasta: celdas[celdas.length - 1].fecha };
}
```

- [ ] **Step 2: Escribir `EventoModal.tsx`**

Leer primero `CarreraModal.tsx` completo para el patrón exacto: un solo componente que
recibe `evento: OcurrenciaEvento | null` (null = alta, no-null = edición — OJO: para
edición necesitas el `EventoCalendario` completo, no solo la `OcurrenciaEvento`
aplanada; si el modal de edición solo tiene los campos de `OcurrenciaEvento` a mano,
añade un `GET /eventos/:id` NUEVO — no está en el contrato de Task 3 — o, más simple y
consistente con "sin over-fetching", pasa el evento completo desde el estado local del
`page.tsx`, que ya lo tiene porque lo acaba de crear/consultar; documenta cuál de las 2
rutas tomaste en tu reporte).

Campos del formulario:
- `titulo` (texto, requerido)
- `descripcion` (textarea, opcional)
- `fechaInicio` (`<input type="date">`, requerido)
- `horaInicio` (`<input type="time">`, opcional — checkbox "todo el día" que lo vacía)
- `fechaFin` (`<input type="date">`, opcional — solo informativo, ver Global Constraints)
- `categoria` (`<select>` con las 5 opciones de `CategoriaEvento`, paleta de color por
  categoría en un objeto local `COLOR_POR_CATEGORIA: Record<CategoriaEvento, string>`
  con clases Tailwind, ej. `EXAMEN: 'bg-crimson/10 text-crimson'`)
- Bloque de alcance: `<select>` de `alcanceTipo` (SEDE/CARRERA/GRUPO) + `<select>`
  dependiente que aparece solo si no es SEDE — de carreras (`listarCarreras()`) si es
  CARRERA, de grupos (`listarGrupos()`, filtrando client-side o pidiendo sin filtro y
  mostrando `nombre` — decide según lo que ya devuelva `listarGrupos()`) si es GRUPO.
- Bloque de recurrencia: checkbox "Se repite" → si está marcado, muestra `frecuencia`
  (`<select>` DIARIA/SEMANAL/MENSUAL), `intervalo` (`<input type="number" min={1}>`),
  `diasSemana` (7 checkboxes Dom-Sáb, solo si `frecuencia === 'SEMANAL'`), `diaMes`
  (`<input type="number">` + checkbox "último día del mes" que fuerza `-1`, solo si
  `frecuencia === 'MENSUAL'`), `recurrenciaHasta` (`<input type="date">`, requerido en el
  formulario si "Se repite" está marcado — validación de cliente ANTES de llamar la API,
  espejo de la del backend).

`useMutation` de React Query para crear/actualizar, `toast.success`/`toast.error` (patrón
`CarreraModal.tsx`), invalida `['calendario', 'eventos']` al éxito, cierra el modal y
limpia el formulario (regla 13 — se limpia tanto al cancelar como al guardar con éxito).

- [ ] **Step 3: Escribir `ConfirmarEliminarEventoModal.tsx`**

Calco de `ConfirmarEliminarGrupoModal.tsx` — recibe `eventoId`/`titulo`, botones
Cancelar/Eliminar, `useMutation` de `eliminarEvento`, `toast` + invalidación de query al
éxito.

- [ ] **Step 4: Escribir `page.tsx`**

```tsx
'use client';
```

Estado: `mesActual` (`{ anio: number; mesIndiceCero: number }`, default = mes real de
hoy), `eventoEnEdicion` (`OcurrenciaEvento | null`, controla si `EventoModal` está
abierto y en qué modo), `eventoAEliminar` (id + título, controla
`ConfirmarEliminarEventoModal`).

`useQuery` con `queryKey: ['calendario', 'eventos', mesActual.anio, mesActual.mesIndiceCero]`,
`queryFn` = `listarEventos(...rangoDelGrid(mesActual.anio, mesActual.mesIndiceCero))`
(con `try/catch` + `console.error`, regla 12).

Render: encabezado con navegación mes anterior/siguiente (2 botones que decrementan/
incrementan `mesActual.mesIndiceCero`, manejando el rollover de año — `mesIndiceCero ===
-1` ⇒ `{ anio: anio-1, mesIndiceCero: 11 }`, `mesIndiceCero === 12` ⇒ `{ anio: anio+1,
mesIndiceCero: 0 }`) + nombre del mes/año; botón "+ Nuevo evento" que abre `EventoModal`
en modo alta; grid de `generarGridMensual(...)` (7 columnas CSS grid, cada celda muestra
el número de día + hasta 3 chips de evento con color por categoría, agrupando las
`OcurrenciaEvento` del día por `fecha`; click en un chip abre `EventoModal` en modo
edición SI el actor es el autor o `ADMINISTRATIVO` — en admin, siempre puede editar, así
que sin condición extra acá).

- [ ] **Step 5: Agregar el link al Sidebar**

Modify `App/frontend/src/components/admin/ui/shell/Sidebar.tsx` — agregar a
`NAV_PRINCIPAL` (después de `Grupos`, antes de `Administrativos` — mismo orden relativo
que el spec de Fase 15 lista las fases):

```ts
{ href: '/admin/calendario', label: 'Calendario', Icon: IconCalendario, match: 'prefijo' },
```

Si `IconCalendario` no existe en `./icons`, agregarlo con el mismo formato exacto de los
íconos existentes de ese archivo (SVG inline, mismo `viewBox`/props). Path de calendario
estándar (Heroicons outline "calendar"):
```
M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5
```

- [ ] **Step 6: Verificar build y lint**

Run: `cd App/frontend && npx tsc --noEmit && npx eslint "src/app/admin/calendario/**/*.tsx" "src/components/admin/ui/shell/**/*.tsx"`
Expected: sin errores.

- [ ] **Step 7: Build de producción**

Run: `cd App/frontend && pnpm build`
Expected: build exitoso, ruta `/admin/calendario` listada.

- [ ] **Step 8: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/frontend/src/app/admin/calendario/ App/frontend/src/components/admin/ui/shell/
git commit -m "feat(admin): vista mensual de calendario + alta/edicion/borrado (Fase 15, Dia 43)

Grid de 6 semanas, navegacion mes anterior/siguiente, modal unico alta+
edicion (regla 13) con bloque de alcance y de recurrencia, modal de
confirmacion de borrado. Link nuevo en el Sidebar.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AGjjFjoqQ1gmLwoZsox6Lw"
```

---

## Task 9: UI de calendario — árbol MAESTRO

**Files:**
- Create: `App/frontend/src/app/maestro/calendario/mes-grid.util.ts` (copia de Task 8,
  Step 1, verbatim — regla 11)
- Create: `App/frontend/src/app/maestro/calendario/EventoModal.tsx`
- Create: `App/frontend/src/app/maestro/calendario/ConfirmarEliminarEventoModal.tsx`
- Create: `App/frontend/src/app/maestro/calendario/page.tsx`
- Modify: `App/frontend/src/components/maestro/ui/shell/Header.tsx`
- Modify: `App/frontend/src/components/maestro/ui/shell/icons.tsx` (si falta el ícono)

**Interfaces:**
- Consumes: mismo `@/lib/api/calendario` que Task 8.
- Produces: página `/maestro/calendario` — mismo comportamiento que admin, con 2
  diferencias: (1) el bloque de alcance del modal SOLO ofrece `GRUPO`, y el `<select>`
  dependiente solo lista los grupos donde el maestro tiene asignación
  (`GET /perfil/asignaciones`, ya existe desde Fase 12 — reusar `obtenerMisAsignaciones()`
  de `lib/api/perfil.ts` para sacar la lista de grupos, aplanando
  `GrupoConMaterias[].grupoId`/`.nombre`, sin duplicados); (2) "Editar"/"Eliminar" en un
  chip del grid solo aparecen si el maestro es el autor del evento (`GET /eventos` no
  expone `autorUsuarioId` hoy — si hace falta para esta comparación, ver la nota de
  abajo).

> **Nota importante:** `OcurrenciaEvento` (Task 3) NO incluye `autorUsuarioId`. Si Task 8
> resolvió la edición pasando el evento completo desde el estado local en vez de un `GET
> /eventos/:id` nuevo, ese objeto completo SÍ trae `autorUsuarioId` — usa ese mismo dato
> para decidir si mostrar "Editar"/"Eliminar" en el chip. Si en cambio hiciste falta un
> `GET /eventos/:id` en Task 8, repite esa misma decisión acá para consistencia. En
> cualquier caso, el backend (`CalendarioService.obtenerPropioODeSede`, Task 3) ya
> rechaza con 403 a un maestro no-autor que intente `PATCH`/`DELETE` — ocultar el botón en
> el maestro NO-autor es solo UX, no la capa de seguridad real.

- [ ] **Step 1: Copiar `mes-grid.util.ts` de admin, sin cambios**

Create `App/frontend/src/app/maestro/calendario/mes-grid.util.ts` — contenido idéntico al
de Task 8 Step 1 (regla 11: cada árbol es dueño de su propia copia).

- [ ] **Step 2: Escribir `EventoModal.tsx` para maestro**

Mismo patrón que Task 8 Step 2, con las 2 diferencias de alcance descritas arriba: el
`<select>` de `alcanceTipo` para maestro no muestra SEDE/CARRERA como opciones (fijo a
GRUPO — puede ser un campo oculto en vez de un `<select>` de una sola opción), y el
`<select>` de grupo se alimenta de `obtenerMisAsignaciones()` en vez de
`listarGrupos()`.

- [ ] **Step 3: Escribir `ConfirmarEliminarEventoModal.tsx` para maestro**

Copia del patrón de Task 8 Step 3, adaptada a los tokens de color reales del árbol
maestro (verificar con `grep -rn "bg-crimson\|text-slate" App/frontend/src/components/maestro/`
antes de asumir que son los mismos que admin).

- [ ] **Step 4: Escribir `page.tsx` para maestro**

Mismo comportamiento que Task 8 Step 4, con el botón "+ Nuevo evento" siempre
disponible (un maestro siempre puede crear en alguno de sus grupos, aunque tenga que
elegir cuál en el modal) y sin necesidad de exponer el filtro de rol en la query — el
backend ya filtra `GET /eventos` según el JWT del maestro.

- [ ] **Step 5: Agregar el nav a `Header.tsx`**

Modify `App/frontend/src/components/maestro/ui/shell/Header.tsx` — leer el archivo
completo primero para ver dónde vive `SedeBadge`/`NotificacionesBell`/`ProfileDropdown`.
Agregar, ANTES de ese grupo (o donde visualmente quede mejor sin romper el layout
existente — usar tu criterio, pero mantener `NotificacionesBell`/`ProfileDropdown` como
el bloque final de la derecha), una navegación simple con 2 links usando `usePathname()`
(mismo criterio de estado activo que `Sidebar.tsx` de admin, `NavLink`):

```tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
// ...
function NavMaestro() {
  const pathname = usePathname();
  const enCalendario = pathname.startsWith('/maestro/calendario');
  return (
    <nav className="flex items-center gap-4 text-sm font-medium">
      <Link
        href="/maestro"
        aria-current={!enCalendario ? 'page' : undefined}
        className={!enCalendario ? 'text-navy' : 'text-slate/60 hover:text-navy'}
      >
        Mi perfil
      </Link>
      <Link
        href="/maestro/calendario"
        aria-current={enCalendario ? 'page' : undefined}
        className={enCalendario ? 'text-navy' : 'text-slate/60 hover:text-navy'}
      >
        Calendario
      </Link>
    </nav>
  );
}
```

(Ajustar clases/tokens exactos a lo que ya use `Header.tsx` — esto es la lógica de
navegación, no el pixel-perfect final; si `Header.tsx` usa otro esquema de tokens,
seguir ese, no inventar uno nuevo.)

- [ ] **Step 6: Verificar build y lint**

Run: `cd App/frontend && npx tsc --noEmit && npx eslint "src/app/maestro/calendario/**/*.tsx" "src/components/maestro/ui/shell/**/*.tsx"`
Expected: sin errores.

- [ ] **Step 7: Build de producción**

Run: `cd App/frontend && pnpm build`
Expected: build exitoso, ruta `/maestro/calendario` listada.

- [ ] **Step 8: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/frontend/src/app/maestro/calendario/ App/frontend/src/components/maestro/ui/shell/
git commit -m "feat(maestro): vista mensual de calendario + alta/edicion/borrado (Fase 15, Dia 43)

Mismo patron que admin (commit anterior), regla 11 - copia propia del
grid y de los modales. Alcance limitado a GRUPO, solo los grupos donde
el maestro tiene asignacion (GrupoMateriaMaestro). Nav nuevo en el
Header: Mi perfil / Calendario.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AGjjFjoqQ1gmLwoZsox6Lw"
```

---

## Task 10: UI de calendario — árbol ALUMNO (solo lectura)

**Files:**
- Create: `App/frontend/src/app/alumno/calendario/mes-grid.util.ts` (copia verbatim)
- Create: `App/frontend/src/app/alumno/calendario/DetalleEventoModal.tsx`
- Create: `App/frontend/src/app/alumno/calendario/page.tsx`
- Modify: `App/frontend/src/components/alumno/ui/shell/Header.tsx`
- Modify: `App/frontend/src/components/alumno/ui/shell/icons.tsx` (si falta el ícono)

**Interfaces:**
- Consumes: `listarEventos` de `@/lib/api/calendario` (sin `crearEvento`/
  `actualizarEvento`/`eliminarEvento` — el alumno nunca los llama).
- Produces: página `/alumno/calendario` de solo lectura + modal de detalle.

- [ ] **Step 1: Copiar `mes-grid.util.ts`**

Create `App/frontend/src/app/alumno/calendario/mes-grid.util.ts` — idéntico a Task 8.

- [ ] **Step 2: Escribir `DetalleEventoModal.tsx`**

Modal simple, sin `useMutation` (nada que guardar): recibe una `OcurrenciaEvento`,
muestra `titulo`, `descripcion`, `fecha` formateada, `horaInicio` (o "Todo el día" si es
`null`), `fechaFin` (si existe, "hasta: X"), `categoria` (con el mismo color que el
chip del grid), botón "Cerrar" únicamente.

- [ ] **Step 3: Escribir `page.tsx`**

Mismo patrón de grid/navegación de mes que Task 8, SIN botón "+ Nuevo evento" y SIN
acciones de editar/eliminar en los chips — click en un chip abre `DetalleEventoModal` en
modo lectura.

- [ ] **Step 4: Agregar el nav a `Header.tsx`**

Modify `App/frontend/src/components/alumno/ui/shell/Header.tsx` — mismo patrón que Task
9 Step 5, pero con `usePathname().startsWith('/alumno/calendario')` y el link "Mi
perfil" apuntando a `/alumno`. Verificar dónde vive `SedeCarreraBadge` en este Header
antes de decidir el orden visual final.

- [ ] **Step 5: Verificar build y lint**

Run: `cd App/frontend && npx tsc --noEmit && npx eslint "src/app/alumno/calendario/**/*.tsx" "src/components/alumno/ui/shell/**/*.tsx"`
Expected: sin errores.

- [ ] **Step 6: Build de producción + verificación final**

Run: `cd App/frontend && pnpm build`
Expected: build exitoso, las 3 rutas de calendario listadas (`/admin/calendario`,
`/maestro/calendario`, `/alumno/calendario`).

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/frontend/src/app/alumno/calendario/ App/frontend/src/components/alumno/ui/shell/
git commit -m "feat(alumno): vista mensual de calendario solo lectura (Fase 15, Dia 44)

Mismo patron de grid que admin/maestro (regla 11 - copia propia), sin
alta/edicion/borrado. Click en un evento abre un modal de detalle. Nav
nuevo en el Header: Mi perfil / Calendario. Cierra la Fase 15 en codigo
- verificacion manual en navegador pendiente.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AGjjFjoqQ1gmLwoZsox6Lw"
```

---

## Cierre de fase (después de la revisión final + verificación)

- [ ] Revisión final de rama (más capaz disponible) sobre el diff completo de la Fase 15.
- [ ] Verificación manual en navegador — igual que Fase 14: insertar eventos de prueba
  respetando la regla 14 (máx. 3 escrituras), o usar la propia UI de admin/maestro para
  crear los eventos de prueba (eso NO cuenta como "escritura manual a la DB", es usar el
  producto — el límite de 3 aplica a inserts directos vía Prisma/SQL para verificar algo,
  no al flujo normal de la app). Confirmar: alta de evento simple y recurrente, filtrado
  correcto por rol/alcance en los 3 árboles, edición, borrado, vista de solo-lectura del
  alumno.
- [ ] Marcar los checkboxes de Días 40-44 en `documentacion_de_agentes/ESTADO.md`.
- [ ] Documentar en `CLAUDE.md` raíz (sección "Contrato de API"): las 4 rutas de
  `/eventos` + `POST /internal/recordatorios/ejecutar`; en "CRUD por tipo de entidad"
  agregar `EventoCalendario` a "CRUD completo" (tiene DELETE real) y `RecordatorioEnviado`
  a "Negocio (no CRUD)". Env vars nuevas: `INTERNAL_JOB_SECRET`,
  `RECORDATORIOS_HABILITADO`.
- [ ] `roadmap.md`: tachar **Fase 15** como COMPLETA solo después de la verificación
  manual — mismo criterio que Fase 14.
- [ ] Recordar al usuario que **la configuración real de `pg_cron`/`pg_net`
  (`docs/setup-backend-recordatorios-cron.md`) sigue pendiente** — es deliberadamente
  manual, no se ejecuta como parte de este plan. Sin eso, `RECORDATORIOS_HABILITADO=true`
  no tiene ningún disparador real y el job nunca corre solo.
- [ ] Migración `_calendario` se suma a las pendientes de correr en prod (art. 53 +
  `grupo_materia_maestro` + `notificaciones` + `notificaciones_cascade_e_indice`, ya
  pendientes desde antes).

## Self-Review (hecho al escribir el plan)

- **Spec coverage:** Día 40 (modelo+RLS → Task 1; motor de recurrencia → Task 2). Día 41
  (helpers + CRUD → Task 3; e2e → Task 4). Día 42 (job + endpoint interno → Task 5; e2e →
  Task 6). Día 43 (`lib/api` → Task 7; UI admin → Task 8; UI maestro → Task 9). Día 44 (UI
  alumno → Task 10). Sin gaps frente a la sección "FASE 15" del spec de diseño.
- **Placeholder scan:** sin "TBD"/"TODO". Los 2 puntos marcados explícitamente como
  decisión-a-verificar-en-el-momento (nombre real de `apiFetchAuth`, si `GET
  /eventos/:id` hace falta para edición) son ambigüedades reales del código existente
  que el implementador debe resolver leyendo el archivo real, no huecos del plan — mismo
  patrón que usó el plan de Fase 14 con `apiFetchAuthPaginado`.
- **Type consistency:** `ReglaRecurrencia` (backend `recurrencia.util.ts` / DTO
  `regla-recurrencia.dto.ts`) ↔ `ReglaRecurrencia` (frontend `lib/api/calendario.ts`) —
  mismos 4 campos. `OcurrenciaEvento` (backend `calendario.service.ts` / frontend
  `lib/api/calendario.ts`) — mismos 9 campos, fechas como `string` ISO en ambos lados
  tras la serialización JSON. `AlcanceDestino`/`CategoriaEvento` — mismos valores en
  Prisma enum, DTO, y tipos de frontend.
- **Decisión explícita del usuario incorporada:** ruta propia en los 3 árboles (no
  sección apilada) — reflejada en el File Structure y en Tasks 8-10, con la corrección
  correspondiente al spec de diseño documentada en Global Constraints.
