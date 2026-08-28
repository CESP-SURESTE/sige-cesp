# Modal de confirmación al matricular un alumno — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que al elegir un alumno en el autocomplete de "Agregar alumno" aparezca un modal con sus datos (solo lectura) para confirmar antes de matricularlo, en vez de matricular de inmediato.

**Architecture:** Un componente modal local nuevo (`ConfirmarMatricularAlumnoModal.tsx`), calco del `ConfirmarQuitarAlumnoModal.tsx` pero con una lista de datos y botón de alta (`bg-navy`). El `Combobox.onChange` de `app/admin/grupos/[id]/page.tsx` deja de disparar la mutación y ahora setea el alumno seleccionado en estado; el botón "Matricular" del modal dispara la mutación existente.

**Tech Stack:** Next.js 16 + React 19 + React Query + `@headlessui/react` v2 + Tailwind v4. Sin dependencias nuevas. Sin backend.

## Global Constraints

- Componente local a `app/admin/grupos/[id]/` — sin import cruzado (regla 11 de `CLAUDE.md`).
- Ningún cambio de backend. Ningún fetch adicional — el modal usa el `PersonaListItemAlumno` que el autocomplete ya tiene en `candidatos`.
- El modal NO bloquea la confirmación por `activo: false` ni por `estatusAcademico` — solo los muestra (coherente con el backend del Día 30). Cuando `activo` es `false`, la fila "Cuenta" se muestra en ámbar (`text-warning`).
- Botón principal del modal: `bg-navy hover:bg-navy-deep` (es un alta, no un borrado — no `bg-crimson`).
- `matricularMutation.onError` NO cierra el modal (a diferencia de `desmatricularMutation`), para que el usuario vea contra qué alumno falló un `409`.
- "Cancelar" solo limpia `alumnoAConfirmar`, NO `inputValue` (deja el texto de búsqueda).
- `Record<EstatusAcademico, string>` en el modal debe cubrir los 4 valores (`INSCRITO`/`BAJA_TEMPORAL`/`BAJA_DEFINITIVA`/`EGRESADO`) — `tsc` lo exige. Se duplica el mapa (mismo criterio ya usado entre archivos del árbol admin).
- No se toca `ConfirmarQuitarAlumnoModal.tsx` ni ningún otro archivo.
- Verificación: `pnpm tsc --noEmit` + `pnpm build` desde `App/frontend/`. No hay infra de tests de componente en este frontend y no se agrega.

---

### Task 1: Modal de confirmación + cambio de flujo en la página + nota en ESTADO.md

**Files:**
- Create: `App/frontend/src/app/admin/grupos/[id]/ConfirmarMatricularAlumnoModal.tsx`
- Modify: `App/frontend/src/app/admin/grupos/[id]/page.tsx`
- Modify: `documentacion_de_agentes/ESTADO.md`

**Interfaces:**
- Consumes: `PersonaListItemAlumno` (`@/lib/api/personas`), `EstatusAcademico` (`@/lib/api/personas`) — ambos ya importados en `page.tsx`. `matricularAlumno` — ya usado por `matricularMutation`.
- Produces:
  ```ts
  // ConfirmarMatricularAlumnoModal.tsx
  interface ConfirmarMatricularAlumnoModalProps {
    alumno: import('@/lib/api/personas').PersonaListItemAlumno;
    grupoNombre: string;
    matriculando: boolean;
    onConfirmar: () => void;
    onCancelar: () => void;
  }
  export function ConfirmarMatricularAlumnoModal(props: ConfirmarMatricularAlumnoModalProps): React.ReactElement;
  ```

- [ ] **Step 1: Crear `ConfirmarMatricularAlumnoModal.tsx`**

Crear `App/frontend/src/app/admin/grupos/[id]/ConfirmarMatricularAlumnoModal.tsx` con este contenido:

```tsx
'use client';

import type { EstatusAcademico, PersonaListItemAlumno } from '@/lib/api/personas';

/**
 * Modal de confirmación al matricular un alumno — local a
 * `app/admin/grupos/[id]/` (regla 11, sin import cruzado). Estructura calcada
 * de `./ConfirmarQuitarAlumnoModal.tsx`, pero: (1) botón principal `bg-navy`
 * (es un alta, no un borrado); (2) muestra una lista de solo lectura con los
 * datos que el autocomplete ya trae en `PersonaListItemAlumno` — sin fetch
 * extra. El objetivo es que el admin verifique que seleccionó al alumno
 * correcto antes de agregarlo al grupo.
 *
 * `ESTATUS_ACADEMICO_LABEL` se duplica acá (también existe en `page.tsx`) —
 * mismo criterio que `ESTATUS_EMPLEADO_LABEL`/`TIPO_LICENCIA_LABEL`, ya
 * duplicados entre archivos del árbol admin para un mapa chico sin tercer
 * consumidor.
 */

const ESTATUS_ACADEMICO_LABEL: Record<EstatusAcademico, string> = {
  INSCRITO: 'Inscrito',
  BAJA_TEMPORAL: 'Baja temporal',
  BAJA_DEFINITIVA: 'Baja definitiva',
  EGRESADO: 'Egresado',
};

interface ConfirmarMatricularAlumnoModalProps {
  alumno: PersonaListItemAlumno;
  grupoNombre: string;
  matriculando: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}

export function ConfirmarMatricularAlumnoModal({
  alumno,
  grupoNombre,
  matriculando,
  onConfirmar,
  onCancelar,
}: ConfirmarMatricularAlumnoModalProps) {
  const nombreCompleto = [
    alumno.apellidoPaterno,
    alumno.apellidoMaterno,
    alumno.nombres,
  ]
    .filter(Boolean)
    .join(' ');

  const filas: Array<{ etiqueta: string; valor: string; alerta?: boolean }> = [
    { etiqueta: 'Nombre', valor: nombreCompleto },
    { etiqueta: 'Matrícula', valor: alumno.matricula },
    { etiqueta: 'Carrera', valor: alumno.carrera.nombre },
    { etiqueta: 'Semestre actual', valor: String(alumno.semestreActual) },
    {
      etiqueta: 'Estatus académico',
      valor: ESTATUS_ACADEMICO_LABEL[alumno.estatusAcademico],
    },
    {
      etiqueta: 'Cuenta',
      valor: alumno.activo ? 'Activa' : 'Inactiva',
      alerta: !alumno.activo,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-slate">
          ¿Matricular a este alumno?
        </h2>
        <p className="mt-2 text-sm text-slate/80">
          Verifica que sea el alumno correcto antes de agregarlo al grupo{' '}
          <strong>{grupoNombre}</strong>.
        </p>

        <dl className="mt-4 divide-y divide-mist rounded-lg border border-mist text-sm">
          {filas.map((f) => (
            <div key={f.etiqueta} className="flex justify-between gap-4 px-3 py-2">
              <dt className="text-slate/60">{f.etiqueta}</dt>
              <dd
                className={`text-right font-medium ${
                  f.alerta ? 'text-warning' : 'text-slate'
                }`}
              >
                {f.valor}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancelar}
            disabled={matriculando}
            className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={matriculando}
            className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
          >
            {matriculando ? 'Matriculando…' : 'Matricular'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `tsc` del componente aislado**

Run: `cd App/frontend && pnpm tsc --noEmit`
Expected: sin errores. (`Record<EstatusAcademico, string>` obliga a cubrir los 4 valores; si falta uno, falla acá.)

- [ ] **Step 3: Importar el modal y agregar el estado en `page.tsx`**

En `App/frontend/src/app/admin/grupos/[id]/page.tsx`:

1. Agregar el import junto al de `ConfirmarQuitarAlumnoModal` (línea ~36):

```tsx
import { ConfirmarMatricularAlumnoModal } from './ConfirmarMatricularAlumnoModal';
```

2. Agregar el estado junto a `alumnoAQuitar` (dentro del componente, después de la
   línea `const [alumnoAQuitar, setAlumnoAQuitar] = useState<GrupoAlumnoListItem | null>(null);`):

```tsx
  const [alumnoAConfirmar, setAlumnoAConfirmar] =
    useState<PersonaListItemAlumno | null>(null);
```

- [ ] **Step 4: Cambiar el `Combobox.onChange`**

En el mismo archivo, el bloque actual es:

```tsx
          <Combobox
            immediate
            onChange={(usuarioId: string | null) => {
              if (usuarioId) matricularMutation.mutate(usuarioId);
            }}
            disabled={matricularMutation.isPending}
          >
```

Reemplazar el `onChange` (dejando `immediate` y `disabled` igual):

```tsx
          <Combobox
            immediate
            onChange={(usuarioId: string | null) => {
              if (!usuarioId) return;
              setAlumnoAConfirmar(
                candidatos.find((p) => p.usuarioId === usuarioId) ?? null,
              );
            }}
            disabled={matricularMutation.isPending}
          >
```

- [ ] **Step 5: Agregar `setAlumnoAConfirmar(null)` en el `onSuccess` de `matricularMutation`**

El bloque actual del `onSuccess`:

```tsx
    onSuccess: () => {
      toast.success('Alumno matriculado');
      setInputValue('');
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'grupos', 'detalle', id],
      });
    },
```

Dejarlo así:

```tsx
    onSuccess: () => {
      toast.success('Alumno matriculado');
      setInputValue('');
      setAlumnoAConfirmar(null);
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'grupos', 'detalle', id],
      });
    },
```

No tocar el `onError` (el modal debe quedar abierto si la matrícula falla).

- [ ] **Step 6: Renderizar el modal**

En el mismo archivo, junto al render de `ConfirmarQuitarAlumnoModal` (cerca del final
del JSX, antes del `</div>` de cierre y el `);`):

```tsx
      {alumnoAConfirmar && grupo && (
        <ConfirmarMatricularAlumnoModal
          alumno={alumnoAConfirmar}
          grupoNombre={grupo.nombre}
          matriculando={matricularMutation.isPending}
          onConfirmar={() =>
            matricularMutation.mutate(alumnoAConfirmar.usuarioId)
          }
          onCancelar={() => setAlumnoAConfirmar(null)}
        />
      )}
```

- [ ] **Step 7: `tsc` + build**

Run: `cd App/frontend && pnpm tsc --noEmit`
Expected: sin errores. En particular, `alumnoAConfirmar` se usa (no queda estado
muerto) y `PersonaListItemAlumno` ya estaba importado.

Run: `cd App/frontend && pnpm build`
Expected: build exitoso (23/23 páginas o el número vigente).

- [ ] **Step 8: Nota en `ESTADO.md`**

En `documentacion_de_agentes/ESTADO.md`, dentro de la entrada del Día 31 (buscar
"### Día 31 — UI de gestión de grupos"), agregar un bullet al final de la lista de esa
entrada (antes de la línea "Spec →"):

```markdown
- **Pulido de usabilidad (2026-08-27, mismo día)**: al elegir un alumno en el
  autocomplete ya NO se matricula de inmediato — aparece
  `ConfirmarMatricularAlumnoModal` (local, calco de `ConfirmarQuitarAlumnoModal`) con
  los datos del alumno en solo lectura (nombre, matrícula, carrera, semestre, estatus
  académico, y "Cuenta: Activa/Inactiva" resaltado en ámbar si está inactiva) para que
  el admin verifique antes de confirmar. El `Combobox.onChange` setea
  `alumnoAConfirmar`; el botón "Matricular" del modal dispara la mutación. El modal
  queda abierto si la matrícula falla (p. ej. `409 CAPACIDAD_EXCEDIDA`). Sin backend.
  Spec → `docs/superpowers/specs/2026-08-27-confirmar-matricular-alumno-design.md`.
```

- [ ] **Step 9: Commit**

```bash
git add "App/frontend/src/app/admin/grupos/[id]/ConfirmarMatricularAlumnoModal.tsx" "App/frontend/src/app/admin/grupos/[id]/page.tsx" documentacion_de_agentes/ESTADO.md
git commit -m "feat(admin): modal de confirmación al matricular un alumno en un grupo"
```

---

## Self-Review

**1. Spec coverage:**
- Spec §"Componente nuevo `ConfirmarMatricularAlumnoModal.tsx`" (calco, botón `bg-navy`,
  encabezado/subtexto, lista de 6 filas incl. `activo` en ámbar, botones disabled
  mientras `matriculando`, no editable) → Task 1 Step 1 (código literal). ✅
- Spec §"Cambio de flujo — `page.tsx`" (import, estado `alumnoAConfirmar`, `onChange`
  setea en vez de mutar, `onSuccess` limpia, `onError` sin cambio, render del modal,
  Cancelar no limpia `inputValue`) → Task 1 Steps 3-6. ✅
- Spec §"Fuera de alcance" (sin backend, sin fetch extra, sin bloquear por
  `activo`/`estatus`, no tocar el modal de quitar) → Global Constraints + no se
  implementa. ✅
- Spec §"Verificación" (`tsc` + build) → Task 1 Steps 2, 7. ✅
- Nota de `ESTADO.md` → Task 1 Step 8 (no estaba explícito en el spec pero es la
  práctica del repo: todo cambio cerrado se anota).

**2. Placeholder scan:** Sin "TBD"/"TODO"/"handle edge cases". El modal está literal;
los 4 edits de `page.tsx` citan el bloque "antes" exacto y dan el "después" completo.
No hay TDD porque el frontend de este proyecto no tiene infra de tests de componente
(mismo criterio que el tooltip y toda la Día 31) — verificación por `tsc`+build+navegador.

**3. Type consistency:**
- `ConfirmarMatricularAlumnoModalProps` — `alumno: PersonaListItemAlumno`,
  `grupoNombre: string`, `matriculando: boolean`, `onConfirmar`/`onCancelar: () => void`
  — idénticos entre "Produces", el componente (Step 1) y el render (Step 6). ✅
- `alumnoAConfirmar: PersonaListItemAlumno | null` — el `candidatos.find(...)` devuelve
  `PersonaListItemAlumno | undefined`, el `?? null` lo normaliza a `| null`. `candidatos`
  es `PersonaListItemAlumno[]` (definido en la Task 3 del Día 31). ✅
- `matricularMutation.mutate(alumnoAConfirmar.usuarioId)` — `mutationFn` es
  `(usuarioId: string) => matricularAlumno(id, usuarioId)`; `usuarioId` es `string`. ✅
- `ESTATUS_ACADEMICO_LABEL` en el modal — mismas 4 llaves que el `Record` homónimo ya
  en `page.tsx` y que el enum `EstatusAcademico` de `personas.ts`. ✅
- Botón `bg-navy hover:bg-navy-deep` — tokens ya usados por el botón "+ Nuevo grupo" de
  `app/admin/grupos/page.tsx`. ✅
