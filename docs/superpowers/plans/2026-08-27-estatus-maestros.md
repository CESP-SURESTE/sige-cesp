# Cambio de estatus para MAESTRO (paridad con ADMINISTRATIVO) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `app/admin/maestros/page.tsx` tenga la misma UI de cambio de estatus que administrativos (badge de color con tooltip de motivo de licencia + modal con `tipoLicencia`/`motivoBaja`), reusando el modal ya existente, y que el path MAESTRO de `PATCH /personas/:id/estatus` quede cubierto por e2e.

**Architecture:** El backend de `PATCH /personas/:id/estatus` ya es simétrico para MAESTRO (campos `tipoLicencia`/`motivoBaja` en `PerfilMaestro`, `calcularActivoPorEstatus` no distingue rol salvo excluir ALUMNO). El trabajo es: (1) exponer `tipoLicencia` en `GET /personas?rol=MAESTRO` para el tooltip, (2) promover `CambiarEstatusModal` de `app/admin/administrativos/` a `components/admin/ui/personas-listado/` generalizando el tipo de su prop, (3) cablear la página de maestros igual que la de administrativos pero sin la lógica de jerarquía de `nivelPermiso` (que no aplica a target MAESTRO), (4) extender el e2e de estatus con un fixture y casos MAESTRO, (5) docs.

**Tech Stack:** NestJS + Prisma 6.x (backend), Next.js + React Query + Tailwind + sonner (frontend), Jest + supertest (e2e).

## Global Constraints

- **Contrato de API:** JSON camelCase; éxito `{ data: ... }` (+ `page`/`limit`/`total` en listas); error `{ error, code }`. Códigos ya en uso, no inventar nuevos aquí.
- **Regla 1:** nunca persistir datos calculables. `tipoLicencia` en el listado se lee tal cual del perfil, no se calcula.
- **Regla 3 (baja lógica):** personas nunca se borran; el cambio de estatus es `PATCH /:id/estatus`. Sin cambios a esta regla.
- **Regla 11:** separación total admin/alumno en frontend — árboles `app/{admin,alumno}` + `components/{admin,alumno}/ui` independientes. El modal compartido vive en `components/admin/ui/personas-listado/` (solo lo consumen páginas de `app/admin/`), no viola la regla.
- **Regla 12:** todo `catch`/`onError` loguea el error completo (`console.error`) antes de responder/mostrar mensaje, backend y frontend.
- **Regla 14:** al verificar algo a mano contra la DB real, máximo 3 escrituras. La suite Jest e2e corre completa cuando el trabajo lo requiere (ya limpia sola en `afterAll`).
- **e2e:** correr siempre vía `node scripts/run-e2e.js` (wrapper con `--experimental-vm-modules` + `--runInBand`), nunca `jest` directo. Se puede filtrar por nombre de archivo: `node scripts/run-e2e.js personas-estatus`.
- **Package manager:** `pnpm`. Frontend en `App/frontend/`, backend en `App/backend/`.
- **Fuera de alcance (no hacer):** dedup del mapa `TIPO_LICENCIA_LABEL` entre `EstatusEmpleadoBadge.tsx` y el modal; UI de estatus para ALUMNO; mostrar `motivoBaja` en la tabla; jerarquía de `nivelPermiso` sobre target MAESTRO (no aplica).

---

### Task 1: Backend — `tipoLicencia` en el listado de MAESTRO

**Files:**
- Modify: `App/backend/src/personas/personas.service.ts` (interfaz `PersonaListItemMaestro` ~líneas 39-47; rama `rol=MAESTRO` de `listarPorSedeYRol`, `select` ~líneas 1175-1183 y `map` ~líneas 1195-1203)
- Modify: `App/frontend/src/lib/api/personas.ts` (interfaz `PersonaListItemMaestro` ~líneas 248-256)
- Test: `App/backend/test/personas-listado.e2e-spec.ts` (assert de llaves del `it('rol=MAESTRO -> 200, ...')` ~líneas 427-438)

**Interfaces:**
- Consumes: nada de tareas previas.
- Produces:
  - Backend `PersonaListItemMaestro` gana `tipoLicencia: TipoLicencia | null`.
  - Frontend `PersonaListItemMaestro` (`lib/api/personas.ts`) gana `tipoLicencia: TipoLicencia | null` (el tipo `TipoLicencia` ya está exportado en ese archivo).
  - `GET /personas?rol=MAESTRO` devuelve cada item con la llave `tipoLicencia` (valor real solo si `estatus === 'LICENCIA'`, `null` en cualquier otro caso — es el valor crudo de la columna, que el backend nunca limpia al reactivar; el frontend decide mostrarlo solo con estatus LICENCIA).

- [ ] **Step 1: Actualizar el assert de llaves del test e2e (test primero)**

En `App/backend/test/personas-listado.e2e-spec.ts`, dentro de `it('rol=MAESTRO -> 200, solo trae los maestros del marker ...')`, agregar `'tipoLicencia'` al array esperado:

```ts
    for (const maestro of body.data) {
      expect(Object.keys(maestro).sort()).toEqual(
        [
          'usuarioId',
          'nombres',
          'apellidoPaterno',
          'apellidoMaterno',
          'cedulaProfesional',
          'estatus',
          'tipoLicencia',
          'activo',
        ].sort(),
      );
    }
```

(No hace falta tocar la interfaz `MaestroListItem` del archivo de test — solo se usa para casts `as`, la llave runtime extra no rompe el cast. Mismo criterio que se usó para `AdministrativoListItem` en el commit `01a0434`.)

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd App/backend && node scripts/run-e2e.js personas-listado`
Expected: FALLA en `rol=MAESTRO -> 200 ...` — `Received` no incluye `tipoLicencia`, `Expected` sí. El resto de la suite pasa.

- [ ] **Step 3: Agregar `tipoLicencia` a la interfaz backend `PersonaListItemMaestro`**

En `App/backend/src/personas/personas.service.ts`, interfaz `PersonaListItemMaestro`:

```ts
export interface PersonaListItemMaestro {
  usuarioId: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  cedulaProfesional: string | null;
  estatus: EstatusEmpleado;
  /** Solo tiene valor si `estatus === 'LICENCIA'` (feature estética,
   * 2026-08-27 — tooltip del badge de estatus en el listado de maestros,
   * paridad con `PersonaListItemAdministrativo`). `null` en cualquier otro
   * estatus, incluyendo el rastro histórico de una licencia pasada (no se
   * limpia al reactivar, ver Contrato de API de `PATCH /personas/:id/estatus`)
   * — el frontend solo lo muestra cuando el estatus actual es LICENCIA. */
  tipoLicencia: TipoLicencia | null;
  activo: boolean;
}
```

Verificar que `TipoLicencia` ya está importado de `@prisma/client` al inicio del archivo (lo está — lo usa `PersonaListItemAdministrativo`). Si no, agregarlo al import existente.

- [ ] **Step 4: Agregar `tipoLicencia` al `select` y al `map` de la rama MAESTRO de `listarPorSedeYRol`**

En la rama `rol === RolUsuario.MAESTRO` de `listarPorSedeYRol`, en el `this.prisma.perfilMaestro.findMany({ select: { ... } })`:

```ts
        select: {
          usuarioId: true,
          nombres: true,
          apellidoPaterno: true,
          apellidoMaterno: true,
          cedulaProfesional: true,
          estatus: true,
          tipoLicencia: true,
          usuario: { select: { activo: true } },
        },
```

Y en el `return { data: maestros.map((maestro) => ({ ... })) }`:

```ts
      data: maestros.map((maestro) => ({
        usuarioId: maestro.usuarioId,
        nombres: maestro.nombres,
        apellidoPaterno: maestro.apellidoPaterno,
        apellidoMaterno: maestro.apellidoMaterno,
        cedulaProfesional: maestro.cedulaProfesional,
        estatus: maestro.estatus,
        tipoLicencia: maestro.tipoLicencia,
        activo: maestro.usuario.activo,
      })),
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `cd App/backend && node scripts/run-e2e.js personas-listado`
Expected: PASS — 30/30 (o el total que tenga la suite), incluido `rol=MAESTRO -> 200 ...`.

- [ ] **Step 6: Espejar el tipo en el frontend**

En `App/frontend/src/lib/api/personas.ts`, interfaz `PersonaListItemMaestro`:

```ts
export interface PersonaListItemMaestro {
  usuarioId: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  cedulaProfesional: string | null;
  estatus: EstatusEmpleado;
  /** Solo tiene valor si `estatus === 'LICENCIA'` (tooltip del badge de
   * estatus, feature estética 2026-08-27) — `null` en cualquier otro
   * estatus. */
  tipoLicencia: TipoLicencia | null;
  activo: boolean;
}
```

Verificar que `TipoLicencia` ya está exportado/declarado en ese archivo (lo está — `PersonaListItemAdministrativo` lo usa).

- [ ] **Step 7: Typecheck del frontend**

Run: `cd App/frontend && npx tsc --noEmit`
Expected: exit 0, sin errores. (`app/admin/maestros/page.tsx` todavía no usa el campo nuevo; solo se valida que el tipo compila.)

- [ ] **Step 8: Commit**

```bash
git add App/backend/src/personas/personas.service.ts App/frontend/src/lib/api/personas.ts App/backend/test/personas-listado.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(personas): tipoLicencia en GET /personas?rol=MAESTRO

Paridad con PersonaListItemAdministrativo — lo necesita el tooltip del badge
de estatus en el listado de maestros. Valor real solo con estatus LICENCIA,
null en cualquier otro caso (rastro histórico no se muestra).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019V5xyMuzMvQCaYa2JHbhea
EOF
)"
```

---

### Task 2: Promover `CambiarEstatusModal` a componente compartido

**Files:**
- Move: `App/frontend/src/app/admin/administrativos/CambiarEstatusModal.tsx` → `App/frontend/src/components/admin/ui/personas-listado/CambiarEstatusModal.tsx`
- Modify: el archivo movido (generalizar el tipo del prop, neutralizar el copy)
- Modify: `App/frontend/src/app/admin/administrativos/page.tsx` (import + nombre del prop)

**Interfaces:**
- Consumes: nada de Task 1 (independiente).
- Produces:
  - `CambiarEstatusModal` exportado desde `@/components/admin/ui/personas-listado/CambiarEstatusModal`.
  - `CambiarEstatusModalProps`:
    ```ts
    export interface CambiarEstatusModalProps {
      persona: {
        estatus: EstatusEmpleado;
        nombres: string;
        apellidoPaterno: string;
        apellidoMaterno: string | null;
      };
      guardando: boolean;
      onGuardar: (
        estatus: EstatusEmpleado,
        extra: { tipoLicencia?: TipoLicencia; motivoBaja?: MotivoBaja },
      ) => void;
      onCancelar: () => void;
    }
    ```
  - `PersonaListItemMaestro` y `PersonaListItemAdministrativo` ambos satisfacen estructuralmente el prop `persona`.

- [ ] **Step 1: Mover el archivo con git**

```bash
git mv App/frontend/src/app/admin/administrativos/CambiarEstatusModal.tsx App/frontend/src/components/admin/ui/personas-listado/CambiarEstatusModal.tsx
```

- [ ] **Step 2: Generalizar el prop y neutralizar el copy en el archivo movido**

En `App/frontend/src/components/admin/ui/personas-listado/CambiarEstatusModal.tsx`:

1. En el import de tipos, quitar `PersonaListItemAdministrativo`:

```ts
import type {
  EstatusEmpleado,
  MotivoBaja,
  TipoLicencia,
} from '@/lib/api/personas';
```

2. Reemplazar la interfaz del prop:

```ts
export interface CambiarEstatusModalProps {
  persona: {
    estatus: EstatusEmpleado;
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string | null;
  };
  guardando: boolean;
  onGuardar: (
    estatus: EstatusEmpleado,
    extra: { tipoLicencia?: TipoLicencia; motivoBaja?: MotivoBaja },
  ) => void;
  onCancelar: () => void;
}
```

3. En la firma del componente y su cuerpo, renombrar `administrativo` → `persona`:

```ts
export function CambiarEstatusModal({
  persona,
  guardando,
  onGuardar,
  onCancelar,
}: CambiarEstatusModalProps) {
  const [estatus, setEstatus] = useState<EstatusEmpleado>(persona.estatus);
  const [tipoLicencia, setTipoLicencia] = useState<TipoLicencia | ''>('');
  const [motivoBaja, setMotivoBaja] = useState<MotivoBaja | ''>('');

  const faltaCondicional =
    (estatus === 'LICENCIA' && !tipoLicencia) ||
    (estatus === 'BAJA' && !motivoBaja);

  const nombreCompleto = [
    persona.nombres,
    persona.apellidoPaterno,
    persona.apellidoMaterno,
  ]
    .filter(Boolean)
    .join(' ');
```

4. En el `<p>` del cuerpo, dejar el texto neutro:

```tsx
        <p className="mt-2 text-sm text-slate/80">
          Cambia el estatus de <strong>{nombreCompleto}</strong>.
        </p>
```

5. En el JSDoc de cabecera del archivo, cambiar la primera línea y la descripción para que hable de "una persona (maestro o administrativo)" en vez de "un administrativo". Mantener el resto del comentario (patrón visual, prellenado, idempotencia). Actualizar la referencia de fase a algo como:
   `* `CambiarEstatusModal` — Fase 10 (unificación CRUD admin) / paridad maestros (2026-08-27).`
   y la línea del aviso de revocación: cambiar "de este administrativo" → "de esta persona".

6. El texto del `<p>` de aviso dentro de la rama BAJA:
```tsx
              <p className="mt-2 rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning">
                Esto revocará el acceso a la cuenta de esta persona.
              </p>
```

No tocar: los mapas `ESTATUS_EMPLEADO_LABEL` / `TIPO_LICENCIA_LABEL` / `MOTIVO_BAJA_LABEL` y sus `*_OPTIONS`, la estructura visual, la lógica del `onClick` de Guardar (ya filtra `tipoLicencia`/`motivoBaja` por el `estatus` final elegido).

- [ ] **Step 3: Actualizar el import y el prop en `administrativos/page.tsx`**

En `App/frontend/src/app/admin/administrativos/page.tsx`:

1. Línea del import (actualmente `import { CambiarEstatusModal } from './CambiarEstatusModal';`):

```ts
import { CambiarEstatusModal } from '@/components/admin/ui/personas-listado/CambiarEstatusModal';
```

Colocarlo junto a los otros imports de `@/components/admin/ui/personas-listado/...` (orden de imports del archivo).

2. En el render del modal, renombrar el prop `administrativo` → `persona`:

```tsx
      {administrativoAEditar && (
        <CambiarEstatusModal
          persona={administrativoAEditar}
          guardando={cambiarEstatusMutation.isPending}
          onGuardar={(estatusNuevo, extra) =>
            cambiarEstatusMutation.mutate({
              usuarioId: administrativoAEditar.usuarioId,
              estatus: estatusNuevo,
              ...extra,
            })
          }
          onCancelar={() => setAdministrativoAEditar(null)}
        />
      )}
```

El resto de `administrativos/page.tsx` (la lógica de `JERARQUIA_NIVEL_PERMISO`, el ocultar el botón en la fila del actor) NO se toca — vive en la página, no en el modal.

- [ ] **Step 4: Typecheck + build del frontend**

Run: `cd App/frontend && npx tsc --noEmit && pnpm build`
Expected: `tsc` exit 0; `pnpm build` termina sin errores. Confirma que administrativos sigue compilando con el modal en su nueva ubicación y el prop renombrado.

- [ ] **Step 5: Commit**

```bash
git add App/frontend/src/components/admin/ui/personas-listado/CambiarEstatusModal.tsx App/frontend/src/app/admin/administrativos/page.tsx
git commit -m "$(cat <<'EOF'
refactor(admin): CambiarEstatusModal a componente compartido

Movido de app/admin/administrativos/ a components/admin/ui/personas-listado/
(mismo criterio que EstatusEmpleadoBadge). Prop generalizado de
PersonaListItemAdministrativo a { estatus, nombres, apellidoPaterno,
apellidoMaterno } para que lo pueda consumir también el listado de maestros.
El modal nunca tuvo lógica de jerarquía — esa vive en la página.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019V5xyMuzMvQCaYa2JHbhea
EOF
)"
```

---

### Task 3: Página de maestros — badge de color + acción "Cambiar estatus"

**Files:**
- Modify: `App/frontend/src/app/admin/maestros/page.tsx` (reescritura completa — ver Step 1)

**Interfaces:**
- Consumes:
  - `PersonaListItemMaestro` con `tipoLicencia: TipoLicencia | null` (Task 1).
  - `CambiarEstatusModal` de `@/components/admin/ui/personas-listado/CambiarEstatusModal` con prop `persona` (Task 2).
  - `cambiarEstatusPersona(usuarioId: string, estatus: string, extra?: { tipoLicencia?: string; motivoBaja?: string }): Promise<{ ok: true }>` (ya existe en `lib/api/personas.ts`).
  - `EstatusEmpleadoBadge` de `@/components/admin/ui/personas-listado/EstatusEmpleadoBadge` con props `{ estatus: EstatusEmpleado; tipoLicencia?: TipoLicencia | null }` (ya existe).
- Produces: nada que consuman tareas posteriores.

- [ ] **Step 1: Reescribir `app/admin/maestros/page.tsx`**

Contenido completo del archivo (calco de `administrativos/page.tsx` sin la parte de jerarquía de `nivelPermiso` ni el ocultar-en-fila-del-actor — un `ADMINISTRATIVO` nunca es un `MAESTRO`, no hay caso de "fila propia"):

```tsx
'use client';

import Link from 'next/link';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api/http';
import {
  cambiarEstatusPersona,
  listarMaestros,
  type EstatusEmpleado,
  type MotivoBaja,
  type PersonaListItemMaestro,
  type TipoLicencia,
} from '@/lib/api/personas';
import { BuscadorFiltro } from '@/components/admin/ui/personas-listado/BuscadorFiltro';
import { Paginacion } from '@/components/admin/ui/personas-listado/Paginacion';
import { EstadoActivoBadge } from '@/components/admin/ui/personas-listado/EstadoActivoBadge';
import { EstatusEmpleadoBadge } from '@/components/admin/ui/personas-listado/EstatusEmpleadoBadge';
import { CambiarEstatusModal } from '@/components/admin/ui/personas-listado/CambiarEstatusModal';
import { useBuscarDebounced } from '@/components/admin/ui/personas-listado/useBuscarDebounced';
import { usePaginacionFiltrada } from '@/components/admin/ui/personas-listado/usePaginacionFiltrada';

/**
 * Listado de maestros — Fase 5, Día 19; acción "Cambiar estatus" agregada en
 * paridad con administrativos (2026-08-27).
 *
 * Mismo patrón que `app/admin/administrativos/page.tsx` — mismo
 * `BuscadorFiltro`/`Paginacion`/`useBuscarDebounced`/`usePaginacionFiltrada`,
 * misma estructura de tabla, mismo `EstatusEmpleadoBadge` y
 * `CambiarEstatusModal` (compartidos en `components/admin/ui/personas-listado/`).
 *
 * A diferencia de administrativos, acá NO hay lógica de jerarquía de
 * `nivelPermiso` (es exclusivo de `PerfilAdministrativo`; el backend de
 * `PATCH /personas/:id/estatus` no corre ese chequeo para target MAESTRO) ni
 * de "ocultar el botón en la fila del actor" (un `ADMINISTRATIVO` nunca es un
 * `MAESTRO`). Cualquier `ADMINISTRATIVO` puede cambiar el estatus de
 * cualquier maestro de su sede.
 */
export default function AdminMaestrosPage() {
  const queryClient = useQueryClient();
  const { inputValue, setInputValue, buscar } = useBuscarDebounced();
  const { estatus, setEstatus, page, setPage, limit } =
    usePaginacionFiltrada(buscar);
  const [maestroAEditar, setMaestroAEditar] =
    useState<PersonaListItemMaestro | null>(null);

  const {
    data: resultado,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['admin', 'personas', 'MAESTRO', buscar, estatus, page, limit],
    queryFn: async () => {
      try {
        return await listarMaestros({
          buscar: buscar || undefined,
          estatus: estatus || undefined,
          page,
          limit,
        });
      } catch (err) {
        // Regla 12 de `CLAUDE.md` raíz — loguear antes de dejar que React
        // Query marque `isError` y la UI muestre el mensaje genérico.
        console.error('[AdminMaestrosPage] Error al listar maestros:', err);
        throw err;
      }
    },
    placeholderData: keepPreviousData,
  });

  const cambiarEstatusMutation = useMutation({
    mutationFn: (vars: {
      usuarioId: string;
      estatus: EstatusEmpleado;
      tipoLicencia?: TipoLicencia;
      motivoBaja?: MotivoBaja;
    }) =>
      cambiarEstatusPersona(vars.usuarioId, vars.estatus, {
        tipoLicencia: vars.tipoLicencia,
        motivoBaja: vars.motivoBaja,
      }),
    onSuccess: () => {
      toast.success('Estatus actualizado');
      setMaestroAEditar(null);
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'personas', 'MAESTRO'],
      });
    },
    onError: (err) => {
      // Regla 12 de `CLAUDE.md` raíz.
      console.error('[AdminMaestrosPage] Error al cambiar el estatus:', err);
      const mensaje =
        err instanceof ApiError
          ? err.message
          : 'No se pudo cambiar el estatus. Intenta de nuevo más tarde.';
      toast.error(mensaje);
    },
  });

  return (
    <div className="rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-navy">Maestros</h1>
        <Link
          href="/admin/maestros/nuevo"
          className="inline-block rounded-lg bg-navy px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
        >
          Dar de alta un maestro
        </Link>
      </div>

      <div className="mt-6">
        <BuscadorFiltro
          buscarInput={inputValue}
          onBuscarChange={setInputValue}
          buscarPlaceholder="Nombre, apellido o cédula profesional…"
          estatus={estatus}
          onEstatusChange={setEstatus}
          estatusOptions={ESTATUS_EMPLEADO_OPTIONS}
        />
      </div>

      <div className="mt-6">
        {isLoading ? (
          <p className="text-sm text-slate/60">Cargando…</p>
        ) : isError ? (
          <p className="rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-crimson">
            {error instanceof ApiError
              ? error.message
              : 'No se pudo cargar el listado de maestros. Intenta de nuevo más tarde.'}
          </p>
        ) : !resultado || resultado.data.length === 0 ? (
          <p className="text-sm text-slate/60">
            No se encontraron maestros con esos criterios.
          </p>
        ) : (
          <>
            <TablaMaestros
              maestros={resultado.data}
              onCambiarEstatus={setMaestroAEditar}
            />
            <div className="mt-4">
              <Paginacion
                page={resultado.page}
                limit={resultado.limit}
                total={resultado.total}
                onPageChange={setPage}
              />
            </div>
          </>
        )}
      </div>

      {maestroAEditar && (
        <CambiarEstatusModal
          persona={maestroAEditar}
          guardando={cambiarEstatusMutation.isPending}
          onGuardar={(estatusNuevo, extra) =>
            cambiarEstatusMutation.mutate({
              usuarioId: maestroAEditar.usuarioId,
              estatus: estatusNuevo,
              ...extra,
            })
          }
          onCancelar={() => setMaestroAEditar(null)}
        />
      )}
    </div>
  );
}

function TablaMaestros({
  maestros,
  onCambiarEstatus,
}: {
  maestros: PersonaListItemMaestro[];
  onCambiarEstatus: (maestro: PersonaListItemMaestro) => void;
}) {
  return (
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
          {maestros.map((maestro) => (
            <tr key={maestro.usuarioId}>
              <Td>
                {[maestro.nombres, maestro.apellidoPaterno, maestro.apellidoMaterno]
                  .filter(Boolean)
                  .join(' ')}
              </Td>
              <Td>{maestro.cedulaProfesional || '—'}</Td>
              <Td>
                <EstatusEmpleadoBadge
                  estatus={maestro.estatus}
                  tipoLicencia={maestro.tipoLicencia}
                />
              </Td>
              <Td>
                <EstadoActivoBadge activo={maestro.activo} />
              </Td>
              <Td>
                <button
                  type="button"
                  onClick={() => onCambiarEstatus(maestro)}
                  className="text-navy hover:underline"
                >
                  Cambiar estatus
                </button>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2 text-left text-xs font-semibold tracking-wide text-slate/60 uppercase">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 text-slate">{children}</td>;
}

const ESTATUS_EMPLEADO_LABEL: Record<EstatusEmpleado, string> = {
  ACTIVO: 'Activo',
  BAJA: 'Baja',
  LICENCIA: 'Licencia',
};

const ESTATUS_EMPLEADO_OPTIONS = (
  Object.entries(ESTATUS_EMPLEADO_LABEL) as Array<[EstatusEmpleado, string]>
).map(([value, label]) => ({ value, label }));
```

Notas:
- `ESTATUS_EMPLEADO_LABEL` se conserva porque `ESTATUS_EMPLEADO_OPTIONS` (filtro del `BuscadorFiltro`) lo usa. Ya no se usa en la celda de estatus (ahora es `<EstatusEmpleadoBadge />`).
- El import de `ApiError` (`@/lib/api/http`) ya estaba en el archivo original.

- [ ] **Step 2: Typecheck + build del frontend**

Run: `cd App/frontend && npx tsc --noEmit && pnpm build`
Expected: `tsc` exit 0; `pnpm build` sin errores.

- [ ] **Step 3: Verificación manual mínima (opcional, no bloqueante para el commit)**

Con los servidores corriendo (`:3001` backend, `:3000` frontend), abrir `/admin/maestros`:
- La columna "Estatus" muestra el badge de color (verde ACTIVO / ámbar LICENCIA / rojo BAJA).
- Botón "Cambiar estatus" por fila abre el modal.
- Elegir LICENCIA muestra el select de tipo de licencia; BAJA muestra el de motivo con el aviso de revocación para RENUNCIA/DESPIDO.
- Guardar refresca la fila.
Máximo 3 escrituras reales (regla 14).

- [ ] **Step 4: Commit**

```bash
git add App/frontend/src/app/admin/maestros/page.tsx
git commit -m "$(cat <<'EOF'
feat(admin): cambiar estatus de maestro desde el listado

Paridad con administrativos: badge de color con tooltip de motivo de
licencia + columna Acciones con "Cambiar estatus" que abre el modal
compartido (tipoLicencia si LICENCIA, motivoBaja si BAJA con aviso de
revocación). Sin jerarquía de nivelPermiso ni guardia de fila propia — no
aplican a target MAESTRO.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019V5xyMuzMvQCaYa2JHbhea
EOF
)"
```

---

### Task 4: e2e — cobertura del path avanzado para target MAESTRO

**Files:**
- Modify: `App/backend/test/personas-estatus.e2e-spec.ts` (helper nuevo `crearMaestroFixture` + bloque de tests MAESTRO)

**Interfaces:**
- Consumes: nada de tareas frontend. Depende solo del backend ya existente (`PATCH /personas/:id/estatus` simétrico para MAESTRO).
- Produces: nada.

**Contexto:** el archivo ya tiene `crearAdministrativoFixture`, `firmarToken`, `usuarioIdsCreados` (limpiado en `afterAll`), `sedeMeridaId`, `actorAdminId`. Los tests del "path avanzado" existentes (líneas ~423+) usan target ADMINISTRATIVO. Este task agrega el equivalente para MAESTRO.

- [ ] **Step 1: Agregar el helper `crearMaestroFixture`**

En `App/backend/test/personas-estatus.e2e-spec.ts`, junto a `crearAdministrativoFixture` (después de esa función), agregar:

```ts
  async function crearMaestroFixture(params: {
    sedeId: string;
    estatus?: EstatusEmpleado;
  }): Promise<string> {
    const usuario = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.estatus.maestro.${randomUUID()}@example.com`,
        rol: RolUsuario.MAESTRO,
        sedeId: params.sedeId,
      },
    });
    await prisma.perfilMaestro.create({
      data: {
        usuarioId: usuario.id,
        nombres: 'Fixture',
        apellidoPaterno: 'EstatusMaestro',
        curp: `FX${randomUUID().slice(0, 16).toUpperCase()}`,
        correoPersonal: `fixture.estatus.maestro.personal.${randomUUID()}@example.com`,
        telefono: '9990009999',
        fechaContratacion: new Date('2024-01-01'),
        estatus: params.estatus ?? EstatusEmpleado.ACTIVO,
      },
    });
    usuarioIdsCreados.push(usuario.id);
    return usuario.id;
  }
```

(No lleva `nivelPermiso`/`puesto` — `PerfilMaestro` no los tiene. `usuarioIdsCreados.push` asegura que `afterAll` lo borre.)

- [ ] **Step 2: Agregar el bloque de tests MAESTRO al final del `describe`**

Antes del cierre del `describe(...)` (después del último `it` del path avanzado), agregar:

```ts
  // --- Estatus avanzado — target MAESTRO (2026-08-27, paridad con
  // ADMINISTRATIVO). El backend ya era simétrico (mismos campos en
  // PerfilMaestro, calcularActivoPorEstatus no distingue rol salvo excluir
  // ALUMNO) pero no estaba cubierto por e2e — todos los casos de arriba usan
  // target ADMINISTRATIVO. No hay jerarquía de nivelPermiso para target
  // MAESTRO, así que el actor ADMIN basta para todos.

  it('MAESTRO: LICENCIA sin tipoLicencia -> 400 VALIDATION_ERROR', async () => {
    const objetivoId = await crearMaestroFixture({ sedeId: sedeMeridaId });

    const res = await request(app.getHttpServer())
      .patch(`/personas/${objetivoId}/estatus`)
      .send({ estatus: 'LICENCIA' })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(actorAdminId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('MAESTRO: LICENCIA con tipoLicencia -> 200, NO revoca Usuario.activo y persiste tipoLicencia en PerfilMaestro', async () => {
    const objetivoId = await crearMaestroFixture({ sedeId: sedeMeridaId });

    const res = await request(app.getHttpServer())
      .patch(`/personas/${objetivoId}/estatus`)
      .send({ estatus: 'LICENCIA', tipoLicencia: 'MATERNIDAD' })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(actorAdminId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(200);

    const perfil = await prisma.perfilMaestro.findUnique({
      where: { usuarioId: objetivoId },
      select: { estatus: true, tipoLicencia: true },
    });
    expect(perfil?.estatus).toBe('LICENCIA');
    expect(perfil?.tipoLicencia).toBe('MATERNIDAD');

    const usuario = await prisma.usuario.findUnique({
      where: { id: objetivoId },
      select: { activo: true },
    });
    expect(usuario?.activo).toBe(true);

    const registro = await prisma.registroAuditoria.findFirst({
      where: { entidadId: objetivoId, accion: AccionAuditoria.CAMBIO_ESTATUS },
      orderBy: { fecha: 'desc' },
    });
    expect(
      (registro?.detalle as Record<string, unknown> | null)?.cuentaRevocada,
    ).toBe(false);
  });

  it('MAESTRO: BAJA, motivoBaja: RENUNCIA -> 200, revoca Usuario.activo y RegistroAuditoria.detalle marca cuentaRevocada: true', async () => {
    const objetivoId = await crearMaestroFixture({ sedeId: sedeMeridaId });

    const res = await request(app.getHttpServer())
      .patch(`/personas/${objetivoId}/estatus`)
      .send({ estatus: 'BAJA', motivoBaja: 'RENUNCIA' })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(actorAdminId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(200);

    const usuario = await prisma.usuario.findUnique({
      where: { id: objetivoId },
      select: { activo: true },
    });
    expect(usuario?.activo).toBe(false);

    const registro = await prisma.registroAuditoria.findFirst({
      where: { entidadId: objetivoId, accion: AccionAuditoria.CAMBIO_ESTATUS },
      orderBy: { fecha: 'desc' },
    });
    expect(
      (registro?.detalle as Record<string, unknown> | null)?.cuentaRevocada,
    ).toBe(true);
  });

  it('MAESTRO: BAJA, motivoBaja: BAJA_TEMPORAL_SALUD -> 200, NO revoca Usuario.activo', async () => {
    const objetivoId = await crearMaestroFixture({ sedeId: sedeMeridaId });

    const res = await request(app.getHttpServer())
      .patch(`/personas/${objetivoId}/estatus`)
      .send({ estatus: 'BAJA', motivoBaja: 'BAJA_TEMPORAL_SALUD' })
      .set(
        'Authorization',
        `Bearer ${await firmarToken(actorAdminId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
      );

    expect(res.status).toBe(200);

    const usuario = await prisma.usuario.findUnique({
      where: { id: objetivoId },
      select: { activo: true },
    });
    expect(usuario?.activo).toBe(true);
  });

  it('MAESTRO: reingreso vía ACTIVO tras BAJA por RENUNCIA -> 200, reactiva Usuario.activo y NO limpia motivoBaja (rastro histórico)', async () => {
    const objetivoId = await crearMaestroFixture({ sedeId: sedeMeridaId });
    const auth = `Bearer ${await firmarToken(actorAdminId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`;

    await request(app.getHttpServer())
      .patch(`/personas/${objetivoId}/estatus`)
      .send({ estatus: 'BAJA', motivoBaja: 'RENUNCIA' })
      .set('Authorization', auth);

    const res = await request(app.getHttpServer())
      .patch(`/personas/${objetivoId}/estatus`)
      .send({ estatus: 'ACTIVO' })
      .set('Authorization', auth);

    expect(res.status).toBe(200);

    const usuario = await prisma.usuario.findUnique({
      where: { id: objetivoId },
      select: { activo: true },
    });
    expect(usuario?.activo).toBe(true);

    const perfil = await prisma.perfilMaestro.findUnique({
      where: { usuarioId: objetivoId },
      select: { estatus: true, motivoBaja: true },
    });
    expect(perfil?.estatus).toBe('ACTIVO');
    expect(perfil?.motivoBaja).toBe('RENUNCIA');
  });
```

Si el `describe` tiene un `it` "opcional" al final (ver el de ALUMNO), insertar este bloque después de ese `it` y antes del `});` que cierra el `describe`.

- [ ] **Step 3: Correr la suite de estatus y verificar que pasa**

Run: `cd App/backend && node scripts/run-e2e.js personas-estatus`
Expected: PASS — todos los `it` verdes, incluidos los 5 nuevos de MAESTRO.

- [ ] **Step 4: Correr la suite e2e completa**

Run: `cd App/backend && node scripts/run-e2e.js`
Expected: todas las suites en verde (el total sube en 5 por los tests nuevos de este task + 0 por el de Task 1, que reemplazó un assert). Sin fallos.

- [ ] **Step 5: Commit**

```bash
git add App/backend/test/personas-estatus.e2e-spec.ts
git commit -m "$(cat <<'EOF'
test(personas): cobertura e2e del path de estatus avanzado para target MAESTRO

El backend ya era simétrico para MAESTRO pero solo estaba probado contra
target ADMINISTRATIVO. Agrega fixture MAESTRO + casos: LICENCIA sin tipo->400,
LICENCIA con tipo->no revoca, BAJA+RENUNCIA->revoca, BAJA_TEMPORAL_SALUD->no
revoca, reingreso ACTIVO->reactiva sin limpiar motivoBaja.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019V5xyMuzMvQCaYa2JHbhea
EOF
)"
```

---

### Task 5: Docs — `CLAUDE.md` + `ESTADO.md`

**Files:**
- Modify: `CLAUDE.md` (sección "Contrato de API", entrada de `GET /personas` y `PATCH /personas/:id/estatus`; regla 13 / estado de implementación)
- Modify: `documentacion_de_agentes/ESTADO.md` (entrada nueva al final)

**Interfaces:**
- Consumes: nada. Documenta lo hecho en Tasks 1-4.
- Produces: nada.

- [ ] **Step 1: Actualizar `CLAUDE.md`**

1. En la entrada de `GET /personas?rol=ALUMNO|MAESTRO|ADMINISTRATIVO...`, donde describe el shape de MAESTRO:
   `de MAESTRO: `{ usuarioId, nombres, apellidoPaterno, apellidoMaterno, cedulaProfesional, estatus, activo }``
   cambiar a incluir `tipoLicencia`:
   `de MAESTRO: `{ usuarioId, nombres, apellidoPaterno, apellidoMaterno, cedulaProfesional, estatus, tipoLicencia, activo }``
   y en la nota que hoy dice
   `MAESTRO no lo trae porque no tiene UI de cambio de estatus todavía (Día 19), nadie lo pidió ahí.`
   reemplazar por:
   `MAESTRO también lo trae desde la paridad de estatus con ADMINISTRATIVO (2026-08-27) — su listado ya tiene UI de cambio de estatus. Mismo criterio de "null salvo estatus LICENCIA actual".`

2. En la entrada de `PATCH /personas/:id/estatus`, en el párrafo de "Estatus avanzado", donde dice
   `Backend simétrico para `MAESTRO` desde este cambio (mismos campos en el schema) aunque `app/admin/maestros/page.tsx` sigue sin UI de cambio de estatus (Día 19, solo lectura) — nadie la pidió todavía.`
   reemplazar por:
   `Backend simétrico para `MAESTRO` desde este cambio; `app/admin/maestros/page.tsx` ya consume el path avanzado (paridad con administrativos, 2026-08-27) — badge de color + modal `CambiarEstatusModal` compartido. Sin jerarquía de `nivelPermiso` para target MAESTRO. Cobertura e2e del path MAESTRO agregada en `personas-estatus.e2e-spec.ts` (antes solo target ADMINISTRATIVO).`

3. En la regla 13 (bloque "Estado de implementación"), agregar una línea al final del párrafo indicando:
   `El modal `CambiarEstatusModal` se promovió a `components/admin/ui/personas-listado/` (2026-08-27, compartido entre los listados de administrativos y maestros, mismo criterio que `EstatusEmpleadoBadge`); la lógica de jerarquía de `nivelPermiso` vive en cada página, no en el modal.`

- [ ] **Step 2: Agregar entrada a `documentacion_de_agentes/ESTADO.md`**

Al final del archivo, agregar una sección nueva:

```markdown
### Cambio de estatus para MAESTRO (paridad con ADMINISTRATIVO) — ✅ CERRADO EN CÓDIGO (2026-08-27)

- **Contexto**: el backend de `PATCH /personas/:id/estatus` ya era simétrico
  para MAESTRO desde la migración de estatus avanzado (2026-08-26), pero
  `app/admin/maestros/page.tsx` seguía en solo lectura (Día 19) y el path
  MAESTRO no estaba cubierto por e2e (todos los casos usaban target
  ADMINISTRATIVO, pese a que ESTADO.md decía "mismos casos para MAESTRO").
- **Task 1 (backend)**: `tipoLicencia: TipoLicencia | null` agregado a
  `PersonaListItemMaestro` (backend + espejo frontend) y al `select`/`map` de
  la rama MAESTRO de `listarPorSedeYRol`. Assert de llaves de
  `personas-listado.e2e-spec.ts` (rol=MAESTRO) actualizado.
- **Task 2 (refactor)**: `CambiarEstatusModal` movido de
  `app/admin/administrativos/` a `components/admin/ui/personas-listado/`
  (`git mv`), prop generalizado de `PersonaListItemAdministrativo` a
  `{ estatus, nombres, apellidoPaterno, apellidoMaterno }`. El modal nunca
  tuvo lógica de jerarquía — vive en la página. `administrativos/page.tsx`
  actualizado (import + prop `persona`).
- **Task 3 (frontend maestros)**: `maestros/page.tsx` calca
  `administrativos/page.tsx` sin la parte de jerarquía de `nivelPermiso` ni
  el ocultar-en-fila-del-actor (un ADMINISTRATIVO nunca es un MAESTRO).
  `EstatusEmpleadoBadge` con tooltip + columna "Acciones" con "Cambiar
  estatus" + `useMutation` que invalida `['admin','personas','MAESTRO']`.
- **Task 4 (e2e)**: helper `crearMaestroFixture` + 5 casos MAESTRO en
  `personas-estatus.e2e-spec.ts` (LICENCIA sin tipo→400, LICENCIA con
  tipo→no revoca + persiste, BAJA+RENUNCIA→revoca, BAJA_TEMPORAL_SALUD→no
  revoca, reingreso ACTIVO→reactiva sin limpiar motivoBaja).
- **Fuera de alcance**: dedup de `TIPO_LICENCIA_LABEL` entre badge y modal;
  UI de estatus para ALUMNO; mostrar `motivoBaja` en la tabla.
- **Pendiente**: verificación manual en navegador; push a `origin/dev`.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md documentacion_de_agentes/ESTADO.md
git commit -m "$(cat <<'EOF'
docs: paridad de cambio de estatus entre maestros y administrativos

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019V5xyMuzMvQCaYa2JHbhea
EOF
)"
```

---

## Verificación final (tras Task 5)

Correr en orden y confirmar salida antes de declarar el trabajo completo:

- [ ] `cd App/backend && npx tsc --noEmit` → exit 0
- [ ] `cd App/frontend && npx tsc --noEmit` → exit 0
- [ ] `cd App/frontend && pnpm build` → sin errores
- [ ] `cd App/backend && node scripts/run-e2e.js` → todas las suites en verde
- [ ] `git log --oneline origin/dev..dev` → 5 commits nuevos (Tasks 1-5), árbol limpio (`git status`)
- [ ] Verificación manual en navegador (usuario): `/admin/maestros` — badge de color, botón "Cambiar estatus", selects condicionales de licencia/motivo, aviso de revocación, refresco de la fila al guardar. Máximo 3 escrituras reales (regla 14).

## Self-Review (hecho al escribir el plan)

- **Spec coverage:** las 5 secciones del spec (backend, modal compartido, frontend maestros, tests, docs) → Tasks 1-5 respectivamente. El hallazgo del gap de cobertura e2e → Task 4.
- **Placeholder scan:** sin TBD/TODO; todo el código está inline.
- **Type consistency:** `cambiarEstatusPersona(usuarioId, estatus, extra)` usado igual en Task 3 que su firma real en `lib/api/personas.ts`. `CambiarEstatusModalProps.persona` (Task 2) coincide con lo que Task 3 le pasa (`PersonaListItemMaestro` tiene `estatus`/`nombres`/`apellidoPaterno`/`apellidoMaterno`). `TipoLicencia`/`MotivoBaja` importados de `@/lib/api/personas` en todos los archivos frontend que los usan. El `onGuardar` del modal entrega `(estatus, extra)` y Task 3 hace `mutate({ usuarioId, estatus, ...extra })` — la mutación acepta `{ usuarioId, estatus, tipoLicencia?, motivoBaja? }`, y `extra` es `{ tipoLicencia?, motivoBaja? }`. Consistente.
