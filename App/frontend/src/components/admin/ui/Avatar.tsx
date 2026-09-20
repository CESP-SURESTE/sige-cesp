'use client';

import { useState } from 'react';

/**
 * `Avatar` — feature "Foto de perfil" (2026-09-17). Copia local al árbol
 * `admin` (regla 11 de `CLAUDE.md` raíz — sin componentes compartidos entre
 * `app/admin/`, `app/alumno/`, `app/maestro/`); es la única de las 3 copias
 * con más de una superficie que lo necesita (los 3 listados + el expediente
 * de emergencia) — mismo componente que `components/alumno/ui/Avatar.tsx` y
 * `components/maestro/ui/Avatar.tsx`. Los `ProfileDropdown` de los 3 árboles
 * NO lo usan: ahí la foto vive dentro de un `motion.span` con `layoutId`
 * compartido para la animación de Framer Motion (ver `ProfileDropdown.tsx`),
 * envolverlo en este componente complicaría esa coreografía sin ganar nada
 * (un solo caso más no justifica generalizar — mismo criterio que
 * `SubirMallaModal.tsx`).
 *
 * `onError` (ronda de fix del review final de rama, 2026-09-20): la URL
 * firmada expira a los 900s — sin esto, una pestaña dejada abierta más de
 * 15 min mostraba el ícono de imagen rota en vez de caer a las iniciales.
 */
export interface AvatarProps {
  fotoUrl: string | null;
  iniciales: string;
  tamano?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const TAMANOS: Record<NonNullable<AvatarProps['tamano']>, string> = {
  sm: 'size-6 text-xs',
  md: 'size-8 text-sm',
  lg: 'size-16 text-xl',
  // `xl` — agregado en la ronda de fix del review de Task 6 (2026-09-17):
  // el encabezado de los 3 perfiles (`EncabezadoPerfil` en
  // `app/{admin/perfil,alumno,maestro}/page.tsx`) usaba antes un círculo
  // responsive de `h-24 w-24 sm:h-32 sm:w-32` (96–128px) para el
  // avatar/iniciales — `lg` (`size-16`, 64px fijo, sin variante responsive)
  // se quedaba corto ahí. Solo utilidades `size-*` (nunca mezclar `h-*`/`w-*`
  // sueltas con `size-*` en el `className` de un consumidor — dos utilidades
  // de Tailwind que tocan la misma propiedad compiten por el orden interno
  // del motor, no por el orden en el string de clases, así que un
  // `className` externo NUNCA debe intentar pisar el tamaño de este
  // componente; si un tamaño no alcanza, se agrega una variante nueva acá,
  // como esta). `lg` se queda intacto — lo sigue usando el expediente de
  // emergencia (Task 8).
  xl: 'size-24 text-2xl sm:size-32 sm:text-4xl',
};

export function Avatar({
  fotoUrl,
  iniciales,
  tamano = 'md',
  className = '',
}: AvatarProps) {
  const [error, setError] = useState(false);
  const base = `flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-navy font-semibold text-bone ${TAMANOS[tamano]} ${className}`;

  if (fotoUrl && !error) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Supabase Storage (dominio externo), mismo criterio que FondoEventos en app/login/page.tsx
      <img
        src={fotoUrl}
        alt=""
        className={`${base} object-cover`}
        onError={() => setError(true)}
      />
    );
  }
  return (
    <span aria-hidden="true" className={base}>
      {iniciales}
    </span>
  );
}
