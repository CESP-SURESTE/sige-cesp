import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccionAuditoria, Prisma, type Sede } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ActualizarSedeDto } from './dto/actualizar-sede.dto';
import type { CrearSedeDto } from './dto/crear-sede.dto';

/**
 * `PATCH /sedes/:id` (hallazgo deferred de Día 20, corregido 2026-08-16, a
 * pedido explícito del usuario: "un PATCH sin cambios reales no cuenta como
 * edición auditable") — compara cada campo presente en el `dto` contra el
 * valor actual de la sede. Un campo ausente del `dto` (PATCH parcial u
 * PATCH vacío) nunca cuenta como cambio. `costoRenta` es `Prisma.Decimal` en
 * DB vs. `number` en el DTO — se normaliza a `number` antes de comparar.
 */
function hayCambiosReales(dto: ActualizarSedeDto, existente: Sede): boolean {
  const camposTexto = [
    'nombre',
    'direccion',
    'ubicacionReferencia',
    'telefono',
  ] as const;

  for (const campo of camposTexto) {
    if (dto[campo] !== undefined && dto[campo] !== existente[campo]) {
      return true;
    }
  }

  if (dto.costoRenta !== undefined) {
    const actual =
      existente.costoRenta === null ? null : Number(existente.costoRenta);
    if (actual !== dto.costoRenta) {
      return true;
    }
  }

  return false;
}

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

  /**
   * `POST/GET/PATCH /sedes` — Fase 6, Día 20. Actor: `AdminPlataforma`, sin
   * `sedeId` de contexto (crear una sede es, por diseño, una acción sin
   * sede — ver nota en `docs/roadmap.md`). `RegistroAuditoria` se crea en la
   * misma transacción, con `adminPlataformaId` (nunca `usuarioId`, regla del
   * CHECK constraint de la migración de este día) y `sedeId` = la sede
   * recién creada/editada.
   */
  async crear(dto: CrearSedeDto, actorPlatformAdminId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const sede = await tx.sede.create({
          data: {
            nombre: dto.nombre,
            direccion: dto.direccion,
            ubicacionReferencia: dto.ubicacionReferencia,
            telefono: dto.telefono,
            costoRenta: dto.costoRenta,
          },
        });

        await tx.registroAuditoria.create({
          data: {
            adminPlataformaId: actorPlatformAdminId,
            sedeId: sede.id,
            accion: AccionAuditoria.ALTA,
            entidad: 'Sede',
            entidadId: sede.id,
          },
        });

        return sede;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          error: 'Ya existe una sede con ese nombre',
          code: 'CONFLICT',
        });
      }
      console.error('[SedesService.crear] error inesperado:', err);
      throw err;
    }
  }

  async listar() {
    return this.prisma.sede.findMany({ orderBy: { nombre: 'asc' } });
  }

  async actualizar(
    id: string,
    dto: ActualizarSedeDto,
    actorPlatformAdminId: string,
  ) {
    const existente = await this.prisma.sede.findUnique({ where: { id } });
    if (!existente) {
      throw new NotFoundException({
        error: 'Sede no encontrada',
        code: 'NOT_FOUND',
      });
    }

    const registrarAuditoria = hayCambiosReales(dto, existente);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const sede = await tx.sede.update({
          where: { id },
          data: {
            nombre: dto.nombre,
            direccion: dto.direccion,
            ubicacionReferencia: dto.ubicacionReferencia,
            telefono: dto.telefono,
            costoRenta: dto.costoRenta,
          },
        });

        if (registrarAuditoria) {
          await tx.registroAuditoria.create({
            data: {
              adminPlataformaId: actorPlatformAdminId,
              sedeId: sede.id,
              accion: AccionAuditoria.EDICION,
              entidad: 'Sede',
              entidadId: sede.id,
            },
          });
        }

        return sede;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          error: 'Ya existe una sede con ese nombre',
          code: 'CONFLICT',
        });
      }
      console.error('[SedesService.actualizar] error inesperado:', err);
      throw err;
    }
  }
}
