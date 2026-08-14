import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Inyecta el `AdminPlataforma.id` ya validado por `PlatformAdminGuard` —
 * mismo patrón que `@SedeActual()` (`sede-actual.decorator.ts`). Revienta
 * con 500 explícito si se usa en una ruta sin el guard, para que el error se
 * note en desarrollo.
 */
export const PlatformAdminActual = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();

    if (!request.platformAdminId) {
      throw new InternalServerErrorException({
        error:
          '@PlatformAdminActual() se usó en una ruta sin PlatformAdminGuard.',
        code: 'SERVER_ERROR',
      });
    }

    return request.platformAdminId;
  },
);
