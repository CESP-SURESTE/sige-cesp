/**
 * Body de `POST /auth/login`.
 *
 * No hay `ValidationPipe` global todavía (llega en Fase 2, Día 9) — esta
 * clase solo documenta la forma esperada del body para el controller/tests;
 * la validación real (campos presentes, formato de email) ocurre a mano en
 * `AuthService.login()` — ver ese archivo.
 */
export class LoginDto {
  email!: string;
  password!: string;
}
