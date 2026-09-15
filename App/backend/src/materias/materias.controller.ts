import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RolUsuario } from '@prisma/client';
import { ActorUsuarioId } from '../common/decorators/actor-usuario-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SedeActual } from '../common/decorators/sede-actual.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { SedeGuard } from '../common/guards/sede.guard';
import { CrearMateriaDto } from './dto/crear-materia.dto';
import { ListarMateriasQueryDto } from './dto/listar-materias.query.dto';
import { MateriasService } from './materias.service';

/**
 * `GET/POST /materias` — Fase 12, Día 33. Bootstrap de la entidad `Materia`
 * (existía en el schema desde el Día 2, sin código). Mismo patrón de guards
 * que `CarrerasController`: `SedeGuard` primero, `@Roles(ADMINISTRATIVO)`
 * por método, sin jerarquía de `nivelPermiso`. `sedeId` siempre de
 * `@SedeActual()`. Sin `GET /materias/:id` / `PATCH` / `DELETE` (diferidos,
 * mismo criterio que Carreras).
 */
@Controller('materias')
@UseGuards(SedeGuard, RolesGuard)
export class MateriasController {
  constructor(private readonly materiasService: MateriasService) {}

  @Get()
  @Roles(RolUsuario.ADMINISTRATIVO)
  async listar(
    @Query() query: ListarMateriasQueryDto,
    @SedeActual() sedeId: string,
  ) {
    const data = await this.materiasService.listar(
      query.carreraId,
      query.ciclo,
      sedeId,
    );
    return { data };
  }

  @Post()
  @HttpCode(201)
  @Roles(RolUsuario.ADMINISTRATIVO)
  async crear(
    @Body() body: CrearMateriaDto,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    const data = await this.materiasService.crear(body, sedeId, actorUsuarioId);
    return { data };
  }
}
