import { apiFetchAuth } from './http';

/**
 * Cliente de API del módulo de emergencia — 2026-09-08.
 *
 * Espejo manual de los shapes del backend (`/emergencia/*`, Tasks 2-3) —
 * mismo criterio "mantener en sync a mano si cambia el backend" que
 * `lib/api/carreras.ts`. `sedeId` nunca es parámetro: el backend lo saca del
 * JWT (`@SedeActual()`, regla 2 de `CLAUDE.md` raíz).
 */

export interface TelefonoEmergencia {
  id: string;
  sedeId: string;
  etiqueta: string;
  telefono: string;
  orden: number;
  createdAt: string;
  updatedAt: string;
}

export type TipoExpediente =
  | 'ALUMNO'
  | 'MAESTRO'
  | 'ADMINISTRATIVO'
  | 'PERSONAL_SERVICIOS';

export interface ResultadoBusquedaEmergencia {
  tipo: TipoExpediente;
  perfilId: string;
  nombreCompleto: string;
  referencia: string;
  activo: boolean;
}

export interface ExpedienteEmergencia {
  tipo: TipoExpediente;
  perfilId: string;
  identidad: {
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string | null;
    curp: string | null;
    telefono: string | null;
    correoPersonal: string | null;
    referencia: string;
    fechaNacimiento: string | null;
    edad: number | null;
    activo: boolean;
  };
  infoMedica: {
    tieneCondicionMedica: boolean;
    tipoSangre: string | null;
    padecimiento: string | null;
    medicamentos: string | null;
    alergias: string | null;
    tratamientoAdicional: string | null;
  } | null;
  contactos: Array<{
    nombre: string;
    telefono: string;
    correo: string | null;
    parentesco: string;
    tipo: 'TUTOR' | 'EMERGENCIA' | null;
    orden: number;
  }>;
}

export interface CrearTelefonoInput {
  etiqueta: string;
  telefono: string;
}
export type ActualizarTelefonoInput = Partial<CrearTelefonoInput>;

export function listarTelefonosEmergencia(): Promise<TelefonoEmergencia[]> {
  return apiFetchAuth<TelefonoEmergencia[]>('/emergencia/telefonos');
}

export function crearTelefonoEmergencia(
  input: CrearTelefonoInput,
): Promise<TelefonoEmergencia> {
  return apiFetchAuth<TelefonoEmergencia>('/emergencia/telefonos', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function actualizarTelefonoEmergencia(
  id: string,
  input: ActualizarTelefonoInput,
): Promise<TelefonoEmergencia> {
  return apiFetchAuth<TelefonoEmergencia>(`/emergencia/telefonos/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function eliminarTelefonoEmergencia(id: string): Promise<{ ok: true }> {
  return apiFetchAuth<{ ok: true }>(`/emergencia/telefonos/${id}`, {
    method: 'DELETE',
  });
}

export function buscarEmergencia(
  q: string,
  limit?: number,
): Promise<ResultadoBusquedaEmergencia[]> {
  const params = new URLSearchParams({ q });
  if (limit !== undefined) params.set('limit', String(limit));
  return apiFetchAuth<ResultadoBusquedaEmergencia[]>(
    `/emergencia/buscar?${params.toString()}`,
  );
}

export function obtenerExpedienteEmergencia(
  tipo: TipoExpediente,
  perfilId: string,
): Promise<ExpedienteEmergencia> {
  return apiFetchAuth<ExpedienteEmergencia>(
    `/emergencia/expediente/${tipo}/${perfilId}`,
  );
}
