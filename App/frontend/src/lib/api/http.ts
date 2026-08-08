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

const API_URL = process.env.NEXT_PUBLIC_API_URL;

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

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  if (!API_URL) {
    // Falla rápido y explícito en vez de pegarle a una URL relativa
    // equivocada — evita debugging silencioso si falta la env var.
    throw new Error(
      'NEXT_PUBLIC_API_URL no está definida (App/frontend/.env.local)',
    );
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
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

  return (body as ApiSuccess<T>).data;
}
