'use client';

import type { TelefonoEmergencia } from '@/lib/api/emergencia';

interface ConfirmarEliminarTelefonoModalProps {
  telefono: TelefonoEmergencia;
  onConfirmar: () => void;
  onCancelar: () => void;
  eliminando: boolean;
}

/**
 * Modal de confirmación local a `app/admin/emergencia/` — copia estructural
 * de `app/admin/salones/ConfirmarEliminarSalonModal.tsx` (mismo patrón
 * visual, mismas clases), código propio adaptado a `TelefonoEmergencia`.
 */
export function ConfirmarEliminarTelefonoModal({
  telefono,
  onConfirmar,
  onCancelar,
  eliminando,
}: ConfirmarEliminarTelefonoModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-slate">
          Eliminar teléfono de emergencia
        </h2>
        <p className="mt-2 text-sm text-slate/80">
          ¿Seguro que quieres eliminar <strong>{telefono.etiqueta}</strong>? Esta
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
