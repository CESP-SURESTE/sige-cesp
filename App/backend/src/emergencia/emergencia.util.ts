import type { TelefonoEmergenciaSede } from '@prisma/client';
import type { ActualizarTelefonoDto } from './dto/actualizar-telefono.dto';

/**
 * Compara cada campo presente en el `dto` contra el valor actual — mismo
 * criterio que `hayCambiosReales` de `SalonesService`/`CarrerasService`. Un
 * campo ausente del `dto` (PATCH parcial o vacío) nunca cuenta como cambio.
 */
export function hayCambiosRealesTelefono(
  dto: ActualizarTelefonoDto,
  existente: Pick<TelefonoEmergenciaSede, 'etiqueta' | 'telefono'>,
): boolean {
  const campos = ['etiqueta', 'telefono'] as const;
  for (const campo of campos) {
    if (dto[campo] !== undefined && dto[campo] !== existente[campo]) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Task 3 — buscador cross-rol + expediente de emergencia (2026-09-08)
// ---------------------------------------------------------------------------

type PersonaNombre = {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
};

/** "Nombres ApellidoPaterno ApellidoMaterno", sin espacios sobrantes. */
export function nombreCompleto(p: PersonaNombre): string {
  return [p.nombres, p.apellidoPaterno, p.apellidoMaterno]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join(' ');
}

/**
 * Orden estable por apellido paterno, luego materno, luego nombres (es-MX).
 * Se exporta y se testea como función pura; el buscador NO la usa sobre
 * `ResultadoBusqueda` (ese shape no lleva los 3 campos de apellido) — el
 * orden global del lookup es aproximado por nombre visible, ver
 * `EmergenciaService.buscar`.
 */
export function compararPorApellidos(a: PersonaNombre, b: PersonaNombre): number {
  const clave = (p: PersonaNombre) =>
    `${p.apellidoPaterno} ${p.apellidoMaterno ?? ''} ${p.nombres}`.toLocaleLowerCase(
      'es',
    );
  return clave(a).localeCompare(clave(b), 'es');
}

/** Edad en años cumplidos a la fecha de hoy. */
export function calcularEdad(fechaNacimiento: Date): number {
  const hoy = new Date();
  let edad = hoy.getUTCFullYear() - fechaNacimiento.getUTCFullYear();
  const m = hoy.getUTCMonth() - fechaNacimiento.getUTCMonth();
  if (m < 0 || (m === 0 && hoy.getUTCDate() < fechaNacimiento.getUTCDate()))
    edad--;
  return edad;
}
