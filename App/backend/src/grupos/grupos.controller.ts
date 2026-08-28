import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
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
import { CrearGrupoDto } from './dto/crear-grupo.dto';
import { ListarGruposQueryDto } from './dto/listar-grupos.query.dto';
import { MatricularAlumnoDto } from './dto/matricular-alumno.dto';
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

  @Get()
  @Roles(RolUsuario.ADMINISTRATIVO)
  async listar(
    @Query() query: ListarGruposQueryDto,
    @SedeActual() sedeId: string,
  ) {
    return this.gruposService.listar(query, sedeId);
  }

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

  @Delete(':id')
  @Roles(RolUsuario.ADMINISTRATIVO)
  async eliminar(
    @Param('id') id: string,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    const data = await this.gruposService.eliminar(id, sedeId, actorUsuarioId);
    return { data };
  }

  @Get(':id/alumnos')
  @Roles(RolUsuario.ADMINISTRATIVO)
  async listarAlumnos(
    @Param('id') id: string,
    @SedeActual() sedeId: string,
  ) {
    const data = await this.gruposService.listarAlumnos(id, sedeId);
    return { data };
  }

  // Si en el futuro se agrega un segmento fijo bajo /grupos (p. ej. GET /grupos/resumen, como GET /personas/resumen), DEBE declararse ANTES de este @Get(':id') dinámico.
  @Get(':id')
  @Roles(RolUsuario.ADMINISTRATIVO)
  async obtener(@Param('id') id: string, @SedeActual() sedeId: string) {
    const data = await this.gruposService.obtenerPorId(id, sedeId);
    return { data };
  }

  @Post(':id/alumnos')
  @HttpCode(201)
  @Roles(RolUsuario.ADMINISTRATIVO)
  async matricular(
    @Param('id') id: string,
    @Body() body: MatricularAlumnoDto,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    const data = await this.gruposService.matricular(
      id,
      body.usuarioId,
      sedeId,
      actorUsuarioId,
    );
    return { data };
  }

  @Delete(':id/alumnos/:usuarioId')
  @Roles(RolUsuario.ADMINISTRATIVO)
  async desmatricular(
    @Param('id') id: string,
    @Param('usuarioId') usuarioId: string,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    const data = await this.gruposService.desmatricular(
      id,
      usuarioId,
      sedeId,
      actorUsuarioId,
    );
    return { data };
  }
}
