# Rediseño visual de `app/admin/perfil/page.tsx` (diseño)

**Fecha:** 2026-09-10
**Estado:** aprobado, pendiente de plan de implementación
**Fase:** sin día de roadmap — retoma el pendiente "rediseño del perfil de admin al mismo
patrón visual que alumno/maestro" (el de maestro se hizo el 2026-09-07).

## Objetivo

Reemplazar el layout de una sola tarjeta con secciones apiladas de
`app/admin/perfil/page.tsx` por el mismo patrón visual que ya tienen
`app/alumno/page.tsx` (2026-08-21) y `app/maestro/page.tsx` (2026-09-07):

- **Encabezado** — banner con arcos SVG + avatar circular + badges.
- **Sidebar de navegación** — muestra una sección a la vez (no todo apilado).

**Sin cambios de datos, sin backend, sin campos nuevos.** Solo cómo se presenta lo que
`GET /perfil` (rama `administrativo`) ya devuelve.

## Referencia

`src/app/maestro/page.tsx` es la plantilla exacta (mismo trabajo, rol distinto). Sus
componentes internos a replicar dentro del árbol `app/admin/`:

| Componente en maestro | Adaptación para admin |
|---|---|
| `BannerArcos()` | igual (SVG decorativo, sin cambios) |
| `EncabezadoPerfil({ maestro })` | `EncabezadoPerfil({ administrativo })` — avatar con iniciales de `nombres`/`apellidoPaterno`; badges: nombre completo, `PUESTO_LABEL[puesto]`, `ESTATUS_EMPLEADO_LABEL[estatus]` |
| `SECCIONES_REALES` + `SidebarSecciones` + `PanelSeccion` | secciones: **Nivel de permiso**, **Datos personales**, **Sede**, **Contactos** (sin "Asignaciones" — eso es exclusivo de maestro) |
| `SeccionDatosPersonales` | los campos que ya muestra hoy: nombre, CURP, puesto, correo institucional (`perfil.email`), correo personal, teléfono, fecha de contratación, estatus laboral |
| `SeccionSede` | igual (nombre, dirección, ubicación de referencia, teléfono) |
| `SeccionContactos` + `ContactoItem` | `ContactoAdministrativo` (sin badge de tipo — igual que maestro) |
| `Campo`, `formatearFecha`, `ESTATUS_EMPLEADO_LABEL`, `PUESTO_LABEL`, `NIVEL_PERMISO_LABEL` | ya existen en el archivo actual, se conservan |

**Nueva sección propia de admin que maestro no tiene:** `SeccionNivelPermiso` (el bloque
`navy`/`gold` con `puedeDarAltaAdministrativos` que ya existe en el archivo actual) — se
mantiene como primera sección del sidebar, portado al nuevo `PanelSeccion`.

## Reglas

- **Regla 11** — todo se duplica dentro de `app/admin/` (o
  `components/admin/ui/`). Cero imports de `app/maestro/` o `app/alumno/`. Igual que el
  maestro duplicó de alumno.
- `IconPerfil` y `SkeletonProfileCard`/`SkeletonLines`: usar los de
  `components/admin/ui/` (`Skeleton.tsx` ya existe; `icons.tsx` del shell admin ya tiene
  iconografía — si no hay un `IconPerfil`, usar el que aplique o un placeholder simple).
- Estados `isLoading` / `isError` / `!perfil` / `!perfil.administrativo`: se conservan tal
  cual (ya están bien, solo se reestilan al nuevo encabezado si aplica).
- Query key `['admin', 'perfil']` sin cambios. try/catch con `console.error` (regla 12)
  sin cambios.

## Verificación

`pnpm build` + `pnpm lint` limpios. `qa-admin`. Verificación manual del usuario: entrar a
`/admin/perfil` con una cuenta `ADMINISTRATIVO`, ver el encabezado nuevo + navegar las 4
secciones del sidebar.

## Archivos tocados

- `src/app/admin/perfil/page.tsx` (reescritura del layout, misma data)
- posible: `src/components/admin/ui/` si hace falta un helper de icono/skeleton que no
  exista aún (no crear nada que ya esté).

## Fuera de alcance

- Edición de datos desde el perfil (ningún `PATCH` nuevo).
- Tocar `GET /perfil` o `lib/api/perfil.ts`.
- Cambiar el perfil de alumno o de maestro.
