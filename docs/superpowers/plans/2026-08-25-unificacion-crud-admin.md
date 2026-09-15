# Plan — Unificación CRUD admin: un modal para alta+edición + CRUD de Administrativos

## Contexto

Regla 13 de `CLAUDE.md` raíz, versión ampliada (2026-08-25): toda pantalla CRUD de
admin debe ser tabla sola en la página + botón "+ Nuevo X" que abre un modal de
registro; "Editar" reutiliza EL MISMO modal, prellenado. Ya no un formulario fijo
arriba/abajo de la tabla. Este plan ejecuta la ampliación completa que había quedado
deliberadamente diferida ("pendiente para cuando tengamos límite") tras el retrofit
parcial de la sesión anterior (que solo hizo el modal de EDICIÓN, dejando el de alta
como formulario fijo).

**Decisiones de alcance confirmadas con el usuario antes de este plan:**

1. **Administrativos** — el modal de "editar" para esta entidad NO edita campos
   arbitrarios (nombres, correo, puesto, etc.) — la regla 3 de `CLAUDE.md` raíz
   (baja lógica, `PATCH /:id/estatus`) sigue vigente tal cual está escrita.
   "Editar" un administrativo = cambiar su `estatus` (`EstatusEmpleado`), nada más.
2. **Alta de Administrativos** — el formulario de alta (`app/admin/administrativos/
   nuevo/page.tsx`) es un flujo compartido con Alumno/Maestro (`AltaPersonaFormShell`,
   contactos dinámicos, info médica condicional, pantalla de resultado con
   contraseña temporal/matrícula/email) — mucho más grande que Carreras/Salones/
   Sedes/Grupos. NO se mete en un modal. Se queda como página completa, sin tocar.
   Lo que faltaba (y este plan agrega) es el LISTADO — hoy no existe ninguno para
   Administrativos, a diferencia de Alumnos/Maestros (Día 19). El botón "+ Nuevo"
   del listado NAVEGA a `/admin/administrativos/nuevo` (ruta existente), no abre
   modal.
3. **Grupos** — no tiene edición (`PATCH`/`DELETE /grupos/:id` fuera de alcance
   explícito desde Día 28, decisión deliberada, no un gap). Este plan solo convierte
   su ALTA a botón+modal — no agrega edición de grupo.

## Decisiones de diseño

- **Carreras/Salones/Sedes**: el modal de EDICIÓN que ya existe
  (`EditarCarreraModal.tsx`/`EditarSalonModal.tsx`/`EditarSedeModal.tsx`) se
  convierte en el modal ÚNICO (alta + edición). Prop que decide el modo: si el
  registro pasado es `null`/`undefined` → modo alta (campos vacíos, todos
  requeridos, llama a `crearMutation`); si es un objeto real → modo edición
  (prellenado, campos opcionales salvo los que se toquen, llama a
  `actualizarMutation`, misma semántica "en blanco = sin cambio" que ya existe). El
  título interno del modal cambia según el modo ("Nueva carrera"/"Editar carrera").
  El modal solo se monta cuando está abierto (mismo patrón ya usado por los modales
  de confirmación de borrado) — así el estado interno del form se resetea solo al
  cerrarse/reabrirse, sin necesidad de limpieza manual.
- El formulario fijo de "Nuevo X" en cada página SE ELIMINA por completo — la
  página queda con: header + botón "+ Nuevo X" + tabla. El botón abre el modal en
  modo alta.
- Los componentes de campos compartidos (`CamposCarrera`/`CamposSalon`, hoy en cada
  `page.tsx`) se MUEVEN dentro del modal (o se eliminan si el modal ya tiene su
  propia copia de campos desde el retrofit anterior — verificar el estado real del
  archivo, no asumir). El `requerido` que un review anterior marcó como "vestigial"
  vuelve a tener 2 usos reales (alta=true, edición=false) — ya no hace falta
  tocarlo.
- **Grupos**: mismo patrón pero SOLO alta (modal nuevo, `NuevoGrupoModal.tsx` o
  similar) — no hay modo edición porque no existe `PATCH /grupos/:id`. El form fijo
  de "Nuevo grupo" se elimina, botón "+ Nuevo grupo" abre el modal. Los filtros y la
  tabla de abajo NO cambian.
- **Administrativos**: nuevo listado `app/admin/administrativos/page.tsx`, calcado
  de `app/admin/maestros/page.tsx` (mismo `BuscadorFiltro`/`Paginacion`/
  `useBuscarDebounced`/`usePaginacionFiltrada`, mismos componentes de
  `components/admin/ui/personas-listado/`). Botón "+ Nuevo" es un `<Link
  href="/admin/administrativos/nuevo">`, NO un modal (ver decisión de alcance
  arriba). Cada fila gana una acción "Cambiar estatus" que SÍ abre un modal chico
  (`CambiarEstatusAdministrativoModal.tsx`) — un `<select>` de `EstatusEmpleado` +
  Guardar/Cancelar, consistente con el tema de modal del día. `Sidebar.tsx` — el
  item "Administrativos" (hoy apunta directo a `/administrativos/nuevo`, ver
  comentario en ese archivo) pasa a apuntar a `/admin/administrativos` (el listado
  nuevo), mismo criterio que Alumnos/Maestros.

## Global Constraints

- `sedeId` NUNCA en body/query del cliente — regla 2.
- Todo catch/error handler loguea antes de responder — regla 12.
- Contrato de API: éxito `{ data: ... }` (+ `page`/`limit`/`total` en listas
  paginadas), error `{ error, code }`. Sin códigos nuevos salvo que sea
  estrictamente necesario (no debería serlo — todo reutiliza códigos fijos).
- `RegistroAuditoria` en la misma transacción de cada escritura (regla 5).
- Frontend: React Query para todo fetch, `app/admin/`/`app/plataforma/` sin
  compartir componentes entre sí ni con `app/alumno/`/`app/maestro/` (regla 11). No
  agregar dependencias nuevas.
- No tocar `app/admin/administrativos/nuevo/page.tsx` (el formulario de alta
  existente) — cero cambios ahí, ni siquiera cosméticos.
- Next.js 16 en este proyecto tiene breaking changes vs. training data — si algo de
  App Router no se comporta como se espera, revisar
  `App/frontend/node_modules/next/dist/docs/` antes de asumir bug propio.

## Task 1 — Frontend: unificar alta+edición en Carreras y Salones

**Archivos:**
- `App/frontend/src/app/admin/carreras/page.tsx` (editar)
- `App/frontend/src/app/admin/carreras/EditarCarreraModal.tsx` (editar → se
  convierte en el modal único, considera renombrarlo si el nombre ya no encaja,
  ej. `CarreraModal.tsx` — a discreción, actualiza el import en `page.tsx`)
- `App/frontend/src/app/admin/salones/page.tsx` (editar)
- `App/frontend/src/app/admin/salones/EditarSalonModal.tsx` (editar, mismo
  criterio de posible rename)

**Requisitos (ambas entidades, mismo patrón):**

1. Lee `page.tsx` y el modal existente de cada entidad COMPLETOS antes de tocar
   nada — son la fuente de verdad real del código post-retrofit anterior (que ya
   corrigió ids duplicados y scroll — no reintroduzcas esos bugs).
2. El modal acepta el registro como `Carrera | null` / `Salon | null` (en vez de
   requerido). `null` → modo alta: campos vacíos, todos `required`, botón dice
   "Crear carrera"/"Crear salón", llama a `onGuardar` con el payload completo tipo
   `CrearCarreraInput`/`SalonInput` (arma el payload igual que el
   `construirPayloadAlta` que hoy vive en `page.tsx` — muévelo al modal). Objeto
   real → modo edición: prellenado, campos opcionales (blanco = sin cambio, misma
   lógica que ya existe), botón dice "Guardar cambios".
3. `page.tsx` pierde el formulario fijo de "Nuevo X" y las funciones
   `handleSubmitNuevo`/`construirPayloadAlta` (se mudan al modal). Gana un botón
   "+ Nueva carrera"/"+ Nuevo salón" (mismo estilo `bg-navy` que los botones
   primarios existentes) que abre el modal con `carreraEditando`/`salonEditando`
   puesto a un valor "modo alta" — usa un state separado tipo `modalAbierto:
   boolean` + el registro (`null` = alta explícito, mejor que reusar el mismo
   state con semántica ambigua) O un solo state `{ abierto: boolean; registro: X |
   null }` — a discreción de implementación, mientras el comportamiento sea el
   descrito.
4. El `onGuardar` del modal en modo alta llama a `crearMutation.mutate(payload)`;
   en modo edición llama a `actualizarMutation.mutate({ id, input: payload })` —
   la página sigue siendo dueña de las 2 mutations (igual que hoy), el modal solo
   arma el payload y decide cuál invocar según su propio modo interno, O expone un
   único `onGuardar` y la página decide según si había un registro pasado — cualquiera
   de los 2 es válido.
5. `crearMutation.onSuccess`/`actualizarMutation.onSuccess` cierran el modal
   (en vez de limpiar un formulario fijo que ya no existe).
6. El modal de malla curricular de Carreras (`SubirMallaModal`, `carreraParaMalla`)
   y el flujo de eliminar de Salones (`salonAEliminar`,
   `ConfirmarEliminarSalonModal`) NO se tocan — siguen funcionando igual.
7. Reusa los fixes de ids/scroll ya aplicados (prefijo `editar-` en los ids, o
   ajústalos a un prefijo neutral tipo `carrera-modal-nombre` ya que el modal ahora
   sirve para ambos modos — mientras sigan sin colisionar con nada más en la
   página, que ya no tiene un form fijo con los mismos ids de todas formas).

**Verificación:** `tsc --noEmit` limpio + `npm run build` exitoso.

## Task 2 — Frontend: unificar alta+edición en Sedes

**Depende de nada, independiente de Task 1 — pero espera a que Task 1 cierre antes
de arrancar (criterio general del proyecto, un implementador a la vez).**

**Archivos:**
- `App/frontend/src/app/plataforma/sedes/page.tsx` (editar)
- `App/frontend/src/app/plataforma/sedes/EditarSedeModal.tsx` (editar, posible
  rename a `SedeModal.tsx`)

**Requisitos:** mismo patrón que Task 1, adaptado a `Sede` (4 campos: nombre,
telefono, direccion, ubicacionReferencia; `costoRenta` no se edita en el modal,
igual que hoy). Lee `page.tsx` y el modal completos primero. El form fijo de
"Nueva sede" desaparece, gana botón "+ Nueva sede".

**Verificación:** `tsc --noEmit` limpio + `npm run build` exitoso.

## Task 3 — Frontend: alta de Grupos vía botón + modal

**Independiente de Tasks 1/2 — espera a que Task 2 cierre antes de arrancar.**

**Archivos:**
- `App/frontend/src/app/admin/grupos/page.tsx` (editar)
- `App/frontend/src/app/admin/grupos/NuevoGrupoModal.tsx` (nuevo)

**Requisitos:**

1. Lee `page.tsx` completo primero — esta página YA tiene filtros + tabla +
   paginación funcionando (Día 29 + fix wave), NO los toques, solo el bloque del
   form de alta.
2. Nuevo modal, SOLO alta (sin modo edición — no existe `PATCH /grupos/:id`).
   Campos: `nombre`, `carreraId` (Select de `carrerasQuery`, ya cargada en la
   página, reutilízala), `salonId` (Select de `salonesQuery`, ya cargada,
   reutilízala), `anioInicio`, `cicloActual` (con el `max={carrera.duracion}` y
   passthrough de `VALIDATION_ERROR` ya implementados en el fix wave de Día 29 —
   MUEVE esa lógica al modal, no la pierdas), `capacidad`. Estados de error/vacío
   de los catálogos de carrera/salón (ya implementados) se mudan también al
   modal.
3. `page.tsx` pierde el form fijo de "Nuevo grupo", gana botón "+ Nuevo grupo".
   `crearMutation.onSuccess` cierra el modal.
4. Los filtros (`anioInicio`/`cicloActual`/`carreraId`/`salonId`) y la tabla
   paginada de abajo quedan exactamente igual — este task no los toca.

**Verificación:** `tsc --noEmit` limpio + `npm run build` exitoso.

## Task 4 — Backend: listado de Administrativos + cambio de estatus

**Independiente de Tasks 1-3 — puede correr en cualquier momento, pero espera a
que Task 3 cierre antes de arrancar (un implementador a la vez). Task 5 depende de
esta.**

**Archivos:**
- `App/backend/src/personas/dto/listar-personas.query.dto.ts` (editar)
- `App/backend/src/personas/personas.service.ts` (editar — `listarPorSedeYRol` +
  nuevo método `cambiarEstatus`)
- `App/backend/src/personas/personas.controller.ts` (editar — nuevo endpoint)
- `App/backend/src/personas/dto/cambiar-estatus.dto.ts` (nuevo)
- `App/backend/test/personas-listado.e2e-spec.ts` (o el archivo e2e real de
  listados — extender, confirma el nombre real del archivo primero)
- Nuevo archivo e2e para el endpoint de estatus si no encaja naturalmente en uno
  existente.

**Requisitos:**

1. `ListarPersonasQueryDto.rol` — agrega `RolUsuario.ADMINISTRATIVO` al array de
   `@IsIn([...])` (hoy solo `ALUMNO`/`MAESTRO`). Actualiza el comentario de
   cabecera del archivo — ya no es "solo ALUMNO/MAESTRO fuera de alcance para
   ADMINISTRATIVO", ese alcance se cierra hoy.
2. `PersonasService.listarPorSedeYRol` — agrega una tercera rama para
   `RolUsuario.ADMINISTRATIVO`, MISMO patrón exacto que la rama `MAESTRO` que ya
   existe justo arriba (cópiala de ahí): valida `estatus` contra `EstatusEmpleado`
   (mismo enum que maestro), `buscar` hace `contains` case-insensitive contra
   `nombres`/`apellidoPaterno`/`apellidoMaterno` (SIN un campo tipo
   `cedulaProfesional`/`matricula` — `PerfilAdministrativo` no tiene un
   identificador externo equivalente, no inventes uno). `select`: `usuarioId`,
   `nombres`, `apellidoPaterno`, `apellidoMaterno`, `puesto`, `nivelPermiso`,
   `estatus`, `usuario: { activo }`. `PersonaListItemAdministrativo` (interface
   nueva, mismo lugar que `PersonaListItemMaestro`): `{ usuarioId, nombres,
   apellidoPaterno, apellidoMaterno, puesto, nivelPermiso, estatus, activo }`.
   Orden: `apellidoPaterno asc, apellidoMaterno asc, nombres asc` (igual que las
   otras 2 ramas).
3. **`PATCH /personas/:id/estatus`** (nuevo endpoint — NO EXISTE hoy para NINGÚN
   rol, aunque la regla 3 de `CLAUDE.md` lo menciona como patrón — este es el
   primer código real). `CambiarEstatusDto`: `{ estatus: string }` requerido,
   `@IsNotEmpty()`. `sedeId` de `@SedeActual()`, `actorUsuarioId` de
   `@ActorUsuarioId()`. Mismos guards que el resto de `PersonasController`
   (`SedeGuard`+`RolesGuard`, `@Roles(ADMINISTRATIVO)`).
   `PersonasService.cambiarEstatus(id, estatus, sedeId, actorUsuarioId)`:
   - Busca el `Usuario` por `id` + `sedeId` (scoping, regla 2) con su `rol` y el
     perfil correspondiente incluido → `404 NOT_FOUND` si no existe/no pertenece
     a la sede.
   - Valida `estatus` contra el enum correcto según el `rol` encontrado
     (`EstatusAcademico` si `ALUMNO`, `EstatusEmpleado` si `MAESTRO`/
     `ADMINISTRATIVO`) → `400 VALIDATION_ERROR` si no matchea. (Esto deja el
     endpoint genérico para cualquier rol a futuro, aunque el frontend de HOY
     solo lo use para `ADMINISTRATIVO` — no le cierres la puerta a
     Alumno/Maestro innecesariamente ya que la validación por rol es gratis acá.)
   - **Jerarquía SOLO si el target es `ADMINISTRATIVO`** (mismo criterio de
     protección que `verificarJerarquiaNivelPermiso`, reutiliza esa tabla
     `JERARQUIA_NIVEL_PERMISO` privada o la lógica equivalente): un `AUXILIAR`
     actor no puede cambiar el estatus de NINGÚN administrativo; un actor no
     puede cambiar el estatus de un administrativo con `nivelPermiso` MAYOR al
     suyo propio → `403 NIVEL_PERMISO_INSUFICIENTE` (código ya existente, no
     inventes uno). Si el target es `ALUMNO`/`MAESTRO`, sin chequeo de jerarquía
     (no aplica, `nivelPermiso` es exclusivo de `PerfilAdministrativo`).
   - Transacción: actualiza el campo `estatus` del perfil correspondiente +
     `RegistroAuditoria` (`accion: EDICION`, mismo criterio de ambigüedad ya
     documentado para `PATCH /auth/cambiar-password` — no hay un valor de enum
     dedicado a "cambio de estatus", reutiliza `EDICION`, documenta la misma nota
     en el código).
   - `try/catch` con `console.error` (regla 12) antes de re-lanzar.
   - Retorna `200 { data: { ok: true } }`.
4. Tests e2e:
   - `GET /personas?rol=ADMINISTRATIVO`: listado exitoso + aislamiento cruzado +
     `buscar` + filtro `estatus` válido/inválido + paginación + 401/403 (mismo
     nivel de cobertura que las ramas `ALUMNO`/`MAESTRO` ya tienen — revisa esos
     tests existentes como plantilla).
   - `PATCH /personas/:id/estatus`: éxito cambiando estatus de un administrativo
     (verifica el `RegistroAuditoria` creado), bloqueo por jerarquía (actor
     `AUXILIAR` → 403; actor `ADMIN` sobre un `SUPER_ADMIN` → 403), `estatus`
     inválido → 400, `id` de otra sede → 404, sin token → 401, rol no autorizado
     → 403. Si el tiempo alcanza, un test adicional cambiando estatus de un
     `ALUMNO` (sin jerarquía, valida contra `EstatusAcademico`) para probar que
     el endpoint genérico funciona también ahí — no es obligatorio, el frontend
     de hoy no lo usa, pero es barato de cubrir ya que la lógica está ahí.

**Verificación:** suite e2e completa en verde, no solo los archivos nuevos/
tocados.

## Task 5 — Frontend: listado de Administrativos + cambio de estatus

**Depende de Task 4.** No arrancar hasta que Task 4 tenga review clean.

**Archivos:**
- `App/frontend/src/lib/api/personas.ts` (editar — agrega
  `PersonaListItemAdministrativo`/`listarAdministrativos`/`cambiarEstatusPersona`)
- `App/frontend/src/app/admin/administrativos/page.tsx` (nuevo — el listado)
- `App/frontend/src/app/admin/administrativos/CambiarEstatusModal.tsx` (nuevo)
- `App/frontend/src/components/admin/ui/shell/Sidebar.tsx` (editar — el item
  "Administrativos" apunta a `/admin/administrativos` en vez de
  `/admin/administrativos/nuevo`; actualiza también el comentario de cabecera del
  archivo que explica por qué apuntaba directo a `/nuevo` — ese motivo ya no
  aplica)

**Requisitos:**

1. Lee `App/frontend/src/app/admin/maestros/page.tsx` COMPLETO primero — es tu
   patrón de referencia EXACTO (mismo `BuscadorFiltro`/`Paginacion`/
   `useBuscarDebounced`/`usePaginacionFiltrada`, misma estructura de tabla). Lee
   también `App/backend/src/personas/personas.service.ts` (rama `ADMINISTRATIVO`
   de Task 4) para el shape exacto de `PersonaListItemAdministrativo`.
2. `lib/api/personas.ts`: `PersonaListItemAdministrativo { usuarioId, nombres,
   apellidoPaterno, apellidoMaterno, puesto, nivelPermiso, estatus, activo }`
   (mismo `EstatusEmpleado` que ya existe en este archivo, reutilízalo — no lo
   dupliques). `listarAdministrativos(params: ListarPersonasParams)` — mismo
   patrón que `listarMaestros`, fija `rol: 'ADMINISTRATIVO'`.
   `cambiarEstatusPersona(usuarioId: string, estatus: string): Promise<{ ok: true
   }>` → `PATCH /personas/:id/estatus`.
3. `app/admin/administrativos/page.tsx` — calcado de `maestros/page.tsx`: mismo
   `BuscadorFiltro` (placeholder `"Nombre o apellido…"` — sin mención de cédula,
   `Administrativo` no tiene ese campo), tabla con columnas Nombre completo,
   Puesto, Nivel de permiso, Estatus, Cuenta (`EstadoActivoBadge`, componente ya
   existente y reutilizable), Acciones (botón "Cambiar estatus" por fila). Botón
   "+ Nuevo" en el header es `<Link href="/admin/administrativos/nuevo">Dar de
   alta un administrativo</Link>` — mismo estilo que el botón equivalente de
   `maestros/page.tsx`, NO un modal.
4. `CambiarEstatusModal.tsx` — modal chico (mismo patrón visual que los modales
   de confirmación de borrado ya existentes: overlay `fixed inset-0 z-50 ...`,
   panel `rounded-lg bg-white p-6 shadow-lg max-w-md`). Props: `administrativo:
   PersonaListItemAdministrativo`, `guardando: boolean`, `onGuardar: (estatus:
   EstatusEmpleado) => void`, `onCancelar: () => void`. Un `<Select>` prellenado
   con el estatus actual + los 3 valores de `EstatusEmpleado` + botones Guardar/
   Cancelar.
5. `useMutation` de cambio de estatus en la página: `onSuccess` → toast + cierra
   el modal + invalida `queryKey: ['admin', 'personas', 'ADMINISTRATIVO', ...]`.
   `onError` → loguea (regla 12) + toast, mapea `NIVEL_PERMISO_INSUFICIENTE` a un
   mensaje claro ("No tienes permiso suficiente para cambiar el estatus de este
   administrativo").
6. `Sidebar.tsx` — cambia el `href` del item "Administrativos" de
   `/admin/administrativos/nuevo` a `/admin/administrativos`, y actualiza el
   comentario de cabecera de `NAV_PRINCIPAL` que documentaba por qué apuntaba a
   `/nuevo` (ese motivo — "Administrativos todavía no tiene listado propio" —
   deja de ser cierto con este task).

**Verificación:** `tsc --noEmit` limpio + `npm run build` exitoso.

## Fuera de alcance (a propósito)

- Edición de campos reales de Administrativo (nombres, correo, puesto,
  nivelPermiso vía edición) — decisión confirmada, regla 3 sigue vigente tal
  cual, solo estatus.
- Modal de alta para Administrativos — se queda como página completa,
  intencional (formulario compartido con Alumno/Maestro, no se fragmenta el
  patrón).
- `PATCH`/`DELETE /grupos/:id` — sigue fuera de alcance desde Día 28, este plan
  no lo agrega.
- Cambio de estatus para Alumno/Maestro desde su propio listado (aunque el
  backend de Task 4 lo soporta genéricamente) — sin UI para ellos hoy, nadie lo
  pidió, no inventar esa pantalla.
- Ningún cambio a `app/alumno/`/`app/maestro/`.
