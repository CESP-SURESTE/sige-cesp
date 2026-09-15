# Pulido de Calendario + Eventos en el dashboard de admin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolver los 4 puntos que el usuario reportó tras la verificación manual de Fase 15 (Calendario): mensaje de error claro al guardar un evento, ocultar «Fecha de fin» cuando el evento se repite, notificación in-app al crear un evento + prender el job de recordatorios, y una sección «Eventos de la sede» con filtros en el dashboard `/admin`.

**Architecture:** Cambios acotados sobre código de Fase 15 ya existente. Items 1-2 son frontend puro sobre los 2 `EventoModal.tsx` (admin y maestro, archivos independientes — regla 11). Item 3a agrega un valor al enum `TipoNotificacion` + un efecto best-effort tras la transacción de `CalendarioService.crear` (mismo patrón que el correo de bienvenida). Item 3b es solo env vars. Item 4 es un endpoint de lectura nuevo (`GET /eventos/listado`, un row por evento base) + una sección en `app/admin/page.tsx`.

**Tech Stack:** NestJS + Prisma 6.x + PostgreSQL (Supabase) en backend; Next.js + React Query + Tailwind en frontend. `pnpm`. Tests e2e con Jest (`pnpm test:e2e`, wrapper `scripts/run-e2e.js` que fuerza `--runInBand`).

**Spec:** `docs/superpowers/specs/2026-09-02-calendario-polish-y-eventos-dashboard-design.md`

## Global Constraints

- **Rama:** se trabaja directo sobre `dev` (convención del proyecto, no es `main`). Working tree limpio al empezar.
- **Contrato de API** (CLAUDE.md): JSON camelCase, fechas ISO 8601 (`YYYY-MM-DD`), éxito `{ data: ... }` (+ `page`/`limit`/`total` en listas paginadas), error `{ error, code }`. NO se inventan códigos de error nuevos en este plan.
- **Regla 1:** nunca persistir lo calculable — `recurrenciaResumen`, `alcanceNombre`, `autorNombre` (item 4) se derivan al vuelo por request.
- **Regla 2:** doble capa RLS + Guard; el guard extrae `sede_id` del JWT, nunca de body/query/path.
- **Regla 11:** separación total admin/alumno en frontend, sin componentes compartidos entre árboles. `lib/api/*` sí es infra compartida legítima. Los 2 `EventoModal.tsx` son archivos independientes.
- **Regla 12:** todo catch/error handler loguea el error completo (`console.error` o logger equivalente) antes de responder, backend y frontend.
- **Regla 14:** máximo 3 escrituras manuales a la DB real al verificar algo antes de un veredicto. La suite Jest no cuenta.
- **`prisma migrate dev` está roto** en este repo (`P3006` shadow-DB). La migración del item 3a se genera con `prisma migrate diff` + se aplica con `prisma migrate deploy` (mismo camino que `grupo_materia_maestro`).
- **Sin dependencias nuevas.**
- **Tests:** cada tarea deja la suite e2e del backend en verde (hoy 25 suites / 344 tests — el total de tests puede subir, ninguna suite baja ni se pone roja) y `tsc` + `eslint` + `pnpm build` limpios en backend y en los árboles de frontend tocados. Archivos en LF (el repo tiene CRLF preexistente en ~7 specs de backend ajenos — no heredarlo, no corregirlo acá).
- **Commits:** en español. Terminar cada mensaje con:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019Na1uJCczMwBVpzcCzFN7a
  ```
- **No push.** No tocar `docs/roadmap.md` ni la línea "Fase actual" de `CLAUDE.md` (esto no es una fase del roadmap).

---

## Task 1: Backend — mensajes de error de fechas en español natural

**Files:**
- Modify: `App/backend/src/calendario/calendario.service.ts` — método `crear` (~líneas 241-265) y método `actualizar` (~líneas 515-543); 3 strings de `error` en cada uno (6 en total).
- Test: `App/backend/test/calendario.e2e-spec.ts` — actualizar los asserts que comparan contra los strings viejos.

**Interfaces:**
- Consumes: nada de tareas previas.
- Produces: mensajes de error nuevos que las Tareas 2 y 3 (frontend) mencionan como el fallback del backend, pero no dependen del texto exacto.

**Contexto:** el backend YA rechaza fechas cruzadas con `400 VALIDATION_ERROR`, y el frontend YA muestra `err.message` en el toast cuando `err.code === 'VALIDATION_ERROR'`. El único problema es que el texto usa nombres de campo crudos. Solo se cambia el string del campo `error`; `code`, HTTP status y toda la lógica quedan idénticos.

- [ ] **Step 1: Localizar los 6 `BadRequestException`**

En `calendario.service.ts`, `crear` y `actualizar` tienen cada uno estas 3 excepciones con estos textos actuales:
- `'recurrenciaHasta es requerido cuando recurrenciaRegla está presente'`
- `'recurrenciaHasta no puede ser anterior a fechaInicio'`
- `'fechaFin no puede ser anterior a fechaInicio'`

- [ ] **Step 2: Reemplazar los textos (los 6, mismos 3 pares en ambos métodos)**

| Antes | Después |
|---|---|
| `recurrenciaHasta es requerido cuando recurrenciaRegla está presente` | `Falta indicar hasta qué fecha se repite el evento.` |
| `recurrenciaHasta no puede ser anterior a fechaInicio` | `La fecha hasta la que se repite el evento no puede ser anterior a su fecha de inicio.` |
| `fechaFin no puede ser anterior a fechaInicio` | `La fecha de fin no puede ser anterior a la fecha de inicio del evento.` |

No cambiar `code: 'VALIDATION_ERROR'` ni nada más de esos bloques.

- [ ] **Step 3: Actualizar los asserts e2e**

En `calendario.e2e-spec.ts`, buscar (`grep -n "anterior a fechaInicio\|requerido cuando recurrenciaRegla"`) y reemplazar cada expectativa de string por el texto nuevo correspondiente. Si algún assert solo verifica `code`/`statusCode`, dejarlo.

- [ ] **Step 4: Correr los tests**

Run: `cd App/backend && pnpm test:e2e -- calendario`
Expected: PASS. Luego la suite completa: `pnpm test:e2e` → 25 suites en verde (mismo count de tests).

- [ ] **Step 5: Typecheck + lint**

Run: `cd App/backend && pnpm exec tsc --noEmit && pnpm exec eslint src/calendario/calendario.service.ts test/calendario.e2e-spec.ts`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add App/backend/src/calendario/calendario.service.ts App/backend/test/calendario.e2e-spec.ts
git commit -m "fix(backend): mensajes de error de fechas de evento en español natural"
```

---

## Task 2: Frontend admin — validación de fechas en cliente + ocultar «Fecha de fin» con recurrencia

**Files:**
- Modify: `App/frontend/src/app/admin/calendario/EventoModal.tsx`
  - `handleSubmit` (~líneas 331-348) — agregar validación de fechas antes de `construirPayload*`.
  - Campo «Fecha de fin» (~líneas 407-419) — render condicional.
  - `onChange` del checkbox «Se repite» (~línea 537) — limpiar `fechaFin`.
  - `construirPayloadAlta` (~línea 218) y `construirPayloadEdicion` (~línea 252) — no enviar `fechaFin` con recurrencia.

**Interfaces:**
- Consumes: `toast` de `sonner` (ya importado), `FormEvento`, `construirPayloadAlta`, `construirPayloadEdicion` (ya definidos en el archivo).
- Produces: nada que otra tarea consuma (Task 3 hace el mismo cambio en el archivo del maestro, independiente).

- [ ] **Step 1: Agregar helper de validación de fechas**

Encima de `handleSubmit`, agregar función pura:

```tsx
/** Devuelve el mensaje de error de fechas cruzadas, o null si están OK.
 * Comparación de strings YYYY-MM-DD (lexicográfica = cronológica). */
function validarFechasCruzadas(form: FormEvento): string | null {
  if (form.fechaInicio && form.fechaFin && form.fechaFin < form.fechaInicio) {
    return 'La fecha de fin no puede ser anterior a la fecha de inicio.';
  }
  if (
    form.seRepite &&
    form.fechaInicio &&
    form.recurrenciaHasta &&
    form.recurrenciaHasta < form.fechaInicio
  ) {
    return 'La fecha de «repetir hasta» no puede ser anterior a la fecha de inicio.';
  }
  return null;
}
```

- [ ] **Step 2: Llamar el helper al inicio de `handleSubmit`**

Justo después de `e.preventDefault();`:

```tsx
const errorFechas = validarFechasCruzadas(form);
if (errorFechas) {
  toast.error(errorFechas);
  return;
}
```

- [ ] **Step 3: Ocultar «Fecha de fin» cuando el evento se repite**

El `<div>` que contiene el `<label htmlFor="evento-modal-fecha-fin">` + su `<input>` se envuelve para renderizar solo si NO hay recurrencia activa. La condición: mostrar cuando `recurrenciaEditable && !form.seRepite` (con `recurrenciaEditable = esAlta || !evento.esRecurrente`, ya definido). Cuando se oculta, el `<div>` hermano de «Fecha» (inicio) puede quedar en su media-columna; cambio visual mínimo, no reflowear el grid.

```tsx
{recurrenciaEditable && !form.seRepite && (
  <div>
    <label htmlFor="evento-modal-fecha-fin" className={LABEL_CLASS}>
      Fecha de fin (opcional)
    </label>
    <input
      id="evento-modal-fecha-fin"
      type="date"
      disabled={guardando}
      className={INPUT_CLASS}
      value={form.fechaFin}
      onChange={(e) => setForm((f) => ({ ...f, fechaFin: e.target.value }))}
    />
  </div>
)}
```

- [ ] **Step 4: Limpiar `fechaFin` al marcar «Se repite»**

En el `onChange` del checkbox «Se repite» (hoy: `onChange={(e) => setForm((f) => ({ ...f, seRepite: e.target.checked }))}`):

```tsx
onChange={(e) =>
  setForm((f) => ({
    ...f,
    seRepite: e.target.checked,
    fechaFin: e.target.checked ? '' : f.fechaFin,
  }))
}
```

- [ ] **Step 5: No enviar `fechaFin` con recurrencia en los payloads**

En `construirPayloadAlta`, la línea `if (form.fechaFin) payload.fechaFin = form.fechaFin;` pasa a `if (form.fechaFin && !form.seRepite) payload.fechaFin = form.fechaFin;`.

En `construirPayloadEdicion`, la línea `fechaFin: form.fechaFin || null,` pasa a:
```tsx
// Con recurrencia, `fechaFin` no aplica (recurrenciaHasta es el fin real de
// la serie); se manda null para borrar una que hubiera quedado de antes.
// En edición de un recurrente ya existente `recurrenciaEditable` es false y
// el bloque «Se repite» no se muestra: ahí `form.seRepite` es false y este
// ternario cae en `form.fechaFin || null` — que reenvía el valor real del
// form (cargado desde `formDesdeOcurrencia`), sin cambio.
fechaFin: form.seRepite ? null : form.fechaFin || null,
```

- [ ] **Step 6: Verificar en el navegador (manual, dev ya corriendo)**

Con `/admin/calendario` abierto: (a) crear evento `fechaInicio` 2026-10-03 / `fechaFin` 2026-10-01 → toast en español ANTES de enviar; (b) marcar «Se repite» → «Fecha de fin» desaparece; (c) desmarcar → reaparece vacía; (d) crear un evento recurrente normal → OK.

- [ ] **Step 7: Build + lint del frontend**

Run: `cd App/frontend && pnpm exec tsc --noEmit && pnpm lint && pnpm build`
Expected: sin errores; las 26 rutas compilan.

- [ ] **Step 8: Commit**

```bash
git add App/frontend/src/app/admin/calendario/EventoModal.tsx
git commit -m "fix(frontend): valida fechas cruzadas en cliente y oculta fechaFin con recurrencia (admin)"
```

---

## Task 3: Frontend maestro — mismo cambio que Task 2 en el modal del maestro

**Files:**
- Modify: `App/frontend/src/app/maestro/calendario/EventoModal.tsx` — archivo independiente del de admin (regla 11), estructura calcada. Referencias de línea: `recurrenciaEditable` ~347, `handleSubmit` ~376, campo «Fecha de fin» ~452-464, checkbox «Se repite» `onChange` ~567, `construirPayloadAlta` ~264 (línea `if (form.fechaFin) payload.fechaFin = form.fechaFin;` ~278), `construirPayloadEdicion` ~290 (línea `fechaFin: form.fechaFin || null,` ~309).

**Interfaces:**
- Consumes: mismos símbolos locales que Task 2 (`toast`, `FormEvento`, `construirPayload*`), definidos en este archivo.
- Produces: nada.

- [ ] **Step 1: Aplicar los mismos 5 cambios de la Task 2, steps 1-5**

Repetir en este archivo, con el mismo código:
1. Agregar `validarFechasCruzadas(form)` encima de `handleSubmit` (idéntico al de Task 2).
2. Llamarlo al inicio de `handleSubmit` tras `e.preventDefault();` (idéntico).
3. Envolver el `<div>` de «Fecha de fin» en `{recurrenciaEditable && !form.seRepite && ( ... )}` (mismo JSX, `id`/`className` iguales).
4. En el `onChange` del checkbox «Se repite», agregar `fechaFin: e.target.checked ? '' : f.fechaFin`.
5. `construirPayloadAlta`: `if (form.fechaFin && !form.seRepite) payload.fechaFin = form.fechaFin;`. `construirPayloadEdicion`: `fechaFin: form.seRepite ? null : form.fechaFin || null,` con el mismo comentario.

Confirmar leyendo el archivo que los nombres (`recurrenciaEditable`, `form.seRepite`, `form.recurrenciaHasta`) son idénticos; si algo difiere, adaptar el mínimo.

- [ ] **Step 2: Verificar en el navegador**

Con `/maestro/calendario` abierto (sesión de maestro): mismos 4 chequeos que Task 2 step 6, sobre un evento de alcance GRUPO del maestro.

- [ ] **Step 3: Build + lint**

Run: `cd App/frontend && pnpm exec tsc --noEmit && pnpm lint && pnpm build`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add App/frontend/src/app/maestro/calendario/EventoModal.tsx
git commit -m "fix(frontend): valida fechas cruzadas en cliente y oculta fechaFin con recurrencia (maestro)"
```

---

## Task 4: Backend — notificación in-app al crear un evento (`EVENTO_NUEVO`) + prender el job de recordatorios

**Files:**
- Modify: `App/backend/prisma/schema.prisma` — `enum TipoNotificacion` gana `EVENTO_NUEVO`.
- Create: `App/backend/prisma/migrations/<timestamp>_evento_nuevo_tipo_notificacion/migration.sql` — `ALTER TYPE`.
- Modify: `App/backend/src/calendario/calendario.service.ts` — método `crear`, agregar efecto best-effort tras la transacción; importar `resolverDestinatarios` de `../common/publicacion/alcance-publicacion.util` (revisar el path real de import que ya usa el service para `validarAlcancePublicacion`).
- Modify: `App/backend/.env` — `RECORDATORIOS_HABILITADO=true`.
- Modify: `App/backend/.env.example` — `RECORDATORIOS_HABILITADO=` con comentario.
- Test: `App/backend/test/calendario.e2e-spec.ts` — casos nuevos para las notificaciones de `POST /eventos`.

**Interfaces:**
- Consumes: `resolverDestinatarios(prisma: PrismaService, sedeId: string, alcanceTipo: AlcanceDestino, alcanceId: string | null): Promise<string[]>` (de `alcance-publicacion.util.ts` — solo `Usuario.activo: true`, sin duplicados). El `Actor` que ya recibe `crear` (`{ usuarioId, sedeId, rol }` — confirmar shape en el archivo).
- Produces: `TipoNotificacion` con valor `EVENTO_NUEVO` (Task 5 lo refleja en el frontend). `Notificacion` rows con `tipo: 'EVENTO_NUEVO'`, `referenciaId = evento.id`.

- [ ] **Step 1: Agregar el valor al enum**

En `schema.prisma`:
```prisma
enum TipoNotificacion {
  AVISO
  RECORDATORIO_EVENTO
  EVENTO_NUEVO
}
```

- [ ] **Step 2: Generar y aplicar la migración (sin `migrate dev`)**

```bash
cd App/backend
mkdir -p "prisma/migrations/$(date +%Y%m%d%H%M%S)_evento_nuevo_tipo_notificacion"
```
Crear el `migration.sql` dentro con:
```sql
ALTER TYPE "TipoNotificacion" ADD VALUE 'EVENTO_NUEVO';
```
Aplicar: `pnpm exec prisma migrate deploy`
Regenerar el client: `pnpm exec prisma generate`
Verificar: `pnpm exec prisma migrate status` sin migraciones pendientes contra la DB de dev.

- [ ] **Step 3: Escribir el caso e2e que falla (antes de tocar el service)**

En `calendario.e2e-spec.ts`, nuevo `describe('POST /eventos — notificación EVENTO_NUEVO')`:
- `beforeAll`/fixtures: una carrera, un grupo, 2 alumnos matriculados, 1 maestro asignado al grupo — todos en la sede del admin actor. Reusar los helpers `crear*` que ya tiene el spec.
- Test A: `POST /eventos` con `alcanceTipo: 'GRUPO'`, `alcanceId` del grupo, como el admin. Afirmar:
  - respuesta `201` con el shape de siempre (`data.id`, `data.titulo`, …) — SIN campo nuevo.
  - `prisma.notificacion.findMany({ where: { referenciaId: <evento.id>, tipo: 'EVENTO_NUEVO' } })` → una fila por cada uno de los 2 alumnos + el maestro (3), ninguna para el admin autor.
  - cada fila: `titulo` empieza con `'Nuevo evento: '`, `cuerpoCorto` no vacío, `sedeId` = sede del admin.
- Test B: `POST /eventos` con `alcanceTipo: 'GRUPO'` apuntando a un grupo SIN alumnos ni maestros → `201` y `notificacion.count({ where: { referenciaId: <evento.id> } })` === 0, sin que el request falle.
- `afterAll`: borrar por `id` acotado (eventos, notificaciones, auditoría, fixtures) — nunca por patrón de nombre/email (regla 14).

Run: `pnpm test:e2e -- calendario` → los casos nuevos FALLAN (no se crean notificaciones todavía).

- [ ] **Step 4: Implementar el efecto best-effort en `crear`**

Dentro de `crear`, DESPUÉS de que `this.prisma.$transaction(...)` retorna con éxito y ANTES del `return evento` (o envolviendo: capturar el `evento` de la transacción en una variable, correr el efecto, luego `return`). El bloque:

```ts
// Efecto best-effort: notificar in-app a los destinatarios del alcance.
// Un fallo acá NO tumba el alta (mismo criterio que el correo de
// bienvenida en PersonasService). Sin correo — eso es del job de
// recordatorios.
try {
  const destinatarios = (
    await resolverDestinatarios(
      this.prisma,
      actor.sedeId,
      evento.alcanceTipo,
      evento.alcanceId,
    )
  ).filter((usuarioId) => usuarioId !== actor.usuarioId);

  if (destinatarios.length > 0) {
    const alcanceLegible = await this.describirAlcance(
      evento.alcanceTipo,
      evento.alcanceId,
    );
    await this.prisma.notificacion.createMany({
      data: destinatarios.map((usuarioId) => ({
        usuarioId,
        sedeId: actor.sedeId,
        tipo: 'EVENTO_NUEVO' as const,
        referenciaId: evento.id,
        titulo: `Nuevo evento: ${evento.titulo}`,
        cuerpoCorto: `${aISO(evento.fechaInicio)} · ${alcanceLegible}`,
      })),
    });
  }
} catch (err) {
  console.error(
    `[CalendarioService.crear] fallo al crear notificaciones EVENTO_NUEVO para el evento ${evento.id}:`,
    err,
  );
}
```

Agregar el helper privado `describirAlcance`:
```ts
/** Texto legible del alcance para el cuerpo de la notificación. */
private async describirAlcance(
  alcanceTipo: AlcanceDestino,
  alcanceId: string | null,
): Promise<string> {
  if (alcanceTipo === 'SEDE' || !alcanceId) return 'Toda la sede';
  if (alcanceTipo === 'CARRERA') {
    const c = await this.prisma.carrera.findUnique({
      where: { id: alcanceId },
      select: { nombre: true },
    });
    return c ? `Carrera: ${c.nombre}` : 'Una carrera';
  }
  const g = await this.prisma.grupo.findUnique({
    where: { id: alcanceId },
    select: { nombre: true },
  });
  return g ? `Grupo: ${g.nombre}` : 'Un grupo';
}
```
Usar el helper `aISO` que ya existe en el archivo para formatear la fecha (confirmar el nombre real — el service ya lo usa en `listar`). `resolverDestinatarios` se importa del mismo módulo que `validarAlcancePublicacion`.

- [ ] **Step 5: Correr los tests**

Run: `cd App/backend && pnpm test:e2e -- calendario` → PASA incluyendo los casos nuevos.
Luego `pnpm test:e2e` → suite completa en verde, ninguna suite baja, total de tests +2 o más.

- [ ] **Step 6: Env vars**

En `App/backend/.env` agregar la línea:
```
RECORDATORIOS_HABILITADO=true
```
En `App/backend/.env.example` agregar:
```
# Job de recordatorios de calendario (POST /internal/recordatorios/ejecutar).
# Falla cerrado si vacío. Prod: disparo real vía pg_cron, ver docs/setup-backend-recordatorios-cron.md
RECORDATORIOS_HABILITADO=
```
Revisar `docs/setup-backend-recordatorios-cron.md`: si no menciona setear `RECORDATORIOS_HABILITADO=true` en prod, agregar esa línea al doc.

- [ ] **Step 7: Typecheck + lint**

Run: `cd App/backend && pnpm exec tsc --noEmit && pnpm exec eslint src/calendario/calendario.service.ts test/calendario.e2e-spec.ts`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add App/backend/prisma/schema.prisma App/backend/prisma/migrations App/backend/src/calendario/calendario.service.ts App/backend/.env.example App/backend/test/calendario.e2e-spec.ts docs/setup-backend-recordatorios-cron.md
git commit -m "feat(backend): notificación in-app EVENTO_NUEVO al crear evento + habilita job de recordatorios"
```
(`.env` está en `.gitignore` — NO se commitea; el cambio queda solo local, mencionarlo en el reporte.)

---

## Task 5: Frontend — `TipoNotificacion` suma `'EVENTO_NUEVO'`

**Files:**
- Modify: `App/frontend/src/lib/api/notificaciones.ts` — el union type `TipoNotificacion` (~línea 13).

**Interfaces:**
- Consumes: nada. Espejo manual del enum backend de la Task 4.
- Produces: `TipoNotificacion = 'AVISO' | 'RECORDATORIO_EVENTO' | 'EVENTO_NUEVO'` — las 3 campanas (`components/{admin,maestro,alumno}/ui/shell/NotificacionesBell.tsx`) ya consumen `titulo`/`cuerpoCorto` sin ramificar por tipo, así que no requieren cambios.

- [ ] **Step 1: Cambiar el union type**

```ts
export type TipoNotificacion = 'AVISO' | 'RECORDATORIO_EVENTO' | 'EVENTO_NUEVO';
```

- [ ] **Step 2: Confirmar que ninguna campana ramifica por `tipo`**

Run: `grep -rn "tipo" App/frontend/src/components/admin/ui/shell/NotificacionesBell.tsx App/frontend/src/components/maestro/ui/shell/NotificacionesBell.tsx App/frontend/src/components/alumno/ui/shell/NotificacionesBell.tsx`
Expected: solo aparece en imports/tipos, no en `switch`/`if` sobre valores. Si alguna ramifica y tiene un `default`, confirmar que `EVENTO_NUEVO` cae en un caso razonable; si no, no tocar nada.

- [ ] **Step 3: Build + lint de los 3 árboles**

Run: `cd App/frontend && pnpm exec tsc --noEmit && pnpm lint && pnpm build`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add App/frontend/src/lib/api/notificaciones.ts
git commit -m "feat(frontend): TipoNotificacion suma EVENTO_NUEVO"
```

---

## Task 6: Backend — `GET /eventos/listado` (un row por evento base, con filtros)

**Files:**
- Create: `App/backend/src/calendario/dto/listar-eventos-listado.query.dto.ts` — DTO de query.
- Modify: `App/backend/src/calendario/calendario.controller.ts` — agregar `@Get('listado')` con `@Roles(RolUsuario.ADMINISTRATIVO)`, ANTES del `@Get()` raíz (~línea 70).
- Modify: `App/backend/src/calendario/calendario.service.ts` — método `listarParaGestion` + helper puro `resumirRecurrencia`.
- Modify: `CLAUDE.md` — sección "Contrato de API", documentar `GET /eventos/listado`.
- Test: `App/backend/test/calendario.e2e-spec.ts` — bloque nuevo.

**Interfaces:**
- Consumes: `@SedeActual()`, `@Roles`, `RolUsuario` (ya en el controller). `AlcanceDestino`, `CategoriaEvento` de `@prisma/client`. Helper `aISO` del service.
- Produces:
  - Endpoint `GET /eventos/listado?desde=&hasta=&alcanceTipo=&categoria=&page=&limit=`.
  - `EventoListadoItem` (Task 7 lo consume en el frontend, espejo manual):
    ```ts
    {
      id: string; titulo: string; descripcion: string | null;
      fechaInicio: string;      // YYYY-MM-DD
      fechaFin: string | null;  // YYYY-MM-DD
      horaInicio: string | null; // HH:MM
      categoria: CategoriaEvento;
      alcanceTipo: AlcanceDestino;
      alcanceId: string | null;
      alcanceNombre: string;    // "Toda la sede" | nombre carrera | nombre grupo
      esRecurrente: boolean;
      recurrenciaResumen: string | null;
      recurrenciaHasta: string | null; // YYYY-MM-DD
      autorNombre: string;      // "Nombres ApellidoPaterno" | "—"
      createdAt: string;        // ISO datetime
    }
    ```
  - Respuesta: `200 { data: EventoListadoItem[], page, limit, total }`.

- [ ] **Step 1: DTO de query**

`listar-eventos-listado.query.dto.ts`:
```ts
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { AlcanceDestino, CategoriaEvento } from '@prisma/client';

const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export class ListarEventosListadoQueryDto {
  @IsOptional()
  @Matches(FECHA, { message: 'desde debe tener formato YYYY-MM-DD' })
  desde?: string;

  @IsOptional()
  @Matches(FECHA, { message: 'hasta debe tener formato YYYY-MM-DD' })
  hasta?: string;

  @IsOptional()
  @IsEnum(AlcanceDestino, { message: 'alcanceTipo inválido' })
  alcanceTipo?: AlcanceDestino;

  @IsOptional()
  @IsEnum(CategoriaEvento, { message: 'categoria inválida' })
  categoria?: CategoriaEvento;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page debe ser un entero' })
  @Min(1, { message: 'page debe ser >= 1' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit debe ser un entero' })
  @Min(1, { message: 'limit debe ser >= 1' })
  @Max(100, { message: 'limit no puede superar 100' })
  limit?: number;
}
```
Confirmar contra `listar-eventos.query.dto.ts` que el estilo de validación de `page`/`limit` matchea el resto de la app (ej. `GET /personas`, `GET /grupos`) — si esos usan otro patrón (`@Transform`, defaults en el service), alinearse a ese.

- [ ] **Step 2: Escribir los casos e2e que fallan**

Bloque `describe('GET /eventos/listado')` en `calendario.e2e-spec.ts`:
- Fixtures: sede del admin actor + una 2ª sede con su propio admin y 1 evento (para el test de aislamiento). En la sede del actor: 1 evento SEDE categoría `SOCIAL`, 1 evento CARRERA categoría `EXAMEN` (carrera con nombre conocido), 1 evento GRUPO recurrente semanal Lun/Mié con `recurrenciaHasta` (grupo con nombre conocido).
- Test A (base): admin lista sin filtros → `data` tiene los 3 eventos de su sede, NO el de la otra sede; shape `{ data, page, limit, total }`; `total === 3`.
- Test B (recurrencia + alcanceNombre): el item del evento GRUPO recurrente tiene `esRecurrente: true`, `recurrenciaResumen` que contiene `'semana'` y los días, `recurrenciaHasta` con la fecha, `alcanceNombre` === nombre del grupo. El evento CARRERA tiene `alcanceNombre` === nombre de la carrera. El evento SEDE tiene `alcanceNombre === 'Toda la sede'` y `recurrenciaResumen === null`.
- Test C (filtro `alcanceTipo`): `?alcanceTipo=CARRERA` → solo el evento CARRERA.
- Test D (filtro `categoria`): `?categoria=EXAMEN` → solo el evento EXAMEN.
- Test E (paginación): `?limit=1&page=2` → `data.length === 1`, `page === 2`, `total === 3`.
- Test F (autorización): un maestro y un alumno → `403`.
- Test G (query inválida): `?limit=999` → `400 VALIDATION_ERROR`.
- `afterAll`: borrado por `id` acotado (regla 14).

Run: `pnpm test:e2e -- calendario` → los nuevos FALLAN (404, ruta no existe).

- [ ] **Step 3: Helper `resumirRecurrencia`**

En `calendario.service.ts`, función pura a nivel de módulo (o método privado estático):
```ts
const DIAS_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/** Texto legible de una `ReglaRecurrencia` + su `recurrenciaHasta`. Regla 1
 * (derivado al vuelo, nunca persistido). `null` si el evento no es recurrente. */
export function resumirRecurrencia(
  regla: ReglaRecurrencia | null,
  recurrenciaHasta: Date | null,
): string | null {
  if (!regla) return null;
  const cada = regla.intervalo > 1 ? `Cada ${regla.intervalo} ` : 'Cada ';
  let base: string;
  if (regla.frecuencia === 'DIARIA') {
    base = regla.intervalo > 1 ? `${cada}días` : 'Todos los días';
  } else if (regla.frecuencia === 'SEMANAL') {
    const dias = (regla.diasSemana ?? [])
      .slice()
      .sort((a, b) => a - b)
      .map((d) => DIAS_ES[d])
      .join(', ');
    base = `${cada}semana${regla.intervalo > 1 ? 's' : ''}${dias ? `: ${dias}` : ''}`;
  } else {
    base =
      regla.diaMes === -1
        ? `${cada}mes${regla.intervalo > 1 ? 'es' : ''}: último día`
        : `${cada}mes${regla.intervalo > 1 ? 'es' : ''}: día ${regla.diaMes}`;
  }
  return recurrenciaHasta ? `${base} — hasta ${aISO(recurrenciaHasta)}` : base;
}
```
Confirmar el tipo real `ReglaRecurrencia` que ya usa el service (nombres de campos `frecuencia`/`intervalo`/`diasSemana`/`diaMes`) y el nombre de `aISO`.

- [ ] **Step 4: Método `listarParaGestion` en el service**

```ts
async listarParaGestion(
  sedeId: string,
  filtros: {
    desde?: string; hasta?: string;
    alcanceTipo?: AlcanceDestino; categoria?: CategoriaEvento;
    page?: number; limit?: number;
  },
): Promise<{ data: EventoListadoItem[]; page: number; limit: number; total: number }> {
  const page = filtros.page ?? 1;
  const limit = filtros.limit ?? 20;

  const where: Prisma.EventoCalendarioWhereInput = { sedeId };
  if (filtros.alcanceTipo) where.alcanceTipo = filtros.alcanceTipo;
  if (filtros.categoria) where.categoria = filtros.categoria;
  if (filtros.desde || filtros.hasta) {
    where.fechaInicio = {};
    if (filtros.desde) where.fechaInicio.gte = aFechaUTC(filtros.desde);
    if (filtros.hasta) where.fechaInicio.lte = aFechaUTC(filtros.hasta);
  }

  const [total, eventos] = await this.prisma.$transaction([
    this.prisma.eventoCalendario.count({ where }),
    this.prisma.eventoCalendario.findMany({
      where,
      orderBy: [{ fechaInicio: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  // Resolver alcanceNombre y autorNombre sin N+1.
  const carreraIds = [...new Set(eventos.filter((e) => e.alcanceTipo === 'CARRERA' && e.alcanceId).map((e) => e.alcanceId!))];
  const grupoIds = [...new Set(eventos.filter((e) => e.alcanceTipo === 'GRUPO' && e.alcanceId).map((e) => e.alcanceId!))];
  const autorIds = [...new Set(eventos.map((e) => e.autorUsuarioId))];

  const [carreras, grupos, autores] = await Promise.all([
    carreraIds.length
      ? this.prisma.carrera.findMany({ where: { id: { in: carreraIds } }, select: { id: true, nombre: true } })
      : Promise.resolve([]),
    grupoIds.length
      ? this.prisma.grupo.findMany({ where: { id: { in: grupoIds } }, select: { id: true, nombre: true } })
      : Promise.resolve([]),
    this.prisma.usuario.findMany({
      where: { id: { in: autorIds } },
      select: {
        id: true,
        perfilAlumno: { select: { nombres: true, apellidoPaterno: true } },
        perfilMaestro: { select: { nombres: true, apellidoPaterno: true } },
        perfilAdministrativo: { select: { nombres: true, apellidoPaterno: true } },
      },
    }),
  ]);
  const carreraNombre = new Map(carreras.map((c) => [c.id, c.nombre]));
  const grupoNombre = new Map(grupos.map((g) => [g.id, g.nombre]));
  const autorNombre = new Map(
    autores.map((u) => {
      const p = u.perfilAlumno ?? u.perfilMaestro ?? u.perfilAdministrativo;
      return [u.id, p ? `${p.nombres} ${p.apellidoPaterno}` : '—'];
    }),
  );

  const data: EventoListadoItem[] = eventos.map((e) => ({
    id: e.id,
    titulo: e.titulo,
    descripcion: e.descripcion,
    fechaInicio: aISO(e.fechaInicio),
    fechaFin: e.fechaFin ? aISO(e.fechaFin) : null,
    horaInicio: e.horaInicio ?? null,
    categoria: e.categoria,
    alcanceTipo: e.alcanceTipo,
    alcanceId: e.alcanceId,
    alcanceNombre:
      e.alcanceTipo === 'SEDE' || !e.alcanceId
        ? 'Toda la sede'
        : e.alcanceTipo === 'CARRERA'
          ? (carreraNombre.get(e.alcanceId) ?? 'Una carrera')
          : (grupoNombre.get(e.alcanceId) ?? 'Un grupo'),
    esRecurrente: e.recurrenciaRegla !== null,
    recurrenciaResumen: resumirRecurrencia(
      e.recurrenciaRegla as ReglaRecurrencia | null,
      e.recurrenciaHasta,
    ),
    recurrenciaHasta: e.recurrenciaHasta ? aISO(e.recurrenciaHasta) : null,
    autorNombre: autorNombre.get(e.autorUsuarioId) ?? '—',
    createdAt: e.createdAt.toISOString(),
  }));

  return { data, page, limit, total };
}
```
Confirmar: nombres reales de campos de `EventoCalendario` (`horaInicio` es `string?` o `DateTime?` — ajustar el map), el import de `Prisma` namespace, y que `perfilAlumno`/`perfilMaestro`/`perfilAdministrativo` son los nombres reales de las relaciones en `schema.prisma`.

- [ ] **Step 5: Endpoint en el controller**

Entre `@Post()` y `@Get()` (línea ~70):
```ts
@Get('listado')
@Roles(RolUsuario.ADMINISTRATIVO)
async listarParaGestion(
  @SedeActual() sedeId: string,
  @Query() query: ListarEventosListadoQueryDto,
) {
  const data = await this.calendarioService.listarParaGestion(sedeId, query);
  return data; // ya trae { data, page, limit, total }
}
```
Confirmar el patrón de retorno paginado del resto del controller (¿el controller envuelve en `{ data }` o el service ya devuelve la forma final? — mirar cómo lo hace `GET /personas` / `GET /grupos` y alinear; el shape final al cliente debe ser `{ data: [...], page, limit, total }`).

- [ ] **Step 6: Correr los tests**

Run: `cd App/backend && pnpm test:e2e -- calendario` → PASA todo el bloque nuevo.
Luego `pnpm test:e2e` → suite completa en verde.

- [ ] **Step 7: Documentar en `CLAUDE.md`**

En la sección "Contrato de API", después de los bullets de `POST/GET/PATCH/DELETE /eventos`, agregar un bullet para `GET /eventos/listado` (~80 cols, estilo del resto): guards (`SedeGuard`+`RolesGuard`, `@Roles(ADMINISTRATIVO)` a nivel de método), `sedeId` de `@SedeActual()`, query params, que devuelve **un row por evento base** (no ocurrencias, a diferencia de `GET /eventos`), sin el tope de 62 días, `recurrenciaResumen`/`alcanceNombre`/`autorNombre` derivados (regla 1), shape paginado estándar, sin código de error nuevo.

- [ ] **Step 8: Typecheck + lint**

Run: `cd App/backend && pnpm exec tsc --noEmit && pnpm exec eslint "src/calendario/**/*.ts" test/calendario.e2e-spec.ts`
Expected: sin errores.

- [ ] **Step 9: Commit**

```bash
git add App/backend/src/calendario CLAUDE.md App/backend/test/calendario.e2e-spec.ts
git commit -m "feat(backend): GET /eventos/listado — lista de eventos de la sede con filtros"
```

---

## Task 7: Frontend — sección «Eventos de la sede» en el dashboard `/admin`

**Files:**
- Modify: `App/frontend/src/lib/api/calendario.ts` — agregar `EventoListadoItem`, `FiltrosEventosListado`, `listarEventosSede`.
- Modify: `App/frontend/src/app/admin/page.tsx` — agregar `<SeccionEventosSede />` bajo `<ResumenDashboard>`.
- Puede requerir: `App/frontend/src/app/admin/calendario/colores.ts` (nuevo) si conviene extraer `COLOR_POR_CATEGORIA` para no importar desde `EventoModal.tsx` — opcional, decisión del implementador.

**Interfaces:**
- Consumes: `EventoListadoItem` (espejo del backend de Task 6), `apiFetchAuthPaginado`/`apiFetchAuth` de `lib/api/http`, `ApiError`, `useQuery` + `keepPreviousData`, `Select` de `components/admin/ui/persona-alta/Select`, `COLOR_POR_CATEGORIA` + `CATEGORIA_LABEL` (exportados de `app/admin/calendario/EventoModal.tsx`).
- Produces: nada que otra tarea consuma.

- [ ] **Step 1: Cliente de API**

En `lib/api/calendario.ts`:
```ts
export interface EventoListadoItem {
  id: string;
  titulo: string;
  descripcion: string | null;
  fechaInicio: string;
  fechaFin: string | null;
  horaInicio: string | null;
  categoria: CategoriaEvento;
  alcanceTipo: AlcanceDestino;
  alcanceId: string | null;
  alcanceNombre: string;
  esRecurrente: boolean;
  recurrenciaResumen: string | null;
  recurrenciaHasta: string | null;
  autorNombre: string;
  createdAt: string;
}

export interface FiltrosEventosListado {
  desde?: string;
  hasta?: string;
  alcanceTipo?: AlcanceDestino;
  categoria?: CategoriaEvento;
  page?: number;
  limit?: number;
}

export function listarEventosSede(
  filtros: FiltrosEventosListado,
): Promise<ApiListaPaginada<EventoListadoItem>> {
  const qs = new URLSearchParams();
  if (filtros.desde) qs.set('desde', filtros.desde);
  if (filtros.hasta) qs.set('hasta', filtros.hasta);
  if (filtros.alcanceTipo) qs.set('alcanceTipo', filtros.alcanceTipo);
  if (filtros.categoria) qs.set('categoria', filtros.categoria);
  qs.set('page', String(filtros.page ?? 1));
  qs.set('limit', String(filtros.limit ?? 20));
  return apiFetchAuthPaginado<EventoListadoItem>(`/eventos/listado?${qs.toString()}`);
}
```
Confirmar el nombre real del helper de fetch paginado (`apiFetchAuthPaginado` según `notificaciones.ts`) y el tipo `ApiListaPaginada`.

- [ ] **Step 2: Componente `SeccionEventosSede` en `page.tsx`**

Agregar al final de `page.tsx` (mismo archivo que `ResumenDashboard`, patrón ya usado):
- Estado local: `rango` (`'30' | '60' | '90' | 'todos'`, default `'30'`), `alcanceTipo` (`AlcanceDestino | ''`), `categoria` (`CategoriaEvento | ''`), `page` (default 1), `expandidoId` (`string | null`).
- `desde`/`hasta` derivados de `rango`: `desde = hoy` (ISO), `hasta = hoy + N días` para 30/60/90, `undefined` para `'todos'`. Helper `fechaISOhoy()` y suma de días con `Date` (sin librería).
- `useQuery({ queryKey: ['admin','eventos-sede', rango, alcanceTipo, categoria, page], queryFn: () => listarEventosSede({...}), placeholderData: keepPreviousData })` con `try/catch` + `console.error` (regla 12).
- Render:
  - `<h2>` «Eventos de la sede».
  - Fila de 3 `<Select>` (rango / alcance / categoría). Al cambiar cualquiera, `setPage(1)`.
  - Estados `isLoading` («Cargando…») / `isError` (`error instanceof ApiError ? error.message : genérico`, mismo patrón que el resto) / vacío («No hay eventos con estos filtros.»).
  - Lista: por cada `EventoListadoItem`, un `<button>` (row) que hace `setExpandidoId(id === expandidoId ? null : id)`:
    - Línea 1: `titulo` + chip de categoría (`COLOR_POR_CATEGORIA[categoria]`, texto `CATEGORIA_LABEL[categoria]`).
    - Línea 2 (texto chico, `text-slate/70`): `esRecurrente ? 'Recurrente · ' + recurrenciaResumen : fechaInicio` · `alcanceNombre` · `autorNombre`.
    - Si `expandidoId === id`: bloque expandido con `descripcion` (o «Sin descripción»), `horaInicio` (o «Todo el día»), `fechaFin`, `recurrenciaHasta`, `alcanceNombre` completo, `createdAt` formateado.
  - Paginación: «Anterior» / «Siguiente» + «Página {page} de {Math.ceil(total/limit)}», deshabilitar en los extremos. Mismo patrón que `app/admin/alumnos/page.tsx`.
- Formateo de fechas: si hay un helper de formato de fecha en `app/admin/` reusarlo; si no, `new Date(iso + 'T00:00:00').toLocaleDateString('es-MX')` para `YYYY-MM-DD` y `toLocaleString('es-MX')` para `createdAt`.

- [ ] **Step 3: Montar la sección**

En el `return` de `AdminHomePage`, después de `<ResumenDashboard resumen={resumen} />` (dentro del mismo contenedor `space-y-6`), agregar `<SeccionEventosSede />`. La sección se renderiza siempre (no depende de `resumen`).

- [ ] **Step 4: Verificar en el navegador**

`/admin` → aparece «Eventos de la sede» bajo los conteos. Crear un par de eventos en `/admin/calendario` (uno recurrente), volver a `/admin`: aparecen; los filtros funcionan; el click expande el detalle; la paginación cambia de página.

- [ ] **Step 5: Build + lint**

Run: `cd App/frontend && pnpm exec tsc --noEmit && pnpm lint && pnpm build`
Expected: sin errores; 26 rutas.

- [ ] **Step 6: Commit**

```bash
git add App/frontend/src/lib/api/calendario.ts App/frontend/src/app/admin/page.tsx App/frontend/src/app/admin/calendario/
git commit -m "feat(frontend): sección «Eventos de la sede» con filtros en el dashboard de admin"
```

---

## Self-Review (hecho al escribir el plan)

**1. Spec coverage:**
- Item 1 (mensaje de error): Task 1 (backend) + Task 2/3 (validación cliente). ✅
- Item 2 (fechaFin con recurrencia): Task 2 (admin) + Task 3 (maestro). ✅
- Item 3a (notificación al crear): Task 4 (backend) + Task 5 (tipo frontend). ✅
- Item 3b (prender job): Task 4 steps 6-7. ✅
- Item 4 (`GET /eventos/listado` + dashboard): Task 6 (backend) + Task 7 (frontend). ✅

**2. Placeholder scan:** los "confirmar contra el código real X" son verificaciones dirigidas con un valor por defecto concreto ya escrito, no placeholders de requisito. Sin "TBD"/"TODO"/"add error handling".

**3. Type consistency:** `EventoListadoItem` definido idéntico en Task 6 (Produces) y Task 7 (Step 1). `TipoNotificacion` con los 3 valores en Task 4 (schema) y Task 5 (union). `resolverDestinatarios(prisma, sedeId, alcanceTipo, alcanceId)` con la firma real verificada. `resumirRecurrencia(regla, recurrenciaHasta)` definido en Task 6, usado en el mismo método.

## Verificación manual final (a cargo del usuario)

- Evento `fechaFin` < `fechaInicio` → mensaje claro en español, antes de enviar (admin y maestro).
- Marcar «Se repite» → «Fecha de fin» desaparece; desmarcar → reaparece vacía.
- Crear evento de alcance GRUPO → alumnos/maestros del grupo ven el número en la campana al instante; el autor no.
- `curl -X POST http://localhost:3001/internal/recordatorios/ejecutar -H "X-Internal-Secret: <INTERNAL_JOB_SECRET del .env>"` → notificación `RECORDATORIO_EVENTO` para eventos dentro de 48h.
- Dashboard `/admin` → sección «Eventos de la sede»: filtros, acordeón con todos los detalles, un evento de otra sede no aparece.
