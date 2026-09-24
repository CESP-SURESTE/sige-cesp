import type { EstatusAcademico } from '@/lib/api/personas';

const ESTATUS_ACADEMICO_LABEL: Record<EstatusAcademico, string> = {
  INSCRITO: 'Inscrito',
  BAJA_TEMPORAL: 'Baja temporal',
  BAJA_DEFINITIVA: 'Baja definitiva',
  EGRESADO: 'Egresado',
};

/**
 * `INSCRITO` es el estado normal/activo (verde, `success`), las 2 bajas usan
 * `warning`/`error` (mismo criterio de severidad creciente que
 * `EstatusEmpleadoBadge`: temporal es reversible, definitiva no). `EGRESADO`
 * no es ni bueno ni malo — es el cierre normal de un ciclo, así que usa los
 * tokens neutrales `border-mist`/`bg-bone`/`text-slate` (mismos que el resto
 * de la UI de admin usa para "informativo, sin carga de error/éxito"), no
 * verde/rojo.
 */
const ESTATUS_ACADEMICO_ESTILO: Record<EstatusAcademico, string> = {
  INSCRITO: 'border-success-border bg-success-bg text-success',
  BAJA_TEMPORAL: 'border-warning-border bg-warning-bg text-warning',
  BAJA_DEFINITIVA: 'border-error-border bg-error-bg text-crimson',
  EGRESADO: 'border-mist bg-bone text-slate',
};

/**
 * Badge de color para `EstatusAcademico` (ALUMNO) — versión simplificada de
 * `EstatusEmpleadoBadge`: el enum de alumno no tiene el concepto de
 * `tipoLicencia`, así que este badge no soporta tooltip ni campo opcional
 * extra.
 */
export function EstatusAcademicoBadge({
  estatus,
}: {
  estatus: EstatusAcademico;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${ESTATUS_ACADEMICO_ESTILO[estatus]}`}
    >
      {ESTATUS_ACADEMICO_LABEL[estatus]}
    </span>
  );
}
