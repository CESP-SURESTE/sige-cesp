import { apiFetch, apiFetchAuth } from './http';

/**
 * Shape de `LoginResult` en `App/backend/src/auth/auth.service.ts` —
 * mantener en sync si cambia el backend (no hay generación automática de
 * tipos entre los dos proyectos todavía).
 */
export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  expiresAt?: number;
  user: {
    id: string;
    email?: string;
    role?: string;
    appMetadata: Record<string, unknown>;
    userMetadata: Record<string, unknown>;
  };
}

export function login(email: string, password: string): Promise<LoginResult> {
  return apiFetch<LoginResult>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

/**
 * `POST /auth/completar-reseteo` — se llama justo después de que el
 * navegador ya cambió la contraseña real vía `supabase.auth.updateUser()`
 * en `app/restablecer-password/page.tsx`. Solo limpia `primerIngreso` +
 * audita en el backend — best-effort desde este lado (ver esa página: si
 * esta llamada falla, no se bloquea la navegación del usuario, la
 * contraseña ya quedó bien puesta).
 */
export function completarReseteo(): Promise<{ ok: true }> {
  return apiFetchAuth<{ ok: true }>('/auth/completar-reseteo', {
    method: 'POST',
  });
}
