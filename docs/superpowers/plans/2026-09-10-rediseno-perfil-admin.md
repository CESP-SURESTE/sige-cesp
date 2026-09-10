# Rediseño visual de `app/admin/perfil/page.tsx` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el layout de tarjeta única con secciones apiladas del perfil de admin por el patrón encabezado + sidebar de secciones que ya tienen los perfiles de alumno y maestro.

**Architecture:** Reescritura de un solo archivo de página (`app/admin/perfil/page.tsx`). Misma data de `GET /perfil` (rama `administrativo`), mismo query key, mismos estados de carga/error. Solo cambia la presentación: se replican dentro del árbol `app/admin/` los componentes internos que `app/maestro/page.tsx` usa (`BannerArcos`, `EncabezadoPerfil`, `SidebarSecciones`, `PanelSeccion`), adaptados a los campos del administrativo.

**Tech Stack:** Next.js 16 (client component), React Query, Tailwind. Sin runner de tests en el frontend — gate: `pnpm build` + `pnpm lint` + `qa-admin` + verificación manual.

## Global Constraints

- **Regla 11** — cero imports de `app/maestro/` o `app/alumno/`. Todo se duplica dentro de `app/admin/` o `components/admin/ui/`. (El maestro duplicó de alumno de esta misma forma el 2026-09-07.)
- **Regla 12** — el try/catch del `queryFn` conserva su `console.error` antes de re-lanzar.
- **Regla 1 / Regla 3** — sin campos nuevos, sin edición, sin `PATCH`. Solo lectura.
- **Sin backend** — no se toca `GET /perfil`, `src/perfil/`, ni `lib/api/perfil.ts`.
- **Query key** — sigue siendo `['admin', 'perfil']`.
- Tokens de marca del árbol admin: `navy`, `slate`, `mist`, `bone`, `gold`, `crimson`, `error-bg`, `error-border`; `font-display`.

## Referencia obligatoria

Leer `App/frontend/src/app/maestro/page.tsx` **completo** antes de empezar — es la plantilla exacta (mismo trabajo, distinto rol). Componentes a portar:

| En maestro | Adaptación admin |
|---|---|
| `BannerArcos()` | idéntico (SVG decorativo) |
| `EncabezadoPerfil({ maestro })` → `EncabezadoPerfil({ administrativo })` | avatar con iniciales de `nombres`/`apellidoPaterno`; badges: nombre completo, `PUESTO_LABEL[puesto]`, `ESTATUS_EMPLEADO_LABEL[estatus]` |
| `SECCIONES_REALES` + `SidebarSecciones` + `PanelSeccion` | secciones: `permiso`, `datos`, `sede`, `contactos` (sin `asignaciones` — exclusivo de maestro) |
| `SeccionDatosPersonales` | campos actuales: nombre completo, CURP, puesto, correo institucional (`perfil.email`), correo personal, teléfono, fecha de contratación, estatus laboral |
| `SeccionSede` | idéntico (nombre, dirección, ubicación de referencia, teléfono) |
| `SeccionContactos` + `ContactoItem` | `ContactoAdministrativo` — sin badge de tipo (igual que `ContactoMaestro`) |
| `Campo`, `formatearFecha` | ya existen en el archivo actual — conservar |

**Sección propia de admin** (maestro no la tiene): `SeccionNivelPermiso` — el bloque `navy`/`gold` con `puedeDarAltaAdministrativos` que ya existe hoy en `app/admin/perfil/page.tsx`. Se conserva su lógica y estilo, portada al nuevo `PanelSeccion` como **primera** sección del sidebar.

---

## Task 1: Reescribir `app/admin/perfil/page.tsx` con el nuevo layout

**Files:**
- Modify: `App/frontend/src/app/admin/perfil/page.tsx` (reescritura del render; la data no cambia)
- Read-only referencia: `App/frontend/src/app/maestro/page.tsx`, `App/frontend/src/components/admin/ui/Skeleton.tsx`, `App/frontend/src/components/admin/ui/shell/icons.tsx`

**Interfaces:**
- Consumes: `obtenerPerfil`, `type Perfil`, `type PerfilAdministrativo`, `type ContactoAdministrativo`, `type NivelPermiso`, `type PuestoAdministrativo` (todo de `@/lib/api/perfil` — ya importados hoy); `SkeletonProfileCard` / `SkeletonLines` (de `@/components/admin/ui/Skeleton`); un icono de perfil de `@/components/admin/ui/shell/icons` si aplica.
- Produces: nada (hoja del árbol).

---

- [ ] **Step 1: Portar la estructura base**

Copiar de `app/maestro/page.tsx` a `app/admin/perfil/page.tsx` el esqueleto: `PerfilContenido` con `EncabezadoPerfil` + `SidebarSecciones` + `PanelSeccion`, el tipo `SeccionId`, el array `SECCIONES_REALES`, y `BannerArcos`. Renombrar `maestro` → `administrativo` en props y tipos. Mantener el componente default `AdminPerfilPage` con su `useQuery(['admin','perfil'])` + try/catch + `console.error` + los bloques `isLoading` / `isError` / `!perfil` / `!perfil.administrativo` tal como están hoy (solo re-estilizar el contenedor si hace falta para que combine con el encabezado nuevo; el mensaje y los tokens `error-bg`/`error-border`/`crimson` se conservan).

`SECCIONES_REALES`:
```ts
type SeccionId = 'permiso' | 'datos' | 'sede' | 'contactos';
const SECCIONES_REALES: { id: SeccionId; etiqueta: string }[] = [
  { id: 'permiso', etiqueta: 'Nivel de permiso' },
  { id: 'datos', etiqueta: 'Datos personales' },
  { id: 'sede', etiqueta: 'Sede' },
  { id: 'contactos', etiqueta: 'Contactos' },
];
```

- [ ] **Step 2: Portar las secciones de contenido**

- `SeccionNivelPermiso({ administrativo })` — traer **tal cual** la función que ya existe hoy en el archivo (bloque `navy`/`gold`, `puedeDarAltaAdministrativos`, `NIVEL_PERMISO_LABEL`). Es el `case 'permiso'` del `PanelSeccion`.
- `SeccionDatosPersonales({ administrativo, email })` — misma `<dl>` de campos que hoy.
- `SeccionSede({ sede })` — idéntica a hoy.
- `SeccionContactos({ administrativo })` + `ContactoItem({ contacto })` — idénticas a hoy (sin badge de tipo).
- Conservar `Campo`, `formatearFecha`, `ESTATUS_EMPLEADO_LABEL`, `PUESTO_LABEL`, `NIVEL_PERMISO_LABEL` del archivo actual.

`PanelSeccion` hace el `switch (seccionActiva)` y renderiza la sección correspondiente, igual que en maestro.

- [ ] **Step 3: `EncabezadoPerfil` para administrativo**

Portar de maestro. Avatar = iniciales `(administrativo.nombres[0] + administrativo.apellidoPaterno[0]).toUpperCase()`. Badges bajo el nombre: `PUESTO_LABEL[administrativo.puesto]` y `ESTATUS_EMPLEADO_LABEL[administrativo.estatus]`. Sin badge de "menor de edad" (no aplica — `PerfilAdministrativo` no tiene `fechaNacimiento`), sin "Asignaciones".

- [ ] **Step 4: Verificar build + lint**

Run: `cd App/frontend && pnpm build && pnpm lint`
Expected: limpio. Sin imports sin usar (si `SkeletonProfileCard` deja de usarse tras el rediseño, quitarlo del import).

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/frontend/src/app/admin/perfil/page.tsx
git commit -m "feat(admin): rediseno del perfil de administrativo (encabezado + sidebar de secciones)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X7R2h7GTKWnYfDo541JgqH"
```

---

## Verificación final

1. `cd App/frontend && pnpm build && pnpm lint` — limpio.
2. `qa-admin` sobre el cambio.
3. Verificación manual del usuario: `/admin/perfil` con cuenta `ADMINISTRATIVO` → encabezado nuevo visible → navegar las 4 secciones del sidebar (Nivel de permiso, Datos personales, Sede, Contactos) → datos correctos en cada una.

## Self-Review (hecho al escribir el plan)

- **Cobertura del spec:** encabezado + banner ✓ · sidebar de 4 secciones ✓ · `SeccionNivelPermiso` conservada como primera ✓ · misma data / sin backend / sin campos nuevos ✓ · regla 11 (duplicar, no importar) explícita en constraints y Task 1 ✓ · estados de carga/error conservados ✓.
- **Placeholders:** ninguno. El plan remite a leer `app/maestro/page.tsx` como plantilla concreta en vez de repetir ~300 líneas de JSX — es una referencia a código real existente en el repo, no un hueco.
- **Consistencia de tipos:** `SeccionId` con 4 valores usado igual en `SECCIONES_REALES`, `SidebarSecciones`, `PanelSeccion`. Props `{ administrativo }` / `{ administrativo, email }` / `{ sede }` coherentes con `Perfil` de `lib/api/perfil.ts` (ya en uso hoy en el mismo archivo).
