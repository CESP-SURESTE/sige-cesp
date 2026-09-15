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
            <motion.div
              initial={contentAnimations.initial}
              animate={contentAnimations.animate}
              exit={contentAnimations.exit}
            >
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
  Icon: React.ComponentType<{ className?: string }>;
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
