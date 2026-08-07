import type { UserClaims, JWTClaims } from '@supabase/server';

/**
 * Aumenta el `Request` de Express con lo que `SedeGuard` deja pegado tras
 * verificar el JWT — así el resto del código (decorators, controllers,
 * futuros guards de rol en Fase 2) no necesita castear `any`.
 */
declare global {
  namespace Express {
    interface Request {
      /** `sede_id` extraído del JWT (custom claim, ver Fase 1 Día 5). Nunca del body. */
      sedeId?: string;
      /** Vista normalizada (camelCase) del usuario autenticado. */
      userClaims?: UserClaims;
      /** Payload crudo del JWT (snake_case), por si se necesita algo más adelante (ej. `rol` en Fase 2). */
      jwtClaims?: JWTClaims;
    }
  }
}

export {};
