import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  AccionAuditoria,
  EstatusAcademico,
  Prisma,
  RolUsuario,
  type Grupo,
  type GrupoAlumno,
} from '@prisma/client';
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

export interface GrupoAlumnoListItem {
  usuarioId: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  matricula: string;
  semestreActual: number;
  estatusAcademico: EstatusAcademico;
  fechaInscripcion: string;
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

    try {
      return await this.prisma.$transaction(async (tx) => {
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
    } catch (err) {
      console.error('[GruposService.crear] error inesperado:', err);
      throw err;
    }
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
      ...(filtros.salonId ? { salonId: filtros.salonId } : {}),
    };

    try {
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
    } catch (err) {
      console.error('[GruposService.listar] error inesperado:', err);
      throw err;
    }
  }

  /**
   * `DELETE /grupos/:id` — calco del patrón de `SalonesService.eliminar`.
   * `id` debe existir Y pertenecer a la sede del actor -> 404 NOT_FOUND.
   * Bloquea con `409 CONFLICT` si el grupo tiene alumnos inscritos
   * (`GrupoAlumno`) — mensaje incluye la cantidad. `RegistroAuditoria` de
   * `ELIMINACION` se crea ANTES del `tx.grupo.delete` dentro de la misma
   * transacción, con `detalle: { nombre }` como snapshot.
   */
  async eliminar(
    id: string,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<{ ok: true }> {
    const grupo = await this.prisma.grupo.findFirst({ where: { id, sedeId } });
    if (!grupo) {
      throw new NotFoundException({
        error: 'Grupo no encontrado en tu sede',
        code: 'NOT_FOUND',
      });
    }

    const alumnosInscritos = await this.prisma.grupoAlumno.count({
      where: { grupoId: id },
    });
    if (alumnosInscritos > 0) {
      throw new ConflictException({
        error: `No se puede eliminar: el grupo tiene ${alumnosInscritos} alumno(s) inscrito(s)`,
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
            entidad: 'Grupo',
            entidadId: grupo.id,
            detalle: { nombre: grupo.nombre },
          },
        });
        await tx.grupo.delete({ where: { id } });
      });
    } catch (err) {
      console.error(
        '[GruposService.eliminar] Error inesperado eliminando grupo:',
        err,
      );
      throw new InternalServerErrorException({
        error: 'Error inesperado al eliminar el grupo',
        code: 'SERVER_ERROR',
      });
    }

    return { ok: true };
  }

  /**
   * Resuelve un `Usuario.id` a su `PerfilAlumno`, exigiendo que sea un
   * `ALUMNO` de la sede del actor. Cubre en un solo query: id inexistente,
   * alumno de otra sede (`sedeId` en el where), un `Usuario` que es
   * MAESTRO/ADMINISTRATIVO (`rol` en el where), y un ALUMNO sin fila de
   * perfil (defensivo).
   */
  private async resolverAlumnoEnSede(usuarioId: string, sedeId: string) {
    const usuario = await this.prisma.usuario.findFirst({
      where: { id: usuarioId, sedeId, rol: RolUsuario.ALUMNO },
      include: { perfilAlumno: true },
    });
    if (!usuario || !usuario.perfilAlumno) {
      throw new NotFoundException({
        error: 'Alumno no encontrado en tu sede',
        code: 'NOT_FOUND',
      });
    }
    return usuario.perfilAlumno;
  }

  private async obtenerGrupoEnSede(id: string, sedeId: string) {
    const grupo = await this.prisma.grupo.findFirst({ where: { id, sedeId } });
    if (!grupo) {
      throw new NotFoundException({
        error: 'Grupo no encontrado en tu sede',
        code: 'NOT_FOUND',
      });
    }
    return grupo;
  }

  /**
   * `POST /grupos/:id/alumnos` — Fase 10, Día 30. Valida grupo∈sede,
   * alumno∈sede (mismo `rol: ALUMNO`), y que `alumno.carreraId ===
   * grupo.carreraId` (400 VALIDATION_ERROR). Dentro de una `$transaction`:
   * pre-check de duplicado en ESTE grupo (409 CONFLICT), `count` vs
   * `grupo.capacidad` (409 CAPACIDAD_EXCEDIDA), `create`, y auditoría de
   * `ALTA`. NO valida "un grupo por periodo", ni `estatusAcademico`, ni
   * `Usuario.activo` (decisión explícita del usuario). Carrera de capacidad
   * concurrente aceptada (sin `SELECT ... FOR UPDATE`).
   */
  async matricular(
    grupoId: string,
    usuarioId: string,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<GrupoAlumno> {
    const grupo = await this.obtenerGrupoEnSede(grupoId, sedeId);
    const alumno = await this.resolverAlumnoEnSede(usuarioId, sedeId);

    if (alumno.carreraId !== grupo.carreraId) {
      throw new BadRequestException({
        error: 'El alumno pertenece a otra carrera',
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const yaInscrito = await tx.grupoAlumno.findUnique({
          where: { grupoId_alumnoId: { grupoId, alumnoId: alumno.id } },
          select: { id: true },
        });
        if (yaInscrito) {
          throw new ConflictException({
            error: 'El alumno ya está inscrito en este grupo',
            code: 'CONFLICT',
          });
        }

        const inscritos = await tx.grupoAlumno.count({ where: { grupoId } });
        if (inscritos >= grupo.capacidad) {
          throw new ConflictException({
            error: `El grupo ya alcanzó su capacidad de ${grupo.capacidad} alumno(s)`,
            code: 'CAPACIDAD_EXCEDIDA',
          });
        }

        const fila = await tx.grupoAlumno.create({
          data: { grupoId, alumnoId: alumno.id },
        });

        await tx.registroAuditoria.create({
          data: {
            usuarioId: actorUsuarioId,
            sedeId,
            accion: AccionAuditoria.ALTA,
            entidad: 'GrupoAlumno',
            entidadId: fila.id,
            detalle: {
              grupoId,
              alumnoId: alumno.id,
              matricula: alumno.matricula,
            },
          },
        });

        return fila;
      });
    } catch (err) {
      if (
        err instanceof ConflictException ||
        err instanceof BadRequestException ||
        err instanceof NotFoundException
      ) {
        throw err;
      }
      console.error('[GruposService.matricular] error inesperado:', err);
      throw err;
    }
  }

  /**
   * `DELETE /grupos/:id/alumnos/:usuarioId` — DELETE real de la fila de
   * unión (regla 3 de baja lógica no aplica a `GrupoAlumno`). Audita
   * `ELIMINACION` ANTES del `delete`, en la misma transacción.
   */
  async desmatricular(
    grupoId: string,
    usuarioId: string,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<{ ok: true }> {
    await this.obtenerGrupoEnSede(grupoId, sedeId);
    const alumno = await this.resolverAlumnoEnSede(usuarioId, sedeId);

    const fila = await this.prisma.grupoAlumno.findUnique({
      where: { grupoId_alumnoId: { grupoId, alumnoId: alumno.id } },
      select: { id: true },
    });
    if (!fila) {
      throw new NotFoundException({
        error: 'El alumno no está inscrito en este grupo',
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
            entidad: 'GrupoAlumno',
            entidadId: fila.id,
            detalle: {
              grupoId,
              alumnoId: alumno.id,
              matricula: alumno.matricula,
            },
          },
        });
        await tx.grupoAlumno.delete({ where: { id: fila.id } });
      });
    } catch (err) {
      console.error('[GruposService.desmatricular] error inesperado:', err);
      throw new InternalServerErrorException({
        error: 'Error inesperado al desmatricular al alumno',
        code: 'SERVER_ERROR',
      });
    }

    return { ok: true };
  }

  /**
   * `GET /grupos/:id/alumnos` — inscritos de un grupo. Sin paginar
   * (catálogo chico, ≤ capacidad). Orden `apellidoPaterno, apellidoMaterno,
   * nombres` (igual que `GET /personas`).
   */
  async listarAlumnos(
    grupoId: string,
    sedeId: string,
  ): Promise<GrupoAlumnoListItem[]> {
    await this.obtenerGrupoEnSede(grupoId, sedeId);

    try {
      const filas = await this.prisma.grupoAlumno.findMany({
        where: { grupoId },
        orderBy: [
          { alumno: { apellidoPaterno: 'asc' } },
          { alumno: { apellidoMaterno: 'asc' } },
          { alumno: { nombres: 'asc' } },
        ],
        select: {
          fechaInscripcion: true,
          alumno: {
            select: {
              usuarioId: true,
              nombres: true,
              apellidoPaterno: true,
              apellidoMaterno: true,
              matricula: true,
              semestreActual: true,
              estatusAcademico: true,
            },
          },
        },
      });

      return filas.map((f) => ({
        usuarioId: f.alumno.usuarioId,
        nombres: f.alumno.nombres,
        apellidoPaterno: f.alumno.apellidoPaterno,
        apellidoMaterno: f.alumno.apellidoMaterno,
        matricula: f.alumno.matricula,
        semestreActual: f.alumno.semestreActual,
        estatusAcademico: f.alumno.estatusAcademico,
        fechaInscripcion: f.fechaInscripcion.toISOString(),
      }));
    } catch (err) {
      console.error('[GruposService.listarAlumnos] error inesperado:', err);
      throw err;
    }
  }
}
