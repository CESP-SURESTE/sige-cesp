'use client';

import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { LABEL_CLASS, INPUT_CLASS } from '@/components/admin/ui/persona-alta/estilos';
import type {
  ActualizarTelefonoInput,
  CrearTelefonoInput,
  TelefonoEmergencia,
} from '@/lib/api/emergencia';

interface TelefonoModalProps {
  /** `null` = modo alta. Objeto real = modo edición, prellena. */
  telefono: TelefonoEmergencia | null;
  guardando: boolean;
  onCrear: (payload: CrearTelefonoInput) => void;
  onEditar: (payload: ActualizarTelefonoInput) => void;
  onCancelar: () => void;
}

export function TelefonoModal({
  telefono, guardando, onCrear, onEditar, onCancelar,
}: TelefonoModalProps) {
  const esAlta = telefono === null;
  const [etiqueta, setEtiqueta] = useState(telefono?.etiqueta ?? '');
  const [numero, setNumero] = useState(telefono?.telefono ?? '');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const et = etiqueta.trim();
    const nu = numero.trim();
    // Ambos campos son obligatorios también al editar: dejar uno en blanco NO
    // es "sin cambio". Sin este guard, el PATCH parcial omitiría el campo
    // vaciado, el backend respondería 200 y saldría "actualizado" sin cambio
    // real (M2 del review final de rama).
    if (!et || !nu) {
      toast.error('Completa la etiqueta y el teléfono.');
      return;
    }
    if (esAlta) {
      onCrear({ etiqueta: et, telefono: nu });
      return;
    }
    onEditar({ etiqueta: et, telefono: nu });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-slate">
          {esAlta ? 'Nuevo teléfono de emergencia' : 'Editar teléfono de emergencia'}
        </h2>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="telefono-modal-etiqueta" className={LABEL_CLASS}>
              Etiqueta
            </label>
            <input
              id="telefono-modal-etiqueta"
              type="text"
              required={esAlta}
              disabled={guardando}
              placeholder="Cruz Roja Tizimín"
              className={INPUT_CLASS}
              value={etiqueta}
              onChange={(e) => setEtiqueta(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="telefono-modal-numero" className={LABEL_CLASS}>
              Teléfono
            </label>
            <input
              id="telefono-modal-numero"
              type="text"
              required={esAlta}
              disabled={guardando}
              placeholder="911 · (986) 863 00 00 · ext. 145"
              className={INPUT_CLASS}
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onCancelar}
              disabled={guardando}
              className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
            >
              {guardando ? 'Guardando…' : esAlta ? 'Agregar' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
