/**
 * `Avatar` — feature "Foto de perfil" (2026-09-17). Copia local al árbol
 * `maestro` (regla 11 de `CLAUDE.md` raíz — sin componentes compartidos entre
 * `app/admin/`, `app/alumno/`, `app/maestro/`), mismo componente que
 * `components/admin/ui/Avatar.tsx` (ahí sí sirve más de una superficie: los
 * 3 listados + el expediente de emergencia) y `components/alumno/ui/Avatar.tsx`.
 * Acá solo lo consume `app/maestro/page.tsx` (encabezado del propio perfil) —
 * el `ProfileDropdown` de este árbol NO lo usa: ahí la foto vive dentro de un
 * `motion.span` con `layoutId` compartido para la animación de Framer Motion
 * (ver `ProfileDropdown.tsx`), envolverlo en este componente complicaría esa
 * coreografía sin ganar nada.
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
  // el encabezado del perfil (`EncabezadoPerfil` en `app/maestro/page.tsx`)
  // usaba antes un círculo responsive de `h-24 w-24 sm:h-32 sm:w-32`
  // (96–128px) para el avatar/iniciales — `lg` (`size-16`, 64px fijo, sin
  // variante responsive) se quedaba corto ahí. Solo utilidades `size-*`
  // (nunca mezclar `h-*`/`w-*` sueltas con `size-*` en el `className` de un
  // consumidor — dos utilidades de Tailwind que tocan la misma propiedad
  // compiten por el orden interno del motor, no por el orden en el string
  // de clases, así que un `className` externo NUNCA debe intentar pisar el
  // tamaño de este componente; si un tamaño no alcanza, se agrega una
  // variante nueva acá, como esta). `lg` se queda intacto.
  xl: 'size-24 text-2xl sm:size-32 sm:text-4xl',
};

export function Avatar({
  fotoUrl,
  iniciales,
  tamano = 'md',
  className = '',
}: AvatarProps) {
  const base = `flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-navy font-semibold text-bone ${TAMANOS[tamano]} ${className}`;

  if (fotoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Supabase Storage (dominio externo), mismo criterio que FondoEventos en app/login/page.tsx
      <img src={fotoUrl} alt="" className={`${base} object-cover`} />
    );
  }
  return (
    <span aria-hidden="true" className={base}>
      {iniciales}
    </span>
  );
}
