import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Guard del endpoint interno del job de recordatorios — Fase 15, Día 42.
 * NO pasa por `SedeGuard`/`RolesGuard` (no hay JWT de usuario ni de
 * `AdminPlataforma` acá — lo dispara `pg_cron`/`pg_net` de Supabase, o una
 * GitHub Action, no un humano logueado). Exige un header
 * `X-Internal-Secret` que coincida exactamente con
 * `process.env.INTERNAL_JOB_SECRET`.
 *
 * Mismo criterio de "no distinguir el motivo del rechazo" que el resto de
 * la app: falta el header, header incorrecto, o `INTERNAL_JOB_SECRET` sin
 * configurar en el entorno — los 3 casos devuelven el mismo 401.
 */
@Injectable()
export class InternalJobGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const secretoEsperado = process.env.INTERNAL_JOB_SECRET;
    const secretoRecibido = request.headers['x-internal-secret'];

    if (
      !secretoEsperado ||
      typeof secretoRecibido !== 'string' ||
      secretoRecibido !== secretoEsperado
    ) {
      throw new UnauthorizedException({
        error: 'Secreto interno inválido o ausente',
        code: 'UNAUTHORIZED',
      });
    }

    return true;
  }
}
