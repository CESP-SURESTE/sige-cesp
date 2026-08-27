# Tooltip personalizado para el badge de Licencia — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el `title` nativo del badge de "Estatus" por un tooltip propio, chip oscuro con el look de la marca, que muestra el tipo de licencia.

**Architecture:** Un componente `Tooltip` genérico en el árbol admin, sin dependencias nuevas. Renderiza el trigger tal cual y, en hover/focus, muestra un nodo `position: fixed` vía `createPortal` a `document.body` — así ningún `overflow` de la tabla lo recorta. `EstatusEmpleadoBadge` deja de usar `title=` y envuelve el badge en `<Tooltip>` bajo la misma condición de hoy.

**Tech Stack:** Next.js 16 + React 19 + TypeScript + Tailwind v4 (tokens de marca en `globals.css`). `createPortal` de `react-dom`, `useId`/`useRef`/`useState`/`useEffect` de React. Sin librerías de tooltip/positioning.

## Global Constraints

- Sin dependencias nuevas (regla del proyecto). Solo React + `react-dom` + Tailwind.
- El componente vive en `App/frontend/src/components/admin/ui/` — árbol admin, nunca compartido con el árbol alumno (regla 11 de `CLAUDE.md`).
- Tokens de marca exactos para el chip: `bg-navy` (`#1b2a4a`), `text-bone` (`#f7f6f3`). Radio `rounded-md`, `text-xs`, `shadow-md`.
- Accesible: se dispara también con foco de teclado; `role="tooltip"` + `aria-describedby` (id de `useId()`) en el trigger solo mientras está visible; `Escape` cierra; `pointer-events: none` en el nodo del tooltip.
- Delay de apertura 150 ms; cierre inmediato en `mouseleave` / `blur` / `Escape`.
- Solo flip vertical (arriba ↔ abajo). Sin flip horizontal.
- `EstatusEmpleadoBadge`: la condición para mostrar el tooltip sigue siendo exactamente `estatus === 'LICENCIA' && tipoLicencia`; el resto del componente no cambia.
- `Sidebar.tsx` NO se toca (sigue con `title` nativo).
- Verificación: `pnpm tsc --noEmit` + `pnpm build` desde `App/frontend/`. No hay infra de tests de componente en este frontend y no se agrega.

---

### Task 1: Componente `Tooltip` + integración en `EstatusEmpleadoBadge`

**Files:**
- Create: `App/frontend/src/components/admin/ui/Tooltip.tsx`
- Modify: `App/frontend/src/components/admin/ui/personas-listado/EstatusEmpleadoBadge.tsx`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces:
  ```tsx
  // App/frontend/src/components/admin/ui/Tooltip.tsx
  interface TooltipProps {
    label: string;
    children: React.ReactElement;
  }
  export function Tooltip(props: TooltipProps): React.ReactElement;
  ```

- [ ] **Step 1: Crear `Tooltip.tsx`**

Crear `App/frontend/src/components/admin/ui/Tooltip.tsx` con este contenido:

```tsx
'use client';

import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * Tooltip propio (chip oscuro, tokens de marca) — reemplaza el `title` nativo
 * del navegador donde se quiere aparición rápida y estilo consistente.
 *
 * Sin dependencias: `@headlessui/react` v2 no tiene primitiva de tooltip y el
 * proyecto no agrega libs de positioning. El nodo se renderiza vía
 * `createPortal` a `document.body` con `position: fixed` medido desde el
 * trigger con `getBoundingClientRect()` — así el `overflow-x-auto` de las
 * tablas (que recortaría un tooltip posicionado con CSS dentro de la celda)
 * no lo afecta.
 *
 * Solo flip vertical: si no cabe arriba del trigger, se pinta abajo. Vive lo
 * que dura un hover/focus; no escucha `scroll`/`resize` — si el usuario hace
 * scroll con él abierto, el `mouseleave` lo cierra.
 *
 * Árbol admin (regla 11 de CLAUDE.md) — no compartir con el árbol alumno.
 */

interface TooltipProps {
  label: string;
  /** Trigger — un único elemento React (recibe ref via cloneElement no, ver nota). */
  children: ReactElement;
}

interface Coords {
  left: number;
  top: number;
  /** true = el tooltip está debajo del trigger (flechita apunta hacia arriba). */
  below: boolean;
}

const OPEN_DELAY_MS = 150;
const GAP_PX = 8;

export function Tooltip({ label, children }: TooltipProps) {
  const tooltipId = useId();
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [coords, setCoords] = useState<Coords | null>(null);

  const visible = coords !== null;

  const computeCoords = useCallback((): Coords | null => {
    const el = wrapperRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const below = rect.top < 48;
    return {
      left: rect.left + rect.width / 2,
      top: below ? rect.bottom + GAP_PX : rect.top - GAP_PX,
      below,
    };
  }, []);

  const open = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => {
      setCoords(computeCoords());
    }, OPEN_DELAY_MS);
  }, [computeCoords]);

  const close = useCallback(() => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    setCoords(null);
  }, []);

  useEffect(() => {
    return () => {
      if (openTimer.current) clearTimeout(openTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible, close]);

  return (
    <span
      ref={wrapperRef}
      className="inline-flex"
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
      aria-describedby={visible ? tooltipId : undefined}
    >
      {children}
      {visible &&
        coords &&
        createPortal(
          <span
            role="tooltip"
            id={tooltipId}
            style={{
              position: 'fixed',
              left: coords.left,
              top: coords.top,
              transform: coords.below
                ? 'translate(-50%, 0)'
                : 'translate(-50%, -100%)',
            }}
            className="pointer-events-none z-50 max-w-xs rounded-md bg-navy px-2.5 py-1.5 text-xs font-medium text-bone shadow-md"
          >
            {label}
            <span
              aria-hidden="true"
              className={`absolute left-1/2 size-1.5 -translate-x-1/2 rotate-45 bg-navy ${
                coords.below ? '-top-0.5' : '-bottom-0.5'
              }`}
            />
          </span>,
          document.body,
        )}
    </span>
  );
}
```

Nota sobre la ref: el wrapper `<span className="inline-flex">` es el que se mide
(`wrapperRef`), no el `children` — por eso no hace falta `cloneElement` con ref
forwarding. `cloneElement` está importado por si se necesita; si al final no se
usa, quitar el import para no dejar un símbolo sin usar (lo marca `tsc`/eslint).

- [ ] **Step 2: `tsc` del componente aislado**

Run: `cd App/frontend && pnpm tsc --noEmit`
Expected: sin errores. Si `cloneElement` quedó importado y sin usar, quitarlo y
volver a correr.

- [ ] **Step 3: Integrar en `EstatusEmpleadoBadge.tsx`**

En `App/frontend/src/components/admin/ui/personas-listado/EstatusEmpleadoBadge.tsx`:

1. Agregar el import: `import { Tooltip } from '@/components/admin/ui/Tooltip';`
2. Reemplazar el bloque de `return`. Hoy es:

```tsx
  const titulo =
    estatus === 'LICENCIA' && tipoLicencia
      ? `Motivo: ${TIPO_LICENCIA_LABEL[tipoLicencia]}`
      : undefined;

  return (
    <span
      title={titulo}
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${ESTATUS_EMPLEADO_ESTILO[estatus]}`}
    >
      {ESTATUS_EMPLEADO_LABEL[estatus]}
    </span>
  );
```

Dejarlo así:

```tsx
  const badge = (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${ESTATUS_EMPLEADO_ESTILO[estatus]}`}
    >
      {ESTATUS_EMPLEADO_LABEL[estatus]}
    </span>
  );

  if (estatus === 'LICENCIA' && tipoLicencia) {
    return (
      <Tooltip label={`Motivo: ${TIPO_LICENCIA_LABEL[tipoLicencia]}`}>
        {badge}
      </Tooltip>
    );
  }

  return badge;
```

Se elimina la variable `titulo` y el atributo `title`. El resto del archivo
(imports de tipos, `ESTATUS_EMPLEADO_LABEL`, `ESTATUS_EMPLEADO_ESTILO`,
`TIPO_LICENCIA_LABEL`, la firma de props) no cambia.

- [ ] **Step 4: `tsc` completo**

Run: `cd App/frontend && pnpm tsc --noEmit`
Expected: sin errores. En particular, ningún símbolo sin usar en
`EstatusEmpleadoBadge.tsx` (la variable `titulo` debe haber desaparecido).

- [ ] **Step 5: Build**

Run: `cd App/frontend && pnpm build`
Expected: build exitoso, 23/23 páginas (o el número vigente), sin errores de
tipos ni de lint que rompan la compilación. `Tooltip` marca `'use client'`, así
que ninguna página que use `EstatusEmpleadoBadge` (que ya es client, se usa en
tablas con `useState`) debe romperse por RSC.

- [ ] **Step 6: Commit**

```bash
git add App/frontend/src/components/admin/ui/Tooltip.tsx App/frontend/src/components/admin/ui/personas-listado/EstatusEmpleadoBadge.tsx
git commit -m "feat(admin): tooltip propio para el tipo de licencia en el badge de estatus"
```

---

### Task 2: Documentación

**Files:**
- Modify: `documentacion_de_agentes/ESTADO.md`

**Interfaces:**
- Consumes: nombres finales de Task 1 (`Tooltip` en `components/admin/ui/Tooltip.tsx`).
- Produces: nada.

- [ ] **Step 1: Entrada en `ESTADO.md`**

En `documentacion_de_agentes/ESTADO.md`, después de la última entrada de
2026-08-27 (la de motivos de baja por terminación / art. 53 LFT), agregar:

```markdown
### Tooltip propio para el tipo de licencia en el badge de estatus — ✅ CERRADO EN CÓDIGO (2026-08-27)

- **Contexto**: el tooltip que muestra el `tipoLicencia` sobre el badge de
  "Estatus" (`EstatusEmpleadoBadge.tsx`, maestros y administrativos) usaba el
  atributo `title` nativo — aparición lenta, estilo del SO. Pedido del usuario:
  tooltip propio con el look de la marca.
- **Componente nuevo**: `App/frontend/src/components/admin/ui/Tooltip.tsx` —
  genérico, árbol admin (regla 11), sin dependencias nuevas (`@headlessui/react`
  v2 no tiene tooltip; no se agregan libs de positioning). Renderiza el nodo vía
  `createPortal` a `document.body` con `position: fixed` medido desde el trigger
  con `getBoundingClientRect()` — el `overflow-x-auto` de las tablas no lo
  recorta. Delay 150 ms al abrir; cierre inmediato en `mouseleave`/`blur`/
  `Escape`. Accesible: se dispara con foco de teclado, `role="tooltip"` +
  `aria-describedby` mientras visible, `pointer-events: none`. Solo flip
  vertical. Chip: `bg-navy text-bone rounded-md text-xs shadow-md` + flechita.
- **Integración**: `EstatusEmpleadoBadge.tsx` deja de usar `title=`; envuelve el
  badge en `<Tooltip>` bajo la misma condición (`estatus === 'LICENCIA' &&
  tipoLicencia`). Sin otros cambios en el componente. `Sidebar.tsx` se queda con
  su `title` nativo (fuera de alcance).
- **Verificación**: `tsc --noEmit` + build frontend limpios. Verificación manual
  en navegador (hover + foco de teclado sobre el badge de Licencia en maestros y
  administrativos) — PENDIENTE.
- Spec → `docs/superpowers/specs/2026-08-27-tooltip-custom-badge-licencia-design.md`,
  plan → `docs/superpowers/plans/2026-08-27-tooltip-custom-badge-licencia.md`.
```

- [ ] **Step 2: Commit**

```bash
git add documentacion_de_agentes/ESTADO.md
git commit -m "docs: tooltip propio para el tipo de licencia en el badge de estatus"
```

---

## Self-Review

**1. Spec coverage:**
- Spec "Componente nuevo `Tooltip.tsx`" (API, mecánica portal/fixed, flip vertical,
  delay 150 ms, a11y, estilo chip oscuro, `max-w-xs`) → Task 1 Step 1 (código
  literal). ✅
- Spec "Integración `EstatusEmpleadoBadge.tsx`" (quitar `title`, envolver bajo la
  misma condición, resto sin cambios) → Task 1 Step 3. ✅
- Spec "Fuera de alcance" (Sidebar sin tocar, sin flip horizontal, sin barrel) →
  respetado; el plan no toca `Sidebar.tsx` ni agrega índice. ✅
- Spec "Verificación" (`tsc` + build) → Task 1 Steps 2, 4, 5. ✅
- Doc del cambio → Task 2 (no estaba explícito en el spec pero es coherente con la
  práctica del repo: toda feature cerrada se anota en `ESTADO.md`).

**2. Placeholder scan:** Sin "TBD"/"TODO"/"handle edge cases". El código del
componente está completo y literal en Step 1. Los comandos de verificación son
concretos. ✅

**3. Type consistency:**
- `TooltipProps { label: string; children: ReactElement }` — definido en Step 1,
  consumido en Step 3 con `label={string}` y un único hijo (`{badge}`). ✅
- `Coords { left, top, below }` — usado consistente en `computeCoords`, el
  `style`, el `transform` y la clase de la flecha. ✅
- El componente es `'use client'` y `EstatusEmpleadoBadge` ya corre en client
  (tablas con estado) — sin conflicto RSC. Anotado en Step 5.
- Import alias `@/components/admin/ui/Tooltip` — consistente con el alias `@/` que
  ya usa `EstatusEmpleadoBadge.tsx` (`@/lib/api/personas`). ✅
