import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccionAuditoria, Prisma, type Grupo } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CrearGrupoDto } from './dto/crear-grupo.dto';
import type { ListarGruposQueryDto } from './dto/listar-grupos.query.dto';

export interface GrupoListItem {
  id: string;
  nombre: string;
  anioInicio: number;
  cicloActual: number;
  capacidad: number;
  carrera: { id: string; nombre: string };
  salon: { id: string; nombre: string };
}

export interface ListarGruposResult {
  data: GrupoListItem[];
  page: number;
  limit: number;
  total: number;
}

@Injectable()
export class GruposService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `POST /grupos` — Fase 9, Día 28. `sedeId` sale SIEMPRE de
   * `@SedeActual()` (regla 2), nunca del body. Orden de validaciones:
   * 1. Tipos/rangos básicos ya cubiertos por `CrearGrupoDto`.
   * 2. `carreraId` debe existir y pertenecer a la sede -> 404 NOT_FOUND.
   * 3. `cicloActual` debe caer entre 1 y `carrera.duracion` -> 400
   *    VALIDATION_ERROR.
   * 4. `salonId` debe existir y pertenecer a la sede -> 404 NOT_FOUND.
   * 5. `nombre` único por sede+periodo (case-insensitive, sin unique
   *    compuesto nuevo en el schema, mismo criterio que `Carrera.nombre`
   *    en Día 21) -> 409 CONFLICT.
   * `RegistroAuditoria` se crea en la misma transacción del alta, con
   * `usuarioId` = actor (regla 5).
   *
   * Fuera de alcance a propósito (ver spec): no valida `capacidad <=
   * salon.capacidad`, ni choque de salón en el mismo periodo.
   */
  async crear(
    dto: CrearGrupoDto,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<Grupo> {
    const carrera = await this.prisma.carrera.findFirst({
      where: { id: dto.carreraId, sedeId },
    });
    if (!carrera) {
      throw new NotFoundException({
        error: 'Carrera no encontrada en tu sede',
        code: 'NOT_FOUND',
      });
    }

    if (dto.cicloActual < 1 || dto.cicloActual > carrera.duracion) {
      throw new BadRequestException({
        error: `cicloActual debe estar entre 1 y ${carrera.duracion} para esta carrera`,
        code: 'VALIDATION_ERROR',
      });
    }

    const salon = await this.prisma.salon.findFirst({
      where: { id: dto.salonId, sedeId },
    });
    if (!salon) {
      throw new NotFoundException({
        error: 'Salón no encontrado en tu sede',
        code: 'NOT_FOUND',
      });
    }

    const existente = await this.prisma.grupo.findFirst({
      where: {
        sedeId,
        anioInicio: dto.anioInicio,
        cicloActual: dto.cicloActual,
        nombre: { equals: dto.nombre, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (existente) {
      throw new ConflictException({
        error: 'Ya existe un grupo con ese nombre en ese periodo',
        code: 'CONFLICT',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const grupo = await tx.grupo.create({
        data: {
          sedeId,
          carreraId: dto.carreraId,
          salonId: dto.salonId,
          nombre: dto.nombre,
          anioInicio: dto.anioInicio,
          cicloActual: dto.cicloActual,
          capacidad: dto.capacidad,
        },
      });

      await tx.registroAuditoria.create({
        data: {
          usuarioId: actorUsuarioId,
          sedeId,
          accion: AccionAuditoria.ALTA,
          entidad: 'Grupo',
          entidadId: grupo.id,
          detalle: {
            nombre: grupo.nombre,
            anioInicio: grupo.anioInicio,
            cicloActual: grupo.cicloActual,
          },
        },
      });

      return grupo;
    });
  }

  /**
   * `GET /grupos` — Fase 9, Día 28. Todos los filtros opcionales. Orden:
   * periodos más recientes primero (`anioInicio desc, cicloActual desc`),
   * luego `nombre asc`. `carrera`/`salon` expandidos a `{ id, nombre }`
   * para que la UI de Día 29 no haga N+1 requests — a diferencia de
   * `crear`, que devuelve el `Grupo` plano sin relaciones.
   */
  async listar(
    filtros: ListarGruposQueryDto,
    sedeId: string,
  ): Promise<ListarGruposResult> {
    const page = filtros.page ?? 1;
    const limit = filtros.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.GrupoWhereInput = {
      sedeId,
      ...(filtros.anioInicio !== undefined
        ? { anioInicio: filtros.anioInicio }
        : {}),
      ...(filtros.cicloActual !== undefined
        ? { cicloActual: filtros.cicloActual }
        : {}),
      ...(filtros.carreraId ? { carreraId: filtros.carreraId } : {}),
    };

    const [total, grupos] = await this.prisma.$transaction([
      this.prisma.grupo.count({ where }),
      this.prisma.grupo.findMany({
        where,
        orderBy: [
          { anioInicio: 'desc' },
          { cicloActual: 'desc' },
          { nombre: 'asc' },
        ],
        skip,
        take: limit,
        select: {
          id: true,
          nombre: true,
          anioInicio: true,
          cicloActual: true,
          capacidad: true,
          carrera: { select: { id: true, nombre: true } },
          salon: { select: { id: true, nombre: true } },
        },
      }),
    ]);

    return { data: grupos, page, limit, total };
  }
}
