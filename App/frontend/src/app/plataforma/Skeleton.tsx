/**
 * Skeletons de carga para app/plataforma/* — Tailwind `animate-pulse`, sin
 * dependencia nueva. Ver docs/superpowers/specs/2026-09-05-skeleton-loaders-design.md.
 *
 * Regla 11 de CLAUDE.md raíz (extendida a este árbol por consistencia): este
 * archivo se duplica a propósito respecto a components/admin/ui/Skeleton.tsx,
 * components/alumno/ui/Skeleton.tsx y components/maestro/ui/Skeleton.tsx —
 * sin import cruzado. Colocado junto a las páginas, mismo patrón que
 * SedeModal.tsx/ConfirmarEliminarSedeModal.tsx (plataforma no tiene
 * components/ui/ propio).
 */

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-mist ${className}`} />;
}

/** Bloque hero + cifras del dashboard global (número grande + 3 KPI). Único
 * consumidor: `../page.tsx` — su forma sigue exactamente el layout real para
 * que no haya salto de tamaño al terminar de cargar. */
export function SkeletonHeroStats() {
  return (
    <div className="grid grid-cols-1 gap-8 border-b border-mist pb-8 lg:grid-cols-[1.7fr_1fr]">
      <div>
        <SkeletonBlock className="h-4 w-44" />
        <SkeletonBlock className="mt-3 h-14 w-36" />
        <SkeletonBlock className="mt-5 h-1 w-14" />
      </div>
      <div className="grid grid-cols-3 border-t border-mist pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-10">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="pl-4 first:pl-0">
            <SkeletonBlock className="h-7 w-12" />
            <SkeletonBlock className="mt-2 h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Barras simples sueltas — para listas cortas (ej. "alumnos por sede"). */
export function SkeletonLines({ count = 3 }: { count?: number }) {
  return (
    <div className="mt-3 space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonBlock key={i} className="h-4 w-full max-w-sm" />
      ))}
    </div>
  );
}

/** Filas de skeleton para dentro de un <tbody> — el <table>/<thead> real
 * sigue montado, esto solo reemplaza el contenido del body mientras carga. */
export function SkeletonTableRows({
  columns,
  rows = 5,
}: {
  columns: number;
  rows?: number;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: columns }).map((_, c) => (
            <td key={c} className="px-4 py-3">
              <SkeletonBlock className="h-4 w-full max-w-40" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
