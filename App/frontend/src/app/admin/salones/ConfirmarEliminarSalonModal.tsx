'use client';

import type { Salon } from '@/lib/api/salones';

interface ConfirmarEliminarSalonModalProps {
  salon: Salon;
  onConfirmar: () => void;
  onCancelar: () => void;
  eliminando: boolean;
}

/**
 * Modal de confirmación local a `app/admin/salones/` — copia estructural de
 * `app/plataforma/sedes/ConfirmarEliminarSedeModal.tsx` (mismo patrón visual,
 * mismas clases), código propio adaptado a `Salon` en vez de `Sede`. Sin
 * import cruzado: `app/plataforma/` es un árbol de identidad distinta
 * (regla 11 de `CLAUDE.md` raíz, aplicada por prudencia también acá aunque
 * la regla solo prohíbe explícitamente compartir con alumno/maestro).
 */
export function ConfirmarEliminarSalonModal({
  salon,
  onConfirmar,
  onCancelar,
  eliminando,
}: ConfirmarEliminarSalonModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-slate">
          Eliminar salón
        </h2>
        <p className="mt-2 text-sm text-slate/80">
          ¿Seguro que quieres eliminar <strong>{salon.nombre}</strong>? Esta
          acción no se puede deshacer.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancelar}
            disabled={eliminando}
            className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={eliminando}
            className="rounded-lg bg-crimson px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-crimson/90 disabled:opacity-50"
          >
            {eliminando ? 'Eliminando…' : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  );
}
