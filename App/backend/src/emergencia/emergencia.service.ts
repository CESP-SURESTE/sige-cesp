import { Injectable, NotFoundException } from '@nestjs/common';
import { AccionAuditoria, type TelefonoEmergenciaSede } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CrearTelefonoDto } from './dto/crear-telefono.dto';
import type { ActualizarTelefonoDto } from './dto/actualizar-telefono.dto';
import { hayCambiosRealesTelefono } from './emergencia.util';

/**
 * Módulo de emergencia — CRUD de teléfonos de emergencia por sede
 * (`TelefonoEmergenciaSede`, Task 1). Mismo patrón que `SalonesService`:
 * `sedeId` siempre de `@SedeActual()` (regla 2), transacción + auditoría en
 * la misma tx, `console.error` en cada catch (regla 12), `findFirst({ id,
 * sedeId })` para verificar pertenencia a la sede antes de tocar nada.
 */
@Injectable()
export class EmergenciaService {
  constructor(private readonly prisma: PrismaService) {}

  async listarTelefonos(sedeId: string): Promise<TelefonoEmergenciaSede[]> {
    try {
      return await this.prisma.telefonoEmergenciaSede.findMany({
        where: { sedeId },
        orderBy: { orden: 'asc' },
      });
    } catch (err) {
      console.error('[EmergenciaService.listarTelefonos] error inesperado:', err);
      throw err;
    }
  }

  async crearTelefono(
    dto: CrearTelefonoDto,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<TelefonoEmergenciaSede> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const agg = await tx.telefonoEmergenciaSede.aggregate({
          where: { sedeId },
          _max: { orden: true },
        });
        const orden = (agg._max.orden ?? 0) + 1;

        const telefono = await tx.telefonoEmergenciaSede.create({
          data: { sedeId, etiqueta: dto.etiqueta, telefono: dto.telefono, orden },
        });

        await tx.registroAuditoria.create({
          data: {
            usuarioId: actorUsuarioId,
            sedeId,
            accion: AccionAuditoria.ALTA,
            entidad: 'TelefonoEmergenciaSede',
            entidadId: telefono.id,
            detalle: { etiqueta: telefono.etiqueta, telefono: telefono.telefono },
          },
        });

        return telefono;
      });
    } catch (err) {
      console.error('[EmergenciaService.crearTelefono] error inesperado:', err);
      throw err;
    }
  }

  async actualizarTelefono(
    id: string,
    dto: ActualizarTelefonoDto,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<TelefonoEmergenciaSede> {
    const existente = await this.prisma.telefonoEmergenciaSede.findFirst({
      where: { id, sedeId },
    });
    if (!existente) {
      throw new NotFoundException({
        error: 'Teléfono de emergencia no encontrado en tu sede',
        code: 'NOT_FOUND',
      });
    }

    const registrarAuditoria = hayCambiosRealesTelefono(dto, existente);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const telefono = await tx.telefonoEmergenciaSede.update({
          where: { id },
          data: { etiqueta: dto.etiqueta, telefono: dto.telefono },
        });

        if (registrarAuditoria) {
          await tx.registroAuditoria.create({
            data: {
              usuarioId: actorUsuarioId,
              sedeId,
              accion: AccionAuditoria.EDICION,
              entidad: 'TelefonoEmergenciaSede',
              entidadId: telefono.id,
              detalle: {
                etiqueta: telefono.etiqueta,
                telefono: telefono.telefono,
              },
            },
          });
        }

        return telefono;
      });
    } catch (err) {
      console.error(
        '[EmergenciaService.actualizarTelefono] error inesperado:',
        err,
      );
      throw err;
    }
  }

  async eliminarTelefono(
    id: string,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<{ ok: true }> {
    const existente = await this.prisma.telefonoEmergenciaSede.findFirst({
      where: { id, sedeId },
    });
    if (!existente) {
      throw new NotFoundException({
        error: 'Teléfono de emergencia no encontrado en tu sede',
        code: 'NOT_FOUND',
      });
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.registroAuditoria.create({
          data: {
            usuarioId: actorUsuarioId,
            sedeId,
            accion: AccionAuditoria.ELIMINACION,
            entidad: 'TelefonoEmergenciaSede',
            entidadId: existente.id,
            detalle: {
              etiqueta: existente.etiqueta,
              telefono: existente.telefono,
            },
          },
        });
        await tx.telefonoEmergenciaSede.delete({ where: { id } });
      });
    } catch (err) {
      console.error('[EmergenciaService.eliminarTelefono] error inesperado:', err);
      throw err;
    }

    return { ok: true as const };
  }
}
