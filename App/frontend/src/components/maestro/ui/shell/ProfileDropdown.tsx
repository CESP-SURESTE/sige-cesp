'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { IconChevronAbajo, IconLlave, IconPerfil, IconSalir } from './icons';

/**
 * Dropdown de perfil del área MAESTRO — rediseño de navbar (2026-08-16).
 * Copiado/adaptado de `components/admin/ui/shell/ProfileDropdown.tsx` y
 * `components/alumno/ui/shell/ProfileDropdown.tsx`, NO importado (mismo
 * criterio de separación total, ver `components/maestro/ui/shell/icons.tsx`).
 * "Mi perfil" apunta a `/maestro` (la propia página de perfil del maestro).
 *
 * Mismo mecanismo de signOut que `components/logout-button.tsx` — ver el
 * comentario completo de ese archivo para el porqué de `router.push` +
 * `router.refresh()` en vez de `window.location`.
 */
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
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={abierto}
        className="flex items-center gap-2 rounded-full py-1 pr-2 pl-1 transition-colors hover:bg-mist/50 focus-visible:ring-2 focus-visible:ring-navy focus-visible:outline-none"
      >
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-semibold text-bone"
        >
          {inicial}
        </span>
        <IconChevronAbajo
          className={['size-4 text-slate/60 transition-transform', abierto ? 'rotate-180' : ''].join(' ')}
        />
      </button>

      {abierto && (
        <div
          role="menu"
          className="absolute top-full right-0 z-30 mt-2 w-64 overflow-hidden rounded-lg border border-mist bg-white shadow-lg"
        >
          {email && (
            <div className="border-b border-mist px-4 py-3">
              <p className="truncate text-sm font-medium text-slate">{email}</p>
            </div>
          )}
          <div className="py-1">
            <ItemMenu href="/maestro" Icon={IconPerfil} onClick={() => setAbierto(false)}>
              Mi perfil
            </ItemMenu>
            <ItemMenu href="/cambiar-password" Icon={IconLlave} onClick={() => setAbierto(false)}>
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
              <IconSalir className="size-4 shrink-0" />
              {cerrandoSesion ? 'Cerrando sesión…' : 'Cerrar sesión'}
            </button>
          </div>
        </div>
      )}
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
