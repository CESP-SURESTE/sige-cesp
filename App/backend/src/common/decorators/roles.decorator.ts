import { SetMetadata } from '@nestjs/common';
import { RolUsuario } from '@prisma/client';

/**
 * Key de metadata bajo la que `Roles(...)` guarda la lista de roles
 * permitidos de una ruta — `RolesGuard` la lee con `Reflector`.
 */
export const ROLES_KEY = 'roles';

/**
 * Decorator de ruta — Fase 2, Día 8.
 *
 * Declara qué roles (`RolUsuario`, el enum real de Prisma: `ALUMNO` |
 * `MAESTRO` | `ADMINISTRATIVO`) pueden acceder a un handler o controller.
 * Solo declara metadata; quien la aplica es `RolesGuard`
 * (`src/common/guards/roles.guard.ts`) — ver el JSDoc de ese guard para el
 * invariante de composición con `SedeGuard`.
 *
 * ```ts
 * @Get()
 * @UseGuards(SedeGuard, RolesGuard)
 * @Roles(RolUsuario.ADMINISTRATIVO, RolUsuario.MAESTRO)
 * listar() { ... }
 * ```
 *
 * Tipado contra el enum real a propósito — un string suelto sin tipar (ej.
 * `'admin'`) nunca haría match contra el claim `rol` del JWT (que usa los
 * valores exactos del enum) y sería un bug silencioso.
 */
export const Roles = (...roles: RolUsuario[]) => SetMetadata(ROLES_KEY, roles);
