import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

/**
 * Item del reporte de recibos (`GET /avisos/:id/recibos`). El set de
 * destinatarios es el snapshot de `Notificacion` `tipo: AVISO` fijado al
 * publicar; `leidoEn` es el recibo de lectura por persona.
 */
export interface ReciboItem {
  usuarioId: string;
  nombreCompleto: string;
  rol: RolUsuario;
  leidoEn: Date | null;
}

/**
 * Item de `GET /avisos/publicados` — la tabla de gestión del autor (Día 47).
 * `alcanceNombre`, `totalDestinatarios` y `leidos` se derivan al vuelo
 * (regla 1), resueltos en batch para evitar N+1. `alcanceNombre` es `null`
 * si el `alcanceId` apunta a una carrera/grupo ya borrado (defensivo).
 */
export interface AvisoPublicadoItem {
  id: string;
  titulo: string;
  cuerpo: string;
  alcanceTipo: AlcanceDestino;
  alcanceId: string | null;
  alcanceNombre: string | null;
  createdAt: Date;
  totalDestinatarios: number;
  leidos: number;
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

        // resolverDestinatarios solo usa delegates de modelo que el cliente transaccional también expone
        // — el cast mantiene el fan-out de destinatarios DENTRO de la tx sin abrir una conexión nueva.
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

    // Efecto best-effort: correo. Fire-and-forget — un fan-out de alcance
    // SEDE a cientos de personas no debe colgar la respuesta HTTP de una
    // publicación que ya se guardó. Un fallo acá NO tumba la publicación.
    if (destinatarios.length > 0) {
      void this.enviarCorreosDeAvisoEnLotes(destinatarios, aviso).catch(
        (err) => {
          console.error(
            `[AvisosService.publicar] fallo en el fan-out de correo del aviso ${aviso.id}:`,
            err,
          );
        },
      );
    }

    return aviso;
  }

  /**
   * Fan-out best-effort del correo de un aviso, por lotes de
   * `LOTE_CORREOS_AVISO`. Cada rechazo se loguea con su `usuarioId` (regla
   * 12); NUNCA relanza — el `.catch` de `publicar` es solo un backstop.
   */
  private async enviarCorreosDeAvisoEnLotes(
    destinatarios: string[],
    aviso: AvisoDto,
  ): Promise<void> {
    const correos = await obtenerCorreosPersonales(this.prisma, destinatarios);
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

  /**
   * `GET /avisos` — feed del actor: los avisos que le llegaron. `Aviso` y
   * `Notificacion` NO tienen relación en el schema (`referenciaId` es un
   * string sin FK, mismo criterio que `EventoCalendario`), así que se
   * resuelve en dos pasos: primero las `Notificacion` `tipo: AVISO` del
   * actor (de ahí salen los ids de aviso y el `leidoEn`), después los
   * `Aviso` por `id in`, paginados y ordenados `createdAt desc`.
   *
   * Doble filtro (regla 2): filtro por `usuarioId` + `sedeId` a nivel de
   * aplicación. El backend usa el rol `postgres` con BYPASSRLS — la RLS de
   * `avisos` es la última línea solo para accesos que NO pasan por este
   * backend (ver `prisma.service.ts`).
   */
  async feedDelActor(
    actorUsuarioId: string,
    sedeId: string,
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

      const where = { id: { in: avisoIds }, sedeId };
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
   * `GET /avisos/publicados` — Fase 16, Día 47. Los avisos que el actor
   * (`ADMINISTRATIVO`/`MAESTRO`) publicó en su sede, paginado, con
   * contadores de recibo. `where` acotado a `{ sedeId, autorUsuarioId }` —
   * el backend nunca confía en un `autorUsuarioId` de query (regla 2, mismo
   * criterio que `sedeId`).
   */
  async listarPublicadosPorActor(
    actorUsuarioId: string,
    sedeId: string,
    page: number,
    limit: number,
  ): Promise<{
    data: AvisoPublicadoItem[];
    page: number;
    limit: number;
    total: number;
  }> {
    try {
      const where = { sedeId, autorUsuarioId: actorUsuarioId };
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
            alcanceTipo: true,
            alcanceId: true,
            createdAt: true,
          },
        }),
      ]);

      const avisoIds = avisos.map((a) => a.id);
      const [alcanceNombres, contadores] = await Promise.all([
        this.resolverAlcanceNombres(avisos),
        this.contarRecibosPorAviso(avisoIds),
      ]);

      const data: AvisoPublicadoItem[] = avisos.map((a) => ({
        id: a.id,
        titulo: a.titulo,
        cuerpo: a.cuerpo,
        alcanceTipo: a.alcanceTipo,
        alcanceId: a.alcanceId,
        alcanceNombre: alcanceNombres.get(a.id) ?? null,
        createdAt: a.createdAt,
        totalDestinatarios: contadores.get(a.id)?.total ?? 0,
        leidos: contadores.get(a.id)?.leidos ?? 0,
      }));
      return { data, page, limit, total };
    } catch (err) {
      console.error(
        '[AvisosService.listarPublicadosPorActor] error inesperado:',
        err,
      );
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
    sedeId: string,
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

      const aviso = await this.prisma.aviso.findFirst({
        where: { id, sedeId },
        select: {
          id: true,
          titulo: true,
          cuerpo: true,
          createdAt: true,
          autorUsuarioId: true,
        },
      });
      if (!aviso) {
        throw new NotFoundException({
          error: 'Aviso no encontrado',
          code: 'NOT_FOUND',
        });
      }

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
   * Carga el aviso exigiendo que pertenezca a la sede del actor. Aviso
   * inexistente o de otra sede → 404 (nunca 403 — no se revela existencia,
   * mismo criterio que el resto de la API).
   */
  private async obtenerAvisoEnSede(id: string, sedeId: string) {
    const aviso = await this.prisma.aviso.findFirst({
      where: { id, sedeId },
      select: { id: true, autorUsuarioId: true, sedeId: true },
    });
    if (!aviso) {
      throw new NotFoundException({
        error: 'Aviso no encontrado',
        code: 'NOT_FOUND',
      });
    }
    return aviso;
  }

  /**
   * Autor del aviso, o cualquier `ADMINISTRATIVO` de la sede del aviso (la
   * sede ya está garantizada por `obtenerAvisoEnSede`). `MAESTRO`/`ALUMNO`
   * no-autor → 403 `ROL_NO_AUTORIZADO`.
   */
  private verificarPuedeGestionar(
    aviso: { autorUsuarioId: string },
    actor: ActorAviso,
  ): void {
    const esAutor = aviso.autorUsuarioId === actor.usuarioId;
    const esAdmin = actor.rol === RolUsuario.ADMINISTRATIVO;
    if (!esAutor && !esAdmin) {
      throw new ForbiddenException({
        error: 'Solo el autor o un administrativo pueden gestionar este aviso',
        code: 'ROL_NO_AUTORIZADO',
      });
    }
  }

  /**
   * `GET /avisos/:id/recibos` — solo autor o `ADMINISTRATIVO` de la sede
   * del aviso. El snapshot de destinatarios es el set de `Notificacion`
   * `tipo: AVISO` de ese aviso (fijado al publicar). `nombreCompleto` y
   * `rol` se resuelven del `Usuario` + su perfil. Orden por
   * `nombreCompleto`.
   */
  async obtenerRecibos(
    id: string,
    actor: ActorAviso,
  ): Promise<{
    total: number;
    leidos: number;
    noLeidos: number;
    destinatarios: ReciboItem[];
  }> {
    try {
      const aviso = await this.obtenerAvisoEnSede(id, actor.sedeId);
      this.verificarPuedeGestionar(aviso, actor);

      const notifs = await this.prisma.notificacion.findMany({
        where: { referenciaId: id, tipo: 'AVISO' },
        select: { usuarioId: true, leidoEn: true },
      });
      const usuarioIds = notifs.map((n) => n.usuarioId);
      const [usuarios, nombres] = await Promise.all([
        this.prisma.usuario.findMany({
          where: { id: { in: usuarioIds } },
          select: { id: true, rol: true },
        }),
        this.resolverNombresCompletos(usuarioIds),
      ]);
      const rolPorId = new Map(usuarios.map((u) => [u.id, u.rol]));

      const destinatarios: ReciboItem[] = notifs.map((n) => ({
        usuarioId: n.usuarioId,
        nombreCompleto: nombres.get(n.usuarioId) ?? '',
        rol: rolPorId.get(n.usuarioId) ?? RolUsuario.ALUMNO,
        leidoEn: n.leidoEn,
      }));
      destinatarios.sort((a, b) =>
        a.nombreCompleto.localeCompare(b.nombreCompleto),
      );

      const leidos = destinatarios.filter((d) => d.leidoEn !== null).length;
      return {
        total: destinatarios.length,
        leidos,
        noLeidos: destinatarios.length - leidos,
        destinatarios,
      };
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof ForbiddenException
      ) {
        throw err;
      }
      console.error('[AvisosService.obtenerRecibos] error inesperado:', err);
      throw err;
    }
  }

  /**
   * `DELETE /avisos/:id` — DELETE real (`Aviso` está en "CRUD" de negocio,
   * no baja lógica — regla 3 es solo para personas). Autor o
   * `ADMINISTRATIVO` de la sede. En una transacción: audita `ELIMINACION`
   * ANTES del delete (regla 5 — la fila de auditoría queda aunque el aviso
   * ya no exista) → borra las `Notificacion` del aviso (`referenciaId`, sin
   * FK → `deleteMany` a mano) → borra el `Aviso`.
   */
  async eliminar(id: string, actor: ActorAviso): Promise<{ ok: true }> {
    try {
      const aviso = await this.obtenerAvisoEnSede(id, actor.sedeId);
      this.verificarPuedeGestionar(aviso, actor);

      await this.prisma.$transaction(async (tx) => {
        await tx.registroAuditoria.create({
          data: {
            usuarioId: actor.usuarioId,
            sedeId: actor.sedeId,
            accion: AccionAuditoria.ELIMINACION,
            entidad: 'Aviso',
            entidadId: id,
          },
        });
        await tx.notificacion.deleteMany({
          where: { referenciaId: id, tipo: 'AVISO' },
        });
        await tx.aviso.delete({ where: { id } });
      });
      return { ok: true };
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof ForbiddenException
      ) {
        throw err;
      }
      console.error('[AvisosService.eliminar] error inesperado:', err);
      throw err;
    }
  }

  /**
   * Como `resolverNombresAutores` pero devuelve el nombre completo ya
   * formateado (`` `${nombres} ${apellidoPaterno} ${apellidoMaterno}`.trim() ``).
   * Usado por el reporte de recibos, que necesita el nombre legible
   * completo de cada destinatario (alumno/maestro/administrativo).
   */
  private async resolverNombresCompletos(
    usuarioIds: string[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (usuarioIds.length === 0) return map;

    const select = {
      usuarioId: true,
      nombres: true,
      apellidoPaterno: true,
      apellidoMaterno: true,
    } as const;
    const [al, ma, ad] = await Promise.all([
      this.prisma.perfilAlumno.findMany({
        where: { usuarioId: { in: usuarioIds } },
        select,
      }),
      this.prisma.perfilMaestro.findMany({
        where: { usuarioId: { in: usuarioIds } },
        select,
      }),
      this.prisma.perfilAdministrativo.findMany({
        where: { usuarioId: { in: usuarioIds } },
        select,
      }),
    ]);
    [...al, ...ma, ...ad].forEach((p) =>
      map.set(
        p.usuarioId,
        `${p.nombres} ${p.apellidoPaterno} ${p.apellidoMaterno}`.trim(),
      ),
    );
    return map;
  }

  /**
   * `alcanceId` → nombre legible, en batch. SEDE no tiene id ("Toda la
   * sede"); CARRERA/GRUPO se resuelven con un `findMany` cada uno. Un
   * `alcanceId` que ya no existe → `null` (no rompe la tabla del cliente).
   */
  private async resolverAlcanceNombres(
    avisos: {
      id: string;
      alcanceTipo: AlcanceDestino;
      alcanceId: string | null;
    }[],
  ): Promise<Map<string, string | null>> {
    const map = new Map<string, string | null>();
    const carreraIds = new Set<string>();
    const grupoIds = new Set<string>();
    for (const a of avisos) {
      if (a.alcanceTipo === AlcanceDestino.SEDE) {
        map.set(a.id, 'Toda la sede');
      } else if (a.alcanceTipo === AlcanceDestino.CARRERA && a.alcanceId) {
        carreraIds.add(a.alcanceId);
      } else if (a.alcanceTipo === AlcanceDestino.GRUPO && a.alcanceId) {
        grupoIds.add(a.alcanceId);
      }
    }
    const [carreras, grupos] = await Promise.all([
      carreraIds.size
        ? this.prisma.carrera.findMany({
            where: { id: { in: [...carreraIds] } },
            select: { id: true, nombre: true },
          })
        : Promise.resolve([] as { id: string; nombre: string }[]),
      grupoIds.size
        ? this.prisma.grupo.findMany({
            where: { id: { in: [...grupoIds] } },
            select: { id: true, nombre: true },
          })
        : Promise.resolve([] as { id: string; nombre: string }[]),
    ]);
    const carreraNombre = new Map(carreras.map((c) => [c.id, c.nombre]));
    const grupoNombre = new Map(grupos.map((g) => [g.id, g.nombre]));
    for (const a of avisos) {
      if (map.has(a.id)) continue;
      if (a.alcanceTipo === AlcanceDestino.CARRERA) {
        map.set(a.id, carreraNombre.get(a.alcanceId ?? '') ?? null);
      } else if (a.alcanceTipo === AlcanceDestino.GRUPO) {
        map.set(a.id, grupoNombre.get(a.alcanceId ?? '') ?? null);
      } else {
        map.set(a.id, null);
      }
    }
    return map;
  }

  /**
   * `avisoId` → `{ total, leidos }` de sus `Notificacion` `tipo: AVISO`
   * (el snapshot de destinatarios fijado al publicar). Un solo `findMany`
   * para todos los avisos de la página.
   */
  private async contarRecibosPorAviso(
    avisoIds: string[],
  ): Promise<Map<string, { total: number; leidos: number }>> {
    const map = new Map<string, { total: number; leidos: number }>();
    if (avisoIds.length === 0) return map;
    const notifs = await this.prisma.notificacion.findMany({
      where: { tipo: 'AVISO', referenciaId: { in: avisoIds } },
      select: { referenciaId: true, leidoEn: true },
    });
    for (const n of notifs) {
      const cur = map.get(n.referenciaId) ?? { total: 0, leidos: 0 };
      cur.total += 1;
      if (n.leidoEn !== null) cur.leidos += 1;
      map.set(n.referenciaId, cur);
    }
    return map;
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
