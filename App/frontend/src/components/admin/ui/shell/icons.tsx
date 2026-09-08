/**
 * Íconos del shell admin — rediseño de navegación (panel lateral), pedido
 * explícito del usuario vía `/frontend-design`, 2026-08-14.
 *
 * SVG inline a mano, sin librería nueva (`lucide-react` y similares no
 * estaban instalados — CLAUDE.md global del usuario: "no agregar
 * dependencias nuevas si algo se resuelve con lo que ya está instalado").
 * Todos comparten `strokeWidth`/tamaño/`viewBox` para verse como un solo
 * set, no íconos sueltos de fuentes distintas. `aria-hidden` en todos: el
 * texto visible (o el `title`/`aria-label` del control que los envuelve) ya
 * comunica el significado, el ícono es puramente decorativo/reforzador.
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

export function IconPanel({ className }: IconProps) {
  return (
    <svg {...BASE} className={className} aria-hidden="true">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.2" />
    </svg>
  );
}

export function IconAlumnos({ className }: IconProps) {
  return (
    <svg {...BASE} className={className} aria-hidden="true">
      <path d="M3 8.5 12 4l9 4.5-9 4.5-9-4.5Z" />
      <path d="M7 10.7v4.3c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4.3" />
      <path d="M20 8.5v5.3" />
    </svg>
  );
}

export function IconMaestros({ className }: IconProps) {
  return (
    <svg {...BASE} className={className} aria-hidden="true">
      <circle cx="12" cy="7.5" r="3.25" />
      <path d="M5 20c0-3.6 3.13-6 7-6s7 2.4 7 6" />
      <path d="M15.5 6.2c1 .3 1.75 1.2 1.75 2.4S16.5 10.7 15.5 11" />
    </svg>
  );
}

export function IconAdministrativos({ className }: IconProps) {
  return (
    <svg {...BASE} className={className} aria-hidden="true">
      <rect x="3.5" y="8" width="17" height="11" rx="1.5" />
      <path d="M8.5 8V6.2c0-.94.76-1.7 1.7-1.7h3.6c.94 0 1.7.76 1.7 1.7V8" />
      <path d="M3.5 12.5c2.4 1.4 5.4 2.1 8.5 2.1s6.1-.7 8.5-2.1" />
    </svg>
  );
}

/** Birrete — link a "Carreras" en el sidebar (Fase 6, Día 21). */
export function IconCarreras({ className }: IconProps) {
  return (
    <svg {...BASE} className={className} aria-hidden="true">
      <path d="M2.5 9.5 12 5l9.5 4.5-9.5 4.5-9.5-4.5Z" />
      <path d="M6.5 11.6v4.1c0 1.6 2.5 2.8 5.5 2.8s5.5-1.2 5.5-2.8v-4.1" />
      <path d="M21.5 9.5v6" />
    </svg>
  );
}

/** Aula con pupitres — link a "Grupos" en el sidebar (Fase 9, Día 29). */
export function IconGrupos({ className }: IconProps) {
  return (
    <svg {...BASE} className={className} aria-hidden="true">
      <rect x="3" y="4" width="18" height="14" rx="1.5" />
      <path d="M3 9h18" />
      <path d="M8 13.5h2.2" />
      <path d="M13.8 13.5H16" />
      <path d="M9 21h6" />
      <path d="M12 18v3" />
    </svg>
  );
}

/** Puerta de aula — link a "Salones" en el sidebar (Fase 9, CRUD de Salón). Distinto de `IconGrupos` (aula con pupitres) y de `IconLlave` (dropdown de perfil). */
export function IconSalones({ className }: IconProps) {
  return (
    <svg {...BASE} className={className} aria-hidden="true">
      <rect x="6" y="2.5" width="12" height="19" rx="1" />
      <path d="M9 2.5v19" />
      <circle cx="7.3" cy="12" r="0.9" fill="currentColor" stroke="none" />
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

export function IconChevronDoble({ className }: IconProps) {
  return (
    <svg {...BASE} className={className} aria-hidden="true">
      <path d="m10.5 6-6 6 6 6" />
      <path d="m19.5 6-6 6 6 6" />
    </svg>
  );
}

export function IconMenu({ className }: IconProps) {
  return (
    <svg {...BASE} className={className} aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}

export function IconCerrar({ className }: IconProps) {
  return (
    <svg {...BASE} className={className} aria-hidden="true">
      <path d="m6 6 12 12" />
      <path d="m18 6-12 12" />
    </svg>
  );
}

/** Chevron hacia abajo — trigger del dropdown de perfil (Día 2026-08-16). */
export function IconChevronAbajo({ className }: IconProps) {
  return (
    <svg {...BASE} className={className} aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** Pin de ubicación — indicador de sede en el navbar (Día 2026-08-16). */
export function IconUbicacion({ className }: IconProps) {
  return (
    <svg {...BASE} className={className} aria-hidden="true">
      <path d="M12 21s-6.5-5.6-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5.4-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.3" />
    </svg>
  );
}

/** Llave — link a "Cambiar contraseña" en el dropdown de perfil (Día 2026-08-16). */
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

/** Puerta con flecha de salida — "Cerrar sesión" en el dropdown de perfil (Día 2026-08-16). */
export function IconSalir({ className }: IconProps) {
  return (
    <svg {...BASE} className={className} aria-hidden="true">
      <path d="M13 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6" />
      <path d="M11 12h9" />
      <path d="m16.5 7.5 4.5 4.5-4.5 4.5" />
    </svg>
  );
}

/** Calendario — link a "Calendario" en el sidebar (Fase 15, Día 43). Heroicons outline "calendar". */
export function IconCalendario({ className }: IconProps) {
  return (
    <svg {...BASE} className={className} aria-hidden="true">
      <path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
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

/** Escudo con cruz médica — botón de pánico del topbar (módulo de emergencia, 2026-09-08). */
export function IconEmergencia({ className }: IconProps) {
  return (
    <svg {...BASE} className={className} aria-hidden="true">
      <path d="M12 2 3 7v6c0 5 3.8 8.5 9 9 5.2-.5 9-4 9-9V7l-9-5Z" />
      <path d="M12 8v6M9 11h6" />
    </svg>
  );
}
