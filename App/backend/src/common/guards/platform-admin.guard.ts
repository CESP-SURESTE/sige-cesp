import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { verificarPlatformAdminToken } from '../../platform-admin/platform-admin-jwt.util';

/**
 * Guard de `AdminPlataforma` — Fase 6, Día 20.
 *
 * Aislado por completo de `SedeGuard`/`RolesGuard` (regla del roadmap: "cero
 * riesgo para las rutas existentes"). Verifica el JWT propio firmado por
 * `firmarPlatformAdminToken` (`platform-admin-jwt.util.ts`) y deja
 * `request.platformAdminId` disponible — `@PlatformAdminActual()` lo expone
 * a los controllers, mismo patrón que `@SedeActual()`/`SedeGuard`.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    const authHeader = request.headers['authorization'];
    const token =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : null;

    if (!token) {
      throw new UnauthorizedException({
        error: 'Falta el token de autenticación (Authorization: Bearer <token>)',
        code: 'UNAUTHORIZED',
      });
    }

    try {
      const claims = await verificarPlatformAdminToken(token);
      request.platformAdminId = claims.sub;
    } catch (err) {
      console.error('[PlatformAdminGuard] token inválido:', err);
      throw new UnauthorizedException({
        error: 'Token de plataforma inválido o expirado',
        code: 'UNAUTHORIZED',
      });
    }

    return true;
  }
}
