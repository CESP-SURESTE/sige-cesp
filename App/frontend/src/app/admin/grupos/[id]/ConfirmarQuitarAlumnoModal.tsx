'use client';

import type { GrupoAlumnoListItem } from '@/lib/api/grupos';

interface ConfirmarQuitarAlumnoModalProps {
  alumno: GrupoAlumnoListItem;
  grupoNombre: string;
  quitando: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}

/**
 * Modal de confirmación local a `app/admin/grupos/[id]/` — copia estructural
 * de `../ConfirmarEliminarGrupoModal.tsx`, adaptada a `GrupoAlumnoListItem`.
 * Sin import cruzado (regla 11, modal local por sección).
 */
export function ConfirmarQuitarAlumnoModal({
  alumno,
  grupoNombre,
  quitando,
  onConfirmar,
  onCancelar,
}: ConfirmarQuitarAlumnoModalProps) {
  const nombreCompleto = [
    alumno.apellidoPaterno,
    alumno.apellidoMaterno,
    alumno.nombres,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-slate">
          Quitar alumno del grupo
        </h2>
        <p className="mt-2 text-sm text-slate/80">
          ¿Quitar a <strong>{nombreCompleto}</strong> del grupo{' '}
          <strong>{grupoNombre}</strong>? Podrás volver a matricularlo después.
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
