import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from '@nestjs/common';

/**
 * `exceptionFactory` del `ValidationPipe` global (Fase 2, Día 9 —
 * `main.ts`).
 *
 * Sin este `exceptionFactory`, `ValidationPipe` devuelve por default
 * `{ statusCode, message: string[], error }` — no cumple el contrato de API
 * del proyecto (`{ error, code }`, ver CLAUDE.md raíz). Esta función mapea
 * los `ValidationError[]` de `class-validator` a ese contrato, usando
 * `VALIDATION_ERROR` (código ya definido, mismo que usa la validación manual
 * de `AuthService`).
 *
 * Recorre `error.children` para DTOs con objetos anidados (ninguno todavía
 * en el proyecto, pero es el shape estándar que devuelve `class-validator`
 * y evita tener que revisitar esto cuando aparezca el primero).
 */
function extraerMensajes(errores: ValidationError[]): string[] {
  const mensajes: string[] = [];
  for (const error of errores) {
    if (error.constraints) {
      mensajes.push(...Object.values(error.constraints));
    }
    if (error.children && error.children.length > 0) {
      mensajes.push(...extraerMensajes(error.children));
    }
  }
  return mensajes;
}

export function validationExceptionFactory(
  errores: ValidationError[],
): BadRequestException {
  const mensajes = extraerMensajes(errores);
  const mensaje = mensajes[0] ?? 'Datos de entrada inválidos';

  return new BadRequestException({
    error: mensaje,
    code: 'VALIDATION_ERROR',
  });
}
