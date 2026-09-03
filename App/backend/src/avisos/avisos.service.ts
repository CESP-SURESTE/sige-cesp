import { Injectable, NotFoundException } from '@nestjs/common';
import { AccionAuditoria, AlcanceDestino, RolUsuario } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  resolverDestinatarios,
  validarAlcancePublicacion,
} from '../common/publicacion/alcance-publicacion.util';
import { obtenerCorreosPersonales } from '../common/publicacion/correos-destinatarios.util';
import type { CrearAvisoDto } from './dto/crear-aviso.dto';

export interface ActorAviso {
  usuarioId: string;
  rol: RolUsuario;
  sedeId: string;
}

export interface AvisoDto {
  id: string;
  sedeId: string;
  autorUsuarioId: string;
  titulo: string;
  cuerpo: string;
  alcanceTipo: AlcanceDestino;
  alcanceId: string | null;
  createdAt: Date;
}

/**
 * Item del feed (`GET /avisos`) y del detalle (`GET /avisos/:id`). El
 * `autor` NO sale de `Usuario` (que no tiene `nombres`/`apellidoPaterno`) —
 * se resuelve desde el perfil correspondiente, ver `resolverNombresAutores`.
 * `leidoEn` sale de la `Notificacion` `tipo: AVISO` del actor.
 */
export interface FeedItem {
  id: string;
  titulo: string;
  cuerpo: string;
  autor: { nombres: string; apellidoPaterno: string };
  createdAt: Date;
  leidoEn: Date | null;
}

const AUTOR_DESCONOCIDO = { nombres: '', apellidoPaterno: '' };

/**
 * Lote para el fan-out best-effort del correo (mismo criterio que el job
 * de recordatorios, `LOTE_CORREOS_RECORDATORIO` = 20).
 */
const LOTE_CORREOS_AVISO = 20;

@Injectable()
export class AvisosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  /**
   * `POST /avisos` — Fase 16. Todo en una transacción: valida alcance →
   * crea `Aviso` → resuelve destinatarios (excluye al autor) → `createMany`
   * de `Notificacion` (`tipo: AVISO`, `cuerpoCorto` = primeros 140 chars) →
   * audita `ALTA`. Después de confirmar: correo best-effort por lotes, cada
   * fallo logueado, ninguno tumba la publicación (patrón `altaPersona`).
   */
  async publicar(dto: CrearAvisoDto, actor: ActorAviso): Promise<AvisoDto> {
    const alcanceId = dto.alcanceId ?? null;
    await validarAlcancePublicacion(
      this.prisma,
      actor,
      dto.alcanceTipo,
      alcanceId,
    );

    let aviso: AvisoDto;
    let destinatarios: string[];
    try {
      const resultado = await this.prisma.$transaction(async (tx) => {
        const creado = await tx.aviso.create({
          data: {
            sedeId: actor.sedeId,
            autorUsuarioId: actor.usuarioId,
            titulo: dto.titulo,
            cuerpo: dto.cuerpo,
            alcanceTipo: dto.alcanceTipo,
            alcanceId,
          },
        });

        const todos = await resolverDestinatarios(
          tx as unknown as PrismaService,
          actor.sedeId,
          dto.alcanceTipo,
          alcanceId,
        );
        const dest = todos.filter((id) => id !== actor.usuarioId);

        if (dest.length > 0) {
          await tx.notificacion.createMany({
            data: dest.map((usuarioId) => ({
              usuarioId,
              sedeId: actor.sedeId,
              tipo: 'AVISO' as const,
              referenciaId: creado.id,
              titulo: creado.titulo,
              cuerpoCorto: creado.cuerpo.slice(0, 140),
            })),
          });
        }

        await tx.registroAuditoria.create({
          data: {
            usuarioId: actor.usuarioId,
            sedeId: actor.sedeId,
            accion: AccionAuditoria.ALTA,
            entidad: 'Aviso',
            entidadId: creado.id,
            detalle: { titulo: creado.titulo, alcanceTipo: creado.alcanceTipo },
          },
        });

        return { creado, dest };
      });
      aviso = resultado.creado;
      destinatarios = resultado.dest;
    } catch (err) {
      console.error('[AvisosService.publicar] error inesperado:', err);
      throw err;
    }

    // Efecto best-effort: correo. Un fallo acá NO tumba la publicación.
    try {
      if (destinatarios.length > 0) {
        const correos = await obtenerCorreosPersonales(
          this.prisma,
          destinatarios,
        );
        for (let i = 0; i < correos.length; i += LOTE_CORREOS_AVISO) {
          const lote = correos.slice(i, i + LOTE_CORREOS_AVISO);
          const resultados = await Promise.allSettled(
            lote.map((c) =>
              this.mailService.enviarNotificacion({
                correoDestino: c.correoPersonal,
                asunto: `Nuevo aviso: ${aviso.titulo}`,
                cuerpoTexto: aviso.cuerpo,
              }),
            ),
          );
          resultados.forEach((r, idx) => {
            if (r.status === 'rejected') {
              console.error(
                `[AvisosService.publicar] fallo al enviar correo de aviso ${aviso.id} a usuarioId ${lote[idx].usuarioId}:`,
                r.reason,
              );
            }
          });
        }
      }
    } catch (err) {
      console.error(
        `[AvisosService.publicar] fallo en el fan-out de correo del aviso ${aviso.id}:`,
        err,
      );
    }

    return aviso;
  }

  /**
   * `GET /avisos` — feed del actor: los avisos que le llegaron. `Aviso` y
   * `Notificacion` NO tienen relación en el schema (`referenciaId` es un
   * string sin FK, mismo criterio que `EventoCalendario`), así que se
   * resuelve en dos pasos: primero las `Notificacion` `tipo: AVISO` del
   * actor (de ahí salen los ids de aviso y el `leidoEn`), después los
   * `Aviso` por `id in`, paginados y ordenados `createdAt desc`.
   *
   * Doble filtro (regla 2): RLS por `sede_id` en Postgres + el filtro por
   * `usuarioId` del actor a nivel de aplicación.
   */
  async feedDelActor(
    actorUsuarioId: string,
    page: number,
    limit: number,
  ): Promise<{
    data: FeedItem[];
    page: number;
    limit: number;
    total: number;
  }> {
    try {
      const notifs = await this.prisma.notificacion.findMany({
        where: { usuarioId: actorUsuarioId, tipo: 'AVISO' },
        select: { referenciaId: true, leidoEn: true },
      });
      const leidoPorAviso = new Map<string, Date | null>();
      notifs.forEach((n) => leidoPorAviso.set(n.referenciaId, n.leidoEn));
      const avisoIds = [...leidoPorAviso.keys()];

      const where = { id: { in: avisoIds } };
      const [total, avisos] = await Promise.all([
        this.prisma.aviso.count({ where }),
        this.prisma.aviso.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            titulo: true,
            cuerpo: true,
            createdAt: true,
            autorUsuarioId: true,
          },
        }),
      ]);

      const nombres = await this.resolverNombresAutores([
        ...new Set(avisos.map((a) => a.autorUsuarioId)),
      ]);
      const data: FeedItem[] = avisos.map((a) => ({
        id: a.id,
        titulo: a.titulo,
        cuerpo: a.cuerpo,
        autor: nombres.get(a.autorUsuarioId) ?? { ...AUTOR_DESCONOCIDO },
        createdAt: a.createdAt,
        leidoEn: leidoPorAviso.get(a.id) ?? null,
      }));
      return { data, page, limit, total };
    } catch (err) {
      console.error('[AvisosService.feedDelActor] error inesperado:', err);
      throw err;
    }
  }

  /**
   * `GET /avisos/:id` — devuelve el aviso completo Y marca la
   * `Notificacion` `tipo: AVISO` del actor como leída (`leidoEn = now()` si
   * estaba null) — esto ES el registro del recibo de lectura. Idempotente:
   * una 2ª lectura no mueve `leidoEn`. Actor sin `Notificacion` para este
   * aviso → 404 (no era destinatario; mismo criterio de "no revelar" que
   * el resto de la API — no se distingue de "no existe").
   */
  async verDetalleYMarcarLeido(
    id: string,
    actorUsuarioId: string,
  ): Promise<FeedItem> {
    try {
      const notif = await this.prisma.notificacion.findFirst({
        where: { referenciaId: id, usuarioId: actorUsuarioId, tipo: 'AVISO' },
        select: { id: true, leidoEn: true },
      });
      if (!notif) {
        throw new NotFoundException({
          error: 'Aviso no encontrado',
          code: 'NOT_FOUND',
        });
      }

      const aviso = await this.prisma.aviso.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          titulo: true,
          cuerpo: true,
          createdAt: true,
          autorUsuarioId: true,
        },
      });

      let leidoEn = notif.leidoEn;
      if (leidoEn === null) {
        const upd = await this.prisma.notificacion.update({
          where: { id: notif.id },
          data: { leidoEn: new Date() },
          select: { leidoEn: true },
        });
        leidoEn = upd.leidoEn;
      }

      const nombres = await this.resolverNombresAutores([aviso.autorUsuarioId]);
      return {
        id: aviso.id,
        titulo: aviso.titulo,
        cuerpo: aviso.cuerpo,
        autor: nombres.get(aviso.autorUsuarioId) ?? { ...AUTOR_DESCONOCIDO },
        createdAt: aviso.createdAt,
        leidoEn,
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      console.error(
        '[AvisosService.verDetalleYMarcarLeido] error inesperado:',
        err,
      );
      throw err;
    }
  }

  /**
   * El nombre legible de una persona vive en `PerfilAlumno` /
   * `PerfilMaestro` / `PerfilAdministrativo`, no en `Usuario`. El autor de
   * un aviso es siempre ADMINISTRATIVO o MAESTRO, pero se cubren los 3 por
   * robustez. Devuelve un `Map<usuarioId, { nombres, apellidoPaterno }>`.
   */
  private async resolverNombresAutores(
    autorIds: string[],
  ): Promise<Map<string, { nombres: string; apellidoPaterno: string }>> {
    const map = new Map<string, { nombres: string; apellidoPaterno: string }>();
    if (autorIds.length === 0) return map;

    const [al, ma, ad] = await Promise.all([
      this.prisma.perfilAlumno.findMany({
        where: { usuarioId: { in: autorIds } },
        select: { usuarioId: true, nombres: true, apellidoPaterno: true },
      }),
      this.prisma.perfilMaestro.findMany({
        where: { usuarioId: { in: autorIds } },
        select: { usuarioId: true, nombres: true, apellidoPaterno: true },
      }),
      this.prisma.perfilAdministrativo.findMany({
        where: { usuarioId: { in: autorIds } },
        select: { usuarioId: true, nombres: true, apellidoPaterno: true },
      }),
    ]);
    [...al, ...ma, ...ad].forEach((p) =>
      map.set(p.usuarioId, {
        nombres: p.nombres,
        apellidoPaterno: p.apellidoPaterno,
      }),
    );
    return map;
  }
}
