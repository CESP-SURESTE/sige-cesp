import { apiFetchAuth, apiFetchAuthPaginado, type ApiListaPaginada } from './http';

/**
 * `GET /notificaciones`, `GET /notificaciones/conteo-no-leidas`,
 * `PATCH /notificaciones/:id/leido` — Fase 14, Día 38/39.
 *
 * Cliente de API COMPARTIDO entre los 3 árboles (admin/alumno/maestro) —
 * mismo criterio que `lib/api/perfil.ts` (lo usan los 3 `SedeBadge`). Regla
 * 11 aplica a componentes, no a `lib/api/*`. Shape espejo de
 * `NotificacionesService` (`App/backend/src/notificaciones/`), mantener en
 * sync a mano.
 */
export type TipoNotificacion = 'AVISO' | 'RECORDATORIO_EVENTO' | 'EVENTO_NUEVO';

export interface Notificacion {
  id: string;
  tipo: TipoNotificacion;
  referenciaId: string;
  titulo: string;
  cuerpoCorto: string;
  leidoEn: string | null;
  createdAt: string;
}

export function listarNotificaciones(
  page = 1,
  limit = 20,
): Promise<ApiListaPaginada<Notificacion>> {
  return apiFetchAuthPaginado<Notificacion>(
    `/notificaciones?page=${page}&limit=${limit}`,
  );
}

export function conteoNoLeidas(): Promise<{ total: number }> {
  return apiFetchAuth<{ total: number }>('/notificaciones/conteo-no-leidas');
}

export function marcarLeida(id: string): Promise<{ ok: true }> {
  return apiFetchAuth<{ ok: true }>(
    `/notificaciones/${encodeURIComponent(id)}/leido`,
    { method: 'PATCH' },
  );
}
