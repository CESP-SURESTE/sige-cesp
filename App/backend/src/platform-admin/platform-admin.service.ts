import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { verifyPassword } from './password.util';
import { firmarPlatformAdminToken } from './platform-admin-jwt.util';

@Injectable()
export class PlatformAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async login(email: string, password: string): Promise<{ token: string }> {
    const admin = await this.prisma.adminPlataforma.findUnique({
      where: { email },
    });

    // Mismo mensaje/código exista o no el email — no revelar cuál de los 2
    // datos falló (mismo criterio que el resto de la API).
    if (!admin || !admin.activo) {
      throw new UnauthorizedException({
        error: 'Correo o contraseña incorrectos',
        code: 'UNAUTHORIZED',
      });
    }

    const passwordValida = await verifyPassword(password, admin.passwordHash);
    if (!passwordValida) {
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
