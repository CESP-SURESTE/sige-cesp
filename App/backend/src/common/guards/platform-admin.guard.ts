import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { verificarPlatformAdminToken } from '../../platform-admin/platform-admin-jwt.util';

/**
 * Guard de `AdminPlataforma` — Fase 6, Día 20.
 *
 * Aislado por completo de `SedeGuard`/`RolesGuard` (regla del roadmap: "cero
 * riesgo para las rutas existentes"). Verifica el JWT propio firmado por
 * `firmarPlatformAdminToken` (`platform-admin-jwt.util.ts`) y deja
 * `request.platformAdminId` disponible — `@PlatformAdminActual()` lo expone
 * a los controllers, mismo patrón que `@SedeActual()`/`SedeGuard`.
 *
 * Revisión de whole-branch (2026-08-14): la sola verificación de firma
 * confiaba en el claim `sub` durante toda la vida del token (8h) sin volver
 * a consultar la DB — si un `AdminPlataforma` se desactivara/borrara, un
 * token ya emitido seguía funcionando hasta su expiración natural. Se
 * agrega un lookup a `AdminPlataforma` por cada request para cerrar ese
 * hueco (mismo criterio que cualquier guard de esta app: la DB es la
 * fuente de verdad, el JWT solo prueba identidad).
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

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

    const tokenInvalidoError = new UnauthorizedException({
      error: 'Token de plataforma inválido o expirado',
      code: 'UNAUTHORIZED',
    });

    let platformAdminId: string;
    try {
      const claims = await verificarPlatformAdminToken(token);
      platformAdminId = claims.sub;
    } catch (err) {
      console.error('[PlatformAdminGuard] token inválido:', err);
      throw tokenInvalidoError;
    }

    const admin = await this.prisma.adminPlataforma.findUnique({
      where: { id: platformAdminId },
    });

    if (!admin || !admin.activo) {
      // No se distingue (en el mensaje ni el código) entre "no existe" y
      // "existe pero inactivo" — mismo criterio de no filtrar información
      // que el resto de los guards de esta app.
      throw tokenInvalidoError;
    }

    request.platformAdminId = platformAdminId;

    return true;
  }
}
