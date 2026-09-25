import { API_URL, apiFetchAuth, ApiError, obtenerAccessToken } from './http';

export interface ConfigSoporte {
  activo: boolean;
}

export function obtenerConfigSoporte(): Promise<ConfigSoporte> {
  return apiFetchAuth<ConfigSoporte>('/soporte/config');
}

/**
 * Multipart — `descripcion` + `captura` opcional. Mismo patrón
 * `XMLHttpRequest` que `subirFotoPropia` (`lib/api/foto-perfil.ts`): expone
 * progreso real de subida cuando hay captura, `fetch` no lo da de forma
 * práctica en el navegador.
 */
export function crearReporteBug(
  descripcion: string,
  captura?: File,
  onProgress?: (porcentaje: number) => void,
): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    obtenerAccessToken()
      .then((token) => {
        const formData = new FormData();
        formData.append('descripcion', descripcion);
        if (captura) {
          formData.append('captura', captura);
        }

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_URL}/soporte/reportes`);
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
            const success = body as { data?: { id: string } } | null;
            if (success?.data) {
              resolve(success.data);
            } else {
              reject(
                new ApiError(
                  'Respuesta inesperada del servidor al enviar el reporte.',
                  'SERVER_ERROR',
                  xhr.status,
                ),
              );
            }
          } else {
            const failure = body as { error?: string; code?: string } | null;
            reject(
              new ApiError(
                failure?.error ?? 'No se pudo enviar el reporte. Intenta de nuevo.',
                failure?.code ?? 'SERVER_ERROR',
                xhr.status,
              ),
            );
          }
        };

        xhr.onerror = () => {
          reject(new ApiError('Error de red al enviar el reporte.', 'SERVER_ERROR', 0));
        };

        xhr.send(formData);
      })
      .catch(reject);
  });
}
