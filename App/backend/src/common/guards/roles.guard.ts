import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { RolUsuario } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Guard de rol — Fase 2, Día 8.
 *
 * Valida el claim `rol` del JWT (embebido por el Auth Hook de Supabase, ver
 * Día 8 — `custom_access_token_hook`, valores = `RolUsuario`: `ALUMNO` |
 * `MAESTRO` | `ADMINISTRATIVO`) contra los roles declarados con
 * `@Roles(...)` (`src/common/decorators/roles.decorator.ts`) en la ruta.
 *
 * INVARIANTE DE COMPOSICIÓN — este guard NO verifica el JWT por su cuenta:
 * reutiliza `request.jwtClaims` que `SedeGuard` (Fase 1, Día 6) ya deja
 * poblado tras verificar la firma. Por eso `RolesGuard` SIEMPRE debe
 * aplicarse DESPUÉS de `SedeGuard` en el mismo `@UseGuards(...)` — Nest
 * ejecuta los guards en el orden en que se listan:
 *
 * ```ts
 * @UseGuards(SedeGuard, RolesGuard)
 * @Roles(RolUsuario.ADMINISTRATIVO)
 * ```
 *
 * Si `request.jwtClaims?.rol` no existe cuando este guard corre, significa
 * que `SedeGuard` no corrió antes (o el `@UseGuards` está mal compuesto) —
 * revienta con un 500 explícito en vez de dejar pasar `undefined`
 * silenciosamente (mismo criterio que `@SedeActual()`, ver
 * `sede-actual.decorator.ts`).
 *
 * Si la ruta no declara `@Roles(...)`, el guard deja pasar sin restringir
 * nada (comportamiento estándar de Nest para guards basados en metadata
 * opcional).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const rolesRequeridos = this.reflector.getAllAndOverride<
      RolUsuario[] | undefined
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);

    if (!rolesRequeridos || rolesRequeridos.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const rolClaim = request.jwtClaims?.['rol'];

    if (typeof rolClaim !== 'string' || rolClaim.length === 0) {
      throw new InternalServerErrorException({
        error:
          'RolesGuard se usó sin que SedeGuard corriera antes (falta request.jwtClaims.rol) — agrega @UseGuards(SedeGuard, RolesGuard) en ese orden.',
        code: 'SERVER_ERROR',
      });
    }

    if (!rolesRequeridos.includes(rolClaim as RolUsuario)) {
      throw new ForbiddenException({
        error: 'Tu rol no tiene acceso a este recurso',
        code: 'ROL_NO_AUTORIZADO',
      });
    }

    return true;
  }
}
