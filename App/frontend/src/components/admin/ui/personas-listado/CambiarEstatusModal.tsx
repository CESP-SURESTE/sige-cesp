'use client';

import { useState } from 'react';
import { LABEL_CLASS } from '@/components/admin/ui/persona-alta/estilos';
import { Select } from '@/components/admin/ui/persona-alta/Select';
import type {
  EstatusEmpleado,
  MotivoBaja,
  TipoLicencia,
} from '@/lib/api/personas';

/**
 * `CambiarEstatusModal` — Fase 10 (unificación CRUD admin) / paridad maestros (2026-08-27).
 *
 * Modal chico de cambio de estatus para una persona (maestro o administrativo),
 * mismo patrón visual que `app/admin/salones/ConfirmarEliminarSalonModal.tsx`
 * (overlay `fixed inset-0 z-50 ...`, panel `rounded-lg bg-white p-6 shadow-lg
 * max-w-md`) — no es un modal de confirmación de borrado, así que el botón
 * principal usa el azul (`bg-navy`) de "guardar", no el rojo de "eliminar".
 *
 * Prellenado con el estatus actual de la persona (`persona.estatus`)
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

const TIPO_LICENCIA_LABEL: Record<TipoLicencia, string> = {
  VACACIONES: 'Vacaciones',
  INCAPACIDAD_ENFERMEDAD_GENERAL: 'Incapacidad por enfermedad general',
  INCAPACIDAD_RIESGO_TRABAJO: 'Incapacidad por riesgo de trabajo',
  MATERNIDAD: 'Maternidad',
  PATERNIDAD: 'Paternidad',
  ADOPCION: 'Adopción',
  PERMISO_CON_GOCE_SUELDO: 'Permiso con goce de sueldo',
  PERMISO_SIN_GOCE_SUELDO: 'Permiso sin goce de sueldo',
  OTRO: 'Otro',
};
const TIPO_LICENCIA_OPTIONS = (
  Object.entries(TIPO_LICENCIA_LABEL) as Array<[TipoLicencia, string]>
).map(([value, label]) => ({ value, label }));

const MOTIVO_BAJA_LABEL: Record<MotivoBaja, string> = {
  RENUNCIA: 'Renuncia',
  DESPIDO: 'Despido',
  BAJA_TEMPORAL_SALUD: 'Baja temporal por salud',
  FALLECIMIENTO: 'Fallecimiento',
  TERMINACION_INCAPACIDAD_PERMANENTE: 'Terminación por incapacidad permanente',
  OTRO: 'Otro',
};
const MOTIVO_BAJA_OPTIONS = (
  Object.entries(MOTIVO_BAJA_LABEL) as Array<[MotivoBaja, string]>
).map(([value, label]) => ({ value, label }));

/** Motivos que revocan el acceso a la cuenta — espejo de
 * `PersonasService.MOTIVOS_BAJA_QUE_REVOCAN` (backend). Mantener en sync. */
const MOTIVOS_BAJA_REVOCAN: MotivoBaja[] = [
  'RENUNCIA',
  'DESPIDO',
  'FALLECIMIENTO',
  'TERMINACION_INCAPACIDAD_PERMANENTE',
];

export interface CambiarEstatusModalProps {
  persona: {
    estatus: EstatusEmpleado;
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string | null;
  };
  guardando: boolean;
  onGuardar: (
    estatus: EstatusEmpleado,
    extra: { tipoLicencia?: TipoLicencia; motivoBaja?: MotivoBaja },
  ) => void;
  onCancelar: () => void;
}

export function CambiarEstatusModal({
  persona,
  guardando,
  onGuardar,
  onCancelar,
}: CambiarEstatusModalProps) {
  const [estatus, setEstatus] = useState<EstatusEmpleado>(persona.estatus);
  const [tipoLicencia, setTipoLicencia] = useState<TipoLicencia | ''>('');
  const [motivoBaja, setMotivoBaja] = useState<MotivoBaja | ''>('');

  const faltaCondicional =
    (estatus === 'LICENCIA' && !tipoLicencia) ||
    (estatus === 'BAJA' && !motivoBaja);

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

        {estatus === 'LICENCIA' && (
          <div className="mt-4">
            <label htmlFor="tipo-licencia-select" className={LABEL_CLASS}>
              Tipo de licencia
            </label>
            <Select
              id="tipo-licencia-select"
              value={tipoLicencia}
              onChange={(valor) => setTipoLicencia(valor as TipoLicencia)}
              options={TIPO_LICENCIA_OPTIONS}
              placeholder="Selecciona un tipo de licencia"
              disabled={guardando}
            />
          </div>
        )}

        {estatus === 'BAJA' && (
          <div className="mt-4">
            <label htmlFor="motivo-baja-select" className={LABEL_CLASS}>
              Motivo de baja
            </label>
            <Select
              id="motivo-baja-select"
              value={motivoBaja}
              onChange={(valor) => setMotivoBaja(valor as MotivoBaja)}
              options={MOTIVO_BAJA_OPTIONS}
              placeholder="Selecciona un motivo"
              disabled={guardando}
            />
            {motivoBaja !== '' && MOTIVOS_BAJA_REVOCAN.includes(motivoBaja) && (
              <p className="mt-2 rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning">
                Esto revocará el acceso a la cuenta de esta persona.
              </p>
            )}
          </div>
        )}

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
            onClick={() =>
              onGuardar(estatus, {
                tipoLicencia:
                  estatus === 'LICENCIA' ? tipoLicencia || undefined : undefined,
                motivoBaja:
                  estatus === 'BAJA' ? motivoBaja || undefined : undefined,
              })
            }
            disabled={guardando || faltaCondicional}
            className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}
