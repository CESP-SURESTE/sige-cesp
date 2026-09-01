'use client';

import { ProfileDropdown } from './ProfileDropdown';
import { SedeCarreraBadge } from './SedeCarreraBadge';
import { NotificacionesBell } from './NotificacionesBell';

/**
 * Header del área ALUMNO — rediseño de navbar (2026-08-16). Reemplaza el
 * `email` + `LogoutButton` sueltos que vivían inline en `app/alumno/layout.tsx`
 * por el mismo lenguaje visual que admin (badge de contexto + dropdown de
 * perfil), pero SIN sidebar — a diferencia de admin, el árbol alumno tiene
 * muy pocas pantallas (decisión explícita del usuario: no vale la pena un
 * panel lateral todavía).
 *
 * Client component separado de `layout.tsx` (server component) por el mismo
 * motivo que `AdminShell`: `ProfileDropdown`/`SedeCarreraBadge` necesitan
 * interacción/`useQuery`, `email` se resuelve en el servidor y llega como prop.
 */
export function Header({ email }: { email: string | null }) {
  return (
    <header className="border-b border-mist px-6 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-xs font-semibold tracking-[0.14em] text-navy uppercase">
            SIGE
          </span>
          <span className="text-sm font-medium text-slate">Panel del alumno</span>
        </div>
        <SedeCarreraBadge />
        <div className="flex items-center gap-1">
          <NotificacionesBell />
          <ProfileDropdown email={email} />
        </div>
      </div>
    </header>
  );
}
