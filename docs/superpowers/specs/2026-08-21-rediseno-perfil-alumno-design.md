# Rediseño visual — Perfil de alumno

**Fecha:** 2026-08-21
**Fase:** fuera de secuencia de roadmap — cambio puramente estético pedido
directo por el usuario, sin día asignado (mismo criterio que
`GET /personas/resumen` o `GET /platform-admin/resumen`: se construye,
se documenta retroactivo).

## Contexto

`app/alumno/page.tsx` (Día 16 de Fase 5) es hoy una sola tarjeta blanca con
borde `navy` a la izquierda y 4 secciones (`Datos personales`, `Sede`,
`Carrera`, `Contactos`) apiladas verticalmente, cada una en su propio
recuadro con grids `dl/dt/dd`. Funcional, sin foto/avatar ni jerarquía
visual. El usuario pidió un rediseño completo inspirado en una referencia
visual (card de perfil tipo SaaS: banner + avatar sobrepuesto + nombre +
tabs de navegación), adaptado a la identidad institucional de SIGE.

Es un cambio **solo de frontend, solo de este archivo**. No toca
`GET /perfil` (backend) ni ningún dato nuevo — los campos mostrados son
exactamente los que la API ya devuelve hoy.

## Decisiones (confirmadas con el usuario)

1. **Alcance: solo `app/alumno/page.tsx` hoy.** El mismo lenguaje visual se
   evalúa después para `app/maestro/page.tsx` como tarea aparte (mismo
   criterio de duplicación deliberada que ya usan esos dos archivos — ver
   comentario en `app/maestro/page.tsx`, Día 17). No se toca hoy.
2. **Sin foto real de perfil** — el sistema no tiene feature de subida de
   foto para alumnos. El avatar es un ícono de persona genérico (placeholder
   explícito, no iniciales) — deja el espacio listo para cuando exista esa
   feature, sin fingir un dato que no existe.
3. **Banner de marca, no foto de stock** — la referencia visual usa una foto
   oscura genérica; en su lugar, un banner con arcos suaves en `navy`→`gold`
   (tokens ya existentes en `globals.css`, sin colores nuevos) — mismo
   motivo visual de la referencia, pero coherente con la identidad
   institucional del cliente. Es el único elemento con personalidad fuerte
   de la página (signature); todo lo demás se mantiene disciplinado.
4. **Banner más alto que la referencia** — pedido explícito del usuario
   ("con la imagen de momento más grande").
5. **Sidebar izquierdo de navegación entre secciones** (no las tabs
   horizontales de la referencia) — reemplaza el scroll largo por 4 bloques
   apilados por una vista de "una sección a la vez", como un panel de
   configuración. Esto es una decisión de esta página (nivel `app/alumno/
   page.tsx`), **no** revive la decisión de Día 16 de no tener sidebar a
   nivel de shell del área alumno (`components/alumno/ui/shell/Header.tsx`
   sigue sin sidebar propio) — son dos niveles distintos, sin contradicción.
6. **4 secciones reales + 4 "próximamente"** — reales: `Datos personales`,
   `Sede`, `Carrera`, `Contactos` (mismos datos que hoy, sin agregar ni
   quitar campos). Próximamente (deshabilitadas, con candado y leyenda
   "Próximamente en futuras versiones"): `Calificaciones`, `Horario`,
   `Documentos`, `Pagos` — listas genéricas de ERP escolar, sin backend ni
   dato real detrás, decisión explícita del usuario de mostrarlas ya en el
   sidebar aunque no funcionen.
7. **Sin datos inventados** — a diferencia de la referencia (que muestra
   contadores como "56+ Projects Completed"), no se agregan estadísticas
   que la API no devuelve.

## Diseño

### Estructura general

```
┌─────────────────────────────────────────────────────────────┐
│  banner navy→gold, arcos SVG sutiles, h-40 sm:h-56            │
│                                                                │
│                       ┌────────┐                              │
│                       │  icon  │  avatar placeholder           │
│                       └────────┘  (círculo blanco, sobrepuesto)│
│                  Juan Pérez López      (font-display)          │
│           A202600001 · Ingeniería en Software                 │
│              [Inscrito]   [Menor de edad]  (badges)            │
├───────────────┬────────────────────────────────────────────────┤
│ ▍Datos         │                                               │
│  personales    │   contenido de la sección activa              │
│  Sede          │                                               │
│  Carrera       │                                               │
│  Contactos     │                                               │
│  ───────────   │                                               │
│  Calificaciones│                                               │
│  Horario    🔒 │   (sin selección posible en las 4 de abajo)   │
│  Documentos 🔒 │                                               │
│  Pagos      🔒 │                                               │
└───────────────┴────────────────────────────────────────────────┘
```

Mobile (`< sm`): el sidebar se colapsa a una fila de pills horizontal con
scroll (`overflow-x-auto`), arriba del panel de contenido; el banner baja de
altura (`h-32`).

### Componentes nuevos (mismo archivo `app/alumno/page.tsx`, sin componentes
compartidos con `app/admin/*` ni `app/maestro/*` — regla 11 de `CLAUDE.md`
raíz)

- **`EncabezadoPerfil`** — banner + avatar + nombre + subtítulo
  (matrícula · carrera) + badges de estatus. Recibe `alumno: PerfilAlumno`.
  El banner es un `<div>` con `bg-gradient-to-br from-navy via-navy-deep
  to-navy` de fondo y un SVG inline de arcos concéntricos en `gold` a
  `opacity-10/15` superpuesto (mismo motivo visual del signature, sin
  dependencia externa — todo inline, sin imagen cargada de ningún lado).
- **`SidebarSecciones`** — lista de navegación. Recibe
  `seccionActiva: SeccionId`, `onCambiarSeccion: (id: SeccionId) => void`.
  Renderiza las 4 secciones reales como botones clickeables (acento
  `border-l-4 border-navy` en la activa, mismo lenguaje que ya usaba la
  tarjeta completa hoy) y las 4 "próximamente" como botones `disabled` con
  ícono de candado + texto atenuado (`text-slate/40`).
- **`PanelSeccion`** — despacha por `seccionActiva` a los 4 componentes de
  contenido ya existentes hoy (`SeccionDatosPersonales`, `SeccionSede`,
  `SeccionCarrera`, `SeccionContactos`) — **su contenido interno no
  cambia**, solo cómo se muestran (uno a la vez en vez de todos apilados).
  El botón "Descargar malla curricular" de `SeccionCarrera` sigue
  funcionando igual, sin tocar su lógica.
- **`ToastComoAhora`** — el `disabled` de las 4 secciones "próximamente" no
  dispara ningún toast ni navegación; son visualmente inertes a propósito
  (no hay handler `onClick` real, el `disabled` del `<button>` ya lo
  garantiza a nivel de navegador).

`type SeccionId = 'datos' | 'sede' | 'carrera' | 'contactos'` — estado local
con `useState<SeccionId>('datos')` en `PerfilContenido` (el componente que ya
existe hoy, recibe `perfil: Perfil`).

### Qué NO cambia

- `AlumnoPerfilPage` (fetch con `useQuery`, estados de loading/error) —
  intacto.
- Los 4 componentes de contenido de sección (`SeccionDatosPersonales`,
  `SeccionSede`, `SeccionCarrera`, `SeccionContactos`) y sus subcomponentes
  (`ContactoItem`, `Campo`, helpers de formato/labels) — se mueven de lugar
  (ya no van apilados dentro de un único `<div className="space-y-6">`,
  ahora los despacha `PanelSeccion`) pero su JSX interno y props no
  cambian.
- `lib/api/perfil.ts`, `GET /perfil` (backend) — sin tocar.

## Testing

- `tsc --noEmit` + `eslint` en `app/alumno/page.tsx` (sin suite de tests en
  `App/frontend/src`, mismo criterio ya documentado en specs previas).
- Verificación manual en navegador (entregable visible): login de alumno de
  prueba, confirmar que las 4 secciones reales muestran los mismos datos que
  antes del rediseño, que el toggle del sidebar cambia de sección sin
  recargar, que las 4 secciones "próximamente" no son clickeables, y que
  "Descargar malla curricular" sigue funcionando. Responsive: probar en
  viewport móvil que el sidebar se colapsa a pills horizontales.

## Fuera de alcance

- `app/maestro/page.tsx` — mismo rediseño evaluado como tarea aparte.
- Cualquier feature real detrás de `Calificaciones`/`Horario`/`Documentos`/
  `Pagos` — hoy son solo entradas visuales deshabilitadas en el sidebar.
- Subida/edición de foto de perfil — el avatar sigue siendo un ícono
  placeholder.
- Cambios a `GET /perfil` o cualquier endpoint de backend.
