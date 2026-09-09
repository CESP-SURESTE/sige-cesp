'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '@/lib/api/http';
import { obtenerFeedAvisos } from '@/lib/api/avisos';
import { SkeletonLines } from '@/components/alumno/ui/Skeleton';
import { DetalleAvisoModal } from './DetalleAvisoModal';

/**
 * Feed de avisos recibidos — árbol ALUMNO, Fase 16, UI (Task 5). El alumno
 * NO publica: no hay tabs ni "+ Nuevo aviso" (a diferencia de
 * `app/maestro/avisos/page.tsx` y `app/admin/avisos/page.tsx`). Copia
 * estructural reducida a solo lectura, duplicada dentro del árbol alumno
 * (regla 11 de `CLAUDE.md` raíz — sin import cruzado desde `app/admin/`,
 * `app/maestro/`, `components/admin/` ni `components/maestro/`). Los tipos y
 * llamadas vienen de `@/lib/api/avisos` (infraestructura compartida,
 * permitida).
 *
 * El backend ya filtra `GET /avisos` según el JWT del alumno
 * (`AvisosService`, Días 45-46): el alumno solo ve los avisos que le
 * llegaron a su sede/carrera/grupo(s), sin mandar ningún filtro desde acá.
 *
 * Click en un aviso abre `DetalleAvisoModal`, que dispara el efecto de
 * backend de `GET /avisos/:id` (marca la `Notificacion` del actor como
 * leída); al cerrar el modal se invalida el feed para que el punto de
 * no-leído desaparezca.
 */

const LIMIT = 20;

function formatearFechaHora(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return iso;
  return fecha.toLocaleString('es-MX');
}

export default function AlumnoAvisosPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [detalleId, setDetalleId] = useState<string | null>(null);

  const feedQuery = useQuery({
    queryKey: ['alumno', 'avisos', 'feed', page],
    queryFn: async () => {
      try {
        return await obtenerFeedAvisos({ page, limit: LIMIT });
      } catch (err) {
        // Regla 12 de `CLAUDE.md` raíz.
        console.error('[AlumnoAvisos] feed:', err);
        throw err;
      }
    },
    placeholderData: keepPreviousData,
  });

  const totalPaginas = feedQuery.data
    ? Math.max(1, Math.ceil(feedQuery.data.total / feedQuery.data.limit))
    : 1;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-navy">Avisos</h1>
        <p className="mt-1 text-sm text-slate/60">
          Avisos que has recibido de tu sede, carrera y grupo.
        </p>
      </div>

      <div className="rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        {feedQuery.isLoading && <SkeletonLines count={5} />}

        {feedQuery.isError && (
          <p className="py-6 text-center text-sm text-crimson">
            {feedQuery.error instanceof ApiError
              ? feedQuery.error.message
              : 'No se pudieron cargar los avisos. Intenta de nuevo más tarde.'}
          </p>
        )}

        {!feedQuery.isLoading && !feedQuery.isError && feedQuery.data?.data.length === 0 && (
          <p className="py-6 text-center text-sm text-slate/60">No tienes avisos.</p>
        )}

        {!feedQuery.isLoading && !feedQuery.isError && (feedQuery.data?.data.length ?? 0) > 0 && (
          <ul className="divide-y divide-mist">
            {feedQuery.data?.data.map((aviso) => (
              <li key={aviso.id}>
                <button
                  type="button"
                  onClick={() => setDetalleId(aviso.id)}
                  className="flex w-full items-start justify-between gap-4 py-3 text-left hover:bg-mist/30"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      {aviso.leidoEn === null && (
                        <span
                          className="inline-block size-2 shrink-0 rounded-full bg-navy"
                          aria-label="No leído"
                        />
                      )}
                      <span className="truncate font-medium text-slate">{aviso.titulo}</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-slate/60">
                      Por {aviso.autor.nombres} {aviso.autor.apellidoPaterno}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-slate/60">
                    {formatearFechaHora(aviso.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {feedQuery.data && feedQuery.data.total > 0 && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-mist px-3 py-1.5 font-medium text-slate hover:bg-mist/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ← Anterior
            </button>
            <span className="text-slate/60">
              Página {page} de {totalPaginas}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => (p < totalPaginas ? p + 1 : p))}
              disabled={page >= totalPaginas}
              className="rounded-lg border border-mist px-3 py-1.5 font-medium text-slate hover:bg-mist/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Siguiente →
            </button>
          </div>
        )}
      </div>

      {detalleId && (
        <DetalleAvisoModal
          avisoId={detalleId}
          onCerrar={() => {
            setDetalleId(null);
            void queryClient.invalidateQueries({ queryKey: ['alumno', 'avisos', 'feed'] });
          }}
        />
      )}
    </div>
  );
}
