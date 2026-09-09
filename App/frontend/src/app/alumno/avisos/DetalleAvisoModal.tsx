'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ApiError } from '@/lib/api/http';
import { obtenerDetalleAviso } from '@/lib/api/avisos';

interface DetalleAvisoModalProps {
  avisoId: string;
  onCerrar: () => void;
}

function formatearFechaHora(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return iso;
  return fecha.toLocaleString('es-MX');
}

/**
 * Detalle de un aviso recibido — local a `app/alumno/avisos/` (regla 11 de
 * `CLAUDE.md` raíz — no se importa de `app/admin/` ni `app/maestro/`). Abrirlo
 * dispara el efecto de backend de `GET /avisos/:id`: marca la `Notificacion`
 * del actor como leída (el recibo de lectura). El padre invalida el feed al
 * cerrar.
 */
export function DetalleAvisoModal({ avisoId, onCerrar }: DetalleAvisoModalProps) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCerrar();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCerrar]);

  const detalleQuery = useQuery({
    queryKey: ['alumno', 'avisos', 'detalle', avisoId],
    queryFn: async () => {
      try {
        return await obtenerDetalleAviso(avisoId);
      } catch (err) {
        console.error('[DetalleAvisoModal]', err);
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
        {detalleQuery.isLoading && <p className="text-sm text-slate/60">Cargando…</p>}

        {detalleQuery.isError && (
          <p className="text-sm text-crimson">
            {detalleQuery.error instanceof ApiError
              ? detalleQuery.error.message
              : 'No se pudo cargar el aviso. Intenta de nuevo más tarde.'}
          </p>
        )}

        {detalleQuery.data && (
          <>
            <h2 className="font-display text-lg font-semibold text-slate">
              {detalleQuery.data.titulo}
            </h2>
            <p className="mt-1 text-sm text-slate/60">
              Por {detalleQuery.data.autor.nombres}{' '}
              {detalleQuery.data.autor.apellidoPaterno} ·{' '}
              {formatearFechaHora(detalleQuery.data.createdAt)}
            </p>
            <p className="mt-4 text-sm whitespace-pre-wrap text-slate">
              {detalleQuery.data.cuerpo}
            </p>
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
