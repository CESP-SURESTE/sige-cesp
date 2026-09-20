# Edición de datos de persona (alumno/maestro/administrativo) — design

**Fecha:** 2026-09-20
**Motivación:** hoy (regla 3 de `CLAUDE.md` raíz) no existe ninguna forma de corregir
un dato mal capturado en el alta de una persona — solo se puede cambiar estatus, foto
y disparar un reseteo de password. Un typo real en nombres/apellidos/CURP/teléfono
queda fijo para siempre salvo que alguien edite la base de datos directo. Se agregó un
aviso visual ("verifica antes de guardar") como mitigación mínima mientras se diseñaba
esto — ver `AltaPersonaFormShell.tsx`.

## Alcance

**Editable = todo el perfil de la persona, salvo lo que ya tiene su propio flujo
dedicado.** Regla simple, sin enumerar campo por campo cada vez que se agregue uno
nuevo al perfil.

**Queda FUERA (tiene su propio flujo, no se toca desde este modal):**
- `estatus` / `tipoLicencia` / `motivoBaja` → `PATCH /personas/:id/estatus`.
- Foto de perfil → `POST/DELETE /personas/:id/foto`.
- Password → `POST /personas/:id/resetear-password`.
- `matricula` (alumno) y `Usuario.email` (login, los 3 roles) — inmutables por diseño
  desde que se generan en el alta (rastro de identificador ya comunicado a la persona;
  cambiar el nombre NO regenera ninguno de los dos).
- `rol` — no se puede convertir un alumno en maestro, etc.

**SÍ entra (todo lo demás del perfil, incluyendo lo capturado en el alta):**

| Rol | Campos |
|---|---|
| Común (raíz) | `codigoExterno` |
| ALUMNO | `nombres`, `apellidoPaterno`, `apellidoMaterno`, `curp`, `fechaNacimiento`, `correoPersonal`, `carreraId`, `periodoIngreso`, `cuatrimestreActual`, `telefono` |
| MAESTRO | `nombres`, `apellidoPaterno`, `apellidoMaterno`, `curp`, `cedulaProfesional`, `correoPersonal`, `telefono`, `fechaContratacion`, `tipoContratacion` (+ `diasTemporal`/`contratoFechaInicio`/`contratoFechaFin` condicionales) |
| ADMINISTRATIVO | `nombres`, `apellidoPaterno`, `apellidoMaterno`, `curp`, `correoPersonal`, `telefono`, `fechaContratacion`, `puesto`, `nivelPermiso` (ver nota de jerarquía abajo) |
| Los 3 | `contactos[]` (reemplazo completo del array), `infoMedica` (upsert de los mismos campos que en el alta, incluyendo `tipoSangre`) |

**Nota — `nivelPermiso` del administrativo SÍ entra en este modal** (no tiene otro
endpoint dedicado hoy), pero es el campo más sensible de la lista — es literalmente un
cambio de privilegios. Se audita distinto del resto (ver "Auditoría" abajo) y aplica la
MISMA jerarquía que ya usa `POST /personas` (regla 7): el actor no puede asignar un
`nivelPermiso` mayor al propio.

## Contrato de API

### `GET /personas/:id` (nuevo)

Precarga del modal de edición — hoy no existe ningún `GET /personas/:id` (regla
documentada como "diferido" porque los listados ya traían todo lo necesario; ya no
aplica, este modal necesita `contactos`/`infoMedica` que el listado no trae).

- Guards: `SedeGuard` + `RolesGuard`, `@Roles(ADMINISTRATIVO)` — igual que el resto de
  `PersonasController`. `sedeId` siempre de `@SedeActual()`.
- `:id` (un `Usuario.id`) de otra sede o inexistente → `404 NOT_FOUND`.
- **Sin auditoría** (decisión explícita — es un `ADMINISTRATIVO` de la sede abriendo el
  modal de edición de alguien de su propia sede; auditar cada apertura sería ruido, no
  una señal real de acceso indebido, a diferencia de `GET /emergencia/expediente/...`
  que es un flujo de emergencia con su propio criterio de "quién vio qué y cuándo").
- Éxito: `200 { data: { rol, codigoExterno, ...campos del perfil según rol (ver tabla
  de arriba), contactos: ContactoItem[], infoMedica: InfoMedicaItem } }` — mismo shape
  de `contactos`/`infoMedica` que ya usan `GET /perfil` y el expediente de emergencia
  (sin `orden`/`id` innecesarios para el cliente, el `id` de cada contacto SÍ viaja
  porque el frontend lo necesita para las `key` de React, no para lógica de negocio).

### `PATCH /personas/:id` (nuevo)

Guarda los cambios del modal — mismo patrón genérico que `PATCH /personas/:id/estatus`:
un solo endpoint, valida contra el `rol` real de la persona encontrada (no 3 rutas
separadas).

- Guards: igual que el resto de `PersonasController`.
- Body: `{ codigoExterno?, perfilAlumno? | perfilMaestro? | perfilAdministrativo?,
  contactos, infoMedica }` — incluir el sub-objeto de perfil que NO corresponde al rol
  real de la persona es ignorado (mismo criterio que `POST /personas`), el que sí
  corresponde valida todos sus campos como en el alta (reusa las mismas reglas de
  `PerfilAlumnoDto`/`PerfilMaestroDto`/`PerfilAdministrativoDto` vía un DTO de edición
  espejo — ver "Validación" abajo). El modal siempre manda el objeto completo (no hay
  "partial update" real desde la UI: el form se precarga con `GET /personas/:id` y el
  usuario edita sobre eso), así que el DTO valida con las mismas reglas de
  requerido/opcional que el alta, no todo opcional.
- `:id` de otra sede o inexistente → `404 NOT_FOUND`.
- Jerarquía de `nivelPermiso` (regla 7, igual que alta/estatus): aplica SOLO si el
  `rol` real de la persona es `ADMINISTRATIVO` — un `AUXILIAR` no puede editar a ningún
  `ADMINISTRATIVO` (ni siquiera campos no-sensibles), y nadie puede asignar un
  `nivelPermiso` mayor al propio → `403 NIVEL_PERMISO_INSUFICIENTE` (código ya
  existente).
- Validación cruzada reusada de `PersonasService.altaPersona` (extraída a helpers
  compartidos donde tenga sentido, sin duplicar lógica):
  - `carreraId` (alumno) debe existir y pertenecer a la sede → `404 NOT_FOUND` si no.
  - `cuatrimestreActual` (alumno) entre 1 y `carrera.duracion` (la NUEVA carrera si
    `carreraId` cambió) → `400 VALIDATION_ERROR`.
  - `tipoContratacion` (maestro): mismas reglas condicionales que el alta
    (`diasTemporal` requerido si `TEMPORAL`, `contratoFechaInicio`/`Fin` requeridos y
    `fin > inicio` si `CONTRATO`) → `400 VALIDATION_ERROR`. Si el nuevo
    `tipoContratacion` ya no es `TEMPORAL`/`CONTRATO`, el service limpia
    explícitamente a `null` los campos condicionales que ya no aplican (a diferencia
    del alta, donde simplemente nunca se llenaron — acá si pueden quedar datos viejos
    de un `tipoContratacion` anterior si no se limpian activamente).
  - `contactos`: 1 a 3 elementos → `400 VALIDATION_ERROR` si no.
  - `infoMedica.tipoSangre`: requerido y válido → `400 VALIDATION_ERROR` si no.
- Transacción única (mismo criterio que el alta): `update` de los campos del perfil +
  `deleteMany` de los contactos viejos + `createMany` de los nuevos (reemplazo
  completo, sin diff/merge — más simple, consistente con que el modal siempre manda el
  array completo) + `upsert` de `infoMedica`.
- Auditoría: `EDICION` (entidad `Usuario`, `entidadId` = `usuarioId`, `detalle` con los
  nombres de los campos que cambiaron) si cambió cualquier cosa que NO sea
  `nivelPermiso`. **Si `nivelPermiso` cambió, un registro ADICIONAL con `accion:
  CAMBIO_PERMISO`** (valor del enum que existe desde hace tiempo pero nunca se había
  usado — ver `AccionAuditoria` en `CLAUDE.md`), `detalle: { nivelPermisoAnterior,
  nivelPermisoNuevo }`. No se intenta detectar "sin cambios reales" para evitar auditar
  (a diferencia de `PATCH /carreras`/`PATCH /salones`) — con contactos+infoMedica en el
  mismo submit ese diff cuesta más de lo que vale; se audita siempre que el `PATCH`
  responde éxito.
- Éxito: `200 { data: { ok: true } }` (mismo shape que el resto de mutaciones de
  `PersonasController`).

## Frontend

### Listados (`app/admin/{alumnos,maestros,administrativos}/page.tsx`)

Ícono de lápiz como primera columna de cada fila (a la izquierda, antes del nombre) —
`onClick` abre el modal de edición de esa fila, precargado vía `GET /personas/:id`.
Mismo criterio de UX que el resto de acciones por fila ya existentes (botón de
"Restablecer contraseña" reciente, subir/quitar foto).

### Modal de edición (uno por rol — `EditarAlumnoModal.tsx`, `EditarMaestroModal.tsx`,
`EditarAdministrativoModal.tsx`, en `app/admin/{alumnos,maestros,administrativos}/`)

Reusa DIRECTO los fieldsets ya construidos para el alta en
`components/admin/ui/persona-alta/` (`DatosPersonalesFieldset`, `ContactosFieldset`,
`InfoMedicaFieldset`) más un fieldset de campos académicos/laborales específico del rol
(mismo contenido que ya vive inline en cada página `nuevo/page.tsx` hoy, extraído a un
componente propio si hace falta reusarlo — a evaluar en el plan de implementación, no
es una decisión de diseño). Mismo esquema de validación zod que el formulario de alta
del rol correspondiente (sin relajar a `.partial()` — el modal siempre precarga el
objeto completo).

Patrón de modal: igual al ya establecido por regla 13 (Cancelar/Cerrar limpia el
estado, loading state en el botón de guardar, `toast.error` en fallo vía
`resolverMensajeError`).

**`nivelPermiso` (solo el modal de Administrativo):** el `<select>` de nivel se
deshabilita (o se oculta directamente) si el actor no tiene nivel suficiente para
asignar ninguno de los valores posibles — mismo criterio de UX ya usado para ocultar
"Cambiar estatus" a un actor sin permiso (evita un `403` inevitable en vez de dejar
que el usuario lo intente y falle).

## Fuera de alcance (a propósito, YAGNI)

- Historial de cambios / diff visual de qué se editó — el `RegistroAuditoria.detalle`
  ya guarda los nombres de campos que cambiaron, pero no hay UI para verlo (podría
  vivir en `app/plataforma/auditoria/` a futuro, sin pedido explícito hoy).
- Fricción extra (doble confirmación) para editar nombres/CURP específicamente — se
  decidió tratarlos igual que el resto del perfil.
- Reflejar el cambio de `carreraId`/`cuatrimestreActual` en grupos/materias en los que
  el alumno ya está inscrito — un cambio de carrera no reordena ni desmatricula nada
  automáticamente (mismo tipo de inconsistencia conocida y aceptada que ya existe con
  `PATCH /carreras` bajando `duracion`).
- Endpoint separado para cambiar SOLO `nivelPermiso` — vive dentro de este mismo modal.
