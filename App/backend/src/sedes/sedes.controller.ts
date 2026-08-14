import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PlatformAdminActual } from '../common/decorators/platform-admin-actual.decorator';
import { SedeActual } from '../common/decorators/sede-actual.decorator';
import { PlatformAdminGuard } from '../common/guards/platform-admin.guard';
import { SedeGuard } from '../common/guards/sede.guard';
import { ActualizarSedeDto } from './dto/actualizar-sede.dto';
import { CrearSedeDto } from './dto/crear-sede.dto';
import { SedesService } from './sedes.service';

/**
 * `GET /sedes/:sedeId` — Fase 1, Día 6. Controller de prueba original del
 * `SedeGuard`, sin cambios de comportamiento.
 *
 * `POST/GET/PATCH /sedes` — Fase 6, Día 20. CRUD real, actor
 * `AdminPlataforma` (`PlatformAdminGuard`, ver nota de diseño en
 * `docs/roadmap.md`: crear una sede es una acción sin sede, no encaja en
 * `SedeGuard`). El guard se declara por MÉTODO, no a nivel de `@Controller`
 * — mezclar 2 actores en el mismo controller exige esto: si quedara
 * `@UseGuards(SedeGuard)` a nivel de clase, bloquearía silenciosamente las 3
 * rutas nuevas (esperan el JWT de plataforma, no el de Supabase).
 */
@Controller('sedes')
export class SedesController {
  constructor(private readonly sedesService: SedesService) {}

  @Get(':sedeId')
  @UseGuards(SedeGuard)
  async obtenerPorId(
    @Param('sedeId') sedeId: string,
    @SedeActual() sedeActual: string,
  ) {
    void sedeActual;
    const sede = await this.sedesService.obtenerPorId(sedeId);
    return { data: sede };
  }

  @Post()
  @HttpCode(201)
  @UseGuards(PlatformAdminGuard)
  async crear(
    @Body() body: CrearSedeDto,
    @PlatformAdminActual() actorId: string,
  ) {
    const data = await this.sedesService.crear(body, actorId);
    return { data };
  }

  @Get()
  @UseGuards(PlatformAdminGuard)
  async listar() {
    const data = await this.sedesService.listar();
    return { data };
  }

  @Patch(':id')
  @UseGuards(PlatformAdminGuard)
  async actualizar(
    @Param('id') id: string,
    @Body() body: ActualizarSedeDto,
    @PlatformAdminActual() actorId: string,
  ) {
    const data = await this.sedesService.actualizar(id, body, actorId);
    return { data };
  }
}
