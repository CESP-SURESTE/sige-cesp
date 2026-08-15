import { ApiError } from './http';

/**
 * Cliente HTTP de `app/plataforma/` — Fase 6, Día 20.
 *
 * Análogo a `apiFetchAuth` (`http.ts`), pero para el JWT PROPIO de
 * `AdminPlataforma` (`PlatformAdminGuard`, backend) — no es una sesión de
 * Supabase, así que no puede reusar `createClient().auth.getSession()`
 * (eso es específico del árbol `app/admin`/`app/alumno`, regla 11 de
 * CLAUDE.md: `app/plataforma` es un sistema de identidad completamente
 * aparte). Se guarda en `localStorage` — sin cookies/SSR: este árbol está
 * explícitamente EXENTO de la lógica de sesión de `src/proxy.ts` (que solo
 * entiende sesiones de Supabase, ver la exención al inicio de ese archivo)
 * — la protección de ruta real es del lado del cliente (ver
 * `app/plataforma/sedes/page.tsx`).
 */
const TOKEN_KEY = 'sige_platform_admin_token';
const API_URL = process.env.NEXT_PUBLIC_API_URL;

export function savePlatformToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getPlatformToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearPlatformToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export async function platformFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  if (!API_URL) {
    throw new Error(
      'NEXT_PUBLIC_API_URL no está definida (App/frontend/.env.local)',
    );
  }

  const token = getPlatformToken();

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const failure = body as Partial<{ error: string; code: string }> | null;
    throw new ApiError(
      failure?.error ?? 'Error inesperado del servidor',
      failure?.code ?? 'SERVER_ERROR',
      res.status,
    );
  }

  return (body as { data: T }).data;
}
