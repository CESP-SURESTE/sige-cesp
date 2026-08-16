import { randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { verifyPassword } from './password.util';
import { firmarPlatformAdminToken } from './platform-admin-jwt.util';

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
}
