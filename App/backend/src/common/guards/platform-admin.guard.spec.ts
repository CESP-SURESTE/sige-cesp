import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { firmarPlatformAdminToken } from '../../platform-admin/platform-admin-jwt.util';
import { PlatformAdminGuard } from './platform-admin.guard';

describe('PlatformAdminGuard (unit)', () => {
  beforeAll(() => {
    process.env.PLATFORM_ADMIN_JWT_SECRET =
      'secreto-de-prueba-solo-para-tests-1234567890';
  });

  function crearPrismaStub(findUniqueImpl: (...args: unknown[]) => unknown) {
    return {
      adminPlataforma: {
        findUnique: jest.fn(findUniqueImpl),
      },
    } as unknown as import('../../prisma/prisma.service').PrismaService;
  }

  function crearContexto(
    authHeader: string | undefined,
    prisma: import('../../prisma/prisma.service').PrismaService,
  ): {
    guard: PlatformAdminGuard;
    context: ExecutionContext;
    request: Request;
  } {
    const request = {
      headers: { authorization: authHeader },
    } as unknown as Request;
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    return { guard: new PlatformAdminGuard(prisma), context, request };
  }

  it('sin Authorization header -> 401 UnauthorizedException', async () => {
    const prisma = crearPrismaStub(() => null);
    const { guard, context } = crearContexto(undefined, prisma);

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('con token inválido -> 401 UnauthorizedException', async () => {
    const prisma = crearPrismaStub(() => null);
    const { guard, context } = crearContexto('Bearer token-invalido', prisma);

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('con token válido -> deja pasar y puebla request.platformAdminId', async () => {
    const token = await firmarPlatformAdminToken({
      sub: '11111111-1111-1111-1111-111111111111',
      email: 'plataforma.prueba@nexo-sd.mx',
    });
    const prisma = crearPrismaStub(() => ({
      id: '11111111-1111-1111-1111-111111111111',
      email: 'plataforma.prueba@nexo-sd.mx',
      passwordHash: 'hash',
      nombre: 'Admin de prueba',
      activo: true,
      createdAt: new Date(),
    }));
    const { guard, context, request } = crearContexto(
      `Bearer ${token}`,
      prisma,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.platformAdminId).toBe(
      '11111111-1111-1111-1111-111111111111',
    );
  });

  it('con token válido pero admin inactivo/no existe -> 401 UnauthorizedException', async () => {
    const token = await firmarPlatformAdminToken({
      sub: '22222222-2222-2222-2222-222222222222',
      email: 'plataforma.inactivo@nexo-sd.mx',
    });

    const prismaNoExiste = crearPrismaStub(() => null);
    const { guard: guardNoExiste, context: contextNoExiste } = crearContexto(
      `Bearer ${token}`,
      prismaNoExiste,
    );
    await expect(guardNoExiste.canActivate(contextNoExiste)).rejects.toThrow(
      UnauthorizedException,
    );

    const prismaInactivo = crearPrismaStub(() => ({
      id: '22222222-2222-2222-2222-222222222222',
      email: 'plataforma.inactivo@nexo-sd.mx',
      passwordHash: 'hash',
      nombre: 'Admin inactivo',
      activo: false,
      createdAt: new Date(),
    }));
    const { guard: guardInactivo, context: contextInactivo } = crearContexto(
      `Bearer ${token}`,
      prismaInactivo,
    );
    await expect(guardInactivo.canActivate(contextInactivo)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
