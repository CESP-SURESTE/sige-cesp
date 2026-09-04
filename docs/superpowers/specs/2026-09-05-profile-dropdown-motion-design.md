# Animación Motion en `ProfileDropdown` (3 árboles)

**Fecha:** 2026-09-05
**Fase:** pulido de frontend (fuera de secuencia de días de roadmap).
**Alcance:** `components/{admin,alumno,maestro}/ui/shell/ProfileDropdown.tsx` — 3
archivos, hoy casi idénticos (solo cambia el `href` de "Mi perfil"). `app/plataforma/`
queda fuera (identidad separada vía `AdminPlataforma`, sin `ProfileDropdown`).
**Origen:** el usuario compartió un ejemplo de la galería de Motion (motion.dev) — un
`UserButton` estilo Clerk que hace *morph* entre un botón de avatar cerrado y una
tarjeta de menú abierta vía `layoutId` compartido — y pidió aplicar el mismo patrón a
los 3 dropdowns de perfil del proyecto.

---

## 1. Problema

Hoy el dropdown abre/cierra de golpe — sin animación real. El único movimiento
existente es la rotación CSS del chevron (`transition-transform` + `rotate-180`); el
menú en sí aparece/desaparece instantáneo (render condicional `{abierto && (...)}`).

---

## 2. Decisiones de librería (ya resueltas en conversación, no re-discutir)

- Paquete: **`motion`** (no `framer-motion` — Framer Motion se renombró, `framer-motion`
  es ahora el alias legacy). Import siempre desde `"motion/react"`. Ya instalado en
  `App/frontend/package.json`.
- Iconos: los 3 iconos de ítem de menú (`IconPerfil`, `IconLlave`, `IconSalir`, hoy
  SVG a mano en `./icons`) se reemplazan por `User`, `KeyRound`, `LogOut` de
  `lucide-react` — **solo dentro de `ProfileDropdown.tsx`**. `icons.tsx` compartido y
  sus otros usos (`IconPerfil` en `app/alumno/page.tsx` como avatar placeholder grande,
  y en `components/admin/ui/shell/Sidebar.tsx` como ícono de nav) **no se tocan** — sin
  pedido explícito de cambiar esos. El chevron (`IconChevronAbajo`, `./icons`) tampoco
  se toca — sigue como está, solo en el botón cerrado.

---

## 3. Mecánica de la animación

Calcada del ejemplo de Motion, adaptada a los datos/estilos reales de este proyecto (NO
se copia el CSS de Clerk — gradientes, sombras propias, etc. — se reusa el estilo de
tarjeta que ya existe: `border border-mist bg-white shadow-lg rounded-lg`).

- **`AnimatePresence`** envolviendo un renderizado condicional: botón cerrado (avatar +
  chevron) *o* tarjeta abierta (email + items + logout) — nunca ambos a la vez, igual
  que hoy (`abierto` sigue siendo el único estado que decide cuál se monta).
- **`layoutId` compartido** entre el `motion.button` cerrado y el `motion.div` abierto
  (ej. `"profile-dropdown"`) — Motion interpola tamaño/posición automáticamente (FLIP),
  sin animar `width`/`height` a mano.
- **Segundo `layoutId`** en el círculo del avatar (ej. `"profile-avatar"`), presente en
  ambos estados, para que se quede anclado visualmente al pasar de botón chico a
  tarjeta abierta.
- **Contenido de la tarjeta abierta** (bloque de email + lista de items + botón de
  logout) envuelto en su propio `motion.div` con fade+blur de entrada/salida y un
  pequeño delay (para que aparezca después de que la forma casi terminó de asentarse):
  ```tsx
  const contentAnimations = {
    initial: { opacity: 0, filter: 'blur(8px)' },
    animate: { opacity: 1, filter: 'blur(0px)', transition: { delay: 0.15 } },
    exit: { opacity: 0, filter: 'blur(8px)' },
  };
  ```
- **Transición de layout**: spring, mismos valores del ejemplo —
  `{ type: 'spring', bounce: 0.15, visualDuration: 0.25 }`.

---

## 4. Qué NO cambia (comportamiento/lógica intactos)

- Toggle por click (`onClick={() => setAbierto((v) => !v)}`).
- Cierre por click-afuera (`mousedown` + `contenedorRef`) y por `Escape` — mismos
  `useEffect` de hoy, sin tocar.
- `aria-haspopup="menu"`, `aria-expanded`, `role="menu"`, `role="menuitem"` — se
  preservan tal cual.
- Lógica de logout (`handleLogout`, estado `cerrandoSesion`, `supabase.auth.signOut()` +
  `router.push('/login')` + `router.refresh()`) — sin cambios.
- `email`, `inicial` (primera letra del correo) y los 3 `href` de "Mi perfil" (uno por
  árbol: `/admin/perfil`, `/alumno`, `/maestro`) — sin cambios.
- Paleta: avatar sigue `bg-navy text-bone`, tarjeta sigue `border-mist`/`bg-white`,
  logout sigue `text-crimson`/`hover:bg-error-bg`.
- Posicionamiento: la tarjeta abierta sigue expandiéndose hacia abajo-derecha del botón
  (`absolute`, alineada a la derecha del contenedor) — Motion anima la transición de
  posición/tamaño vía el `layoutId` compartido, no hace falta replicar el ancla
  `top-0 left-0` del ejemplo (ese layout es específico de su demo).

---

## 5. Testing / verificación

Sin lógica de negocio ni contrato de API — no aplica test automatizado. Verificación:
`pnpm build` + `pnpm lint` del frontend limpios, y revisión visual en navegador en los 3
árboles (abrir/cerrar el dropdown, click-afuera, Escape, logout) antes de cerrar.

---

## 6. Ejecución

Subagent-Driven Development, 2 tasks (mismo split de dominio que el resto del
proyecto):

1. `admin-coder` — `components/admin/ui/shell/ProfileDropdown.tsx`.
2. `alumno-coder` — `components/alumno/ui/shell/ProfileDropdown.tsx` +
   `components/maestro/ui/shell/ProfileDropdown.tsx` (cubre ambos árboles).

Review por task (spec + calidad) con `qa-admin`/`qa-alumno` respectivamente. Review
final de rama corto al cierre (mismo proceso que skeletons, pero escalado a un modelo
más económico — alcance chico, 2 tasks sobre el mismo patrón exacto en 3 archivos, bajo
riesgo de inconsistencia cruzada).
