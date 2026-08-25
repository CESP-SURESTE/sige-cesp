import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface SalonListItem {
  id: string;
  nombre: string;
  capacidad: number;
}

@Injectable()
export class SalonesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `GET /salones` — Fase 9, Día 29 (gap de backend descubierto al planear
   * la UI de creación de grupos). Desbloquea el dropdown de `salonId` del
   * formulario de alta de grupo (`POST /grupos`, Día 28) — sin este
   * endpoint no había forma de listar los salones de la sede desde el
   * frontend. Shape mínimo (`id`/`nombre`/`capacidad`), sin paginar — mismo
   * criterio que `GET /carreras` (catálogo chico por sede).
   */
  async listarPorSede(sedeId: string): Promise<SalonListItem[]> {
    try {
      return await this.prisma.salon.findMany({
        where: { sedeId },
        orderBy: { nombre: 'asc' },
        select: { id: true, nombre: true, capacidad: true },
      });
    } catch (err) {
      console.error('[SalonesService.listarPorSede] error inesperado:', err);
      throw err;
    }
  }
}
