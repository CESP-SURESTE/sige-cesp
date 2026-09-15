import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RolUsuario } from '@prisma/client';
import { ActorUsuarioId } from '../common/decorators/actor-usuario-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SedeActual } from '../common/decorators/sede-actual.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { SedeGuard } from '../common/guards/sede.guard';
import { ActualizarSalonDto } from './dto/actualizar-salon.dto';
import { CrearSalonDto } from './dto/crear-salon.dto';
import { SalonesService } from './salones.service';

/**
 * `GET /salones` — Fase 9, Día 29 (gap de backend descubierto al planear la
 * UI de creación de grupos). `POST`/`PATCH`/`DELETE /salones` — completan el
 * CRUD (extiende Día 29). Mismo patrón de guards que `CarrerasController`:
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

  @Post()
  @HttpCode(201)
  @Roles(RolUsuario.ADMINISTRATIVO)
  async crear(
    @Body() body: CrearSalonDto,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    const data = await this.salonesService.crear(
      body,
      sedeId,
      actorUsuarioId,
    );
    return { data };
  }

  @Patch(':id')
  @Roles(RolUsuario.ADMINISTRATIVO)
  async actualizar(
    @Param('id') id: string,
    @Body() body: ActualizarSalonDto,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    const data = await this.salonesService.actualizar(
      id,
      body,
      sedeId,
      actorUsuarioId,
    );
    return { data };
  }

  @Delete(':id')
  @Roles(RolUsuario.ADMINISTRATIVO)
  async eliminar(
    @Param('id') id: string,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    const data = await this.salonesService.eliminar(
      id,
      sedeId,
      actorUsuarioId,
    );
    return { data };
  }
}
