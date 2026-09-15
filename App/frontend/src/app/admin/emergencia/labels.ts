import type { TipoExpediente } from '@/lib/api/emergencia';

/**
 * Diccionarios de labels legibles del módulo de emergencia. Local al árbol
 * `app/admin/emergencia/` (regla 11) — lo comparten `page.tsx` (chip de rol +
 * fila de resultado) y `ExpedientePanel.tsx` (encabezado del expediente), que
 * antes duplicaban `TIPO_CHIP` / `TIPO_ROL_LABEL` idénticos.
 */

/** Tipo de persona (rol con cuenta + `PERSONAL_SERVICIOS`) → texto legible. */
export const TIPO_ROL_LABEL: Record<TipoExpediente, string> = {
  ALUMNO: 'Alumno',
  MAESTRO: 'Maestro',
  ADMINISTRATIVO: 'Administrativo',
  PERSONAL_SERVICIOS: 'Personal de servicios',
};

/** `PuestoAdministrativo` de Prisma → texto legible. */
const PUESTO_ADMIN_LABEL: Record<string, string> = {
  DIRECTOR: 'Director',
  COORDINADOR_ACADEMICO: 'Coordinador académico',
  COORDINADOR_ADMINISTRATIVO: 'Coordinador administrativo',
  AUXILIAR: 'Auxiliar',
  RECEPCION: 'Recepción',
  OTRO: 'Otro',
};

/** `AreaPersonalServicios` de Prisma → texto legible. */
const AREA_PERSONAL_LABEL: Record<string, string> = {
  INTENDENCIA: 'Intendencia',
  SEGURIDAD: 'Seguridad',
  JARDINERIA: 'Jardinería',
  MANTENIMIENTO: 'Mantenimiento',
  OTRO: 'Otro',
};

/**
 * Humaniza el `referencia` del buscador/expediente según el tipo de persona.
 * ADMINISTRATIVO (`PuestoAdministrativo`) y PERSONAL_SERVICIOS
 * (`AreaPersonalServicios`) llegan como enum crudo del backend; ALUMNO
 * (matrícula) y MAESTRO (cédula / "Sin cédula") ya vienen legibles y se
 * muestran tal cual. Un valor sin entrada en el diccionario cae al crudo.
 */
export function humanizarReferencia(
  tipo: TipoExpediente,
  referencia: string,
): string {
  if (tipo === 'ADMINISTRATIVO') {
    return PUESTO_ADMIN_LABEL[referencia] ?? referencia;
  }
  if (tipo === 'PERSONAL_SERVICIOS') {
    return AREA_PERSONAL_LABEL[referencia] ?? referencia;
  }
  return referencia;
}
