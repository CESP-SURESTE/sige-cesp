'use client';

interface ConfirmarEliminarEventoModalProps {
  eventoId: string;
  titulo: string;
  /** Si es `true`, aclara que se borran TODAS las ocurrencias de la serie
   * (`DELETE /eventos/:id` borra la fila `EventoCalendario` completa, no
   * una ocurrencia suelta — no hay "excepciones por fecha" en v1, ver
   * `recurrencia.util.ts`). */
  esRecurrente: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
  eliminando: boolean;
}

/**
 * Modal de confirmación local a `app/admin/calendario/` — copia
 * estructural de `app/admin/grupos/ConfirmarEliminarGrupoModal.tsx` (mismo
 * patrón visual, mismas clases). Sin import cruzado: cada sección del árbol
 * admin mantiene sus modales locales (regla 11 de `CLAUDE.md` raíz).
 */
export function ConfirmarEliminarEventoModal({
  titulo,
  esRecurrente,
  onConfirmar,
  onCancelar,
  eliminando,
}: ConfirmarEliminarEventoModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-slate">
          Eliminar evento
        </h2>
        <p className="mt-2 text-sm text-slate/80">
          ¿Seguro que quieres eliminar <strong>{titulo}</strong>? Esta acción
          no se puede deshacer.
          {esRecurrente && (
            <>
              {' '}
              Este evento es recurrente — se eliminarán{' '}
              <strong>todas</strong> sus ocurrencias, no solo esta fecha.
            </>
          )}
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
