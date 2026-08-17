/**
 * Íconos del header de maestro — rediseño de navbar (2026-08-16). Mismo
 * criterio que `components/admin/ui/shell/icons.tsx` /
 * `components/alumno/ui/shell/icons.tsx` (SVG inline a mano, sin librería
 * nueva) pero copiado/adaptado, no importado — mismo criterio de separación
 * total que regla 11 de `CLAUDE.md` raíz (admin/alumno), extendido acá a
 * maestro (ver comentario de `app/maestro/layout.tsx`: tampoco comparte con
 * `app/alumno/layout.tsx`).
 */
type IconProps = { className?: string };

const BASE = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function IconChevronAbajo({ className }: IconProps) {
  return (
    <svg {...BASE} className={className} aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function IconUbicacion({ className }: IconProps) {
  return (
    <svg {...BASE} className={className} aria-hidden="true">
      <path d="M12 21s-6.5-5.6-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5.4-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.3" />
    </svg>
  );
}

export function IconPerfil({ className }: IconProps) {
  return (
    <svg {...BASE} className={className} aria-hidden="true">
      <circle cx="12" cy="8.2" r="3.4" />
      <path d="M4.8 19.5c1.1-3.4 3.9-5.3 7.2-5.3s6.1 1.9 7.2 5.3" />
    </svg>
  );
}

export function IconLlave({ className }: IconProps) {
  return (
    <svg {...BASE} className={className} aria-hidden="true">
      <circle cx="7.5" cy="14.5" r="3.5" />
      <path d="m9.9 12.1 9.1-9.1" />
      <path d="m15.5 6.5 2.3 2.3" />
      <path d="m18 4 2 2" />
    </svg>
  );
}

export function IconSalir({ className }: IconProps) {
  return (
    <svg {...BASE} className={className} aria-hidden="true">
      <path d="M13 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6" />
      <path d="M11 12h9" />
      <path d="m16.5 7.5 4.5 4.5-4.5 4.5" />
    </svg>
  );
}
