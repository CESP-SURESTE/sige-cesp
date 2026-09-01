import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccionAuditoria,
  AlcanceDestino,
  Prisma,
  RolUsuario,
  type EventoCalendario,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { validarAlcancePublicacion } from '../common/publicacion/alcance-publicacion.util';
import { expandirOcurrencias, type ReglaRecurrencia } from './recurrencia.util';
import type { ActualizarEventoDto } from './dto/actualizar-evento.dto';
import type { CrearEventoDto } from './dto/crear-evento.dto';

export interface OcurrenciaEvento {
  eventoId: string;
  titulo: string;
  descripcion: string | null;
  fecha: string;
  horaInicio: string | null;
  fechaFin: string | null;
  categoria: EventoCalendario['categoria'];
  alcanceTipo: AlcanceDestino;
  alcanceId: string | null;
  esRecurrente: boolean;
}

interface Actor {
  usuarioId: string;
  rol: RolUsuario;
  sedeId: string;
}

const MAX_DIAS_RANGO = 62;

function aFechaUTC(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function aISO(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/**
 * Compara 2 reglas de recurrencia por campo, no por `JSON.stringify` —
 * `jsonb` de Postgres no preserva el orden de llaves de inserción (lo
 * canonicaliza al leer), así que un `PATCH` que re-envía la misma regla
 * sin cambios podía stringificar en un orden distinto al que vuelve de la
 * DB y marcarse como "cambiado" por error. `diasSemana` se compara
 * ordenado por la misma razón (`[1,3]` y `[3,1]` son la misma regla).
 */
function reglasIguales(
  a: ReglaRecurrencia | null | undefined,
  b: unknown,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const ab = b as ReglaRecurrencia;
  if (a.frecuencia !== ab.frecuencia) return false;
  if (a.intervalo !== ab.intervalo) return false;
  if ((a.diaMes ?? null) !== (ab.diaMes ?? null)) return false;
  const da = [...(a.diasSemana ?? [])].sort();
  const db = [...(ab.diasSemana ?? [])].sort();
  if (da.length !== db.length) return false;
  return da.every((v, i) => v === db[i]);
}

/**
 * `hayCambiosReales` — patrón de `CarrerasService`/`SedesService`: un
 * `PATCH` sin cambios reales no cuenta como edición auditable. Solo
 * compara los campos escalares directos; `recurrenciaRegla` vía
 * `reglasIguales` (no `JSON.stringify`, ver docstring de esa función).
 * `fechaFin`/`recurrenciaHasta` comparan el VALOR resultante (incluyendo
 * `null`), no solo si el campo vino en el body — enviar `null` cuando ya
 * es `null` NO cuenta como cambio.
 */
function hayCambiosReales(
  dto: ActualizarEventoDto,
  existente: EventoCalendario,
): boolean {
  if (dto.titulo !== undefined && dto.titulo !== existente.titulo) return true;
  if (
    dto.descripcion !== undefined &&
    dto.descripcion !== existente.descripcion
  )
    return true;
  if (
    dto.fechaInicio !== undefined &&
    aFechaUTC(dto.fechaInicio).getTime() !== existente.fechaInicio.getTime()
  )
    return true;
  if (dto.horaInicio !== undefined && dto.horaInicio !== existente.horaInicio)
    return true;
  if (dto.fechaFin !== undefined) {
    const nuevo = dto.fechaFin ? aFechaUTC(dto.fechaFin).getTime() : null;
    const actual = existente.fechaFin ? existente.fechaFin.getTime() : null;
    if (nuevo !== actual) return true;
  }
  if (dto.categoria !== undefined && dto.categoria !== existente.categoria)
    return true;
  if (
    dto.alcanceTipo !== undefined &&
    dto.alcanceTipo !== existente.alcanceTipo
  )
    return true;
  if (dto.alcanceId !== undefined && dto.alcanceId !== existente.alcanceId)
    return true;
  if (
    dto.recurrenciaRegla !== undefined &&
    !reglasIguales(dto.recurrenciaRegla, existente.recurrenciaRegla)
  )
    return true;
  if (dto.recurrenciaHasta !== undefined) {
    const nuevo = dto.recurrenciaHasta
      ? aFechaUTC(dto.recurrenciaHasta).getTime()
      : null;
    const actual = existente.recurrenciaHasta
      ? existente.recurrenciaHasta.getTime()
      : null;
    if (nuevo !== actual) return true;
  }
  return false;
}

@Injectable()
export class CalendarioService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `POST /eventos` — Fase 15, Día 41. Orden: (1) `validarAlcancePublicacion`
   * (permiso + existencia/sede del alcance), (2) `recurrenciaRegla`
   * presente ⇒ `recurrenciaHasta` requerido, (3) crear + auditar `ALTA` en
   * la misma transacción.
   */
  async crear(dto: CrearEventoDto, actor: Actor): Promise<EventoCalendario> {
    await validarAlcancePublicacion(
      this.prisma,
      actor,
      dto.alcanceTipo,
      dto.alcanceId ?? null,
    );

    if (dto.recurrenciaRegla && !dto.recurrenciaHasta) {
      throw new BadRequestException({
        error:
          'recurrenciaHasta es requerido cuando recurrenciaRegla está presente',
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const evento = await tx.eventoCalendario.create({
          data: {
            sedeId: actor.sedeId,
            autorUsuarioId: actor.usuarioId,
            titulo: dto.titulo,
            descripcion: dto.descripcion,
            fechaInicio: aFechaUTC(dto.fechaInicio),
            horaInicio: dto.horaInicio,
            fechaFin: dto.fechaFin ? aFechaUTC(dto.fechaFin) : null,
            categoria: dto.categoria,
            alcanceTipo: dto.alcanceTipo,
            alcanceId: dto.alcanceId ?? null,
            recurrenciaRegla: dto.recurrenciaRegla
              ? (dto.recurrenciaRegla as unknown as object)
              : undefined,
            recurrenciaHasta: dto.recurrenciaHasta
              ? aFechaUTC(dto.recurrenciaHasta)
              : null,
          },
        });

        await tx.registroAuditoria.create({
          data: {
            usuarioId: actor.usuarioId,
            sedeId: actor.sedeId,
            accion: AccionAuditoria.ALTA,
            entidad: 'EventoCalendario',
            entidadId: evento.id,
            detalle: { titulo: evento.titulo, alcanceTipo: evento.alcanceTipo },
          },
        });

        return evento;
      });
    } catch (err) {
      console.error('[CalendarioService.crear] error inesperado:', err);
      throw err;
    }
  }

  /**
   * `GET /eventos?desde=&hasta=` — Fase 15, Día 41. Filtra por lo que le
   * toca ver al actor (SEDE siempre visible; CARRERA/GRUPO según su
   * propio alcance) y expande ocurrencias con `expandirOcurrencias`
   * (Task 2). `ADMINISTRATIVO` ve TODOS los eventos de su sede sin
   * filtrar por alcance (mismo criterio que el resto de la app: el rol de
   * gestión ve todo).
   */
  async listar(
    desdeISO: string,
    hastaISO: string,
    actor: Actor,
  ): Promise<OcurrenciaEvento[]> {
    const desde = aFechaUTC(desdeISO);
    const hasta = aFechaUTC(hastaISO);

    if (hasta.getTime() < desde.getTime()) {
      throw new BadRequestException({
        error: 'hasta debe ser posterior o igual a desde',
        code: 'VALIDATION_ERROR',
      });
    }
    const diasDeRango = (hasta.getTime() - desde.getTime()) / 86_400_000;
    if (diasDeRango > MAX_DIAS_RANGO) {
      throw new BadRequestException({
        error: `El rango desde/hasta no puede superar ${MAX_DIAS_RANGO} días`,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      const eventos = await this.prisma.eventoCalendario.findMany({
        where: await this.condicionVisibilidad(actor),
      });

      const ocurrencias: OcurrenciaEvento[] = [];
      for (const evento of eventos) {
        const fechas = expandirOcurrencias(
          {
            fechaInicio: evento.fechaInicio,
            recurrenciaRegla:
              evento.recurrenciaRegla as ReglaRecurrencia | null,
            recurrenciaHasta: evento.recurrenciaHasta,
          },
          { desde, hasta },
        );
        for (const fecha of fechas) {
          ocurrencias.push({
            eventoId: evento.id,
            titulo: evento.titulo,
            descripcion: evento.descripcion,
            fecha: aISO(fecha),
            horaInicio: evento.horaInicio,
            fechaFin: evento.fechaFin ? aISO(evento.fechaFin) : null,
            categoria: evento.categoria,
            alcanceTipo: evento.alcanceTipo,
            alcanceId: evento.alcanceId,
            esRecurrente: evento.recurrenciaRegla !== null,
          });
        }
      }

      ocurrencias.sort((a, b) => {
        if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
        if (a.horaInicio === b.horaInicio) return 0;
        if (a.horaInicio === null) return -1;
        if (b.horaInicio === null) return 1;
        return a.horaInicio < b.horaInicio ? -1 : 1;
      });

      return ocurrencias;
    } catch (err) {
      console.error('[CalendarioService.listar] error inesperado:', err);
      throw err;
    }
  }

  /**
   * Construye el `where` de Prisma según el rol del actor. `ADMINISTRATIVO`
   * ve todo de su sede; `MAESTRO`/`ALUMNO` ven SEDE siempre + su propio
   * alcance de CARRERA/GRUPO.
   */
  private async condicionVisibilidad(actor: Actor) {
    if (actor.rol === RolUsuario.ADMINISTRATIVO) {
      return { sedeId: actor.sedeId };
    }

    if (actor.rol === RolUsuario.MAESTRO) {
      const asignaciones = await this.prisma.grupoMateriaMaestro.findMany({
        where: { maestro: { usuarioId: actor.usuarioId } },
        select: { grupoId: true, grupo: { select: { carreraId: true } } },
      });
      const gruposVisibles = asignaciones.map((a) => a.grupoId);
      const carrerasVisibles = [
        ...new Set(asignaciones.map((a) => a.grupo.carreraId)),
      ];
      return {
        sedeId: actor.sedeId,
        OR: [
          { alcanceTipo: AlcanceDestino.SEDE },
          {
            alcanceTipo: AlcanceDestino.CARRERA,
            alcanceId: { in: carrerasVisibles },
          },
          {
            alcanceTipo: AlcanceDestino.GRUPO,
            alcanceId: { in: gruposVisibles },
          },
        ],
      };
    }

    // ALUMNO.
    const perfil = await this.prisma.perfilAlumno.findUnique({
      where: { usuarioId: actor.usuarioId },
      select: { carreraId: true },
    });
    if (!perfil) {
      throw new NotFoundException({
        error: 'Perfil de alumno no encontrado',
        code: 'NOT_FOUND',
      });
    }
    const matriculas = await this.prisma.grupoAlumno.findMany({
      where: { alumno: { usuarioId: actor.usuarioId } },
      select: { grupoId: true },
    });
    const gruposVisibles = matriculas.map((m) => m.grupoId);
    return {
      sedeId: actor.sedeId,
      OR: [
        { alcanceTipo: AlcanceDestino.SEDE },
        { alcanceTipo: AlcanceDestino.CARRERA, alcanceId: perfil.carreraId },
        {
          alcanceTipo: AlcanceDestino.GRUPO,
          alcanceId: { in: gruposVisibles },
        },
      ],
    };
  }

  private async obtenerPropioODeSede(
    id: string,
    actor: Actor,
  ): Promise<EventoCalendario> {
    const evento = await this.prisma.eventoCalendario.findFirst({
      where: { id, sedeId: actor.sedeId },
    });
    if (!evento) {
      throw new NotFoundException({
        error: 'Evento no encontrado en tu sede',
        code: 'NOT_FOUND',
      });
    }
    if (
      evento.autorUsuarioId !== actor.usuarioId &&
      actor.rol !== RolUsuario.ADMINISTRATIVO
    ) {
      throw new ForbiddenException({
        error: 'Solo el autor o un administrativo pueden modificar este evento',
        code: 'ROL_NO_AUTORIZADO',
      });
    }
    return evento;
  }

  /**
   * `PATCH /eventos/:id` — Fase 15, Día 41. Solo el autor o un
   * `ADMINISTRATIVO` de la sede. Re-valida alcance si `alcanceTipo`/
   * `alcanceId` cambian (con los valores MERGEADOS, no solo el que venga
   * en el body). Audita `EDICION` solo si `hayCambiosReales`.
   */
  async actualizar(
    id: string,
    dto: ActualizarEventoDto,
    actor: Actor,
  ): Promise<EventoCalendario> {
    const existente = await this.obtenerPropioODeSede(id, actor);

    if (dto.alcanceTipo !== undefined || dto.alcanceId !== undefined) {
      const alcanceTipoFinal = dto.alcanceTipo ?? existente.alcanceTipo;
      const alcanceIdFinal =
        dto.alcanceId !== undefined ? dto.alcanceId : existente.alcanceId;
      await validarAlcancePublicacion(
        this.prisma,
        actor,
        alcanceTipoFinal,
        alcanceIdFinal,
      );
    }

    const reglaFinal =
      dto.recurrenciaRegla !== undefined
        ? dto.recurrenciaRegla
        : existente.recurrenciaRegla;
    const hastaFinal =
      dto.recurrenciaHasta !== undefined
        ? dto.recurrenciaHasta
        : existente.recurrenciaHasta;
    if (reglaFinal && !hastaFinal) {
      throw new BadRequestException({
        error:
          'recurrenciaHasta es requerido cuando recurrenciaRegla está presente',
        code: 'VALIDATION_ERROR',
      });
    }

    if (!hayCambiosReales(dto, existente)) {
      return existente;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const data: Prisma.EventoCalendarioUpdateInput = {
          ...(dto.titulo !== undefined ? { titulo: dto.titulo } : {}),
          ...(dto.descripcion !== undefined
            ? { descripcion: dto.descripcion }
            : {}),
          ...(dto.fechaInicio !== undefined
            ? { fechaInicio: aFechaUTC(dto.fechaInicio) }
            : {}),
          ...(dto.horaInicio !== undefined
            ? { horaInicio: dto.horaInicio }
            : {}),
          ...(dto.fechaFin !== undefined
            ? { fechaFin: dto.fechaFin ? aFechaUTC(dto.fechaFin) : null }
            : {}),
          ...(dto.categoria !== undefined ? { categoria: dto.categoria } : {}),
          ...(dto.alcanceTipo !== undefined
            ? { alcanceTipo: dto.alcanceTipo }
            : {}),
          ...(dto.alcanceId !== undefined ? { alcanceId: dto.alcanceId } : {}),
          ...(dto.recurrenciaRegla !== undefined
            ? {
                recurrenciaRegla:
                  dto.recurrenciaRegla === null
                    ? Prisma.DbNull
                    : (dto.recurrenciaRegla as unknown as object),
              }
            : {}),
          ...(dto.recurrenciaHasta !== undefined
            ? {
                recurrenciaHasta: dto.recurrenciaHasta
                  ? aFechaUTC(dto.recurrenciaHasta)
                  : null,
              }
            : {}),
        };

        const actualizado = await tx.eventoCalendario.update({
          where: { id },
          data,
        });

        await tx.registroAuditoria.create({
          data: {
            usuarioId: actor.usuarioId,
            sedeId: actor.sedeId,
            accion: AccionAuditoria.EDICION,
            entidad: 'EventoCalendario',
            entidadId: id,
            detalle: { camposModificados: Object.keys(dto) },
          },
        });

        return actualizado;
      });
    } catch (err) {
      console.error('[CalendarioService.actualizar] error inesperado:', err);
      throw err;
    }
  }

  /**
   * `DELETE /eventos/:id` — Fase 15, Día 41. Solo autor o
   * `ADMINISTRATIVO`. DELETE real (`EventoCalendario` es CRUD completo).
   * `RecordatorioEnviado` se borra en cascada por el FK (Task 1), no hace
   * falta borrarlo a mano acá.
   */
  async eliminar(id: string, actor: Actor): Promise<{ ok: true }> {
    const evento = await this.obtenerPropioODeSede(id, actor);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.registroAuditoria.create({
          data: {
            usuarioId: actor.usuarioId,
            sedeId: actor.sedeId,
            accion: AccionAuditoria.ELIMINACION,
            entidad: 'EventoCalendario',
            entidadId: evento.id,
            detalle: { titulo: evento.titulo },
          },
        });
        await tx.eventoCalendario.delete({ where: { id } });
      });
      return { ok: true };
    } catch (err) {
      console.error('[CalendarioService.eliminar] error inesperado:', err);
      throw err;
    }
  }
}
