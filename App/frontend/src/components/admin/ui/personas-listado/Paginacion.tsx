'use client';

/**
 * `Paginacion` — Fase 5, Día 19.
 *
 * Paginación simple (prev/anterior + siguiente + indicador "página X de Y"),
 * usa `page`/`limit`/`total` tal cual los devuelve el backend (`GET
 * /personas`, `CLAUDE.md` raíz: "+ `page`/`limit`/`total` en listas
 * paginadas"). Sin números de página clicables ni "ir a página N" — fuera de
 * alcance del roadmap ("paginación simple").
 *
 * Compartido entre `app/admin/alumnos/page.tsx` y `app/admin/maestros/page.tsx`.
 */
export function Paginacion({
  page,
  limit,
  total,
  onPageChange,
}: {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPaginas = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="flex items-center justify-between border-t border-mist pt-4">
      <p className="text-sm text-slate/60">
        {total === 0
          ? 'Sin resultados'
          : `${total} resultado${total === 1 ? '' : 's'} — página ${page} de ${totalPaginas}`}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-lg border border-mist px-3 py-1.5 text-sm font-medium text-slate transition-colors hover:bg-bone disabled:cursor-not-allowed disabled:opacity-40"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Anterior
        </button>
        <button
          type="button"
          className="rounded-lg border border-mist px-3 py-1.5 text-sm font-medium text-slate transition-colors hover:bg-bone disabled:cursor-not-allowed disabled:opacity-40"
          disabled={page >= totalPaginas}
          onClick={() => onPageChange(page + 1)}
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}
