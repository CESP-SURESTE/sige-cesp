import { apiFetchAuth } from './http';

/**
 * `POST/GET/PATCH/DELETE /eventos` — Fase 15, Días 41-44. Cliente
 * COMPARTIDO entre los 3 árboles (admin/maestro/alumno) — mismo criterio
 * que `lib/api/grupos.ts`. Shape espejo de `CalendarioService`
 * (`App/backend/src/calendario/`), mantener en sync a mano.
 */
export type CategoriaEvento =
  | 'EXAMEN'
  | 'SOCIAL'
  | 'ADMINISTRATIVO'
  | 'SUSPENSION_CLASES'
  | 'OTRO';

export type AlcanceDestino = 'SEDE' | 'CARRERA' | 'GRUPO';

export interface ReglaRecurrencia {
  frecuencia: 'DIARIA' | 'SEMANAL' | 'MENSUAL';
  intervalo: number;
  diasSemana?: number[];
  diaMes?: number;
}

export interface OcurrenciaEvento {
  eventoId: string;
  titulo: string;
  descripcion: string | null;
  fecha: string;
  horaInicio: string | null;
  fechaFin: string | null;
  categoria: CategoriaEvento;
  alcanceTipo: AlcanceDestino;
  alcanceId: string | null;
  esRecurrente: boolean;
}

export interface CrearEventoInput {
  titulo: string;
  descripcion?: string;
  fechaInicio: string;
  horaInicio?: string;
  fechaFin?: string;
  categoria: CategoriaEvento;
  alcanceTipo: AlcanceDestino;
  alcanceId?: string;
  recurrenciaRegla?: ReglaRecurrencia;
  recurrenciaHasta?: string;
}

export type ActualizarEventoInput = Partial<CrearEventoInput>;

export function listarEventos(
  desde: string,
  hasta: string,
): Promise<OcurrenciaEvento[]> {
  return apiFetchAuth<OcurrenciaEvento[]>(
    `/eventos?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`,
  );
}

export function crearEvento(input: CrearEventoInput): Promise<{ id: string }> {
  return apiFetchAuth<{ id: string }>('/eventos', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function actualizarEvento(
  id: string,
  input: ActualizarEventoInput,
): Promise<{ id: string }> {
  return apiFetchAuth<{ id: string }>(`/eventos/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function eliminarEvento(id: string): Promise<{ ok: true }> {
  return apiFetchAuth<{ ok: true }>(`/eventos/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
