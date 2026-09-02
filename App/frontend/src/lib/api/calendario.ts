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
  /**
   * `true` si el actor puede editar/eliminar el evento (es su autor, o es un
   * ADMINISTRATIVO de la sede del evento); `false` en el resto (alumno
   * siempre `false`, maestro sobre un evento que no creó `false`). Espejo del
   * campo agregado en el backend (`CalendarioService`, Fase 15). El árbol
   * maestro lo usa para no ofrecer acceso a la edición/borrado de una
   * ocurrencia que igual rechazaría el backend con `403`.
   */
  puedeEditar: boolean;
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

/**
 * Igual que `Partial<CrearEventoInput>` pero admitiendo `null` explícito en
 * cada campo: el backend (`ActualizarEventoDto` con `@IsOptional()`) distingue
 * `undefined` ("sin cambio") de `null` ("bórralo" — limpia un campo opcional
 * ya guardado). `Partial<>` no puede expresar ese `null`.
 */
export type ActualizarEventoInput = {
  [K in keyof CrearEventoInput]?: CrearEventoInput[K] | null;
};

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
