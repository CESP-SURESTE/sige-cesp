import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Inyecta el `sede_id` ya validado por `SedeGuard` (Fase 1, Día 6) en el
 * handler de un controller — ej.:
 *
 * ```ts
 * @Get()
 * @UseGuards(SedeGuard)
 * listar(@SedeActual() sedeId: string) {
 *   return this.service.listarPorSede(sedeId);
 * }
 * ```
 *
 * Solo tiene sentido usarlo en rutas protegidas por `SedeGuard` (o cualquier
 * guard que llene `request.sedeId`) — si no hay guard, revienta con un 500
 * explícito en vez de dejar pasar `undefined` silenciosamente, para que el
 * error se note en desarrollo y no en producción con datos reales.
 */
export const SedeActual = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();

    if (!request.sedeId) {
      throw new InternalServerErrorException({
        error:
          '@SedeActual() se usó en una ruta sin SedeGuard — no hay sede_id en el request. Agrega @UseGuards(SedeGuard) al controller o handler.',
        code: 'SERVER_ERROR',
      });
    }

    return request.sedeId;
  },
);
