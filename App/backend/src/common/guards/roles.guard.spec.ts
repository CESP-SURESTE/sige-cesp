import { ExecutionContext, InternalServerErrorException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RolUsuario } from '@prisma/client';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Test unitario — Fase 2, Día 8.
 *
 * Complementa `test/roles-guard.e2e-spec.ts` (que cubre rol correcto/
 * incorrecto y el guard mal compuesto contra la app real) con el caso que no
 * tiene una ruta natural en `PruebaRolesController`: una ruta SIN
 * `@Roles(...)` declarado, donde el guard debe dejar pasar sin restringir
 * nada (comportamiento estándar de Nest para guards basados en metadata
 * opcional).
 */
describe('RolesGuard (unit)', () => {
  function crearContexto(
    rolesMetadata: RolUsuario[] | undefined,
    jwtClaims: Record<string, unknown> | undefined,
  ): { guard: RolesGuard; context: ExecutionContext } {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(rolesMetadata);

    const request = { jwtClaims } as unknown as Request;
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;

    return { guard: new RolesGuard(reflector), context };
  }

  it('ruta sin @Roles(...) -> deja pasar sin restricción de rol', () => {
    const { guard, context } = crearContexto(undefined, undefined);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('ruta con @Roles([]) (metadata vacía) -> también deja pasar', () => {
    const { guard, context } = crearContexto([], undefined);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('lee ROLES_KEY vía Reflector.getAllAndOverride sobre handler y clase', () => {
    const reflector = new Reflector();
    const spy = jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([RolUsuario.ADMINISTRATIVO]);
    const request = {
      jwtClaims: { rol: 'ADMINISTRATIVO' },
    } as unknown as Request;
    const handler = {};
    const klass = {};
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => klass,
    } as unknown as ExecutionContext;

    new RolesGuard(reflector).canActivate(context);

    expect(spy).toHaveBeenCalledWith(ROLES_KEY, [handler, klass]);
  });

  it('sin request.jwtClaims (SedeGuard no corrió antes) -> 500 InternalServerErrorException', () => {
    const { guard, context } = crearContexto(
      [RolUsuario.ADMINISTRATIVO],
      undefined,
    );

    expect(() => guard.canActivate(context)).toThrow(
      InternalServerErrorException,
    );
  });
});
