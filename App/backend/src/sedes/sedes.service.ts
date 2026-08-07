import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SedesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Trae una sede por id. El `SedeGuard` ya garantizó, antes de llegar acá,
   * que `id` coincide con el `sede_id` del JWT de quien hace la request
   * (ver `SedeGuard` — compara el param `:sedeId` contra el JWT). Este
   * service solo se preocupa de la lectura en sí.
   */
  async obtenerPorId(id: string) {
    const sede = await this.prisma.sede.findUnique({ where: { id } });

    if (!sede) {
      throw new NotFoundException({
        error: 'Sede no encontrada',
        code: 'NOT_FOUND',
      });
    }

    return sede;
  }
}
