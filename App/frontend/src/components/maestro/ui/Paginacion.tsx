'use client';

/**
 * `Paginacion` — árbol MAESTRO. Copia estructural de
 * `components/admin/ui/personas-listado/Paginacion.tsx` (regla 11 de
 * `CLAUDE.md` raíz: se duplica por árbol, sin import cruzado entre
 * `components/{admin,maestro,alumno}/`).
 *
 * Ventana de máximo 3 números alrededor de la página actual + primera/última
 * siempre visibles, con "…" cuando hay hueco. Lo usa
 * `app/maestro/avisos/page.tsx`.
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
  const numeros = calcularNumerosVisibles(page, totalPaginas);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-mist pt-4">
      <p className="text-sm text-slate/60">
        {total === 0
          ? 'Sin resultados'
          : `${total} resultado${total === 1 ? '' : 's'} — página ${page} de ${totalPaginas}`}
      </p>
      <div className="flex items-center gap-1">
        <BotonPagina
          etiqueta="Anterior"
          ariaLabel="Página anterior"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        />
        {numeros.map((n, i) =>
          n === '…' ? (
            <span key={`ellipsis-${i}`} className="px-1.5 text-sm text-slate/40" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={n}
              type="button"
              aria-label={`Ir a la página ${n}`}
              aria-current={n === page ? 'page' : undefined}
              onClick={() => onPageChange(n)}
              className={[
                'min-w-8 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors',
                n === page ? 'bg-navy text-bone' : 'text-slate hover:bg-mist/50',
              ].join(' ')}
            >
              {n}
            </button>
          ),
        )}
        <BotonPagina
          etiqueta="Siguiente"
          ariaLabel="Página siguiente"
          disabled={page >= totalPaginas}
          onClick={() => onPageChange(page + 1)}
        />
      </div>
    </div>
  );
}

function BotonPagina({
  etiqueta,
  ariaLabel,
  disabled,
  onClick,
}: {
  etiqueta: string;
  ariaLabel: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className="rounded-lg border border-mist px-3 py-1.5 text-sm font-medium text-slate transition-colors hover:bg-bone disabled:cursor-not-allowed disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
    >
      {etiqueta}
    </button>
  );
}

/**
 * Primera y última página siempre visibles + una ventana de hasta 3 números
 * alrededor de la actual — el resto se colapsa en "…". Devuelve `number[]`
 * mezclado con el literal `'…'` para los huecos (el caller distingue por
 * valor).
 */
function calcularNumerosVisibles(
  page: number,
  totalPaginas: number,
): Array<number | '…'> {
  const VENTANA = 1;

  const paginas = new Set<number>([1, totalPaginas]);
  for (let p = page - VENTANA; p <= page + VENTANA; p++) {
    if (p >= 1 && p <= totalPaginas) paginas.add(p);
  }

  const ordenadas = [...paginas].sort((a, b) => a - b);
  const resultado: Array<number | '…'> = [];
  for (let i = 0; i < ordenadas.length; i++) {
    if (i > 0 && ordenadas[i] - ordenadas[i - 1] > 1) {
      resultado.push('…');
    }
    resultado.push(ordenadas[i]);
  }
  return resultado;
}
