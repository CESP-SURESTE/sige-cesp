import { apiFetch } from './http';
import { createClient } from '@/lib/supabase/client';

/**
 * `PATCH /auth/cambiar-password` — Dia 12 (backend).
 *
 * Primer endpoint autenticado que llama el frontend (login es publico) - a
 * diferencia de `login()` en `./auth.ts`, `apiFetch` aqui necesita el
 * `Authorization: Bearer <token>` del actor. No se agrego un mecanismo
 * generico de auth a `apiFetch` (http.ts) todavia porque este es el unico
 * caso; si Dia 14+ (formularios de alta) trae mas llamadas autenticadas,
 * vale la pena centralizarlo ahi en vez de repetir este patron.
 */
export interface CambiarPasswordResult {
  ok: true;
}

export async function cambiarPassword(
  passwordActual: string,
  passwordNueva: string,
): Promise<CambiarPasswordResult> {
  const supabase = createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  if (!accessToken) {
    // No deberia pasar (la pagina que llama esto vive detras de `proxy.ts`,
    // que ya exige sesion), pero falla explicito en vez de mandar un
    // request sin Authorization que el backend rechazaria con un 401 menos
    // claro.
    throw new Error('No hay una sesión activa. Vuelve a iniciar sesión.');
  }

  return apiFetch<CambiarPasswordResult>('/auth/cambiar-password', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ passwordActual, passwordNueva }),
  });
}
