import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { RolUsuario } from '@prisma/client';
import { PlatformAdminActual } from '../common/decorators/platform-admin-actual.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PlatformAdminGuard } from '../common/guards/platform-admin.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { SedeGuard } from '../common/guards/sede.guard';
import { ActualizarConfigSoporteDto } from './dto/actualizar-config-soporte.dto';
import { SoporteService } from './soporte.service';

/**
 * `SoporteController` — feature "Bot de soporte" (2026-09-24).
 *
 * Mezcla 2 actores distintos, igual que `SedesController`: guards por
 * MÉTODO, no a nivel de clase. `GET /soporte/config` lo consulta
 * ADMINISTRATIVO/MAESTRO (JWT de Supabase, `SedeGuard`+`RolesGuard`);
 * `PATCH /soporte/config` y las rutas de `/reportes` de gestión (Task 5)
 * son de `AdminPlataforma` (`PlatformAdminGuard`).
 */
@Controller('soporte')
export class SoporteController {
  constructor(protected readonly soporteService: SoporteService) {}

  @Get('config')
  @UseGuards(SedeGuard, RolesGuard)
  @Roles(RolUsuario.ADMINISTRATIVO, RolUsuario.MAESTRO)
  async obtenerConfig() {
    const data = await this.soporteService.obtenerConfig();
    return { data };
  }

  @Patch('config')
  @UseGuards(PlatformAdminGuard)
  async actualizarConfig(
    @Body() dto: ActualizarConfigSoporteDto,
    @PlatformAdminActual() adminId: string,
  ) {
    const data = await this.soporteService.actualizarConfig(
      dto.activo,
      adminId,
    );
    return { data };
  }
}
