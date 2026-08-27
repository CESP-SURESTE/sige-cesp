import type { EstatusEmpleado, TipoLicencia } from '@/lib/api/personas';

const ESTATUS_EMPLEADO_LABEL: Record<EstatusEmpleado, string> = {
  ACTIVO: 'Activo',
  LICENCIA: 'Licencia',
  BAJA: 'Baja',
};

const ESTATUS_EMPLEADO_ESTILO: Record<EstatusEmpleado, string> = {
  ACTIVO: 'border-success-border bg-success-bg text-success',
  LICENCIA: 'border-warning-border bg-warning-bg text-warning',
  BAJA: 'border-error-border bg-error-bg text-crimson',
};

/** Mismo texto que `TIPO_LICENCIA_LABEL` de `CambiarEstatusModal.tsx` —
 * duplicado a propósito (mismo criterio que `ESTATUS_EMPLEADO_LABEL` de
 * arriba, ya duplicado entre ambos archivos), no se extrajo a un módulo
 * compartido para un mapa de 9 valores. */
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

/**
 * Badge de color para `EstatusEmpleado` (MAESTRO/ADMINISTRATIVO) — a
 * diferencia de `EstadoActivoBadge` (verde/ámbar, "inactivo" es ciclo de
 * vida no error), acá SÍ se usa rojo/crimson para BAJA a propósito: con 3
 * estados reales (no 2) se necesita diferenciar visualmente BAJA de
 * LICENCIA, y "dar de baja" (sobre todo por renuncia/despido) amerita la
 * alerta fuerte. Decisión explícita del usuario, 2026-08-26.
 *
 * `tipoLicencia` (feature estética, 2026-08-26) es opcional — hoy solo lo
 * pasa `app/admin/administrativos/page.tsx` (único consumidor de este
 * componente que trae el dato en su `PersonaListItem`). Cuando viene y el
 * estatus es `LICENCIA`, se muestra como `title` nativo (mismo mecanismo de
 * tooltip que ya usa `Sidebar.tsx`, sin dependencia nueva) — sin `title`
 * cuando no aplica, para no mostrar un tooltip vacío/redundante.
 */
export function EstatusEmpleadoBadge({
  estatus,
  tipoLicencia,
}: {
  estatus: EstatusEmpleado;
  tipoLicencia?: TipoLicencia | null;
}) {
  const titulo =
    estatus === 'LICENCIA' && tipoLicencia
      ? `Motivo: ${TIPO_LICENCIA_LABEL[tipoLicencia]}`
      : undefined;

  return (
    <span
      title={titulo}
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${ESTATUS_EMPLEADO_ESTILO[estatus]}`}
    >
      {ESTATUS_EMPLEADO_LABEL[estatus]}
    </span>
  );
}
