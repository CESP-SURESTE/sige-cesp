import type { EstatusEmpleado } from '@/lib/api/personas';

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

/**
 * Badge de color para `EstatusEmpleado` (MAESTRO/ADMINISTRATIVO) — a
 * diferencia de `EstadoActivoBadge` (verde/ámbar, "inactivo" es ciclo de
 * vida no error), acá SÍ se usa rojo/crimson para BAJA a propósito: con 3
 * estados reales (no 2) se necesita diferenciar visualmente BAJA de
 * LICENCIA, y "dar de baja" (sobre todo por renuncia/despido) amerita la
 * alerta fuerte. Decisión explícita del usuario, 2026-08-26.
 */
export function EstatusEmpleadoBadge({ estatus }: { estatus: EstatusEmpleado }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${ESTATUS_EMPLEADO_ESTILO[estatus]}`}
    >
      {ESTATUS_EMPLEADO_LABEL[estatus]}
    </span>
  );
}
