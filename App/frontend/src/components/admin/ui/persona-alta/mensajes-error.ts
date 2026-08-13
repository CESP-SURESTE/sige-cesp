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
    if (mensajesEspecificos[error.code]) {
      return mensajesEspecificos[error.code];
    }
    // CONFLICT (encontrado en QA manual, sesión 2026-08-12): a diferencia
    // de los demás códigos, el backend YA distingue cuál campo colisionó
    // ("Ya existe un usuario con ese email" / "...esa matrícula" /
    // "...ese código externo", ver `PersonasService.altaPersona`) — usar
    // ese texto real en vez de un mensaje genérico fijo que escondía cuál
    // de los 3 campos era el problema.
    if (error.code === 'CONFLICT') {
      return error.message;
    }
    return MENSAJES_ERROR_COMUNES[error.code] ?? MENSAJE_ERROR_GENERICO;
  }
  return error instanceof Error ? error.message : MENSAJE_ERROR_GENERICO;
}
