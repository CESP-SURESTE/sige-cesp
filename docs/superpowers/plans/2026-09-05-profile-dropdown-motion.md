# Animación Motion en ProfileDropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el abrir/cerrar instantáneo de `ProfileDropdown` (3 árboles) por un
morph animado con Motion entre el botón de avatar cerrado y la tarjeta de menú abierta.

**Architecture:** `AnimatePresence` + `layoutId` compartido entre `motion.button`
(cerrado) y `motion.div` (abierto) — Motion interpola tamaño/posición vía FLIP, sin
animar `width`/`height` a mano. Segundo `layoutId` en el círculo del avatar para que se
quede anclado visualmente entre ambos estados. Contenido de la tarjeta con fade+blur
retardado.

**Tech Stack:** Next.js + TypeScript + Tailwind + `motion` (`motion/react`) +
`lucide-react`, ya instalados.

**Spec:** `docs/superpowers/specs/2026-09-05-profile-dropdown-motion-design.md`

## Global Constraints

- Import de Motion siempre desde `"motion/react"` (no `"framer-motion"`).
- Iconos de ítem de menú: `User`, `KeyRound`, `LogOut` de `lucide-react` — solo dentro
  de `ProfileDropdown.tsx`. `icons.tsx` compartido y sus otros usos NO se tocan.
  `IconChevronAbajo` (de `./icons`) se sigue usando tal cual, sin cambiar su definición.
- Toggle por click, cierre por click-afuera y Escape, `handleLogout`/`cerrandoSesion`,
  `email`/`inicial`, hrefs de "Mi perfil" por árbol — comportamiento y lógica intactos.
- Paleta sin cambios: avatar `bg-navy text-bone`, tarjeta `border-mist`/`bg-white`,
  logout `text-crimson`/`hover:bg-error-bg`.
- Spring de layout: `{ type: 'spring', bounce: 0.15, visualDuration: 0.25 }`.
- Regla 11 — los 3 archivos siguen totalmente independientes (sin import cruzado, cada
  uno mantiene su propio `ItemMenu` local).
- **Nota de comportamiento aceptada** (no es un hallazgo de QA): con el botón cerrado y
  la tarjeta abierta como 2 elementos distintos que Motion intercambia (patrón del
  ejemplo de Clerk), ya no existe un único elemento "botón" persistente para
  reclick-cerrar mientras está abierto — se cierra por click-afuera, Escape, o click en
  un ítem del menú (incluye logout). Es el mismo mecanismo que el ejemplo de Motion que
  pidió el usuario, no una regresión.
- El chevron (`IconChevronAbajo`) solo se renderiza en el estado cerrado ahora (el
  estado abierto no lo incluye, igual que el ejemplo de Clerk) — la clase condicional
  `rotate-180` que existía deja de aplicar (el chevron nunca coexiste con `abierto`) y
  se quita del JSX, sin tocar la definición del ícono en `icons.tsx`.

---

### Task 1: `components/admin/ui/shell/ProfileDropdown.tsx`

**Files:**
- Modify: `App/frontend/src/components/admin/ui/shell/ProfileDropdown.tsx`

**Interfaces:**
- Sin cambio de firma pública: sigue exportando `ProfileDropdown({ email }: { email:
  string | null })`. `ItemMenu` sigue siendo un helper local no exportado.

- [ ] **Step 1: Reemplazar el archivo completo**

```tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { KeyRound, LogOut, User } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { IconChevronAbajo } from './icons';

/**
 * Dropdown de perfil — rediseño de navbar (2026-08-16, pedido explícito del
 * usuario: "en el circulo verde claro añade un dropdow de perfil",
 * referencia visual `Image #5` del pedido, colores propios — reemplaza el
 * `email` + `LogoutButton` sueltos que vivían directo en `Topbar`.
 *
 * Animación Motion (2026-09-05, spec
 * `docs/superpowers/specs/2026-09-05-profile-dropdown-motion-design.md`):
 * el botón cerrado y la tarjeta abierta son 2 layouts estáticos que Motion
 * morphea vía un `layoutId` compartido (y un segundo en el avatar, para que
 * se quede anclado visualmente) — patrón calcado de un ejemplo de la galería
 * de motion.dev (un `UserButton` estilo Clerk), con el estilo/paleta que ya
 * tenía este dropdown, no los del ejemplo.
 *
 * El signOut es el mismo mecanismo que `components/logout-button.tsx`
 * (`supabase.auth.signOut()` + `router.push('/login')` + `router.refresh()`,
 * ver el comentario completo de ese archivo para el porqué) — se repite acá
 * en vez de reusar `<LogoutButton>` porque ese componente es un botón de
 * texto suelto, no encaja como fila de un menú; la lógica sí es la misma.
 *
 * Cierre por click-afuera + Escape, mismo patrón ya usado por
 * `AdminShell.MobileDrawer` (foco al abrir, `keydown` de Escape).
 */

const SPRING = { type: 'spring', bounce: 0.15, visualDuration: 0.25 } as const;

const contentAnimations = {
  initial: { opacity: 0, filter: 'blur(8px)' },
  animate: { opacity: 1, filter: 'blur(0px)', transition: { delay: 0.15 } },
  exit: { opacity: 0, filter: 'blur(8px)' },
};

export function ProfileDropdown({ email }: { email: string | null }) {
  const [abierto, setAbierto] = useState(false);
  const [cerrandoSesion, setCerrandoSesion] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!abierto) return;
    function onClickAfuera(e: MouseEvent) {
      if (!contenedorRef.current?.contains(e.target as Node)) {
        setAbierto(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setAbierto(false);
    }
    document.addEventListener('mousedown', onClickAfuera);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickAfuera);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [abierto]);

  async function handleLogout() {
    setCerrandoSesion(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const inicial = email ? email.charAt(0).toUpperCase() : '?';

  return (
    <div ref={contenedorRef} className="relative">
      <AnimatePresence>
        {!abierto ? (
          <motion.button
            key="cerrado"
            type="button"
            layoutId="profile-dropdown"
            transition={SPRING}
            onClick={() => setAbierto(true)}
            aria-haspopup="menu"
            aria-expanded={false}
            className="flex items-center gap-2 rounded-full py-1 pr-2 pl-1 transition-colors hover:bg-mist/50 focus-visible:ring-2 focus-visible:ring-navy focus-visible:outline-none"
          >
            <motion.span
              layoutId="profile-avatar"
              transition={SPRING}
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-semibold text-bone"
            >
              {inicial}
            </motion.span>
            <IconChevronAbajo className="size-4 text-slate/60" />
          </motion.button>
        ) : (
          <motion.div
            key="abierto"
            role="menu"
            layoutId="profile-dropdown"
            transition={SPRING}
            className="absolute top-0 right-0 z-30 w-64 overflow-hidden rounded-lg border border-mist bg-white shadow-lg"
          >
            <motion.div
              initial={contentAnimations.initial}
              animate={contentAnimations.animate}
              exit={contentAnimations.exit}
            >
              <div className="flex items-center gap-2.5 border-b border-mist px-4 py-3">
                <motion.span
                  layoutId="profile-avatar"
                  transition={SPRING}
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-semibold text-bone"
                >
                  {inicial}
                </motion.span>
                {email && (
                  <p className="truncate text-sm font-medium text-slate">{email}</p>
                )}
              </div>
              <div className="py-1">
                <ItemMenu href="/admin/perfil" Icon={User} onClick={() => setAbierto(false)}>
                  Mi perfil
                </ItemMenu>
                <ItemMenu href="/cambiar-password" Icon={KeyRound} onClick={() => setAbierto(false)}>
                  Cambiar contraseña
                </ItemMenu>
              </div>
              <div className="border-t border-mist py-1">
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleLogout}
                  disabled={cerrandoSesion}
                  className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm font-medium text-crimson transition-colors hover:bg-error-bg disabled:opacity-50"
                >
                  <LogOut className="size-4 shrink-0" />
                  {cerrandoSesion ? 'Cerrando sesión…' : 'Cerrar sesión'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ItemMenu({
  href,
  Icon,
  onClick,
  children,
}: {
  href: string;
  Icon: (props: { className?: string }) => React.ReactElement;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onClick}
      className="flex items-center gap-2.5 px-4 py-2 text-sm text-slate transition-colors hover:bg-mist/50"
    >
      <Icon className="size-4 shrink-0 text-slate/60" />
      {children}
    </Link>
  );
}
```

- [ ] **Step 2: Build y lint del frontend**

Run: `cd App/frontend && pnpm build && pnpm lint`
Expected: ambos limpios (mismos 2 warnings preexistentes de `react-hooks/exhaustive-deps`
en `app/admin/grupos/[id]/*`, sin nada nuevo).

- [ ] **Step 3: Verificación visual**

Con el frontend corriendo, entrar a cualquier pantalla de `/admin/*`, abrir el dropdown
de perfil (esquina superior derecha del navbar): confirmar que el avatar "crece" en una
tarjeta con spring (no aparece de golpe), que el email/items aparecen con un fundido
breve después, que click-afuera y Escape cierran, y que "Cerrar sesión" sigue
funcionando.

- [ ] **Step 4: Commit**

```bash
git add App/frontend/src/components/admin/ui/shell/ProfileDropdown.tsx
git commit -m "feat(admin): anima ProfileDropdown con Motion (layoutId compartido)"
```

---

### Task 2: `components/alumno/ui/shell/ProfileDropdown.tsx` y `components/maestro/ui/shell/ProfileDropdown.tsx`

**Files:**
- Modify: `App/frontend/src/components/alumno/ui/shell/ProfileDropdown.tsx`
- Modify: `App/frontend/src/components/maestro/ui/shell/ProfileDropdown.tsx`

**Interfaces:**
- Sin cambio de firma pública en ninguno de los 2: `ProfileDropdown({ email }: { email:
  string | null })`.

- [ ] **Step 1: Reemplazar `components/alumno/ui/shell/ProfileDropdown.tsx` completo**

```tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { KeyRound, LogOut, User } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { IconChevronAbajo } from './icons';

/**
 * Dropdown de perfil del área ALUMNO — rediseño de navbar (2026-08-16,
 * mismo pedido que en admin: "en el circulo verde claro añade un dropdow de
 * perfil"). Copiado/adaptado de `components/admin/ui/shell/ProfileDropdown.tsx`,
 * NO importado — regla 11 de `CLAUDE.md` raíz (árboles admin/alumno
 * totalmente separados). Única diferencia real: "Mi perfil" apunta a `/alumno`
 * (la propia página de perfil del alumno, no una sub-ruta como en admin).
 *
 * Animación Motion (2026-09-05, spec
 * `docs/superpowers/specs/2026-09-05-profile-dropdown-motion-design.md`):
 * el botón cerrado y la tarjeta abierta son 2 layouts estáticos que Motion
 * morphea vía un `layoutId` compartido (y un segundo en el avatar, para que
 * se quede anclado visualmente) — patrón calcado de un ejemplo de la galería
 * de motion.dev (un `UserButton` estilo Clerk), con el estilo/paleta que ya
 * tenía este dropdown, no los del ejemplo.
 *
 * Mismo mecanismo de signOut que `components/logout-button.tsx` — ver el
 * comentario completo de ese archivo para el porqué de `router.push` +
 * `router.refresh()` en vez de `window.location`.
 */

const SPRING = { type: 'spring', bounce: 0.15, visualDuration: 0.25 } as const;

const contentAnimations = {
  initial: { opacity: 0, filter: 'blur(8px)' },
  animate: { opacity: 1, filter: 'blur(0px)', transition: { delay: 0.15 } },
  exit: { opacity: 0, filter: 'blur(8px)' },
};

export function ProfileDropdown({ email }: { email: string | null }) {
  const [abierto, setAbierto] = useState(false);
  const [cerrandoSesion, setCerrandoSesion] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!abierto) return;
    function onClickAfuera(e: MouseEvent) {
      if (!contenedorRef.current?.contains(e.target as Node)) {
        setAbierto(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setAbierto(false);
    }
    document.addEventListener('mousedown', onClickAfuera);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickAfuera);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [abierto]);

  async function handleLogout() {
    setCerrandoSesion(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const inicial = email ? email.charAt(0).toUpperCase() : '?';

  return (
    <div ref={contenedorRef} className="relative">
      <AnimatePresence>
        {!abierto ? (
          <motion.button
            key="cerrado"
            type="button"
            layoutId="profile-dropdown"
            transition={SPRING}
            onClick={() => setAbierto(true)}
            aria-haspopup="menu"
            aria-expanded={false}
            className="flex items-center gap-2 rounded-full py-1 pr-2 pl-1 transition-colors hover:bg-mist/50 focus-visible:ring-2 focus-visible:ring-navy focus-visible:outline-none"
          >
            <motion.span
              layoutId="profile-avatar"
              transition={SPRING}
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-semibold text-bone"
            >
              {inicial}
            </motion.span>
            <IconChevronAbajo className="size-4 text-slate/60" />
          </motion.button>
        ) : (
          <motion.div
            key="abierto"
            role="menu"
            layoutId="profile-dropdown"
            transition={SPRING}
            className="absolute top-0 right-0 z-30 w-64 overflow-hidden rounded-lg border border-mist bg-white shadow-lg"
          >
            <motion.div
              initial={contentAnimations.initial}
              animate={contentAnimations.animate}
              exit={contentAnimations.exit}
            >
              <div className="flex items-center gap-2.5 border-b border-mist px-4 py-3">
                <motion.span
                  layoutId="profile-avatar"
                  transition={SPRING}
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-semibold text-bone"
                >
                  {inicial}
                </motion.span>
                {email && (
                  <p className="truncate text-sm font-medium text-slate">{email}</p>
                )}
              </div>
              <div className="py-1">
                <ItemMenu href="/alumno" Icon={User} onClick={() => setAbierto(false)}>
                  Mi perfil
                </ItemMenu>
                <ItemMenu href="/cambiar-password" Icon={KeyRound} onClick={() => setAbierto(false)}>
                  Cambiar contraseña
                </ItemMenu>
              </div>
              <div className="border-t border-mist py-1">
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleLogout}
                  disabled={cerrandoSesion}
                  className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm font-medium text-crimson transition-colors hover:bg-error-bg disabled:opacity-50"
                >
                  <LogOut className="size-4 shrink-0" />
                  {cerrandoSesion ? 'Cerrando sesión…' : 'Cerrar sesión'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ItemMenu({
  href,
  Icon,
  onClick,
  children,
}: {
  href: string;
  Icon: (props: { className?: string }) => React.ReactElement;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onClick}
      className="flex items-center gap-2.5 px-4 py-2 text-sm text-slate transition-colors hover:bg-mist/50"
    >
      <Icon className="size-4 shrink-0 text-slate/60" />
      {children}
    </Link>
  );
}
```

- [ ] **Step 2: Reemplazar `components/maestro/ui/shell/ProfileDropdown.tsx` completo**

```tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { KeyRound, LogOut, User } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { IconChevronAbajo } from './icons';

/**
 * Dropdown de perfil del área MAESTRO — rediseño de navbar (2026-08-16).
 * Copiado/adaptado de `components/admin/ui/shell/ProfileDropdown.tsx` y
 * `components/alumno/ui/shell/ProfileDropdown.tsx`, NO importado (mismo
 * criterio de separación total, ver `components/maestro/ui/shell/icons.tsx`).
 * "Mi perfil" apunta a `/maestro` (la propia página de perfil del maestro).
 *
 * Animación Motion (2026-09-05, spec
 * `docs/superpowers/specs/2026-09-05-profile-dropdown-motion-design.md`):
 * el botón cerrado y la tarjeta abierta son 2 layouts estáticos que Motion
 * morphea vía un `layoutId` compartido (y un segundo en el avatar, para que
 * se quede anclado visualmente) — patrón calcado de un ejemplo de la galería
 * de motion.dev (un `UserButton` estilo Clerk), con el estilo/paleta que ya
 * tenía este dropdown, no los del ejemplo.
 *
 * Mismo mecanismo de signOut que `components/logout-button.tsx` — ver el
 * comentario completo de ese archivo para el porqué de `router.push` +
 * `router.refresh()` en vez de `window.location`.
 */

const SPRING = { type: 'spring', bounce: 0.15, visualDuration: 0.25 } as const;

const contentAnimations = {
  initial: { opacity: 0, filter: 'blur(8px)' },
  animate: { opacity: 1, filter: 'blur(0px)', transition: { delay: 0.15 } },
  exit: { opacity: 0, filter: 'blur(8px)' },
};

export function ProfileDropdown({ email }: { email: string | null }) {
  const [abierto, setAbierto] = useState(false);
  const [cerrandoSesion, setCerrandoSesion] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!abierto) return;
    function onClickAfuera(e: MouseEvent) {
      if (!contenedorRef.current?.contains(e.target as Node)) {
        setAbierto(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setAbierto(false);
    }
    document.addEventListener('mousedown', onClickAfuera);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickAfuera);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [abierto]);

  async function handleLogout() {
    setCerrandoSesion(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const inicial = email ? email.charAt(0).toUpperCase() : '?';

  return (
    <div ref={contenedorRef} className="relative">
      <AnimatePresence>
        {!abierto ? (
          <motion.button
            key="cerrado"
            type="button"
            layoutId="profile-dropdown"
            transition={SPRING}
            onClick={() => setAbierto(true)}
            aria-haspopup="menu"
            aria-expanded={false}
            className="flex items-center gap-2 rounded-full py-1 pr-2 pl-1 transition-colors hover:bg-mist/50 focus-visible:ring-2 focus-visible:ring-navy focus-visible:outline-none"
          >
            <motion.span
              layoutId="profile-avatar"
              transition={SPRING}
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-semibold text-bone"
            >
              {inicial}
            </motion.span>
            <IconChevronAbajo className="size-4 text-slate/60" />
          </motion.button>
        ) : (
          <motion.div
            key="abierto"
            role="menu"
            layoutId="profile-dropdown"
            transition={SPRING}
            className="absolute top-0 right-0 z-30 w-64 overflow-hidden rounded-lg border border-mist bg-white shadow-lg"
          >
            <motion.div
              initial={contentAnimations.initial}
              animate={contentAnimations.animate}
              exit={contentAnimations.exit}
            >
              <div className="flex items-center gap-2.5 border-b border-mist px-4 py-3">
                <motion.span
                  layoutId="profile-avatar"
                  transition={SPRING}
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-semibold text-bone"
                >
                  {inicial}
                </motion.span>
                {email && (
                  <p className="truncate text-sm font-medium text-slate">{email}</p>
                )}
              </div>
              <div className="py-1">
                <ItemMenu href="/maestro" Icon={User} onClick={() => setAbierto(false)}>
                  Mi perfil
                </ItemMenu>
                <ItemMenu href="/cambiar-password" Icon={KeyRound} onClick={() => setAbierto(false)}>
                  Cambiar contraseña
                </ItemMenu>
              </div>
              <div className="border-t border-mist py-1">
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleLogout}
                  disabled={cerrandoSesion}
                  className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm font-medium text-crimson transition-colors hover:bg-error-bg disabled:opacity-50"
                >
                  <LogOut className="size-4 shrink-0" />
                  {cerrandoSesion ? 'Cerrando sesión…' : 'Cerrar sesión'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ItemMenu({
  href,
  Icon,
  onClick,
  children,
}: {
  href: string;
  Icon: (props: { className?: string }) => React.ReactElement;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onClick}
      className="flex items-center gap-2.5 px-4 py-2 text-sm text-slate transition-colors hover:bg-mist/50"
    >
      <Icon className="size-4 shrink-0 text-slate/60" />
      {children}
    </Link>
  );
}
```

- [ ] **Step 3: Build y lint del frontend**

Run: `cd App/frontend && pnpm build && pnpm lint`
Expected: limpios, mismos 2 warnings preexistentes de siempre.

- [ ] **Step 4: Verificación visual**

Entrar a `/alumno` y a `/maestro`, abrir el dropdown de perfil en cada uno, confirmar el
mismo comportamiento animado que en admin (Step 3 de la Task 1) y que "Mi perfil" de
cada uno apunta a su propia ruta (`/alumno`, `/maestro`).

- [ ] **Step 5: Commit**

```bash
git add App/frontend/src/components/alumno/ui/shell/ProfileDropdown.tsx \
  App/frontend/src/components/maestro/ui/shell/ProfileDropdown.tsx
git commit -m "feat(alumno,maestro): anima ProfileDropdown con Motion (layoutId compartido)"
```

---

## Cierre

Review final de rama corto (modelo económico — 2 tasks, mismo patrón exacto en 3
archivos, bajo riesgo de inconsistencia cruzada), mismo proceso que el resto de
Subagent-Driven Development de este proyecto.
