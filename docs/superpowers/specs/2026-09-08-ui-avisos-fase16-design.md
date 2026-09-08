# Fase 16, Días 47-48 — UI de Avisos (diseño)

**Fecha:** 2026-09-08
**Estado:** aprobado, pendiente de plan de implementación
**Fase:** 16 (Avisos y mensajes). Backend Días 45-46 ya cerrado en código
(`AvisosController` + `AvisosService`, migración `20260903125735_avisos`, e2e 26/26).

## Objetivo

Construir la UI de **publicación** (admin + maestro) y **recepción** (los 3 roles) de
avisos, sobre el backend ya existente. Broadcast de una vía con recibo de lectura; sin
mensajería bidireccional. Cerrar la Fase 16.

## Contexto del backend existente (no se re-discute)

Endpoints ya construidos en `App/backend/src/avisos/`:

- `POST /avisos` — `@Roles(ADMINISTRATIVO, MAESTRO)`. Body `CrearAvisoDto`:
  `{ titulo (≤160), cuerpo (≤5000), alcanceTipo: 'SEDE'|'CARRERA'|'GRUPO', alcanceId? (UUID) }`.
  `validarAlcancePublicacion` en el service: admin → SEDE/CARRERA/GRUPO de su sede sin
  jerarquía de `nivelPermiso`; maestro → solo GRUPO donde tiene fila en
  `GrupoMateriaMaestro`; alcance malformado → `400 VALIDATION_ERROR`; `alcanceId`
  inexistente/de otra sede → `404 NOT_FOUND`; maestro fuera de su alcance →
  `403 ROL_NO_AUTORIZADO`. → `201 { data: Aviso }`.
- `GET /avisos?page=&limit=` — los 3 roles (sin `@Roles`). **Feed de RECIBIDOS** del
  actor (join contra sus `Notificacion` `tipo: AVISO`). `200 { data: FeedItem[], page,
  limit, total }`, `FeedItem = { id, titulo, cuerpo, autor: { nombres, apellidoPaterno },
  createdAt, leidoEn }`. Orden `createdAt desc`.
- `GET /avisos/:id/recibos` — autor o `ADMINISTRATIVO` de la sede; otro → `403`. Aviso de
  otra sede → `404`. `200 { data: { total, leidos, noLeidos, destinatarios: { usuarioId,
  nombreCompleto, rol, leidoEn }[] } }`. `destinatarios` ordenado por `nombreCompleto`.
- `GET /avisos/:id` — los 3 roles. Devuelve `FeedItem` y marca la `Notificacion` del actor
  como leída (`leidoEn = now()` si era null) — ESTO es el recibo. Idempotente. Actor no
  destinatario → `404`.
- `DELETE /avisos/:id` — `@Roles(ADMINISTRATIVO, MAESTRO)` + service exige autor o
  `ADMINISTRATIVO` de la sede. Otra sede → `404`. DELETE real + `deleteMany` de sus
  `Notificacion` + audita `ELIMINACION`. `200 { data: { ok: true } }`.

`Notificacion` `tipo: AVISO` ya fluye a las 3 campanas (`NotificacionesBell`) desde la
Fase 14 — no se toca.

## Cambio 1 — Backend: `GET /avisos/publicados` (endpoint nuevo)

El único gap: no hay forma de listar los avisos que el actor **publicó** (los necesita la
tabla de gestión del Día 47 + su vista de recibos). `GET /avisos` es el feed de recibidos.

- **Ruta:** `GET /avisos/publicados?page=&limit=` en `AvisosController`. Declarada **antes**
  de `GET /avisos/:id` (convención específico→genérico del repo — ver `/avisos/:id/recibos`
  ya declarado antes de `/avisos/:id`, y `/eventos/listado` antes de `/eventos`).
- **Guards:** `SedeGuard` (clase, ya está) + `RolesGuard`; `@Roles(ADMINISTRATIVO,
  MAESTRO)` por método. `sedeId` de `@SedeActual()`, `autorUsuarioId` de
  `@ActorUsuarioId()`.
- **Query:** reusa `ListarAvisosQueryDto` (`page` default 1, `limit` default 20, máx 100;
  fuera de rango → `400 VALIDATION_ERROR`).
- **Lógica** (`AvisosService.listarPublicadosPorActor`):
  - `where = { sedeId, autorUsuarioId }`, `orderBy: { createdAt: 'desc' }`, `skip`/`take`.
  - `total` con `count` del mismo `where`.
  - Para los avisos de la página: resolver en **batch** (sin N+1):
    - `alcanceNombre`: `'Toda la sede'` si `alcanceTipo === 'SEDE'`; si `CARRERA` →
      `Carrera.nombre` por `alcanceId`; si `GRUPO` → `Grupo.nombre` por `alcanceId`. Un
      `alcanceId` que ya no existe (carrera/grupo borrado) → `alcanceNombre: null`
      (defensivo, no rompe la tabla).
    - `totalDestinatarios` / `leidos`: `Notificacion.groupBy` (o dos `count`) sobre
      `{ tipo: 'AVISO', referenciaId: { in: avisoIds } }`, `leidos` = las que tienen
      `leidoEn != null`.
  - Envolver todo en `try/catch` con `console.error` completo antes de re-lanzar
    (regla 12).
- **Shape:** `200 { data: AvisoPublicadoItem[], page, limit, total }` con
  `AvisoPublicadoItem = { id, titulo, cuerpo, alcanceTipo, alcanceId, alcanceNombre,
  createdAt, totalDestinatarios, leidos }`.
- **Sin códigos de error nuevos.**
- **e2e** (añadidos a `avisos.e2e-spec.ts`):
  1. Autor A ve solo sus avisos; un aviso publicado por autor B de la misma sede NO
     aparece en el listado de A.
  2. Aislamiento cross-sede: aviso de otra sede nunca aparece.
  3. `totalDestinatarios`/`leidos` correctos tras publicar a un grupo y que 1 de N
     destinatarios abra `GET /avisos/:id`.
  4. `alcanceNombre` correcto para SEDE / CARRERA / GRUPO.
  5. `ALUMNO` → `403 ROL_NO_AUTORIZADO`.
  6. `page`/`limit` fuera de rango → `400 VALIDATION_ERROR`.

## Cambio 2 — Frontend: API client compartido

`App/frontend/src/lib/api/avisos.ts` (nuevo). `lib/api/` es infraestructura compartida
entre árboles en este repo (`calendario.ts`, `perfil.ts`, etc. ya lo son — la regla 11
aplica a `app/` y `components/`, no a `lib/api/`). Funciones + tipos:

- `publicarAviso(input: { titulo, cuerpo, alcanceTipo, alcanceId? }): Promise<Aviso>`
- `listarAvisosPublicados(params: { page?, limit? }): Promise<Paginado<AvisoPublicadoItem>>`
- `obtenerFeedAvisos(params: { page?, limit? }): Promise<Paginado<AvisoFeedItem>>`
- `obtenerDetalleAviso(id: string): Promise<AvisoFeedItem>` — marca leído (efecto backend)
- `obtenerRecibosAviso(id: string): Promise<RecibosAviso>`
- `eliminarAviso(id: string): Promise<{ ok: true }>`

Tipos: `Aviso`, `AvisoPublicadoItem`, `AvisoFeedItem`, `RecibosAviso`,
`DestinatarioRecibo`, `AlcanceTipo`. Usa el helper `http.ts` como el resto de `lib/api/`.

## Cambio 3 — Árbol admin: `app/admin/avisos/`

Estructura de archivos:

```
app/admin/avisos/
  page.tsx                        -- 2 tabs: Publicados (default) / Recibidos
  NuevoAvisoModal.tsx             -- alta (regla 13: modal, un botón "+ Nuevo aviso")
  RecibosModal.tsx               -- reporte de recibos de un aviso
  DetalleAvisoModal.tsx          -- detalle de un aviso recibido (dispara GET /avisos/:id)
  ConfirmarEliminarAvisoModal.tsx -- calco de ConfirmarEliminarEventoModal
```

### `page.tsx`

- Estado de tab local (`useState<'publicados' | 'recibidos'>('publicados')`), sin
  query param (mismo criterio ligero que el resto del proyecto).
- **Tab Publicados:**
  - `useQuery(['admin', 'avisos', 'publicados', page])` → `listarAvisosPublicados`.
  - Tabla: columnas **Título · Alcance · Fecha · Leídos / N · (acciones)**.
    `Alcance` muestra `alcanceNombre` con un prefijo del tipo (p. ej. "Grupo: 3-A",
    "Carrera: Enfermería", "Toda la sede"). `Leídos / N` = `${leidos} / ${totalDestinatarios}`.
  - Botón **"+ Nuevo aviso"** arriba de la tabla → abre `NuevoAvisoModal`.
  - Acciones por fila: **"Ver recibos"** → `RecibosModal`; **"Eliminar"** →
    `ConfirmarEliminarAvisoModal`.
  - Paginación con el patrón ya usado en `app/admin/grupos/page.tsx`.
  - Estados de carga (`SkeletonTableRows`), error (regla 12 — `console.error` en el
    `queryFn` + fila de error en la tabla), y vacío ("Todavía no has publicado avisos").
- **Tab Recibidos:**
  - `useQuery(['admin', 'avisos', 'feed', page])` → `obtenerFeedAvisos`.
  - Lista/tabla: **Título · Autor · Fecha**, con indicador visual de no-leído
    (`leidoEn === null`).
  - Click en una fila → `DetalleAvisoModal` con ese `id`. El modal, al montar, hace
    `useQuery(['admin','avisos','detalle',id])` → `obtenerDetalleAviso` (marca leído en
    backend). Al cerrar, `invalidateQueries(['admin','avisos','feed'])` para refrescar el
    indicador de no-leído.

### `NuevoAvisoModal.tsx`

- Campos: `titulo` (input, ≤160), `cuerpo` (textarea, ≤5000), **bloque de alcance**:
  - `<select>` `alcanceTipo`: `SEDE` | `CARRERA` | `GRUPO`.
  - Si `CARRERA`: `<select>` de carreras (`useQuery(['admin','carreras'])` →
    `listarCarreras()` — ya existe).
  - Si `GRUPO`: `<select>` de grupos (`useQuery` → `listarGrupos()` sin paginar o con
    `limit` alto — ya existe `GET /grupos`). Nunca texto libre (mismo criterio que el
    filtro de salón en grupos).
  - Si `SEDE`: sin `alcanceId`.
- Validación cliente mínima: título/cuerpo no vacíos, `alcanceId` presente cuando el tipo
  lo exige. El backend es la autoridad; los errores (`resolverMensajeError`, patrón de
  `app/admin/emergencia/page.tsx`) se muestran como `toast`.
- `useMutation` → `publicarAviso`. `onSuccess`: `toast.success`, cerrar modal, limpiar
  campos, `invalidateQueries(['admin','avisos','publicados'])`.
- Cumple regla 13: los campos se limpian al cerrar (cancelar o guardar OK).

### `RecibosModal.tsx`

- `useQuery(['admin','avisos','recibos',id])` → `obtenerRecibosAviso`.
- Encabezado: **`{leidos} / {total} leyeron`** (+ `noLeidos` si ayuda). Lista de
  `destinatarios`: **nombre · rol · estado** ("Leído {fecha}" / "Sin leer"). Ya viene
  ordenada del backend.

### `DetalleAvisoModal.tsx`

- Título, cuerpo (respeta saltos de línea), autor ("{nombres} {apellidoPaterno}"), fecha.
- Loading/error estándar.

### `ConfirmarEliminarAvisoModal.tsx`

- Calco de `app/admin/calendario/ConfirmarEliminarEventoModal.tsx`. `useMutation` →
  `eliminarAviso`. `onSuccess`: `toast`, cerrar, `invalidateQueries(['admin','avisos','publicados'])`.

### Navegación

- `components/admin/ui/shell/Sidebar.tsx`: nuevo item
  `{ href: '/admin/avisos', label: 'Avisos', Icon: IconAvisos, match: 'prefijo' }`.
  Posición: después de "Calendario", antes de "Administrativos".
- `IconAvisos` nuevo en `components/admin/ui/shell/icons.tsx` (SVG inline — **megáfono**;
  la campana ya la usa `NotificacionesBell`).

## Cambio 4 — Árbol maestro: `app/maestro/avisos/`

Misma estructura de `page.tsx` + 4 modales, **duplicada dentro del árbol maestro**
(regla 11 — sin imports desde `app/admin/` ni `components/admin/`). Diferencias respecto
a admin:

- **`NuevoAvisoModal`:** el maestro solo publica a **GRUPO**. No hay `<select>` de
  `alcanceTipo` — se muestra una etiqueta fija "Alcance: Grupo" y `alcanceTipo: 'GRUPO'`
  va hardcodeado en el submit. El `<select>` de grupos sale de
  `useQuery(['maestro','asignaciones'])` → `obtenerAsignaciones()` (`GET
  /perfil/asignaciones`, ya existe — devuelve los grupos del maestro). Si el maestro no
  tiene grupos asignados, el botón "+ Nuevo aviso" se deshabilita con un hint.
- **Tab Recibidos:** idéntico a admin (mismo `obtenerFeedAvisos`).
- **Tab Publicados / recibos / eliminar:** idénticos (mismos endpoints; el backend ya
  restringe por autor).
- Navegación: link **"Avisos"** agregado a `NavMaestro` en
  `components/maestro/ui/shell/Header.tsx` (patrón de los links "Mi perfil"/"Calendario",
  con `enAvisos = pathname.startsWith('/maestro/avisos')`).

Componentes de UI locales al árbol maestro (`components/maestro/ui/`) donde aplique
(skeleton, etc.), como ya hace el resto de `app/maestro/`.

## Cambio 5 — Árbol alumno: `app/alumno/avisos/`

El alumno **solo recibe**. Estructura:

```
app/alumno/avisos/
  page.tsx              -- solo feed de recibidos, paginado
  DetalleAvisoModal.tsx -- propio del árbol alumno
```

- `page.tsx`: `useQuery(['alumno','avisos','feed',page])` → `obtenerFeedAvisos`. Lista por
  fecha con indicador de no-leído. Click → `DetalleAvisoModal` (dispara `GET /avisos/:id`,
  marca leído; al cerrar invalida el feed).
- Navegación: link **"Avisos"** agregado a `NavAlumno` en
  `components/alumno/ui/shell/Header.tsx` (`enAvisos = pathname.startsWith('/alumno/avisos')`).

## Fuera de alcance (decisiones explícitas)

- **Deep-link desde `NotificacionesBell`**: al hacer click en una notificación `tipo:
  AVISO` no se navega al detalle. La campana sigue como hoy. (Idea diferida, anotada en
  memoria.)
- **Sub-rutas `/avisos/[id]`**: el detalle es siempre modal (patrón del proyecto).
- **Edición de avisos**: el backend no tiene `PATCH /avisos/:id` y nadie lo pidió.
  Corregir = eliminar y volver a publicar.
- **Recepción para admin como "sección apilada"**: el admin ve recibidos en el tab
  "Recibidos" de `app/admin/avisos/`, no en otra pantalla.

## Cierre de fase

- QA ligeros `qa-admin` + `qa-alumno` (el árbol maestro lo cubre `qa-alumno`, que ya
  mantiene alumno+maestro) → consignan veredicto en `documentacion_de_agentes/ESTADO.md`.
- Tachar **Fase 16** en `docs/roadmap.md` + actualizar la línea "Fase actual" de
  `CLAUDE.md` raíz.
- Migración: `20260903125735_avisos` ya está en el backlog de migraciones pendientes de
  prod desde el Día 45 — este trabajo no agrega migraciones nuevas.

## Verificación

- Backend: `avisos` e2e (los 6 casos nuevos + regresión de la suite), `nest build` limpio.
- Frontend: `pnpm build` + `pnpm lint` limpios en los 3 árboles.
- Manual (usuario): admin publica a un grupo → alumno de ese grupo lo ve en
  `/alumno/avisos`, lo abre → admin ve el recibo con hora en `RecibosModal`. Maestro
  publica a su grupo. Admin elimina un aviso → desaparece del alumno.

## Patrones del repo que este trabajo sigue

- Regla 11: árboles `app/{admin,maestro,alumno}` independientes, modales duplicados por
  árbol, sin imports cruzados.
- Regla 13: pantalla CRUD de admin = tabla + botón que abre modal; un modal para alta
  (no hay edición aquí). Campos se limpian al cerrar.
- Regla 12: todo `queryFn`/`catch` loguea con `console.error` el error completo antes de
  propagar.
- Regla 2: `sedeId` del guard, nunca de body/query.
- Regla 1: `alcanceNombre`, `totalDestinatarios`, `leidos` se derivan al vuelo, no se
  persisten.
- Convención de rutas específicas antes de dinámicas (`/avisos/publicados` antes de
  `/avisos/:id`).
- Ruta propia por árbol (no "sección apilada") — mismo criterio que Calendario (Fase 15).
