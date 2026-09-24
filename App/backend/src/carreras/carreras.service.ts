import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccionAuditoria, Prisma, type Carrera } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ActualizarCarreraDto } from './dto/actualizar-carrera.dto';
import type { CrearCarreraDto } from './dto/crear-carrera.dto';

/**
 * Compara cada campo presente en el `dto` contra el valor actual de la
 * carrera — mismo criterio que `hayCambiosReales` de `SedesService` (Día 20,
 * corrección de QA: "un PATCH sin cambios reales no cuenta como edición
 * auditable"). Un campo ausente del `dto` (PATCH parcial o vacío) nunca
 * cuenta como cambio.
 */
function hayCambiosReales(
  dto: ActualizarCarreraDto,
  existente: Carrera,
): boolean {
  const campos = [
    'nombre',
    'clave',
    'duracion',
    'nivel',
    'modalidad',
    'rvoe',
    'procedenciaRvoe',
    'descripcion',
    'estatus',
  ] as const;

  for (const campo of campos) {
    if (dto[campo] !== undefined && dto[campo] !== existente[campo]) {
      return true;
    }
  }

  return false;
}

@Injectable()
export class CarrerasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lista las carreras de una sede. Nació en Día 14 con shape mínimo
   * (`id`/`nombre`/`clave`, solo para el `<select>` de alta de alumno).
   * Extendido en Día 21 al objeto `Carrera` completo — la pantalla de
   * gestión de carreras (`app/admin/carreras/`) necesita todos los campos
   * para poblar la tabla y prellenar el formulario de edición; no existe
   * `GET /carreras/:id` (fuera de alcance de hoy), así que esta lista es la
   * única fuente de datos completos. El dropdown de alta de alumno sigue
   * funcionando igual — solo lee `id`/`nombre`/`clave` del objeto e ignora
   * el resto, sin cambio de comportamiento para ese consumidor.
   *
   * `tieneMalla` (2026-08-19) — booleano derivado de si existe la relación
   * 1-a-1 con `MallaCurricular` (regla 1: nunca se persiste, se deriva al
   * vuelo); alimenta el indicador de la tabla del modal de subida de malla.
   */
  async listarPorSede(
    sedeId: string,
  ): Promise<Array<Carrera & { tieneMalla: boolean }>> {
    const carreras = await this.prisma.carrera.findMany({
      where: { sedeId },
      orderBy: { nombre: 'asc' },
      include: { mallaCurricular: { select: { id: true } } },
    });

    return carreras.map(({ mallaCurricular, ...carrera }) => ({
      ...carrera,
      tieneMalla: mallaCurricular !== null,
    }));
  }

  /**
   * `nombre` duplicado DENTRO DE LA MISMA SEDE — el schema no tiene un
   * unique compuesto (`@@unique([sedeId, nombre])`) para esto, se valida a
   * nivel de aplicación (encargo explícito de Día 21: no agregar un unique
   * compuesto nuevo al schema). `excluirId` se usa en `PATCH` para no
   * chocar contra la carrera que se está editando a sí misma.
   */
  private async verificarNombreDuplicado(
    nombre: string,
    sedeId: string,
    excluirId?: string,
  ): Promise<void> {
    const existente = await this.prisma.carrera.findFirst({
      where: {
        sedeId,
        nombre: { equals: nombre, mode: 'insensitive' },
        ...(excluirId ? { id: { not: excluirId } } : {}),
      },
      select: { id: true },
    });

    if (existente) {
      throw new ConflictException({
        error: 'Ya existe una carrera con ese nombre en esta sede',
        code: 'CONFLICT',
      });
    }
  }

  /**
   * `POST /carreras` — Fase 6, Día 21. `sedeId` sale SIEMPRE de
   * `@SedeActual()` (JWT, regla 2 de CLAUDE.md raíz), nunca del body.
   * `RegistroAuditoria` se crea en la misma transacción del alta, con
   * `usuarioId` = actor (JWT `sub`, nunca `adminPlataformaId` — quien da de
   * alta una carrera es un `ADMINISTRATIVO` normal, no `AdminPlataforma`,
   * a diferencia del CRUD de `Sede` de Día 20).
   */
  async crear(
    dto: CrearCarreraDto,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<Carrera> {
    await this.verificarNombreDuplicado(dto.nombre, sedeId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const carrera = await tx.carrera.create({
          data: {
            nombre: dto.nombre,
            clave: dto.clave,
            sedeId,
            duracion: dto.duracion,
            nivel: dto.nivel,
            modalidad: dto.modalidad,
            rvoe: dto.rvoe,
            procedenciaRvoe: dto.procedenciaRvoe,
            descripcion: dto.descripcion,
          },
        });

        await tx.registroAuditoria.create({
          data: {
            usuarioId: actorUsuarioId,
            sedeId,
            accion: AccionAuditoria.ALTA,
            entidad: 'Carrera',
            entidadId: carrera.id,
          },
        });

        return carrera;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // `clave` es `@unique` global en el schema — única violación de
        // unique constraint posible acá (el nombre duplicado ya se
        // descartó arriba con el pre-check de aplicación).
        throw new ConflictException({
          error: 'Ya existe una carrera con esa clave',
          code: 'CONFLICT',
        });
      }
      console.error('[CarrerasService.crear] error inesperado:', err);
      throw err;
    }
  }

  /**
   * `PATCH /carreras/:id` — Fase 6, Día 21. `id` debe existir Y pertenecer
   * a la sede del actor (mismo criterio que la validación de `carreraId` en
   * `POST /personas`) — se resuelve con un solo `findFirst({ id, sedeId })`,
   * si no aparece nada es 404 (sin distinguir "no existe" de "existe en
   * otra sede", mismo criterio de no filtrar existencia cross-sede que el
   * resto de la API). `PATCH` vacío es válido — no dispara auditoría
   * (`hayCambiosReales`, mismo criterio que `SedesService`).
   */
  async actualizar(
    id: string,
    dto: ActualizarCarreraDto,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<Carrera> {
    const existente = await this.prisma.carrera.findFirst({
      where: { id, sedeId },
    });
    if (!existente) {
      throw new NotFoundException({
        error: 'Carrera no encontrada en tu sede',
        code: 'NOT_FOUND',
      });
    }

    if (dto.nombre !== undefined && dto.nombre !== existente.nombre) {
      await this.verificarNombreDuplicado(dto.nombre, sedeId, id);
    }

    const registrarAuditoria = hayCambiosReales(dto, existente);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const carrera = await tx.carrera.update({
          where: { id },
          data: {
            nombre: dto.nombre,
            clave: dto.clave,
            duracion: dto.duracion,
            nivel: dto.nivel,
            modalidad: dto.modalidad,
            rvoe: dto.rvoe,
            procedenciaRvoe: dto.procedenciaRvoe,
            descripcion: dto.descripcion,
            estatus: dto.estatus,
          },
        });

        if (registrarAuditoria) {
          await tx.registroAuditoria.create({
            data: {
              usuarioId: actorUsuarioId,
              sedeId,
              accion: AccionAuditoria.EDICION,
              entidad: 'Carrera',
              entidadId: carrera.id,
            },
          });
        }

        return carrera;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          error: 'Ya existe una carrera con esa clave',
          code: 'CONFLICT',
        });
      }
      console.error('[CarrerasService.actualizar] error inesperado:', err);
      throw err;
    }
  }
}
