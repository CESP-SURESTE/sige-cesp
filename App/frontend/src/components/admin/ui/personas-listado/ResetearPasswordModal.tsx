'use client';

/**
 * Modal de confirmación para `POST /personas/:id/resetear-password` — mismo
 * patrón visual que `CambiarEstatusModal.tsx` (overlay + panel `max-w-md`),
 * pero sin campos: es una confirmación simple, no un formulario. NO muestra
 * el correo destino real (el listado de personas no expone `correoPersonal`
 * en su contrato, y no se extiende solo para esto — evita exponer PII en un
 * modal de confirmación).
 */
export interface ResetearPasswordModalProps {
  nombreCompleto: string;
  enviando: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}

export function ResetearPasswordModal({
  nombreCompleto,
  enviando,
  onConfirmar,
  onCancelar,
}: ResetearPasswordModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-slate">
          Restablecer contraseña
        </h2>
        <p className="mt-2 text-sm text-slate/80">
          ¿Restablecer la contraseña de <strong>{nombreCompleto}</strong>? Se
          enviará un enlace a su correo personal registrado.
        </p>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancelar}
            disabled={enviando}
            className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={enviando}
            className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
          >
            {enviando ? 'Enviando…' : 'Enviar enlace'}
          </button>
        </div>
      </div>
    </div>
  );
}
