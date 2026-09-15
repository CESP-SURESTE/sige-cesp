import {
  apiFetchAuth,
  apiFetchAuthPaginado,
  type ApiListaPaginada,
} from './http';

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

/**
 * `GET /eventos/listado` — Fase 15 polish (2026-09-02). Lista de GESTIÓN de
 * los eventos de la sede: un row por evento BASE (no expande ocurrencias, a
 * diferencia de `GET /eventos` / `listarEventos`), sin tope de rango de 62
 * días, paginada. `ADMINISTRATIVO`-only en el backend — la consume solo la
 * sección «Eventos de la sede» del dashboard de admin (`app/admin/page.tsx`).
 * Shape espejo de `EventoListadoItem` (`CalendarioService`,
 * `App/backend/src/calendario/`), mantener en sync a mano.
 */
export interface EventoListadoItem {
  id: string;
  titulo: string;
  descripcion: string | null;
  fechaInicio: string;
  fechaFin: string | null;
  horaInicio: string | null;
  categoria: CategoriaEvento;
  alcanceTipo: AlcanceDestino;
  alcanceId: string | null;
  alcanceNombre: string;
  esRecurrente: boolean;
  recurrenciaResumen: string | null;
  recurrenciaHasta: string | null;
  autorNombre: string;
  createdAt: string;
}

export interface FiltrosEventosListado {
  desde?: string;
  hasta?: string;
  alcanceTipo?: AlcanceDestino;
  categoria?: CategoriaEvento;
  page?: number;
  limit?: number;
}

export function listarEventosSede(
  filtros: FiltrosEventosListado,
): Promise<ApiListaPaginada<EventoListadoItem>> {
  const qs = new URLSearchParams();
  if (filtros.desde) qs.set('desde', filtros.desde);
  if (filtros.hasta) qs.set('hasta', filtros.hasta);
  if (filtros.alcanceTipo) qs.set('alcanceTipo', filtros.alcanceTipo);
  if (filtros.categoria) qs.set('categoria', filtros.categoria);
  qs.set('page', String(filtros.page ?? 1));
  qs.set('limit', String(filtros.limit ?? 20));
  return apiFetchAuthPaginado<EventoListadoItem>(
    `/eventos/listado?${qs.toString()}`,
  );
}
