# Plan — Retrofit: "Editar" usa modal + filtro de salón en Grupos

## Contexto

**Parte 1 — regla nueva del usuario (2026-08-25, agregada a `CLAUDE.md` raíz como
regla 13):** editar un registro existente SIEMPRE usa un modal, nunca el patrón de "la
card de alta se convierte en card de edición" que usan hoy 3 pantallas. Retrofit pedido
explícitamente para las 3 (no solo hacia adelante):

- `app/admin/carreras/page.tsx` (`Carrera`)
- `app/admin/salones/page.tsx` (`Salon`)
- `app/plataforma/sedes/page.tsx` (`Sede`)

Después de las tasks de implementación, el usuario pidió explícitamente un agente que
revise el resultado ("lanzas un agente que los cheque") antes de seguir él revisando —
ese es el review final de este plan.

**Parte 2 — pedido adicional del mismo usuario, misma sesión:** el listado de
`app/admin/grupos/page.tsx` no tiene filtro por salón hoy (`GET /grupos`, Día 28, solo
soporta `anioInicio`/`cicloActual`/`carreraId`). El usuario pidió agregarlo, explícito
en que debe ser un `<select>` alimentado de los salones reales de la sede
(`listarSalones()`, ya existe) — NUNCA un input de texto libre, "da puerta a posibles
errores de tipeo". Mismo criterio ya aplicado al filtro de `carreraId` existente (ya es
un `Select`, no texto libre) — este pedido extiende ese mismo criterio a salón.

## Decisiones de diseño

- El formulario de "Nuevo X" se queda FIJO en la página, sin cambios de comportamiento
  (sigue siendo el mismo `crearMutation`, mismo submit). Solo el flujo de EDICIÓN
  cambia.
- "Editar" abre un modal prellenado con los valores reales del registro (mismo
  criterio que ya usa cada página hoy — `GET` de listado trae el objeto completo, sin
  round-trip nuevo). El modal es dueño de su propio estado de formulario interno (no
  vive levantado en la página como hoy `formEdicion`) — recibe el registro completo +
  callbacks (`onGuardar`, `onCancelar`) + `guardando: boolean`, y llama al callback con
  el payload armado al hacer submit.
- Guardar/Cancelar viven DENTRO del modal (no en la card de la página).
- Cada árbol (`app/admin/`, `app/plataforma/`) tiene su PROPIO modal local por entidad
  — sin componente `Modal` genérico compartido entre árboles (regla 11 sigue
  aplicando), mismo criterio que los modales de confirmación de borrado ya existentes
  (`ConfirmarEliminarSedeModal.tsx`, `ConfirmarEliminarSalonModal.tsx`). Es más código
  duplicado a propósito — decisión explícita del usuario ("aunque es más código").
- Contenedor visual del modal: mismas clases ya establecidas por los modales de
  confirmación de borrado (`fixed inset-0 z-50 flex items-center justify-center
  bg-slate/40 p-4`, panel `rounded-lg bg-white p-6 shadow-lg`) — pero estos modales de
  EDICIÓN tienen más campos que un simple confirm, así que usa `max-w-lg` (o `max-w-xl`
  si el form de la entidad es ancho, ej. Sede con 4 campos en grid de 2 columnas) en vez
  del `max-w-md` de los modales de confirmación.
- El estado `editandoId`/`formEdicion` que hoy vive en cada página se reemplaza por un
  solo state con el registro completo siendo editado (mismo patrón que ya usan
  `carreraAEliminar`/`salonAEliminar`/`sedeAEliminar` para el modal de borrado) — ej.
  `carreraEditando: Carrera | null`, `salonEditando: Salon | null`, `sedeEditando: Sede
  | null`. `iniciarEdicion(x)` pasa a ser simplemente `setXEditando(x)`.
- Botón "Editar" en la tabla sigue igual (`onClick={() => setXEditando(x)}` en vez de
  `iniciarEdicion(x)`).
- Los componentes `CamposCarrera`/`CamposSalon` (helpers de campos compartidos hoy entre
  "nuevo"/"editar" en cada página) — mantenlos para el form de ALTA en la página, pero
  el modal de edición puede reusar el mismo JSX de campos internamente si es más simple
  copiarlo dentro del modal (evita pasar `requerido`/callbacks complejos cross-
  componente); a discreción del implementador, cualquiera de las dos formas es válida
  mientras el resultado visual sea el mismo.
- Sedes (`app/plataforma/sedes/page.tsx`) hoy usa un solo `<form>`/state que alterna
  título y mutation según `editandoId` (patrón distinto a Carreras/Salones, que ya
  tenían 2 forms separados) — el form de la página se simplifica a SOLO el flujo de
  alta (`crearMutation`, título fijo "Nueva sede", sin lógica condicional de
  editandoId), y el modal nuevo (`EditarSedeModal.tsx`) es dueño exclusivo del flujo de
  edición (`actualizarMutation`).

## Global Constraints

- React Query para todo fetch, sin `fetch` nativo suelto.
- `app/admin/` y `app/plataforma/` no comparten componentes entre sí ni con
  `app/alumno/`/`app/maestro/` (regla 11).
- No agregar dependencias nuevas — modal con `fixed`/Tailwind, sin librería de
  diálogos.
- Todo catch/error handler loguea antes de responder (regla 12) — ya está resuelto en
  los `useMutation` existentes, el retrofit no debe perder ese logging al mover código.
- No cambies el contrato de las mutaciones (`crearCarrera`/`actualizarCarrera`,
  `crearSalon`/`actualizarSalon`, `crearSede`/`actualizarSede`) ni sus mensajes de
  error — solo el contenedor visual/estructural de dónde vive el form de edición.
- Mismo mapeo de errores (`resolverMensajeError`/`MENSAJES_ERROR_*`) que ya existe en
  cada página, sin reformular mensajes.
- Next.js 16 en este proyecto tiene breaking changes vs. training data — si algo de App
  Router no se comporta como se espera, revisar
  `App/frontend/node_modules/next/dist/docs/` antes de asumir bug propio.

## Task 1 — `app/admin/`: modales de Carreras y Salones

**Archivos:**
- `App/frontend/src/app/admin/carreras/page.tsx` (editar)
- `App/frontend/src/app/admin/carreras/EditarCarreraModal.tsx` (nuevo)
- `App/frontend/src/app/admin/salones/page.tsx` (editar)
- `App/frontend/src/app/admin/salones/EditarSalonModal.tsx` (nuevo)

**Requisitos — Carreras:**

1. Lee `App/frontend/src/app/admin/carreras/page.tsx` completo primero (código
   actual real, la única fuente de verdad de campos/mutations/mensajes).
2. Quita el bloque `{editandoId ? (...) : (...)}` — el `return` de la página solo
   renderiza el form de "Nueva carrera" fijo (la rama que hoy es el `else`).
3. Reemplaza `editandoId: string | null` + `formEdicion: FormEdicion` por
   `carreraEditando: Carrera | null` (mismo patrón que `carreraParaMalla` que ya
   existe en este archivo para el modal de malla).
4. `iniciarEdicion(carrera)` → `setCarreraEditando(carrera)`. Botón "Editar" de la
   tabla llama a esto.
5. Nuevo `EditarCarreraModal.tsx` — props: `carrera: Carrera`, `guardando: boolean`,
   `onGuardar: (payload: ActualizarCarreraInput) => void`, `onCancelar: () => void`.
   Contiene los mismos campos que `CamposCarrera` (nombre, clave, duración, nivel,
   modalidad, RVOE, descripción) + el select de `estatus` que hoy vive fuera de
   `CamposCarrera` en la rama de edición — TODO prellenado con los valores reales de
   `carrera` (no arranca vacío). Arma el payload igual que
   `construirPayloadEdicion` (en blanco = sin cambio) al hacer submit y llama a
   `onGuardar(payload)`. Botones Guardar/Cancelar dentro del modal, mismo estilo que
   `ConfirmarEliminarSedeModal.tsx` pero con `max-w-lg`.
6. En `page.tsx`, `actualizarMutation.onSuccess` cierra el modal (`setCarreraEditando(null)`)
   en vez de limpiar `formEdicion`/`editandoId`. El render del modal:
   `{carreraEditando && <EditarCarreraModal carrera={carreraEditando} guardando={actualizarMutation.isPending} onGuardar={(payload) => actualizarMutation.mutate({ id: carreraEditando.id, input: payload })} onCancelar={() => setCarreraEditando(null)} />}`.
7. El modal de malla (`SubirMallaModal`, `carreraParaMalla`) NO se toca — sigue
   funcionando igual, es independiente de este retrofit.

**Requisitos — Salones:** mismo patrón, adaptado:

1. Lee `App/frontend/src/app/admin/salones/page.tsx` completo primero.
2. Quita el bloque `{editandoId ? (...) : (...)}`, se queda solo el form de "Nuevo
   salón".
3. `editandoId`/`formEdicion` → `salonEditando: Salon | null`.
4. Nuevo `EditarSalonModal.tsx` — props: `salon: Salon`, `guardando: boolean`,
   `onGuardar: (payload: Partial<SalonInput>) => void`, `onCancelar: () => void`.
   Campos: nombre, capacidad, prellenados. Mismo criterio de payload que
   `construirPayloadEdicion` actual (en blanco = sin cambio). `max-w-lg` o más chico
   (solo 2 campos, puede ser `max-w-md` si se ve mejor con tan pocos campos — a
   discreción visual del implementador).
5. Ojo con la interacción edición↔borrado que ya existe en `eliminarMutation.onSuccess`
   (`if (editandoId === id) { setEditandoId(null); ... }`) — el equivalente nuevo es
   `if (salonEditando?.id === id) setSalonEditando(null)` (cerrar el modal de edición
   si el salón que se acaba de eliminar era el que estaba en edición).

**Verificación:** `tsc --noEmit` limpio + `npm run build` exitoso. Sin suite de tests
de frontend en este proyecto (no la inventes). Si el entorno lo permite, confirma
visualmente que el flujo completo (crear → editar vía modal → cancelar → eliminar)
sigue funcionando en ambas páginas.

## Task 2 — `app/plataforma/`: modal de Sedes

**Depende de nada (independiente de Task 1), pero espera a que Task 1 termine antes
de arrancar — mismo criterio general del proyecto de no despachar implementadores en
paralelo.**

**Archivos:**
- `App/frontend/src/app/plataforma/sedes/page.tsx` (editar)
- `App/frontend/src/app/plataforma/sedes/EditarSedeModal.tsx` (nuevo)

**Requisitos:**

1. Lee `App/frontend/src/app/plataforma/sedes/page.tsx` completo primero — ojo, este
   archivo usa un patrón MÁS simple que Carreras/Salones hoy (un solo `<form>`/state
   que alterna título "Nueva sede"/"Editar sede" y mutation según `editandoId`, sin 2
   forms separados) — vas a introducir la separación nuevo/editar que Carreras/Salones
   ya tenían, no solo mover código existente.
2. El `<form>` de la página se simplifica: título fijo "Nueva sede", `onSubmit` llama
   siempre a `crearMutation.mutate(form)` (quita la rama `if (editandoId)`), sin botón
   "Cancelar" condicional (ese código de cancelar edición se va al modal).
3. `editandoId: string | null` → `sedeEditando: Sede | null`. `iniciarEdicion(sede)` →
   `setSedeEditando(sede)`.
4. Nuevo `EditarSedeModal.tsx` — mismo patrón estructural que
   `ConfirmarEliminarSedeModal.tsx` ya en esta carpeta (léelo primero, mismo estilo de
   overlay/panel) pero con los 4 campos del form (`nombre`, `telefono`, `direccion`,
   `ubicacionReferencia` — grid de 2 columnas como hoy, `costoRenta` NO se edita aquí,
   no está en el form actual tampoco). Props: `sede: Sede`, `guardando: boolean`,
   `onGuardar: (input: SedeInput) => void`, `onCancelar: () => void`. Prellenado con
   los valores reales de `sede` (incluyendo `costoRenta` en el payload que arma al
   guardar, igual que `iniciarEdicion` actual lo incluye en el `form` state — aunque no
   se edite visualmente, no se debe perder el valor existente al hacer `PATCH`; si el
   campo no se toca en el modal, no lo mandes en el payload en vez de mandar un valor
   viejo — mismo criterio "en blanco = sin cambio" que las otras 2 entidades. Revisa el
   DTO real de `PATCH /sedes/:id` en `App/backend/src/sedes/` si hay duda del shape
   exacto). `max-w-lg`.
5. `actualizarMutation.onSuccess` cierra el modal (`setSedeEditando(null)`) en vez de
   limpiar `form`/`editandoId`.
6. `eliminarMutation.onSuccess` — mismo ajuste que Salones: si la sede eliminada era la
   que estaba en el modal de edición, ciérralo.

**Verificación:** `tsc --noEmit` limpio + `npm run build` exitoso.

## Task 3 — Backend: filtro `salonId` en `GET /grupos`

**Independiente de Tasks 1/2, puede correr en cualquier momento — pero Task 4
(frontend) depende de esta.**

**Archivos:**
- `App/backend/src/grupos/dto/listar-grupos.query.dto.ts` (editar)
- `App/backend/src/grupos/grupos.service.ts` (editar — método `listar`)
- `App/backend/test/grupos.e2e-spec.ts` (extender)

**Requisitos:**

1. `ListarGruposQueryDto` — agrega `salonId?: string` con `@IsOptional()` +
   `@IsUUID('4', { message: 'salonId debe ser un UUID válido' })`, mismo patrón exacto
   que el `carreraId` que ya existe ahí al lado.
2. `GruposService.listar` — agrega `salonId` al objeto `where` del `Prisma.GrupoWhereInput`,
   mismo patrón condicional que `carreraId`:
   `...(filtros.salonId ? { salonId: filtros.salonId } : {})`. Sin validar que el
   `salonId` pertenezca a la sede antes de filtrar (el `where` ya incluye `sedeId`, así
   que un `salonId` de otra sede simplemente no matchea nada — 0 resultados, no un
   error, mismo comportamiento implícito que ya tiene `carreraId` hoy).
3. Tests e2e — agrega a `grupos.e2e-spec.ts`: filtrar por `salonId` real devuelve solo
   los grupos de ese salón; `salonId` no-UUID → `400 VALIDATION_ERROR`; `salonId` de
   otra sede → `200` con `data: []` (no error); combinar `salonId` con los otros
   filtros existentes (`anioInicio`/`cicloActual`/`carreraId`) sigue funcionando.

**Verificación:** suite e2e completa en verde, no solo el archivo nuevo.

## Task 4 — Frontend: dropdown de salón en el filtro de Grupos

**Depende de Task 3.** No arrancar hasta que Task 3 tenga review clean.

**Archivos:**
- `App/frontend/src/lib/api/grupos.ts` (editar — `ListarGruposFiltros`)
- `App/frontend/src/app/admin/grupos/page.tsx` (editar)

**Requisitos:**

1. `ListarGruposFiltros` en `lib/api/grupos.ts` gana `salonId?: string`, y
   `listarGrupos`/`construirQueryString` lo incluyen en el querystring igual que
   `carreraId` (mismo patrón condicional ya existente ahí).
2. En `app/admin/grupos/page.tsx`, agrega un filtro de salón junto a los filtros
   existentes (`anioInicio`, `cicloActual`, `carreraId`) — un `<Select>` (el mismo
   componente reutilizable que ya usa el filtro de carrera,
   `components/admin/ui/persona-alta/Select.tsx`), alimentado de `salonesQuery.data`
   (la query de `listarSalones()` que YA existe en esta página para el dropdown del
   formulario de alta — reutilízala, no dupliques la query). Opción vacía primero
   (`{ value: '', label: 'Todos los salones' }`, mismo criterio que el fix ya aplicado
   al filtro de carrera — debe poder limpiarse). Mismos estados de error/vacío que ya
   tiene el select de salón del formulario de alta si `salonesQuery` falla o está
   vacía (reutiliza esa misma lógica/mensaje, no la reinventes para el filtro).
3. El nuevo filtro entra al `queryKey`/`filtros` de `listarGrupos` igual que
   `anioInicio`/`cicloActual`/`carreraId` ya lo hacen (mismo `useState` + inclusión en
   el objeto de filtros que dispara el refetch).

**Verificación:** `tsc --noEmit` limpio + `npm run build` exitoso.

## Fuera de alcance

- No se toca ningún modal de CONFIRMACIÓN DE BORRADO existente
  (`ConfirmarEliminarSedeModal.tsx`, `ConfirmarEliminarSalonModal.tsx`) — ya son
  modales, cumplen la regla nueva tal cual.
- No se toca `SubirMallaModal.tsx` (ya es modal).
- No se crea ningún componente `Modal` genérico compartido — decisión explícita
  (regla 11 + "aunque es más código").
- No se agregan campos nuevos a ningún formulario, no se cambia ninguna validación de
  negocio — este plan es puramente estructural/visual.
