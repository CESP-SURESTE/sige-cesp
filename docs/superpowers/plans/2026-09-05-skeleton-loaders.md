# Skeleton loaders en pantallas con fetch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el `<p>Cargando…</p>` plano por skeletons (Tailwind `animate-pulse`, sin dependencia nueva) en las 22 pantallas reales de fetch, en los 4 árboles de frontend.

**Architecture:** Un primitivo `Skeleton.tsx` duplicado por árbol (regla 11 de `CLAUDE.md` raíz), con 5 formas compuestas (`SkeletonTableRows`, `SkeletonProfileCard`, `SkeletonStatTiles`, `SkeletonCalendarGrid`, `SkeletonLines`) montadas sobre un bloque base `SkeletonBlock` (`animate-pulse rounded bg-mist`). Cada árbol solo exporta las formas que sus propias pantallas usan.

**Tech Stack:** Next.js 16 + TypeScript + Tailwind (ya instalados). Sin paquete nuevo.

**Spec:** `docs/superpowers/specs/2026-09-05-skeleton-loaders-design.md`

## Global Constraints

- Sin dependencia nueva — solo Tailwind `animate-pulse` (regla del proyecto: no sumar
  dependencias si algo se resuelve con lo instalado).
- Regla 11 (`CLAUDE.md` raíz) — sin componentes compartidos entre árboles: el archivo
  `Skeleton.tsx` se duplica en cada árbol, sin import cruzado.
- `SkeletonTableRows` siempre se monta dentro del `<table>`/`<thead>` real — el header
  nunca se oculta durante la carga (3 sitios lo hacían hoy, se corrige de paso).
- Color del pulso: `bg-mist` (`--mist: #dce1ea`, ya en la paleta).
- Excluidos de este plan (decisión ya tomada en el spec, §3): el placeholder
  `"Cargando carreras…"` de `admin/alumnos/nuevo/page.tsx` y `"Cargando tus
  grupos…"` de `maestro/calendario/EventoModal.tsx` — quedan como texto, no se tocan.
- Cada task termina con `pnpm build` + `pnpm lint` limpios en `App/frontend/` antes de
  commitear.

---

### Task 1: Skeletons en `app/admin/*` (14 sitios en 12 archivos)

**Files:**
- Create: `App/frontend/src/components/admin/ui/Skeleton.tsx`
- Modify: `App/frontend/src/app/admin/alumnos/page.tsx`
- Modify: `App/frontend/src/app/admin/maestros/page.tsx`
- Modify: `App/frontend/src/app/admin/administrativos/page.tsx`
- Modify: `App/frontend/src/app/admin/carreras/page.tsx`
- Modify: `App/frontend/src/app/admin/grupos/page.tsx`
- Modify: `App/frontend/src/app/admin/salones/page.tsx`
- Modify: `App/frontend/src/app/admin/grupos/[id]/page.tsx`
- Modify: `App/frontend/src/app/admin/grupos/[id]/SeccionAsignaciones.tsx`
- Modify: `App/frontend/src/app/admin/perfil/page.tsx`
- Modify: `App/frontend/src/app/admin/calendario/page.tsx`
- Modify: `App/frontend/src/app/admin/carreras/SubirMallaModal.tsx`
- Modify: `App/frontend/src/app/admin/page.tsx`

**Interfaces:**
- Produces (importado por los 12 archivos de arriba desde
  `@/components/admin/ui/Skeleton`): `SkeletonTableRows({ columns: number, rows?: number })`,
  `SkeletonProfileCard({ sections?: number, fieldsPerSection?: number })`,
  `SkeletonStatTiles({ count?: number })`, `SkeletonCalendarGrid()`,
  `SkeletonLines({ count?: number })`. Ninguno de los 5 depende de nada fuera de este
  archivo.

- [ ] **Step 1: Crear el primitivo `components/admin/ui/Skeleton.tsx`**

```tsx
/**
 * Skeletons de carga para app/admin/* — Tailwind `animate-pulse`, sin
 * dependencia nueva. Ver docs/superpowers/specs/2026-09-05-skeleton-loaders-design.md.
 *
 * Regla 11 de CLAUDE.md raíz: este archivo se duplica a propósito en
 * components/alumno/ui/Skeleton.tsx, components/maestro/ui/Skeleton.tsx y
 * app/plataforma/Skeleton.tsx — sin import cruzado entre árboles.
 */

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-mist ${className}`} />;
}

/** Filas de skeleton para dentro de un <tbody> — el <table>/<thead> real
 * sigue montado, esto solo reemplaza el contenido del body mientras carga. */
export function SkeletonTableRows({
  columns,
  rows = 5,
}: {
  columns: number;
  rows?: number;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: columns }).map((_, c) => (
            <td key={c} className="px-4 py-3">
              <SkeletonBlock className="h-4 w-full max-w-40" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Card de perfil con `sections` bloques, cada uno con un título y
 * `fieldsPerSection` pares etiqueta/valor en grid — mismo patrón visual que
 * las secciones reales de app/admin/perfil/page.tsx. */
export function SkeletonProfileCard({
  sections = 2,
  fieldsPerSection = 4,
}: {
  sections?: number;
  fieldsPerSection?: number;
}) {
  return (
    <div className="mt-6 space-y-6">
      {Array.from({ length: sections }).map((_, s) => (
        <div key={s} className="rounded-lg border border-mist p-5">
          <SkeletonBlock className="h-4 w-32" />
          <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            {Array.from({ length: fieldsPerSection }).map((_, f) => (
              <div key={f}>
                <SkeletonBlock className="h-3 w-20" />
                <SkeletonBlock className="mt-2 h-4 w-36" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Fila de tiles de KPI (dashboard). */
export function SkeletonStatTiles({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border-l-4 border-mist bg-white p-4 shadow-sm">
          <SkeletonBlock className="h-7 w-12" />
          <SkeletonBlock className="mt-2 h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Grilla mensual — 6 semanas x 7 días = 42 celdas, calcado de
 * generarGridMensual()/rangoDelGrid() en app/admin/calendario/mes-grid.util.ts. */
export function SkeletonCalendarGrid() {
  return (
    <div className="mt-6 grid grid-cols-7 gap-2">
      {Array.from({ length: 42 }).map((_, i) => (
        <SkeletonBlock key={i} className="h-20 w-full" />
      ))}
    </div>
  );
}

/** Barras simples sueltas — para secciones chicas embebidas o estados de
 * carga de una sola línea (ej. un status corto dentro de un modal). */
export function SkeletonLines({ count = 3 }: { count?: number }) {
  return (
    <div className="mt-3 space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonBlock key={i} className="h-4 w-full max-w-sm" />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: `app/admin/alumnos/page.tsx` — tabla de 6 columnas, header hoy oculto durante la carga**

Import nuevo al inicio del archivo:
```tsx
import { SkeletonTableRows } from '@/components/admin/ui/Skeleton';
```

Reemplazar (línea ~89-91):
```tsx
      <div className="mt-6">
        {isLoading ? (
          <p className="text-sm text-slate/60">Cargando…</p>
        ) : isError ? (
```
por (el `<thead>` es el mismo que ya usa `TablaAlumnos` más abajo en el archivo —
copiar sus `<Th>` tal cual):
```tsx
      <div className="mt-6">
        {isLoading ? (
          <div className="overflow-x-auto rounded-lg border border-mist">
            <table className="min-w-full divide-y divide-mist text-sm">
              <thead className="bg-bone">
                <tr>
                  <Th>Nombre completo</Th>
                  <Th>Matrícula</Th>
                  <Th>Carrera</Th>
                  <Th>Semestre</Th>
                  <Th>Estatus académico</Th>
                  <Th>Cuenta</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mist">
                <SkeletonTableRows columns={6} />
              </tbody>
            </table>
          </div>
        ) : isError ? (
```

- [ ] **Step 3: `app/admin/maestros/page.tsx` — tabla de 5 columnas, mismo patrón**

Import nuevo:
```tsx
import { SkeletonTableRows } from '@/components/admin/ui/Skeleton';
```

Reemplazar (línea ~130-132):
```tsx
      <div className="mt-6">
        {isLoading ? (
          <p className="text-sm text-slate/60">Cargando…</p>
        ) : isError ? (
```
por:
```tsx
      <div className="mt-6">
        {isLoading ? (
          <div className="overflow-x-auto rounded-lg border border-mist">
            <table className="min-w-full divide-y divide-mist text-sm">
              <thead className="bg-bone">
                <tr>
                  <Th>Nombre completo</Th>
                  <Th>Cédula profesional</Th>
                  <Th>Estatus</Th>
                  <Th>Cuenta</Th>
                  <Th>Acciones</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mist">
                <SkeletonTableRows columns={5} />
              </tbody>
            </table>
          </div>
        ) : isError ? (
```

- [ ] **Step 4: `app/admin/administrativos/page.tsx` — tabla de 6 columnas, mismo patrón**

Import nuevo:
```tsx
import { SkeletonTableRows } from '@/components/admin/ui/Skeleton';
```

Reemplazar (línea ~187-189):
```tsx
      <div className="mt-6">
        {isLoading ? (
          <p className="text-sm text-slate/60">Cargando…</p>
        ) : isError ? (
```
por:
```tsx
      <div className="mt-6">
        {isLoading ? (
          <div className="overflow-x-auto rounded-lg border border-mist">
            <table className="min-w-full divide-y divide-mist text-sm">
              <thead className="bg-bone">
                <tr>
                  <Th>Nombre completo</Th>
                  <Th>Puesto</Th>
                  <Th>Nivel de permiso</Th>
                  <Th>Estatus</Th>
                  <Th>Cuenta</Th>
                  <Th>Acciones</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mist">
                <SkeletonTableRows columns={6} />
              </tbody>
            </table>
          </div>
        ) : isError ? (
```

- [ ] **Step 5: `app/admin/carreras/page.tsx` — el `<table>` ya está siempre montado, solo cambia el `<tbody>`**

Import nuevo:
```tsx
import { SkeletonTableRows } from '@/components/admin/ui/Skeleton';
```

Reemplazar (línea ~142-146, el `<tr>` completo del estado de carga dentro del `<tbody>`):
```tsx
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-slate/60">
                  Cargando…
                </td>
              </tr>
```
por:
```tsx
              <SkeletonTableRows columns={3} />
```

- [ ] **Step 6: `app/admin/grupos/page.tsx` — mismo patrón, 6 columnas**

Import nuevo:
```tsx
import { SkeletonTableRows } from '@/components/admin/ui/Skeleton';
```

Reemplazar el `<tr><td colSpan={6} ...>Cargando…</td></tr>` (línea ~325-329) por:
```tsx
              <SkeletonTableRows columns={6} />
```

- [ ] **Step 7: `app/admin/salones/page.tsx` — mismo patrón, 3 columnas**

Import nuevo:
```tsx
import { SkeletonTableRows } from '@/components/admin/ui/Skeleton';
```

Reemplazar el `<tr><td colSpan={3} ...>Cargando…</td></tr>` (línea ~149-153) por:
```tsx
              <SkeletonTableRows columns={3} />
```

- [ ] **Step 8: `app/admin/grupos/[id]/page.tsx` — 2 sitios: encabezado (línea 2 de texto) y tabla de matriculados (5 columnas)**

Import nuevo:
```tsx
import { SkeletonLines, SkeletonTableRows } from '@/components/admin/ui/Skeleton';
```

Encabezado — reemplazar (línea ~211-212):
```tsx
        {grupoQuery.isLoading || !grupo ? (
          <p className="mt-2 text-sm text-slate/60">Cargando…</p>
        ) : (
```
por:
```tsx
        {grupoQuery.isLoading || !grupo ? (
          <div className="mt-2">
            <SkeletonLines count={2} />
          </div>
        ) : (
```

Tabla de matriculados — el `<table>`/`<thead>` ya está siempre montado. Reemplazar el
bloque del `<tr>` de carga (línea ~326-335):
```tsx
              {alumnosQuery.isLoading && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-6 text-center text-slate/60"
                  >
                    Cargando…
                  </td>
                </tr>
              )}
```
por:
```tsx
              {alumnosQuery.isLoading && <SkeletonTableRows columns={5} />}
```

- [ ] **Step 9: `app/admin/grupos/[id]/SeccionAsignaciones.tsx` — lista chica embebida**

Import nuevo:
```tsx
import { SkeletonLines } from '@/components/admin/ui/Skeleton';
```

Reemplazar (línea ~201-205):
```tsx
      {(materiasQuery.isLoading ||
        asignacionesQuery.isLoading ||
        maestrosQuery.isLoading) && (
        <p className="mt-4 text-sm text-slate/60">Cargando…</p>
      )}
```
por:
```tsx
      {(materiasQuery.isLoading ||
        asignacionesQuery.isLoading ||
        maestrosQuery.isLoading) && <SkeletonLines count={3} />}
```

- [ ] **Step 10: `app/admin/perfil/page.tsx` — card de perfil, 3 secciones reales (Datos personales, Sede, Contactos — sin contar el bloque de Nivel de permiso, que tiene estilo propio distinto)**

Import nuevo:
```tsx
import { SkeletonProfileCard } from '@/components/admin/ui/Skeleton';
```

Reemplazar (línea ~55-62, el bloque `if (isLoading)` completo):
```tsx
  if (isLoading) {
    return (
      <div className="max-w-3xl rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-navy">Mi perfil</h1>
        <p className="mt-4 text-sm text-slate/60">Cargando…</p>
      </div>
    );
  }
```
por:
```tsx
  if (isLoading) {
    return (
      <div className="max-w-3xl rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-navy">Mi perfil</h1>
        <SkeletonProfileCard sections={3} fieldsPerSection={4} />
      </div>
    );
  }
```

- [ ] **Step 11: `app/admin/calendario/page.tsx` — grilla mensual**

Import nuevo:
```tsx
import { SkeletonCalendarGrid } from '@/components/admin/ui/Skeleton';
```

Reemplazar (línea ~223-225):
```tsx
        {eventosQuery.isLoading && (
          <p className="mt-6 py-6 text-center text-sm text-slate/60">Cargando…</p>
        )}
```
por:
```tsx
        {eventosQuery.isLoading && <SkeletonCalendarGrid />}
```

- [ ] **Step 12: `app/admin/carreras/SubirMallaModal.tsx` — status de una línea**

Import nuevo:
```tsx
import { SkeletonLines } from '@/components/admin/ui/Skeleton';
```

Reemplazar (línea ~189-191):
```tsx
            {mallaQuery.isLoading && (
              <p className="mt-4 text-sm text-slate/60">Cargando…</p>
            )}
```
por:
```tsx
            {mallaQuery.isLoading && <SkeletonLines count={1} />}
```

- [ ] **Step 13: `app/admin/page.tsx` — 2 sitios independientes: resumen (KPIs + 2 listas) y eventos de la sede (lista)**

Import nuevo:
```tsx
import {
  SkeletonLines,
  SkeletonStatTiles,
} from '@/components/admin/ui/Skeleton';
```

Bloque de resumen — reemplazar (línea ~58-59, dentro de `AdminHomePage`):
```tsx
      {isLoading ? (
        <p className="text-sm text-slate/60">Cargando…</p>
      ) : isError ? (
```
por (mismo layout que `ResumenDashboard`: fila de 4 tiles + 2 columnas de listas):
```tsx
      {isLoading ? (
        <div className="space-y-6">
          <SkeletonStatTiles count={4} />
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-lg border-l-4 border-navy bg-white p-4 shadow-sm">
              <SkeletonLines count={4} />
            </div>
            <div className="rounded-lg border-l-4 border-navy bg-white p-4 shadow-sm">
              <SkeletonLines count={4} />
            </div>
          </div>
        </div>
      ) : isError ? (
```

Bloque de eventos de la sede — reemplazar (línea ~335-337, dentro de `SeccionEventosSede`):
```tsx
      <div className="mt-4">
        {isLoading ? (
          <p className="text-sm text-slate/60">Cargando…</p>
        ) : isError ? (
```
por:
```tsx
      <div className="mt-4">
        {isLoading ? (
          <SkeletonLines count={5} />
        ) : isError ? (
```

- [ ] **Step 14: Build y lint del frontend**

Run: `cd App/frontend && pnpm build && pnpm lint`
Expected: ambos comandos terminan sin error (0 warnings de TypeScript/ESLint nuevos).

- [ ] **Step 15: Verificación visual**

Con el backend dev corriendo, abrir en el navegador (throttle de red a "Slow 3G" en
DevTools, o `staleTime: 0` temporal en una query) al menos: `/admin/alumnos` (tabla),
`/admin/perfil` (card), `/admin/calendario` (grilla), `/admin` (stats + lista). Confirmar
que el skeleton aparece brevemente antes del contenido real, sin saltos de layout
(el `<thead>` de las tablas no debe parpadear).

- [ ] **Step 16: Commit**

```bash
git add App/frontend/src/components/admin/ui/Skeleton.tsx \
  App/frontend/src/app/admin/alumnos/page.tsx \
  App/frontend/src/app/admin/maestros/page.tsx \
  App/frontend/src/app/admin/administrativos/page.tsx \
  App/frontend/src/app/admin/carreras/page.tsx \
  App/frontend/src/app/admin/grupos/page.tsx \
  App/frontend/src/app/admin/salones/page.tsx \
  App/frontend/src/app/admin/grupos/\[id\]/page.tsx \
  App/frontend/src/app/admin/grupos/\[id\]/SeccionAsignaciones.tsx \
  App/frontend/src/app/admin/perfil/page.tsx \
  App/frontend/src/app/admin/calendario/page.tsx \
  App/frontend/src/app/admin/carreras/SubirMallaModal.tsx \
  App/frontend/src/app/admin/page.tsx
git commit -m "feat(admin): skeleton loaders en pantallas con fetch"
```

---

### Task 2: Skeletons en `app/alumno/*` y `app/maestro/*` (6 sitios en 4 archivos)

**Files:**
- Create: `App/frontend/src/components/alumno/ui/Skeleton.tsx`
- Create: `App/frontend/src/components/maestro/ui/Skeleton.tsx`
- Modify: `App/frontend/src/app/alumno/page.tsx`
- Modify: `App/frontend/src/app/alumno/calendario/page.tsx`
- Modify: `App/frontend/src/app/maestro/page.tsx`
- Modify: `App/frontend/src/app/maestro/calendario/page.tsx`

**Interfaces:**
- Produces (`@/components/alumno/ui/Skeleton` y, por separado,
  `@/components/maestro/ui/Skeleton` — mismo contenido, sin import cruzado entre los
  dos): `SkeletonProfileCard({ sections?: number, fieldsPerSection?: number })`,
  `SkeletonLines({ count?: number })`, `SkeletonCalendarGrid()`. Ninguna de las 5 formas
  de `SkeletonTableRows`/`SkeletonStatTiles` de Task 1 aplica acá — este árbol no tiene
  tablas ni dashboards de KPI.

- [ ] **Step 1: Crear `components/alumno/ui/Skeleton.tsx`**

```tsx
/**
 * Skeletons de carga para app/alumno/* — Tailwind `animate-pulse`, sin
 * dependencia nueva. Ver docs/superpowers/specs/2026-09-05-skeleton-loaders-design.md.
 *
 * Regla 11 de CLAUDE.md raíz: este archivo se duplica a propósito en
 * components/admin/ui/Skeleton.tsx, components/maestro/ui/Skeleton.tsx y
 * app/plataforma/Skeleton.tsx — sin import cruzado entre árboles.
 */

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-mist ${className}`} />;
}

/** Card de perfil con `sections` bloques, cada uno con un título y
 * `fieldsPerSection` pares etiqueta/valor en grid. Aproximación deliberada
 * del layout real de app/alumno/page.tsx (encabezado + sidebar + panel,
 * rediseño 2026-08-21) — el skeleton no clona el DOM final pixel a pixel,
 * solo comunica "aquí va contenido de perfil" mientras carga. */
export function SkeletonProfileCard({
  sections = 2,
  fieldsPerSection = 4,
}: {
  sections?: number;
  fieldsPerSection?: number;
}) {
  return (
    <div className="mt-6 space-y-6">
      {Array.from({ length: sections }).map((_, s) => (
        <div key={s} className="rounded-lg border border-mist p-5">
          <SkeletonBlock className="h-4 w-32" />
          <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            {Array.from({ length: fieldsPerSection }).map((_, f) => (
              <div key={f}>
                <SkeletonBlock className="h-3 w-20" />
                <SkeletonBlock className="mt-2 h-4 w-36" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Grilla mensual — 6 semanas x 7 días = 42 celdas, mismo criterio que
 * app/admin/calendario/mes-grid.util.ts (rangoDelGrid). */
export function SkeletonCalendarGrid() {
  return (
    <div className="mt-6 grid grid-cols-7 gap-2">
      {Array.from({ length: 42 }).map((_, i) => (
        <SkeletonBlock key={i} className="h-20 w-full" />
      ))}
    </div>
  );
}

/** Barras simples sueltas — para secciones chicas embebidas. */
export function SkeletonLines({ count = 3 }: { count?: number }) {
  return (
    <div className="mt-3 space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonBlock key={i} className="h-4 w-full max-w-sm" />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Crear `components/maestro/ui/Skeleton.tsx` — mismo contenido exacto del Step 1, solo cambia el docstring de cabecera a "para app/maestro/*"**

- [ ] **Step 3: `app/alumno/page.tsx` — 2 sitios: perfil y sección de compañeros**

Import nuevo:
```tsx
import {
  SkeletonLines,
  SkeletonProfileCard,
} from '@/components/alumno/ui/Skeleton';
```

Perfil — reemplazar (línea ~66-73, el bloque `if (isLoading)` completo):
```tsx
  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-navy">Mi perfil</h1>
        <p className="mt-4 text-sm text-slate/60">Cargando…</p>
      </div>
    );
  }
```
por:
```tsx
  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-navy">Mi perfil</h1>
        <SkeletonProfileCard sections={1} fieldsPerSection={6} />
      </div>
    );
  }
```

Sección de compañeros — reemplazar (línea ~512):
```tsx
      {isLoading && <p className="mt-3 text-sm text-slate/60">Cargando…</p>}
```
por:
```tsx
      {isLoading && <SkeletonLines count={3} />}
```

- [ ] **Step 4: `app/alumno/calendario/page.tsx` — grilla mensual**

Import nuevo:
```tsx
import { SkeletonCalendarGrid } from '@/components/alumno/ui/Skeleton';
```

Reemplazar (línea ~131-133):
```tsx
        {eventosQuery.isLoading && (
          <p className="mt-6 py-6 text-center text-sm text-slate/60">Cargando…</p>
        )}
```
por:
```tsx
        {eventosQuery.isLoading && <SkeletonCalendarGrid />}
```

- [ ] **Step 5: `app/maestro/page.tsx` — 2 sitios: perfil (3 secciones, layout apilado calcado de admin/perfil) y sección de grupos y materias**

Import nuevo:
```tsx
import {
  SkeletonLines,
  SkeletonProfileCard,
} from '@/components/maestro/ui/Skeleton';
```

Perfil — reemplazar (línea ~54-61, el bloque `if (isLoading)` completo):
```tsx
  if (isLoading) {
    return (
      <div className="max-w-3xl rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-navy">Mi perfil</h1>
        <p className="mt-4 text-sm text-slate/60">Cargando…</p>
      </div>
    );
  }
```
por:
```tsx
  if (isLoading) {
    return (
      <div className="max-w-3xl rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-navy">Mi perfil</h1>
        <SkeletonProfileCard sections={3} fieldsPerSection={4} />
      </div>
    );
  }
```

Sección de grupos y materias — reemplazar (línea ~248):
```tsx
      {isLoading && <p className="mt-3 text-sm text-slate/60">Cargando…</p>}
```
por:
```tsx
      {isLoading && <SkeletonLines count={3} />}
```

- [ ] **Step 6: `app/maestro/calendario/page.tsx` — grilla mensual**

Import nuevo:
```tsx
import { SkeletonCalendarGrid } from '@/components/maestro/ui/Skeleton';
```

Reemplazar (línea ~242-244):
```tsx
        {eventosQuery.isLoading && (
          <p className="mt-6 py-6 text-center text-sm text-slate/60">Cargando…</p>
        )}
```
por:
```tsx
        {eventosQuery.isLoading && <SkeletonCalendarGrid />}
```

- [ ] **Step 7: Build y lint del frontend**

Run: `cd App/frontend && pnpm build && pnpm lint`
Expected: ambos comandos terminan sin error.

- [ ] **Step 8: Verificación visual**

Abrir `/alumno` (perfil + compañeros), `/alumno/calendario`, `/maestro` (perfil + grupos
y materias), `/maestro/calendario` con red en throttle. Confirmar skeleton visible antes
del contenido real, sin saltos de layout.

- [ ] **Step 9: Commit**

```bash
git add App/frontend/src/components/alumno/ui/Skeleton.tsx \
  App/frontend/src/components/maestro/ui/Skeleton.tsx \
  App/frontend/src/app/alumno/page.tsx \
  App/frontend/src/app/alumno/calendario/page.tsx \
  App/frontend/src/app/maestro/page.tsx \
  App/frontend/src/app/maestro/calendario/page.tsx
git commit -m "feat(alumno,maestro): skeleton loaders en pantallas con fetch"
```

---

### Task 3: Skeletons en `app/plataforma/*` (2 sitios en 2 archivos)

Sin dueño de dominio en el roster de agentes (mismo gap consignado en Día 20/22 de
`ESTADO.md`) — ejecutado directo, no vía subagente de dominio.

**Files:**
- Create: `App/frontend/src/app/plataforma/Skeleton.tsx`
- Modify: `App/frontend/src/app/plataforma/page.tsx`
- Modify: `App/frontend/src/app/plataforma/sedes/page.tsx`

**Interfaces:**
- Produces (`./Skeleton` relativo, colocado junto a las páginas — `plataforma` no tiene
  `components/ui/` propio, sigue el patrón ya existente de `SedeModal.tsx`/
  `ConfirmarEliminarSedeModal.tsx`): `SkeletonStatTiles({ count?: number })`,
  `SkeletonLines({ count?: number })`, `SkeletonTableRows({ columns: number, rows?: number })`.

- [ ] **Step 1: Crear `app/plataforma/Skeleton.tsx`**

```tsx
/**
 * Skeletons de carga para app/plataforma/* — Tailwind `animate-pulse`, sin
 * dependencia nueva. Ver docs/superpowers/specs/2026-09-05-skeleton-loaders-design.md.
 *
 * Regla 11 de CLAUDE.md raíz (extendida a este árbol por consistencia): este
 * archivo se duplica a propósito respecto a components/admin/ui/Skeleton.tsx,
 * components/alumno/ui/Skeleton.tsx y components/maestro/ui/Skeleton.tsx —
 * sin import cruzado. Colocado junto a las páginas, mismo patrón que
 * SedeModal.tsx/ConfirmarEliminarSedeModal.tsx (plataforma no tiene
 * components/ui/ propio).
 */

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-mist ${className}`} />;
}

/** Fila de tiles de KPI (dashboard global). */
export function SkeletonStatTiles({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border-l-4 border-mist bg-white p-4 shadow-sm">
          <SkeletonBlock className="h-7 w-12" />
          <SkeletonBlock className="mt-2 h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Barras simples sueltas — para listas cortas (ej. "alumnos por sede"). */
export function SkeletonLines({ count = 3 }: { count?: number }) {
  return (
    <div className="mt-4 space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonBlock key={i} className="h-4 w-full max-w-sm" />
      ))}
    </div>
  );
}

/** Filas de skeleton para dentro de un <tbody> — el <table>/<thead> real
 * sigue montado, esto solo reemplaza el contenido del body mientras carga. */
export function SkeletonTableRows({
  columns,
  rows = 5,
}: {
  columns: number;
  rows?: number;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: columns }).map((_, c) => (
            <td key={c} className="px-4 py-3">
              <SkeletonBlock className="h-4 w-full max-w-40" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
```

- [ ] **Step 2: `app/plataforma/page.tsx` — un solo bloque de carga que cubre 4 tiles + lista "alumnos por sede"**

Import nuevo:
```tsx
import { SkeletonLines, SkeletonStatTiles } from './Skeleton';
```

Reemplazar (línea ~68-70):
```tsx
      {resumenQuery.isLoading && (
        <p className="mt-8 text-center text-slate/60">Cargando…</p>
      )}
```
por:
```tsx
      {resumenQuery.isLoading && (
        <div className="mt-6 space-y-6">
          <SkeletonStatTiles count={4} />
          <div className="rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
            <SkeletonLines count={4} />
          </div>
        </div>
      )}
```

- [ ] **Step 3: `app/plataforma/sedes/page.tsx` — tabla de 4 columnas**

Import nuevo:
```tsx
import { SkeletonTableRows } from '../Skeleton';
```

Reemplazar el `<tr><td colSpan={4} ...>Cargando…</td></tr>` (línea ~156-160) por:
```tsx
              <SkeletonTableRows columns={4} />
```

- [ ] **Step 4: Build y lint del frontend**

Run: `cd App/frontend && pnpm build && pnpm lint`
Expected: ambos comandos terminan sin error.

- [ ] **Step 5: Verificación visual**

Abrir `/plataforma` y `/plataforma/sedes` con red en throttle. Confirmar skeleton visible
antes del contenido real.

- [ ] **Step 6: Commit**

```bash
git add App/frontend/src/app/plataforma/Skeleton.tsx \
  App/frontend/src/app/plataforma/page.tsx \
  App/frontend/src/app/plataforma/sedes/page.tsx
git commit -m "feat(plataforma): skeleton loaders en dashboard y tabla de sedes"
```

---

## Cierre

Sin QA dedicado para `app/plataforma/*` (mismo gap de Día 20/22). Review final de rama
cubre los 3 tasks antes de dar el pulido por cerrado — mismo criterio que el resto de
Subagent-Driven Development de este proyecto.
