'use client';

import { useState } from 'react';
import { LABEL_CLASS } from '@/components/admin/ui/persona-alta/estilos';
import { Select } from '@/components/admin/ui/persona-alta/Select';
import type { EstatusEmpleado, PersonaListItemAdministrativo } from '@/lib/api/personas';

/**
 * `CambiarEstatusModal` — Fase 10 (unificación CRUD admin, Task 5).
 *
 * Modal chico de cambio de estatus para un administrativo, mismo patrón
 * visual que `app/admin/salones/ConfirmarEliminarSalonModal.tsx` (overlay
 * `fixed inset-0 z-50 ...`, panel `rounded-lg bg-white p-6 shadow-lg
 * max-w-md`) — no es un modal de confirmación de borrado, así que el botón
 * principal usa el azul (`bg-navy`) de "guardar", no el rojo de "eliminar".
 *
 * Prellenado con el estatus actual del administrativo (`administrativo.estatus`)
 * — el admin puede volver a guardar el mismo valor sin que eso sea un error,
 * el backend simplemente vuelve a escribirlo (idempotente).
 */

const ESTATUS_EMPLEADO_LABEL: Record<EstatusEmpleado, string> = {
  ACTIVO: 'Activo',
  BAJA: 'Baja',
  LICENCIA: 'Licencia',
};

const ESTATUS_EMPLEADO_OPTIONS = (
  Object.entries(ESTATUS_EMPLEADO_LABEL) as Array<[EstatusEmpleado, string]>
).map(([value, label]) => ({ value, label }));

export interface CambiarEstatusModalProps {
  administrativo: PersonaListItemAdministrativo;
  guardando: boolean;
  onGuardar: (estatus: EstatusEmpleado) => void;
  onCancelar: () => void;
}

export function CambiarEstatusModal({
  administrativo,
  guardando,
  onGuardar,
  onCancelar,
}: CambiarEstatusModalProps) {
  const [estatus, setEstatus] = useState<EstatusEmpleado>(administrativo.estatus);

  const nombreCompleto = [
    administrativo.nombres,
    administrativo.apellidoPaterno,
    administrativo.apellidoMaterno,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-slate">
          Cambiar estatus
        </h2>
        <p className="mt-2 text-sm text-slate/80">
          Cambia el estatus de <strong>{nombreCompleto}</strong>.
        </p>

        <div className="mt-4">
          <label htmlFor="cambiar-estatus-select" className={LABEL_CLASS}>
            Estatus
          </label>
          <Select
            id="cambiar-estatus-select"
            value={estatus}
            onChange={(valor) => setEstatus(valor as EstatusEmpleado)}
            options={ESTATUS_EMPLEADO_OPTIONS}
            placeholder="Selecciona un estatus"
            disabled={guardando}
          />
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancelar}
            disabled={guardando}
            className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onGuardar(estatus)}
            disabled={guardando}
            className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}
