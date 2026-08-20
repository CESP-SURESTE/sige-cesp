import { createClient } from '@/lib/supabase/client';

/**
 * Fetcher genérico del backend NestJS — Fase 2, Día 10.
 *
 * Todo fetch al backend pasa por aquí (regla de `CLAUDE.md`: "React Query,
 * no fetch nativo suelto") — los hooks de React Query usan `apiFetch` como
 * `queryFn`/`mutationFn`, nunca `fetch()` directo en un componente.
 *
 * Traduce el contrato de API del backend (`{ data }` en éxito, `{ error,
 * code }` en error, ver `CLAUDE.md` raíz) a: devolver `data` tal cual, o
 * lanzar `ApiError` con `code`/`status` tipados para que la UI pueda
 * distinguir `RATE_LIMIT_EXCEEDED`, `CUENTA_BLOQUEADA`, etc. sin parsear el
 * mensaje.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type ApiSuccess<T> = { data: T };
type ApiFailure = { error: string; code: string };

/**
 * `ApiListaPaginada` — Fase 5, Día 19.
 *
 * Shape base del contrato de listas paginadas (`CLAUDE.md` raíz, sección
 * "Contrato de API": "Éxito: `{ data: ... }` (+ `page`/`limit`/`total` en
 * listas paginadas)") — usado por primera vez por `GET /personas`
 * (`lib/api/personas.ts`, `listarAlumnos`/`listarMaestros`), pero el shape es
 * genérico para cualquier lista futura que siga el mismo contrato.
 */
export interface ApiListaPaginada<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
}

/**
 * Núcleo compartido entre `apiFetch` (devuelve solo `data`) y
 * `apiFetchPaginado`/`apiFetchAuthPaginado` (devuelven el body completo,
 * `page`/`limit`/`total` incluidos) — mismo manejo de errores en los 3 casos,
 * sin duplicar el `fetch`/parseo/`ApiError` tres veces.
 */
async function apiFetchRaw(path: string, init?: RequestInit): Promise<unknown> {
  if (!API_URL) {
    // Falla rápido y explícito en vez de pegarle a una URL relativa
    // equivocada — evita debugging silencioso si falta la env var.
    throw new Error(
      'NEXT_PUBLIC_API_URL no está definida (App/frontend/.env.local)',
    );
  }

  // `FormData` (subida de archivos, ej. malla curricular) necesita que el
  // navegador ponga su propio `Content-Type: multipart/form-data;
  // boundary=...` — forzar `application/json` acá rompería el parseo del
  // archivo en el backend. Para cualquier otro body (JSON, el caso normal)
  // el default de siempre se mantiene igual.
  const esFormData = init?.body instanceof FormData;
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(esFormData ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  });

  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const failure = body as Partial<ApiFailure> | null;
    throw new ApiError(
      failure?.error ?? 'Error inesperado del servidor',
      failure?.code ?? 'SERVER_ERROR',
      res.status,
    );
  }

  return body;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const body = await apiFetchRaw(path, init);
  return (body as ApiSuccess<T>).data;
}

/**
 * Variante de `apiFetch` que preserva `page`/`limit`/`total` en vez de
 * quedarse solo con `data` — para consumir listas paginadas del contrato de
 * API (ver `ApiListaPaginada` arriba).
 */
export async function apiFetchPaginado<T>(
  path: string,
  init?: RequestInit,
): Promise<ApiListaPaginada<T>> {
  const body = await apiFetchRaw(path, init);
  return body as ApiListaPaginada<T>;
}

/**
 * Resuelve el `access_token` de la sesión actual — extraído de
 * `resolveAuthHeaders` (2026-08-19) porque `subirMallaCurricular`
 * (`carreras.ts`) lo necesita para construir un `XMLHttpRequest` a mano
 * (progreso real de subida, `fetch` no lo expone de forma práctica) sin
 * pasar por `apiFetchAuth`.
 */
export async function obtenerAccessToken(): Promise<string> {
  const supabase = createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  if (!accessToken) {
    throw new Error('No hay una sesión activa. Vuelve a iniciar sesión.');
  }
  return accessToken;
}

/** Compartido entre `apiFetchAuth` y `apiFetchAuthPaginado` — resuelve el
 * mismo `Authorization: Bearer <token>` una sola vez. */
async function resolveAuthHeaders(
  init?: RequestInit,
): Promise<RequestInit> {
  const accessToken = await obtenerAccessToken();
  return {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...init?.headers,
    },
  };
}

/**
 * `apiFetchAuth` — Fase 4, Día 14.
 *
 * Segundo caso de fetch autenticado del frontend (el primero, `PATCH
 * /auth/cambiar-password` en Día 12, dejó documentado en
 * `lib/api/cambiar-password.ts` que valía la pena centralizar esto si
 * aparecía un segundo caso — este es ese caso, usado por
 * `lib/api/personas.ts` y `lib/api/carreras.ts`).
 *
 * Mismo mecanismo que ya usaba `cambiar-password.ts` a mano: resuelve el
 * `access_token` de la sesión actual vía `createClient().auth.getSession()`
 * (cliente de browser, `@supabase/ssr`) y arma `Authorization: Bearer
 * <token>` antes de delegar en `apiFetch`. Si no hay sesión, falla explícito
 * en vez de mandar un request sin `Authorization` que el backend rechazaría
 * con un 401 menos claro — no debería pasar en la práctica porque toda
 * página que llama esto vive detrás de `src/proxy.ts`, que ya exige sesión.
 */
export async function apiFetchAuth<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  return apiFetch<T>(path, await resolveAuthHeaders(init));
}

/**
 * `apiFetchAuthPaginado` — Fase 5, Día 19.
 *
 * Igual que `apiFetchAuth`, pero para listas paginadas (`GET /personas` —
 * primer consumidor, `lib/api/personas.ts`): preserva `page`/`limit`/`total`
 * en vez de quedarse solo con `data` (ver `ApiListaPaginada`/`apiFetchPaginado`
 * arriba).
 */
export async function apiFetchAuthPaginado<T>(
  path: string,
  init?: RequestInit,
): Promise<ApiListaPaginada<T>> {
  return apiFetchPaginado<T>(path, await resolveAuthHeaders(init));
}
