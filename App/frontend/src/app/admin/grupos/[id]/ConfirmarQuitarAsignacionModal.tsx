'use client';

import type { AsignacionListItem } from '@/lib/api/grupos';

interface ConfirmarQuitarAsignacionModalProps {
  asignacion: AsignacionListItem;
  quitando: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}

/**
 * Modal de confirmación local a `app/admin/grupos/[id]/` — copia estructural
 * de `./ConfirmarQuitarAlumnoModal.tsx`, adaptada a `AsignacionListItem`.
 * Sin import cruzado (regla 11, modal local por sección).
 */
export function ConfirmarQuitarAsignacionModal({
  asignacion,
  quitando,
  onConfirmar,
  onCancelar,
}: ConfirmarQuitarAsignacionModalProps) {
  const nombreMaestro = [
    asignacion.maestro.apellidoPaterno,
    asignacion.maestro.apellidoMaterno,
    asignacion.maestro.nombres,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-slate">
          Quitar maestro de la materia
        </h2>
        <p className="mt-2 text-sm text-slate/80">
          ¿Quitar a <strong>{nombreMaestro}</strong> de la materia{' '}
          <strong>{asignacion.materia.nombre}</strong>? Podrás volver a
          asignarlo después.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancelar}
            disabled={quitando}
            className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={quitando}
            className="rounded-lg bg-crimson px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-crimson/90 disabled:opacity-50"
          >
            {quitando ? 'Quitando…' : 'Quitar'}
          </button>
        </div>
      </div>
    </div>
  );
}
