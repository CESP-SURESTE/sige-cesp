'use client';

import { useState } from 'react';
import { LABEL_CLASS } from '@/components/admin/ui/persona-alta/estilos';
import { Select } from '@/components/admin/ui/persona-alta/Select';
import type { EstatusAcademico } from '@/lib/api/personas';

/**
 * `CambiarEstatusAlumnoModal` — versión simplificada de `CambiarEstatusModal`
 * (que es específico de `EstatusEmpleado`, maestro/administrativo). El enum
 * de alumno (`EstatusAcademico`) no tiene el concepto de `tipoLicencia`/
 * `motivoBaja`, así que este modal es un solo `<Select>` sin campos
 * condicionales — mismo patrón visual (overlay `fixed inset-0 z-50 ...`,
 * panel `rounded-lg bg-white p-6 shadow-lg max-w-md`).
 *
 * Prellenado con el estatus actual de la persona (`persona.estatus`) — el
 * admin puede volver a guardar el mismo valor sin que eso sea un error, el
 * backend simplemente vuelve a escribirlo (idempotente).
 */

const ESTATUS_ACADEMICO_LABEL: Record<EstatusAcademico, string> = {
  INSCRITO: 'Inscrito',
  BAJA_TEMPORAL: 'Baja temporal',
  BAJA_DEFINITIVA: 'Baja definitiva',
  EGRESADO: 'Egresado',
};

const ESTATUS_ACADEMICO_OPTIONS = (
  Object.entries(ESTATUS_ACADEMICO_LABEL) as Array<[EstatusAcademico, string]>
).map(([value, label]) => ({ value, label }));

export interface CambiarEstatusAlumnoModalProps {
  persona: {
    estatus: EstatusAcademico;
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string | null;
  };
  guardando: boolean;
  onGuardar: (estatus: EstatusAcademico) => void;
  onCancelar: () => void;
}

export function CambiarEstatusAlumnoModal({
  persona,
  guardando,
  onGuardar,
  onCancelar,
}: CambiarEstatusAlumnoModalProps) {
  const [estatus, setEstatus] = useState<EstatusAcademico>(persona.estatus);

  const nombreCompleto = [
    persona.nombres,
    persona.apellidoPaterno,
    persona.apellidoMaterno,
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
          <label htmlFor="cambiar-estatus-alumno-select" className={LABEL_CLASS}>
            Estatus académico
          </label>
          <Select
            id="cambiar-estatus-alumno-select"
            value={estatus}
            onChange={(valor) => setEstatus(valor as EstatusAcademico)}
            options={ESTATUS_ACADEMICO_OPTIONS}
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
