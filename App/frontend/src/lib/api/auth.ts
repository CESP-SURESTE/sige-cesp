import { apiFetch } from './http';

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
