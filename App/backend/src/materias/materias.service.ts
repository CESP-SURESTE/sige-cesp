import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccionAuditoria, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CrearMateriaDto } from './dto/crear-materia.dto';

export interface MateriaDto {
  id: string;
  nombre: string;
  carreraId: string;
  ciclo: number;
}

@Injectable()
export class MateriasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resuelve una carrera exigiendo que pertenezca a la sede del actor
   * (mismo criterio que `CarrerasService.actualizar` / `GruposService.crear`):
   * un solo `findFirst({ id, sedeId })`, 404 si no aparece — sin distinguir
   * "no existe" de "existe en otra sede".
   */
  private async obtenerCarreraEnSede(carreraId: string, sedeId: string) {
    const carrera = await this.prisma.carrera.findFirst({
      where: { id: carreraId, sedeId },
    });
    if (!carrera) {
      throw new NotFoundException({
        error: 'Carrera no encontrada en tu sede',
        code: 'NOT_FOUND',
      });
    }
    return carrera;
  }

  /**
   * `GET /materias?carreraId=&ciclo=` — Fase 12, Día 33. `carreraId`
   * requerido; debe ser de la sede del actor o 404. Sin paginación
   * (catálogo chico). Orden `ciclo asc, nombre asc`.
   */
  async listar(
    carreraId: string,
    ciclo: number | undefined,
    sedeId: string,
  ): Promise<MateriaDto[]> {
    await this.obtenerCarreraEnSede(carreraId, sedeId);

    const materias = await this.prisma.materia.findMany({
      where: { carreraId, ...(ciclo !== undefined ? { ciclo } : {}) },
      orderBy: [{ ciclo: 'asc' }, { nombre: 'asc' }],
      select: { id: true, nombre: true, carreraId: true, ciclo: true },
    });
    return materias;
  }

  /**
   * `nombre` único por `(carreraId, ciclo)` case-insensitive — validado a
   * nivel de aplicación (sin `@@unique` compuesto nuevo en el schema, mismo
   * criterio que `Carrera.nombre` en Día 21).
   */
  private async verificarNombreDuplicado(
    nombre: string,
    carreraId: string,
    ciclo: number,
  ): Promise<void> {
    const existente = await this.prisma.materia.findFirst({
      where: {
        carreraId,
        ciclo,
        nombre: { equals: nombre, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (existente) {
      throw new ConflictException({
        error:
          'Ya existe una materia con ese nombre en ese ciclo de la carrera',
        code: 'CONFLICT',
      });
    }
  }

  /**
   * `POST /materias` — Fase 12, Día 33. Carrera de la sede del actor (404);
   * `ciclo` entre 1 y `carrera.duracion` (400); `nombre` único por
   * carrera+ciclo (409). Audita `ALTA` en la misma transacción (regla 5).
   */
  async crear(
    dto: CrearMateriaDto,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<MateriaDto> {
    const carrera = await this.obtenerCarreraEnSede(dto.carreraId, sedeId);

    if (dto.ciclo < 1 || dto.ciclo > carrera.duracion) {
      throw new BadRequestException({
        error: `ciclo debe estar entre 1 y ${carrera.duracion} para esta carrera`,
        code: 'VALIDATION_ERROR',
      });
    }

    await this.verificarNombreDuplicado(dto.nombre, dto.carreraId, dto.ciclo);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const materia = await tx.materia.create({
          data: {
            nombre: dto.nombre,
            carreraId: dto.carreraId,
            ciclo: dto.ciclo,
          },
          select: { id: true, nombre: true, carreraId: true, ciclo: true },
        });

        await tx.registroAuditoria.create({
          data: {
            usuarioId: actorUsuarioId,
            sedeId,
            accion: AccionAuditoria.ALTA,
            entidad: 'Materia',
            entidadId: materia.id,
          },
        });

        return materia;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Defensivo — el pre-check de aplicación ya cubre el duplicado; no
        // hay `@@unique` en `Materia`, así que este camino no debería
        // dispararse. Se degrada al contrato por si acaso.
        throw new ConflictException({
          error:
            'Ya existe una materia con ese nombre en ese ciclo de la carrera',
          code: 'CONFLICT',
        });
      }
      console.error('[MateriasService.crear] error inesperado:', err);
      throw err;
    }
  }
}
