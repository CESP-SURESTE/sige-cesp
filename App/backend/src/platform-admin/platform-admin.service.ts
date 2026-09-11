import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AccionAuditoria, Prisma, RolUsuario } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { verifyPassword } from './password.util';
import { firmarPlatformAdminToken } from './platform-admin-jwt.util';

export interface ResumenGlobal {
  totalSedes: number;
  totalAlumnosActivos: number;
  totalMaestrosActivos: number;
  totalAdministrativosActivos: number;
  alumnosPorSede: { sedeId: string; nombre: string; cantidad: number }[];
}

export type ActorTipo = 'USUARIO' | 'PLATAFORMA';

export interface RegistroAuditoriaItem {
  id: string;
  fecha: string;
  accion: AccionAuditoria;
  entidad: string;
  entidadId: string;
  actor: {
    id: string;
    tipo: ActorTipo;
    nombre: string;
    rol: RolUsuario | null;
  };
  sede: { id: string; nombre: string } | null;
  // `unknown` ya incluye `null`; el valor real es el `Json?` de la fila (o
  // `null` si la columna venía vacía). Ver Task 2 (frontend): `unknown | null`.
  detalle: unknown;
}

export interface ListaAuditoria {
  data: RegistroAuditoriaItem[];
  page: number;
  limit: number;
  total: number;
}

export interface FiltrosAuditoria {
  sedeId?: string;
  accion?: AccionAuditoria;
  entidad?: string;
  actorId?: string;
  desde?: string;
  hasta?: string;
  page?: number;
  limit?: number;
}

/**
 * Hash "señuelo" con el mismo formato que `hashPassword` (`"<salt-hex>:<
 * derivedKey-hex>"`, ver `password.util.ts`) pero de una password que no
 * existe — se usa para que `verifyPassword` (y su costo de `scrypt`) corra
 * SIEMPRE, exista o no el email. Generado una sola vez al cargar el módulo:
 * no necesita ser el resultado real de un `scrypt` (nunca se compara con una
 * password real), solo tener el largo correcto para que `verifyPassword` no
 * corte antes de tiempo.
 */
const HASH_SENUELO = `${randomBytes(16).toString('hex')}:${randomBytes(64).toString('hex')}`;

@Injectable()
export class PlatformAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async login(email: string, password: string): Promise<{ token: string }> {
    const admin = await this.prisma.adminPlataforma.findUnique({
      where: { email },
    });

    // Timing oracle (hallazgo de QA, Día 20 — deferred, corregido 2026-08-16):
    // `verifyPassword` (y su costo de `scrypt`) debe correr en los 2 casos —
    // si se saltara cuando `admin` no existe, el tiempo de respuesta ya
    // revelaría si el email está registrado, antes incluso de llegar al
    // mensaje genérico de abajo.
    const hashParaVerificar =
      admin && admin.activo ? admin.passwordHash : HASH_SENUELO;
    const passwordValida = await verifyPassword(password, hashParaVerificar);

    // Mismo mensaje/código exista o no el email, esté activo o no, sea
    // correcta o no la password — no revelar cuál de los datos falló (mismo
    // criterio que el resto de la API).
    if (!admin || !admin.activo || !passwordValida) {
      throw new UnauthorizedException({
        error: 'Correo o contraseña incorrectos',
        code: 'UNAUTHORIZED',
      });
    }

    const token = await firmarPlatformAdminToken({
      sub: admin.id,
      email: admin.email,
    });

    return { token };
  }

  /**
   * `GET /platform-admin/resumen` — dashboard global de plataforma.
   * Sin filtro de `sedeId` a propósito — `AdminPlataforma` ve TODAS las
   * sedes (a diferencia de cualquier query de `ADMINISTRATIVO`, que siempre
   * filtra por `@SedeActual()`).
   */
  async resumenGlobal(): Promise<ResumenGlobal> {
    const [
      totalSedes,
      totalAlumnosActivos,
      totalMaestrosActivos,
      totalAdministrativosActivos,
      alumnosPorSedeRaw,
    ] = await Promise.all([
      this.prisma.sede.count(),
      this.prisma.usuario.count({
        where: { rol: RolUsuario.ALUMNO, activo: true },
      }),
      this.prisma.usuario.count({
        where: { rol: RolUsuario.MAESTRO, activo: true },
      }),
      this.prisma.usuario.count({
        where: { rol: RolUsuario.ADMINISTRATIVO, activo: true },
      }),
      this.prisma.usuario.groupBy({
        by: ['sedeId'],
        where: { rol: RolUsuario.ALUMNO, activo: true },
        _count: { sedeId: true },
        orderBy: { _count: { sedeId: 'desc' } },
      }),
    ]);

    const sedes = await this.prisma.sede.findMany({
      where: { id: { in: alumnosPorSedeRaw.map((g) => g.sedeId) } },
      select: { id: true, nombre: true },
    });
    const nombrePorSedeId = new Map(sedes.map((s) => [s.id, s.nombre]));

    const alumnosPorSede = alumnosPorSedeRaw.map((g) => ({
      sedeId: g.sedeId,
      nombre: nombrePorSedeId.get(g.sedeId) ?? '',
      cantidad: g._count.sedeId,
    }));

    return {
      totalSedes,
      totalAlumnosActivos,
      totalMaestrosActivos,
      totalAdministrativosActivos,
      alumnosPorSede,
    };
  }

  /**
   * `GET /platform-admin/auditoria` — bitácora cross-sede paginada.
   *
   * Primer endpoint de LECTURA de `RegistroAuditoria` (regla 5 — este método
   * solo hace `findMany`/`count`, nunca escribe). Cross-sede por diseño: el
   * actor `AdminPlataforma` no tiene sede, así que NO se filtra por
   * `@SedeActual()` (a diferencia de cualquier query de `ADMINISTRATIVO`).
   *
   * `actor.nombre`/`actor.tipo`/`sede.nombre` se derivan por request (regla 1),
   * nunca se persisten. La resolución de actor va en batch — 2 `findMany` con
   * `in`, no un query por fila (sin N+1).
   */
  async listarAuditoria(filtros: FiltrosAuditoria): Promise<ListaAuditoria> {
    const page = filtros.page ?? 1;
    const limit = filtros.limit ?? 20;

    // Regla cruzada: hasta < desde -> 400. (El formato ya lo validó el DTO.)
    if (filtros.desde && filtros.hasta && filtros.hasta < filtros.desde) {
      throw new BadRequestException({
        error: 'El parámetro "hasta" no puede ser anterior a "desde"',
        code: 'VALIDATION_ERROR',
      });
    }

    const where: Prisma.RegistroAuditoriaWhereInput = {};
    if (filtros.sedeId) where.sedeId = filtros.sedeId;
    if (filtros.accion) where.accion = filtros.accion;
    if (filtros.entidad) where.entidad = filtros.entidad;
    if (filtros.actorId) {
      where.OR = [
        { usuarioId: filtros.actorId },
        { adminPlataformaId: filtros.actorId },
      ];
    }
    if (filtros.desde || filtros.hasta) {
      const fecha: Prisma.DateTimeFilter = {};
      if (filtros.desde) fecha.gte = new Date(`${filtros.desde}T00:00:00.000Z`);
      if (filtros.hasta) {
        const d = new Date(`${filtros.hasta}T00:00:00.000Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        fecha.lt = d; // rango [desde, hasta] inclusivo por día, en UTC
      }
      where.fecha = fecha;
    }

    const [filas, total] = await Promise.all([
      this.prisma.registroAuditoria.findMany({
        where,
        orderBy: { fecha: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          fecha: true,
          accion: true,
          entidad: true,
          entidadId: true,
          detalle: true,
          usuarioId: true,
          adminPlataformaId: true,
          sede: { select: { id: true, nombre: true } },
        },
      }),
      this.prisma.registroAuditoria.count({ where }),
    ]);

    // Resolución de actor en batch (sin N+1).
    const usuarioIds = [
      ...new Set(filas.map((f) => f.usuarioId).filter((x): x is string => !!x)),
    ];
    const adminIds = [
      ...new Set(
        filas.map((f) => f.adminPlataformaId).filter((x): x is string => !!x),
      ),
    ];

    // `in: []` es un no-op para Prisma (devuelve `[]` sin viaje relevante a
    // la DB), así que se consultan siempre — 2 `findMany` como máximo, sin
    // N+1 y sin ramas de tipo que compliquen el tipado del `Promise.all`.
    const [usuarios, admins] = await Promise.all([
      this.prisma.usuario.findMany({
        where: { id: { in: usuarioIds } },
        select: {
          id: true,
          rol: true,
          email: true,
          perfilAlumno: {
            select: {
              nombres: true,
              apellidoPaterno: true,
              apellidoMaterno: true,
            },
          },
          perfilMaestro: {
            select: {
              nombres: true,
              apellidoPaterno: true,
              apellidoMaterno: true,
            },
          },
          perfilAdministrativo: {
            select: {
              nombres: true,
              apellidoPaterno: true,
              apellidoMaterno: true,
            },
          },
        },
      }),
      this.prisma.adminPlataforma.findMany({
        where: { id: { in: adminIds } },
        select: { id: true, nombre: true },
      }),
    ]);

    const nombreUsuario = new Map<
      string,
      { nombre: string; rol: RolUsuario }
    >();
    for (const u of usuarios) {
      const p = u.perfilAlumno ?? u.perfilMaestro ?? u.perfilAdministrativo;
      const nombre = p
        ? [p.nombres, p.apellidoPaterno, p.apellidoMaterno]
            .filter((x): x is string => !!x)
            .join(' ')
        : u.email;
      nombreUsuario.set(u.id, { nombre, rol: u.rol });
    }
    const nombreAdmin = new Map(admins.map((a) => [a.id, a.nombre]));

    const data: RegistroAuditoriaItem[] = filas.map((f) => {
      let actor: RegistroAuditoriaItem['actor'];
      if (f.usuarioId) {
        const info = nombreUsuario.get(f.usuarioId);
        actor = {
          id: f.usuarioId,
          tipo: 'USUARIO',
          nombre: info?.nombre ?? '—',
          rol: info?.rol ?? null,
        };
      } else {
        actor = {
          id: f.adminPlataformaId!,
          tipo: 'PLATAFORMA',
          nombre: nombreAdmin.get(f.adminPlataformaId!) ?? '—',
          rol: null,
        };
      }
      return {
        id: f.id,
        fecha: f.fecha.toISOString(),
        accion: f.accion,
        entidad: f.entidad,
        entidadId: f.entidadId,
        actor,
        sede: f.sede ? { id: f.sede.id, nombre: f.sede.nombre } : null,
        detalle: f.detalle ?? null,
      };
    });

    return { data, page, limit, total };
  }
}
