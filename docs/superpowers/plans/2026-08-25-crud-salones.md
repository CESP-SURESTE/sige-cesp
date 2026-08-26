# Plan — CRUD completo de `Salon`

## Contexto

Gap real detectado en el review final de Día 29 (UI de creación de grupos):
`POST /sedes` no crea ningún `Salon`, y no existe forma de crear uno desde
la UI — solo `GET /salones` (lectura, Día 29) y datos de seed. Resultado:
**toda sede nueva creada vía `/plataforma/sedes` es incapaz de tener grupos**
hasta que alguien inserte salones a mano en la DB. `Salon` ya está listado
en la tabla "CRUD por tipo de entidad" de `CLAUDE.md` raíz como entidad de
"CRUD completo" (mismo grupo que `Sede`/`Carrera`/`Grupo`), así que esto es
completar un patrón ya decidido, no una feature nueva por inventar.

Sin día de roadmap asignado — igual criterio que `GET /personas/resumen` o
`GET /platform-admin/resumen`: se construye directo y se documenta
retroactivamente en `CLAUDE.md`/`ESTADO.md` al cerrar.

## Decisiones de diseño

- Vive en `app/admin/` (no en `app/plataforma/`) — a diferencia de `Sede`,
  `Salon` pertenece a una sede específica y lo administra el
  `ADMINISTRATIVO` de esa sede, exactamente como `Carrera`. Mismos guards
  que `CarrerasController`/`GruposController`/`SalonesController` (`GET`,
  ya existente): `SedeGuard`+`RolesGuard`, `@Roles(ADMINISTRATIVO)` por
  método, SIN jerarquía de `nivelPermiso` (decisión ya establecida para
  este grupo de entidades).
- `sedeId` siempre de `@SedeActual()`, nunca del body/query/param.
- `nombre` único por sede (case-insensitive, validado a nivel de
  aplicación, sin unique compuesto NUEVO en el schema — el schema YA tiene
  `@@unique([sedeId, nombre])` en `Salon`, así que además de la validación
  de aplicación con mensaje claro, la DB respalda como backstop; mismo
  criterio que `Carrera.nombre`/`Grupo.nombre`) — 409 `CONFLICT`.
- `PATCH` (no `PUT`) — mismo criterio real que `Carreras`/`Sedes` a pesar
  de que la tabla de `CLAUDE.md` diga "PUT" genéricamente; el código real
  del proyecto siempre usa `PATCH` parcial. No romper esa convención acá.
- `PATCH /salones/:id`: campos opcionales, `{}` vacío es válido (sin
  cambio). Solo audita `EDICION` si hay cambios reales (`hayCambiosReales`,
  mismo patrón que `CarrerasService`).
- `DELETE /salones/:id`: bloquea con `409 CONFLICT` si el salón tiene
  `Grupo`s asociados (chequeo explícito por `count`, mensaje con la
  cantidad — mismo estilo que el chequeo de alumnos activos en `DELETE
  /sedes/:id`, NO el catch-all genérico de `P2003`, porque acá solo hay una
  tabla que referencia `Salon` y merece un mensaje específico). Fallback
  `catch` de `P2003` de todas formas, por si algo se nos escapa.
- Sin `GET /salones/:id` — mismo criterio que `Carreras` (Día 21): el
  listado ya trae el objeto completo (`{ id, nombre, capacidad }`, sin
  campos adicionales que ocultar), así que el frontend prellena edición
  desde el caché de React Query, sin round-trip nuevo.
- `GET /salones` (Día 29, ya existe) NO cambia de shape — sigue siendo
  `SalonListItem { id, nombre, capacidad }`, suficiente para todo lo de
  este plan.
- Frontend: `app/admin/salones/page.tsx`, calcado de
  `app/admin/carreras/page.tsx` (form arriba + tabla abajo) PERO con botón
  "Eliminar" + modal de confirmación local (patrón de
  `app/plataforma/sedes/ConfirmarEliminarSedeModal.tsx`, código propio sin
  compartir — árbol distinto, identidad distinta, regla 11 aplica también
  por prudencia aunque no lo prohíba explícitamente para plataforma).
- Cierra el loop del gap real: el hint "No hay salones registrados en tu
  sede." que ya existe en `app/admin/grupos/page.tsx` (Día 29, fix wave)
  gana un link a `/admin/salones` para que el admin pueda resolverlo sin
  salir de la pantalla de grupos.
- Sidebar: nuevo item "Salones", posicionado entre "Carreras" y "Grupos" en
  `NAV_PRINCIPAL` — orden lógico del flujo de alta (Carreras y Salones son
  catálogos base, Grupos los consume).

## Global Constraints

- `sedeId` NUNCA en body/query del cliente — regla 2.
- Todo catch/error handler loguea antes de responder — regla 12.
- Contrato de API: éxito `{ data: ... }`, error `{ error, code }`. Sin
  códigos nuevos — reutiliza `VALIDATION_ERROR`/`NOT_FOUND`/`CONFLICT`.
- `RegistroAuditoria` se crea en la misma transacción del alta/edición/
  borrado (regla 5) — `usuarioId` = actor, `sedeId` = la sede del salón.
- Frontend: React Query para todo fetch, árbol `app/admin/` sin compartir
  componentes con `app/alumno/`/`app/maestro/`/`app/plataforma/` (regla
  11). No agregar dependencias nuevas — modal/ícono con lo ya usado en el
  repo (Tailwind, SVG inline).
- Next.js 16 tiene breaking changes vs. training data — si algo de App
  Router no se comporta como se espera, revisar
  `App/frontend/node_modules/next/dist/docs/` antes de asumir bug propio.

## Task 1 — Backend: `POST`/`PATCH`/`DELETE /salones`

**Archivos:**
- `App/backend/src/salones/salones.controller.ts` (extender — ya existe
  `GET`)
- `App/backend/src/salones/salones.service.ts` (extender — ya existe
  `listarPorSede`)
- `App/backend/src/salones/dto/crear-salon.dto.ts` (nuevo)
- `App/backend/src/salones/dto/actualizar-salon.dto.ts` (nuevo)
- `App/backend/test/salones.e2e-spec.ts` (extender — ya existe, tiene los
  tests de `GET`)

**Requisitos:**

1. `CrearSalonDto`: `nombre` (`string`, requerido, `@IsNotEmpty`),
   `capacidad` (`int`, requerido, `@Min(1)`). Sin `sedeId`.
2. `ActualizarSalonDto`: mismos 2 campos, ambos `@IsOptional()` (`{}`
   válido).
3. `POST /salones` (`@HttpCode(201)`, `@Roles(ADMINISTRATIVO)`) →
   `SalonesService.crear(dto, sedeId, actorUsuarioId)`:
   - Valida `nombre` único por sede (case-insensitive, `findFirst` con
     `mode: 'insensitive'`, mismo patrón que
     `GruposService.crear`/`CarrerasService`) → `409 CONFLICT` con mensaje
     "Ya existe un salón con ese nombre en tu sede".
   - Transacción: crea el `Salon` + `RegistroAuditoria` (`accion: ALTA`,
     `entidad: 'Salon'`, `detalle: { nombre, capacidad }`).
   - `try/catch` con `console.error('[SalonesService.crear] error inesperado:', err)`
     antes de re-lanzar (regla 12).
   - Retorna el `Salon` completo (sin relaciones expandidas, mismo criterio
     que `POST /grupos`/`POST /carreras`).
4. `PATCH /salones/:id` (`@Roles(ADMINISTRATIVO)`) →
   `SalonesService.actualizar(id, dto, sedeId, actorUsuarioId)`:
   - `findFirst({ where: { id, sedeId } })` — si no existe o no pertenece a
     la sede → `404 NOT_FOUND`.
   - Si `dto.nombre` viene y difiere del actual (case-insensitive), valida
     unicidad igual que en `crear` (excluyendo el propio `id`) → `409
     CONFLICT`.
   - `hayCambiosReales(dto, existente)` — función local igual a la de
     `CarrerasService` (compara cada campo presente en el `dto` contra el
     valor actual; ausente o igual no cuenta como cambio). Si no hay
     cambios reales, actualiza igual (PATCH parcial válido con `{}`) pero
     NO audita.
   - Transacción: `tx.salon.update` + (si `hayCambiosReales`)
     `RegistroAuditoria` (`accion: EDICION`).
   - `try/catch` con logging (regla 12).
5. `DELETE /salones/:id` (`@Roles(ADMINISTRATIVO)`, sin `@HttpCode`
   explícito → default `200`) → `SalonesService.eliminar(id, sedeId,
   actorUsuarioId)`:
   - `findFirst({ where: { id, sedeId } })` → `404 NOT_FOUND` si no existe.
   - `count` de `Grupo` con `salonId: id` → si `> 0`, `409 CONFLICT` con
     mensaje `` `No se puede eliminar: el salón tiene ${n} grupo(s)
     asociado(s)` ``.
   - Transacción: `RegistroAuditoria` (`accion: ELIMINACION`, `detalle: {
     nombre: salon.nombre }` — snapshot, mismo criterio que `DELETE
     /sedes`) creado ANTES del `tx.salon.delete` (mismo orden que
     `SedesService.eliminar`, por si algo dependiera de este registro
     antes del borrado — aquí no aplica el `onDelete: SetNull` de
     `RegistroAuditoria.sedeId` porque no estamos borrando la Sede, pero
     mantener el mismo orden es más consistente).
   - `catch` de `Prisma.PrismaClientKnownRequestError` código `P2003`
     como fallback defensivo (no debería dispararse nunca dado el chequeo
     explícito de arriba, pero por si el schema gana otra FK a `Salon` en
     el futuro) → `409 CONFLICT` genérico.
   - Retorna `200 { data: { ok: true } }` (mismo shape que `DELETE
     /sedes/:id`).
6. Tests e2e — agrega a `salones.e2e-spec.ts` (ya tiene el setup de
   login/JWT/DB real de Día 29, extiende ese mismo archivo):
   - `POST /salones`: alta exitosa (verifica `RegistroAuditoria`), nombre
     duplicado en la misma sede → 409, nombre igual en OTRA sede → 201
     permitido (aislamiento), `capacidad` inválida (0, negativo, no
     entero) → 400, sin campos requeridos → 400, sin token → 401, rol no
     autorizado → 403.
   - `PATCH /salones/:id`: edición parcial exitosa, `{}` vacío válido sin
     auditoría nueva, `id` de otra sede → 404, rename a nombre duplicado →
     409, rename al mismo nombre (sin cambio real) → sin auditoría nueva.
   - `DELETE /salones/:id`: borrado exitoso sin grupos asociados, bloqueo
     409 con salón que SÍ tiene grupos (usa el seed existente — confirma
     cuál salón del seed ya tiene un `Grupo`, o crea uno de prueba dentro
     del test), `id` inexistente/otra sede → 404, aislamiento cruzado.

**Verificación:** suite e2e completa en verde (no solo el archivo nuevo),
mismo criterio que Días 28/29.

## Task 2 — Frontend: gestión de salones (`app/admin/salones/`)

**Depende de Task 1.** No arrancar hasta que Task 1 tenga review clean.

**Archivos:**
- `App/frontend/src/lib/api/salones.ts` (extender — ya existe
  `listarSalones`/`Salon`)
- `App/frontend/src/app/admin/salones/page.tsx` (nuevo)
- `App/frontend/src/app/admin/salones/ConfirmarEliminarSalonModal.tsx`
  (nuevo)
- `App/frontend/src/components/admin/ui/shell/icons.tsx` (agregar
  `IconSalones`)
- `App/frontend/src/components/admin/ui/shell/Sidebar.tsx` (agregar
  entrada, entre Carreras y Grupos)
- `App/frontend/src/app/admin/grupos/page.tsx` (editar — el hint de
  catálogo vacío de salón gana un link a `/admin/salones`)

**Requisitos:**

1. `lib/api/salones.ts` — agrega, leyendo el backend real de Task 1 para
   el shape exacto:
   - `interface SalonInput { nombre: string; capacidad: number }`
   - `crearSalon(input: SalonInput): Promise<Salon>` → `POST /salones`
   - `actualizarSalon(id: string, input: Partial<SalonInput>): Promise<Salon>` → `PATCH /salones/:id`
   - `eliminarSalon(id: string): Promise<{ ok: true }>` → `DELETE /salones/:id`

2. `app/admin/salones/page.tsx` — mismo patrón exacto que
   `app/admin/carreras/page.tsx` (léelo completo antes de escribir
   código): card de alta arriba, tabla abajo (columnas `Nombre`,
   `Capacidad`, acciones), un solo `useState` de formulario que alterna
   "nuevo"/"editar" según `editandoId` (o dos forms como carreras — sigue
   ESE patrón tal cual). Agrega botón "Eliminar" por fila (texto
   `text-crimson`, mismo estilo que `sedes/page.tsx:269-273`) que abre
   `ConfirmarEliminarSalonModal`. `useMutation` de `eliminarMutation` con
   `onError` mapeando `CONFLICT` al mensaje real del backend (ya viene con
   la cantidad de grupos, no hace falta reformularlo) vía
   `resolverMensajeError`/passthrough (mismo criterio ya usado en
   `grupos/page.tsx` para `VALIDATION_ERROR`, adaptarlo acá para
   `CONFLICT` en este dominio si `resolverMensajeError` no lo cubre ya
   genéricamente). Sin paginar (catálogo chico, mismo criterio que
   `GET /salones`/`GET /carreras`).

3. `ConfirmarEliminarSalonModal.tsx` — copia estructural de
   `app/plataforma/sedes/ConfirmarEliminarSedeModal.tsx` (código propio,
   NO import cruzado), adaptado a `Salon` en vez de `Sede`.

4. `IconSalones` en `icons.tsx` — SVG inline nuevo, mismo `BASE`
   compartido. Sugerencia: algo tipo "puerta de aula" o "llave" para
   diferenciarlo visualmente de `IconGrupos` (aula con pupitres) y
   `IconCarreras` — a discreción del implementador, mismo estilo de trazo.

5. `Sidebar.tsx` — entrada `{ href: '/admin/salones', label: 'Salones',
   Icon: IconSalones, match: 'prefijo' }` en `NAV_PRINCIPAL`, insertada
   ENTRE la entrada de `Carreras` y la de `Grupos`.

6. `app/admin/grupos/page.tsx` — el hint de catálogo vacío de salón
   ("No hay salones registrados en tu sede.", agregado en el fix wave de
   Día 29) gana un `<Link href="/admin/salones">` con texto tipo "Crea uno
   aquí" o similar, consistente con el estilo del resto de la página. El
   hint de carrera vacía NO necesita este link (`Carrera` ya tenía su
   propio CRUD desde Día 21, este plan no lo toca).

**Verificación:** sin suite de tests de frontend en este proyecto
(confirmado en el review final de Día 29) — verificación real es `tsc
--noEmit` limpio + build sin errores + (si es posible en el entorno del
implementador) confirmar visualmente en `localhost:3000/admin/salones` que
el admin puede crear, editar y eliminar un salón real, y que el flujo
completo de `admin/grupos` → dropdown de salón → grupo creado sigue
funcionando de punta a punta.

## Fuera de alcance (a propósito)

- Validar `Grupo.capacidad <= Salon.capacidad` — mismo alcance ya
  establecido en Día 28, sin cambios aquí.
- Choque de horario/salón compartido entre grupos del mismo periodo — no
  pedido, no hay concepto de horario en el modelo todavía.
- `GET /salones/:id` — mismo criterio que Carreras, no se necesita hoy.
- Baja lógica de `Salon` — es DELETE real (`Salon` es "CRUD completo" en
  la tabla de `CLAUDE.md`, no "sin DELETE real" como los perfiles de
  persona).
