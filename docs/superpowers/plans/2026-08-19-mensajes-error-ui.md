# Mensajes de error en UI + UX rota — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar Día 22 (sub-proyectos 2 y 3): que cualquier fetch/mutation fallido en `app/admin/*` y `app/plataforma/*` muestre un mensaje claro al usuario Y loguee contexto de debug real (`console.error` con `err` + variables relevantes) antes de fallar — replicando el patrón ya usado en el resto del árbol donde falta, sin inventar uno nuevo.

**Architecture:** Cambios puntuales y mecánicos en 5 archivos existentes (React Query `queryFn`/`onError`), sin nuevos componentes ni endpoints. Un archivo (`app/plataforma/sedes/page.tsx`) gana además una rama JSX `isError` que hoy no existe — es el único gap real de UI, el resto son solo gaps de logging (regla 12 de `CLAUDE.md` raíz).

**Tech Stack:** Next.js (App Router) + TypeScript + React Query v5 + `sonner` (toasts). Sin librerías nuevas.

## Global Constraints

- Nunca loguear `password`/`passwordActual`/`passwordNueva` ni ninguna credencial en `console.error`, aunque esté disponible en el closure (spec, sección "Diseño de la corrección").
- No cambiar ningún mensaje visible al usuario ni ninguna lógica de negocio — solo agregar logging y, en un caso, una rama de error visual que ya sigue el patrón existente.
- No tocar `app/alumno`/`app/maestro` (fuera de alcance, decisión explícita del usuario).
- No tocar el modal de sedes (a11y) ni el botón "Copiar" — ambos fuera de alcance.
- Verificación de este proyecto en frontend: `npx tsc --noEmit` + `npx eslint <archivos tocados>` (no hay suite de tests en `App/frontend/src` — confirmado, `App/frontend` no tiene ningún `*.test.ts(x)`/`*.spec.ts(x)` propio). Sin `pnpm build` (puede haber un `pnpm dev` corriendo — mismo criterio ya documentado en `ESTADO.md`).

---

### Task 1: `app/admin/perfil/page.tsx` + `app/admin/alumnos/nuevo/page.tsx`

**Files:**
- Modify: `App/frontend/src/app/admin/perfil/page.tsx:36-44`
- Modify: `App/frontend/src/app/admin/alumnos/nuevo/page.tsx:155-158`

**Interfaces:**
- Consumes: `obtenerPerfil(): Promise<Perfil>` (`@/lib/api/perfil`, sin cambios), `listarCarreras(): Promise<Carrera[]>` (`@/lib/api/carreras`, sin cambios).
- Produces: nada — ambos son hojas del árbol de componentes, no los consume ninguna otra tarea.

- [ ] **Step 1: Envolver `queryFn` de `obtenerPerfil` con logging**

En `App/frontend/src/app/admin/perfil/page.tsx`, el bloque actual (líneas 41-44) es:

```tsx
  const {
    data: perfil,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['admin', 'perfil'],
    queryFn: obtenerPerfil,
  });
```

Reemplázalo por:

```tsx
  const {
    data: perfil,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['admin', 'perfil'],
    queryFn: async () => {
      try {
        return await obtenerPerfil();
      } catch (err) {
        // Regla 12 de `CLAUDE.md` raíz — loguear antes de dejar que React
        // Query marque `isError` y la UI muestre el mensaje genérico.
        console.error('[AdminPerfilPage] Error al obtener el perfil:', err);
        throw err;
      }
    },
  });
```

Mismo patrón exacto que `app/admin/alumnos/page.tsx`/`app/admin/maestros/page.tsx`/`app/admin/page.tsx` — sin parámetros relevantes que loguear (es el perfil propio del actor, sin `id` externo), así que no lleva objeto de contexto adicional.

- [ ] **Step 2: Envolver `queryFn` de `listarCarreras` (dropdown) con logging**

En `App/frontend/src/app/admin/alumnos/nuevo/page.tsx`, el bloque actual (líneas 155-158) es:

```tsx
  const carrerasQuery = useQuery({
    queryKey: ['carreras'],
    queryFn: listarCarreras,
  });
```

Reemplázalo por:

```tsx
  const carrerasQuery = useQuery({
    queryKey: ['carreras'],
    queryFn: async () => {
      try {
        return await listarCarreras();
      } catch (err) {
        // Regla 12 de `CLAUDE.md` raíz — loguear antes de dejar que React
        // Query marque `isError` (ya renderizado inline junto al campo,
        // ver más abajo en este mismo archivo).
        console.error('[AdminAlumnosNuevoPage] Error al listar carreras:', err);
        throw err;
      }
    },
  });
```

No toques el bloque `{carrerasQuery.isError && (...)}` más abajo en el mismo archivo — ya renderiza el mensaje correcto, solo le faltaba el log.

- [ ] **Step 3: Verificar tipos y lint**

Run: `cd App/frontend && npx tsc --noEmit`
Expected: sin salida, exit 0.

Run: `cd App/frontend && npx eslint src/app/admin/perfil/page.tsx src/app/admin/alumnos/nuevo/page.tsx`
Expected: sin salida, exit 0.

- [ ] **Step 4: Verificación manual del comportamiento (sin backend)**

No hay suite de tests en este árbol — la verificación es leer el diff y confirmar:
1. `perfil/page.tsx`: si `obtenerPerfil()` rechaza, la consola del navegador muestra `[AdminPerfilPage] Error al obtener el perfil: <Error>` ANTES de que la UI caiga al bloque `isError` ya existente (mensaje "No se pudo cargar tu perfil...").
2. `alumnos/nuevo/page.tsx`: si `listarCarreras()` rechaza, la consola muestra `[AdminAlumnosNuevoPage] Error al listar carreras: <Error>` y el campo de carrera sigue mostrando "No se pudieron cargar las carreras..." (sin cambios ahí).

- [ ] **Step 5: Commit**

```bash
git add App/frontend/src/app/admin/perfil/page.tsx App/frontend/src/app/admin/alumnos/nuevo/page.tsx
git commit -m "fix(frontend): loguea errores de queryFn en perfil admin y dropdown de carreras

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `app/plataforma/page.tsx` + `app/plataforma/sedes/page.tsx` + `app/plataforma/login/page.tsx`

**Files:**
- Modify: `App/frontend/src/app/plataforma/page.tsx:24-27`
- Modify: `App/frontend/src/app/plataforma/sedes/page.tsx:36-84`
- Modify: `App/frontend/src/app/plataforma/sedes/page.tsx:216-224`
- Modify: `App/frontend/src/app/plataforma/login/page.tsx:22-37`

**Interfaces:**
- Consumes: `obtenerResumenGlobal(): Promise<ResumenGlobal>`, `listarSedes(): Promise<Sede[]>`, `crearSede(input: SedeInput): Promise<Sede>`, `actualizarSede(id: string, input: Partial<SedeInput>): Promise<Sede>`, `eliminarSede(id: string): Promise<{ ok: true }>` (todos `@/lib/api/sedes`, sin cambios); `loginPlatformAdmin(email: string, password: string): Promise<{ token: string }>` (`@/lib/api/platform-admin`, sin cambios); `ApiError` (`@/lib/api/http`, ya importado en `sedes/page.tsx` y `login/page.tsx`, falta importarlo en `plataforma/page.tsx` — ya está importado ahí también, confirmado en el archivo actual).
- Produces: nada — hojas del árbol, ninguna otra tarea las consume.

- [ ] **Step 1: Envolver `queryFn` de `obtenerResumenGlobal` con logging**

En `App/frontend/src/app/plataforma/page.tsx`, el bloque actual (líneas 24-27) es:

```tsx
  const resumenQuery = useQuery({
    queryKey: ['plataforma', 'resumen'],
    queryFn: obtenerResumenGlobal,
  });
```

Reemplázalo por:

```tsx
  const resumenQuery = useQuery({
    queryKey: ['plataforma', 'resumen'],
    queryFn: async () => {
      try {
        return await obtenerResumenGlobal();
      } catch (err) {
        console.error('[PlataformaDashboardPage] Error al obtener el resumen global:', err);
        throw err;
      }
    },
  });
```

El bloque `{resumenQuery.isError && (...)}` de más abajo ya existe y no cambia.

- [ ] **Step 2: Envolver `queryFn` de `listarSedes` con logging**

En `App/frontend/src/app/plataforma/sedes/page.tsx`, el bloque actual (líneas 36-39) es:

```tsx
  const sedesQuery = useQuery({
    queryKey: ['plataforma', 'sedes'],
    queryFn: listarSedes,
  });
```

Reemplázalo por:

```tsx
  const sedesQuery = useQuery({
    queryKey: ['plataforma', 'sedes'],
    queryFn: async () => {
      try {
        return await listarSedes();
      } catch (err) {
        console.error('[PlataformaSedesPage] Error al listar sedes:', err);
        throw err;
      }
    },
  });
```

- [ ] **Step 3: Agregar `console.error` con contexto a las 3 mutaciones de sedes**

En el mismo archivo, el bloque actual (líneas 41-84) es:

```tsx
  const crearMutation = useMutation({
    mutationFn: (input: SedeInput) => crearSede(input),
    onSuccess: () => {
      toast.success('Sede creada');
      setForm(FORM_VACIO);
      void queryClient.invalidateQueries({ queryKey: ['plataforma', 'sedes'] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Error al crear la sede');
    },
  });

  const actualizarMutation = useMutation({
    mutationFn: (vars: { id: string; input: SedeInput }) =>
      actualizarSede(vars.id, vars.input),
    onSuccess: () => {
      toast.success('Sede actualizada');
      setForm(FORM_VACIO);
      setEditandoId(null);
      void queryClient.invalidateQueries({ queryKey: ['plataforma', 'sedes'] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Error al actualizar la sede');
    },
  });

  const eliminarMutation = useMutation({
    mutationFn: (id: string) => eliminarSede(id),
    onSuccess: (_data, id) => {
      toast.success('Sede eliminada');
      setSedeAEliminar(null);
      if (editandoId === id) {
        setEditandoId(null);
        setForm(FORM_VACIO);
      }
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Error al eliminar la sede');
      setSedeAEliminar(null);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['plataforma', 'sedes'] });
    },
  });
```

Reemplázalo por (solo cambian los 3 `onError` — agregan segundo parámetro `vars` y un `console.error` al inicio; `onSuccess`/`onSettled`/`mutationFn` quedan idénticos):

```tsx
  const crearMutation = useMutation({
    mutationFn: (input: SedeInput) => crearSede(input),
    onSuccess: () => {
      toast.success('Sede creada');
      setForm(FORM_VACIO);
      void queryClient.invalidateQueries({ queryKey: ['plataforma', 'sedes'] });
    },
    onError: (err, vars) => {
      console.error('[PlataformaSedesPage] Error al crear sede:', { input: vars, err });
      toast.error(err instanceof ApiError ? err.message : 'Error al crear la sede');
    },
  });

  const actualizarMutation = useMutation({
    mutationFn: (vars: { id: string; input: SedeInput }) =>
      actualizarSede(vars.id, vars.input),
    onSuccess: () => {
      toast.success('Sede actualizada');
      setForm(FORM_VACIO);
      setEditandoId(null);
      void queryClient.invalidateQueries({ queryKey: ['plataforma', 'sedes'] });
    },
    onError: (err, vars) => {
      console.error('[PlataformaSedesPage] Error al actualizar sede:', {
        id: vars.id,
        input: vars.input,
        err,
      });
      toast.error(err instanceof ApiError ? err.message : 'Error al actualizar la sede');
    },
  });

  const eliminarMutation = useMutation({
    mutationFn: (id: string) => eliminarSede(id),
    onSuccess: (_data, id) => {
      toast.success('Sede eliminada');
      setSedeAEliminar(null);
      if (editandoId === id) {
        setEditandoId(null);
        setForm(FORM_VACIO);
      }
    },
    onError: (err, vars) => {
      console.error('[PlataformaSedesPage] Error al eliminar sede:', { id: vars, err });
      toast.error(err instanceof ApiError ? err.message : 'Error al eliminar la sede');
      setSedeAEliminar(null);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['plataforma', 'sedes'] });
    },
  });
```

Nota: en `eliminarMutation`, `vars` ES el `id: string` directamente (`mutationFn: (id: string) => eliminarSede(id)`) — no `vars.id`, a diferencia de `actualizarMutation`.

- [ ] **Step 4: Agregar la rama `isError` faltante a la tabla de sedes**

En el mismo archivo, el bloque actual (líneas 216-224) es:

```tsx
          <tbody>
            {sedesQuery.isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate/60">
                  Cargando…
                </td>
              </tr>
            )}
            {sedesQuery.data?.map((sede) => (
```

Reemplázalo por (se inserta la rama `isError`, mismo patrón visual que ya usa `admin/carreras/page.tsx`):

```tsx
          <tbody>
            {sedesQuery.isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate/60">
                  Cargando…
                </td>
              </tr>
            )}
            {sedesQuery.isError && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-crimson">
                  {sedesQuery.error instanceof ApiError
                    ? sedesQuery.error.message
                    : 'No se pudo cargar el listado de sedes. Intenta de nuevo más tarde.'}
                </td>
              </tr>
            )}
            {!sedesQuery.isLoading &&
              !sedesQuery.isError &&
              sedesQuery.data?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate/60">
                    Todavía no hay sedes registradas.
                  </td>
                </tr>
              )}
            {sedesQuery.data?.map((sede) => (
```

El `{sedesQuery.data?.map(...)}` que sigue queda intacto — con la guarda `!isLoading && !isError` nueva, ya no se superpone visualmente con las filas de "Cargando…"/error (antes tampoco lo hacía porque `data` es `undefined` en esos casos, pero ahora el estado vacío real también queda cubierto en vez de mostrar una tabla en blanco sin fila alguna).

- [ ] **Step 5: Agregar `console.error` con contexto (sin password) al login de plataforma**

En `App/frontend/src/app/plataforma/login/page.tsx`, el bloque actual (líneas 22-37) es:

```tsx
  const mutation = useMutation({
    mutationFn: async () => {
      const { token } = await loginPlatformAdmin(email, password);
      savePlatformToken(token);
    },
    onSuccess: () => {
      router.push('/plataforma');
    },
    onError: (err) => {
      const mensaje =
        err instanceof ApiError
          ? (MENSAJES_ERROR[err.code] ?? 'Ocurrió un error inesperado. Intenta de nuevo.')
          : err.message;
      toast.error(mensaje);
    },
  });
```

Reemplázalo por:

```tsx
  const mutation = useMutation({
    mutationFn: async () => {
      const { token } = await loginPlatformAdmin(email, password);
      savePlatformToken(token);
    },
    onSuccess: () => {
      router.push('/plataforma');
    },
    onError: (err) => {
      // Regla 12 de `CLAUDE.md` raíz — nunca loguear `password`, solo el
      // email intentado (útil para debug: "¿a qué cuenta se le negó el
      // acceso?" sin exponer la credencial).
      console.error('[PlataformaLoginPage] Error al iniciar sesión:', { email, err });
      const mensaje =
        err instanceof ApiError
          ? (MENSAJES_ERROR[err.code] ?? 'Ocurrió un error inesperado. Intenta de nuevo.')
          : err.message;
      toast.error(mensaje);
    },
  });
```

- [ ] **Step 6: Verificar tipos y lint**

Run: `cd App/frontend && npx tsc --noEmit`
Expected: sin salida, exit 0.

Run: `cd App/frontend && npx eslint src/app/plataforma/page.tsx src/app/plataforma/sedes/page.tsx src/app/plataforma/login/page.tsx`
Expected: sin salida, exit 0.

- [ ] **Step 7: Verificación manual del comportamiento (sin backend)**

Sin suite de tests en este árbol — confirmar leyendo el diff:
1. `plataforma/page.tsx`: fetch fallido de `obtenerResumenGlobal` → consola muestra `[PlataformaDashboardPage] Error al obtener el resumen global: <Error>`, UI cae al bloque `isError` ya existente.
2. `plataforma/sedes/page.tsx`:
   - Fetch fallido de `listarSedes` → consola muestra el log nuevo Y la tabla ahora muestra una fila con el mensaje de error en `text-crimson` en vez de quedarse vacía sin explicación (el gap real que motivó este plan).
   - `crearSede`/`actualizarSede`/`eliminarSede` fallidos → consola muestra el log con `{ input/id, err }` ANTES del `toast.error` ya existente (mensaje del toast sin cambios).
3. `plataforma/login/page.tsx`: login fallido → consola muestra `{ email, err }` (nunca `password`) antes del toast ya existente.

- [ ] **Step 8: Commit**

```bash
git add App/frontend/src/app/plataforma/page.tsx App/frontend/src/app/plataforma/sedes/page.tsx App/frontend/src/app/plataforma/login/page.tsx
git commit -m "fix(frontend): agrega mensaje de error faltante en tabla de sedes y logs con contexto en plataforma

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Cierre del plan

Tras las 2 tareas: `qa-admin` audita Task 1 (dominio propio). Task 2 (`app/plataforma`) no tiene QA dedicado (gap ya documentado desde Día 20/22) — se cierra con la verificación manual de los Steps 6-7 arriba, mismo criterio ya aceptado para `DELETE /sedes`. Al cerrar, actualizar `docs/roadmap.md` (marcar los 2 checkboxes de Día 22) y la sección "Fase actual" de `CLAUDE.md` raíz (Día 22 pasa de PARCIAL a CERRADO).
