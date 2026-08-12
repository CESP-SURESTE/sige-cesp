import { ApiError } from '@/lib/api/http';

/**
 * Mapeo de `code` de error → mensaje legible, compartido entre los 3
 * formularios de alta de persona (Día 15). Cada página pasa su propio
 * `Record<string, string>` con los mensajes específicos de su rol (ej.
 * `NOT_FOUND` de "carrera" solo aplica a alumno; `NIVEL_PERMISO_INSUFICIENTE`
 * solo aplica a administrativo) — `resolverMensajeError` los combina con
 * estos, comunes a los 3 (documentados en `CLAUDE.md` raíz para
 * `POST /personas`).
 */
export const MENSAJES_ERROR_COMUNES: Record<string, string> = {
  CONFLICT: 'El correo, la matrícula o el código externo ya están en uso.',
  VALIDATION_ERROR:
    'Revisa que todos los campos requeridos estén completos y con el formato correcto.',
  ROL_NO_AUTORIZADO: 'No tienes permisos para dar de alta personas.',
};

export const MENSAJE_ERROR_GENERICO = 'Ocurrió un error inesperado. Intenta de nuevo.';

export function resolverMensajeError(
  error: unknown,
  mensajesEspecificos: Record<string, string> = {},
): string | null {
  if (!error) return null;
  if (error instanceof ApiError) {
    return (
      mensajesEspecificos[error.code] ??
      MENSAJES_ERROR_COMUNES[error.code] ??
      MENSAJE_ERROR_GENERICO
    );
  }
  return error instanceof Error ? error.message : MENSAJE_ERROR_GENERICO;
}
