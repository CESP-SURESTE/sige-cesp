import { apiFetchAuth } from './http';

/**
 * `PATCH /auth/cambiar-password` — Dia 12 (backend).
 *
 * Primer endpoint autenticado que llamó el frontend (login es publico).
 * Dia 14 centralizó el mecanismo de fetch autenticado (`apiFetchAuth`, ver
 * `./http.ts`) porque apareció un segundo caso (`lib/api/personas.ts`,
 * formulario de alta de alumno) — este archivo se actualizó para usarlo en
 * vez de repetir a mano la resolución del `access_token` + el header
 * `Authorization`, que antes vivía aquí.
 */
export interface CambiarPasswordResult {
  ok: true;
}

export function cambiarPassword(
  passwordActual: string,
  passwordNueva: string,
): Promise<CambiarPasswordResult> {
  return apiFetchAuth<CambiarPasswordResult>('/auth/cambiar-password', {
    method: 'PATCH',
    body: JSON.stringify({ passwordActual, passwordNueva }),
  });
}
