import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RolUsuario } from '@prisma/client';
import { ActorUsuarioId } from '../common/decorators/actor-usuario-id.decorator';
import { PlatformAdminActual } from '../common/decorators/platform-admin-actual.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SedeActual } from '../common/decorators/sede-actual.decorator';
import { PlatformAdminGuard } from '../common/guards/platform-admin.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { SedeGuard } from '../common/guards/sede.guard';
import { ArchivoCapturaInvalidaFilter } from './archivo-captura-invalida.filter';
import { ActualizarConfigSoporteDto } from './dto/actualizar-config-soporte.dto';
import { CambiarEstatusReporteBugDto } from './dto/cambiar-estatus-reporte-bug.dto';
import { CrearReporteBugDto } from './dto/crear-reporte-bug.dto';
import { ListarReportesBugQueryDto } from './dto/listar-reportes-bug.query.dto';
import { SoporteService } from './soporte.service';

const TRES_MB = 3 * 1024 * 1024;

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

  @Post('reportes')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SedeGuard, RolesGuard)
  @Roles(RolUsuario.ADMINISTRATIVO, RolUsuario.MAESTRO)
  @UseInterceptors(
    FileInterceptor('captura', { limits: { fileSize: TRES_MB } }),
  )
  @UseFilters(ArchivoCapturaInvalidaFilter)
  async crearReporte(
    @Body() dto: CrearReporteBugDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() usuarioId: string,
  ) {
    const data = await this.soporteService.crearReporte(
      sedeId,
      usuarioId,
      dto.descripcion,
      file,
    );
    return { data };
  }

  @Get('reportes')
  @UseGuards(PlatformAdminGuard)
  async listarReportes(@Query() query: ListarReportesBugQueryDto) {
    return this.soporteService.listarReportes(
      query.estatus,
      query.page,
      query.limit,
    );
  }

  @Patch('reportes/:id/estatus')
  @UseGuards(PlatformAdminGuard)
  async cambiarEstatus(
    @Param('id') id: string,
    @Body() dto: CambiarEstatusReporteBugDto,
    @PlatformAdminActual() adminId: string,
  ) {
    const data = await this.soporteService.cambiarEstatus(
      id,
      dto.estatus,
      adminId,
    );
    return { data };
  }
}
