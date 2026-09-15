/**
 * Skeletons de carga para app/alumno/* — Tailwind `animate-pulse`, sin
 * dependencia nueva. Ver docs/superpowers/specs/2026-09-05-skeleton-loaders-design.md.
 *
 * Regla 11 de CLAUDE.md raíz: este archivo se duplica a propósito en
 * components/admin/ui/Skeleton.tsx, components/maestro/ui/Skeleton.tsx y
 * app/plataforma/Skeleton.tsx — sin import cruzado entre árboles.
 */

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-mist ${className}`} />;
}

/** Card de perfil con `sections` bloques, cada uno con un título y
 * `fieldsPerSection` pares etiqueta/valor en grid. Aproximación deliberada
 * del layout real de app/alumno/page.tsx (encabezado + sidebar + panel,
 * rediseño 2026-08-21) — el skeleton no clona el DOM final pixel a pixel,
 * solo comunica "aquí va contenido de perfil" mientras carga. */
export function SkeletonProfileCard({
  sections = 2,
  fieldsPerSection = 4,
}: {
  sections?: number;
  fieldsPerSection?: number;
}) {
  return (
    <div className="mt-6 space-y-6">
      {Array.from({ length: sections }).map((_, s) => (
        <div key={s} className="rounded-lg border border-mist p-5">
          <SkeletonBlock className="h-4 w-32" />
          <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            {Array.from({ length: fieldsPerSection }).map((_, f) => (
              <div key={f}>
                <SkeletonBlock className="h-3 w-20" />
                <SkeletonBlock className="mt-2 h-4 w-36" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Grilla mensual — 6 semanas x 7 días = 42 celdas, mismo criterio que
 * app/admin/calendario/mes-grid.util.ts (rangoDelGrid). */
export function SkeletonCalendarGrid() {
  return (
    <div className="mt-6 grid grid-cols-7 gap-2">
      {Array.from({ length: 42 }).map((_, i) => (
        <SkeletonBlock key={i} className="h-20 w-full" />
      ))}
    </div>
  );
}

/** Barras simples sueltas — para secciones chicas embebidas. */
export function SkeletonLines({ count = 3 }: { count?: number }) {
  return (
    <div className="mt-3 space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonBlock key={i} className="h-4 w-full max-w-sm" />
      ))}
    </div>
  );
}
