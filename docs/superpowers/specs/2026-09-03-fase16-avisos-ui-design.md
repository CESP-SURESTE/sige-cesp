# Fase 16 — Avisos: UI (Días 47-48) + `abiertoEn`

**Fecha:** 2026-09-03
**Fase:** 16 — Avisos y mensajes
**Alcance:** Días 47 y 48 juntos (cierra la Fase 16).
**Precede:** backend de Fase 16 (Días 45-46) ya cerrado en `dev` y pusheado
(`282a9ac..dfdf9c4`). Ver `CLAUDE.md` raíz, sección "Contrato de API", entradas
`POST/GET/GET :id/GET :id/recibos/DELETE /avisos`.

---

## 1. Objetivo

Dar interfaz al módulo de avisos, ya funcional en backend:

- **Publicación** (admin + maestro): crear un aviso, ver la tabla de los que publiqué
  con "X de Y leídos", abrir el detalle de recibos, eliminar.
- **Recepción** (los 3 roles): feed de avisos que me llegaron, abrir uno (marca el
  recibo de lectura).
- **Deep-link**: click en una notificación `tipo: AVISO` de la campana (Fase 14) abre
  el aviso correspondiente.

Al cierre: tachar Días 47-48 y **Fase 16** en `docs/roadmap.md`.

---

## 2. Cambio de modelo: `Notificacion.abiertoEn`

### Problema

El recibo de lectura de un aviso es `Notificacion.leidoEn` de la fila `tipo: AVISO` de
cada destinatario — la **misma** columna que marca la campana `NotificacionesBell`
(Fase 14) vía `PATCH /notificaciones/:id/leido`. Hoy, descartar la notificación desde la
campana "sella" el recibo sin que la persona haya abierto el aviso, y
`GET /avisos/:id/recibos` lo reporta como leído. El reporte de recibos pierde fidelidad.

### Solución

Columna nueva `abiertoEn` en `Notificacion`, separada de `leidoEn`:

```prisma
model Notificacion {
  // ...campos actuales sin cambio...
  leidoEn    DateTime? @map("leido_en")    // ya existe — "visto/descartado desde la campana"
  abiertoEn  DateTime? @map("abierto_en")  // NUEVO, nullable — "abrió el aviso de verdad"
}
```

- **Invariante**: `abiertoEn != null` ⟹ `leidoEn != null`. Abrir un aviso
  (`GET /avisos/:id`) sella **ambos** timestamps (cada uno solo si estaba `null`).
  Descartar desde la campana sella **solo** `leidoEn`. Nunca al revés.
- `abiertoEn` **no** entra en el conteo del badge de la campana
  (`GET /notificaciones/conteo-no-leidas` sigue contando `leidoEn IS NULL`), **no**
  cambia la RLS, **no** se audita (regla 5 no aplica — estado de entrega derivado, mismo
  criterio que el resto de `Notificacion`).
- Solo lo consumen: el reporte de recibos y el feed de avisos (ver §3).

### Migración

`prisma migrate dev` está roto en el repo (`P3006`, shadow-DB Supabase). Generar con
`prisma migrate diff` + aplicar con `prisma migrate deploy`, mismo procedimiento que las
migraciones de Fases 12-16. Nombre: `<timestamp>_notificacion_abierto_en`. Es un `ADD
COLUMN ... NULL` puro (sin default, sin backfill — las filas viejas quedan con
`abiertoEn = NULL`, que es semánticamente correcto: "no consta que se haya abierto").
Se suma al backlog de migraciones pendientes de correr en prod.

---

## 3. Backend

### 3.1 `GET /avisos/publicados?page=&limit=` (nuevo)

Vista de gestión: los avisos que **publicó el actor**, con contadores de lectura.

- **Ruta**: declarada en `AvisosController` **antes** de `GET /avisos/:id` (segmento fijo
  gana al `:id` dinámico — mismo precedente que `GET /personas/resumen`,
  `GET /platform-admin/resumen`, `GET /eventos/listado`).
- **Guards**: `SedeGuard` (clase) + `RolesGuard` + `@Roles(ADMINISTRATIVO, MAESTRO)` a
  nivel de método (los mismos roles que pueden `POST /avisos`; un `ALUMNO` →
  `403 ROL_NO_AUTORIZADO`).
- **Filtro**: `where: { autorUsuarioId: <actor>, sedeId: <@SedeActual()> }`. `sedeId`
  SIEMPRE del JWT, nunca de query (regla 2).
- **Orden**: `createdAt desc`.
- **Paginación**: `page` (default 1, entero ≥ 1), `limit` (default 20, entero 1-100);
  fuera de rango → `400 VALIDATION_ERROR` (sin código nuevo). Mismo shape que el resto de
  listas paginadas de la API.
- **Éxito**: `200 { data: AvisoPublicadoItem[], page, limit, total }`.

```ts
interface AvisoPublicadoItem {
  id: string;
  titulo: string;
  alcanceTipo: 'SEDE' | 'CARRERA' | 'GRUPO';
  alcanceId: string | null;
  alcanceNombre: string;   // 'Toda la sede' | nombre de carrera | nombre de grupo
  createdAt: string;       // ISO 8601
  total: number;           // # de Notificacion tipo:AVISO de este aviso (snapshot al publicar)
  leidos: number;          // # de esas con abiertoEn != null
}
```

- `total`/`leidos` se resuelven en **batch** para todo el page con un `groupBy` sobre
  `Notificacion` (`referenciaId in [ids del page]`, `tipo: 'AVISO'`), no una query por
  fila (sin N+1). `leidos` = `count` con `abiertoEn: { not: null }`.
- `alcanceNombre` se resuelve en batch por tipo (los `SEDE` son constante; los `CARRERA`
  un `findMany` de `Carrera`; los `GRUPO` un `findMany` de `Grupo`) — mismo criterio que
  `EventoListadoItem.alcanceNombre` (`CalendarioService`). Nunca persistido (regla 1).
- Sin código de error nuevo.

### 3.2 Ajustes a endpoints de avisos existentes

| Método (`AvisosService`) | Cambio |
|---|---|
| `verDetalleYMarcarLeido` (`GET /avisos/:id`) | Además de `leidoEn`, sella `abiertoEn = now()` (si estaba `null`). El `update` pasa a setear ambos campos en una sola escritura cuando `leidoEn` o `abiertoEn` son `null`. Sigue idempotente (2ª llamada no mueve nada). El `FeedItem` que devuelve expone `abiertoEn` en vez de `leidoEn` (ver abajo). |
| `obtenerRecibos` (`GET /avisos/:id/recibos`) | `leidos` / `noLeidos` se calculan contra `abiertoEn` (no `leidoEn`). `ReciboItem.leidoEn` se renombra a `ReciboItem.abiertoEn` (el `select` de `Notificacion` pide `abiertoEn`). El resto igual (autor o `ADMINISTRATIVO` de la sede; snapshot de destinatarios; orden por `nombreCompleto`). |
| `feedDelActor` (`GET /avisos`) | `FeedItem.leidoEn` se renombra a `FeedItem.abiertoEn` y sale del `abiertoEn` de la `Notificacion` del actor (el feed responde "¿ya abrí este aviso?", no "¿lo descarté de la campana?"). El `select`/`Map` interno pasa de `leidoEn` a `abiertoEn`. |

`DELETE /avisos/:id`: sin cambios (borra las `Notificacion` en cascada; `abiertoEn` se
va con la fila).

Shapes finales de los tipos compartidos del service (para `lib/api/avisos.ts`):

```ts
interface FeedItem {                 // GET /avisos y GET /avisos/:id
  id, titulo, cuerpo,
  autor: { nombres, apellidoPaterno },
  createdAt,
  abiertoEn: Date | null;           // era leidoEn
}
interface ReciboItem {              // dentro de GET /avisos/:id/recibos
  usuarioId, nombreCompleto, rol,
  abiertoEn: Date | null;           // era leidoEn
}
```

### 3.3 e2e (`test/avisos.e2e-spec.ts`, extender la suite existente)

Casos nuevos / ajustados:

- `GET /avisos/publicados`:
  - solo lista avisos cuyo `autorUsuarioId` es el actor (publica 2 con actor A, 1 con
    actor B → A ve 2, B ve 1).
  - `total` = # de destinatarios del fan-out; `leidos` sube tras un `GET /avisos/:id` de
    un destinatario y **no** sube tras un `PATCH /notificaciones/:id/leido` (descartar en
    campana).
  - `alcanceNombre` correcto para los 3 tipos de alcance.
  - paginación (`page`/`limit` fuera de rango → 400).
  - `ALUMNO` → `403 ROL_NO_AUTORIZADO`.
  - aislamiento cross-sede: actor de sede 1 no ve avisos de sede 2 ni aunque los haya
    "publicado" un homónimo.
- `GET /avisos/:id` sella `abiertoEn` **y** `leidoEn`; 2ª llamada no mueve ninguno.
- `GET /avisos/:id/recibos`: `leidos` cuenta `abiertoEn`; un destinatario que solo
  descartó la notificación en la campana aparece como **no leído** en recibos.
- `afterAll` acotado a los ids reales creados por la corrida (regla 14) — nunca por
  patrón de email/nombre.

---

## 4. Frontend

### 4.1 Cliente compartido `lib/api/avisos.ts` (nuevo)

Espejo de `AvisosService`, sync a mano (mismo criterio que `lib/api/calendario.ts` /
`lib/api/notificaciones.ts`; regla 11 aplica a componentes, no a `lib/api/*`).

```ts
// tipos
type AlcanceDestino = 'SEDE' | 'CARRERA' | 'GRUPO';
interface CrearAvisoInput { titulo: string; cuerpo: string; alcanceTipo: AlcanceDestino; alcanceId?: string; }
interface AvisoPublicadoItem { id; titulo; alcanceTipo; alcanceId; alcanceNombre; createdAt; total; leidos; }
interface FeedItemAviso { id; titulo; cuerpo; autor: { nombres; apellidoPaterno }; createdAt; abiertoEn: string | null; }
interface ReciboAviso { total; leidos; noLeidos; destinatarios: { usuarioId; nombreCompleto; rol; abiertoEn: string | null }[]; }

// funciones
publicarAviso(input: CrearAvisoInput): Promise<{ id: string }>          // POST /avisos
listarAvisosPublicados({ page, limit }): Promise<ApiListaPaginada<AvisoPublicadoItem>>  // GET /avisos/publicados
listarFeedAvisos({ page, limit }): Promise<ApiListaPaginada<FeedItemAviso>>             // GET /avisos
verAviso(id: string): Promise<FeedItemAviso>                            // GET /avisos/:id (sella recibo)
obtenerRecibos(id: string): Promise<ReciboAviso>                        // GET /avisos/:id/recibos
eliminarAviso(id: string): Promise<{ ok: true }>                        // DELETE /avisos/:id
```

### 4.2 `app/admin/avisos/` — publicación + recepción (admin)

Árbol admin, calcado de `app/admin/calendario/page.tsx` (card de encabezado + React
Query + botón que abre modal; regla 13).

**`page.tsx`** — toggle de dos pestañas (estado local `vista: 'publicados' | 'recibidos'`,
default `'publicados'`):

- **Publicados**: tabla de `listarAvisosPublicados` — columnas *Título · Alcance
  (`alcanceNombre`) · Fecha · "X de Y leídos"*. Botón "+ Nuevo aviso" → `AvisoModal`.
  Paginación como `app/admin/grupos/page.tsx`. Fila → `RecibosModal`. Botón "Eliminar" por
  fila → `ConfirmarEliminarAvisoModal`. Estados carga / error / vacío.
- **Recibidos**: feed de `listarFeedAvisos` — item con título, autor
  (`Nombres ApellidoPaterno`), fecha, punto "nuevo" si `abiertoEn === null`. Click →
  `DetalleAvisoModal`. Paginado. Estados carga / error / vacío.

**`AvisoModal.tsx`** — solo alta (no hay `PATCH /avisos`). Campos:

- *Título* (`<input>` requerido).
- *Cuerpo* (`<textarea>` requerido).
- **Bloque de alcance**, idéntico al de `app/admin/calendario/EventoModal.tsx`: `<Select>`
  tipo (`SEDE` / `CARRERA` / `GRUPO`) + `<Select>` dependiente — carreras de
  `listarCarreras()` (`enabled` si tipo `CARRERA`), grupos de `listarGrupos({ limit: 100 })`
  (`enabled` si tipo `GRUPO`). `alcanceId` requerido si tipo ≠ `SEDE`.

Se limpia al cerrar (cancelar o éxito). Al éxito: `toast.success` + invalidar
`['avisos','publicados']` + cerrar.

**`RecibosModal.tsx`** — solo lectura. `obtenerRecibos(id)`. Muestra contador
`leidos / total` + tabla de `destinatarios` (nombre, rol, y `abiertoEn ? '✓ <fecha>' :
'— sin leer'`). Cierra con botón / Escape / click fuera (mismo micro-patrón que el
dropdown de la campana).

**`ConfirmarEliminarAvisoModal.tsx`** — patrón `ConfirmarEliminarEventoModal.tsx`
(título del aviso + Cancelar / Eliminar). Al éxito: `toast` + invalidar
`['avisos','publicados']`.

**Navegación**: link nuevo `{ href: '/admin/avisos', label: 'Avisos', Icon: IconAvisos,
match: 'prefijo' }` en `NAV_PRINCIPAL` de `components/admin/ui/shell/Sidebar.tsx`, tras
"Calendario". `IconAvisos` nuevo en `components/admin/ui/shell/icons` (megáfono / bocina,
mismo estilo de trazo que los demás).

### 4.3 `app/maestro/avisos/` — publicación + recepción (maestro)

Árbol maestro propio (regla 11), calcado de `app/maestro/calendario/`. Copias **locales**
de `RecibosModal.tsx`, `ConfirmarEliminarAvisoModal.tsx` y `DetalleAvisoModal.tsx` (no se
comparten entre árboles, igual que los modales de calendario).

**`page.tsx`** — mismo toggle Publicados / Recibidos que admin.
`listarAvisosPublicados` ya filtra por `autorUsuarioId`, así que el maestro solo ve los
suyos sin lógica extra.

**`AvisoModal.tsx`** — alcance **fijo a `GRUPO`** (el backend ya rechaza `SEDE`/`CARRERA`
de un maestro). Sin `<Select>` de tipo de alcance; un solo `<Select>` de grupo alimentado
de `GET /perfil/asignaciones` vía `gruposUnicosDeAsignaciones(...)`, copiado de
`app/maestro/calendario/EventoModal.tsx`. Estados carga / error / vacío ("no tienes
grupos asignados; pídele a un administrativo que te asigne materias en un grupo").

**Navegación**: tercer link "Avisos" en `NavMaestro`
(`components/maestro/ui/shell/Header.tsx`), junto a "Mi perfil" / "Calendario".
`enAvisos = pathname.startsWith('/maestro/avisos')`.

### 4.4 `app/alumno/avisos/` — recepción (alumno)

Árbol alumno propio, calcado de `app/alumno/calendario/`. **Solo** el feed "Recibidos"
(el alumno no publica — no hay pestaña ni `AvisoModal`).

**`page.tsx`** — feed de `listarFeedAvisos` (paginado, `createdAt desc`). Item: título,
autor, fecha, punto "nuevo" si `abiertoEn === null`. Click → `DetalleAvisoModal`.

**`DetalleAvisoModal.tsx`** (una copia por árbol que lo use — admin, maestro, alumno) —
al montarse dispara `verAviso(id)` (`GET /avisos/:id`, que sella `abiertoEn` + `leidoEn`).
Muestra título, autor, fecha, cuerpo completo. Al cerrar: invalida `['avisos','feed']`,
`['avisos','publicados']` (por si el actor tiene ambas vistas) y `['notificaciones']`
(para que el badge de la campana baje al instante).

**Navegación**: tercer link "Avisos" en `NavAlumno`
(`components/alumno/ui/shell/Header.tsx`).

### 4.5 Deep-link de la campana (`tipo: AVISO`) — los 3 árboles

En los 3 `NotificacionesBell.tsx` (`components/{admin,alumno,maestro}/ui/shell/`),
`onClickItem(n)`:

```ts
if (n.tipo === 'AVISO') {
  setAbierto(false);
  router.push(`${BASE}/avisos?aviso=${encodeURIComponent(n.referenciaId)}`); // BASE = '/admin' | '/maestro' | '/alumno'
  return;
}
// resto de tipos (RECORDATORIO_EVENTO, EVENTO_NUEVO): marcarLeida(n.id) como hoy
```

(usa `useRouter` de `next/navigation`, aún no importado en el componente).

Cada `page.tsx` de `/avisos` lee `?aviso=<id>` de `searchParams`:

- si está presente: en admin/maestro fuerza `vista = 'recibidos'`; en los 3, abre
  `DetalleAvisoModal` para ese id. Al cerrar el modal, limpia el query param
  (`router.replace(BASE + '/avisos')`) para que un refresh no lo reabra.
- toda notificación `tipo: AVISO` del actor es de un aviso **recibido** (el autor se
  excluye del fan-out), así que el detalle siempre existe para él → `GET /avisos/:id`
  no da 404.

Esto resuelve la memoria `sige-notificacion-sin-deeplink` **para avisos**. Los tipos
`RECORDATORIO_EVENTO` / `EVENTO_NUEVO` siguen sin deep-link (otra fase).

---

## 5. QA y verificación

- **`pnpm build` + `pnpm lint`** limpios en frontend (los 3 árboles). Sin suite de
  componentes (el proyecto no tiene una).
- **Backend**: suite `avisos` e2e ampliada en verde + regresión e2e completa en verde +
  `pnpm build` limpio.
- **Agentes QA** (auditan, consignan veredicto en `ESTADO.md`, no corrigen):
  - `qa-backend` — `GET /avisos/publicados`, cambio de schema, ajustes de shape,
    aislamiento cross-sede, contrato de API, reglas 1/2/5/12.
  - `qa-admin` — `app/admin/avisos/*` + deep-link de la campana admin + `Sidebar`.
  - `qa-alumno` — `app/alumno/avisos/*` y `app/maestro/avisos/*` + deep-links +
    `NavAlumno` / `NavMaestro`.
- **Verificación manual en navegador** (la hace el agente vía Claude in Chrome — mismo
  criterio que el cierre de Fase 14): admin publica un aviso a `SEDE` → maestro y alumno
  lo ven en su feed "Recibidos" y en la campana → abren el `DetalleAvisoModal` → el
  admin ve "1 de N leídos" (luego "2 de N") en `RecibosModal`; descartar la notificación
  desde la campana **no** incrementa el contador de recibos; el badge de la campana baja
  al abrir el aviso.

---

## 6. Migraciones pendientes de prod (actualizado)

Se suma `<timestamp>_notificacion_abierto_en` a la cola acumulada:
art. 53 · `grupo_materia_maestro` · `notificaciones` · `notificaciones_cascade_e_indice`
· `_calendario` · `evento_nuevo_tipo_notificacion` · `_avisos` ·
`_notificaciones_referencia_id_index` · **`_notificacion_abierto_en`**.

(Todas se corren juntas en el Día 50 — Fase 17 — o antes si hay un redeploy intermedio.)

---

## 7. Cierre

- Tachar **Días 47-48** y **Fase 16** en `docs/roadmap.md` (mover el puntero: siguiente
  es la Fase 13 reubicada — datos reales de CESP —, que sigue pausada por falta de datos;
  después la Fase 17).
- Actualizar `documentacion_de_agentes/ESTADO.md` (entrada Fase 16: cerrar los 2
  bloqueantes del Día 47, marcar Días 47-48).
- Actualizar la línea "Fase actual" de `CLAUDE.md` raíz + las entradas de "Contrato de
  API" (`GET /avisos/publicados` nuevo; `abiertoEn` en el shape de `Notificacion`,
  `FeedItem`, `ReciboItem`).
- Añadir entrada a `CLAUDE.md` §"Variables de entorno" — **ninguna nueva** (avisos no
  introduce env vars).

---

## 8. Ejecución

Subagent-Driven Development (preferencia registrada: `preferencia-subagentes-siempre`).
Tasks tentativos (el plan detallado los fija):

1. **Backend**: `abiertoEn` (schema + migración `diff`/`deploy`) + `GET /avisos/publicados`
   + ajustes de shape en `verDetalleYMarcarLeido` / `obtenerRecibos` / `feedDelActor` +
   e2e ampliada.
2. **`lib/api/avisos.ts`** + verificación de que los tipos casan con el backend.
3. **`app/admin/avisos/`** — page (toggle), `AvisoModal`, `RecibosModal`,
   `ConfirmarEliminarAvisoModal`, `DetalleAvisoModal`, `IconAvisos`, link en `Sidebar`.
4. **`app/maestro/avisos/`** — page (toggle), `AvisoModal` (alcance fijo GRUPO), copias
   locales de los modales, link en `NavMaestro`.
5. **`app/alumno/avisos/`** — page (solo feed), `DetalleAvisoModal`, link en `NavAlumno`.
6. **Deep-link de la campana** en los 3 `NotificacionesBell.tsx` + lectura de
   `?aviso=<id>` en los 3 `page.tsx`.
7. **Review final de rama** (Opus) + fix wave + docs (`roadmap.md`, `ESTADO.md`,
   `CLAUDE.md`) + verificación manual en navegador.

---

## 9. Fuera de alcance (explícito)

- `PATCH /avisos/:id` — un aviso publicado no se edita, se borra y se re-publica (mismo
  criterio que la ausencia de `PATCH` en el backend de Días 45-46).
- Deep-link para `RECORDATORIO_EVENTO` / `EVENTO_NUEVO` desde la campana — sigue siendo
  `marcarLeida`.
- Sección "Avisos" apilada en `app/alumno/page.tsx` / `app/maestro/page.tsx` — se
  descartó a favor de ruta propia `app/{rol}/avisos/` (decisión 2026-09-03).
- Backfill de `abiertoEn` para notificaciones viejas — quedan `NULL`, correcto.
- Purga / retención de `notificaciones` — diferido a Fase 17.
- Unificar helpers de correo/nombres (`obtenerCorreosPersonales`, `resolverNombres*`) —
  diferido a Fase 17.
- Paginación infinita / "cargar más" en los feeds — paginación clásica como el resto de
  la app.
