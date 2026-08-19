import { randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { RolUsuario } from '@prisma/client';
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
}
