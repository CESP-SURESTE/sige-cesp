'use client';

import type { Sede } from '@/lib/api/sedes';

interface ConfirmarEliminarSedeModalProps {
  sede: Sede;
  onConfirmar: () => void;
  onCancelar: () => void;
  eliminando: boolean;
}

/**
 * Modal de confirmación local a `app/plataforma/sedes/` — sin componente
 * compartido con `admin`/`alumno` (este árbol ya vive aislado del resto del
 * frontend desde Día 20: JWT propio, `localStorage`, sin `proxy.ts`). Primer
 * modal del repo — no hay un componente `Modal`/`Dialog` genérico que
 * reusar todavía.
 */
export function ConfirmarEliminarSedeModal({
  sede,
  onConfirmar,
  onCancelar,
  eliminando,
}: ConfirmarEliminarSedeModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-slate">
          Eliminar sede
        </h2>
        <p className="mt-2 text-sm text-slate/80">
          ¿Seguro que quieres eliminar <strong>{sede.nombre}</strong>? Si la
          sede tiene datos asociados (cuentas, carreras, grupos) se marcará
          como inactiva en vez de eliminarse, y podrás reactivarla después.
          Solo una sede sin ningún dato asociado se elimina de forma
          permanente.
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
