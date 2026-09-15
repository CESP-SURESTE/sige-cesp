/**
 * Skeletons de carga para app/admin/* — Tailwind `animate-pulse`, sin
 * dependencia nueva. Ver docs/superpowers/specs/2026-09-05-skeleton-loaders-design.md.
 *
 * Regla 11 de CLAUDE.md raíz: este archivo se duplica a propósito en
 * components/alumno/ui/Skeleton.tsx, components/maestro/ui/Skeleton.tsx y
 * app/plataforma/Skeleton.tsx — sin import cruzado entre árboles.
 */

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-mist ${className}`} />;
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

/** Card de perfil con `sections` bloques, cada uno con un título y
 * `fieldsPerSection` pares etiqueta/valor en grid — mismo patrón visual que
 * las secciones reales de app/admin/perfil/page.tsx. */
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

/** Fila de tiles de KPI (dashboard). */
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

/** Grilla mensual — 6 semanas x 7 días = 42 celdas, calcado de
 * generarGridMensual()/rangoDelGrid() en app/admin/calendario/mes-grid.util.ts. */
export function SkeletonCalendarGrid() {
  return (
    <div className="mt-6 grid grid-cols-7 gap-2">
      {Array.from({ length: 42 }).map((_, i) => (
        <SkeletonBlock key={i} className="h-20 w-full" />
      ))}
    </div>
  );
}

/** Barras simples sueltas — para secciones chicas embebidas o estados de
 * carga de una sola línea (ej. un status corto dentro de un modal). */
export function SkeletonLines({ count = 3 }: { count?: number }) {
  return (
    <div className="mt-3 space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonBlock key={i} className="h-4 w-full max-w-sm" />
      ))}
    </div>
  );
}
