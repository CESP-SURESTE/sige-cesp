import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { firmarPlatformAdminToken } from '../../platform-admin/platform-admin-jwt.util';
import { PlatformAdminGuard } from './platform-admin.guard';

describe('PlatformAdminGuard (unit)', () => {
  beforeAll(() => {
    process.env.PLATFORM_ADMIN_JWT_SECRET =
      'secreto-de-prueba-solo-para-tests-1234567890';
  });

  function crearContexto(authHeader: string | undefined): {
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

    return { guard: new PlatformAdminGuard(), context, request };
  }

  it('sin Authorization header -> 401 UnauthorizedException', async () => {
    const { guard, context } = crearContexto(undefined);

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('con token inválido -> 401 UnauthorizedException', async () => {
    const { guard, context } = crearContexto('Bearer token-invalido');

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('con token válido -> deja pasar y puebla request.platformAdminId', async () => {
    const token = await firmarPlatformAdminToken({
      sub: '11111111-1111-1111-1111-111111111111',
      email: 'plataforma.prueba@nexo-sd.mx',
    });
    const { guard, context, request } = crearContexto(`Bearer ${token}`);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.platformAdminId).toBe(
      '11111111-1111-1111-1111-111111111111',
    );
  });
});
