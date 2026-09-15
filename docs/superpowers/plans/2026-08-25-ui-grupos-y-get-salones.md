# Plan — Día 29: UI de creación de grupos + `GET /salones` (gap de backend)

## Contexto

Fase 9, Día 28 cerró `POST`/`GET /grupos` (backend). Día 29 (roadmap,
`docs/roadmap.md` línea 572) pide:

- Formulario de alta de grupo (Tailwind, mismo patrón que sedes/carreras de
  la Fase 6).
- Listado de grupos por periodo.
- Entregable visible: admin crea un grupo real desde la UI, sin Postman.

**Gap encontrado al planear** (no estaba en el roadmap): no existe
`GET /salones`. `Salon` tiene modelo en `schema.prisma` y datos reales de
seed (2 salones por sede), pero cero código de aplicación — mismo estado en
que estaba `Grupo` antes del Día 27/28. Sin este endpoint, el formulario de
alta de grupo no puede poblar el `<select>` de salón (`salonId` es un campo
requerido de `POST /grupos`). Confirmado con el usuario: se agrega al
alcance de hoy como una tarea de backend mínima — solo lectura, mismo
patrón que `GET /carreras`, sin CRUD completo de `Salon` (eso no se ha
pedido).

## Decisiones de diseño (ya tomadas, no re-discutir)

- `GET /salones` — mismos guards que `CarrerasController`
  (`SedeGuard`+`RolesGuard`, `@Roles(ADMINISTRATIVO)`, sin jerarquía de
  `nivelPermiso`). `sedeId` siempre de `@SedeActual()`. Sin paginación
  (catálogo chico, mismo criterio que `GET /sedes`/`GET /carreras`). Éxito:
  `200 { data: Salon[] }` con `Salon = { id, nombre, capacidad }` (sin
  `sedeId`/`createdAt`/`updatedAt` — el frontend no los necesita, regla 2).
  Sin código de error nuevo.
- Página `app/admin/grupos/page.tsx` sigue el mismo patrón visual/estructura
  que `app/admin/carreras/page.tsx`: card con form arriba (alta), tabla
  abajo (listado). A diferencia de carreras, el listado de grupos tiene
  filtros reales (`anioInicio`/`cicloActual`/`carreraId`) porque
  `GET /grupos` los soporta — filtros simples arriba de la tabla, no un
  modal aparte.
- Sin edición ni borrado de grupo hoy — `PATCH`/`DELETE /grupos/:id` están
  fuera de alcance del backend (Día 28), así que la UI no ofrece esas
  acciones. Solo alta + listado, calcado del roadmap.
- Link nuevo "Grupos" en el `Sidebar` (`components/admin/ui/shell/
  Sidebar.tsx`), mismo patrón que el resto de `NAV_PRINCIPAL` — ícono nuevo
  en `icons.tsx` siguiendo el `BASE` compartido (viewBox/stroke ya
  definidos ahí, no inventar un set nuevo).
- `capacidad` del grupo se captura en el form (ya es parte de
  `CrearGrupoDto`, Día 28) — sin validar contra `salon.capacidad` (fuera de
  alcance explícito de Día 28, ver `CLAUDE.md` raíz).

## Global Constraints

- `sedeId` NUNCA en body/query del cliente — sale de `@SedeActual()` en
  todo endpoint nuevo (regla 2 de `CLAUDE.md` raíz).
- Todo catch/error handler loguea antes de responder — `console.error` con
  el error completo (regla 12).
- Contrato de API: éxito `{ data: ... }` (+ `page`/`limit`/`total` en listas
  paginadas), error `{ error, code }`. `GET /salones` reutiliza códigos
  fijos existentes, no inventa ninguno.
- Frontend: React Query para todo fetch (no `fetch` nativo suelto), árbol
  `app/admin/` no comparte componentes con `app/alumno/`/`app/maestro/`
  (regla 11). `App/frontend/AGENTS.md`: Next.js 16 tiene breaking changes
  vs. el training data del modelo — si algo de App Router/routing no se ve
  como se espera, revisar `node_modules/next/dist/docs/` antes de asumir.
- Nombrado/estilo: seguir el patrón exacto de `app/admin/carreras/page.tsx`
  (imports de `INPUT_CLASS`/`LABEL_CLASS`/`Select` desde
  `components/admin/ui/persona-alta/`, mismas clases de Tailwind para
  cards/botones/tabla, mismo criterio de `queryKey` por dominio).
- No agregar dependencias nuevas (`CLAUDE.md` global del usuario) — SVG
  inline a mano para el ícono nuevo, como los demás en `icons.tsx`.

## Task 1 — Backend: `GET /salones`

**Archivos:**
- `App/backend/src/salones/salones.module.ts` (nuevo)
- `App/backend/src/salones/salones.controller.ts` (nuevo)
- `App/backend/src/salones/salones.service.ts` (nuevo)
- `App/backend/src/app.module.ts` (registrar `SalonesModule`, mismo lugar
  que `GruposModule`)
- `App/backend/test/salones.e2e-spec.ts` (nuevo)

**Requisitos:**
1. `SalonesController` (`@Controller('salones')`), mismo patrón exacto de
   guards que `CarrerasController`
   (`App/backend/src/carreras/carreras.controller.ts`):
   `@UseGuards(SedeGuard, RolesGuard)` a nivel de clase, `@Roles(RolUsuario.ADMINISTRATIVO)`
   en el método.
2. `GET /salones` → `SalonesService.listarPorSede(sedeId)`:
   `prisma.salon.findMany({ where: { sedeId }, orderBy: { nombre: 'asc' }, select: { id: true, nombre: true, capacidad: true } })`.
   Envolver en `try/catch` con `console.error('[SalonesService.listarPorSede] error inesperado:', err)`
   antes de re-lanzar (regla 12, mismo patrón que
   `GruposService.listar`).
3. Controller devuelve `{ data }` (sin paginar), igual que
   `CarrerasController.listar`.
4. `SalonesModule`: `controllers: [SalonesController], providers: [SalonesService]`
   — regístralo en `app.module.ts` junto a los demás módulos de dominio
   (import + entrada en el array `imports`).
5. Tests e2e (`salones.e2e-spec.ts`, usar `carreras.e2e-spec.ts` o
   `grupos.e2e-spec.ts` como plantilla de setup — login real, DB real, no
   mocks):
   - `GET /salones` autenticado como `ADMINISTRATIVO` devuelve los salones
     de SU sede únicamente (aislamiento cruzado — un admin de otra sede no
     ve estos salones).
   - Shape de cada item: exactamente `{ id, nombre, capacidad }`.
   - Sin token → `401`.
   - Rol no autorizado (ej. `ALUMNO`) → `403 ROL_NO_AUTORIZADO`.

**Verificación:** `pnpm test:e2e` (o el runner que use el proyecto,
confirmar en `package.json`) con la suite completa en verde, no solo el
archivo nuevo — mismo criterio que Día 28 (162/162 antes del cierre).

## Task 2 — Frontend: UI de grupos (`app/admin/grupos/`)

**Depende de Task 1** (consume `GET /salones` real). No arrancar hasta que
Task 1 esté con review clean.

**Archivos:**
- `App/frontend/src/lib/api/salones.ts` (nuevo)
- `App/frontend/src/lib/api/grupos.ts` (nuevo)
- `App/frontend/src/app/admin/grupos/page.tsx` (nuevo)
- `App/frontend/src/components/admin/ui/shell/icons.tsx` (agregar
  `IconGrupos`)
- `App/frontend/src/components/admin/ui/shell/Sidebar.tsx` (agregar entrada
  a `NAV_PRINCIPAL`)

**Requisitos:**

1. `lib/api/salones.ts` — espejo de `lib/api/carreras.ts` pero minimal:
   ```ts
   export interface Salon {
     id: string;
     nombre: string;
     capacidad: number;
   }
   export function listarSalones(): Promise<Salon[]> {
     return apiFetchAuth<Salon[]>('/salones');
   }
   ```

2. `lib/api/grupos.ts` — espejo de `GruposService`/DTOs del backend
   (`App/backend/src/grupos/`, leer `crear-grupo.dto.ts`,
   `listar-grupos.query.dto.ts` y `grupos.service.ts` para el shape exacto
   de `GrupoListItem`/`Grupo`). Incluye:
   - `interface CrearGrupoInput { carreraId, salonId, nombre, anioInicio, cicloActual, capacidad }`
     (todos requeridos, números como `number` ya coercionados en el
     frontend antes de mandarlos).
   - `interface GrupoListItem { id, nombre, anioInicio, cicloActual, capacidad, carrera: { id, nombre }, salon: { id, nombre } }`
   - `interface ListarGruposFiltros { anioInicio?, cicloActual?, carreraId?, page?, limit? }`
   - `interface ListarGruposResult { data: GrupoListItem[], page, limit, total }`
   - `crearGrupo(input: CrearGrupoInput): Promise<Grupo>` → `POST /grupos`
   - `listarGrupos(filtros: ListarGruposFiltros): Promise<ListarGruposResult>` → `GET /grupos` con querystring armado a mano (filtrar `undefined`, mismo criterio que otros `lib/api/*.ts` con query params — revisar si `personas.ts` ya tiene un helper de querystring reutilizable y usarlo si existe, en vez de reinventar).

3. `app/admin/grupos/page.tsx` — client component, mismo patrón de
   `app/admin/carreras/page.tsx`:
   - `useQuery` para `listarCarreras()` (ya existe, para el `<select>` de
     carrera) y `listarSalones()` (nuevo, para el `<select>` de salón) —
     ambos catálogos chicos, sin paginar.
   - Form de alta: `nombre` (text), `carreraId` (Select, opciones de
     `listarCarreras()`), `salonId` (Select, opciones de `listarSalones()`),
     `anioInicio` (number), `cicloActual` (number), `capacidad` (number).
     Validación de completitud igual que `construirPayloadAlta` de
     carreras (todos requeridos, enteros ≥ 1) antes de mandar el POST —
     si algo falta, toast de error genérico sin pegarle al backend.
   - `useMutation` para `crearGrupo` — `onSuccess`: toast de éxito, limpia
     el form, invalida `queryKey: ['admin', 'grupos']`. `onError`: loguea
     (regla 12) + toast con `resolverMensajeError` (mapear al menos
     `CONFLICT` → "Ya existe un grupo con ese nombre en ese periodo" y
     `NOT_FOUND` → "La carrera o el salón seleccionado ya no existe en tu
     sede", el resto cae al mensaje genérico).
   - Filtros de listado arriba de la tabla: `anioInicio`, `cicloActual`,
     `carreraId` (Select con opciones de `listarCarreras()`, reutiliza el
     mismo query) — todos opcionales, cambian el `queryKey` de
     `listarGrupos` para que React Query refetch automático.
   - Tabla: columnas `Nombre`, `Carrera`, `Salón`, `Periodo` (mostrar
     `anioInicio` + `cicloActual` juntos, ej. "2026 · Semestre 3"),
     `Capacidad`. Mismos estados `isLoading`/`isError`/vacío que
     `carreras/page.tsx` (copiar el patrón literal).
   - Paginación simple (botones "Anterior"/"Siguiente" con `page`/`total`/
     `limit` de la respuesta) — no hay precedente exacto en `carreras/
     page.tsx` (sin paginar); si `app/admin/alumnos/page.tsx` o
     `app/admin/maestros/page.tsx` (Día 19, sí paginados) ya resuelven esto,
     replicar ESE patrón en vez de inventar uno nuevo.

4. `IconGrupos` en `icons.tsx` — SVG inline nuevo, mismo `BASE` compartido
   (viewBox `0 0 24 24`, stroke, etc.) que los íconos existentes. Motivo
   sugerido: algo tipo "grupo de personas" o "aula" — a discreción del
   implementador siguiendo el estilo de trazo de los demás íconos del
   archivo, sin librería externa.

5. `Sidebar.tsx` — agregar `{ href: '/admin/grupos', label: 'Grupos', Icon: IconGrupos, match: 'prefijo' }`
   a `NAV_PRINCIPAL`, después de `Carreras` (mismo orden que el roadmap:
   Sedes/Carreras ya existen, Grupos es el siguiente dominio).

**Verificación:** no hay tests e2e de frontend en este proyecto (confirmar
si existe algún test de UI antes de asumir que no) — la verificación real
es manual: build sin errores (`pnpm build` o `tsc --noEmit`, el que use el
proyecto) + confirmar visualmente en el navegador (con el backend/frontend
ya corriendo) que el admin puede crear un grupo real y verlo aparecer en la
tabla. Documentar en el reporte qué se verificó y cómo.

## Fuera de alcance (a propósito)

- `PATCH`/`DELETE /grupos/:id` y su UI correspondiente (edición/borrado de
  grupo) — no existen en el backend, Día 28 los dejó fuera explícitamente.
- CRUD completo de `Salon` (alta/edición/borrado de salones desde la UI) —
  solo se agrega `GET /salones`, lectura mínima para desbloquear el
  dropdown. Si CESP pide gestionar salones desde la UI, es un día de
  roadmap propio, no se improvisa aquí.
- Validar `capacidad <= salon.capacidad` o choque de salón por periodo —
  mismo alcance que el backend de Día 28, sin cambios.
- `Materia` — sigue fuera hasta Fase 12.
