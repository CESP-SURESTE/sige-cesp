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
import { MailService } from '../mail/mail.service';
import {
  validarAlcancePublicacion,
  resolverDestinatarios,
} from '../common/publicacion/alcance-publicacion.util';
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
  /**
   * `true` si el actor de la request puede editar/borrar el evento base —
   * es su autor, o es `ADMINISTRATIVO` de la sede del evento. MISMA regla
   * que aplican `PATCH`/`DELETE /eventos/:id` (vía `puedeEditarEvento`,
   * compartida). Regla 1 de `CLAUDE.md` raíz: se deriva por request, nunca
   * se persiste ni existe columna para esto. Es propiedad del EVENTO, no de
   * la ocurrencia: todas las ocurrencias de un mismo evento recurrente
   * comparten el valor (se calcula una vez por evento y se propaga).
   */
  puedeEditar: boolean;
}

interface Actor {
  usuarioId: string;
  rol: RolUsuario;
  sedeId: string;
}

const MAX_DIAS_RANGO = 62;

/**
 * Regla booleana pura de permiso de edición/borrado de un evento (Fase 15,
 * Día 41): `true` si el actor es el autor del evento, o si es
 * `ADMINISTRATIVO` de la sede del evento. Compartida por dos caminos sin
 * duplicar la condición:
 *  - `obtenerPropioODeSede` (camino `PATCH`/`DELETE`), que además hace el
 *    `findFirst` acotado a la sede del actor + lanza `403` si esto da
 *    `false`. Como ese `findFirst` ya restringe `sedeId: actor.sedeId`, el
 *    término `evento.sedeId === actor.sedeId` siempre es verdadero ahí —
 *    el comportamiento de `PATCH`/`DELETE` no cambia.
 *  - `listar` (`GET /eventos`), que la expone como `puedeEditar` en cada
 *    `OcurrenciaEvento`.
 * NO distingue "no existe" de "no autorizado" — eso lo resuelve quien la
 * llama.
 */
function puedeEditarEvento(
  evento: Pick<EventoCalendario, 'autorUsuarioId' | 'sedeId'>,
  actor: Actor,
): boolean {
  return (
    // gate defensivo — un ALUMNO nunca autora un evento hoy, pero PATCH/DELETE lo cortan en RolesGuard; explícito acá para que Fase 16 herede la regla completa
    actor.rol !== RolUsuario.ALUMNO &&
    (evento.autorUsuarioId === actor.usuarioId ||
      (actor.rol === RolUsuario.ADMINISTRATIVO &&
        evento.sedeId === actor.sedeId))
  );
}

/**
 * Tamaño de lote para el fan-out del correo del job de recordatorios
 * (`generarRecordatoriosPendientes`). Un evento de alcance `SEDE` puede
 * resolver a cientos de destinatarios; mandarlos en un loop secuencial
 * (una request HTTP a Mailgun por vez, ~200-500ms cada una) no sobrevive
 * el timeout del load balancer de Render y se perderían la mayoría de los
 * correos sin reintento. Se procesan en lotes de este tamaño con
 * `Promise.allSettled` — suficiente paralelismo para no serializar
 * cientos de requests, sin abrir tantas conexiones salientes de golpe que
 * Mailgun rate-limitee (el sandbox actual tiene cuota baja). Sin librería
 * de concurrencia nueva: `slice` + `Promise.allSettled` a mano.
 */
const LOTE_CORREOS_RECORDATORIO = 20;

/**
 * Convierte una fecha `YYYY-MM-DD` (ya acotada por el `@Matches` de cada
 * DTO — mes 01-12, día 01-31) a `Date` en UTC puro, validando roundtrip:
 * `new Date('2026-02-30T00:00:00.000Z')` NO produce `Invalid Date` — hace
 * rollover silencioso al día siguiente del mes (`2026-03-02` en este caso,
 * verificado a mano), lo que violaría el contrato de la API (aceptar una
 * fecha inexistente como si fuera válida, o peor, como una fecha DISTINTA
 * a la enviada). Comparar año/mes/día de vuelta contra el string original
 * cierra ese hueco sin necesitar una librería de fechas nueva.
 */
function aFechaUTC(iso: string): Date {
  const fecha = new Date(`${iso}T00:00:00.000Z`);
  const [anioStr, mesStr, diaStr] = iso.split('-');
  if (
    Number.isNaN(fecha.getTime()) ||
    fecha.getUTCFullYear() !== Number(anioStr) ||
    fecha.getUTCMonth() !== Number(mesStr) - 1 ||
    fecha.getUTCDate() !== Number(diaStr)
  ) {
    throw new BadRequestException({
      error: `Fecha inválida: ${iso}`,
      code: 'VALIDATION_ERROR',
    });
  }
  return fecha;
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

function enviosDeRecordatoriosHabilitados(): boolean {
  return process.env.RECORDATORIOS_HABILITADO === 'true';
}

@Injectable()
export class CalendarioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

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

    // Validada una sola vez acá (fuera del `try`, junto al resto de las
    // validaciones de negocio) — una `fechaInicio` con formato acotado por
    // el DTO pero inexistente en el calendario real (ej. `2026-02-30`) debe
    // salir como `VALIDATION_ERROR` limpio, no como "error inesperado"
    // logueado por el catch de la transacción.
    const fechaInicioValidada = aFechaUTC(dto.fechaInicio);

    if (dto.recurrenciaRegla && !dto.recurrenciaHasta) {
      throw new BadRequestException({
        error: 'Falta indicar hasta qué fecha se repite el evento.',
        code: 'VALIDATION_ERROR',
      });
    }

    if (
      dto.recurrenciaHasta &&
      aFechaUTC(dto.recurrenciaHasta).getTime() < fechaInicioValidada.getTime()
    ) {
      throw new BadRequestException({
        error:
          'La fecha hasta la que se repite el evento no puede ser anterior a su fecha de inicio.',
        code: 'VALIDATION_ERROR',
      });
    }
    if (
      dto.fechaFin &&
      aFechaUTC(dto.fechaFin).getTime() < fechaInicioValidada.getTime()
    ) {
      throw new BadRequestException({
        error:
          'La fecha de fin no puede ser anterior a la fecha de inicio del evento.',
        code: 'VALIDATION_ERROR',
      });
    }

    let evento: EventoCalendario;
    try {
      evento = await this.prisma.$transaction(async (tx) => {
        const creado = await tx.eventoCalendario.create({
          data: {
            sedeId: actor.sedeId,
            autorUsuarioId: actor.usuarioId,
            titulo: dto.titulo,
            descripcion: dto.descripcion,
            fechaInicio: fechaInicioValidada,
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
            entidadId: creado.id,
            detalle: { titulo: creado.titulo, alcanceTipo: creado.alcanceTipo },
          },
        });

        return creado;
      });
    } catch (err) {
      console.error('[CalendarioService.crear] error inesperado:', err);
      throw err;
    }

    // Efecto best-effort: notificar in-app a los destinatarios del alcance.
    // Un fallo acá NO tumba el alta (mismo criterio que el correo de
    // bienvenida en PersonasService). Sin correo — eso es del job de
    // recordatorios.
    try {
      const destinatarios = (
        await resolverDestinatarios(
          this.prisma,
          actor.sedeId,
          evento.alcanceTipo,
          evento.alcanceId,
        )
      ).filter((usuarioId) => usuarioId !== actor.usuarioId);

      if (destinatarios.length > 0) {
        const alcanceLegible = await this.describirAlcance(
          evento.alcanceTipo,
          evento.alcanceId,
        );
        await this.prisma.notificacion.createMany({
          data: destinatarios.map((usuarioId) => ({
            usuarioId,
            sedeId: actor.sedeId,
            tipo: 'EVENTO_NUEVO' as const,
            referenciaId: evento.id,
            titulo: `Nuevo evento: ${evento.titulo}`,
            cuerpoCorto: `${aISO(evento.fechaInicio)} · ${alcanceLegible}`,
          })),
        });
      }
    } catch (err) {
      console.error(
        `[CalendarioService.crear] fallo al crear notificaciones EVENTO_NUEVO para el evento ${evento.id}:`,
        err,
      );
    }

    return evento;
  }

  /** Texto legible del alcance para el cuerpo de la notificación. */
  private async describirAlcance(
    alcanceTipo: AlcanceDestino,
    alcanceId: string | null,
  ): Promise<string> {
    if (alcanceTipo === 'SEDE' || !alcanceId) return 'Toda la sede';
    if (alcanceTipo === 'CARRERA') {
      const c = await this.prisma.carrera.findUnique({
        where: { id: alcanceId },
        select: { nombre: true },
      });
      return c ? `Carrera: ${c.nombre}` : 'Una carrera';
    }
    const g = await this.prisma.grupo.findUnique({
      where: { id: alcanceId },
      select: { nombre: true },
    });
    return g ? `Grupo: ${g.nombre}` : 'Un grupo';
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
        // `puedeEditar` es propiedad del EVENTO base, no de la ocurrencia:
        // se calcula una vez y se propaga a todas sus ocurrencias.
        const puedeEditar = puedeEditarEvento(evento, actor);
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
            puedeEditar,
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
    if (!puedeEditarEvento(evento, actor)) {
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
    // Normalizado a `Date | null` sin importar de dónde venga (string del
    // DTO vs. `Date` ya persistida) para poder comparar contra
    // `fechaInicioFinal` (mismo criterio) más abajo.
    const hastaFinal: Date | null =
      dto.recurrenciaHasta !== undefined
        ? dto.recurrenciaHasta
          ? aFechaUTC(dto.recurrenciaHasta)
          : null
        : existente.recurrenciaHasta;
    if (reglaFinal && !hastaFinal) {
      throw new BadRequestException({
        error: 'Falta indicar hasta qué fecha se repite el evento.',
        code: 'VALIDATION_ERROR',
      });
    }

    const fechaInicioFinal: Date =
      dto.fechaInicio !== undefined
        ? aFechaUTC(dto.fechaInicio)
        : existente.fechaInicio;
    const fechaFinFinal: Date | null =
      dto.fechaFin !== undefined
        ? dto.fechaFin
          ? aFechaUTC(dto.fechaFin)
          : null
        : existente.fechaFin;

    if (hastaFinal && hastaFinal.getTime() < fechaInicioFinal.getTime()) {
      throw new BadRequestException({
        error:
          'La fecha hasta la que se repite el evento no puede ser anterior a su fecha de inicio.',
        code: 'VALIDATION_ERROR',
      });
    }
    if (fechaFinFinal && fechaFinFinal.getTime() < fechaInicioFinal.getTime()) {
      throw new BadRequestException({
        error:
          'La fecha de fin no puede ser anterior a la fecha de inicio del evento.',
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

  /**
   * Job de recordatorios — Fase 15, Día 42. Para cada evento con al menos
   * una ocurrencia en las próximas 24-48h (expandiendo recurrencia), por
   * cada ocurrencia sin fila en `RecordatorioEnviado(eventoId,
   * fechaOcurrencia)`: resuelve destinatarios, crea las `Notificacion`
   * (tipo `RECORDATORIO_EVENTO`) + el `RecordatorioEnviado` en la MISMA
   * transacción (el `@@unique` lo hace idempotente si 2 corridas se
   * solapan), y DESPUÉS de confirmar hace el fan-out del correo
   * best-effort en lotes de `LOTE_CORREOS_RECORDATORIO` con
   * `Promise.allSettled` por lote (ver `enviarCorreosRecordatorioEnLotes`):
   * cada rechazo se loguea con el `usuarioId` afectado (regla 12) y no
   * revierte ni tumba el resto del job (patrón `altaPersona` + Mailgun).
   *
   * `RECORDATORIOS_HABILITADO` en falso (default) hace que el método
   * retorne de inmediato sin tocar la DB — mismo criterio "falla cerrado"
   * que `MAILGUN_ENVIOS_HABILITADO`.
   */
  async generarRecordatoriosPendientes(): Promise<{
    ocurrenciasProcesadas: number;
    notificacionesCreadas: number;
  }> {
    if (!enviosDeRecordatoriosHabilitados()) {
      console.log(
        '[CalendarioService] Recordatorios deshabilitados (RECORDATORIOS_HABILITADO=false) — job no-op.',
      );
      return { ocurrenciasProcesadas: 0, notificacionesCreadas: 0 };
    }

    const ahora = new Date();
    const desde = new Date(ahora.getTime());
    const hasta = new Date(ahora.getTime() + 48 * 60 * 60 * 1000);

    let ocurrenciasProcesadas = 0;
    let notificacionesCreadas = 0;

    try {
      const eventos = await this.prisma.eventoCalendario.findMany({
        where: { sedeId: undefined }, // sin filtro de sede: el job corre para TODAS las sedes.
      });

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

        for (const fechaOcurrencia of fechas) {
          ocurrenciasProcesadas++;

          const yaEnviado = await this.prisma.recordatorioEnviado.findUnique({
            where: {
              eventoId_fechaOcurrencia: {
                eventoId: evento.id,
                fechaOcurrencia,
              },
            },
          });
          if (yaEnviado) continue;

          const destinatarios = await resolverDestinatarios(
            this.prisma,
            evento.sedeId,
            evento.alcanceTipo,
            evento.alcanceId,
          );

          try {
            const resultado = await this.prisma.$transaction(async (tx) => {
              await tx.recordatorioEnviado.create({
                data: { eventoId: evento.id, fechaOcurrencia },
              });
              if (destinatarios.length === 0) {
                return { creadas: 0 };
              }
              await tx.notificacion.createMany({
                data: destinatarios.map((usuarioId) => ({
                  usuarioId,
                  sedeId: evento.sedeId,
                  tipo: 'RECORDATORIO_EVENTO' as const,
                  referenciaId: evento.id,
                  titulo: evento.titulo,
                  cuerpoCorto: `Recordatorio: ${evento.titulo} — ${fechaOcurrencia
                    .toISOString()
                    .slice(0, 10)}`,
                })),
              });
              return { creadas: destinatarios.length };
            });

            notificacionesCreadas += resultado.creadas;

            if (destinatarios.length > 0) {
              const correos =
                await this.obtenerCorreosPersonales(destinatarios);
              await this.enviarCorreosRecordatorioEnLotes(
                correos,
                evento,
                fechaOcurrencia,
              );
            }
          } catch (err) {
            if (
              err instanceof Prisma.PrismaClientKnownRequestError &&
              err.code === 'P2002'
            ) {
              console.log(
                `[CalendarioService.generarRecordatoriosPendientes] ocurrencia ya procesada por otra corrida concurrente (evento ${evento.id}, ${fechaOcurrencia
                  .toISOString()
                  .slice(0, 10)})`,
              );
              continue;
            }
            throw err;
          }
        }
      }

      return { ocurrenciasProcesadas, notificacionesCreadas };
    } catch (err) {
      console.error(
        '[CalendarioService.generarRecordatoriosPendientes] error inesperado:',
        err,
      );
      throw err;
    }
  }

  /**
   * Resuelve `correoPersonal` para una lista de `Usuario.id`, cualquiera
   * que sea su rol — el correo de bienvenida (Fase 4) ya estableció que
   * el correo real/legible SIEMPRE es `correoPersonal` del perfil, nunca
   * `Usuario.email` (login sintético). Usuarios sin ningún perfil
   * (no debería pasar en la práctica) se omiten silenciosamente — no hay
   * a dónde mandarles el correo. Devuelve el par `usuarioId`/`correoPersonal`
   * para poder identificar en el log a qué destinatario correspondió un
   * envío fallido (regla 12).
   */
  private async obtenerCorreosPersonales(
    usuarioIds: string[],
  ): Promise<{ usuarioId: string; correoPersonal: string }[]> {
    const [alumnos, maestros, administrativos] = await Promise.all([
      this.prisma.perfilAlumno.findMany({
        where: { usuarioId: { in: usuarioIds } },
        select: { usuarioId: true, correoPersonal: true },
      }),
      this.prisma.perfilMaestro.findMany({
        where: { usuarioId: { in: usuarioIds } },
        select: { usuarioId: true, correoPersonal: true },
      }),
      this.prisma.perfilAdministrativo.findMany({
        where: { usuarioId: { in: usuarioIds } },
        select: { usuarioId: true, correoPersonal: true },
      }),
    ]);
    return [...alumnos, ...maestros, ...administrativos];
  }

  /**
   * Fan-out best-effort del correo de recordatorio, en lotes de
   * `LOTE_CORREOS_RECORDATORIO` con `Promise.allSettled` por lote (ver
   * docstring de la constante). Un correo que rechaza no tumba el lote ni
   * el job: se loguea con `console.error` incluyendo el `usuarioId` y la
   * ocurrencia afectados y el error completo (regla 12), y se sigue con el
   * resto. Nunca lanza — la creación de `Notificacion`/`RecordatorioEnviado`
   * ya quedó confirmada en su transacción antes de llamar a este método.
   */
  private async enviarCorreosRecordatorioEnLotes(
    destinatarios: { usuarioId: string; correoPersonal: string }[],
    evento: EventoCalendario,
    fechaOcurrencia: Date,
  ): Promise<void> {
    const fechaISO = fechaOcurrencia.toISOString().slice(0, 10);
    for (let i = 0; i < destinatarios.length; i += LOTE_CORREOS_RECORDATORIO) {
      const lote = destinatarios.slice(i, i + LOTE_CORREOS_RECORDATORIO);
      const resultados = await Promise.allSettled(
        lote.map((d) =>
          this.mailService.enviarNotificacion({
            correoDestino: d.correoPersonal,
            asunto: `Recordatorio: ${evento.titulo}`,
            cuerpoTexto: `Tienes un evento próximo: ${evento.titulo} el ${fechaISO}.`,
          }),
        ),
      );
      resultados.forEach((resultado, idx) => {
        if (resultado.status === 'rejected') {
          console.error(
            `[CalendarioService.generarRecordatoriosPendientes] fallo al enviar correo de recordatorio (evento ${evento.id}, ocurrencia ${fechaISO}, usuarioId ${lote[idx].usuarioId}):`,
            resultado.reason,
          );
        }
      });
    }
  }
}
