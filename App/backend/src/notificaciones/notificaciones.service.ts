import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface NotificacionItem {
  id: string;
  tipo: 'AVISO' | 'RECORDATORIO_EVENTO';
  referenciaId: string;
  titulo: string;
  cuerpoCorto: string;
  leidoEn: Date | null;
  createdAt: Date;
}

/**
 * `NotificacionesService` — Fase 14, Día 38.
 *
 * Feed in-app del usuario autenticado. El `usuarioId` SIEMPRE viene de
 * `@ActorUsuarioId()` (JWT `sub`) en el controller, nunca de la ruta. La
 * `Notificacion` NO se audita (regla 5 aplica a acciones de negocio; esto
 * es estado de entrega derivado, alto volumen).
 *
 * Doble capa de aislamiento (regla 2): RLS por `sede_id` en Postgres +
 * este filtro por `usuarioId` a nivel de aplicación — un usuario nunca ve
 * las notificaciones de otro de su misma sede.
 */
@Injectable()
export class NotificacionesService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(
    usuarioId: string,
    page: number,
    limit: number,
  ): Promise<{
    data: NotificacionItem[];
    page: number;
    limit: number;
    total: number;
  }> {
    const skip = (page - 1) * limit;
    try {
      const [total, filas] = await this.prisma.$transaction([
        this.prisma.notificacion.count({ where: { usuarioId } }),
        this.prisma.notificacion.findMany({
          where: { usuarioId },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
          select: {
            id: true,
            tipo: true,
            referenciaId: true,
            titulo: true,
            cuerpoCorto: true,
            leidoEn: true,
            createdAt: true,
          },
        }),
      ]);
      return { data: filas, page, limit, total };
    } catch (err) {
      console.error('[NotificacionesService.listar] error inesperado:', err);
      throw new InternalServerErrorException({
        error: 'Error inesperado al listar las notificaciones',
        code: 'SERVER_ERROR',
      });
    }
  }

  async contarNoLeidas(usuarioId: string): Promise<{ total: number }> {
    try {
      const total = await this.prisma.notificacion.count({
        where: { usuarioId, leidoEn: null },
      });
      return { total };
    } catch (err) {
      console.error(
        '[NotificacionesService.contarNoLeidas] error inesperado:',
        err,
      );
      throw new InternalServerErrorException({
        error: 'Error inesperado al contar las notificaciones no leídas',
        code: 'SERVER_ERROR',
      });
    }
  }

  /**
   * Marca una notificación como leída. Idempotente: si ya estaba leída, no
   * es error (se re-escribe `leidoEn` con la fecha actual — aceptable, el
   * caso normal es un solo click). 404 si la notificación no existe o no
   * pertenece al actor (mismo criterio "no distinguir" que el resto de la
   * API).
   */
  async marcarLeida(id: string, usuarioId: string): Promise<{ ok: true }> {
    try {
      const existente = await this.prisma.notificacion.findFirst({
        where: { id, usuarioId },
        select: { id: true },
      });
      if (!existente) {
        throw new NotFoundException({
          error: 'Notificación no encontrada',
          code: 'NOT_FOUND',
        });
      }
      await this.prisma.notificacion.update({
        where: { id },
        data: { leidoEn: new Date() },
      });
      return { ok: true };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      console.error(
        '[NotificacionesService.marcarLeida] error inesperado:',
        err,
      );
      throw new InternalServerErrorException({
        error: 'Error inesperado al marcar la notificación como leída',
        code: 'SERVER_ERROR',
      });
    }
  }
}
