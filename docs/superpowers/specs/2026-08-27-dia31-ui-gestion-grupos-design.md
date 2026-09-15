# Día 31 — UI de gestión de grupos — diseño

Fecha: 2026-08-27
Fase: 10 (Gestión de grupos), Día 31. Cierra la Fase 10 (Día 30 = backend, ya cerrado).

## Contexto

El Día 30 dejó el backend de matrícula: `POST/DELETE/GET /grupos/:id/alumnos` (+ código
de dominio `CAPACIDAD_EXCEDIDA`). `app/admin/grupos/page.tsx` hoy es filtros + tabla
paginada + modal de alta + "Eliminar" por fila; no tiene vista de detalle.

Infra ya disponible:
- `@headlessui/react` v2 tiene `Combobox` (autocomplete) — misma lib que el `Select`
  actual, sin dependencia nueva.
- `listarAlumnos(params)` en `lib/api/personas.ts` — fija `rol: 'ALUMNO'`, acepta
  `{ buscar?, estatus?, page?, limit? }`, devuelve `ApiListaPaginada<PersonaListItemAlumno>`
  con `usuarioId`, `carrera: { id, nombre }`, `matricula`, `nombres`, `apellidoPaterno`,
  `apellidoMaterno`, `estatusAcademico`, `semestreActual`, `activo`.
- `useBuscarDebounced` (`components/admin/ui/personas-listado/`) — hook de debounce ya
  usado por los listados.
- `ConfirmarEliminarGrupoModal.tsx` — patrón de modal de confirmación a calcar.

## 1. Backend — `GET /grupos/:id` (adición)

Gap descubierto al planear esta UI (mismo criterio que `GET /salones` en el Día 29). El
Día 30 lo dejó fuera a propósito ("la UI prellena del caché"), pero una página de detalle
dedicada debe sobrevivir a refresh y deep-link.

- Nuevo handler `GET /grupos/:id` en `GruposController`, `@Roles(RolUsuario.ADMINISTRATIVO)`,
  mismos guards de clase.
- `GruposService.obtenerPorId(id, sedeId)` — reutiliza el helper privado
  `obtenerGrupoEnSede` (que hoy sólo hace `findFirst({ where: { id, sedeId } })`) pero con
  un `select` que expande `carrera`/`salon` a `{ id, nombre }`. Para no romper a los
  callers actuales de `obtenerGrupoEnSede` (`matricular`/`desmatricular`/`listarAlumnos`,
  que sólo necesitan `carreraId`/`capacidad`), NO se cambia ese helper — `obtenerPorId`
  hace su propio `findFirst` con el `select` expandido, y lanza el mismo
  `404 NOT_FOUND` ("Grupo no encontrado en tu sede") si no hay fila.
- Respuesta: `200 { data: GrupoListItem }` — **mismo shape que devuelve `GET /grupos`**
  (`{ id, nombre, anioInicio, cicloActual, capacidad, carrera: { id, nombre },
  salon: { id, nombre } }`). No hay tipo nuevo.
- `try/catch` con `console.error` antes de re-lanzar (regla 12), mismo patrón que
  `listar`.

### e2e — 2 casos en `App/backend/test/grupos.e2e-spec.ts`

- `GET /grupos/:id devuelve el grupo con carrera/salon expandidos` — crear un grupo
  fixture, `GET`, assert `res.status === 200`, `res.body.data.id`, `carrera.nombre`,
  `salon.nombre` presentes.
- `GET /grupos/:id de otra sede → 404 NOT_FOUND` — grupo de Valladolid, token de Mérida.

### `CLAUDE.md`

En el bloque de contrato de `POST/GET /grupos` (o como bloque contiguo), agregar
`GET /grupos/:id` — mismos guards, `sedeId` de `@SedeActual()`, `404` si no es de la
sede, `200 { data: GrupoListItem }` (mismo shape que el listado). Nota: lo consume la
vista de detalle del Día 31; sigue sin haber `PATCH /grupos/:id`.

## 2. Frontend

### `lib/api/grupos.ts` — clientes y tipos nuevos

```ts
// espejo del backend Día 30 (GrupoAlumnoListItem)
export interface GrupoAlumnoListItem {
  usuarioId: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  matricula: string;
  semestreActual: number;
  estatusAcademico: EstatusAcademico; // reusar el tipo espejo de lib/api/personas.ts
  fechaInscripcion: string;
}

export function obtenerGrupo(id: string): Promise<GrupoListItem>;
export function listarAlumnosDeGrupo(grupoId: string): Promise<GrupoAlumnoListItem[]>;
export function matricularAlumno(grupoId: string, usuarioId: string): Promise<GrupoAlumno>;
export function desmatricularAlumno(grupoId: string, usuarioId: string): Promise<{ ok: true }>;
```

- `obtenerGrupo` → `apiFetchAuth<GrupoListItem>('/grupos/' + id)`.
- `listarAlumnosDeGrupo` → `apiFetchAuth<GrupoAlumnoListItem[]>('/grupos/' + grupoId + '/alumnos')`
  (no paginado — el backend devuelve `{ data: [...] }` plano, `apiFetchAuth` ya
  desenvuelve `data`).
- `matricularAlumno` → `POST /grupos/:id/alumnos` body `{ usuarioId }`.
- `desmatricularAlumno` → `DELETE /grupos/:id/alumnos/:usuarioId`.
- `EstatusAcademico` NO se re-declara acá — se importa de `lib/api/personas.ts` (ya
  exportado; mismo criterio de "no cruzar imports entre módulos de API" NO aplica a un
  tipo que ya está exportado y es el mismo enum del schema).

### `app/admin/grupos/[id]/page.tsx` — vista de detalle (ruta nueva)

`'use client'`. `params` vía `useParams()` de `next/navigation` (client-safe en Next 16;
el implementador verifica contra `node_modules/next/dist/docs` por el aviso de
`App/frontend/AGENTS.md` — NO usar la prop `params` como Promise en un client component
sin confirmar la API).

**Estructura:**

- **Encabezado** (card `border-l-4 border-navy`, mismo patrón que la página de listado):
  - `useQuery({ queryKey: ['admin', 'grupos', 'detalle', id], queryFn: () => obtenerGrupo(id) })`.
  - Muestra `grupo.nombre` (h1), carrera, salón, periodo (`${anioInicio} · Semestre ${cicloActual}`).
  - **Badge de capacidad `N / M`** — `N` = `alumnosQuery.data?.length ?? 0`, `M` = `grupo.capacidad`.
    Cuando `N >= M`, el badge usa color de alerta (`warning`) y dice "Lleno".
  - Link "← Volver a grupos" a `/admin/grupos`.
  - Loading/error: si `grupoQuery.isError` (incluye el `404` si el id no existe / no es
    de la sede) → mensaje "Grupo no encontrado" + link de volver, sin renderizar el
    resto.

- **Tabla de matriculados**:
  - `useQuery({ queryKey: ['admin', 'grupos', 'detalle', id, 'alumnos'], queryFn: () => listarAlumnosDeGrupo(id) })`.
  - Columnas: Alumno (`apellidoPaterno apellidoMaterno, nombres`), Matrícula, Semestre,
    Estatus, Acciones ("Quitar").
  - Estatus como texto vía `Record<EstatusAcademico, string>` local
    (`INSCRITO` → "Inscrito", `BAJA_TEMPORAL` → "Baja temporal", `BAJA_DEFINITIVA` →
    "Baja definitiva", `EGRESADO` → "Egresado"). Sin badge nuevo (YAGNI).
  - Estados loading / error / vacío ("Este grupo todavía no tiene alumnos matriculados"),
    mismo patrón que la tabla de la página de listado.

- **Agregar alumno (Combobox de `@headlessui/react`)**:
  - Input controlado; el valor tecleado pasa por `useBuscarDebounced` (~300 ms).
  - `useQuery({ queryKey: ['admin', 'personas', 'ALUMNO', 'buscar', buscarDebounced], queryFn: () => listarAlumnos({ buscar: buscarDebounced, limit: 20 }), enabled: buscarDebounced.trim().length >= 2 })`.
  - `< 2` caracteres → no dispara request; el panel muestra "Escribe al menos 2 caracteres…".
  - **Filtrado en cliente** de los resultados: `r.carrera.id === grupo.carreraId` **y**
    `!alumnosMatriculados.some(a => a.usuarioId === r.usuarioId)`. NO se filtra por
    `activo` ni `estatusAcademico` (coherente con el backend del Día 30, que no bloquea
    por eso).
  - Cada opción muestra `apellidoPaterno apellidoMaterno, nombres — matricula`.
  - Panel vacío tras filtrar → "Sin resultados en esta carrera" / "Ya están todos
    matriculados".
  - Al seleccionar una opción → `matricularMutation.mutate(usuarioId)`; el Combobox se
    limpia en `onSuccess`.
  - **Cuando `N >= M`** (grupo lleno): el Combobox se renderiza `disabled` con un aviso
    inline "Grupo lleno (M / M) — quita un alumno para agregar otro". El
    `409 CAPACIDAD_EXCEDIDA` queda como red del backend (toast si llegara a ocurrir por
    una carrera concurrente).

- **`matricularMutation`** (`useMutation`):
  - `onSuccess`: `toast.success('Alumno matriculado')`; invalida
    `['admin', 'grupos', 'detalle', id]` (el contador) y
    `['admin', 'grupos', 'detalle', id, 'alumnos']` (la tabla). Limpia el input del
    Combobox.
  - `onError`: `console.error` (regla 12); si `ApiError` con `code === 'VALIDATION_ERROR'`
    (otra carrera) o `code === 'CAPACIDAD_EXCEDIDA'` o `code === 'CONFLICT'` (ya
    inscrito) → `toast.error(err.message)` (passthrough del mensaje real del backend,
    mismo criterio que `AdminGruposPage`); si no → `toast.error(MENSAJE_ERROR_GENERICO)`.

- **`desmatricularMutation`** (`useMutation`):
  - Dispara desde `ConfirmarQuitarAlumnoModal` (ver abajo).
  - `onSuccess`: `toast.success('Alumno quitado del grupo')`; invalida las mismas 2
    queries; cierra el modal.
  - `onError`: `console.error`; `toast.error(resolverMensajeError(err) ?? MENSAJE_ERROR_GENERICO)`;
    cierra el modal.

### `app/admin/grupos/[id]/ConfirmarQuitarAlumnoModal.tsx` (nuevo, local)

Calco estructural de `ConfirmarEliminarGrupoModal.tsx` (mismo overlay, mismas clases,
botón `bg-crimson`). Props: `{ alumno: GrupoAlumnoListItem, grupoNombre: string,
quitando: boolean, onConfirmar: () => void, onCancelar: () => void }`. Texto:
"¿Quitar a **{apellidos, nombres}** del grupo **{grupoNombre}**? Podrás volver a
matricularlo después." Sin import cruzado (regla 11, modal local por sección).

### `app/admin/grupos/page.tsx` — enlace nuevo

En la columna "Acciones" de cada fila, antes de "Eliminar", un `<Link>` "Alumnos" a
`/admin/grupos/${grupo.id}` (`className="text-navy hover:underline"` + separador). No se
toca nada más de esa página.

## 3. Fuera de alcance (decisiones explícitas)

- Filtro del autocomplete: SOLO carrera + no-ya-matriculado. NO por `activo` ni
  `estatusAcademico` (coherente con el backend del Día 30).
- Sin edición de grupo (no hay `PATCH /grupos/:id` y no se agrega).
- Sin componente de badge nuevo para `EstatusAcademico` — texto plano vía `Record` local.
- Sin paginación en la tabla de matriculados (≤ capacidad, catálogo chico — igual que el
  `GET` del backend).
- Sin "matricular por lote" / selección múltiple en el Combobox — uno a la vez.
- Sin mover `useBuscarDebounced` ni `Paginacion` de sitio; se importan tal cual.

## 4. Verificación

- Backend: `pnpm test:e2e` completo (los 2 casos nuevos de `GET /grupos/:id` + toda la
  suite en verde) + `pnpm test` (unit) + `pnpm build`.
- Frontend: `pnpm tsc --noEmit` + `pnpm build`.
- Verificación manual en navegador (a cargo del usuario): desde `/admin/grupos`, entrar
  a un grupo por el link "Alumnos"; buscar un alumno de la misma carrera y matricularlo
  (el contador sube); intentar buscar uno de otra carrera (no aparece en el autocomplete);
  quitar un alumno con el modal de confirmación (el contador baja); llenar el grupo y
  confirmar que el Combobox se deshabilita. Refrescar la página del detalle (deep-link)
  y confirmar que el encabezado carga bien vía `GET /grupos/:id`.
