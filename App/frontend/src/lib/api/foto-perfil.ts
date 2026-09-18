import { API_URL, apiFetchAuth, ApiError, obtenerAccessToken } from './http';

/**
 * `lib/api/foto-perfil.ts` — feature "Foto de perfil" (2026-09-17).
 *
 * Mismo patrón que `subirMallaCurricular` (`lib/api/carreras.ts`): usa
 * `XMLHttpRequest` en vez de `fetch` para exponer progreso real de subida
 * (`fetch` no lo da de forma práctica en el navegador). Mismo contrato de
 * errores (`ApiError` con `code`/`status`).
 */

function subir(
  path: string,
  archivo: File,
  onProgress?: (porcentaje: number) => void,
): Promise<{ ok: true }> {
  return new Promise((resolve, reject) => {
    obtenerAccessToken()
      .then((token) => {
        const formData = new FormData();
        formData.append('archivo', archivo);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_URL}${path}`);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);

        xhr.upload.onprogress = (e) => {
          if (onProgress && e.lengthComputable) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        };

        xhr.onload = () => {
          let body: unknown = null;
          try {
            body = JSON.parse(xhr.responseText);
          } catch {
            body = null;
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            const success = body as { data?: { ok: true } } | null;
            if (success && success.data) {
              resolve(success.data);
            } else {
              reject(
                new ApiError(
                  'Respuesta inesperada del servidor al subir la foto.',
                  'SERVER_ERROR',
                  xhr.status,
                ),
              );
            }
          } else {
            const failure = body as { error?: string; code?: string } | null;
            reject(
              new ApiError(
                failure?.error ?? 'No se pudo subir la foto. Intenta de nuevo.',
                failure?.code ?? 'SERVER_ERROR',
                xhr.status,
              ),
            );
          }
        };

        xhr.onerror = () => {
          reject(new ApiError('Error de red al subir la foto.', 'SERVER_ERROR', 0));
        };

        xhr.send(formData);
      })
      .catch(reject);
  });
}

export function subirFotoPropia(
  archivo: File,
  onProgress?: (porcentaje: number) => void,
): Promise<{ ok: true }> {
  return subir('/perfil/foto', archivo, onProgress);
}

export function eliminarFotoPropia(): Promise<{ ok: true }> {
  return apiFetchAuth<{ ok: true }>('/perfil/foto', { method: 'DELETE' });
}

export function subirFotoPersona(
  usuarioId: string,
  archivo: File,
  onProgress?: (porcentaje: number) => void,
): Promise<{ ok: true }> {
  return subir(`/personas/${usuarioId}/foto`, archivo, onProgress);
}

export function eliminarFotoPersona(usuarioId: string): Promise<{ ok: true }> {
  return apiFetchAuth<{ ok: true }>(`/personas/${usuarioId}/foto`, {
    method: 'DELETE',
  });
}
