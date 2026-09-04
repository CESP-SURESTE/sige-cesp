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

/** Fila de tiles de KPI (dashboard global). */
export function SkeletonStatTiles({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border-l-4 border-mist bg-white p-4 shadow-sm">
          <SkeletonBlock className="h-7 w-12" />
          <SkeletonBlock className="mt-2 h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Barras simples sueltas — para listas cortas (ej. "alumnos por sede"). */
export function SkeletonLines({ count = 3 }: { count?: number }) {
  return (
    <div className="mt-4 space-y-3">
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
