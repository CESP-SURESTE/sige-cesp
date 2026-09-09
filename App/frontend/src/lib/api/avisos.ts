import { apiFetchAuth, apiFetchAuthPaginado, type ApiListaPaginada } from './http';

/**
 * `/avisos` — Fase 16 (backend Días 45-46, UI Días 47-48). Shape espejo de
 * `AvisosService` (`App/backend/src/avisos/`) + el endpoint `GET
 * /avisos/publicados` (Día 47). Mantener en sync a mano, mismo criterio que
 * `lib/api/carreras.ts` / `lib/api/grupos.ts`. `sedeId` NUNCA es parámetro
 * (el backend lo saca del JWT, regla 2). Compartido por los 3 árboles
 * (`app/{admin,maestro,alumno}/avisos/`) — `lib/api/` es infraestructura,
 * la regla 11 aplica a `app/` y `components/`, no acá.
 */

export type AlcanceTipoAviso = 'SEDE' | 'CARRERA' | 'GRUPO';

export interface CrearAvisoInput {
  titulo: string;
  cuerpo: string;
  alcanceTipo: AlcanceTipoAviso;
  /** Requerido si alcanceTipo es CARRERA o GRUPO; ausente si SEDE. */
  alcanceId?: string;
}

/** Lo que devuelve `POST /avisos` (fila plana del `Aviso`). */
export interface Aviso {
  id: string;
  sedeId: string;
  autorUsuarioId: string;
  titulo: string;
  cuerpo: string;
  alcanceTipo: AlcanceTipoAviso;
  alcanceId: string | null;
  createdAt: string;
}

/** Item de `GET /avisos/publicados` — la tabla de gestión del autor. */
export interface AvisoPublicadoItem {
  id: string;
  titulo: string;
  cuerpo: string;
  alcanceTipo: AlcanceTipoAviso;
  alcanceId: string | null;
  alcanceNombre: string | null;
  createdAt: string;
  totalDestinatarios: number;
  leidos: number;
}

/** Item de `GET /avisos` (feed de recibidos) y de `GET /avisos/:id`. */
export interface AvisoFeedItem {
  id: string;
  titulo: string;
  cuerpo: string;
  autor: { nombres: string; apellidoPaterno: string };
  createdAt: string;
  leidoEn: string | null;
}

export interface DestinatarioRecibo {
  usuarioId: string;
  nombreCompleto: string;
  rol: 'ALUMNO' | 'MAESTRO' | 'ADMINISTRATIVO';
  leidoEn: string | null;
}

export interface RecibosAviso {
  total: number;
  leidos: number;
  noLeidos: number;
  destinatarios: DestinatarioRecibo[];
}

export function publicarAviso(input: CrearAvisoInput): Promise<Aviso> {
  return apiFetchAuth<Aviso>('/avisos', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listarAvisosPublicados(params?: {
  page?: number;
  limit?: number;
}): Promise<ApiListaPaginada<AvisoPublicadoItem>> {
  const sp = new URLSearchParams();
  if (params?.page) sp.set('page', String(params.page));
  if (params?.limit) sp.set('limit', String(params.limit));
  const qs = sp.toString();
  return apiFetchAuthPaginado<AvisoPublicadoItem>(
    `/avisos/publicados${qs ? `?${qs}` : ''}`,
  );
}

export function obtenerFeedAvisos(params?: {
  page?: number;
  limit?: number;
}): Promise<ApiListaPaginada<AvisoFeedItem>> {
  const sp = new URLSearchParams();
  if (params?.page) sp.set('page', String(params.page));
  if (params?.limit) sp.set('limit', String(params.limit));
  const qs = sp.toString();
  return apiFetchAuthPaginado<AvisoFeedItem>(`/avisos${qs ? `?${qs}` : ''}`);
}

/** Dispara el efecto de backend: marca la `Notificacion` del actor como leída. */
export function obtenerDetalleAviso(id: string): Promise<AvisoFeedItem> {
  return apiFetchAuth<AvisoFeedItem>(`/avisos/${id}`);
}

export function obtenerRecibosAviso(id: string): Promise<RecibosAviso> {
  return apiFetchAuth<RecibosAviso>(`/avisos/${id}/recibos`);
}

export function eliminarAviso(id: string): Promise<{ ok: true }> {
  return apiFetchAuth<{ ok: true }>(`/avisos/${id}`, { method: 'DELETE' });
}
