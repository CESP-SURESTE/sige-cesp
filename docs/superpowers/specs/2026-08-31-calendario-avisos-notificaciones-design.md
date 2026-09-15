# Calendario + Avisos y mensajes + Infra de notificaciones (Fases 14-17)

**Fecha:** 2026-08-31
**Roadmap:** `docs/roadmap.md` — FASES 14, 15, 16, 17 (Días 38-51).
**Contexto:** CESP aprobó el alcance total del proyecto. Calendario (era "Módulo C") y
Avisos y mensajes (era "Módulo D") salen de "módulos futuros" y se vuelven fases reales.
Módulo A (Calificaciones/tareas) y Módulo B (Asistencia biométrica) siguen fuera de alcance.
**Alcance de este spec:** diseño de arquitectura de las 4 fases nuevas. Cada fase corre su
propio ciclo Subagent-Driven Development (spec de día + plan + tasks + review + QA) cuando
se llegue a ella — este documento es el mapa, no el plan de ejecución día por día.

## Decisiones tomadas (brainstorming 2026-08-31)

| Tema | Decisión |
|---|---|
| **Avisos — alcance** | Broadcast de una vía + **recibo de lectura**: el autor ve la lista de destinatarios con leído/no leído y timestamp. Sin respuesta ni chat. |
| **Avisos — quién publica** | `ADMINISTRATIVO` (alcance sede / carrera / grupo de su sede) + `MAESTRO` (solo grupos donde tiene materia asignada vía `GrupoMateriaMaestro`). `ALUMNO` solo lee. |
| **Avisos — notificación** | Badge in-app (no leídos) + correo best-effort al `correoPersonal` del destinatario, detrás del flag de Mailgun (mismo criterio que el correo de bienvenida — apagado hasta dominio real de CESP). |
| **Calendario — complejidad** | Base + categorías/colores + **recurrencia** (diaria / semanal / mensual, con intervalo y fecha de fin). Sin excepciones por ocurrencia en v1. |
| **Calendario — quién crea** | `ADMINISTRATIVO` (sede / carrera / grupo) + `MAESTRO` (sus grupos asignados). `ALUMNO` solo lee. Mismo helper de permisos que Avisos. |
| **Calendario — recordatorios** | Sí. Job diario: eventos en las próximas 24-48h → `Notificacion` + correo best-effort. |
| **QA** | Se mantiene el `qa-<dominio>` ligero por día al cerrar cada entregable + **nueva Fase 17 de QA integral con Opus 5 a esfuerzo máximo** sobre todo el sistema. |

## Reglas de arquitectura del `CLAUDE.md` raíz que aplican

- **Regla 1 (nunca persistir lo calculable):** las ocurrencias de un evento recurrente NO
  se materializan como filas — se expanden al vuelo desde `recurrencia_regla` dentro del
  rango consultado. El conteo de no leídas para el badge se deriva con `COUNT`.
- **Regla 2 (doble capa RLS + Guard):** `notificaciones`, `eventos_calendario`, `avisos`
  llevan `sede_id` + policy `sede_isolation_*` calcada de las existentes. `recordatorio_enviado`
  aísla indirecto vía `eventos_calendario.sede_id` (mismo patrón que `grupo_alumnos`).
  El guard saca `sede_id` del JWT, jamás del body.
- **Regla 5 (`RegistroAuditoria` solo inserción):** crear/editar/borrar un `EventoCalendario`
  o un `Aviso` audita (`ALTA`/`EDICION`/`ELIMINACION`) en la misma transacción. La
  `Notificacion` en sí NO se audita (alto volumen, es estado de entrega derivado, no una
  acción de negocio) — ambigüedad documentada acá y en `ESTADO.md`, mismo criterio que el
  `accion: EDICION` de `PATCH /auth/cambiar-password`.
- **Regla 11 (separación total admin/alumno en frontend):** el badge de notificaciones, las
  vistas de calendario y los feeds de avisos se implementan por árbol (`app/admin`,
  `app/alumno`, `app/maestro`), sin componente compartido. Los clientes de API
  (`lib/api/notificaciones.ts`, `lib/api/calendario.ts`, `lib/api/avisos.ts`) sí son
  compartidos — mismo criterio que `lib/api/grupos.ts` / `lib/api/materias.ts`.
- **Regla 12 (todo catch loguea):** el job de recordatorios y el fan-out de correo loguean
  el error completo antes de tragárselo (best-effort no es silencio).
- **Regla 13 (pantalla CRUD admin = tabla/vista + modal único alta/edición):** aplica a la
  gestión de eventos de calendario y a la publicación de avisos en `app/admin/` y
  `app/maestro/`.

---

## FASE 14 — Infraestructura de notificaciones (Días 38-39)

Capa compartida por Calendario y Avisos. Se construye primero para que ambos módulos
solo tengan que crear filas.

### Día 38 — Backend

**Modelo `Notificacion`** (`prisma/schema.prisma`) + migración:

```prisma
model Notificacion {
  id           String            @id @default(uuid())
  usuarioId    String            @map("usuario_id")
  usuario      Usuario           @relation(fields: [usuarioId], references: [id])
  sedeId       String            @map("sede_id")
  sede         Sede              @relation(fields: [sedeId], references: [id])
  tipo         TipoNotificacion
  referenciaId String            @map("referencia_id") // Aviso.id | EventoCalendario.id
  titulo       String
  cuerpoCorto  String            @map("cuerpo_corto")
  leidoEn      DateTime?         @map("leido_en")
  createdAt    DateTime          @default(now()) @map("created_at")

  @@index([usuarioId, leidoEn])
  @@map("notificaciones")
}

enum TipoNotificacion {
  AVISO
  RECORDATORIO_EVENTO
}
```

- Migración: `CREATE TABLE`, FKs `ON DELETE RESTRICT ON UPDATE CASCADE`, `ENABLE ROW LEVEL
  SECURITY`, `GRANT` a `authenticated`, `CREATE POLICY "sede_isolation_notificaciones"`
  calcada de una policy directa por `sede_id` (p. ej. `sede_isolation_grupos`). Además
  filtro por dueño: la policy exige `sede_id = current_setting(...)` **y** el service
  siempre acota por `usuarioId = @ActorUsuarioId()` (un usuario nunca ve notificaciones
  de otro de su misma sede).
- `prisma migrate deploy` en prod pendiente antes de `main` (se suma a las 2 ya
  pendientes: art. 53 + `grupo_materia_maestro`).

**Endpoints** — módulo nuevo `src/notificaciones/`. Guard `SedeGuard` (sin `RolesGuard` —
cualquier rol autenticado ve las suyas, mismo criterio que `GET /perfil`). `usuarioId`
SIEMPRE de `@ActorUsuarioId()`.

| Ruta | Detalle |
|---|---|
| `GET /notificaciones?page=&limit=` | Feed del actor, paginado (shape `data`/`page`/`limit`/`total`). Orden `createdAt desc`. Item: `{ id, tipo, referenciaId, titulo, cuerpoCorto, leidoEn, createdAt }`. |
| `GET /notificaciones/conteo-no-leidas` | `200 { data: { total: number } }` — alimenta el badge. Barato, sin paginar. |
| `PATCH /notificaciones/:id/leido` | Marca `leidoEn = now()` (idempotente — si ya estaba, no error). `:id` de otro usuario → `404 NOT_FOUND`. `200 { data: { ok: true } }`. |

Sin códigos de error nuevos.

**`MailService`** (`src/mail/`) gana un método genérico:
`enviarNotificacion({ destinatario, asunto, cuerpoHtml, cuerpoTexto })` — hoy el service
solo tiene el template hardcodeado de bienvenida. Mismo `fetch` nativo a Mailgun, mismo
flag `MAILGUN_ENVIOS_HABILITADO` (falla cerrado). Se usa desde el fan-out de avisos
(Fase 16) y el job de recordatorios (Fase 15).

**e2e:** `test/notificaciones.e2e-spec.ts` — feed paginado y ordenado, conteo, marcar
leído idempotente, aislamiento (`:id` de otro usuario → 404; usuario de otra sede no ve
nada), `PATCH` sin token → 401. `afterAll` limpia acotado a los `id` creados (regla 14).

### Día 39 — Frontend (badge + feed in-app)

- `lib/api/notificaciones.ts` (compartido): `listarNotificaciones(page)`,
  `conteoNoLeidas()`, `marcarLeida(id)`.
- Componente de campana + badge en cada layout: `components/admin/ui/NotificacionesBell.tsx`,
  `components/alumno/ui/NotificacionesBell.tsx`, `components/maestro/ui/NotificacionesBell.tsx`
  (tres archivos, regla 11). Dropdown con las últimas ~10, marca leída al abrir el ítem,
  link a la entidad: `AVISO` → feed de avisos; `RECORDATORIO_EVENTO` → vista de calendario
  en el mes del evento.
- Polling: React Query `useQuery` con `refetchInterval` (~60s) sobre `conteo-no-leidas`.
  Sin websockets (estabilidad > todo; el volumen de un ERP escolar no lo justifica).
- QA: `qa-admin` + `qa-alumno` + `qa-frontend` (el bell toca los 3 árboles y `lib/api`).

---

## FASE 15 — Calendario (Días 40-44)

### Día 40 — Modelo + motor de recurrencia (backend, sin endpoints)

**Modelo `EventoCalendario`** + migración:

```prisma
model EventoCalendario {
  id                String          @id @default(uuid())
  sedeId            String          @map("sede_id")
  sede              Sede            @relation(fields: [sedeId], references: [id])
  autorUsuarioId    String          @map("autor_usuario_id")
  autor             Usuario         @relation(fields: [autorUsuarioId], references: [id])
  titulo            String
  descripcion       String?
  fechaInicio       DateTime        @map("fecha_inicio") @db.Date
  horaInicio        String?         @map("hora_inicio")  // "HH:MM" 24h, null = todo el día
  fechaFin          DateTime?       @map("fecha_fin") @db.Date
  categoria         CategoriaEvento
  alcanceTipo       AlcanceDestino  @map("alcance_tipo")
  alcanceId         String?         @map("alcance_id")   // Carrera.id | Grupo.id; null si SEDE
  recurrenciaRegla  Json?           @map("recurrencia_regla")
  recurrenciaHasta  DateTime?       @map("recurrencia_hasta") @db.Date
  createdAt         DateTime        @default(now()) @map("created_at")
  updatedAt         DateTime        @updatedAt @map("updated_at")

  recordatoriosEnviados RecordatorioEnviado[]

  @@map("eventos_calendario")
}

model RecordatorioEnviado {
  id              String           @id @default(uuid())
  eventoId        String           @map("evento_id")
  evento          EventoCalendario @relation(fields: [eventoId], references: [id])
  fechaOcurrencia DateTime         @map("fecha_ocurrencia") @db.Date
  enviadoEn       DateTime         @default(now()) @map("enviado_en")

  @@unique([eventoId, fechaOcurrencia])
  @@map("recordatorio_enviado")
}

enum CategoriaEvento {
  EXAMEN
  SOCIAL
  ADMINISTRATIVO
  SUSPENSION_CLASES
  OTRO
}

enum AlcanceDestino {  // compartido con Aviso (Fase 16)
  SEDE
  CARRERA
  GRUPO
}
```

- RLS: `sede_isolation_eventos_calendario` directa por `sede_id`.
  `sede_isolation_recordatorio_enviado` indirecta vía `eventos_calendario.sede_id`
  (calcada de `sede_isolation_grupo_alumnos`).

**Motor de recurrencia** — módulo `src/calendario/recurrencia.util.ts`, función pura y
testeada con unit tests (no e2e):

```ts
type ReglaRecurrencia = {
  frecuencia: 'DIARIA' | 'SEMANAL' | 'MENSUAL';
  intervalo: number;          // cada N (default 1)
  diasSemana?: number[];      // solo SEMANAL; 0=Dom .. 6=Sáb
  diaMes?: number;            // solo MENSUAL; 1..31, o -1 = último día del mes
};

expandirOcurrencias(
  evento: { fechaInicio: Date; recurrenciaRegla: ReglaRecurrencia | null; recurrenciaHasta: Date | null },
  rango: { desde: Date; hasta: Date },
): Date[]  // fechas de inicio de cada ocurrencia dentro del rango
```

- Sin regla → `[fechaInicio]` si cae en el rango, `[]` si no.
- Con regla → `recurrenciaHasta` es **requerido** (validado en el DTO del Día 41) — no se
  permiten series infinitas.
- Tope duro de 366 ocurrencias por expansión (defensa contra rango + intervalo abusivos);
  si se excede, se trunca y se loguea.
- Sin "primer viernes de mes" ni `BYSETPOS` — solo el subconjunto de arriba. Documentado
  como límite de alcance.
- **Sin excepciones por ocurrencia en v1:** editar/borrar un evento afecta la serie
  completa. `EventoCalendarioExcepcion` (cancelar/mover una ocurrencia suelta) queda
  fuera de alcance explícito.

### Día 41 — CRUD de eventos

Módulo `src/calendario/`. Guard `SedeGuard` + `RolesGuard`. `sedeId` de `@SedeActual()`,
`autorUsuarioId` de `@ActorUsuarioId()`.

**Helper de permisos de publicación compartido** (`src/comun/alcance-publicacion.ts`, lo
usan Calendario y Avisos):

```ts
// Valida que el actor PUEDE publicar a (alcanceTipo, alcanceId). Lanza si no.
async validarAlcancePublicacion(
  actor: { usuarioId: string; rol: RolUsuario; sedeId: string },
  alcanceTipo: AlcanceDestino,
  alcanceId: string | null,
): Promise<void>
```

- `rol === ADMINISTRATIVO`: `SEDE` (alcanceId null), `CARRERA` (la carrera debe ser de su
  sede), `GRUPO` (el grupo debe ser de su sede). Sin jerarquía de `nivelPermiso` (mismo
  criterio que Carreras/Grupos/Salones).
- `rol === MAESTRO`: **solo** `GRUPO`, y el `alcanceId` debe estar entre los grupos donde
  el maestro tiene fila en `GrupoMateriaMaestro`. Cualquier otro `alcanceTipo`, o un grupo
  fuera de esa lista → `403 ROL_NO_AUTORIZADO` (la API oculta el cross-scope como
  no-autorizado, mismo criterio que el resto).
- `rol === ALUMNO`: siempre `403 ROL_NO_AUTORIZADO` (respaldado por `@Roles(ADMINISTRATIVO,
  MAESTRO)` a nivel de método).
- `alcanceTipo`/`alcanceId` malformados (p. ej. `SEDE` con `alcanceId`, o `GRUPO` sin él)
  → `400 VALIDATION_ERROR`. `alcanceId` con formato válido pero inexistente en la sede →
  `404 NOT_FOUND`.

**Helper de resolución de destinatarios compartido** (`resolverDestinatarios(sedeId,
alcanceTipo, alcanceId) → usuarioId[]`, lo usan el fan-out de avisos y el job de
recordatorios):

- `SEDE` → todos los `Usuario` de la sede con `activo: true` (los 3 roles).
- `CARRERA` → alumnos con `PerfilAlumno.carreraId === alcanceId` (activos) + maestros con
  asignación en algún grupo de esa carrera.
- `GRUPO` → alumnos matriculados (`GrupoAlumno`) + maestros asignados
  (`GrupoMateriaMaestro`). Sin filtrar por `estatus`/`activo` de alumno (coherente con
  Día 30/32); sí se excluyen `Usuario.activo: false`.

| Ruta | Detalle |
|---|---|
| `POST /eventos` | Body: `titulo`, `descripcion?`, `fechaInicio`, `horaInicio?`, `fechaFin?`, `categoria`, `alcanceTipo`, `alcanceId?`, `recurrenciaRegla?`, `recurrenciaHasta?`. Valida alcance con el helper. `recurrenciaRegla` presente ⇒ `recurrenciaHasta` requerido. Audita `ALTA`. `201 { data: EventoCalendario }`. |
| `GET /eventos?desde=&hasta=` | `desde`/`hasta` requeridos (rango, máx 62 días para acotar expansión). Trae los eventos de la sede cuyo alcance le toca al actor (SEDE siempre; CARRERA si es su carrera —alumno— o tiene asignación —maestro—; GRUPO si está matriculado/asignado; un `ADMINISTRATIVO` ve todos los de su sede), expande ocurrencias en el rango. `200 { data: OcurrenciaEvento[] }` con `{ eventoId, titulo, descripcion, fecha, horaInicio, categoria, alcanceTipo, alcanceId, esRecurrente }`, orden `fecha asc, horaInicio asc nulls first`. |
| `PATCH /eventos/:id` | Solo el autor o un `ADMINISTRATIVO` de la sede. Campos opcionales. Re-valida alcance si cambia. Audita `EDICION` solo si hay cambios reales (patrón `hayCambiosReales` de `CarrerasService`). `:id` de otra sede → `404`. |
| `DELETE /eventos/:id` | Solo autor o `ADMINISTRATIVO`. DELETE real (`EventoCalendario` es "CRUD completo", no baja lógica). Borra en cascada sus `RecordatorioEnviado`. Audita `ELIMINACION` antes del delete. `200 { data: { ok: true } }`. |

**e2e:** `test/calendario.e2e-spec.ts` — alta con y sin recurrencia, `recurrenciaHasta`
faltante → 400, expansión correcta en un rango (semanal cada 2 semanas, mensual día -1),
filtrado por alcance (alumno de carrera A no ve evento de grupo de carrera B; maestro solo
ve sus grupos), permisos (`MAESTRO` publica a `SEDE` → 403; a un grupo ajeno → 403;
`ALUMNO` a cualquier cosa → 403), `PATCH`/`DELETE` por no-autor no-admin → 403,
aislamiento cross-sede. `afterAll` acotado a ids (regla 14).

### Día 42 — Job de recordatorios

**Lógica** — `CalendarioService.generarRecordatoriosPendientes()`: para cada evento de las
próximas 24-48h (expandiendo recurrencia), por cada ocurrencia sin fila en
`RecordatorioEnviado(eventoId, fechaOcurrencia)`:
1. `resolverDestinatarios(...)` del alcance del evento.
2. `createMany` de `Notificacion` (`tipo: RECORDATORIO_EVENTO`, `referenciaId: eventoId`)
   — dentro de una transacción junto con el `create` de `RecordatorioEnviado` (el
   `@@unique` lo hace idempotente si dos corridas se solapan).
3. Correo best-effort por destinatario vía `MailService.enviarNotificacion` (fuera de la
   transacción, después de confirmar — patrón `altaPersona` + Mailgun). Cada fallo se
   loguea, ninguno tumba el job.

**Disparador** — el `CLAUDE.md` pide no agregar dependencias si algo se resuelve con lo
instalado, y Render free tier **duerme el servicio por inactividad** (un cron interno no
dispararía de forma confiable). Decisión: **sin `@nestjs/schedule`**. La lógica se expone
en un endpoint interno protegido:

- `POST /internal/recordatorios/ejecutar` — guard propio `InternalJobGuard` que exige
  header `X-Internal-Secret` == `INTERNAL_JOB_SECRET` (env var nueva). No pasa por
  `SedeGuard`/`RolesGuard`. `200 { data: { ocurrenciasProcesadas, notificacionesCreadas } }`.
- Disparo diario desde **Supabase `pg_cron` + `pg_net`** (extensiones ya disponibles en
  Supabase, cero dep nueva en el backend): un `cron.schedule` diario hace `net.http_post`
  al endpoint con el secreto. Alternativa equivalente: una GitHub Action `schedule` que
  pega el mismo endpoint. La que se elija se documenta en `docs/setup-backend-*.md`.
- Flag `RECORDATORIOS_HABILITADO` (env var, falla cerrado, apagado por defecto) — mismo
  criterio que `MAILGUN_ENVIOS_HABILITADO` / `POLITICA_PASSWORD_HABILITADA`.

**e2e:** llamar el endpoint con el secreto correcto/incorrecto (200 / 401), verificar
idempotencia (dos llamadas seguidas no duplican `Notificacion`), verificar que un evento a
> 48h no genera nada. Correo mockeado.

### Día 43 — UI de calendario: admin + maestro (creación/edición)

- Rutas nuevas `app/admin/calendario/page.tsx` y `app/maestro/calendario/page.tsx`
  (árboles separados, regla 11).
- Vista mensual (grid de 6 semanas) con navegación mes anterior/siguiente; consume
  `GET /eventos?desde=&hasta=` con el rango del mes visible.
- Botón "+ Nuevo evento" → modal único alta/edición (regla 13) con: título, descripción,
  fecha(s), hora opcional, `<select>` de categoría, bloque de alcance (`<select>` tipo +
  `<select>` dependiente de carrera/grupo de la sede), bloque de recurrencia (checkbox
  "se repite" → frecuencia + intervalo + días de semana / día de mes + "hasta").
- Colores por categoría (paleta fija en un helper local por árbol).
- "Editar"/"Eliminar" solo en eventos propios o si el actor es `ADMINISTRATIVO`; eliminar
  con modal de confirmación (patrón `ConfirmarEliminar*Modal`).
- `lib/api/calendario.ts` compartido.

### Día 44 — UI de calendario: alumno (solo lectura)

- `app/alumno/calendario/page.tsx` — misma vista mensual, sin botón de alta, sin editar.
- Click en un evento → panel/modal de detalle (título, descripción, fecha/hora, categoría).
- Link en el sidebar de `app/alumno/page.tsx` a la nueva ruta.
- QA: `qa-alumno` + `qa-admin` ligeros; consignan en `ESTADO.md`.
- Al cierre del Día 44: tachar **Fase 15** en `roadmap.md`.

---

## FASE 16 — Avisos y mensajes (Días 45-48)

### Día 45 — Modelo `Aviso` + fan-out de destinatarios

```prisma
model Aviso {
  id             String         @id @default(uuid())
  sedeId         String         @map("sede_id")
  sede           Sede           @relation(fields: [sedeId], references: [id])
  autorUsuarioId String         @map("autor_usuario_id")
  autor          Usuario        @relation(fields: [autorUsuarioId], references: [id])
  titulo         String
  cuerpo         String
  alcanceTipo    AlcanceDestino @map("alcance_tipo")   // enum de Fase 15
  alcanceId      String?        @map("alcance_id")
  createdAt      DateTime       @default(now()) @map("created_at")

  @@map("avisos")
}
```

- RLS `sede_isolation_avisos` directa por `sede_id`.
- **Publicación** (`AvisosService.publicar`), todo en una transacción:
  1. `validarAlcancePublicacion(actor, ...)` (helper compartido de Fase 15).
  2. `create` del `Aviso`.
  3. `resolverDestinatarios(...)` → `createMany` de `Notificacion` (`tipo: AVISO`,
     `referenciaId: aviso.id`, `titulo` = título del aviso, `cuerpoCorto` = primeros ~140
     chars del cuerpo) — **una fila por destinatario, snapshot al momento de publicar**.
     Esta tabla ES el ledger de recibo de lectura: `leidoEn` por destinatario.
  4. Audita `ALTA` (`entidad: 'Aviso'`).
  Después de confirmar la transacción: correo best-effort por destinatario
  (`MailService.enviarNotificacion`), cada fallo logueado, ninguno tumba la publicación
  (patrón `altaPersona` + Mailgun).
- El autor NO recibe `Notificacion` de su propio aviso (se excluye del fan-out).

### Día 46 — Endpoints de avisos

Módulo `src/avisos/`. `SedeGuard` + `RolesGuard`.

| Ruta | Roles | Detalle |
|---|---|---|
| `POST /avisos` | `ADMINISTRATIVO`, `MAESTRO` | Body: `titulo`, `cuerpo`, `alcanceTipo`, `alcanceId?`. Ver "Publicación". `201 { data: Aviso }`. |
| `GET /avisos?page=&limit=` | todos | Feed del actor: los avisos que le llegaron (join contra sus `Notificacion` `tipo: AVISO`), orden `createdAt desc`. Item: `{ id, titulo, cuerpo, autor: { nombres, apellidoPaterno }, createdAt, leidoEn }`. |
| `GET /avisos/:id` | todos (destinatario) | Devuelve el aviso completo **y marca la `Notificacion` del actor como leída** (`leidoEn = now()` si estaba null) — esto registra el recibo. Actor que no era destinatario → `404`. |
| `GET /avisos/:id/recibos` | autor o `ADMINISTRATIVO` de la sede | `200 { data: { total, leidos, noLeidos, destinatarios: { usuarioId, nombreCompleto, rol, leidoEn }[] } }`. Otro rol / no-autor → `403`. |
| `DELETE /avisos/:id` | autor o `ADMINISTRATIVO` | DELETE real del `Aviso` + sus `Notificacion` en cascada. Audita `ELIMINACION`. `200 { data: { ok: true } }`. |

Sin códigos de error nuevos (reusa `VALIDATION_ERROR`, `NOT_FOUND`, `ROL_NO_AUTORIZADO`).

**e2e:** `test/avisos.e2e-spec.ts` — publicar a grupo genera N `Notificacion` (una por
matriculado + maestros asignados, autor excluido), `GET /avisos/:id` marca leído y aparece
en `/recibos`, `/recibos` por no-autor no-admin → 403, `MAESTRO` publica a `SEDE` → 403 y a
grupo ajeno → 403, `ALUMNO` publica → 403, `DELETE` borra notificaciones en cascada,
aislamiento cross-sede. `afterAll` acotado a ids (regla 14).

### Día 47 — UI de publicación: admin + maestro

- `app/admin/avisos/page.tsx` y `app/maestro/avisos/page.tsx`: tabla de avisos publicados
  por el actor (título, alcance, fecha, "X de Y leídos") + botón "+ Nuevo aviso" → modal
  (título, cuerpo, bloque de alcance idéntico al de calendario — se puede factorizar el
  sub-form dentro de cada árbol, no entre árboles).
- Fila → vista de recibos: contador `leidos / total` + lista de destinatarios con estado y
  fecha de lectura.
- "Eliminar" con modal de confirmación.

### Día 48 — UI de recepción: alumno + maestro

- Sección "Avisos" apilada en `app/alumno/page.tsx` y `app/maestro/page.tsx` (mismo patrón
  que "Compañeros" / "Mis grupos y materias" — no ruta nueva). Si el volumen lo pide, ruta
  propia `app/alumno/avisos/`; se decide al implementar.
- Feed ordenado por fecha, badge de no leídos, click en un aviso → detalle (dispara
  `GET /avisos/:id`, que marca leído).
- QA: `qa-alumno` + `qa-admin` ligeros.
- Al cierre del Día 48: tachar **Fase 16** en `roadmap.md`.

---

## FASE 17 — QA integral final + entrega completa (Días 49-51)

### Día 49 — QA integral con Opus 5 (esfuerzo máximo)

Auditoría profunda de **todo el sistema**, no solo de lo nuevo. Se corre con Opus 5 a
esfuerzo de razonamiento máximo (`/code-review ultra` sobre la rama, o los agentes
`qa-<dominio>` con override de modelo `opus` + reasoning alto). Cobertura mínima:

- **Aislamiento cross-sede** en `notificaciones`, `eventos_calendario`,
  `recordatorio_enviado`, `avisos` — query por query, + tests e2e nuevos con sesiones
  reales de 2 sedes.
- **Permisos de publicación** admin (sede/carrera/grupo) vs maestro (solo grupos
  asignados) — que un maestro no pueda avisar/agendar fuera de sus grupos por ningún path.
- **Recibo de lectura**: que `/recibos` solo lo vea el autor o un administrativo; que el
  snapshot de destinatarios no filtre entre sedes.
- **Idempotencia del job de recordatorios** bajo corridas solapadas.
- **Contrato de API** (`{ data }` / `{ error, code }`, camelCase, paginación) en todas las
  rutas nuevas.
- **Las 15 reglas de arquitectura** del `CLAUDE.md` contra el código nuevo (especial
  atención a la 1 — ocurrencias no persistidas —, la 5 — auditoría — y la 11 — separación
  de árboles).
- **Regresión**: suite e2e completa del backend + builds de frontend en verde.
- La capa `app/plataforma/` (sin dueño de dominio en el roster) entra en este pase.

Consigna veredicto y hallazgos en `ESTADO.md`.

### Día 50 — Corrección de hallazgos + redeploy final

- Fix de lo bloqueante del Día 49 (los coder/debugger de dominio; QA re-verifica).
- `prisma migrate deploy` en prod de **todas** las migraciones pendientes acumuladas
  (art. 53, `grupo_materia_maestro`, `notificaciones`, `eventos_calendario` +
  `recordatorio_enviado`, `avisos`).
- Merge `dev` → `main`; deploy de Fases 14-17 a Vercel + Render (los 4 proyectos/servicios).
- Alta del disparador de recordatorios en prod (pg_cron / GitHub Action) + `INTERNAL_JOB_SECRET`
  y flags (`RECORDATORIOS_HABILITADO`, `MAILGUN_ENVIOS_HABILITADO`) en el entorno correcto.
- Verificación end-to-end en prod con sesiones reales (admin publica aviso → alumno lo ve
  y aparece en recibos; admin crea evento recurrente → alumno lo ve en su calendario).

### Día 51 — Entrega final

- Carga de eventos de calendario / avisos reales si CESP los tiene listos.
- Capacitación de los 2 módulos nuevos (calendario, avisos + recibos de lectura).
- Documentación de uso actualizada (incluye los módulos de grupos y los nuevos) y entregada.
- Cierre formal del proyecto — alcance total cubierto.

---

## Fuera de alcance (explícito)

- **Mensajería bidireccional / chat** entre usuarios. Avisos es broadcast de una vía; la
  única interacción del destinatario es marcar leído (implícito al abrir).
- **Excepciones por ocurrencia** en eventos recurrentes (cancelar/mover una sola fecha de
  la serie). Editar/borrar afecta la serie completa.
- **Recurrencia compleja**: "primer viernes de mes", `BYSETPOS`, calendarios no
  gregorianos, zonas horarias por evento (todo el proyecto asume hora local de Yucatán).
- **Exportar a ICS / Google Calendar**.
- **Adjuntos** en avisos o eventos (Storage). El cuerpo es texto plano / markdown ligero.
- **Moderación / aprobación** de avisos de maestros antes de publicarse.
- **Preferencias de notificación por usuario** (silenciar categorías, elegir canal). El
  correo es global por flag; el badge siempre está.
- **Notificaciones push del navegador / móvil**. Solo in-app + correo.
- `@nestjs/schedule` como dependencia — el cron se dispara externo.
- Websockets / tiempo real para el badge — es polling.

## Contrato de API — entradas nuevas para `CLAUDE.md` (al implementar cada fase)

- `GET /notificaciones`, `GET /notificaciones/conteo-no-leidas`,
  `PATCH /notificaciones/:id/leido` (Fase 14).
- `POST/GET/PATCH/DELETE /eventos`, `GET /eventos?desde=&hasta=` (Fase 15).
- `POST /internal/recordatorios/ejecutar` — guard `InternalJobGuard` por header secreto,
  fuera de `SedeGuard`/`RolesGuard` (segunda ruta sin JWT de Supabase después de las de
  plataforma y `GET /`).
- `POST/GET/DELETE /avisos`, `GET /avisos/:id`, `GET /avisos/:id/recibos` (Fase 16).
- Tabla "CRUD por tipo de entidad": `EventoCalendario` → "CRUD completo";
  `Aviso` + `Notificacion` + `RecordatorioEnviado` → "Negocio (no CRUD)".
- Enum `AlcanceDestino` (`SEDE`/`CARRERA`/`GRUPO`) compartido entre eventos y avisos.
- Env vars nuevas: `INTERNAL_JOB_SECRET`, `RECORDATORIOS_HABILITADO`.

## Ejecución

Cada fase (14, 15, 16, 17) abre su propio ciclo Subagent-Driven Development con spec de día
+ plan cuando se llegue a ella. El orden es estricto: 14 → 15 → 16 → 17 (14 es
prerrequisito de 15 y 16; 17 depende de las tres). El helper `validarAlcancePublicacion` +
`resolverDestinatarios` se construye en la Fase 15 (Día 41) y la Fase 16 lo reutiliza sin
reimplementar.
