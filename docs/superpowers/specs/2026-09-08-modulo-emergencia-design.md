# Módulo de emergencia — botón de pánico + buscador de expedientes

Fecha: 2026-09-08
Estado: diseño aprobado, pendiente de plan de implementación.

## Problema

En una emergencia física en una sede (un alumno se desmaya, un accidente en el
taller), el personal de recepción/dirección necesita dos cosas de inmediato:

1. Los teléfonos de emergencia **locales de esa sede** (Cruz Roja municipal,
   bomberos, protección civil del municipio, hospital de convenio) — no solo el
   911 nacional.
2. Los datos críticos de la persona afectada: **tipo de sangre, alergias,
   padecimientos, medicamentos** y a quién llamar (**contactos de emergencia**).

Hoy nada de esto está resuelto:

- `Sede` solo tiene un campo `telefono` suelto (el de la propia sede, no números
  de servicios de emergencia).
- La info médica (`InfoMedica*`) y los contactos (`Contacto*`) existen para los 4
  roles, pero **no se exponen a nadie más que a la propia persona** — decisión
  explícita registrada en `CLAUDE.md` ("más sensible — padecimientos/
  medicamentos/alergias —, sin pedido explícito de mostrarla en el perfil").
- El buscador actual (`GET /personas?rol=...`) exige elegir un rol primero y
  nunca devuelve datos médicos ni contactos.

## Alcance y decisiones tomadas

| Decisión | Valor |
|---|---|
| Quién lo usa | Personal `ADMINISTRATIVO` de la sede, desde `app/admin/` |
| Escenario | Recepción/dirección de la sede durante una emergencia |
| Botón de pánico | **Pasivo** — solo muestra los teléfonos de la sede. Sin registro de incidente, sin alerta a nadie |
| Cobertura del buscador | Los **4 roles**: `ALUMNO`, `MAESTRO`, `ADMINISTRATIVO`, `PERSONAL_SERVICIOS` |
| Aislamiento | Por sede — respeta la separación existente (`@SedeActual()` del JWT). No es cross-sede |
| Acceso al buscador | Cualquier `ADMINISTRATIVO` de la sede, sin importar `nivelPermiso` — igual que los listados actuales |
| Auditoría | **Sí** — abrir el expediente de emergencia de una persona escribe un `RegistroAuditoria` |
| Quién edita los teléfonos | Administrativos de la sede (mismo patrón operativo que Carreras/Salones). No AdminPlataforma |

### Fuera de alcance (YAGNI)

- Registro de incidentes / historial de activaciones del botón de pánico.
- Notificación in-app a responsables de sede al activar el botón.
- Reordenar los teléfonos vía UI (el `orden` se asigna server-side al crear).
- Uso por maestros, alumnos, o una pantalla/kiosco compartido sin login.
- Herramienta cross-sede para AdminPlataforma.
- Edición de los teléfonos desde `/plataforma`.
- Validación de formato del campo `telefono`.
- Permiso dedicado en `PermisoAdministrativo`.

## Arquitectura

Módulo nuevo y aislado `EmergenciaModule` (`src/emergencia/`), importado en
`AppModule`. **No toca `personas.service.ts`** (ya ~1400 líneas, el propio código
lo señala) — la búsqueda cross-rol, la exposición médica y la auditoría-al-leer
viven en su propio service acotado.

```
src/emergencia/
  emergencia.module.ts
  emergencia.controller.ts
  emergencia.service.ts
  dto/
    crear-telefono.dto.ts
    actualizar-telefono.dto.ts
    buscar-emergencia.dto.ts        // q, limit
```

Frontend: todo bajo `app/admin/` + `components/admin/` (regla 11, sin
componentes compartidos entre árboles).

## Modelo de datos

### Tabla nueva: `TelefonoEmergenciaSede`

```prisma
model TelefonoEmergenciaSede {
  id        String   @id @default(uuid())
  sedeId    String   @map("sede_id")
  sede      Sede     @relation(fields: [sedeId], references: [id], onDelete: Cascade)
  etiqueta  String
  telefono  String
  orden     Int
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("telefonos_emergencia_sede")
}
```

- `etiqueta`: nombre legible del servicio ("Cruz Roja Tizimín", "Bomberos",
  "Protección Civil Municipal", "Hospital General de Valladolid").
- `telefono`: texto libre. Admite `911`, extensiones, números fijos con espacios.
  Sin validación de formato — se guarda y se usa tal cual en el enlace `tel:`.
- `orden`: posición en la lista, `1..N`. **El cliente nunca lo manda** (regla 1,
  mismo criterio que `Contacto*.orden`). Se asigna server-side como
  `max(orden de la sede) + 1` al crear. Editar no lo cambia; borrar deja huecos
  (el orden sigue siendo `orden asc`, los huecos no importan).
- `Sede` gana `telefonosEmergencia TelefonoEmergenciaSede[]`.
- RLS: policy `sede_isolation_telefonos_emergencia_sede` directa por `sede_id`,
  calcada de `sede_isolation_avisos`.

### Enum `AccionAuditoria` — valor nuevo `CONSULTA_EMERGENCIA`

```prisma
enum AccionAuditoria {
  ALTA
  BAJA
  EDICION
  CAMBIO_PERMISO
  CAMBIO_ESTATUS
  ELIMINACION
  CONSULTA_EMERGENCIA   // nuevo
}
```

- Migración: `ALTER TYPE "AccionAuditoria" ADD VALUE 'CONSULTA_EMERGENCIA';`
- Precedente: `CAMBIO_ESTATUS` se agregó igual cuando `PATCH /personas/:id/estatus`
  lo necesitó, en vez de reusar `EDICION`.
- Es el **primer `accion` de lectura** del sistema — hoy los 6 son mutaciones.
  Se asume como excepción justificada: consultar un expediente médico de un
  tercero es una acción sensible que el cliente (CESP) querrá poder rastrear.
  Regla 5 ("`RegistroAuditoria` se crea automáticamente en cada acción sensible")
  lo cubre; lo inusual es que el disparador sea un `GET`.

### Migraciones

**Dos archivos de migración separados**, en este orden:

1. `..._accion_auditoria_consulta_emergencia`:
   `ALTER TYPE "AccionAuditoria" ADD VALUE 'CONSULTA_EMERGENCIA';` — solo.
2. `..._telefonos_emergencia_sede`: `CREATE TABLE telefonos_emergencia_sede` +
   índice `(sede_id)` + `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + policy
   `sede_isolation_telefonos_emergencia_sede`.

Se separan a propósito: Postgres no permite usar un valor de enum recién
agregado en la misma transacción en que se agregó, y `ADD VALUE` no admite
`IF NOT EXISTS` en todas las versiones — dejarlo aislado evita que un rollback
parcial deje el enum a medias.

Nota de infra (ya conocida): `prisma migrate dev` está roto en el repo (`P3006`,
choque Prisma+Supabase con la shadow DB). Generar con `prisma migrate diff` +
`prisma migrate deploy`, revisando el SQL a mano (que un cambio no salga como
DROP+ADD). Ambas migraciones se suman al backlog de migraciones pendientes de
aplicar en prod.

## Backend — endpoints

Todos bajo `SedeGuard` + `RolesGuard` + `@Roles(ADMINISTRATIVO)` a nivel de
clase. `sedeId` **siempre** de `@SedeActual()` (JWT), nunca de body/query/path
(regla 2). Contrato estándar de la API (`{ data }` / `{ error, code }`).

### `GET /emergencia/telefonos`

Lista los teléfonos de la sede del actor, `orden asc`. Sin paginar (catálogo
chico). Éxito: `200 { data: TelefonoEmergenciaSede[] }`.

### `POST /emergencia/telefonos`

Body: `{ etiqueta: string, telefono: string }` — ambos requeridos y no vacíos
(`@IsNotEmpty`), si no `400 VALIDATION_ERROR`. `orden` = `max+1` de la sede
(contar dentro de la misma transacción). Audita `ALTA`
(`entidad: 'TelefonoEmergenciaSede'`, `entidadId` = id nuevo,
`detalle: { etiqueta, telefono }`) en la misma transacción. Éxito:
`201 { data: TelefonoEmergenciaSede }`.

### `PATCH /emergencia/telefonos/:id`

Body: `{ etiqueta?: string, telefono?: string }` — ambos opcionales, `{}` es
válido; si un campo viene, no puede ser vacío (`400`). `:id` inexistente o de
otra sede → `404 NOT_FOUND`. Solo audita `EDICION` si hay cambio real
(`hayCambiosReales`, mismo patrón que `CarrerasService`). Éxito:
`200 { data: TelefonoEmergenciaSede }`.

### `DELETE /emergencia/telefonos/:id`

Borrado real — es configuración, no una persona (regla 3 no aplica). `:id`
inexistente o de otra sede → `404`. Audita `ELIMINACION` antes del delete, en la
misma transacción. Éxito: `200 { data: { ok: true } }`.

### `GET /emergencia/buscar?q=&limit=`

- `q`: requerido, se hace `trim`, mínimo 2 caracteres tras el trim → si no,
  `400 VALIDATION_ERROR` (evita volcar toda la sede).
- `limit`: opcional, default 20, máx 50, entero ≥ 1 → fuera de rango `400`.
- Ejecuta **4 queries en paralelo** (`Promise.all`), una por rol, cada una
  filtrada por la sede del actor:
  - `ALUMNO`: `perfilAlumno` join `usuario.sedeId == sedeActual`, `contains`
    insensible sobre `nombres` / `apellidoPaterno` / `apellidoMaterno` /
    `matricula`.
  - `MAESTRO`: idem, `contains` sobre nombres/apellidos / `cedulaProfesional`.
  - `ADMINISTRATIVO`: idem, `contains` sobre nombres/apellidos (no tiene campo
    externo).
  - `PERSONAL_SERVICIOS`: `personalServicios.sedeId == sedeActual`, `contains`
    sobre nombres/apellidos.
- Merge de los 4 arrays, orden global por `apellidoPaterno asc, apellidoMaterno
  asc, nombres asc`, corte a `limit` **total** (no `limit` por rol).
- Sin paginar — es un lookup rápido; si hay demasiados resultados, el usuario
  afina `q`.
- Éxito: `200 { data: ResultadoBusqueda[] }` con
  `ResultadoBusqueda = { tipo: 'ALUMNO' | 'MAESTRO' | 'ADMINISTRATIVO' | 'PERSONAL_SERVICIOS', perfilId, nombreCompleto, referencia, activo }`
  - `perfilId`: el id del `PerfilX` (o `PersonalServicios`), es lo que consume el
    endpoint de expediente.
  - `referencia`: string disambiguador según rol — matrícula (alumno) / cédula
    profesional o `'Sin cédula'` (maestro) / `puesto` (administrativo) / `area`
    (personal de servicios).
  - `activo`: `Usuario.activo` para los 3 roles con cuenta; para
    `PERSONAL_SERVICIOS`, `estatus === 'ACTIVO'`. Recepción ve si la persona
    sigue vigente.

### `GET /emergencia/expediente/:tipo/:perfilId`

- `:tipo` ∈ `{ ALUMNO, MAESTRO, ADMINISTRATIVO, PERSONAL_SERVICIOS }` — cualquier
  otro valor → `400 VALIDATION_ERROR`.
- `:perfilId` resuelve al `PerfilX` / `PersonalServicios` correspondiente. **Debe
  pertenecer a la sede del actor** (para los 3 roles con cuenta, vía
  `usuario.sedeId`; para personal de servicios, `PersonalServicios.sedeId`), si
  no → `404 NOT_FOUND` (nunca `403` — no revelar que existe en otra sede, mismo
  criterio que el resto de la API).
- **Escribe `RegistroAuditoria`**: `accion: CONSULTA_EMERGENCIA`,
  `usuarioId` = actor (`@ActorUsuarioId()`), `sedeId` = `@SedeActual()`,
  `entidad: 'ExpedienteEmergencia'`, `entidadId` = `perfilId`,
  `detalle: { tipo, nombreCompleto }`. No es transacción con nada más (es la
  única escritura). Si el insert falla → `console.error` completo (regla 12) y
  **igual se devuelve el expediente** (una emergencia no se bloquea por un fallo
  de bitácora; mismo criterio "best-effort después de lo importante" que
  Mailgun en `altaPersona`).
- Éxito: `200 { data: ExpedienteEmergencia }`:

```ts
{
  tipo: 'ALUMNO' | 'MAESTRO' | 'ADMINISTRATIVO' | 'PERSONAL_SERVICIOS',
  perfilId: string,
  identidad: {
    nombres: string,
    apellidoPaterno: string,
    apellidoMaterno: string | null,
    curp: string | null,          // nullable solo en alumno
    telefono: string | null,      // nullable solo en alumno
    correoPersonal: string | null,
    referencia: string,           // matrícula / cédula / puesto / área
    fechaNacimiento: string | null, // ISO, solo ALUMNO
    edad: number | null,            // calculado al vuelo, solo ALUMNO (regla 1)
    activo: boolean,
  },
  infoMedica: {
    tieneCondicionMedica: boolean,
    tipoSangre: string | null,      // enum TipoSangre, ej. "O_POSITIVO"
    padecimiento: string | null,
    medicamentos: string | null,
    alergias: string | null,
    tratamientoAdicional: string | null,
  } | null,                          // null si la persona no tiene fila InfoMedica*
  contactos: Array<{
    nombre: string,
    telefono: string,
    correo: string | null,
    parentesco: string,
    tipo: 'TUTOR' | 'EMERGENCIA' | null,  // solo ALUMNO; null para los otros 3
    orden: number,
  }>,                                 // [] si no hay contactos; orden asc
}
```

### Códigos de error

Sin códigos de dominio nuevos. Reusa `VALIDATION_ERROR` (400) y `NOT_FOUND`
(404). `UNAUTHORIZED` / `ROL_NO_AUTORIZADO` los aportan los guards igual que en
cualquier ruta.

## Frontend

Todo en `app/admin/` + `components/admin/` (regla 11).

### Botón de pánico

- Botón fijo en el **topbar** del `AdminShell` (`components/admin/ui/shell/`),
  rojo, visible en cualquier pantalla de admin.
- Click → `<PanicoModal>` (`components/admin/ui/emergencia/`): hace
  `GET /emergencia/telefonos`, lista cada `etiqueta` + `telefono` en tipografía
  grande, cada `telefono` como enlace `tel:` (tap-para-llamar en móvil).
- Lista vacía → mensaje "No hay teléfonos de emergencia configurados. Agrégalos
  en la sección Emergencia." con link a la página.
- Botón de cerrar; sin efectos secundarios.

### Página `app/admin/emergencia/page.tsx`

Link nuevo "Emergencia" en el `Sidebar` (`components/admin/ui/shell/`).

**Zona 1 — Buscador de expedientes**

- Caja de texto con debounce (~300 ms) → `GET /emergencia/buscar`.
- `q` < 2 chars: no dispara la request, hint "Escribe al menos 2 letras".
- Resultados en lista: cada fila con chip de rol, `nombreCompleto`, `referencia`
  y badge "Inactivo" cuando `activo === false`. Estados de vacío / error / carga.
- Click en un resultado → `GET /emergencia/expediente/:tipo/:perfilId` → abre el
  **panel de expediente** (a un lado o debajo):
  - Bloque de identidad (nombre, referencia, edad si es alumno, teléfono propio).
  - Bloque **prominente de tipo de sangre** (grande, alto contraste).
  - Condición médica / padecimiento / medicamentos / alergias / tratamiento
    adicional. Si `infoMedica === null` → "Sin expediente médico registrado".
  - Contactos de emergencia: nombre, parentesco, `tipo` (si es alumno), teléfono
    como enlace `tel:`. Si `contactos` está vacío → "Sin contactos de emergencia
    registrados".

**Zona 2 — Teléfonos de emergencia de la sede**

- Tabla (`etiqueta`, `telefono`) + botón "+ Nuevo teléfono" que abre un modal
  de alta/edición (el mismo componente para ambos, prellenado en edición) +
  acción "Eliminar" con modal de confirmación.
- Modelado sobre `app/admin/carreras/` (patrón ya construido: tabla + modal
  único). **Nota:** la memoria del proyecto indica que la "regla 13 / modal
  único alta+edición" quedó pausada por el usuario; este diseño sigue el patrón
  ya implementado en `carreras/`/`salones/`. Si el usuario prefiere otro layout
  para esta sección, ajustar antes de implementar.

### `lib/api/emergencia.ts`

Hooks de React Query para los 5 endpoints:
`useTelefonosEmergencia`, `useCrearTelefono`, `useActualizarTelefono`,
`useEliminarTelefono`, `useBuscarEmergencia` (habilitado solo con `q.length >= 2`),
`useExpedienteEmergencia`.

## Edge cases

| Caso | Comportamiento |
|---|---|
| `q` < 2 chars tras trim | `400 VALIDATION_ERROR`; el frontend ni dispara la request |
| Expediente de persona de otra sede | `404 NOT_FOUND` (nunca `403`) |
| Persona sin fila `InfoMedica*` (altas viejas) | `infoMedica: null` → UI "Sin expediente médico registrado" |
| Persona con 0 contactos | `contactos: []` → UI "Sin contactos de emergencia registrados" |
| Falla el insert de auditoría en `expediente` | `console.error` completo (regla 12); se devuelve el expediente igual |
| `:tipo` no es uno de los 4 | `400 VALIDATION_ERROR` |
| `PATCH` / `DELETE` teléfono `:id` inexistente o de otra sede | `404 NOT_FOUND` |
| Lista de teléfonos vacía | `PanicoModal` muestra el hint con link a Emergencia |
| `telefono` con formato raro (extensión, espacios, `911`) | se guarda y se usa tal cual en `tel:` — sin validación |
| `PERSONAL_SERVICIOS` en resultados | `activo` = `estatus === 'ACTIVO'`; no tiene `Usuario` |

## Pruebas

### e2e — `test/emergencia.e2e-spec.ts`

- **Teléfonos**: alta asigna `orden` incremental; edición; borrado real;
  aislamiento cross-sede (`GET`/`PATCH`/`DELETE` de otra sede → 404); `etiqueta`
  o `telefono` vacío → 400.
- **Buscar**: encuentra por nombre/apellido en los 4 roles; encuentra alumno por
  matrícula y maestro por cédula; NO devuelve gente de otra sede; `q` de 1 char
  → 400; respeta `limit`; orden por apellidos.
- **Expediente**: los 4 `tipo`; `infoMedica: null` cuando la persona no tiene
  fila; contactos en `orden asc`; alumno trae `edad` y `fechaNacimiento`, los
  otros no; cross-sede → 404; `tipo` inválido → 400; **verifica que se creó un
  `RegistroAuditoria` con `accion: 'CONSULTA_EMERGENCIA'`, el `usuarioId` del
  actor y `entidadId` = `perfilId`**.
- `afterAll` limpia de verdad, acotado a los ids que la corrida creó — nunca por
  patrón de nombre/email (regla 14; ese tipo de limpieza amplia ya causó un bug
  en el Día 24).

### unit

- Lógica pura de merge / orden / corte de `buscar`, si se extrae a una función
  aislada.
- `hayCambiosReales` del `PATCH` de teléfonos.

### frontend

- `pnpm build` + `pnpm lint` limpios.
- Verificación manual en navegador por el usuario (patrón del proyecto): activar
  el botón de pánico, buscar personas de los 4 roles, abrir un expediente con y
  sin info médica, y confirmar que un administrativo de otra sede no ve nada.

## Contrato de API — texto para `CLAUDE.md` al cerrar

Agregar bajo "Contrato de API":

- `GET/POST/PATCH/DELETE /emergencia/telefonos*` — CRUD de teléfonos de
  emergencia por sede. `SedeGuard` + `RolesGuard(ADMINISTRATIVO)`, `sedeId` de
  `@SedeActual()`. Sin jerarquía de `nivelPermiso`. `orden` server-side
  (`max+1`). `DELETE` real. Audita `ALTA`/`EDICION`/`ELIMINACION`.
- `GET /emergencia/buscar?q=&limit=` — búsqueda cross-rol dentro de la sede
  (`q` ≥ 2, `limit` ≤ 50). `200 { data: ResultadoBusqueda[] }`, sin paginar.
- `GET /emergencia/expediente/:tipo/:perfilId` — expediente de emergencia
  (identidad + info médica + contactos) de una persona de la sede. Escribe
  `RegistroAuditoria` `CONSULTA_EMERGENCIA` (best-effort). Cross-sede → 404.
- `AccionAuditoria` gana `CONSULTA_EMERGENCIA` — primer `accion` de lectura;
  disparada por el `GET` de expediente de emergencia.
