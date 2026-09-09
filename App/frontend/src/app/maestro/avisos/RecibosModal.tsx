'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ApiError } from '@/lib/api/http';
import { obtenerRecibosAviso, type DestinatarioRecibo } from '@/lib/api/avisos';

interface RecibosModalProps {
  avisoId: string;
  tituloAviso: string;
  onCerrar: () => void;
}

const ROL_LABEL: Record<DestinatarioRecibo['rol'], string> = {
  ALUMNO: 'Alumno',
  MAESTRO: 'Maestro',
  ADMINISTRATIVO: 'Administrativo',
};

function formatearFechaHora(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return iso;
  return fecha.toLocaleString('es-MX');
}

/**
 * Recibos de lectura de un aviso publicado — local a `app/maestro/avisos/`
 * (regla 11 de `CLAUDE.md` raíz — no se importa de `app/admin/`). El
 * "recibo" es el `leidoEn` de la `Notificacion` de cada destinatario
 * (`GET /avisos/:id/recibos`).
 */
export function RecibosModal({ avisoId, tituloAviso, onCerrar }: RecibosModalProps) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCerrar();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCerrar]);

  const recibosQuery = useQuery({
    queryKey: ['maestro', 'avisos', 'recibos', avisoId],
    queryFn: async () => {
      try {
        return await obtenerRecibosAviso(avisoId);
      } catch (err) {
        console.error('[RecibosModal]', err);
        throw err;
      }
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate/40 p-4 pt-16"
      onClick={onCerrar}
    >
      <div
        className="w-full max-w-lg rounded-lg bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg font-semibold text-slate">{tituloAviso}</h2>

        {recibosQuery.isLoading && (
          <p className="mt-3 text-sm text-slate/60">Cargando…</p>
        )}

        {recibosQuery.isError && (
          <p className="mt-3 text-sm text-crimson">
            {recibosQuery.error instanceof ApiError
              ? recibosQuery.error.message
              : 'No se pudieron cargar los recibos. Intenta de nuevo más tarde.'}
          </p>
        )}

        {recibosQuery.data && (
          <>
            <p className="mt-2 font-display text-2xl font-semibold text-navy">
              {recibosQuery.data.leidos} / {recibosQuery.data.total} leyeron
            </p>
            <p className="text-sm text-slate/60">
              {recibosQuery.data.noLeidos} sin leer
            </p>

            <ul className="mt-4 divide-y divide-mist">
              {recibosQuery.data.destinatarios.map((d) => (
                <li
                  key={d.usuarioId}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-slate">{d.nombreCompleto}</span>
                    <span className="shrink-0 rounded-full bg-mist/60 px-2 py-0.5 text-xs text-slate/70">
                      {ROL_LABEL[d.rol]}
                    </span>
                  </span>
                  <span className="shrink-0">
                    {d.leidoEn ? (
                      <span className="text-slate/70">
                        Leído {formatearFechaHora(d.leidoEn)}
                      </span>
                    ) : (
                      <span className="text-slate/50">Sin leer</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
