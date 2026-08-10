import { IsNotEmpty, IsString, MinLength } from 'class-validator';

/**
 * Body de `PATCH /auth/cambiar-password` — Fase 4, Día 12.
 *
 * `passwordActual` se valida solo por presencia (`@IsNotEmpty()`) — el
 * formato/complejidad de una contraseña YA existente no es responsabilidad
 * de este DTO, la valida Supabase Auth al reautenticar
 * (`signInWithPassword`, ver `AuthService.cambiarPassword`).
 *
 * `passwordNueva` exige mínimo 8 caracteres (`@MinLength(8)`) — mismo piso
 * que documenta el encargo de Día 12, sin reglas de complejidad más
 * estrictas que las de `generateTemporaryPassword`
 * (`src/personas/temporary-password.ts`, Día 11).
 *
 * Mismo criterio que `LoginDto` (Día 9): el `ValidationPipe` global
 * (`whitelist: true`, ver `src/setup-app.ts`) descarta cualquier propiedad
 * del body sin AL MENOS un decorador de validación.
 */
export class CambiarPasswordDto {
  @IsString({ message: 'La contraseña actual es requerida' })
  @IsNotEmpty({ message: 'La contraseña actual es requerida' })
  passwordActual!: string;

  @IsString({ message: 'La contraseña nueva es requerida' })
  @MinLength(8, {
    message: 'La contraseña nueva debe tener al menos 8 caracteres',
  })
  passwordNueva!: string;
}
