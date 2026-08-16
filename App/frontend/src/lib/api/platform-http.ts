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
    // 401 (hallazgo deferred de Día 20, corregido 2026-08-16): token
    // ausente/inválido/expirado, o admin desactivado a mitad de sesión
    // (`PlatformAdminGuard` revalida contra la DB en cada request). Este
    // árbol está exento de `src/proxy.ts` (regla 11) — la única protección
    // de ruta es del lado del cliente, así que el 401 tiene que forzar el
    // mismo camino que `cerrarSesion()` en vez de dejar la pantalla rota con
    // un token que ya no sirve.
    if (res.status === 401 && typeof window !== 'undefined') {
      clearPlatformToken();
      if (window.location.pathname !== '/plataforma/login') {
        // `platformFetch` es un util de `lib/api/`, fuera del árbol de
        // componentes de React — no tiene acceso a `useRouter()` (el hook
        // que pide esta regla de lint). `window.location.href` es la única
        // opción real acá; además fuerza una recarga completa, lo que de
        // paso limpia cualquier estado de cliente que haya quedado sucio
        // por la sesión expirada.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = '/plataforma/login';
      }
    }

    const failure = body as Partial<{ error: string; code: string }> | null;
    throw new ApiError(
      failure?.error ?? 'Error inesperado del servidor',
      failure?.code ?? 'SERVER_ERROR',
      res.status,
    );
  }

  return (body as { data: T }).data;
}
