import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccionAuditoria,
  NivelPermiso,
  Prisma,
  RolUsuario,
  type Sede,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CrearPersonaDto,
  PerfilAdministrativoDto,
} from '../personas/dto/crear-persona.dto';
import {
  PersonasService,
  type AltaPersonaResult,
} from '../personas/personas.service';
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

  if (dto.activa !== undefined && dto.activa !== existente.activa) {
    return true;
  }

  return false;
}

@Injectable()
export class SedesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly personasService: PersonasService,
  ) {}

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

  /**
   * `POST /sedes` (2026-09-11) — crea la sede + 2 cuentas ADMINISTRATIVO
   * fundadoras (director `SUPER_ADMIN` + administrativo `ADMIN`). Ver
   * `docs/superpowers/specs/2026-09-11-sede-fundadores-obligatorios-design.md`
   * para la justificación completa de la estrategia de atomicidad.
   *
   * Atómico de verdad para Sede+Director: si el alta del director falla, la
   * sede recién creada (0 dependientes todavía) se borra — mismo camino que
   * `eliminar`. El segundo administrativo es best-effort: si falla, sede y
   * director quedan creados (regla 3 de CLAUDE.md raíz prohíbe deshacer una
   * persona ya creada) y la respuesta trae `administrativo: null` +
   * `advertenciaAdministrativo`.
   */
  async crearConFundadores(
    dtoSede: CrearSedeDto,
    dtoDirector: PerfilAdministrativoDto,
    dtoAdministrativo: PerfilAdministrativoDto,
    actorPlatformAdminId: string,
  ): Promise<{
    sede: Sede;
    director: AltaPersonaResult;
    administrativo: AltaPersonaResult | null;
    advertenciaAdministrativo?: string;
  }> {
    const sede = await this.crear(dtoSede, actorPlatformAdminId);

    const dtoDirectorCompleto: CrearPersonaDto = {
      rol: RolUsuario.ADMINISTRATIVO,
      perfilAdministrativo: {
        ...dtoDirector,
        nivelPermiso: NivelPermiso.SUPER_ADMIN,
      },
    };

    let director: AltaPersonaResult;
    try {
      director = await this.personasService.altaAdministrativoFundador(
        dtoDirectorCompleto,
        sede.id,
        actorPlatformAdminId,
      );
    } catch (err) {
      console.error(
        '[SedesService.crearConFundadores] Falló el alta del director — compensando (borrando la sede recién creada):',
        err,
      );
      try {
        await this.eliminar(sede.id, actorPlatformAdminId);
      } catch (compensationErr) {
        console.error(
          '[SedesService.crearConFundadores] CRÍTICO: no se pudo borrar la sede tras el fallo del director — queda huérfana, requiere limpieza manual. sedeId:',
          sede.id,
          compensationErr,
        );
      }
      throw err;
    }

    const dtoAdministrativoCompleto: CrearPersonaDto = {
      rol: RolUsuario.ADMINISTRATIVO,
      perfilAdministrativo: {
        ...dtoAdministrativo,
        nivelPermiso: NivelPermiso.ADMIN,
      },
    };

    try {
      const administrativo =
        await this.personasService.altaAdministrativoFundador(
          dtoAdministrativoCompleto,
          sede.id,
          actorPlatformAdminId,
        );
      return { sede, director, administrativo };
    } catch (err) {
      console.error(
        '[SedesService.crearConFundadores] Falló el alta del segundo administrativo — sede y director quedan creados, sin deshacer (regla 3):',
        err,
      );

      // Hallazgo Important del review final (2026-09-11): antes se devolvía
      // siempre el mismo string genérico sin importar la causa real (CURP
      // duplicado, email colisionado, Auth caído, etc.). Si `err` es una
      // excepción HTTP de Nest (`ConflictException`/`NotFoundException`/...),
      // se extrae su `error` real para incluirlo en el mensaje; cualquier
      // otro tipo de error (ej. una excepción no controlada) cae al mensaje
      // genérico de siempre.
      const detalleError =
        err instanceof HttpException
          ? (err.getResponse() as { error?: string }).error
          : undefined;

      return {
        sede,
        director,
        administrativo: null,
        advertenciaAdministrativo: detalleError
          ? `La sede y el director se crearon correctamente, pero el segundo administrativo no pudo darse de alta (${detalleError}). Inicia sesión como el director y complétalo desde "Administrativos > Nuevo".`
          : 'La sede y el director se crearon correctamente, pero el segundo administrativo no pudo darse de alta. Inicia sesión como el director y complétalo desde "Administrativos > Nuevo".',
      };
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
            activa: dto.activa,
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
   * `DELETE /sedes/:id` — Fase 6, Día 22, EXTENDIDO 2026-09-11 (ver
   * `docs/superpowers/specs/2026-09-11-sede-baja-logica-design.md`). Desde
   * que `POST /sedes` siempre crea 2 fundadores `ADMINISTRATIVO`, ninguna
   * sede nueva queda vacía nunca — el `409 CONFLICT` de antes se volvía un
   * callejón sin salida permanente. Ahora: intenta el DELETE real de
   * siempre; si bloquearía por cualquiera de los 2 motivos (alumnos
   * activos, o cualquier dato asociado vía P2003 — incluidos los propios
   * fundadores), hace baja lógica (`activa: false`) en su lugar y responde
   * éxito igual. Nunca hay ya un 409 de "datos asociados" — ese caso pasó
   * de ser un error a ser un camino de éxito distinto, señalizado por
   * `eliminacionReal`.
   */
  async eliminar(
    id: string,
    actorPlatformAdminId: string,
  ): Promise<{ ok: true; eliminacionReal: boolean }> {
    const sede = await this.prisma.sede.findUnique({ where: { id } });
    if (!sede) {
      throw new NotFoundException({
        error: 'Sede no encontrada',
        code: 'NOT_FOUND',
      });
    }

    const alumnosActivos = await this.prisma.usuario.count({
      where: { sedeId: id, rol: RolUsuario.ALUMNO, activo: true },
    });

    if (alumnosActivos > 0) {
      await this.darDeBajaLogica(sede, actorPlatformAdminId);
      return { ok: true, eliminacionReal: false };
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
      return { ok: true, eliminacionReal: true };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        await this.darDeBajaLogica(sede, actorPlatformAdminId);
        return { ok: true, eliminacionReal: false };
      }
      console.error('[SedesService.eliminar] error inesperado:', err);
      throw err;
    }
  }

  /**
   * Baja lógica de una sede — fallback de `eliminar` cuando el borrado
   * real bloquearía. Auditar `CAMBIO_ESTATUS` (mismo valor de enum que
   * `PATCH /personas/:id/estatus` usa para el mismo concepto — un cambio
   * de estatus, no una edición de campos ni una eliminación real).
   */
  private async darDeBajaLogica(
    sede: Sede,
    actorPlatformAdminId: string,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.sede.update({
          where: { id: sede.id },
          data: { activa: false },
        });
        await tx.registroAuditoria.create({
          data: {
            adminPlataformaId: actorPlatformAdminId,
            sedeId: sede.id,
            accion: AccionAuditoria.CAMBIO_ESTATUS,
            entidad: 'Sede',
            entidadId: sede.id,
            detalle: { nombre: sede.nombre, activa: false },
          },
        });
      });
    } catch (err) {
      console.error('[SedesService.darDeBajaLogica] error inesperado:', err);
      throw err;
    }
  }
}
