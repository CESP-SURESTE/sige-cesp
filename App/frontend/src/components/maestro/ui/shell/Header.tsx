'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ProfileDropdown } from './ProfileDropdown';
import { SedeBadge } from './SedeBadge';
import { NotificacionesBell } from './NotificacionesBell';

/**
 * Header del área MAESTRO — rediseño de navbar (2026-08-16). Mismo criterio
 * que `components/alumno/ui/shell/Header.tsx` (ver ese comentario para el
 * porqué de "sin sidebar todavía"), pero con `SedeBadge` (sin carrera).
 *
 * `NavMaestro` (Fase 15, Día 43, Task 9) — nav de 2 links ("Mi perfil" /
 * "Calendario") con estado activo vía `usePathname()`, mismo criterio de
 * `NavLink` en `components/admin/ui/shell/Sidebar.tsx` pero sin sidebar
 * (este árbol nunca tuvo uno). Se coloca entre el bloque de título y
 * `SedeBadge` — `NotificacionesBell`/`ProfileDropdown` se mantienen como el
 * bloque final de la derecha, sin tocar su posición.
 */
function NavMaestro() {
  const pathname = usePathname();
  const enCalendario = pathname.startsWith('/maestro/calendario');
  return (
    <nav className="flex items-center gap-4 text-sm font-medium">
      <Link
        href="/maestro"
        aria-current={!enCalendario ? 'page' : undefined}
        className={!enCalendario ? 'text-navy' : 'text-slate/60 hover:text-navy'}
      >
        Mi perfil
      </Link>
      <Link
        href="/maestro/calendario"
        aria-current={enCalendario ? 'page' : undefined}
        className={enCalendario ? 'text-navy' : 'text-slate/60 hover:text-navy'}
      >
        Calendario
      </Link>
    </nav>
  );
}

export function Header({ email }: { email: string | null }) {
  return (
    <header className="border-b border-mist px-6 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-xs font-semibold tracking-[0.14em] text-navy uppercase">
            SIGE
          </span>
          <span className="text-sm font-medium text-slate">Panel del maestro</span>
        </div>
        <NavMaestro />
        <SedeBadge />
        <div className="flex items-center gap-1">
          <NotificacionesBell />
          <ProfileDropdown email={email} />
        </div>
      </div>
    </header>
  );
}
