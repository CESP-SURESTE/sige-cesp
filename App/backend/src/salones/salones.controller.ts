import { Controller, Get, UseGuards } from '@nestjs/common';
import { RolUsuario } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { SedeActual } from '../common/decorators/sede-actual.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { SedeGuard } from '../common/guards/sede.guard';
import { SalonesService } from './salones.service';

/**
 * `GET /salones` — Fase 9, Día 29 (gap de backend descubierto al planear la
 * UI de creación de grupos). Mismo patrón de guards que `CarrerasController`:
 * `SedeGuard` primero (invariante de composición de `RolesGuard`),
 * `@Roles(ADMINISTRATIVO)` por método, sin jerarquía de `nivelPermiso`
 * (mismo criterio que Carreras/Grupos). `sedeId` sale siempre de
 * `@SedeActual()`, nunca de query/body.
 */
@Controller('salones')
@UseGuards(SedeGuard, RolesGuard)
export class SalonesController {
  constructor(private readonly salonesService: SalonesService) {}

  @Get()
  @Roles(RolUsuario.ADMINISTRATIVO)
  async listar(@SedeActual() sedeId: string) {
    const data = await this.salonesService.listarPorSede(sedeId);
    return { data };
  }
}
