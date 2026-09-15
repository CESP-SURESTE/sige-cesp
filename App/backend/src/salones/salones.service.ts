import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccionAuditoria, Prisma, type Salon } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ActualizarSalonDto } from './dto/actualizar-salon.dto';
import type { CrearSalonDto } from './dto/crear-salon.dto';

export interface SalonListItem {
  id: string;
  nombre: string;
  capacidad: number;
}

/**
 * Compara cada campo presente en el `dto` contra el valor actual del salón —
 * mismo criterio que `hayCambiosReales` de `CarrerasService`/`SedesService`.
 * Un campo ausente del `dto` (PATCH parcial o vacío) nunca cuenta como
 * cambio.
 */
function hayCambiosReales(dto: ActualizarSalonDto, existente: Salon): boolean {
  const campos = ['nombre', 'capacidad'] as const;

  for (const campo of campos) {
    if (dto[campo] !== undefined && dto[campo] !== existente[campo]) {
      return true;
    }
  }

  return false;
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

  /**
   * `nombre` duplicado DENTRO DE LA MISMA SEDE — el schema ya tiene el
   * unique compuesto `@@unique([sedeId, nombre])` como backstop de DB, pero
   * se valida primero a nivel de aplicación (mismo criterio que
   * `CarrerasService`/`GruposService`) para dar un mensaje de error claro
   * en vez de depender del `P2002` crudo. `excluirId` se usa en `PATCH`
   * para no chocar contra el propio salón que se está editando.
   */
  private async verificarNombreDuplicado(
    nombre: string,
    sedeId: string,
    excluirId?: string,
  ): Promise<void> {
    const existente = await this.prisma.salon.findFirst({
      where: {
        sedeId,
        nombre: { equals: nombre, mode: 'insensitive' },
        ...(excluirId ? { id: { not: excluirId } } : {}),
      },
      select: { id: true },
    });

    if (existente) {
      throw new ConflictException({
        error: 'Ya existe un salón con ese nombre en tu sede',
        code: 'CONFLICT',
      });
    }
  }

  /**
   * `POST /salones` — Fase 9, día CRUD de Salón. `sedeId` sale SIEMPRE de
   * `@SedeActual()` (regla 2), nunca del body. `RegistroAuditoria` se crea
   * en la misma transacción del alta.
   */
  async crear(
    dto: CrearSalonDto,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<Salon> {
    await this.verificarNombreDuplicado(dto.nombre, sedeId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const salon = await tx.salon.create({
          data: {
            sedeId,
            nombre: dto.nombre,
            capacidad: dto.capacidad,
          },
        });

        await tx.registroAuditoria.create({
          data: {
            usuarioId: actorUsuarioId,
            sedeId,
            accion: AccionAuditoria.ALTA,
            entidad: 'Salon',
            entidadId: salon.id,
            detalle: { nombre: salon.nombre, capacidad: salon.capacidad },
          },
        });

        return salon;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          error: 'Ya existe un salón con ese nombre en tu sede',
          code: 'CONFLICT',
        });
      }
      console.error('[SalonesService.crear] error inesperado:', err);
      throw err;
    }
  }

  /**
   * `PATCH /salones/:id` — Fase 9, día CRUD de Salón. `id` debe existir Y
   * pertenecer a la sede del actor (`findFirst({ id, sedeId })`, mismo
   * criterio que `CarrerasService.actualizar`). `PATCH` vacío es válido —
   * no dispara auditoría (`hayCambiosReales`).
   */
  async actualizar(
    id: string,
    dto: ActualizarSalonDto,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<Salon> {
    const existente = await this.prisma.salon.findFirst({
      where: { id, sedeId },
    });
    if (!existente) {
      throw new NotFoundException({
        error: 'Salón no encontrado en tu sede',
        code: 'NOT_FOUND',
      });
    }

    if (dto.nombre !== undefined && dto.nombre !== existente.nombre) {
      await this.verificarNombreDuplicado(dto.nombre, sedeId, id);
    }

    const registrarAuditoria = hayCambiosReales(dto, existente);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const salon = await tx.salon.update({
          where: { id },
          data: {
            nombre: dto.nombre,
            capacidad: dto.capacidad,
          },
        });

        if (registrarAuditoria) {
          await tx.registroAuditoria.create({
            data: {
              usuarioId: actorUsuarioId,
              sedeId,
              accion: AccionAuditoria.EDICION,
              entidad: 'Salon',
              entidadId: salon.id,
              detalle: { nombre: salon.nombre, capacidad: salon.capacidad },
            },
          });
        }

        return salon;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          error: 'Ya existe un salón con ese nombre en tu sede',
          code: 'CONFLICT',
        });
      }
      console.error('[SalonesService.actualizar] error inesperado:', err);
      throw err;
    }
  }

  /**
   * `DELETE /salones/:id` — Fase 9, día CRUD de Salón. `id` debe existir Y
   * pertenecer a la sede del actor. Bloquea con `409 CONFLICT` si el salón
   * tiene grupos asociados (`Grupo.salonId`, sin `onDelete` en el schema =
   * `Restrict` por default de Postgres/Prisma) — chequeo explícito con
   * mensaje claro, más un `catch` de `P2003` como fallback defensivo (mismo
   * patrón que `SedesService.eliminar`). El `RegistroAuditoria` de
   * `ELIMINACION` se crea ANTES del `tx.salon.delete` dentro de la misma
   * transacción (mismo orden que `SedesService.eliminar`), con
   * `detalle: { nombre }` como snapshot — después del delete, `entidadId`
   * es lo único que queda para identificar qué salón era.
   */
  async eliminar(
    id: string,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<{ ok: true }> {
    const salon = await this.prisma.salon.findFirst({
      where: { id, sedeId },
    });
    if (!salon) {
      throw new NotFoundException({
        error: 'Salón no encontrado en tu sede',
        code: 'NOT_FOUND',
      });
    }

    const gruposAsociados = await this.prisma.grupo.count({
      where: { salonId: id },
    });
    if (gruposAsociados > 0) {
      throw new ConflictException({
        error: `No se puede eliminar: el salón tiene ${gruposAsociados} grupo(s) asociado(s)`,
        code: 'CONFLICT',
      });
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.registroAuditoria.create({
          data: {
            usuarioId: actorUsuarioId,
            sedeId,
            accion: AccionAuditoria.ELIMINACION,
            entidad: 'Salon',
            entidadId: salon.id,
            detalle: { nombre: salon.nombre },
          },
        });

        await tx.salon.delete({ where: { id } });
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        throw new ConflictException({
          error: 'No se puede eliminar: el salón tiene datos asociados',
          code: 'CONFLICT',
        });
      }
      console.error('[SalonesService.eliminar] error inesperado:', err);
      throw err;
    }

    return { ok: true as const };
  }
}
