# Grupo en el navbar del alumno — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar en el navbar del alumno (`Header.tsx` → `SedeCarreraBadge.tsx`) el grupo al que pertenece, junto a los badges existentes de sede y carrera.

**Architecture:** Cambio 100% frontend, un solo componente extendido (`SedeCarreraBadge.tsx`) + un ícono nuevo. Sin cambios de backend — reusa `GET /perfil/grupo/companeros` ya existente vía `obtenerCompaneros()` (`lib/api/perfil.ts`).

**Tech Stack:** Next.js (App Router) + TypeScript + Tailwind + React Query (`@tanstack/react-query`).

## Global Constraints

- Regla 11 de CLAUDE.md raíz: separación total admin/alumno/maestro — no importar nada de `components/admin` ni `components/maestro`.
- Regla 12 de CLAUDE.md raíz: todo catch loguea con `console.error` antes de responder/re-lanzar, incluso en frontend.
- Sin librerías nuevas (CLAUDE.md global — "no agregar dependencias nuevas si algo se resuelve con lo que ya está instalado").
- Este proyecto no tiene suite de tests unitarios de frontend (`package.json` solo define `dev`/`build`/`start`/`lint`, sin `test`, sin archivos `*.test.tsx`/`*.spec.tsx` en `App/frontend/src`). La verificación establecida es `pnpm build` + `pnpm lint` limpios + verificación manual en navegador — no introducir un framework de testing nuevo para este cambio.
- Spec completo: `docs/superpowers/specs/2026-09-16-navbar-grupo-alumno-design.md`.

---

## Task 1: Ícono de grupo + badge de grupo en el navbar de alumno

**Files:**
- Modify: `App/frontend/src/components/alumno/ui/shell/icons.tsx`
- Modify: `App/frontend/src/components/alumno/ui/shell/SedeCarreraBadge.tsx`

**Interfaces:**
- Consumes: `obtenerCompaneros(): Promise<GrupoConCompaneros[]>` y el tipo `GrupoConCompaneros = { grupoId: string; nombre: string; anioInicio: number; cicloActual: number; carrera: {id,nombre}; salon: {id,nombre}; companeros: CompaneroItem[] }`, ambos ya existentes en `App/frontend/src/lib/api/perfil.ts` (líneas 294-306) — no se modifican.
- Produces: nada que otro task consuma (task único de este plan).

- [ ] **Step 1: Agregar `IconGrupo` a `icons.tsx`**

Abrir `App/frontend/src/components/alumno/ui/shell/icons.tsx` y agregar, al final del archivo (después de `IconCampana`), un ícono nuevo de "grupo" (dos personas), con el mismo objeto `BASE` que ya usan los demás íconos del archivo:

```tsx
/** Dos personas — badge de grupo del navbar (extensión de `SedeCarreraBadge`, 2026-09-16). */
export function IconGrupo({ className }: IconProps) {
  return (
    <svg {...BASE} className={className} aria-hidden="true">
      <circle cx="9" cy="8.5" r="2.5" />
      <path d="M4 18c.6-2.6 2.4-4 5-4s4.4 1.4 5 4" />
      <path d="M15.5 6.2c1.1.3 1.9 1.2 1.9 2.4s-.8 2.1-1.9 2.4" />
      <path d="M15 14.3c1.9.4 3.2 1.7 3.7 3.7" />
    </svg>
  );
}
```

No ejecutar nada todavía — este paso no es verificable en aislamiento (es un componente SVG sin lógica), se verifica en conjunto con el Step 2 vía build.

- [ ] **Step 2: Extender `SedeCarreraBadge.tsx` con el badge de grupo**

Abrir `App/frontend/src/components/alumno/ui/shell/SedeCarreraBadge.tsx`. Reemplazar el contenido completo del archivo por:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { obtenerPerfil, obtenerCompaneros } from '@/lib/api/perfil';
import { IconCarrera, IconUbicacion, IconGrupo } from './icons';

/**
 * Badges de sede + carrera + grupo del navbar de alumno — rediseño
 * 2026-08-16, pedido explícito del usuario: "haz enfasis en su sede y su
 * carrera" en el navbar. A diferencia de admin (`SedeBadge` en
 * `components/admin/ui/shell/AdminShell.tsx`, solo sede), un alumno SÍ tiene
 * carrera propia — se muestran los 2 juntos.
 *
 * `GET /perfil` vía React Query, mismo `queryKey: ['alumno', 'perfil']` que
 * `app/alumno/page.tsx` (comparten caché — Fase 5 Día 16, ya usa este mismo
 * query en esa página). Sin loading state visible — dato secundario de
 * contexto, no vale un skeleton.
 *
 * Badge de grupo (2026-09-16, idea diferida desde 2026-09-02) — tercer
 * badge, mismo criterio de "sin loading state visible". `queryKey: ['alumno',
 * 'companeros']` a propósito: es el MISMO key que usa el bloque comentado
 * `SeccionCompaneros` de `app/alumno/page.tsx` (oculto desde 2026-09-07) —
 * si esa sección se reactiva, comparte caché sin duplicar el fetch. Se
 * muestra solo el primer grupo del array (ya viene ordenado `anioInicio
 * desc, cicloActual desc, nombre asc` desde el backend) — un alumno en 2+
 * grupos simultáneos es un caso raro, no se complica la UI por él. Si el
 * array viene vacío o la query falla, el badge no se renderiza.
 */
export function SedeCarreraBadge() {
  const { data: perfil } = useQuery({
    queryKey: ['alumno', 'perfil'],
    queryFn: async () => {
      try {
        return await obtenerPerfil();
      } catch (err) {
        // Regla 12 de `CLAUDE.md` raíz — loguear antes de dejar que React
        // Query marque `isError` y la UI muestre el mensaje genérico.
        console.error('[SedeCarreraBadge] Error al obtener el perfil:', err);
        throw err;
      }
    },
  });

  const { data: grupos } = useQuery({
    queryKey: ['alumno', 'companeros'],
    queryFn: async () => {
      try {
        return await obtenerCompaneros();
      } catch (err) {
        console.error('[SedeCarreraBadge] Error al obtener los grupos:', err);
        throw err;
      }
    },
  });

  const grupo = grupos?.[0];

  if (!perfil) return null;

  return (
    <div className="hidden items-center gap-2 sm:flex">
      <span className="flex items-center gap-1.5 rounded-full bg-mist/50 px-3 py-1.5 text-xs font-medium text-slate">
        <IconUbicacion className="size-3.5 shrink-0 text-navy" />
        <span className="truncate">{perfil.sede.nombre}</span>
      </span>
      {perfil.alumno && (
        <span className="hidden items-center gap-1.5 rounded-full bg-mist/50 px-3 py-1.5 text-xs font-medium text-slate md:flex">
          <IconCarrera className="size-3.5 shrink-0 text-navy" />
          <span className="truncate">{perfil.alumno.carrera.nombre}</span>
        </span>
      )}
      {grupo && (
        <span className="hidden items-center gap-1.5 rounded-full bg-mist/50 px-3 py-1.5 text-xs font-medium text-slate md:flex">
          <IconGrupo className="size-3.5 shrink-0 text-navy" />
          <span className="truncate">
            {grupo.nombre} · Cuatrimestre {grupo.cicloActual}
          </span>
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verificar build y lint**

Run: `cd App/frontend && pnpm build && pnpm lint`
Expected: ambos comandos terminan sin errores (build compila, lint sin warnings/errores nuevos). Si `pnpm build` falla por tipos, revisar que `GrupoConCompaneros`/`obtenerCompaneros` se estén importando con el nombre exacto que exporta `lib/api/perfil.ts` (no renombrarlos).

- [ ] **Step 4: Verificación manual en navegador**

Con el backend y frontend corriendo en dev (`pnpm dev` en ambos, o el flujo que ya uses), iniciar sesión como un alumno que SÍ tenga un grupo asignado (cualquiera matriculado vía `POST /grupos/:id/alumnos`, ver Fase 10) y confirmar:
- Aparece un tercer badge en el navbar (`/alumno`, `/alumno/calendario`, `/alumno/avisos`) con el texto `"{nombre del grupo} · Cuatrimestre N"`.
- El badge respeta el mismo estilo visual (píldora gris) que sede/carrera y se oculta en pantallas angostas igual que el de carrera (breakpoint `md`).
- Si hay a mano un alumno SIN grupo (o se puede consultar uno sin matricular), confirmar que el navbar no rompe layout ni muestra un badge vacío — solo aparecen sede y carrera.

Esta verificación es manual (a cargo del usuario o vía Claude in Chrome si se pide explícitamente) — no hay test automatizado equivalente en este proyecto (ver Global Constraints).

- [ ] **Step 5: Commit**

```bash
git add App/frontend/src/components/alumno/ui/shell/icons.tsx App/frontend/src/components/alumno/ui/shell/SedeCarreraBadge.tsx
git commit -m "$(cat <<'EOF'
feat(alumno): muestra el grupo del alumno en el navbar

Extiende SedeCarreraBadge con un tercer badge (grupo + cuatrimestre),
reusando GET /perfil/grupo/companeros ya existente. Idea diferida desde
2026-09-02. Solo el primer grupo si hay varios; sin badge si no tiene.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Post-implementación

- Marcar esta idea como cerrada en la memoria (`sige-navbar-grupo-idea.md`) — ya no es "para después".
- No tocar `ESTADO.md`/roadmap: este cambio no tiene día de roadmap asignado (mismo criterio que otros ajustes directos sin día, ej. `GET /salones`).
