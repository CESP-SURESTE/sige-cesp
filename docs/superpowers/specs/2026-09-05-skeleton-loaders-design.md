# Skeleton loaders en pantallas con fetch

**Fecha:** 2026-09-05
**Fase:** pulido de frontend (fuera de secuencia de días de roadmap — no bloquea
ninguna fase en curso).
**Alcance:** reemplazar el texto plano `"Cargando…"` por skeletons en las 22 pantallas
reales que lo usan, en los 4 árboles de frontend (`admin`, `alumno`, `maestro`,
`plataforma`).
**Origen:** anotado por el usuario el 2026-09-04 (memoria
`sige-frontend-polish-pendiente`), retomado el 2026-09-05. El segundo pendiente de esa
misma memoria ("login más vivo") queda fuera de este spec — sin alcance definido,
se brainstormea aparte si se retoma.

---

## 1. Objetivo

Sustituir el `<p>Cargando…</p>` (o `<td>Cargando…</td>`) uniforme que hoy usan 22 sitios
de fetch por un skeleton que imita la forma real del contenido que va a aparecer (tabla,
card de perfil, grilla de calendario, tiles de resumen, lista chica) — sin librería
nueva, sin rediseñar el layout final de ninguna pantalla.

---

## 2. Decisión de librería: sin dependencia nueva

La nota original mencionaba `react-loading-skeleton` (infiere forma/tamaño del
contenido envuelto). Se descarta: la regla del proyecto es no sumar dependencias si algo
se resuelve con lo ya instalado, y las 22 pantallas tienen forma conocida de antemano
(tablas de columnas fijas, cards de campos fijos, grillas de calendario fijas) — no hay
contenido de forma impredecible que justifique la inferencia automática de la librería.
Se construye a mano con Tailwind (`animate-pulse`), ya instalado.

Color: `bg-mist` (`--mist: #dce1ea`, ya en la paleta) — contraste suficiente contra
`bone`/blanco de fondo sin necesitar un tono nuevo.

---

## 3. Alcance: 22 de 27 sitios detectados

Grep de `isLoading`/`isPending` + `"Cargando"` en `App/frontend/src/app` dio 27 archivos.
De esos:

- **22 sitios reales** son el "Cargando…" de una sección/pantalla completa esperando su
  fetch — estos son el alcance de este spec (lista completa en §5).
- **2 sitios se excluyen a propósito**: `"Cargando carreras…"` dentro del placeholder de
  un `<select>` ya renderizado en `admin/alumnos/nuevo/page.tsx`, y
  `"Cargando tus grupos…"` dentro de un dropdown del modal de evento de maestro
  (`maestro/calendario/EventoModal.tsx`) — son etiquetas de 2-3 palabras dentro de un
  campo de formulario que ya está en pantalla, no un bloque de contenido que un skeleton
  pueda imitar con sentido. Se dejan como texto.
- **3 archivos del grep eran falsos positivos** — `isLoading`/`isPending` usados para
  deshabilitar un botón de mutación (guardar/enviar), sin texto "Cargando" de pantalla
  asociado. No aplica ningún cambio ahí.

---

## 4. Arquitectura: un primitivo + 5 formas, por árbol

Regla 11 (sin componentes compartidos entre árboles admin/alumno) se extiende aquí a los
4 árboles por consistencia con el patrón ya establecido (cada árbol repite sus propios
modales de confirmación, badges, etc.). Cada árbol gana su propio archivo con el mismo
contenido (duplicado a propósito, no una utilidad compartida):

- `components/admin/ui/Skeleton.tsx` (nuevo)
- `components/alumno/ui/Skeleton.tsx` (nuevo)
- `components/maestro/ui/Skeleton.tsx` (nuevo)
- `app/plataforma/Skeleton.tsx` (nuevo) — `plataforma` no tiene `components/ui/` propio,
  sus componentes locales viven junto a las páginas (`SedeModal.tsx`,
  `ConfirmarEliminarSedeModal.tsx`); este archivo sigue ese mismo patrón de colocación.

Cada archivo exporta el primitivo base y las 5 formas compuestas sobre él:

```tsx
function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-mist ${className ?? ''}`} />;
}

export function SkeletonTableRows({ columns, rows = 5 }: { columns: number; rows?: number }) { /* ... */ }
export function SkeletonProfileCard({ lines = 5 }: { lines?: number }) { /* ... */ }
export function SkeletonStatTiles({ count = 3 }: { count?: number }) { /* ... */ }
export function SkeletonCalendarGrid() { /* ... */ }
export function SkeletonLines({ count = 3 }: { count?: number }) { /* ... */ }
```

No las 5 formas se usan en los 4 árboles — cada archivo exporta solo las que sus propias
pantallas necesitan (ver mapeo en §5). `plataforma/Skeleton.tsx`, por ejemplo, solo
necesita `SkeletonTableRows` y `SkeletonStatTiles`.

**Regla de forma para `SkeletonTableRows`**: siempre se monta dentro de la tabla real
(mismo `<table>`/`<thead>` que el estado con datos), reemplazando solo el `<tbody>`. 3 de
los 8 sitios de tabla hoy ocultan la tabla completa (header incluido) mientras carga —
este cambio la deja siempre visible, ajuste menor de consistencia de paso.

---

## 5. Mapeo completo (22 sitios → forma → agente)

### `admin-coder` (14 sitios en 12 archivos)

| Archivo | Forma |
|---|---|
| `app/admin/alumnos/page.tsx` | `SkeletonTableRows` (6 cols) |
| `app/admin/maestros/page.tsx` | `SkeletonTableRows` |
| `app/admin/administrativos/page.tsx` | `SkeletonTableRows` |
| `app/admin/carreras/page.tsx` | `SkeletonTableRows` (3 cols) |
| `app/admin/grupos/page.tsx` | `SkeletonTableRows` (6 cols) |
| `app/admin/salones/page.tsx` | `SkeletonTableRows` (3 cols) |
| `app/admin/grupos/[id]/page.tsx` (header del grupo) | `SkeletonProfileCard` |
| `app/admin/grupos/[id]/page.tsx` (tabla de matriculados) | `SkeletonTableRows` |
| `app/admin/grupos/[id]/SeccionAsignaciones.tsx` | `SkeletonLines` |
| `app/admin/perfil/page.tsx` | `SkeletonProfileCard` |
| `app/admin/calendario/page.tsx` | `SkeletonCalendarGrid` |
| `app/admin/carreras/SubirMallaModal.tsx` | `SkeletonLines` (1-2 líneas) |
| `app/admin/page.tsx` (resumen — stats) | `SkeletonStatTiles` |
| `app/admin/page.tsx` (altas recientes — lista) | `SkeletonLines` |

(`admin/grupos/[id]/page.tsx` y `admin/page.tsx` aportan 2 sitios cada uno — de ahí que
14 sitios caigan en 12 archivos.)

### `alumno-coder` (6 sitios en 4 archivos — cubre `app/alumno/` y `app/maestro/`)

| Archivo | Forma |
|---|---|
| `app/alumno/page.tsx` (sección perfil) | `SkeletonProfileCard` |
| `app/alumno/page.tsx` (sección compañeros) | `SkeletonLines` |
| `app/alumno/calendario/page.tsx` | `SkeletonCalendarGrid` |
| `app/maestro/page.tsx` (sección perfil) | `SkeletonProfileCard` |
| `app/maestro/page.tsx` (sección grupos y materias) | `SkeletonLines` |
| `app/maestro/calendario/page.tsx` | `SkeletonCalendarGrid` |

### Directo (sin dueño de dominio en el roster, mismo gap de Día 20/22)

| Archivo | Forma |
|---|---|
| `app/plataforma/page.tsx` | `SkeletonStatTiles` |
| `app/plataforma/sedes/page.tsx` | `SkeletonTableRows` (4 cols) |

---

## 6. Fuera de alcance

- Librería `react-loading-skeleton` (descartada, §2).
- "Login más vivo" (segundo pendiente de la misma memoria, sin alcance definido, no es
  parte de este spec).
- Cualquier rediseño del layout final de las pantallas tocadas — el skeleton solo
  reemplaza el estado de carga, la forma final no cambia.
- Tests automatizados de los skeletons — son puramente visuales, sin lógica de negocio;
  verificación manual en navegador al cierre, mismo criterio que otros pulidos de UI de
  este proyecto.

---

## 7. Testing / verificación

Sin lógica de negocio ni contrato de API involucrado — no aplica `pnpm test`/e2e backend.
Verificación: `pnpm build` + `pnpm lint` del frontend limpios, y revisión visual en
navegador (throttle de red o React Query `staleTime` forzado a 0 temporalmente) en al
menos un sitio por forma (5 formas × 1 pantalla representativa cada una) antes de cerrar.

---

## 8. Ejecución

Subagent-Driven Development, 3 tasks:

1. `admin-coder` — primitivo `components/admin/ui/Skeleton.tsx` + los 12 sitios de
   `app/admin/*`.
2. `alumno-coder` — primitivos `components/alumno/ui/Skeleton.tsx` +
   `components/maestro/ui/Skeleton.tsx` + los 6 sitios (4 archivos) de `app/alumno/*` +
   `app/maestro/*`.
3. Directo (yo) — primitivo `app/plataforma/Skeleton.tsx` + los 2 sitios de
   `app/plataforma/*`.

Review final de rama (sin QA dedicado para `plataforma`, mismo criterio que Día 20/22).
