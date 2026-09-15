# Diseño — Pulido de Calendario + Eventos en el dashboard de admin

**Fecha:** 2026-09-02
**Contexto:** post-verificación manual de Fase 15 (Calendario). El usuario
probó la app y reportó 4 puntos. Este spec los resuelve en una sola tanda,
antes de la Fase 16 (Avisos).

Base: Fase 15 cerrada en código (commits `bfe59fb`..`c9aab20` en `dev`, sin
push). Spec de Fase 15:
`docs/superpowers/specs/2026-08-31-calendario-avisos-notificaciones-design.md`.

---

## Global Constraints

- **Rama:** se trabaja directo sobre `dev` (convención del proyecto, no es
  `main`). Working tree limpio al empezar (los 21 commits locales previos ya
  están commiteados).
- **Contrato de API** (CLAUDE.md): JSON camelCase, fechas ISO 8601
  (`YYYY-MM-DD`), éxito `{ data: ... }` (+ `page`/`limit`/`total` en listas
  paginadas), error `{ error, code }`. Códigos fijos existentes; NO se
  inventan códigos nuevos en este spec.
- **Regla 1** (nunca persistir lo calculable): `recurrenciaResumen`,
  `alcanceNombre`, `autorNombre` del item 4 se derivan al vuelo por request.
- **Regla 2** (doble capa RLS + Guard): el guard extrae `sede_id` del JWT,
  nunca de body/query/path. El endpoint nuevo del item 4 lo respeta.
- **Regla 11** (separación total admin/alumno en frontend): sin componentes
  compartidos entre árboles. `lib/api/*` sí es infra compartida legítima.
  Los 2 `EventoModal.tsx` (admin y maestro) son archivos independientes —
  los items 1 y 2 se aplican a cada uno por separado, sin extraer un
  componente común.
- **Regla 12** (todo catch loguea completo antes de responder): aplica al
  hook best-effort de notificación del item 3a y a cualquier catch nuevo.
- **`prisma migrate dev` está roto** en este repo (`P3006` shadow-DB). La
  migración del item 3a se genera con `prisma migrate diff` +
  `prisma migrate deploy` (mismo camino que la migración
  `grupo_materia_maestro`).
- **Sin dependencias nuevas.**
- **Tests:** cada cambio deja la suite e2e del backend en verde (hoy 25
  suites / 344 tests) y `tsc`/`eslint`/`pnpm build` limpios en backend y en
  los árboles de frontend tocados. Archivos en LF.
- **Regla 14:** máximo 3 escrituras manuales a la DB real al verificar algo
  antes de un veredicto.

---

## Item 1 — Mensaje de error claro al guardar un evento

### Problema

Al crear un evento con `fechaFin` anterior a `fechaInicio` (ej. inicia el 3,
termina el 1 del mismo mes), el backend lo rechaza con `400 VALIDATION_ERROR`
y mensaje `"fechaFin no puede ser anterior a fechaInicio"`. El frontend YA
surfacea ese mensaje en el toast (admin y maestro `page.tsx`, rama
`err.code === 'VALIDATION_ERROR'` → `toast.error(err.message)`), pero:

1. El texto usa nombres de campo crudos (`fechaFin`/`fechaInicio`), no
   lenguaje humano.
2. No hay validación en cliente que lo ataje antes de la request con un
   mensaje claro.

### Solución

**Frontend — `App/frontend/src/app/admin/calendario/EventoModal.tsx` y
`App/frontend/src/app/maestro/calendario/EventoModal.tsx`:**

En `handleSubmit` (o en una función `validarFechas(form)` llamada desde
`handleSubmit` antes de `construirPayloadAlta`/`construirPayloadEdicion`),
agregar chequeos con mensaje propio vía `toast.error(...)`:

- Si `form.fechaFin` no vacío y `form.fechaFin < form.fechaInicio`
  (comparación de strings `YYYY-MM-DD`, lexicográfica = cronológica):
  → `"La fecha de fin no puede ser anterior a la fecha de inicio."`
  y `return` (no se envía).
- Si `form.seRepite` y `form.recurrenciaHasta` no vacío y
  `form.recurrenciaHasta < form.fechaInicio`:
  → `"La fecha de «repetir hasta» no puede ser anterior a la fecha de inicio."`
  y `return`.

Estos chequeos corren solo si `form.fechaInicio` no está vacío (si falta,
cae en la validación de "campo requerido" existente).

El toast genérico actual
(`"Revisa que todos los campos requeridos estén completos y con formato
correcto."`) se mantiene **solo** para el caso `payload === null` real
(falta un requerido / recurrencia incompleta), que ya no incluirá los casos
de fecha cruzada porque se atajan antes.

**Backend — `App/backend/src/calendario/calendario.service.ts`,
`CalendarioService.crear` (y `actualizar` si tiene los mismos mensajes):**

Reescribir los strings del campo `error` de estos 3 `BadRequestException`
(el `code` sigue siendo `VALIDATION_ERROR`, el HTTP sigue 400, la lógica no
cambia — solo el texto, porque se muestra tal cual al usuario):

| Antes | Después |
|---|---|
| `fechaFin no puede ser anterior a fechaInicio` | `La fecha de fin no puede ser anterior a la fecha de inicio del evento.` |
| `recurrenciaHasta no puede ser anterior a fechaInicio` | `La fecha hasta la que se repite el evento no puede ser anterior a su fecha de inicio.` |
| `recurrenciaHasta es requerido cuando recurrenciaRegla está presente` | `Falta indicar hasta qué fecha se repite el evento.` |

Si `actualizar` tiene variantes propias de estos mensajes, alinearlas al
mismo texto. Los e2e de `calendario.e2e-spec.ts` que asserten sobre el
string viejo se actualizan al nuevo.

### Fuera de alcance

- Validación de fechas cruzadas server-side nueva (ya existe).
- Mostrar los valores concretos en el mensaje ("el 1 de octubre es anterior
  al 3"): el texto fijo alcanza.

---

## Item 2 — «Fecha de fin» desaparece cuando el evento se repite

### Problema

`fechaFin` es puramente informativa (no genera ocurrencias — CLAUDE.md,
sección Fase 15) y `recurrenciaHasta` es el fin real de la serie. Tenerlas
ambas visibles en un evento recurrente confunde y habilita contradicciones
("¿cuál de las dos es el fin?").

### Solución

**Frontend — los 2 `EventoModal.tsx` (admin + maestro):**

- El bloque del campo «Fecha de fin (opcional)» (`<input id="evento-modal-fecha-fin">`
  y su `<label>`, dentro del `grid sm:grid-cols-2` que hoy comparte con
  «Fecha») solo se renderiza cuando **`!form.seRepite` Y el evento no es
  recurrente en modo edición** (`recurrenciaEditable && !form.seRepite`, o el
  equivalente exacto según cómo esté nombrada la condición en cada archivo).
  Cuando se oculta, «Fecha» (inicio) pasa a ocupar el ancho completo o queda
  en su media-columna — lo que se vea mejor; decisión del implementador,
  mínimo visual.
- Al pasar `form.seRepite` de `false` a `true` (en el `onChange` del checkbox
  «Se repite»), se limpia `form.fechaFin` a `''` en el mismo `setForm`.
- `construirPayloadAlta`: si `form.seRepite`, NO setear `payload.fechaFin`
  (hoy: `if (form.fechaFin) payload.fechaFin = form.fechaFin;` → agregar
  `&& !form.seRepite`).
- `construirPayloadEdicion`: `fechaFin` se manda como `null` (borrar) cuando
  el evento resultante es recurrente. Hoy la línea es
  `fechaFin: form.fechaFin || null`. Cambiar a:
  `fechaFin: form.seRepite ? null : (form.fechaFin || null)`.
  (En edición de un recurrente ya existente, `recurrenciaEditable` es
  `false`, el bloque «Se repite» no se muestra, y `form.seRepite` es
  `false` — ese caso ya no reenvía `fechaFin` porque el backend conserva el
  valor previo salvo que se mande `null` explícito; para no borrar
  silenciosamente un `fechaFin` legado de un recurrente, mandar `undefined`,
  no `null`, cuando `!recurrenciaEditable`. El implementador confirma el
  comportamiento exacto contra `CalendarioService.actualizar`.)
- Sin recurrencia: comportamiento actual 100% intacto.

### Fuera de alcance

- Quitar `fechaFin` del modelo o del DTO. Sigue siendo un campo válido para
  eventos no recurrentes.
- Cross-validación backend `fechaFin` vs `recurrenciaHasta` (al ocultar el
  campo en el cliente, la contradicción ya no se puede construir desde la
  UI; un cliente que mande ambas por API igual recibe los `VALIDATION_ERROR`
  individuales que ya existen).

---

## Item 3 — Notificaciones: al crear un evento + recordatorio 48h antes

El usuario eligió "las dos cosas".

### 3a — Notificación in-app al crear un evento (código nuevo)

**Schema — `App/backend/prisma/schema.prisma`:**

`enum TipoNotificacion` gana un tercer valor:
```
enum TipoNotificacion {
  AVISO
  RECORDATORIO_EVENTO
  EVENTO_NUEVO
}
```
Migración generada con `prisma migrate diff --from-schema-datasource
--to-schema-datamodel --script > prisma/migrations/<timestamp>_evento_nuevo_tipo_notificacion/migration.sql`
y aplicada con `prisma migrate deploy` (el `migrate dev` roto no aplica —
mismo camino documentado para `grupo_materia_maestro`). La migración es un
`ALTER TYPE "TipoNotificacion" ADD VALUE 'EVENTO_NUEVO';`. Se suma a la lista
de migraciones pendientes de correr en prod.

**`App/backend/src/calendario/calendario.service.ts`,
`CalendarioService.crear`:**

Después de que la transacción de alta (`$transaction`: crear evento + auditar
`ALTA`) confirma con éxito, ejecutar un efecto **best-effort** (mismo patrón
que el envío de correo de bienvenida en `PersonasService.altaPersona`):

1. `resolverDestinatarios(this.prisma, sedeId, alcanceTipo, alcanceId)` →
   `string[]` de `usuarioId` (firma real: `prisma`, `sedeId`, `alcanceTipo`,
   `alcanceId` en ese orden; solo devuelve `Usuario.activo: true`, sin
   duplicados).
2. Filtrar fuera al autor (`actorUsuarioId`).
3. Si queda al menos 1 destinatario:
   `prisma.notificacion.createMany({ data: destinatarios.map(usuarioId => ({
     usuarioId, sedeId, tipo: 'EVENTO_NUEVO', referenciaId: evento.id,
     titulo: 'Nuevo evento: ' + evento.titulo,
     cuerpoCorto: <fechaInicio ISO> + ' · ' + <alcance legible> }))})`.
   - `<alcance legible>`: `'Toda la sede'` | `'Carrera: ' + nombre` |
     `'Grupo: ' + nombre` — el service ya resuelve el nombre del alcance al
     validar (`validarAlcancePublicacion`); reusar ese dato si está a mano,
     si no una query chica extra dentro del bloque best-effort.
   - `Notificacion.titulo` y `Notificacion.cuerpoCorto` son `String` sin
     tope de longitud en el schema — no hay que truncar.
4. Todo el bloque va en un `try/catch`: en `catch`, `console.error` con el
   `evento.id` y el error completo (regla 12), y **no** se propaga — el
   `POST /eventos` devuelve `201 { data: EventoCalendario }` igual que hoy.
   El contrato de respuesta NO cambia.

**NO** se dispara correo en este camino (in-app únicamente — un correo por
cada evento a todo el alcance es ruidoso y Mailgun está en sandbox). El
correo sigue siendo responsabilidad exclusiva del job de recordatorios.

**Auditoría:** la creación de estas `Notificacion` NO se audita (regla 5 no
aplica — `Notificacion` es estado de entrega derivado, alto volumen; mismo
criterio que Fase 14).

**Frontend — `App/frontend/src/lib/api/notificaciones.ts`:**

`NotificacionItem.tipo` (hoy `'AVISO' | 'RECORDATORIO_EVENTO'`) suma
`'EVENTO_NUEVO'`. Las 3 campanas (`components/{admin,maestro,alumno}/ui/shell/
NotificacionesBell.tsx`) ya renderizan `titulo`/`cuerpoCorto` de cualquier
tipo sin ramificar — no requieren cambios. El deep-link por tipo (abrir el
evento al hacer click) queda fuera de alcance, igual que hoy para
`RECORDATORIO_EVENTO`.

**e2e:** nuevo caso en `calendario.e2e-spec.ts` (o donde vivan los tests de
`POST /eventos`): crear un evento de alcance `GRUPO` con alumnos + un maestro
asignado; afirmar que (a) `POST /eventos` sigue devolviendo `201` con el
shape de siempre, (b) cada destinatario del grupo (menos el autor) tiene una
`Notificacion` nueva `tipo: EVENTO_NUEVO` con `referenciaId` = id del evento,
(c) el autor NO tiene una. Un caso adicional: si `resolverDestinatarios`
devolviera vacío (grupo sin nadie), `POST /eventos` igual da `201` sin crear
notificaciones y sin lanzar. Limpieza en `afterAll` acotada a los `id`
creados (regla 14).

### 3b — Prender el job de recordatorios (config, sin código)

- `App/backend/.env`: agregar `RECORDATORIOS_HABILITADO=true`.
- `App/backend/.env.example` (existe): agregar `RECORDATORIOS_HABILITADO=`
  con un comentario ("job de recordatorios de calendario; falla cerrado si
  vacío").
- Prod: el disparo real es vía `pg_cron`/`pg_net` — ya documentado en
  `docs/setup-backend-recordatorios-cron.md`, no se toca código. Confirmar
  que ese doc menciona setear el flag; si no, agregarlo.
- Verificación en dev: `POST http://localhost:3001/internal/recordatorios/ejecutar`
  con header `X-Internal-Secret: <valor de INTERNAL_JOB_SECRET del .env>`.
  Con `MAILGUN_ENVIOS_HABILITADO=false`, el job crea las `Notificacion`
  in-app (`tipo: RECORDATORIO_EVENTO`) para las ocurrencias en las próximas
  48h y NO manda correo. El comando exacto se le pasa al usuario en el
  reporte de cierre.
- El `curl` de verificación es una prueba manual del agente/usuario, no un
  test nuevo (los e2e de `internal-recordatorios.e2e-spec.ts` ya cubren el
  job con el flag forzado).

### Fuera de alcance (item 3)

- Deep-link desde la campana al evento/aviso.
- Preferencias de notificación por usuario (silenciar, etc.).
- Correo al crear evento.
- `Aviso` / Fase 16.

---

## Item 4 — Sección «Eventos de la sede» en el dashboard `/admin`

El usuario eligió: sección en el dashboard `/admin` + "todos con filtro".

### Backend — nuevo endpoint `GET /eventos/listado`

**`App/backend/src/calendario/calendario.controller.ts` +
`calendario.service.ts`:**

- Ruta: `GET /eventos/listado`. Declarada **antes** de cualquier
  `GET /eventos/:id` futuro (no hay `:id` hoy, pero `listado` como segmento
  fijo debe ganarle a un `:id` dinámico si se agrega). Como `GET /eventos`
  ya existe sin `:id`, agregar `listado` como sub-ruta explícita
  (`@Get('listado')`) antes del `@Get()` raíz.
- Guards: `SedeGuard` (clase) + `RolesGuard` + `@Roles(RolUsuario.ADMINISTRATIVO)`
  a nivel de método (a diferencia de `GET /eventos` que sirve a los 3 roles).
  `sedeId` SIEMPRE de `@SedeActual()`.
- Query DTO (`listar-eventos-listado.query.dto.ts`, nuevo — o extender el
  existente si encaja): todos opcionales salvo defaults de paginación.
  - `desde?`, `hasta?`: `YYYY-MM-DD` (mismo `@Matches` que el resto).
    Sin el tope de 62 días de `GET /eventos` (acá es una lista de gestión,
    no de render de grilla). Si solo viene uno de los dos, el otro es
    abierto.
  - `alcanceTipo?`: `SEDE | CARRERA | GRUPO` (`@IsEnum(AlcanceDestino)`).
  - `categoria?`: `@IsEnum(CategoriaEvento)`.
  - `page?` (default 1, entero ≥ 1), `limit?` (default 20, entero 1-100).
    Fuera de rango → `400 VALIDATION_ERROR`.
- Devuelve **un row por `EventoCalendario` base** (NO ocurrencias expandidas
  — un recurrente diario no debe explotar a cientos de filas). Filtro de
  rango de fecha = eventos cuya `fechaInicio` cae en `[desde, hasta]`
  (simple y suficiente para "qué eventos hay en la sede"; afinar por
  ocurrencia queda fuera de alcance).
- `EventoListadoItem`:
  ```
  {
    id, titulo, descripcion,
    fechaInicio,            // ISO YYYY-MM-DD
    fechaFin,               // ISO | null
    horaInicio,             // "HH:MM" | null
    categoria,              // CategoriaEvento
    alcanceTipo,            // AlcanceDestino
    alcanceId,              // string | null
    alcanceNombre,          // "Toda la sede" | nombre de carrera | nombre de grupo
    esRecurrente,           // boolean
    recurrenciaResumen,     // string | null  — legible, ver abajo
    recurrenciaHasta,       // ISO | null
    autorNombre,            // "Nombres ApellidoPaterno" del autor
    createdAt               // ISO datetime
  }
  ```
- `recurrenciaResumen` (regla 1 — derivado al vuelo desde `recurrenciaRegla`
  JSON): función pura en el service. Formato:
  - DIARIA intervalo 1 → `"Todos los días"`; intervalo n → `"Cada n días"`.
  - SEMANAL → `"Cada semana: Lun, Mié"` (usa `diasSemana`); intervalo n →
    `"Cada n semanas: ..."`.
  - MENSUAL `diaMes` d → `"Mensual, día d"`; `diaMes: -1` →
    `"Mensual, último día"`.
  - Sufijo `" — hasta <recurrenciaHasta ISO>"` siempre que haya
    `recurrenciaHasta`.
  - `null` si el evento no es recurrente.
- `alcanceNombre`: resolver con las queries mínimas necesarias
  (`carrera.findMany`/`grupo.findMany` con los `alcanceId` de la página,
  no N+1). `SEDE` → `"Toda la sede"` sin query.
- `autorNombre`: join a `Usuario` → perfil correspondiente para `nombres` +
  `apellidoPaterno`. Si el autor no tiene perfil resoluble (defensivo),
  `"—"`.
- Orden: `fechaInicio desc, createdAt desc`.
- Éxito: `200 { data: EventoListadoItem[], page, limit, total }` — shape
  paginado estándar.
- Sin código de error nuevo (`VALIDATION_ERROR` para query inválida,
  `UNAUTHORIZED`/`ROL_NO_AUTORIZADO` por los guards).

**Contrato:** documentar `GET /eventos/listado` en `CLAUDE.md` (sección
"Contrato de API", junto a los otros endpoints de `/eventos`).

**e2e:** nuevo bloque en `calendario.e2e-spec.ts` — admin lista eventos de su
sede; confirma paginación, filtro por `alcanceTipo` y por `categoria`, que un
evento de OTRA sede no aparece (aislamiento), que `recurrenciaResumen` y
`alcanceNombre` salen bien para un recurrente semanal con alcance de grupo, y
que un maestro/alumno recibe `403`.

### Frontend — `App/frontend/src/app/admin/page.tsx`

- Bloque nuevo `<SeccionEventosSede />` (componente local en el mismo archivo
  o en `app/admin/` — no en `components/` compartido; sigue el patrón de
  `ResumenDashboard` que ya vive en `page.tsx`) debajo del `<ResumenDashboard>`.
- Filtros compactos (fila de controles):
  - Rango: `<Select>` con opciones "Próximos 30 días" (default) / "Próximos
    60 días" / "Próximos 90 días" / "Todos". Traduce a `desde`/`hasta` en el
    cliente (`desde` = hoy; `hasta` = hoy + N, o sin `hasta` para "Todos").
  - Alcance: `<Select>` Todos / Toda la sede / Carrera / Grupo →
    `alcanceTipo` (o sin filtro para "Todos").
  - Categoría: `<Select>` Todas / las 5 categorías → `categoria`.
- Lista paginada (`useQuery` con `keepPreviousData`, key incluye los
  filtros + page). Cada row:
  - Línea 1: **título** · chip de categoría (color de
    `COLOR_POR_CATEGORIA`, ya exportado desde
    `app/admin/calendario/EventoModal.tsx` — import cross-sección dentro de
    `app/admin/`, permitido; si molesta, mover el mapa a un
    `app/admin/calendario/colores.ts` y reimportar desde ambos).
  - Línea 2: fecha (`fechaInicio`, formateada) · si `esRecurrente`:
    `"Recurrente · " + recurrenciaResumen` · `alcanceNombre` · autor.
  - **Click en el row → expande inline (acordeón)** mostrando: descripción
    completa, hora, fecha fin, `recurrenciaHasta`, alcance completo,
    `createdAt`. Sin modal. Un solo row expandido a la vez (o varios —
    decisión menor del implementador).
- Estados `isLoading` / `isError` (con `ApiError.message`) / vacío
  ("No hay eventos con estos filtros."), mismo patrón que el resto del
  dashboard.
- Paginación: botones Anterior/Siguiente + "Página X de Y", mismo patrón que
  `app/admin/alumnos/page.tsx`.
- `App/frontend/src/lib/api/calendario.ts`: `listarEventosSede(filtros)` +
  tipo `EventoListadoItem` + tipo `FiltrosEventosListado`. Devuelve
  `{ data, page, limit, total }`.

### Fuera de alcance (item 4)

- Editar/crear/borrar desde esta sección (eso vive en `/admin/calendario`).
  El acordeón es solo lectura. (Opcional, si es trivial: un link "Ver en el
  calendario" que navega a `/admin/calendario` — decisión del implementador,
  no requerido.)
- Filtro por texto libre / búsqueda.
- Expandir ocurrencias (la lista es por evento base).
- Tocar el árbol de maestro/alumno.

---

## Orden de implementación sugerido (para el plan)

1. **Backend item 1** — reescribir los 3 mensajes de error + actualizar
   asserts e2e. (chico, aislado)
2. **Frontend items 1 + 2 (admin `EventoModal.tsx`)** — validación de fechas
   en cliente + ocultar `fechaFin` con recurrencia.
3. **Frontend items 1 + 2 (maestro `EventoModal.tsx`)** — mismo cambio,
   archivo independiente.
4. **Backend item 3a** — enum `EVENTO_NUEVO` + migración + hook best-effort
   en `CalendarioService.crear` + e2e.
5. **Frontend item 3a** — `NotificacionItem.tipo` suma `'EVENTO_NUEVO'`
   (1 línea) + verificar build de los 3 árboles.
6. **Config item 3b** — `RECORDATORIOS_HABILITADO=true` en `.env`
   (+ `.env.example` si existe) + revisar el doc de setup.
7. **Backend item 4** — `GET /eventos/listado` + DTO + `recurrenciaResumen`
   + doc en `CLAUDE.md` + e2e.
8. **Frontend item 4** — `listarEventosSede` en `lib/api/calendario.ts` +
   `<SeccionEventosSede />` en `app/admin/page.tsx`.

Tareas 2 y 3 tocan archivos independientes (regla 11) pero comparten el
diseño — se dispararían secuenciales igual (no se paralelizan implementers).
Tarea 4 depende de nada del resto. Tarea 8 depende de 7.

## Verificación manual final (a cargo del usuario)

- Crear evento `fechaFin` < `fechaInicio` → mensaje claro en español, antes
  de enviar.
- Marcar «Se repite» → «Fecha de fin» desaparece; desmarcar → reaparece
  vacía.
- Crear un evento de alcance GRUPO → los alumnos/maestros del grupo ven el
  número en la campana al instante; el autor no.
- `curl` al endpoint interno de recordatorios → notificación
  `RECORDATORIO_EVENTO` para eventos dentro de 48h.
- Dashboard `/admin` → sección «Eventos de la sede», filtros funcionan,
  acordeón muestra todos los detalles, un evento de otra sede no aparece.
