import { Injectable } from '@nestjs/common';
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
}
