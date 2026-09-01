'use client';

import { ProfileDropdown } from './ProfileDropdown';
import { SedeBadge } from './SedeBadge';
import { NotificacionesBell } from './NotificacionesBell';

/**
 * Header del área MAESTRO — rediseño de navbar (2026-08-16). Mismo criterio
 * que `components/alumno/ui/shell/Header.tsx` (ver ese comentario para el
 * porqué de "sin sidebar todavía"), pero con `SedeBadge` (sin carrera).
 */
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
        <SedeBadge />
        <div className="flex items-center gap-1">
          <NotificacionesBell />
          <ProfileDropdown email={email} />
        </div>
      </div>
    </header>
  );
}
