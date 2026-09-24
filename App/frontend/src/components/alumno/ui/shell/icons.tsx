/**
 * Íconos del header de alumno — rediseño de navbar (2026-08-16). Mismo
 * criterio que `components/admin/ui/shell/icons.tsx` (SVG inline a mano,
 * sin librería nueva) pero copiado/adaptado, no importado — regla 11 de
 * `CLAUDE.md` raíz: `app/alumno` no comparte componentes con `app/admin`.
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

export function IconCarrera({ className }: IconProps) {
  return (
    <svg {...BASE} className={className} aria-hidden="true">
      <path d="M2.5 9.5 12 5l9.5 4.5-9.5 4.5-9.5-4.5Z" />
      <path d="M6.5 11.7v4.3c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5v-4.3" />
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

export function IconCandado({ className }: IconProps) {
  return (
    <svg {...BASE} className={className} aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

/** Campana — trigger de `NotificacionesBell` en el navbar (Fase 14, Día 39). */
export function IconCampana({ className }: IconProps) {
  return (
    <svg {...BASE} className={className} aria-hidden="true">
      <path d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
    </svg>
  );
}

/** Dos personas — badge de grupo del navbar (extensión de `SedeCarreraBadge`, 2026-09-16). */
export function IconGrupo({ className }: IconProps) {
  return (
    <svg {...BASE} className={className} aria-hidden="true">
      <circle cx="9" cy="8.5" r="2.5" />
      <path d="M4 18c.6-2.6 2.4-4 5-4s4.4 1.4 5 4" />
      <path d="M15.5 6.2c1.1.3 1.9 1.2 1.9 2.4s-.8 2.1-1.9 2.4" />
      <path d="M15 14.3c1.9.4 3.2 1.7 3.7 3.7" />
    </svg>
  );
}
