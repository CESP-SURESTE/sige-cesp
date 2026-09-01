import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AlcanceDestino, RolUsuario } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Helpers compartidos de "quién puede publicar a quién" — Fase 15, Día 41.
 * Los usa Calendario (`EventoCalendario`) y los reutiliza Avisos (`Aviso`,
 * Fase 16) tal cual, sin duplicar la lógica de permisos ni de resolución
 * de destinatarios.
 */

const ERROR_ROL_NO_AUTORIZADO = {
  error: 'Tu rol no tiene acceso a este recurso',
  code: 'ROL_NO_AUTORIZADO',
} as const;

interface ActorPublicacion {
  usuarioId: string;
  rol: RolUsuario;
  sedeId: string;
}

/**
 * Valida que `actor` puede publicar (crear/editar un evento o aviso) con
 * el alcance `(alcanceTipo, alcanceId)`. Lanza si no puede; no retorna
 * nada si sí puede.
 *
 * - `alcanceTipo === SEDE` exige `alcanceId` ausente; `CARRERA`/`GRUPO`
 *   exigen `alcanceId` presente -> 400 `VALIDATION_ERROR` si no.
 * - `ALUMNO` siempre 403 -> defensivo (las rutas ya lo bloquean con
 *   `@Roles(ADMINISTRATIVO, MAESTRO)` a nivel de guard; este chequeo es
 *   la segunda capa, mismo criterio de "belt and suspenders" que el resto
 *   de la app).
 * - `MAESTRO` solo puede `GRUPO`, y solo si tiene una fila en
 *   `GrupoMateriaMaestro` para ese grupo -> 403 en cualquier otro caso
 *   (la API nunca distingue "no autorizado" de "no existe" para el
 *   cross-scope de un maestro, mismo criterio que el resto de esta app).
 * - `ADMINISTRATIVO`: `SEDE` no requiere más validación; `CARRERA`/`GRUPO`
 *   deben existir y pertenecer a la sede del actor -> 404 `NOT_FOUND` si
 *   no. Sin jerarquía de `nivelPermiso` (mismo criterio que
 *   Carreras/Grupos/Salones).
 */
export async function validarAlcancePublicacion(
  prisma: PrismaService,
  actor: ActorPublicacion,
  alcanceTipo: AlcanceDestino,
  alcanceId: string | null,
): Promise<void> {
  if (alcanceTipo === AlcanceDestino.SEDE && alcanceId) {
    throw new BadRequestException({
      error: 'alcanceId no debe enviarse cuando alcanceTipo es SEDE',
      code: 'VALIDATION_ERROR',
    });
  }
  if (alcanceTipo !== AlcanceDestino.SEDE && !alcanceId) {
    throw new BadRequestException({
      error: 'alcanceId es requerido para este alcanceTipo',
      code: 'VALIDATION_ERROR',
    });
  }

  if (actor.rol === RolUsuario.ALUMNO) {
    throw new ForbiddenException(ERROR_ROL_NO_AUTORIZADO);
  }

  if (actor.rol === RolUsuario.MAESTRO) {
    if (alcanceTipo !== AlcanceDestino.GRUPO) {
      throw new ForbiddenException(ERROR_ROL_NO_AUTORIZADO);
    }
    const asignacion = await prisma.grupoMateriaMaestro.findFirst({
      where: { grupoId: alcanceId!, maestro: { usuarioId: actor.usuarioId } },
      select: { id: true },
    });
    if (!asignacion) {
      throw new ForbiddenException(ERROR_ROL_NO_AUTORIZADO);
    }
    return;
  }

  // ADMINISTRATIVO.
  if (alcanceTipo === AlcanceDestino.CARRERA) {
    const carrera = await prisma.carrera.findFirst({
      where: { id: alcanceId!, sedeId: actor.sedeId },
      select: { id: true },
    });
    if (!carrera) {
      throw new NotFoundException({
        error: 'Carrera no encontrada en tu sede',
        code: 'NOT_FOUND',
      });
    }
  } else if (alcanceTipo === AlcanceDestino.GRUPO) {
    const grupo = await prisma.grupo.findFirst({
      where: { id: alcanceId!, sedeId: actor.sedeId },
      select: { id: true },
    });
    if (!grupo) {
      throw new NotFoundException({
        error: 'Grupo no encontrado en tu sede',
        code: 'NOT_FOUND',
      });
    }
  }
}

/**
 * Resuelve los `Usuario.id` a los que les toca un alcance dado — lo usan
 * el job de recordatorios (Fase 15, Día 42) y el fan-out de avisos (Fase
 * 16). Solo `Usuario.activo: true` en los 3 casos. Sin duplicados (un
 * usuario nunca aparece 2 veces aunque calce por más de una vía).
 */
export async function resolverDestinatarios(
  prisma: PrismaService,
  sedeId: string,
  alcanceTipo: AlcanceDestino,
  alcanceId: string | null,
): Promise<string[]> {
  if (alcanceTipo === AlcanceDestino.SEDE) {
    const usuarios = await prisma.usuario.findMany({
      where: { sedeId, activo: true },
      select: { id: true },
    });
    return usuarios.map((u) => u.id);
  }

  const ids = new Set<string>();

  if (alcanceTipo === AlcanceDestino.CARRERA) {
    const [alumnos, maestros] = await Promise.all([
      prisma.perfilAlumno.findMany({
        where: { carreraId: alcanceId!, usuario: { activo: true } },
        select: { usuarioId: true },
      }),
      prisma.perfilMaestro.findMany({
        where: {
          usuario: { activo: true },
          asignaciones: { some: { grupo: { carreraId: alcanceId! } } },
        },
        select: { usuarioId: true },
      }),
    ]);
    alumnos.forEach((a) => ids.add(a.usuarioId));
    maestros.forEach((m) => ids.add(m.usuarioId));
    return [...ids];
  }

  // GRUPO.
  const [alumnos, maestros] = await Promise.all([
    prisma.grupoAlumno.findMany({
      where: { grupoId: alcanceId!, alumno: { usuario: { activo: true } } },
      select: { alumno: { select: { usuarioId: true } } },
    }),
    prisma.grupoMateriaMaestro.findMany({
      where: { grupoId: alcanceId!, maestro: { usuario: { activo: true } } },
      select: { maestro: { select: { usuarioId: true } } },
    }),
  ]);
  alumnos.forEach((a) => ids.add(a.alumno.usuarioId));
  maestros.forEach((m) => ids.add(m.maestro.usuarioId));
  return [...ids];
}
