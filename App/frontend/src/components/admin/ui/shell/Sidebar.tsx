'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType } from 'react';
import {
  IconAdministrativos,
  IconAlumnos,
  IconCarreras,
  IconMaestros,
  IconPanel,
  IconPerfil,
} from './icons';

type NavItem = {
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  /** Ruta exacta (el dashboard) vs. prefijo (todo lo demás, para que un item
   * siga marcado activo en sub-rutas como `/admin/alumnos/nuevo`). */
  match: 'exacto' | 'prefijo';
};

// Funciones principales del admin (Fase 4/5) — Alumnos y Maestros llevan al
// listado (Día 19, su "función" principal es verlos); Administrativos
// todavía no tiene listado propio (fuera de alcance de Día 19 a propósito,
// ver CLAUDE.md raíz), así que por ahora apunta a la única pantalla que
// existe para ese rol (alta). Cuando exista `/admin/administrativos`
// (listado), este href se actualiza — no antes, no se inventa una ruta
// vacía.
const NAV_PRINCIPAL: NavItem[] = [
  { href: '/admin', label: 'Panel', Icon: IconPanel, match: 'exacto' },
  { href: '/admin/alumnos', label: 'Alumnos', Icon: IconAlumnos, match: 'prefijo' },
  { href: '/admin/maestros', label: 'Maestros', Icon: IconMaestros, match: 'prefijo' },
  { href: '/admin/carreras', label: 'Carreras', Icon: IconCarreras, match: 'prefijo' },
  {
    href: '/admin/administrativos/nuevo',
    label: 'Administrativos',
    Icon: IconAdministrativos,
    match: 'prefijo',
  },
];

const NAV_CUENTA: NavItem = {
  href: '/admin/perfil',
  label: 'Mi perfil',
  Icon: IconPerfil,
  match: 'prefijo',
};

function estaActivo(pathname: string, item: NavItem): boolean {
  if (item.match === 'exacto') return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + '/');
}

/**
 * Contenido de navegación del sidebar — Fase 5+, rediseño de shell
 * (2026-08-14). Se usa tal cual dentro del riel fijo de desktop y dentro
 * del drawer mobile (`AdminShell` decide el contenedor, este componente solo
 * sabe pintar la lista de links).
 *
 * Firma visual: el tick dorado a la izquierda del item activo es el mismo
 * motivo que el borde `border-l-4 border-navy` que ya usa cada card de
 * contenido (`app/admin/**\/page.tsx`) — acá invertido (gold sobre navy) por
 * ser la superficie oscura del shell. Un solo lenguaje de "esto es lo
 * actual", en dos lugares.
 *
 * `colapsado` (riel de solo íconos): cada link usa `title` (tooltip nativo,
 * sin JS/librería nueva) con la misma etiqueta que se ve expandido — nunca
 * se pierde información, solo densidad.
 */
export function Sidebar({
  colapsado,
  onNavegar,
}: {
  colapsado: boolean;
  /** Se llama al hacer click en un link — en mobile, `AdminShell` lo usa
   * para cerrar el drawer (aunque el cambio de ruta ya lo cierra solo vía
   * `useSidebarState`, cerrarlo también acá evita el parpadeo del drawer
   * abierto durante la transición de navegación). */
  onNavegar?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex h-full flex-col py-4" aria-label="Navegación principal">
      <ul className="flex flex-col gap-1 px-3">
        {NAV_PRINCIPAL.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            activo={estaActivo(pathname, item)}
            colapsado={colapsado}
            onNavegar={onNavegar}
          />
        ))}
      </ul>

      <div className="mt-auto px-3 pt-4">
        <div className="mb-1 border-t border-white/10" />
        <ul className="flex flex-col gap-1 pt-3">
          <NavLink
            item={NAV_CUENTA}
            activo={estaActivo(pathname, NAV_CUENTA)}
            colapsado={colapsado}
            onNavegar={onNavegar}
          />
        </ul>
      </div>
    </nav>
  );
}

function NavLink({
  item,
  activo,
  colapsado,
  onNavegar,
}: {
  item: NavItem;
  activo: boolean;
  colapsado: boolean;
  onNavegar?: () => void;
}) {
  const { Icon } = item;

  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavegar}
        title={colapsado ? item.label : undefined}
        aria-current={activo ? 'page' : undefined}
        className={[
          'group relative flex items-center gap-3 rounded-lg py-2 text-sm font-medium transition-colors',
          'focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-navy focus-visible:outline-none',
          colapsado ? 'justify-center px-2' : 'px-3',
          activo
            ? 'bg-white/10 text-bone'
            : 'text-bone/60 hover:bg-white/5 hover:text-bone',
        ].join(' ')}
      >
        <span
          aria-hidden="true"
          className={[
            'absolute top-1/2 left-0 h-5 -translate-y-1/2 rounded-r-full bg-gold transition-all',
            activo ? 'w-[3px] opacity-100' : 'w-0 opacity-0',
          ].join(' ')}
        />
        <Icon className="size-5 shrink-0" />
        {!colapsado && <span className="truncate">{item.label}</span>}
      </Link>
    </li>
  );
}
