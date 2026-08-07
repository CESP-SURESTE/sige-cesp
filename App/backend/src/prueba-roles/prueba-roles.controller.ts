import { Controller, Get, UseGuards } from '@nestjs/common';
import { RolUsuario } from '@prisma/client';
import { SedeGuard } from '../common/guards/sede.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

/**
 * Controller de prueba para el `RolesGuard` — Fase 2, Día 8.
 *
 * Mismo espíritu que `SedesController` (Fase 1, Día 6): existe únicamente
 * para demostrar, de punta a punta, que `RolesGuard` deja pasar al rol
 * correcto y rechaza con 403 `ROL_NO_AUTORIZADO` a los demás — no tiene
 * lógica de negocio real.
 *
 * Vive en su propio controller (en vez de agregarse a `SedesController`)
 * porque necesita una ruta con `RolesGuard` SIN `SedeGuard` antes (para
 * probar el 500 explícito del guard mal compuesto) — `SedesController` tiene
 * `SedeGuard` a nivel de clase, aplicado a todas sus rutas, así que no sirve
 * para ese caso.
 */
@Controller('prueba-roles')
export class PruebaRolesController {
  /**
   * Caso feliz: `SedeGuard` corre primero (deja `request.jwtClaims`
   * poblado), luego `RolesGuard` valida el claim `rol` contra
   * `@Roles(RolUsuario.ADMINISTRATIVO)`. Devuelve 200 solo para
   * `ADMINISTRATIVO`; 403 `ROL_NO_AUTORIZADO` para `ALUMNO`/`MAESTRO`.
   */
  @Get('solo-administrativo')
  @UseGuards(SedeGuard, RolesGuard)
  @Roles(RolUsuario.ADMINISTRATIVO)
  soloAdministrativo() {
    return { data: { ok: true } };
  }

  /**
   * Caso de guard mal compuesto (solo para test): aplica `RolesGuard` SIN
   * `SedeGuard` antes, a propósito — `request.jwtClaims` nunca se llena, así
   * que `RolesGuard` debe reventar con 500 `SERVER_ERROR` explícito, nunca
   * con un 403 ni un passthrough silencioso. Ver invariante documentado en
   * `roles.guard.ts`.
   */
  @Get('guard-mal-compuesto')
  @UseGuards(RolesGuard)
  @Roles(RolUsuario.ADMINISTRATIVO)
  guardMalCompuesto() {
    return { data: { ok: true } };
  }
}
