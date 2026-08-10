import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Inyecta el email del actor (`request.userClaims.email`, vista camelCase
 * poblada por `SedeGuard` — tipo `UserClaims` de `@supabase/server`) — Fase
 * 4, Día 12.
 *
 * Uso: `PATCH /auth/cambiar-password` necesita el email del actor para
 * reautenticarlo contra Supabase Auth (`signInWithPassword`) antes de
 * cambiar su contraseña — el JWT no expone la contraseña, solo el email
 * (`sub`/`email`), y el email nunca debe venir del body (mismo criterio que
 * `@ActorUsuarioId()`/`@SedeActual()`: la fuente de verdad es siempre el JWT
 * ya verificado, nunca el body/query/path).
 *
 * Mismo patrón que `@ActorUsuarioId()`/`@SedeActual()`: solo tiene sentido
 * en rutas protegidas por `SedeGuard` (o cualquier guard que llene
 * `request.userClaims`) — si no hay guard, o si el JWT no trae email
 * (no debería pasar con una cuenta real de Supabase Auth), revienta con 500
 * explícito en vez de dejar pasar `undefined` silenciosamente.
 */
export const ActorEmail = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const email = request.userClaims?.email;

    if (typeof email !== 'string' || email.length === 0) {
      throw new InternalServerErrorException({
        error:
          '@ActorEmail() se usó en una ruta sin SedeGuard (o el JWT no trae email) — no hay userClaims.email en el request. Agrega @UseGuards(SedeGuard) al controller o handler.',
        code: 'SERVER_ERROR',
      });
    }

    return email;
  },
);
