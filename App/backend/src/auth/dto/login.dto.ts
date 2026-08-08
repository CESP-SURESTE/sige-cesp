import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

/**
 * Body de `POST /auth/login`.
 *
 * Decoradores de `class-validator` — Fase 2, Día 9: el `ValidationPipe`
 * global (`whitelist: true`, ver `src/setup-app.ts`) descarta cualquier
 * propiedad del body que no tenga AL MENOS un decorador de validación, así
 * que `email`/`password` los necesitan aunque sea uno solo (`@IsString()`)
 * para no perderse silenciosamente. `forbidNonWhitelisted: true` responde
 * 400 si el body trae props extra (ej. `{ email, password, rol: 'ADMIN' }`).
 *
 * `AuthService.validarCredenciales` (ver `auth.service.ts`) sigue
 * existiendo como segunda capa: `AuthService.login()` recibe `unknown` y no
 * depende de haber pasado por el `ValidationPipe` (podría invocarse desde
 * otro contexto que no sea HTTP).
 */
export class LoginDto {
  @IsEmail({}, { message: 'El email tiene un formato inválido' })
  email!: string;

  @IsString({ message: 'La contraseña es requerida' })
  @IsNotEmpty({ message: 'La contraseña es requerida' })
  password!: string;
}
