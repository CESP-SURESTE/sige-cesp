import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';

/**
 * Rate limiting de `POST /auth/login` — Fase 2, Día 9.
 *
 * Se aplica SOLO a esa ruta (`@UseGuards(LoginThrottlerGuard)` en
 * `auth.controller.ts`), no global — el resto del API ya está protegido por
 * `SedeGuard`/`RolesGuard` (que exigen un JWT válido, mucho más caro de
 * falsificar que reintentar un POST sin auth) y no hay pedido de negocio
 * para limitarlo todavía.
 *
 * Límite: 5 intentos por IP cada 60s (`ThrottlerModule.forRoot(...)` en
 * `auth.module.ts`) — valor de criterio propio (sin spec exacta en el
 * roadmap, entrega interna): suficiente para que un usuario real que se
 * equivoca de contraseña un par de veces no se vea afectado, pero corta un
 * ataque de fuerza bruta automatizado contra `/auth/login`.
 *
 * Se extiende `ThrottlerGuard` únicamente para overridear
 * `throwThrottlingException`: por default lanza `ThrottlerException`
 * (`HttpException` con `message: string`, no `{ error, code }`) — no
 * cumple el contrato de API del proyecto. Acá se relanza con el shape
 * esperado y el código de dominio nuevo `RATE_LIMIT_EXCEEDED` (documentado
 * en CLAUDE.md raíz, sección "Contrato de API").
 */
@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  protected throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    void context;
    void throttlerLimitDetail;

    // Sin `async`/`await` a propósito (evita el lint
    // `@typescript-eslint/require-await`): esta función SIEMPRE lanza en
    // vez de resolver, así que no hay nada que esperar — el `throw`
    // síncrono sigue propagándose correctamente como rechazo de la promesa
    // hacia `handleRequest` (que sí hace `await` sobre este método).
    throw new HttpException(
      {
        error:
          'Demasiados intentos de inicio de sesión. Intenta de nuevo en un minuto.',
        code: 'RATE_LIMIT_EXCEEDED',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
