import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
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
import { EmergenciaService } from './emergencia.service';
import type { TipoExpediente } from './emergencia.service';
import { BuscarEmergenciaQueryDto } from './dto/buscar-emergencia.query.dto';
import { CrearTelefonoDto } from './dto/crear-telefono.dto';
import { ActualizarTelefonoDto } from './dto/actualizar-telefono.dto';

const TIPOS_EXPEDIENTE: readonly TipoExpediente[] = [
  'ALUMNO',
  'MAESTRO',
  'ADMINISTRATIVO',
  'PERSONAL_SERVICIOS',
];

/**
 * Módulo de emergencia (2026-09-08). Mismo patrón de guards que
 * `SalonesController`: `SedeGuard` primero (invariante de composición de
 * `RolesGuard`), `@Roles(ADMINISTRATIVO)` por método, sin jerarquía de
 * `nivelPermiso`. `sedeId` sale siempre de `@SedeActual()`, nunca de
 * query/body. La Task 3 suma el buscador y el expediente a este mismo
 * controller.
 */
@Controller('emergencia')
@UseGuards(SedeGuard, RolesGuard)
export class EmergenciaController {
  constructor(private readonly emergenciaService: EmergenciaService) {}

  @Get('telefonos')
  @Roles(RolUsuario.ADMINISTRATIVO)
  async listarTelefonos(@SedeActual() sedeId: string) {
    const data = await this.emergenciaService.listarTelefonos(sedeId);
    return { data };
  }

  @Post('telefonos')
  @HttpCode(201)
  @Roles(RolUsuario.ADMINISTRATIVO)
  async crearTelefono(
    @Body() body: CrearTelefonoDto,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    const data = await this.emergenciaService.crearTelefono(
      body,
      sedeId,
      actorUsuarioId,
    );
    return { data };
  }

  @Patch('telefonos/:id')
  @Roles(RolUsuario.ADMINISTRATIVO)
  async actualizarTelefono(
    @Param('id') id: string,
    @Body() body: ActualizarTelefonoDto,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    const data = await this.emergenciaService.actualizarTelefono(
      id,
      body,
      sedeId,
      actorUsuarioId,
    );
    return { data };
  }

  @Delete('telefonos/:id')
  @Roles(RolUsuario.ADMINISTRATIVO)
  async eliminarTelefono(
    @Param('id') id: string,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    const data = await this.emergenciaService.eliminarTelefono(
      id,
      sedeId,
      actorUsuarioId,
    );
    return { data };
  }

  @Get('buscar')
  @Roles(RolUsuario.ADMINISTRATIVO)
  async buscar(
    @Query() query: BuscarEmergenciaQueryDto,
    @SedeActual() sedeId: string,
  ) {
    const data = await this.emergenciaService.buscar(
      sedeId,
      query.q,
      query.limit ?? 20,
    );
    return { data };
  }

  @Get('expediente/:tipo/:perfilId')
  @Roles(RolUsuario.ADMINISTRATIVO)
  async expediente(
    @Param('tipo') tipo: string,
    @Param('perfilId') perfilId: string,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    if (!TIPOS_EXPEDIENTE.includes(tipo as TipoExpediente)) {
      throw new BadRequestException({
        error: 'tipo debe ser ALUMNO, MAESTRO, ADMINISTRATIVO o PERSONAL_SERVICIOS',
        code: 'VALIDATION_ERROR',
      });
    }
    const data = await this.emergenciaService.obtenerExpediente(
      tipo as TipoExpediente,
      perfilId,
      actorUsuarioId,
      sedeId,
    );
    return { data };
  }
}
