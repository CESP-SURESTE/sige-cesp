import { Injectable } from '@nestjs/common';
import { AccionAuditoria } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Id fijo de la única fila de `ConfiguracionSoporte` — sembrada por la migración `20260924120000_bot_soporte`. */
export const CONFIGURACION_SOPORTE_ID = 'global';

@Injectable()
export class SoporteService {
  constructor(protected readonly prisma: PrismaService) {}

  /**
   * `upsert` en vez de `findUniqueOrThrow` — garantiza que la fila exista
   * incluso si el seed de la migración no corrió (ej. DB recreada a mano),
   * sin necesitar un chequeo defensivo aparte.
   */
  async obtenerConfig(): Promise<{ activo: boolean }> {
    const config = await this.prisma.configuracionSoporte.upsert({
      where: { id: CONFIGURACION_SOPORTE_ID },
      create: { id: CONFIGURACION_SOPORTE_ID },
      update: {},
    });
    return { activo: config.activo };
  }

  async actualizarConfig(
    activo: boolean,
    adminPlataformaId: string,
  ): Promise<{ activo: boolean }> {
    const config = await this.prisma.$transaction(async (tx) => {
      const actualizado = await tx.configuracionSoporte.upsert({
        where: { id: CONFIGURACION_SOPORTE_ID },
        create: { id: CONFIGURACION_SOPORTE_ID, activo },
        update: { activo },
      });
      await tx.registroAuditoria.create({
        data: {
          adminPlataformaId,
          accion: AccionAuditoria.EDICION,
          entidad: 'ConfiguracionSoporte',
          entidadId: CONFIGURACION_SOPORTE_ID,
          detalle: { activo },
        },
      });
      return actualizado;
    });
    return { activo: config.activo };
  }
}
