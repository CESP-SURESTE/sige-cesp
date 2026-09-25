import { platformFetch, platformFetchPaginated } from './platform-http';

/**
 * Cliente de `app/plataforma/soporte/` — separado de `soporte.ts` (Task 6,
 * consumido por `app/admin`/`app/maestro`) porque este árbol autentica con
 * el JWT propio de `AdminPlataforma` (`platformFetch`/`platformFetchPaginated`
 * de `platform-http.ts`), nunca con la sesión de Supabase de
 * `apiFetchAuth`/`http.ts` — mismo criterio de separación que
 * `platform-http.ts` vs. `http.ts`.
 */
export interface ReporteBugItem {
  id: string;
  sede: { id: string; nombre: string };
  reportante: string;
  descripcion: string;
  capturaUrl: string | null;
  estatus: 'NUEVO' | 'EN_REVISION' | 'RESUELTO';
  createdAt: string;
  updatedAt: string;
}

export function obtenerConfigSoportePlataforma(): Promise<{ activo: boolean }> {
  return platformFetch<{ activo: boolean }>('/soporte/config');
}

export function actualizarConfigSoportePlataforma(
  activo: boolean,
): Promise<{ activo: boolean }> {
  return platformFetch<{ activo: boolean }>('/soporte/config', {
    method: 'PATCH',
    body: JSON.stringify({ activo }),
  });
}

export function listarReportesBug(params: {
  estatus?: string;
  page?: number;
  limit?: number;
}): Promise<{ data: ReporteBugItem[]; page: number; limit: number; total: number }> {
  const query = new URLSearchParams();
  if (params.estatus) query.set('estatus', params.estatus);
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  return platformFetchPaginated<ReporteBugItem>(
    `/soporte/reportes${qs ? `?${qs}` : ''}`,
  );
}

export function cambiarEstatusReporteBug(
  id: string,
  estatus: string,
): Promise<{ ok: true }> {
  return platformFetch<{ ok: true }>(`/soporte/reportes/${id}/estatus`, {
    method: 'PATCH',
    body: JSON.stringify({ estatus }),
  });
}
