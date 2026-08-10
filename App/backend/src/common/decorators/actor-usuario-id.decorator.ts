import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Inyecta el `sub` (id de Supabase Auth == `Usuario.id`, regla 9 de
 * CLAUDE.md raíz) del JWT ya verificado por `SedeGuard` — Fase 4, Día 11.
 *
 * Uso: identificar al ACTOR que ejecuta una acción sensible para
 * `RegistroAuditoria.usuarioId` (regla 5 de CLAUDE.md raíz — nunca se saca
 * del body, siempre del JWT). Mismo criterio/patrón que `@SedeActual()`
 * (`sede-actual.decorator.ts`): solo tiene sentido en rutas protegidas por
 * `SedeGuard` (o cualquier guard que llene `request.jwtClaims`) — si no hay
 * guard, revienta con 500 explícito en vez de dejar pasar `undefined`
 * silenciosamente.
 */
export const ActorUsuarioId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const sub = request.jwtClaims?.['sub'];

    if (typeof sub !== 'string' || sub.length === 0) {
      throw new InternalServerErrorException({
        error:
          '@ActorUsuarioId() se usó en una ruta sin SedeGuard — no hay jwtClaims.sub en el request. Agrega @UseGuards(SedeGuard) al controller o handler.',
        code: 'SERVER_ERROR',
      });
    }

    return sub;
  },
);
