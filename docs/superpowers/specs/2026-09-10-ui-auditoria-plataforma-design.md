# UI de auditoría para admin de plataforma (diseño)

**Fecha:** 2026-09-10
**Estado:** aprobado, pendiente de plan de implementación
**Fase:** sin día de roadmap asignado — cierra el gap de que `RegistroAuditoria` se
escribe en 11 services pero no existe NINGUNA ruta ni UI de lectura.

## Objetivo

Dar al `AdminPlataforma` (única identidad cross-sede del sistema) una pantalla para
consultar el historial de `RegistroAuditoria` de todas las sedes, con filtros y detalle
del `Json`. Más un widget de "actividad reciente" en el dashboard de plataforma.

Alcance aprobado: **lectura + widget en dashboard**. Fuera: exportación CSV (YAGNI, se
agrega si CESP lo pide), cualquier lectura de auditoría para el rol `ADMINISTRATIVO`
(por sede) — esto es SOLO plataforma.

## Contexto existente (no se re-discute)

- `model RegistroAuditoria` (`schema.prisma:627`): `id`, `usuarioId?`, `adminPlataformaId?`
  (XOR vía CHECK constraint — exactamente uno presente), `sedeId?` (nullable,
  `onDelete: SetNull` desde Día 22), `accion` (`AccionAuditoria`), `entidad` (string),
  `entidadId` (string), `detalle` (`Json?`), `fecha` (`DateTime @default(now())`).
- `enum AccionAuditoria`: `ALTA`, `BAJA`, `EDICION`, `CAMBIO_PERMISO`, `CAMBIO_ESTATUS`,
  `ELIMINACION`, `CONSULTA_EMERGENCIA`.
- Valores reales de `entidad` escritos hoy (13, grepeados en `App/backend/src`): `Usuario`,
  `Sede`, `Carrera`, `Salon`, `Grupo`, `GrupoAlumno`, `GrupoMateriaMaestro`, `Materia`,
  `MallaCurricular`, `Aviso`, `EventoCalendario`, `TelefonoEmergenciaSede`,
  `ExpedienteEmergencia`. El filtro del backend NO valida contra esta lista (ver abajo);
  el `<select>` del frontend se alimenta de una constante con estos 13.
- `model AdminPlataforma`: tiene `nombre` (string, no nullable) y `email`.
- `Usuario` NO tiene nombre propio — el nombre humano vive en `PerfilAlumno` /
  `PerfilMaestro` / `PerfilAdministrativo` (`nombres`/`apellidoPaterno`/`apellidoMaterno`).
- `PlatformAdminGuard` (`src/common/guards/platform-admin.guard.ts`) — revalida al admin
  contra la DB en cada request. Ya lo usa `GET /platform-admin/resumen`.
- Backend corre con rol `postgres` (BYPASSRLS) — el aislamiento es `SedeGuard` + filtros
  de app. Esta ruta es cross-sede **por diseño**, no aplica filtro de sede del actor.
- `platformFetch<T>` (`src/lib/api/platform-http.ts`) devuelve `body.data` y **descarta**
  `page`/`limit`/`total` — hay que agregar una variante paginada.
- Árbol `app/plataforma/`: sin `layout.tsx`, sin sidebar. Cada página es un `<main
  className="mx-auto max-w-4xl p-8">` con un header inline propio (kicker "SIGE ·
  Plataforma" + links + "Cerrar sesión") y gate de ruta client-side vía
  `getPlatformToken()` en un `useEffect`. React Query en todas.
- Paleta del árbol plataforma: `navy`, `slate`, `crimson`, `mist`, `font-display`.
  Skeletons en `app/plataforma/Skeleton.tsx` (`SkeletonLines`, `SkeletonStatTiles`,
  `SkeletonTableRows`).

## Backend — `GET /platform-admin/auditoria`

### Ruta y guard

- `GET /platform-admin/auditoria` en `PlatformAdminController`.
- `@UseGuards(PlatformAdminGuard)` (igual que `GET /platform-admin/resumen`).
- Solo lectura — **sin** `@PlatformAdminActual()`. Leer la bitácora no se audita a sí
  mismo (mismo criterio que `resumen`; regla 5 habla de acciones sensibles de negocio,
  este `findMany` no lo es).

### Query params (DTO `ListarAuditoriaQueryDto`, todos opcionales)

| Param | Validación | Efecto en el `where` |
|---|---|---|
| `sedeId` | `@IsUUID()` | `sedeId: sedeId` exacto |
| `accion` | `@IsEnum(AccionAuditoria)` — fuera del enum → `400 VALIDATION_ERROR` | `accion: accion` |
| `entidad` | `@IsString() @IsNotEmpty()` — **sin `@IsIn`** (una entidad nueva no debe romper el filtro) | `entidad: entidad` (match exacto) |
| `actorId` | `@IsUUID()` | `OR: [{ usuarioId: actorId }, { adminPlataformaId: actorId }]` |
| `desde` | `@Matches(/^\d{4}-\d{2}-\d{2}$/)` | `fecha: { gte: new Date(desde + 'T00:00:00.000Z') }` |
| `hasta` | mismo regex; regla cruzada en el service: `hasta < desde` → `400 VALIDATION_ERROR` | `fecha: { lt: <hasta + 1 día, UTC> }` |
| `page` | `@Type(() => Number) @IsInt() @Min(1)`, default `1` | `skip: (page-1)*limit` |
| `limit` | `@IsInt() @Min(1) @Max(100)`, default `20` | `take: limit` |

`desde` y `hasta` se combinan en un solo objeto `fecha: { gte, lt }` cuando vienen los dos.

### Respuesta

`200 { data: RegistroAuditoriaItem[], page, limit, total }` — `total` con `prisma.registroAuditoria.count({ where })`. Orden **fijo** `fecha: 'desc'` (sin param de orden — YAGNI).

```ts
type RegistroAuditoriaItem = {
  id: string;
  fecha: string;              // ISO 8601
  accion: AccionAuditoria;
  entidad: string;
  entidadId: string;
  actor: {
    id: string;
    tipo: 'USUARIO' | 'PLATAFORMA';
    nombre: string;            // resuelto en batch
    rol: 'ALUMNO' | 'MAESTRO' | 'ADMINISTRATIVO' | null;  // solo si tipo === 'USUARIO'
  };
  sede: { id: string; nombre: string } | null;   // null si sedeId es null (sede borrada)
  detalle: unknown | null;     // el Json crudo, tal cual
};
```

### Resolución de actor y sede (batch, sin N+1)

En `PlatformAdminService.listarAuditoria`:

1. `findMany` de la página (`where`, `orderBy`, `skip`, `take`) — trae filas planas
   incluyendo `sede: { select: { id: true, nombre: true } }` (relación directa, un solo
   join, no es N+1).
2. Juntar `usuarioIds` distintos (los `usuarioId` no-null) y `adminIds` distintos.
3. `Promise.all([
     prisma.usuario.findMany({ where: { id: { in: usuarioIds } }, select: { id, rol,
       email, perfilAlumno: { select: { nombres, apellidoPaterno, apellidoMaterno } },
       perfilMaestro: { select: {...} }, perfilAdministrativo: { select: {...} } } }),
     prisma.adminPlataforma.findMany({ where: { id: { in: adminIds } }, select: { id, nombre } }),
   ])`
4. Construir 2 `Map`s. Para un `Usuario`: `nombre` = `\`${p.nombres} ${p.apellidoPaterno}
   ${p.apellidoMaterno}\`` del perfil que exista según `usuario.rol` (o el primero
   no-null); si no hay perfil, `nombre = usuario.email` (fallback defensivo). `rol` = el
   del `Usuario`. Para un `AdminPlataforma`: `nombre` = `admin.nombre`, `rol = null`,
   `tipo = 'PLATAFORMA'`.
5. Mapear cada fila a `RegistroAuditoriaItem`. `sede` es `null` cuando `sedeId` es null.

### Códigos de error

Reutiliza `VALIDATION_ERROR` (params inválidos / `hasta < desde`) y `UNAUTHORIZED`
(`PlatformAdminGuard`: sin token, token inválido/expirado, admin inactivo). **Ningún
código nuevo.**

### Pruebas e2e — `test/platform-admin-auditoria.e2e-spec.ts`

Setup: crear ~6 filas `RegistroAuditoria` directas (`prisma.registroAuditoria.create`) —
mezcla de actor `usuarioId` y `adminPlataformaId`, distintas `accion`/`entidad`/`sedeId`,
una con `sedeId` de una sede que luego se borra (o directamente `sedeId: null`), una con
`detalle` poblado. Guardar los `id` creados.

- sin filtros → pagina, `total` correcto, orden `fecha desc`.
- `?sedeId=` acota; `?accion=` acota; `?entidad=` acota; `?actorId=` acota (matchea tanto
  usuario como admin de plataforma).
- `?desde=&hasta=` acota por rango; `hasta` < `desde` → `400 VALIDATION_ERROR`.
- `?accion=NO_EXISTE` → `400`; `?page=0` → `400`; `?limit=101` → `400`.
- actor `tipo: 'USUARIO'` trae `nombre` resuelto + `rol`; actor `tipo: 'PLATAFORMA'` trae
  `nombre` del `AdminPlataforma` y `rol: null`.
- fila con `sedeId: null` → `sede: null` en la respuesta.
- sin header `Authorization` → `401`.

`afterAll`: `prisma.registroAuditoria.deleteMany({ where: { id: { in: idsCreados } } })` —
**acotado por id**, nunca por patrón (regla 14). No tocar filas preexistentes.

## Frontend

### 1. `platformFetchPaginated` — `src/lib/api/platform-http.ts`

Clon de `platformFetch<T>` que en el `return` hace
`return body as { data: T[]; page: number; limit: number; total: number }` en vez de
`(body as { data: T }).data`. Mismo manejo de 401 (redirect a `/plataforma/login` +
`clearPlatformToken`), mismo lanzamiento de `ApiError`. `platformFetch` **no se toca**.

### 2. `src/lib/api/auditoria-plataforma.ts` (nuevo)

```ts
export type AccionAuditoria = 'ALTA' | 'BAJA' | 'EDICION' | 'CAMBIO_PERMISO'
  | 'CAMBIO_ESTATUS' | 'ELIMINACION' | 'CONSULTA_EMERGENCIA';

export const ACCIONES_AUDITORIA: AccionAuditoria[] = [ ...los 7... ];

export const ENTIDADES_AUDITABLES = ['Usuario','Sede','Carrera','Salon','Grupo',
  'GrupoAlumno','GrupoMateriaMaestro','Materia','MallaCurricular','Aviso',
  'EventoCalendario','TelefonoEmergenciaSede','ExpedienteEmergencia'] as const;

export interface FiltrosAuditoria {
  sedeId?: string; accion?: AccionAuditoria; entidad?: string;
  actorId?: string; desde?: string; hasta?: string;
  page?: number; limit?: number;
}
export interface RegistroAuditoriaItem { /* = shape del backend */ }

export function listarAuditoria(
  filtros: FiltrosAuditoria,
): Promise<{ data: RegistroAuditoriaItem[]; page: number; limit: number; total: number }> {
  const qs = new URLSearchParams();
  // solo agrega los que están definidos y no vacíos
  return platformFetchPaginated<RegistroAuditoriaItem>(`/platform-admin/auditoria?${qs}`);
}
```

### 3. `src/app/plataforma/PlataformaNav.tsx` (nuevo — componente local del árbol)

Extrae el header duplicado hoy en `page.tsx` y `sedes/page.tsx`. No cruza a `app/admin` ni
`app/alumno` (regla 11 — árbol de identidad aparte, mismo criterio que `../Skeleton`).

- Props: `activo?: 'dashboard' | 'sedes' | 'auditoria'` (para resaltar el link actual).
- Render: kicker "SIGE · Plataforma" + `<h1>` opcional (o el título lo pone cada página) +
  links `Dashboard` (`/plataforma`), `Sedes` (`/plataforma/sedes`), `Auditoría`
  (`/plataforma/auditoria`) + botón "Cerrar sesión" (`clearPlatformToken()` + `router.push('/plataforma/login')`).
- `page.tsx` y `sedes/page.tsx` se refactorizan para usarlo. Diff contenido — mismo markup,
  ahora en un solo lugar.

### 4. `src/app/plataforma/auditoria/page.tsx` (nuevo)

`'use client'`. Gate de ruta client-side idéntico a `sedes/page.tsx` (`useEffect` →
`getPlatformToken()` → `router.replace('/plataforma/login')`).

**Estado local:** `filtros: FiltrosAuditoria` (incluye `page`, arranca en `{ page: 1,
limit: 20 }`). Cambiar cualquier filtro resetea `page` a 1.

**Query:** `useQuery({ queryKey: ['plataforma','auditoria', filtros], queryFn: () =>
listarAuditoria(filtros) })` — envuelto en try/catch con `console.error` (regla 12).

**Barra de filtros:**
- `<select>` Sede — opciones de `useQuery(['plataforma','sedes'], listarSedes)`; opción
  vacía "Todas las sedes".
- `<select>` Acción — `ACCIONES_AUDITORIA` + "Todas".
- `<select>` Entidad — `ENTIDADES_AUDITABLES` + "Todas".
- `<input type="date">` Desde / `<input type="date">` Hasta.
- Chip removible "Actor: {nombre} ✕" — visible solo si `filtros.actorId` está set; la ✕
  lo limpia. **No hay input de actor** — se fija haciendo click en el nombre del actor de
  una fila (ver tabla).
- Botón "Limpiar filtros" → `setFiltros({ page: 1, limit: 20 })`.

**Tabla** (`<table>` con el estilo de las tablas de `app/admin/*` adaptado a la paleta
plataforma; si no hay una tabla en el árbol plataforma, montar uno simple con `border`,
`bg-white`, `shadow-sm`):

| Columna | Contenido |
|---|---|
| Fecha | `new Date(fecha).toLocaleString('es-MX')` |
| Actor | `<button>` con el `nombre` (click → `setFiltros(f => ({ ...f, actorId: r.actor.id, page: 1 }))`) + badge `USUARIO`/`PLATAFORMA` + `rol` como subtexto pequeño si existe |
| Acción | badge de color por `accion` (mapa de `accion` → clase Tailwind; p.ej. `ALTA`→verde, `ELIMINACION`/`BAJA`→crimson, `EDICION`/`CAMBIO_*`→navy, `CONSULTA_EMERGENCIA`→amber) |
| Entidad | `entidad` + `entidadId` truncado (`entidadId.slice(0, 8)…`) como subtexto |
| Sede | `sede?.nombre ?? '—'` |
| — | botón "Ver detalle" → abre `DetalleAuditoriaModal` con esa fila |

**Paginación:** debajo de la tabla — "Página {page} de {Math.ceil(total/limit)} · {total}
registros" + botones "Anterior" (`disabled` si `page === 1`) / "Siguiente" (`disabled` si
`page * limit >= total`).

**Estados:** `isLoading` → `<SkeletonTableRows count={10} />`; `isError` → `<p
className="text-crimson">` con `error.message` si es `ApiError`; `data.data.length === 0`
→ "No hay registros que coincidan con los filtros."

### 5. `src/app/plataforma/auditoria/DetalleAuditoriaModal.tsx` (nuevo — local)

Modal simple (overlay + card centrada, `max-h-[80vh] overflow-y-auto`, botón Cerrar; NO
usa ningún modal compartido — regla 11 / 13, cada árbol tiene los suyos). Muestra:
`id`, `fecha` (formateada), `accion`, `entidad` + `entidadId` completo, `actor` (nombre,
tipo, rol, id), `sede` (nombre + id, o "—"), y `detalle`:

- si `detalle` es `null` → "Sin detalle registrado".
- si no → `<pre className="... overflow-x-auto text-xs">{JSON.stringify(detalle, null,
  2)}</pre>`.

### 6. Widget "Actividad reciente" — `src/app/plataforma/page.tsx`

Card nueva debajo de "Alumnos por sede" (o al lado — el dashboard hoy es `max-w-4xl`,
cabe apilada). Mismo estilo de card (`rounded-lg border-l-4 border-navy bg-white p-6
shadow-sm`).

- `useQuery({ queryKey: ['plataforma','auditoria','reciente'], queryFn: () =>
  listarAuditoria({ limit: 5 }) })`.
- Título "Actividad reciente" + link "Ver todo →" a `/plataforma/auditoria`.
- Lista compacta de hasta 5 filas: `{fecha corta} · {actor.nombre} · {accion} · {entidad}`.
- Loading → `<SkeletonLines count={5} />`; error → línea discreta en `text-slate/60`
  ("No se pudo cargar la actividad reciente") — el widget **no** debe tumbar el dashboard;
  `console.error` igual (regla 12). Vacío → "Sin actividad registrada todavía."

### Verificación

`pnpm build` + `pnpm lint` limpios. `qa-frontend` (el árbol `app/plataforma/` no tiene
dueño de dominio en el roster — mismo gap consignado en el Día 20; `qa-frontend` cubre la
infra de frontend sin dueño). Verificación manual en navegador por el usuario:
login de plataforma → dashboard muestra el widget → `/plataforma/auditoria` lista, filtra
por cada campo, click en actor fija el chip, "Ver detalle" abre el `Json`, paginación
avanza.

## Archivos tocados

**Backend:**
- `src/platform-admin/dto/listar-auditoria-query.dto.ts` (nuevo)
- `src/platform-admin/platform-admin.controller.ts` (+ 1 método)
- `src/platform-admin/platform-admin.service.ts` (+ `listarAuditoria`)
- `test/platform-admin-auditoria.e2e-spec.ts` (nuevo)

**Frontend:**
- `src/lib/api/platform-http.ts` (+ `platformFetchPaginated`)
- `src/lib/api/auditoria-plataforma.ts` (nuevo)
- `src/app/plataforma/PlataformaNav.tsx` (nuevo)
- `src/app/plataforma/page.tsx` (refactor a `PlataformaNav` + widget)
- `src/app/plataforma/sedes/page.tsx` (refactor a `PlataformaNav`)
- `src/app/plataforma/auditoria/page.tsx` (nuevo)
- `src/app/plataforma/auditoria/DetalleAuditoriaModal.tsx` (nuevo)

## Fuera de alcance (explícito)

- Exportación CSV / PDF.
- Lectura de auditoría para el rol `ADMINISTRATIVO` (por sede).
- Filtro por rango de `entidadId` o búsqueda de texto libre en `detalle`.
- Cualquier `PATCH`/`DELETE` sobre `RegistroAuditoria` (regla 5 — solo inserción).
- Migración de BD — no hay cambios de schema.
