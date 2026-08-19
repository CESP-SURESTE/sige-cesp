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

  /**
   * `DELETE /sedes/:id` — Fase 6, Día 22. Actor `AdminPlataforma`, mismo
   * patrón que `crear`/`actualizar`. DELETE real (Sede sigue en el patrón
   * "CRUD completo" de CLAUDE.md, no baja lógica) — no soft delete.
   *
   * Chequeo de negocio explícito: no se puede eliminar una sede con alumnos
   * `activo: true` (mismo campo de baja lógica que usa todo el sistema,
   * regla 3 — un alumno dado de baja no bloquea, sin importar su
   * `estatusAcademico`). Cualquier otro dato asociado (carreras, salones,
   * grupos, personal, maestros/administrativos) cae en el catch de `P2003`
   * de abajo — enumerar cada tabla posible acá sería frágil y se
   * desactualizaría con cada tabla nueva que referencie `Sede` a futuro.
   *
   * El `RegistroAuditoria` de `ELIMINACION` se crea ANTES del `tx.sede.delete`
   * dentro de la misma transacción — el `onDelete: SetNull` de la migración
   * de este día nulifica `sedeId` en ese registro (y en cualquier otro
   * histórico de esta sede) automáticamente al borrar el padre, sin que la
   * app ejecute ningún UPDATE/DELETE sobre `registro_auditoria` (regla 5).
   * `detalle: { nombre: sede.nombre }` es un snapshot — después del delete,
   * `entidadId` es lo único que queda para identificar qué sede era.
   */
  async eliminar(id: string, actorPlatformAdminId: string) {
    const sede = await this.prisma.sede.findUnique({ where: { id } });
    if (!sede) {
      throw new NotFoundException({
        error: 'Sede no encontrada',
        code: 'NOT_FOUND',
      });
    }

    const alumnosActivos = await this.prisma.usuario.count({
      where: { sedeId: id, rol: 'ALUMNO', activo: true },
    });
    if (alumnosActivos > 0) {
      throw new ConflictException({
        error: `No se puede eliminar: la sede tiene ${alumnosActivos} alumno(s) activo(s)`,
        code: 'CONFLICT',
      });
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.registroAuditoria.create({
          data: {
            adminPlataformaId: actorPlatformAdminId,
            sedeId: sede.id,
            accion: AccionAuditoria.ELIMINACION,
            entidad: 'Sede',
            entidadId: sede.id,
            detalle: { nombre: sede.nombre },
          },
        });

        await tx.sede.delete({ where: { id } });
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        throw new ConflictException({
          error:
            'No se puede eliminar: la sede tiene otros datos asociados (carreras, personal, etc.)',
          code: 'CONFLICT',
        });
      }
      console.error('[SedesService.eliminar] error inesperado:', err);
      throw err;
    }

    return { ok: true as const };
  }
}
