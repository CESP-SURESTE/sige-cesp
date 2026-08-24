import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { RolUsuario } from '@prisma/client';
import { ActorUsuarioId } from '../common/decorators/actor-usuario-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SedeActual } from '../common/decorators/sede-actual.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { SedeGuard } from '../common/guards/sede.guard';
import { CrearGrupoDto } from './dto/crear-grupo.dto';
import { GruposService } from './grupos.service';

/**
 * `POST /grupos` — Fase 9, Día 28. Mismo patrón de guards que
 * `CarrerasController`: `SedeGuard` primero (invariante de composición de
 * `RolesGuard`), `@Roles(ADMINISTRATIVO)` por método, sin jerarquía de
 * `nivelPermiso` (decisión explícita, mismo criterio que Carreras).
 * `sedeId` sale siempre de `@SedeActual()`, nunca del body.
 */
@Controller('grupos')
@UseGuards(SedeGuard, RolesGuard)
export class GruposController {
  constructor(private readonly gruposService: GruposService) {}

  @Post()
  @HttpCode(201)
  @Roles(RolUsuario.ADMINISTRATIVO)
  async crear(
    @Body() body: CrearGrupoDto,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    const data = await this.gruposService.crear(body, sedeId, actorUsuarioId);
    return { data };
  }
}
