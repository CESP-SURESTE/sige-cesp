# Rediseño visual — Perfil de alumno Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el layout actual de `app/alumno/page.tsx` (una tarjeta
con 4 secciones apiladas) por un encabezado con banner/avatar/nombre y un
sidebar de navegación entre secciones (4 reales + 4 "próximamente"),
mostrando exactamente los mismos datos que hoy.

**Architecture:** Cambio de solo frontend, un archivo (`app/alumno/page.tsx`)
más un ícono nuevo reutilizable en el árbol alumno
(`components/alumno/ui/shell/icons.tsx`). Los 4 componentes de sección que
ya existen hoy (`SeccionDatosPersonales`, `SeccionSede`, `SeccionCarrera`,
`SeccionContactos`) no cambian por dentro — solo cambia quién los renderiza
y cuándo (uno a la vez, según la sección activa en el sidebar, en vez de
todos apilados).

**Tech Stack:** Next.js 16 (client component, `'use client'`) + React 19
(`useState`) + Tailwind (tokens ya definidos en `globals.css`) + React Query
(sin cambios en el fetching).

## Global Constraints

- Alcance exacto: `App/frontend/src/app/alumno/page.tsx` +
  `App/frontend/src/components/alumno/ui/shell/icons.tsx`. No tocar backend,
  no tocar `app/maestro/page.tsx` (mismo rediseño se evalúa después, tarea
  aparte).
- Regla 11 de `CLAUDE.md` raíz: sin componentes compartidos con
  `app/admin/*`. Reutilizar `IconPerfil` de
  `components/alumno/ui/shell/icons.tsx` sí está permitido — es reuso
  dentro del propio árbol alumno, no cruza a admin.
- Sin datos nuevos — todos los campos mostrados son los que `GET /perfil`
  ya devuelve hoy (`lib/api/perfil.ts`, tipos `Perfil`/`PerfilAlumno`/
  `ContactoAlumno`, sin tocar).
- Sin foto real de alumno (no existe feature de subida) — avatar es un
  ícono placeholder (`IconPerfil`), banner es un SVG de arcos concéntricos
  en `navy`/`gold`, no una imagen cargada de ningún lado.
- Paleta: solo tokens ya definidos en `App/frontend/src/app/globals.css`
  (`navy`, `navy-deep`, `gold`, `gold-deep`, `mist`, `bone`, `slate`,
  `crimson`, `error-bg`/`error-border`) — cero colores nuevos.
- Secciones del sidebar: 4 reales — `Datos personales`, `Sede`, `Carrera`,
  `Contactos` (en ese orden) — + 4 "próximamente" — `Calificaciones`,
  `Horario`, `Documentos`, `Pagos` (en ese orden) — deshabilitadas
  (`disabled`, sin `onClick`) con leyenda "Próximamente en futuras
  versiones".
- `App/frontend/src` no tiene suite de tests — verificación vía
  `pnpm exec tsc --noEmit`, `pnpm lint` y verificación manual en navegador
  (mismo criterio que specs previas de este proyecto).
- Gestor de paquetes: `pnpm`, nunca `npm` (`CLAUDE.md` raíz).
- Regla 12 de `CLAUDE.md` raíz: no aplica cambios nuevos a manejo de
  errores en este plan — el `catch`/`console.error` de `AlumnoPerfilPage`
  y `SeccionCarrera` no se tocan.

---

### Task 1: Ícono de candado + `EncabezadoPerfil` (banner, avatar, nombre, badges)

**Files:**
- Modify: `App/frontend/src/components/alumno/ui/shell/icons.tsx`
- Modify: `App/frontend/src/app/alumno/page.tsx`

**Interfaces:**
- Consumes: nada nuevo — `PerfilAlumno` ya importado en `page.tsx`.
- Produces: `IconCandado` (export de `icons.tsx`, mismo patrón que
  `IconPerfil`/`IconLlave` ya existentes: `{ className }: { className?:
  string }`), `BannerArcos` y `EncabezadoPerfil` (funciones locales de
  `page.tsx`, no exportadas — `EncabezadoPerfil({ alumno: PerfilAlumno })`).
  La Task 2 va a usar `IconCandado` dentro de `SidebarSecciones`.

- [ ] **Step 1: Agregar `IconCandado` a `icons.tsx`**

Agregar al final de
`App/frontend/src/components/alumno/ui/shell/icons.tsx` (después de
`IconSalir`, mismo patrón `BASE` que los demás íconos del archivo):

```tsx
export function IconCandado({ className }: IconProps) {
  return (
    <svg {...BASE} className={className} aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `cd App/frontend && pnpm exec tsc --noEmit`
Expected: sin errores nuevos (el archivo compila igual que antes, solo se
agregó una función más con la misma forma que sus vecinas).

- [ ] **Step 3: Agregar el import de íconos en `page.tsx`**

En `App/frontend/src/app/alumno/page.tsx`, agregar este import junto a los
demás (después del import de `@/lib/api/perfil`). Solo `IconPerfil` por
ahora — `IconCandado` se agrega al import en la Task 2, cuando empieza a
usarse (un import sin uso truena `pnpm lint`):

```tsx
import { IconPerfil } from '@/components/alumno/ui/shell/icons';
```

- [ ] **Step 4: Agregar `BannerArcos` y `EncabezadoPerfil`**

Insertar estas dos funciones nuevas justo después de la función
`PerfilContenido` y antes de `function SeccionDatosPersonales(...)`:

```tsx
/**
 * Patrón de arcos concéntricos del banner — signature visual del rediseño
 * (2026-08-21, ver `docs/superpowers/specs/2026-08-21-rediseno-perfil-
 * alumno-design.md`). SVG inline, sin imagen cargada — el sistema no tiene
 * fotos reales de alumnos. Colores: tokens `gold` ya existentes en
 * `globals.css`, sobre el degradado `navy` del contenedor padre.
 */
function BannerArcos() {
  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 400 160"
      preserveAspectRatio="xMidYMid slice"
    >
      <g className="stroke-gold/20" fill="none" strokeWidth="1.5">
        <circle cx="360" cy="170" r="40" />
        <circle cx="360" cy="170" r="80" />
        <circle cx="360" cy="170" r="120" />
        <circle cx="360" cy="170" r="160" />
        <circle cx="360" cy="170" r="200" />
      </g>
    </svg>
  );
}

/**
 * Encabezado del perfil — banner + avatar + nombre + badges de estatus.
 * Reemplaza el `<h1>Mi perfil</h1>` suelto que había antes. El avatar es un
 * ícono placeholder (`IconPerfil`, no una foto real ni iniciales — no
 * existe feature de subida de foto todavía). `estatusAcademico` y
 * `esMenorDeEdad` ya se mostraban como campo/badge dentro de "Datos
 * personales"; acá se repiten como badges destacados del encabezado, el
 * dato es el mismo, solo se muestra también en un lugar más prominente.
 */
function EncabezadoPerfil({ alumno }: { alumno: PerfilAlumno }) {
  const nombreCompleto = [
    alumno.nombres,
    alumno.apellidoPaterno,
    alumno.apellidoMaterno,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="overflow-hidden rounded-lg border border-mist bg-white shadow-sm">
      <div className="relative h-32 overflow-hidden bg-gradient-to-br from-navy via-navy-deep to-navy sm:h-56">
        <BannerArcos />
      </div>
      <div className="flex flex-col items-center px-6 pb-6">
        <div className="-mt-12 flex h-24 w-24 items-center justify-center rounded-full border-4 border-white bg-mist text-navy shadow-sm sm:-mt-16 sm:h-32 sm:w-32">
          <IconPerfil className="h-12 w-12 sm:h-16 sm:w-16" />
        </div>
        <h1 className="mt-4 text-center font-display text-2xl font-semibold text-navy">
          {nombreCompleto}
        </h1>
        <p className="mt-1 text-sm text-slate/70">
          {alumno.matricula} · {alumno.carrera.nombre}
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <span className="inline-flex items-center rounded-full bg-mist px-2.5 py-0.5 text-xs font-medium text-navy">
            {ESTATUS_ACADEMICO_LABEL[alumno.estatusAcademico]}
          </span>
          {alumno.esMenorDeEdad && (
            <span className="inline-flex items-center rounded-full bg-gold/20 px-2.5 py-0.5 text-xs font-medium text-gold-deep">
              Menor de edad
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
```

`ESTATUS_ACADEMICO_LABEL` ya existe más abajo en el mismo archivo (usado
hoy por `SeccionDatosPersonales`) — no hay que declararlo de nuevo, `const`
a nivel de módulo ya está disponible para cualquier función del archivo en
tiempo de render.

- [ ] **Step 5: Wire `EncabezadoPerfil` en `PerfilContenido` y ajustar ancho**

Reemplazar el cuerpo completo de `PerfilContenido` (la función que hoy
empieza en la línea ~86 de `page.tsx`) por:

```tsx
function PerfilContenido({ perfil }: { perfil: Perfil }) {
  // `alumno` viene lleno para `rol === 'ALUMNO'` (el único caso que aplica en
  // este árbol de rutas — ver nota de `SedeGuard`/`proxy.ts` arriba). Se
  // maneja el `null` de forma defensiva de todos modos, sin asumir el shape
  // por el rol esperado.
  if (!perfil.alumno) {
    return (
      <div className="max-w-4xl rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-navy">Mi perfil</h1>
        <p className="mt-4 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-crimson">
          No se encontraron datos de perfil de alumno para tu cuenta.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <EncabezadoPerfil alumno={perfil.alumno} />
      <div className="rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <div className="space-y-6">
          <SeccionDatosPersonales alumno={perfil.alumno} email={perfil.email} />
          <SeccionSede sede={perfil.sede} />
          <SeccionCarrera alumno={perfil.alumno} />
          <SeccionContactos alumno={perfil.alumno} />
        </div>
      </div>
    </div>
  );
}
```

(Esta es una parada intermedia a propósito: el encabezado nuevo ya se ve
arriba, el contenido de las 4 secciones sigue apilado abajo tal cual hoy —
la Task 2 reemplaza ese bloque apilado por el sidebar. Nota: el ancho pasó
de `max-w-3xl` a `max-w-4xl` para que el banner/avatar tengan más aire,
pedido explícito del usuario de que "la imagen" fuera más grande.)

- [ ] **Step 6: Verificar tipos y lint**

Run: `cd App/frontend && pnpm exec tsc --noEmit && pnpm lint`
Expected: sin errores.

- [ ] **Step 7: Verificación visual manual**

Run: `cd App/frontend && pnpm dev`, iniciar sesión con un alumno de prueba
(ver `sige-cesp-credenciales.md` en el vault), entrar a `/alumno`.
Expected: banner navy con arcos dorados sutiles, avatar placeholder
sobrepuesto, nombre completo debajo, matrícula · carrera, badge de estatus
académico (y de "Menor de edad" si aplica) — y, debajo, las 4 secciones de
siempre con los mismos datos que antes del cambio.

- [ ] **Step 8: Commit**

```bash
git add App/frontend/src/components/alumno/ui/shell/icons.tsx App/frontend/src/app/alumno/page.tsx
git commit -m "feat(alumno): agrega encabezado de perfil con banner y avatar" -m "" -m "Task 1 del rediseno visual (docs/superpowers/specs/2026-08-21-rediseno-perfil-alumno-design.md) - banner de arcos navy/gold, avatar placeholder, nombre/matricula/carrera y badges de estatus. Las 4 secciones siguen apiladas debajo por ahora (Task 2 las mueve a un sidebar)." -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_014EkHoNCHA2FBBMKTa2zJXZ"
```

---

### Task 2: Sidebar de navegación entre secciones (`SidebarSecciones` + `PanelSeccion`)

**Files:**
- Modify: `App/frontend/src/app/alumno/page.tsx`

**Interfaces:**
- Consumes: `IconCandado` (de `icons.tsx`, Task 1), `EncabezadoPerfil` (de
  `page.tsx`, Task 1), los 4 componentes de sección ya existentes
  (`SeccionDatosPersonales`, `SeccionSede`, `SeccionCarrera`,
  `SeccionContactos` — firmas sin cambios).
- Produces: `type SeccionId = 'datos' | 'sede' | 'carrera' | 'contactos'`,
  `SidebarSecciones({ activa: SeccionId; onCambiar: (id: SeccionId) =>
  void })`, `PanelSeccion({ seccion: SeccionId; alumno: PerfilAlumno; email:
  string; sede: Perfil['sede'] })`. `PerfilContenido` pasa a tener estado
  local `seccion: SeccionId` vía `useState` (ya importado en el archivo).

- [ ] **Step 1: Extender el import de íconos con `IconCandado`**

En `App/frontend/src/app/alumno/page.tsx`, cambiar el import agregado en la
Task 1:

```tsx
import { IconCandado, IconPerfil } from '@/components/alumno/ui/shell/icons';
```

- [ ] **Step 2: Agregar el tipo y las listas de secciones**

Insertar esto justo después de las funciones `BannerArcos`/
`EncabezadoPerfil` (Task 1) y antes de `function SeccionDatosPersonales`:

```tsx
type SeccionId = 'datos' | 'sede' | 'carrera' | 'contactos';

const SECCIONES_REALES: { id: SeccionId; etiqueta: string }[] = [
  { id: 'datos', etiqueta: 'Datos personales' },
  { id: 'sede', etiqueta: 'Sede' },
  { id: 'carrera', etiqueta: 'Carrera' },
  { id: 'contactos', etiqueta: 'Contactos' },
];

/**
 * Secciones sin backend ni dato real detrás todavía — decisión explícita
 * del usuario de mostrarlas igual en el sidebar, deshabilitadas, con la
 * leyenda "Próximamente en futuras versiones" (ver spec de esta feature).
 */
const SECCIONES_PROXIMAMENTE = ['Calificaciones', 'Horario', 'Documentos', 'Pagos'];
```

- [ ] **Step 3: Agregar `SidebarSecciones`**

Insertar justo después del bloque del Step 1:

```tsx
function SidebarSecciones({
  activa,
  onCambiar,
}: {
  activa: SeccionId;
  onCambiar: (id: SeccionId) => void;
}) {
  return (
    <nav className="flex gap-1 overflow-x-auto pb-1 sm:w-48 sm:shrink-0 sm:flex-col sm:overflow-visible sm:border-r sm:border-mist sm:pr-4 sm:pb-0">
      {SECCIONES_REALES.map((item) => {
        const esActiva = item.id === activa;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onCambiar(item.id)}
            className={
              esActiva
                ? 'shrink-0 rounded-full bg-mist px-4 py-2 text-left text-sm font-medium text-navy sm:rounded-none sm:border-l-4 sm:border-navy sm:bg-transparent sm:pl-3'
                : 'shrink-0 rounded-full px-4 py-2 text-left text-sm font-medium text-slate/70 hover:text-navy sm:rounded-none sm:border-l-4 sm:border-transparent sm:pl-3'
            }
          >
            {item.etiqueta}
          </button>
        );
      })}
      <div className="mx-1 hidden shrink-0 border-t border-mist sm:my-2 sm:block" />
      {SECCIONES_PROXIMAMENTE.map((etiqueta) => (
        <button
          key={etiqueta}
          type="button"
          disabled
          title="Próximamente en futuras versiones"
          className="flex shrink-0 cursor-not-allowed items-center gap-1.5 rounded-full px-4 py-2 text-left text-sm text-slate/40 sm:rounded-none sm:border-l-4 sm:border-transparent sm:pl-3"
        >
          <IconCandado className="h-3.5 w-3.5 shrink-0" />
          {etiqueta}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Agregar `PanelSeccion`**

Insertar justo después de `SidebarSecciones`:

```tsx
function PanelSeccion({
  seccion,
  alumno,
  email,
  sede,
}: {
  seccion: SeccionId;
  alumno: PerfilAlumno;
  email: string;
  sede: Perfil['sede'];
}) {
  switch (seccion) {
    case 'datos':
      return <SeccionDatosPersonales alumno={alumno} email={email} />;
    case 'sede':
      return <SeccionSede sede={sede} />;
    case 'carrera':
      return <SeccionCarrera alumno={alumno} />;
    case 'contactos':
      return <SeccionContactos alumno={alumno} />;
  }
}
```

- [ ] **Step 5: Reemplazar el bloque apilado de `PerfilContenido` por el sidebar**

Reemplazar el `PerfilContenido` de la Task 1 por esta versión (agrega el
`useState` de sección activa y cambia el segundo `<div>` del `return`):

```tsx
function PerfilContenido({ perfil }: { perfil: Perfil }) {
  const [seccion, setSeccion] = useState<SeccionId>('datos');

  // `alumno` viene lleno para `rol === 'ALUMNO'` (el único caso que aplica en
  // este árbol de rutas — ver nota de `SedeGuard`/`proxy.ts` arriba). Se
  // maneja el `null` de forma defensiva de todos modos, sin asumir el shape
  // por el rol esperado.
  if (!perfil.alumno) {
    return (
      <div className="max-w-4xl rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-navy">Mi perfil</h1>
        <p className="mt-4 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-crimson">
          No se encontraron datos de perfil de alumno para tu cuenta.
        </p>
      </div>
    );
  }

  const alumno = perfil.alumno;

  return (
    <div className="max-w-4xl space-y-6">
      <EncabezadoPerfil alumno={alumno} />
      <div className="flex flex-col gap-4 rounded-lg border border-mist bg-white p-4 shadow-sm sm:flex-row sm:gap-6 sm:p-6">
        <SidebarSecciones activa={seccion} onCambiar={setSeccion} />
        <div className="min-w-0 flex-1">
          <PanelSeccion seccion={seccion} alumno={alumno} email={perfil.email} sede={perfil.sede} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Verificar tipos y lint**

Run: `cd App/frontend && pnpm exec tsc --noEmit && pnpm lint`
Expected: sin errores. Si TypeScript se queja de que `PanelSeccion` "not
all code paths return a value", confirmar que los 4 `case` de
`SeccionId` están cubiertos exactamente como en el Step 3 (el `switch` es
exhaustivo sobre la unión, no debería hacer falta un `default`).

- [ ] **Step 7: Verificación visual manual**

Run: `cd App/frontend && pnpm dev`, entrar a `/alumno` con un alumno de
prueba.
Expected: debajo del encabezado, un sidebar a la izquierda con "Datos
personales" activo por default (acento `border-l-4 border-navy`), y solo
el contenido de esa sección a la derecha. Click en "Sede"/"Carrera"/
"Contactos" cambia el panel sin recargar la página. Las 4 secciones de
abajo (Calificaciones, Horario, Documentos, Pagos) se ven atenuadas, con
candado, no reaccionan al click, y muestran el tooltip "Próximamente en
futuras versiones" al pasar el mouse.

- [ ] **Step 8: Commit**

```bash
git add App/frontend/src/app/alumno/page.tsx
git commit -m "feat(alumno): sidebar de navegacion entre secciones del perfil" -m "" -m "Task 2 del rediseno visual (docs/superpowers/specs/2026-08-21-rediseno-perfil-alumno-design.md) - reemplaza las 4 secciones apiladas por un sidebar (4 reales + 4 'proximamente en futuras versiones', deshabilitadas). Contenido de cada seccion sin cambios, solo como se muestra." -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_014EkHoNCHA2FBBMKTa2zJXZ"
```

---

### Task 3: Consistencia de estados de carga/error + verificación final

**Files:**
- Modify: `App/frontend/src/app/alumno/page.tsx`

**Interfaces:**
- Consumes: todo lo de Task 1 y Task 2, sin agregar interfaces nuevas.
- Produces: nada nuevo — solo alinea el ancho (`max-w-4xl`) de los estados
  de carga/error de `AlumnoPerfilPage` con el resto de la página.

- [ ] **Step 1: Alinear ancho de los estados de carga/error de `AlumnoPerfilPage`**

En `AlumnoPerfilPage` (la función que hace el `useQuery`, antes de
`PerfilContenido`), los bloques de `isLoading` e `isError` todavía usan
`max-w-3xl` (quedaron así desde antes del rediseño). Cambiar ambos a
`max-w-4xl`, igual que el resto de la página:

```tsx
  if (isLoading) {
    return (
      <div className="max-w-4xl rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-navy">Mi perfil</h1>
        <p className="mt-4 text-sm text-slate/60">Cargando…</p>
      </div>
    );
  }

  if (isError) {
    const mensaje =
      error instanceof ApiError
        ? error.message
        : 'No se pudo cargar tu perfil. Intenta de nuevo más tarde.';

    return (
      <div className="max-w-4xl rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-navy">Mi perfil</h1>
        <p className="mt-4 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-crimson">
          {mensaje}
        </p>
      </div>
    );
  }
```

- [ ] **Step 2: Verificar tipos y lint**

Run: `cd App/frontend && pnpm exec tsc --noEmit && pnpm lint`
Expected: sin errores.

- [ ] **Step 3: Checklist de verificación manual completa**

Run: `cd App/frontend && pnpm dev`, con un alumno de prueba (ver
`sige-cesp-credenciales.md`). Confirmar en el navegador, uno por uno:

1. Encabezado: banner con arcos visibles, avatar placeholder, nombre
   completo, matrícula · carrera, badge de estatus académico (y "Menor de
   edad" si el alumno de prueba aplica).
2. Sidebar: "Datos personales" activo por default; los 4 campos que se ven
   ahí son los mismos que mostraba la página antes del rediseño (nombre,
   matrícula, CURP, fecha de nacimiento, correo institucional, correo
   personal, teléfono, estatus académico, periodo de ingreso, semestre).
3. Click en "Sede" → misma info de sede que antes (nombre, dirección,
   ubicación de referencia, teléfono).
4. Click en "Carrera" → misma info de carrera que antes, y el botón
   "Descargar malla curricular" sigue funcionando (genera el enlace o
   muestra el toast de "aún no ha sido cargada", según el alumno de
   prueba).
5. Click en "Contactos" → mismos contactos que antes, con el badge de
   tutor/emergencia intacto.
6. Las 4 secciones "próximamente" no navegan a nada al hacer click, se ven
   atenuadas con candado, y su `title` muestra "Próximamente en futuras
   versiones".
7. Redimensionar la ventana a ancho móvil (o DevTools en modo responsive,
   ~375px): el sidebar se convierte en una fila de pills con scroll
   horizontal arriba del contenido, y el banner baja de altura.
8. Estado de carga (recargar la página y mirar el instante de "Cargando…")
   y estado de error (opcional: cortar el backend un momento) se ven con
   el mismo ancho que el resto de la página.

Expected: los 8 puntos se cumplen sin hallazgos.

- [ ] **Step 4: Commit**

```bash
git add App/frontend/src/app/alumno/page.tsx
git commit -m "chore(alumno): alinea ancho de estados de carga/error del perfil" -m "" -m "Task 3 (final) del rediseno visual (docs/superpowers/specs/2026-08-21-rediseno-perfil-alumno-design.md) - consistencia visual de max-w-4xl en los 3 estados de AlumnoPerfilPage, mas checklist de verificacion manual completo." -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_014EkHoNCHA2FBBMKTa2zJXZ"
```
