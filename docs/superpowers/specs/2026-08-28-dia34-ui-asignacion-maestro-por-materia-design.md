# Día 34 — UI de asignación + vista para maestro (cierra Fase 12)

**Fecha:** 2026-08-28
**Roadmap:** `docs/roadmap.md` — FASE 12, Día 34.
**Entregable visible:** el admin asigna maestros a materias desde la UI; el maestro de
prueba ve sus asignaciones reflejadas en su propio perfil.

## Objetivo

Cerrar la Fase 12 con la capa de UI sobre lo que Día 33 construyó en backend:
- **Admin:** desde el detalle de un grupo, ver las materias del grupo (carrera + ciclo
  del grupo) y asignar/quitar maestros a cada una.
- **Maestro:** ver "mis grupos y materias asignadas" en su propio perfil.

## Decisiones tomadas (brainstorming 2026-08-28)

1. **Tabla de admin:** fila por materia; cada fila lista los maestros ya asignados como
   chips con botón de quitar, más un control "Agregar maestro". Respeta la co-docencia
   de Día 33 (`@@unique([grupoId, materiaId, maestroId])`). Vive como sección nueva del
   detalle de grupo, extraída a componentes propios.
2. **Selector de maestro:** `<select>` simple con todos los maestros de la sede
   (`GET /personas?rol=MAESTRO&limit=100`), sin autocomplete. Filtra en cliente los ya
   asignados a esa materia.
3. **Vista del maestro:** sección nueva apilada en `app/maestro/page.tsx` (bajo
   "Contactos"), con su propio `useQuery`. Sin ruta nueva, sin tocar el Header. Mismo
   criterio que la sección "Compañeros" del perfil de alumno (Día 32).
4. **Datos de la vista del maestro por grupo:** nombre del grupo, `anioInicio`-
   `cicloActual`, carrera, salón; debajo, la lista de materias que ese maestro da en ese
   grupo. Solo lectura, sin lista ni conteo de alumnos.
5. **Crear materias:** botón "+ Nueva materia" en la sección de asignaciones →
   modal chico (`nombre`; `ciclo` fijo = `grupo.cicloActual`, mostrado como texto; la
   carrera sale del grupo) → `POST /materias`. Cierra el hueco de "Día 33 no tiene UI de
   Materia" sin abrir una pantalla CRUD completa.
6. **Enfoque A:** el endpoint del maestro vive en `PerfilController`
   (`GET /perfil/asignaciones`), no en `GruposController` — `/perfil/*` es la casa de "lo
   propio del usuario autenticado" (`/perfil`, `/perfil/malla`, `/perfil/grupo/companeros`).

## 1. Backend — `GET /perfil/asignaciones`

Nuevo método en `PerfilController` (`App/backend/src/perfil/`).

- **Guards:** `SedeGuard` (clase, ya está) + `RolesGuard` a nivel de **método** +
  `@Roles(RolUsuario.MAESTRO)`. Copia exacta del patrón de `GET /perfil/malla`
  (ALUMNO-only, guard por método para no afectar `GET /perfil` abierto a los 3 roles) y
  `GET /perfil/grupo/companeros` (Día 32).
- **Actor:** `@ActorUsuarioId()` (JWT `sub`). Sin `:id` ni query params.
- **Ruta:** `GET /perfil/asignaciones` — segmento fijo. `PerfilController` no tiene rutas
  `:id`, no hay conflicto de orden.
- **Sin paginación** (catálogo chico — nº de grupos del maestro × materias por grupo).
- **Sin código de error nuevo:**
  - `404 NOT_FOUND` — defensivo, actor `MAESTRO` sin fila `PerfilMaestro` (inconsistencia
    de datos; mismo criterio y `console.error` previo que
    `PerfilService.obtenerCompanerosDeGrupo`, regla 12).
  - `403 ROL_NO_AUTORIZADO` — alumno / administrativo, vía `RolesGuard`.
  - `401 UNAUTHORIZED` — sin token / token inválido.
- **Éxito:** `200 { data: GrupoConMaterias[] }`.

```ts
GrupoConMaterias = {
  grupoId: string;
  nombre: string;
  anioInicio: number;
  cicloActual: number;
  carrera: { id: string; nombre: string };
  salon: { id: string; nombre: string };
  materias: { id: string; nombre: string; ciclo: number }[];
}
```

- **Orden:** grupos por `anioInicio desc, cicloActual desc, nombre asc` (igual que
  `GET /grupos`). `materias` por `nombre asc`.
- **Maestro sin asignaciones** → `200 { data: [] }`.
- **Aislamiento cross-sede:** estructural — la consulta arranca en `maestroId =
  perfilMaestro.id` y los grupos de esas asignaciones son de la sede del maestro por
  construcción. `SedeGuard` sigue presente.

### Lógica (`PerfilService.obtenerAsignacionesPropias`)

1. `perfilMaestro = prisma.perfilMaestro.findUnique({ where: { usuarioId: actorUsuarioId }, select: { id: true } })`.
   Si no existe → `console.error('[PerfilService.obtenerAsignacionesPropias] ...', { actorUsuarioId })` + `NotFoundException({ error, code: 'NOT_FOUND' })`.
2. `prisma.grupoMateriaMaestro.findMany({ where: { maestroId: perfilMaestro.id }, orderBy: [ { grupo: { anioInicio: 'desc' } }, { grupo: { cicloActual: 'desc' } }, { grupo: { nombre: 'asc' } }, { materia: { nombre: 'asc' } } ], select: { grupo: { select: { id, nombre, anioInicio, cicloActual, carrera: { select: { id, nombre } }, salon: { select: { id, nombre } } } }, materia: { select: { id, nombre, ciclo } } } })`.
3. Agrupar en JS por `grupo.id` preservando el orden de llegada (ya viene ordenado por
   grupo y luego por `materia.nombre`): construir `GrupoConMaterias[]` acumulando
   `materias` por grupo. (Si el `orderBy` anidado por relación diera problemas con
   Prisma 6.x — no debería, ya se usa en `obtenerCompanerosDeGrupo` Día 32 y en
   `listarAsignaciones` Día 33 —, `orderBy` simple + orden en memoria con comparador
   explícito; el contrato de orden debe cumplirse igual.)

### Documentar en `CLAUDE.md`

Entrada nueva para `GET /perfil/asignaciones` en "Contrato de API", después de
`GET /perfil/grupo/companeros`.

## 2. Frontend — UI de admin (sección del detalle de grupo)

### Archivos

- Modify: `App/frontend/src/app/admin/grupos/[id]/page.tsx` — renderiza
  `<SeccionAsignaciones grupo={grupo} />` debajo de la sección de alumnos (dentro del
  mismo contenedor, después del bloque de matriculados).
- Create: `App/frontend/src/app/admin/grupos/[id]/SeccionAsignaciones.tsx` — el grueso
  de la lógica (queries, filas por materia, mutaciones).
- Create: `App/frontend/src/app/admin/grupos/[id]/AgregarMateriaModal.tsx` — modal
  "+ Nueva materia".
- Create: `App/frontend/src/app/admin/grupos/[id]/ConfirmarQuitarAsignacionModal.tsx` —
  confirmación al quitar un maestro de una materia (calco de
  `ConfirmarQuitarAlumnoModal.tsx`).
- Create: `App/frontend/src/lib/api/materias.ts` — cliente de `GET/POST /materias`.
- Modify: `App/frontend/src/lib/api/grupos.ts` — 3 funciones nuevas de asignación +
  tipo `AsignacionListItem`.

### `lib/api/materias.ts` (nuevo)

```ts
// Espejo de MateriasService (App/backend/src/materias/), Día 33.
export interface Materia {
  id: string;
  nombre: string;
  carreraId: string;
  ciclo: number;
}
export interface CrearMateriaInput {
  nombre: string;
  carreraId: string;
  ciclo: number;
}
export function listarMaterias(carreraId: string, ciclo: number): Promise<Materia[]>;
// GET /materias?carreraId=&ciclo=  (carreraId y ciclo siempre presentes acá)
export function crearMateria(input: CrearMateriaInput): Promise<Materia>;
// POST /materias
```

### `lib/api/grupos.ts` (extensión)

```ts
// Espejo de AsignacionListItem (App/backend/src/grupos/grupos.service.ts), Día 33.
export interface AsignacionListItem {
  id: string;
  materia: { id: string; nombre: string; ciclo: number };
  maestro: {
    usuarioId: string;
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string | null;
  };
}
// Fila plana de GrupoMateriaMaestro (respuesta de POST /grupos/:id/asignaciones).
export interface GrupoMateriaMaestro {
  id: string;
  grupoId: string;
  materiaId: string;
  maestroId: string;
  asignadoEn: string;
}
export function listarAsignaciones(grupoId: string): Promise<AsignacionListItem[]>;
// GET /grupos/:id/asignaciones
export function asignarMaestro(
  grupoId: string,
  input: { materiaId: string; usuarioId: string },
): Promise<GrupoMateriaMaestro>;
// POST /grupos/:id/asignaciones
export function eliminarAsignacion(
  grupoId: string,
  asignacionId: string,
): Promise<{ ok: true }>;
// DELETE /grupos/:id/asignaciones/:asignacionId
```

### `SeccionAsignaciones.tsx`

Recibe `grupo: GrupoListItem` (el que ya tiene el page vía `grupoQuery`).

Queries (todas con `console.error` en el catch del `queryFn`, regla 12):
- `materiasQuery` — `['admin','grupos','detalle',grupo.id,'materias']` →
  `listarMaterias(grupo.carrera.id, grupo.cicloActual)`.
- `asignacionesQuery` — `['admin','grupos','detalle',grupo.id,'asignaciones']` →
  `listarAsignaciones(grupo.id)`.
- `maestrosQuery` — `['admin','maestros','para-asignar']` →
  `listarMaestros({ limit: 100 })` (de `lib/api/personas.ts`, Día 19; devuelve
  `PersonaListItemMaestro[]` con `usuarioId`, `nombres`, `apellidoPaterno`,
  `apellidoMaterno`). Compartida entre filas, no una por materia.

Render:
- Encabezado de la sección: título "Materias y maestros" + botón "+ Nueva materia" →
  abre `AgregarMateriaModal`.
- Estados de carga/error de las 3 queries (patrón de la página: mensaje discreto /
  caja `border-error-border bg-error-bg`).
- Si `materiasQuery.data.length === 0`: estado vacío — "Este grupo no tiene materias
  registradas para el ciclo {grupo.cicloActual} de {grupo.carrera.nombre}." + el botón
  "+ Nueva materia" destacado.
- Si hay materias: una fila por materia (ordenadas como vienen del backend, `nombre asc`):
  - Izquierda: `{materia.nombre}` (negrita) + `Ciclo {materia.ciclo}` (texto chico).
  - Derecha:
    - Maestros ya asignados a esa materia = `asignacionesQuery.data.filter(a => a.materia.id === materia.id)`. Cada uno como chip: `{apellidoPaterno} {apellidoMaterno}, {nombres}` + botón "×" → `setAsignacionAQuitar(a)` (abre `ConfirmarQuitarAsignacionModal`).
    - Debajo: `<select>` con los maestros de `maestrosQuery.data` **menos** los `usuarioId` ya asignados a esa materia (opción placeholder "Agregar maestro…") + botón "Agregar" → `asignarMutation.mutate({ materiaId: materia.id, usuarioId: <seleccionado> })`. El `<select>` y el botón se deshabilitan mientras la mutación de esa fila está pendiente. Si no quedan maestros por agregar, se muestra "Todos los maestros ya están asignados" en vez del select.

Mutaciones (`useMutation`, `queryClient.invalidateQueries` al éxito, `toast.error` con
`resolverMensajeError(err)` al fallo — helper ya importado en el árbol):
- `asignarMutation` → `asignarMaestro(grupo.id, input)`; al éxito invalida
  `asignacionesQuery`. Maneja `409 CONFLICT` (ya asignado — no debería pasar por el
  filtro del select, defensivo), `400 VALIDATION_ERROR` (materia de otra carrera/ciclo —
  no debería pasar), `404` (maestro no en sede).
- `quitarMutation` → `eliminarAsignacion(grupo.id, asignacionId)`; al éxito invalida
  `asignacionesQuery` y cierra el modal.
- `crearMateriaMutation` (dentro de `AgregarMateriaModal` o elevada) →
  `crearMateria({ nombre, carreraId: grupo.carrera.id, ciclo: grupo.cicloActual })`; al
  éxito invalida `materiasQuery` y cierra el modal. `409 CONFLICT` (nombre duplicado en
  ese ciclo) → error inline en el modal.

### `AgregarMateriaModal.tsx`

Props: `grupo`, `abierto`, `onCerrar`, `onCreada` (o maneja la mutación adentro).
Campos: input `nombre` (requerido); `ciclo` NO es input — se muestra como texto
"Materia de ciclo {grupo.cicloActual} · {grupo.carrera.nombre}". Botones Cancelar /
Crear. Al cerrar (cancelar o éxito) limpia el input. Patrón visual de
`NuevoGrupoModal.tsx` / los modales de `[id]/`.

### `ConfirmarQuitarAsignacionModal.tsx`

Calco de `ConfirmarQuitarAlumnoModal.tsx`: recibe la `AsignacionListItem` a quitar,
muestra "¿Quitar a {maestro} de {materia}?" en solo lectura, botones Cancelar / Quitar.
La mutación la dispara el padre.

Regla 11: todo en `app/admin/grupos/[id]/`, modales locales, sin componentes
compartidos con `app/maestro/` ni `app/alumno/`.

## 3. Frontend — vista del maestro

### Archivos

- Modify: `App/frontend/src/lib/api/perfil.ts` — `obtenerMisAsignaciones()` + tipos
  `GrupoConMaterias` / (reusa nada del admin — espejo propio).
- Modify: `App/frontend/src/app/maestro/page.tsx` — componente `SeccionAsignaciones`
  local (mismo archivo, junto a las otras `Seccion*`) apilado bajo `SeccionContactos`.

### `lib/api/perfil.ts` (extensión)

```ts
/**
 * `GET /perfil/asignaciones` — Fase 12, Día 34. Grupos y materias que el
 * maestro autenticado tiene asignados, agrupados por grupo. Shape espejo de
 * PerfilService.obtenerAsignacionesPropias. Solo MAESTRO. Array vacío si no
 * tiene asignaciones.
 */
export interface MateriaAsignada {
  id: string;
  nombre: string;
  ciclo: number;
}
export interface GrupoConMaterias {
  grupoId: string;
  nombre: string;
  anioInicio: number;
  cicloActual: number;
  carrera: { id: string; nombre: string };
  salon: { id: string; nombre: string };
  materias: MateriaAsignada[];
}
export function obtenerMisAsignaciones(): Promise<GrupoConMaterias[]> {
  return apiFetchAuth<GrupoConMaterias[]>('/perfil/asignaciones');
}
```

### `app/maestro/page.tsx`

`PerfilContenido` gana `<SeccionAsignaciones />` después de `<SeccionContactos />` en el
`<div className="mt-6 space-y-6">`.

`SeccionAsignaciones` (componente local):
- `useQuery({ queryKey: ['maestro', 'asignaciones'], queryFn })` — el `queryFn` hace
  `try { return await obtenerMisAsignaciones() } catch (err) { console.error('[MaestroAsignaciones] ...', err); throw err }` (regla 12).
- Estados:
  - Loading: "Cargando…" discreto.
  - Error: caja `border border-error-border bg-error-bg ... text-crimson` con
    `error.message` si `ApiError`, si no el genérico.
  - `data.length === 0`: "Aún no tienes materias asignadas."
  - Con datos: `<section className="rounded-lg border border-mist p-5">` con
    `<h2>Mis grupos y materias</h2>` y, por grupo, una sub-tarjeta
    (`rounded-lg border border-mist bg-bone/60 p-4`): encabezado `{grupo.nombre}`
    (`text-sm font-semibold text-navy`) + línea `{carrera.nombre} · {anioInicio}-
    {cicloActual} · Salón {salon.nombre}` (`text-xs text-slate/60`); debajo `<ul>` de
    materias — cada `<li>`: `{materia.nombre}` (`font-medium`) + `Ciclo {materia.ciclo}`
    (`text-xs text-slate/50`).
- Sin dependencias nuevas. Solo tokens ya usados en el archivo (`navy`, `mist`, `slate`,
  `bone`, `error-border`, `error-bg`, `crimson`). Regla 11: árbol `app/maestro/` propio.

## 4. Pruebas

### Backend e2e — `test/perfil-asignaciones.e2e-spec.ts` (nuevo)

Andamiaje calcado de `test/grupos-asignaciones.e2e-spec.ts` / `test/perfil-companeros.e2e-spec.ts`.

- Maestro con asignaciones en 1 grupo (2 materias) → `data` con 1 grupo, `materias`
  ordenadas `nombre asc`, shape correcto (carrera/salon expandidos).
- Maestro con asignaciones en 2 grupos → 2 grupos, orden `anioInicio/cicloActual desc,
  nombre asc`.
- Maestro con 0 asignaciones → `200 { data: [] }`.
- Co-docencia: maestro A y maestro B asignados a la misma materia del mismo grupo → A
  ve la materia una sola vez y NO ve nada específico de B (el endpoint es por
  `maestroId`, así que B simplemente no aparece; se verifica que el grupo/materia de A
  está y que consultar como B devuelve su propia vista).
- Aislamiento cross-sede: maestro de sede A con asignación en su grupo; existe otra
  asignación en un grupo de sede B → el maestro de A no la ve.
- Actor rol `ALUMNO` → `403 ROL_NO_AUTORIZADO`.
- Actor rol `ADMINISTRATIVO` → `403 ROL_NO_AUTORIZADO`.
- Sin `Authorization` → `401`.
- `afterAll` limpia acotado a los `id` reales creados (`GrupoMateriaMaestro`, `Grupo`,
  `Materia`, `Usuario`/`PerfilMaestro`, `RegistroAuditoria` si aplica) — nunca por
  patrón (regla 14; FK order: grupoMateriaMaestro → grupo → materia → perfilMaestro →
  usuario).

### Frontend

- `pnpm build` (Next type-check) + `npx eslint "<archivos nuevos/tocados>"` (SIN `--fix`
  — el `pnpm lint` del repo reformatea archivos ajenos, hallazgo de Día 32) limpios.
- Verificación manual en navegador (usuario): entrar como `ADMINISTRATIVO` al detalle de
  un grupo de ciclo 1 → ver las materias sembradas → agregar un maestro a una →
  quitarlo → crear una materia nueva → agregarle un maestro; luego entrar como ese
  maestro → "Mi perfil" → ver el grupo y la materia en "Mis grupos y materias".

## 5. Fuera de alcance (explícito)

- `PATCH`/`DELETE /materias` y pantalla CRUD completa de Materias (`app/admin/materias/`).
- Que el maestro vea la lista de alumnos de su(s) grupo(s).
- Editar una asignación (cambiar el maestro = quitar + agregar).
- `GET /perfil/asignaciones` para admin/alumno.
- Conteo de alumnos en la vista del maestro.
- Autocomplete para el selector de maestro (se eligió `<select>` simple).

## 6. Ejecución

Subagent-Driven Development:

1. **Task 1** — backend `GET /perfil/asignaciones` (`PerfilService`/`PerfilController`)
   + `test/perfil-asignaciones.e2e-spec.ts` + entrada en `CLAUDE.md` (`backend-coder`).
2. **Task 2** — `lib/api/materias.ts` + fns de asignación en `lib/api/grupos.ts` +
   `SeccionAsignaciones.tsx` + `AgregarMateriaModal.tsx` +
   `ConfirmarQuitarAsignacionModal.tsx` + wiring en `app/admin/grupos/[id]/page.tsx`
   (`admin-coder`).
3. **Task 3** — `obtenerMisAsignaciones` + tipos en `lib/api/perfil.ts` + sección en
   `app/maestro/page.tsx` (`alumno-coder` — cubre alumno y maestro).
4. **Task 4** — review final + QA (`qa-backend`, `qa-alumno`, `qa-admin`) + cierre:
   marcar Día 34 en `ESTADO.md`, tachar Día 34 y **FASE 12 — COMPLETA** en
   `roadmap.md`, actualizar la línea "Fase actual" de `CLAUDE.md`
   (Fase 12 completa → siguiente Fase 13, Días 35-37).
