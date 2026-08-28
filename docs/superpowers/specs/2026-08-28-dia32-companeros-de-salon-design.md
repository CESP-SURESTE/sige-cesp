# Día 32 — Compañeros de salón (Fase 11)

**Fecha:** 2026-08-28
**Roadmap:** `docs/roadmap.md` — FASE 11, Día 32.
**Entregable visible:** un alumno de prueba ve la lista de sus compañeros de grupo, y ningún dato de otros grupos.

## Objetivo

El alumno puede ver, desde su perfil, la lista de compañeros matriculados en
su(s) grupo(s). Solo lectura, datos mínimos.

## Decisiones tomadas (brainstorming 2026-08-28)

1. **Un alumno puede estar en varios grupos** (decisión de Día 30). El endpoint
   devuelve **todos** los grupos del alumno, cada uno con su propia lista de
   compañeros; la UI los muestra **agrupados** por grupo. El caso común (1
   grupo) se ve como una sola lista.
2. **Datos por compañero:** nombre completo + `matricula` + `semestreActual`.
   Nada de contacto, CURP, correo, estatus.
3. **Ubicación UI:** sección nueva `'Compañeros'` en el sidebar de secciones de
   `app/alumno/page.tsx` (junto a Datos / Sede / Carrera / Contactos). Sin ruta
   nueva, sin tocar el `Header`. Carga bajo demanda con su propio `useQuery`.
4. **Filtro de estatus:** ninguno. Se muestran todos los matriculados con fila
   en `GrupoAlumno`, sin importar `Usuario.activo` / `estatusAcademico`
   (consistente con Día 30). Se excluye **solo al propio actor**.
5. **Enfoque:** endpoint dedicado (no extender `GET /perfil`).

## 1. Contrato del endpoint

**`GET /perfil/grupo/companeros`** — ruta literal del roadmap. El segmento
`grupo` (singular) es solo el path, aunque la respuesta contenga varios grupos.

- **Guards:** `SedeGuard` (ya está a nivel de clase en `PerfilController`) +
  `RolesGuard` a nivel de **método** + `@Roles(RolUsuario.ALUMNO)`. Copia
  exacta del patrón de `GET /perfil/malla` (Día 24): guard por método, no por
  clase, para no afectar `GET /perfil` que sigue abierto a los 3 roles.
- **Actor:** `@ActorUsuarioId()` (JWT `sub`). Sin `:id`, sin query params.
- **Sin paginación** — catálogo chico (pocos grupos × ≤ `Grupo.capacidad`
  alumnos). Mismo criterio que `GET /grupos/:id/alumnos`.
- **Sin código de error nuevo:**
  - `404 NOT_FOUND` — defensivo, actor `ALUMNO` sin fila `PerfilAlumno`
    (inconsistencia de datos, no caso de negocio; mismo criterio y `console.error`
    previo que `PerfilService.obtenerPerfilPropio`, regla 12).
  - `403 ROL_NO_AUTORIZADO` — maestro / administrativo, vía `RolesGuard`.
  - `401 UNAUTHORIZED` — sin token / token inválido.
- **Éxito:** `200 { data: GrupoConCompaneros[] }`.

```ts
GrupoConCompaneros = {
  grupoId: string;
  nombre: string;
  anioInicio: number;
  cicloActual: number;
  carrera: { id: string; nombre: string };
  salon:   { id: string; nombre: string };
  companeros: CompaneroItem[];   // [] si el alumno está solo en ese grupo
}

CompaneroItem = {
  usuarioId: string;             // Usuario.id — mismo identificador que GrupoAlumnoListItem
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  matricula: string;
  semestreActual: number;
}
```

- **Orden:** grupos por `anioInicio desc, cicloActual desc, nombre asc` (igual
  que `GET /grupos`). `companeros` por `apellidoPaterno asc, apellidoMaterno
  asc, nombres asc` (igual que `GET /grupos/:id/alumnos`).
- **Alumno en 0 grupos** → `200 { data: [] }`.
- **Grupo donde el alumno es el único matriculado** → el grupo aparece con
  `companeros: []` (es honesto: "estás en este grupo, aún no hay nadie más").
- **Exclusión:** solo el propio actor (`alumnoId != perfilAlumno.id`).

### Documentar en `CLAUDE.md` (Contrato de API)

Agregar entrada para `GET /perfil/grupo/companeros` en la lista de endpoints,
después de `GET /perfil/malla`.

## 2. Lógica backend

Método nuevo `PerfilService.obtenerCompanerosDeGrupo(actorUsuarioId: string)`:

1. `perfilAlumno = prisma.perfilAlumno.findUnique({ where: { usuarioId: actorUsuarioId }, select: { id: true } })`.
   Si no existe → `console.error('[PerfilService.obtenerCompanerosDeGrupo] ...', { actorUsuarioId })` + `NotFoundException({ error, code: 'NOT_FOUND' })`.
2. Una sola consulta anidada:

```ts
prisma.grupoAlumno.findMany({
  where: { alumnoId: perfilAlumno.id },
  orderBy: [
    { grupo: { anioInicio: 'desc' } },
    { grupo: { cicloActual: 'desc' } },
    { grupo: { nombre: 'asc' } },
  ],
  select: {
    grupo: {
      select: {
        id: true,
        nombre: true,
        anioInicio: true,
        cicloActual: true,
        carrera: { select: { id: true, nombre: true } },
        salon: { select: { id: true, nombre: true } },
        alumnos: {
          where: { alumnoId: { not: perfilAlumno.id } },
          orderBy: [
            { alumno: { apellidoPaterno: 'asc' } },
            { alumno: { apellidoMaterno: 'asc' } },
            { alumno: { nombres: 'asc' } },
          ],
          select: {
            alumno: {
              select: {
                usuarioId: true,
                nombres: true,
                apellidoPaterno: true,
                apellidoMaterno: true,
                matricula: true,
                semestreActual: true,
              },
            },
          },
        },
      },
    },
  },
});
```

3. Mapear a `GrupoConCompaneros[]`: `grupo.{id→grupoId, nombre, anioInicio, cicloActual, carrera, salon}` + `companeros = grupo.alumnos.map(a => a.alumno)`.

- Sin `$transaction` (solo lectura).
- Sin `RegistroAuditoria` (no se auditan lecturas — igual que `GET /perfil`).
- RLS de sede aplica sola: los grupos del actor son de su sede por construcción,
  y los compañeros de esos grupos también. `SedeGuard` sigue presente igual.
- Si el `orderBy` anidado por relación (`grupo: { ... }`) diera problemas con la
  versión de Prisma 6.x del proyecto, alternativa: `orderBy` simple en la query
  y ordenar los grupos en memoria tras el `map` (array chico). Decidir en
  implementación según lo que compile limpio.

## 3. UI — `app/alumno/page.tsx`

- `type SeccionId` gana `'companeros'`.
- `SECCIONES_REALES` gana `{ id: 'companeros', etiqueta: 'Compañeros' }` — al
  final de las secciones reales, antes del separador de "próximamente".
- `PanelSeccion` enruta `case 'companeros': return <SeccionCompaneros />`. Se
  mantiene el guard de exhaustividad `const _exhaustivo: never = seccion`.
- **`SeccionCompaneros`** (componente nuevo en el mismo archivo, mismo criterio
  que las otras `Seccion*`):
  - `useQuery({ queryKey: ['alumno', 'companeros'], queryFn })` — dispara al
    montarse la sección. React Query cachea; cambiar de sección y volver no
    re-fetchea.
  - `catch` en el `queryFn` con `console.error('[SeccionCompaneros] ...', err)`
    antes de re-lanzar (regla 12), igual que `AlumnoPerfilPage` hoy.
  - **Estados:**
    - Loading: texto "Cargando…" discreto (`text-sm text-slate/60`).
    - Error: caja `border border-error-border bg-error-bg px-4 py-3 text-sm
      text-crimson` con `error.message` si `error instanceof ApiError`, si no el
      genérico "No se pudieron cargar tus compañeros. Intenta de nuevo."
    - `data.length === 0`: estado vacío discreto — "No estás matriculado en
      ningún grupo todavía."
  - **Contenido (data.length > 0):** `<section className="rounded-lg border
    border-mist p-5">` con `<h2>Compañeros</h2>` y, dentro, una sub-tarjeta por
    grupo:
    - `<div className="rounded-lg border border-mist p-4">`
    - Encabezado: `{grupo.nombre}` (`text-sm font-semibold text-navy`) +
      línea secundaria `{carrera.nombre} · {anioInicio}-{cicloActual} · Salón
      {salon.nombre}` (`text-xs text-slate/60`).
    - `companeros.length === 0`: `<p className="mt-2 text-sm text-slate/60">Aún
      no hay más alumnos en este grupo.</p>`.
    - si no: `<ul>` — cada `<li>` con nombre completo (`text-sm text-slate`,
      nombre en `font-medium`) y línea `{matricula} · Semestre
      {semestreActual}` (`text-xs text-slate/50`).
  - Helper `nombreCompletoDe` ya existe en el archivo — reutilizar (recibe algo
    con `nombres`/`apellidoPaterno`/`apellidoMaterno`; ajustar tipo si hace
    falta).
- Sin dependencias nuevas. Sin componentes compartidos con `app/admin/` (regla
  11). Solo tokens existentes (`navy`, `mist`, `slate`, `bone`, `error-*`,
  `crimson`).

### `lib/api/perfil.ts`

- Agregar `export interface CompaneroItem` y `export interface GrupoConCompaneros`
  con el shape de arriba.
- Agregar `export async function obtenerCompaneros(): Promise<GrupoConCompaneros[]>`
  — mismo patrón que `obtenerPerfil` / `obtenerUrlDescargaMalla` (usa el helper
  `http` / `apiFetch` ya existente en el archivo, devuelve `res.data`).

## 4. Pruebas

### Backend e2e — `test/perfil-companeros.e2e-spec.ts` (nuevo)

- Alumno en 1 grupo con otros N alumnos → `data` tiene 1 grupo, `companeros`
  con N elementos, **el actor no aparece** en la lista.
- Alumno en 2 grupos del mismo periodo → `data` tiene 2 grupos, cada uno con su
  lista; orden de grupos por `nombre asc` (mismo `anioInicio`/`cicloActual`).
- Alumno en 0 grupos → `200 { data: [] }`.
- Alumno solo en su grupo (sin más matriculados) → grupo presente con
  `companeros: []`.
- Aislamiento cross-sede: alumno de sede A cuyo grupo tiene el mismo `nombre`
  que un grupo de sede B → no ve ningún alumno de B.
- Actor `MAESTRO` → `403` con `code: 'ROL_NO_AUTORIZADO'`.
- Actor `ADMINISTRATIVO` → `403` con `code: 'ROL_NO_AUTORIZADO'`.
- Sin `Authorization` → `401`.
- Orden de `companeros` por `apellidoPaterno, apellidoMaterno, nombres` asc.
- `afterAll`: limpieza acotada a los `id` reales creados en la corrida
  (`Usuario`, perfiles, `Grupo`, `GrupoAlumno`, `RegistroAuditoria` si aplica) —
  nunca por patrón de email/nombre (regla 14; patrón ya corregido en los otros
  specs de `personas*`).

### Backend unit

- Si `PerfilService` tiene specs unit, agregar cobertura del `map` /
  aplanado y del caso `NotFoundException`. Si no existe suite unit para
  `PerfilService`, no crear una nueva solo para esto (los e2e cubren el
  comportamiento) — decisión en implementación.

### Frontend

- `pnpm build` + `pnpm tsc --noEmit` (o el script equivalente del repo) limpios.
- Verificación manual en navegador con un alumno de `seed-variado.ts` que esté
  matriculado en un grupo — junto con el click-through pendiente del flujo de
  Grupos (Días 30-31).

## Fuera de alcance (explícito)

- Ver compañeros de otro alumno / cualquier ruta con `:id`.
- Datos de contacto, salud, correo, CURP o estatus de los compañeros.
- Foto / avatar (no existe feature de subida de foto).
- Filtro / búsqueda / paginación dentro de la lista.
- Que el maestro vea a los alumnos de su grupo (eso es Fase 12).
- Cualquier cambio al shape de `GET /perfil`.

## Ejecución

Subagent-Driven Development:

1. **Task backend** (`backend-coder`): endpoint + service + e2e spec + entrada
   en `CLAUDE.md`.
2. **Task frontend** (`alumno-coder`): `lib/api/perfil.ts` + sección en
   `app/alumno/page.tsx`.
3. **Review final** del árbol de cambios.
4. **QA:** `qa-backend` + `qa-alumno` consignan veredicto en `ESTADO.md`.
5. Marcar checkbox de Día 32 en `ESTADO.md`; al cerrar Fase 11, tachar en
   `roadmap.md` + actualizar la línea "Fase actual" de `CLAUDE.md`.
