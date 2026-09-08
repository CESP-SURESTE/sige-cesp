import { Injectable, NotFoundException } from '@nestjs/common';
import { AccionAuditoria, type TelefonoEmergenciaSede } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CrearTelefonoDto } from './dto/crear-telefono.dto';
import type { ActualizarTelefonoDto } from './dto/actualizar-telefono.dto';
import {
  calcularEdad,
  hayCambiosRealesTelefono,
  nombreCompleto,
} from './emergencia.util';

/**
 * Los 4 tipos de persona que el módulo de emergencia sabe buscar y del que
 * arma un expediente. NO es un enum de Prisma — `PersonalServicios` no tiene
 * `RolUsuario`, así que se modela como unión de strings propia.
 */
export type TipoExpediente =
  | 'ALUMNO'
  | 'MAESTRO'
  | 'ADMINISTRATIVO'
  | 'PERSONAL_SERVICIOS';

/** Fila del buscador cross-rol (`GET /emergencia/buscar`). */
export interface ResultadoBusqueda {
  tipo: TipoExpediente;
  perfilId: string;
  nombreCompleto: string;
  referencia: string;
  activo: boolean;
}

/** Expediente de emergencia completo (`GET /emergencia/expediente/...`). */
export interface ExpedienteEmergencia {
  tipo: TipoExpediente;
  perfilId: string;
  identidad: {
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string | null;
    curp: string | null;
    telefono: string | null;
    correoPersonal: string | null;
    referencia: string;
    fechaNacimiento: string | null; // ISO YYYY-MM-DD, solo ALUMNO
    edad: number | null; // solo ALUMNO
    activo: boolean;
  };
  infoMedica: {
    tieneCondicionMedica: boolean;
    tipoSangre: string | null;
    padecimiento: string | null;
    medicamentos: string | null;
    alergias: string | null;
    tratamientoAdicional: string | null;
  } | null;
  contactos: Array<{
    nombre: string;
    telefono: string;
    correo: string | null;
    parentesco: string;
    tipo: 'TUTOR' | 'EMERGENCIA' | null; // solo ALUMNO
    orden: number;
  }>;
}

type InfoMedicaLike = {
  tieneCondicionMedica: boolean;
  tipoSangre: string | null;
  padecimiento: string | null;
  medicamentos: string | null;
  alergias: string | null;
  tratamientoAdicional: string | null;
} | null;

type ContactoLike = {
  nombre: string;
  telefono: string;
  correo: string | null;
  parentesco: string;
  orden: number;
  tipo?: 'TUTOR' | 'EMERGENCIA';
};

function mapInfoMedica(im: InfoMedicaLike): ExpedienteEmergencia['infoMedica'] {
  if (!im) return null;
  return {
    tieneCondicionMedica: im.tieneCondicionMedica,
    tipoSangre: im.tipoSangre,
    padecimiento: im.padecimiento,
    medicamentos: im.medicamentos,
    alergias: im.alergias,
    tratamientoAdicional: im.tratamientoAdicional,
  };
}

function mapContactos(
  contactos: ContactoLike[],
  incluyeTipo: boolean,
): ExpedienteEmergencia['contactos'] {
  return contactos.map((c) => ({
    nombre: c.nombre,
    telefono: c.telefono,
    correo: c.correo,
    parentesco: c.parentesco,
    tipo: incluyeTipo ? (c.tipo ?? null) : null,
    orden: c.orden,
  }));
}

/**
 * Módulo de emergencia — CRUD de teléfonos de emergencia por sede
 * (`TelefonoEmergenciaSede`, Task 1). Mismo patrón que `SalonesService`:
 * `sedeId` siempre de `@SedeActual()` (regla 2), transacción + auditoría en
 * la misma tx, `console.error` en cada catch (regla 12), `findFirst({ id,
 * sedeId })` para verificar pertenencia a la sede antes de tocar nada.
 */
@Injectable()
export class EmergenciaService {
  constructor(private readonly prisma: PrismaService) {}

  async listarTelefonos(sedeId: string): Promise<TelefonoEmergenciaSede[]> {
    try {
      return await this.prisma.telefonoEmergenciaSede.findMany({
        where: { sedeId },
        orderBy: { orden: 'asc' },
      });
    } catch (err) {
      console.error('[EmergenciaService.listarTelefonos] error inesperado:', err);
      throw err;
    }
  }

  async crearTelefono(
    dto: CrearTelefonoDto,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<TelefonoEmergenciaSede> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const agg = await tx.telefonoEmergenciaSede.aggregate({
          where: { sedeId },
          _max: { orden: true },
        });
        const orden = (agg._max.orden ?? 0) + 1;

        const telefono = await tx.telefonoEmergenciaSede.create({
          data: { sedeId, etiqueta: dto.etiqueta, telefono: dto.telefono, orden },
        });

        await tx.registroAuditoria.create({
          data: {
            usuarioId: actorUsuarioId,
            sedeId,
            accion: AccionAuditoria.ALTA,
            entidad: 'TelefonoEmergenciaSede',
            entidadId: telefono.id,
            detalle: { etiqueta: telefono.etiqueta, telefono: telefono.telefono },
          },
        });

        return telefono;
      });
    } catch (err) {
      console.error('[EmergenciaService.crearTelefono] error inesperado:', err);
      throw err;
    }
  }

  async actualizarTelefono(
    id: string,
    dto: ActualizarTelefonoDto,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<TelefonoEmergenciaSede> {
    const existente = await this.prisma.telefonoEmergenciaSede.findFirst({
      where: { id, sedeId },
    });
    if (!existente) {
      throw new NotFoundException({
        error: 'Teléfono de emergencia no encontrado en tu sede',
        code: 'NOT_FOUND',
      });
    }

    const registrarAuditoria = hayCambiosRealesTelefono(dto, existente);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const telefono = await tx.telefonoEmergenciaSede.update({
          where: { id },
          data: { etiqueta: dto.etiqueta, telefono: dto.telefono },
        });

        if (registrarAuditoria) {
          await tx.registroAuditoria.create({
            data: {
              usuarioId: actorUsuarioId,
              sedeId,
              accion: AccionAuditoria.EDICION,
              entidad: 'TelefonoEmergenciaSede',
              entidadId: telefono.id,
              detalle: {
                etiqueta: telefono.etiqueta,
                telefono: telefono.telefono,
              },
            },
          });
        }

        return telefono;
      });
    } catch (err) {
      console.error(
        '[EmergenciaService.actualizarTelefono] error inesperado:',
        err,
      );
      throw err;
    }
  }

  async eliminarTelefono(
    id: string,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<{ ok: true }> {
    const existente = await this.prisma.telefonoEmergenciaSede.findFirst({
      where: { id, sedeId },
    });
    if (!existente) {
      throw new NotFoundException({
        error: 'Teléfono de emergencia no encontrado en tu sede',
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
            entidad: 'TelefonoEmergenciaSede',
            entidadId: existente.id,
            detalle: {
              etiqueta: existente.etiqueta,
              telefono: existente.telefono,
            },
          },
        });
        await tx.telefonoEmergenciaSede.delete({ where: { id } });
      });
    } catch (err) {
      console.error('[EmergenciaService.eliminarTelefono] error inesperado:', err);
      throw err;
    }

    return { ok: true as const };
  }

  // -------------------------------------------------------------------------
  // Task 3 — buscador cross-rol + expediente de emergencia
  // -------------------------------------------------------------------------

  /**
   * Busca por nombre/apellidos (case-insensitive, `contains`) en los 4 tipos
   * de persona de la sede del actor, además de por matrícula (ALUMNO) o
   * cédula profesional (MAESTRO). `sedeId` viene de `@SedeActual()` (regla 2).
   * Cada query trae hasta `limit` filas ya ordenadas por
   * `[apellidoPaterno, apellidoMaterno, nombres]`; el merge final de los 4
   * arrays se ordena por `nombreCompleto` (nombre visible, es-MX) — orden
   * global aproximado: esto es un lookup rápido, no un listado formal.
   */
  async buscar(
    sedeId: string,
    q: string,
    limit: number,
  ): Promise<ResultadoBusqueda[]> {
    const termino = q.trim();
    const porNombre = [
      { nombres: { contains: termino, mode: 'insensitive' as const } },
      { apellidoPaterno: { contains: termino, mode: 'insensitive' as const } },
      { apellidoMaterno: { contains: termino, mode: 'insensitive' as const } },
    ];
    const orderBy = [
      { apellidoPaterno: 'asc' as const },
      { apellidoMaterno: 'asc' as const },
      { nombres: 'asc' as const },
    ];

    try {
      const [alumnos, maestros, administrativos, personal] = await Promise.all([
        this.prisma.perfilAlumno.findMany({
          where: {
            usuario: { sedeId },
            OR: [
              ...porNombre,
              { matricula: { contains: termino, mode: 'insensitive' } },
            ],
          },
          select: {
            id: true,
            nombres: true,
            apellidoPaterno: true,
            apellidoMaterno: true,
            matricula: true,
            usuario: { select: { activo: true } },
          },
          orderBy,
          take: limit,
        }),
        this.prisma.perfilMaestro.findMany({
          where: {
            usuario: { sedeId },
            OR: [
              ...porNombre,
              { cedulaProfesional: { contains: termino, mode: 'insensitive' } },
            ],
          },
          select: {
            id: true,
            nombres: true,
            apellidoPaterno: true,
            apellidoMaterno: true,
            cedulaProfesional: true,
            usuario: { select: { activo: true } },
          },
          orderBy,
          take: limit,
        }),
        this.prisma.perfilAdministrativo.findMany({
          where: { usuario: { sedeId }, OR: porNombre },
          select: {
            id: true,
            nombres: true,
            apellidoPaterno: true,
            apellidoMaterno: true,
            puesto: true,
            usuario: { select: { activo: true } },
          },
          orderBy,
          take: limit,
        }),
        this.prisma.personalServicios.findMany({
          where: { sedeId, OR: porNombre },
          select: {
            id: true,
            nombres: true,
            apellidoPaterno: true,
            apellidoMaterno: true,
            area: true,
            estatus: true,
          },
          orderBy,
          take: limit,
        }),
      ]);

      const resultados: ResultadoBusqueda[] = [
        ...alumnos.map((a) => ({
          tipo: 'ALUMNO' as const,
          perfilId: a.id,
          nombreCompleto: nombreCompleto(a),
          referencia: a.matricula,
          activo: a.usuario.activo,
        })),
        ...maestros.map((m) => ({
          tipo: 'MAESTRO' as const,
          perfilId: m.id,
          nombreCompleto: nombreCompleto(m),
          referencia: m.cedulaProfesional ?? 'Sin cédula',
          activo: m.usuario.activo,
        })),
        ...administrativos.map((ad) => ({
          tipo: 'ADMINISTRATIVO' as const,
          perfilId: ad.id,
          nombreCompleto: nombreCompleto(ad),
          referencia: ad.puesto,
          activo: ad.usuario.activo,
        })),
        ...personal.map((p) => ({
          tipo: 'PERSONAL_SERVICIOS' as const,
          perfilId: p.id,
          nombreCompleto: nombreCompleto(p),
          referencia: p.area,
          activo: p.estatus === 'ACTIVO',
        })),
      ];

      resultados.sort((a, b) =>
        a.nombreCompleto
          .toLocaleLowerCase('es')
          .localeCompare(b.nombreCompleto.toLocaleLowerCase('es'), 'es'),
      );
      return resultados.slice(0, limit);
    } catch (err) {
      console.error('[EmergenciaService.buscar] error inesperado:', err);
      throw err;
    }
  }

  /**
   * Expediente de emergencia de una persona de la sede del actor. Escribe un
   * `RegistroAuditoria` `CONSULTA_EMERGENCIA` (best-effort: un fallo de
   * bitácora se loguea completo — regla 12 — y el expediente se devuelve
   * igual; una emergencia no se bloquea por la auditoría).
   */
  async obtenerExpediente(
    tipo: TipoExpediente,
    perfilId: string,
    actorUsuarioId: string,
    sedeId: string,
  ): Promise<ExpedienteEmergencia> {
    const expediente = await this.cargarExpediente(tipo, perfilId, sedeId);
    if (!expediente) {
      throw new NotFoundException({
        error: 'Persona no encontrada en tu sede',
        code: 'NOT_FOUND',
      });
    }

    try {
      await this.prisma.registroAuditoria.create({
        data: {
          usuarioId: actorUsuarioId,
          sedeId,
          accion: AccionAuditoria.CONSULTA_EMERGENCIA,
          entidad: 'ExpedienteEmergencia',
          entidadId: perfilId,
          detalle: {
            tipo,
            nombreCompleto: nombreCompleto(expediente.identidad),
          },
        },
      });
    } catch (err) {
      console.error(
        '[EmergenciaService.obtenerExpediente] fallo al auditar la consulta ' +
          '(se devuelve el expediente igual):',
        err,
      );
    }

    return expediente;
  }

  private async cargarExpediente(
    tipo: TipoExpediente,
    perfilId: string,
    sedeId: string,
  ): Promise<ExpedienteEmergencia | null> {
    try {
      if (tipo === 'ALUMNO') {
        const a = await this.prisma.perfilAlumno.findFirst({
          where: { id: perfilId, usuario: { sedeId } },
          include: {
            usuario: { select: { activo: true } },
            infoMedica: true,
            contactos: { orderBy: { orden: 'asc' } },
          },
        });
        if (!a) return null;
        return {
          tipo,
          perfilId: a.id,
          identidad: {
            nombres: a.nombres,
            apellidoPaterno: a.apellidoPaterno,
            apellidoMaterno: a.apellidoMaterno,
            curp: a.curp,
            telefono: a.telefono,
            correoPersonal: a.correoPersonal,
            referencia: a.matricula,
            fechaNacimiento: a.fechaNacimiento.toISOString().slice(0, 10),
            edad: calcularEdad(a.fechaNacimiento),
            activo: a.usuario.activo,
          },
          infoMedica: mapInfoMedica(a.infoMedica),
          contactos: mapContactos(a.contactos, true),
        };
      }

      if (tipo === 'MAESTRO') {
        const m = await this.prisma.perfilMaestro.findFirst({
          where: { id: perfilId, usuario: { sedeId } },
          include: {
            usuario: { select: { activo: true } },
            infoMedica: true,
            contactos: { orderBy: { orden: 'asc' } },
          },
        });
        if (!m) return null;
        return {
          tipo,
          perfilId: m.id,
          identidad: {
            nombres: m.nombres,
            apellidoPaterno: m.apellidoPaterno,
            apellidoMaterno: m.apellidoMaterno,
            curp: m.curp,
            telefono: m.telefono,
            correoPersonal: m.correoPersonal,
            referencia: m.cedulaProfesional ?? 'Sin cédula',
            fechaNacimiento: null,
            edad: null,
            activo: m.usuario.activo,
          },
          infoMedica: mapInfoMedica(m.infoMedica),
          contactos: mapContactos(m.contactos, false),
        };
      }

      if (tipo === 'ADMINISTRATIVO') {
        const ad = await this.prisma.perfilAdministrativo.findFirst({
          where: { id: perfilId, usuario: { sedeId } },
          include: {
            usuario: { select: { activo: true } },
            infoMedica: true,
            contactos: { orderBy: { orden: 'asc' } },
          },
        });
        if (!ad) return null;
        return {
          tipo,
          perfilId: ad.id,
          identidad: {
            nombres: ad.nombres,
            apellidoPaterno: ad.apellidoPaterno,
            apellidoMaterno: ad.apellidoMaterno,
            curp: ad.curp,
            telefono: ad.telefono,
            correoPersonal: ad.correoPersonal,
            referencia: ad.puesto,
            fechaNacimiento: null,
            edad: null,
            activo: ad.usuario.activo,
          },
          infoMedica: mapInfoMedica(ad.infoMedica),
          contactos: mapContactos(ad.contactos, false),
        };
      }

      // PERSONAL_SERVICIOS — `sede_id` directo, sin `Usuario`.
      const p = await this.prisma.personalServicios.findFirst({
        where: { id: perfilId, sedeId },
        include: {
          infoMedica: true,
          contactos: { orderBy: { orden: 'asc' } },
        },
      });
      if (!p) return null;
      return {
        tipo: 'PERSONAL_SERVICIOS',
        perfilId: p.id,
        identidad: {
          nombres: p.nombres,
          apellidoPaterno: p.apellidoPaterno,
          apellidoMaterno: p.apellidoMaterno,
          curp: p.curp,
          telefono: p.telefono,
          correoPersonal: p.correoPersonal,
          referencia: p.area,
          fechaNacimiento: null,
          edad: null,
          activo: p.estatus === 'ACTIVO',
        },
        infoMedica: mapInfoMedica(p.infoMedica),
        contactos: mapContactos(p.contactos, false),
      };
    } catch (err) {
      console.error(
        '[EmergenciaService.cargarExpediente] error inesperado:',
        err,
      );
      throw err;
    }
  }
}
