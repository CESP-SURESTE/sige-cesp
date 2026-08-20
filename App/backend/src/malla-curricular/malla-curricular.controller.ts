import { Controller, HttpCode, HttpStatus, Param, Post, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RolUsuario } from '@prisma/client';
import { ActorUsuarioId } from '../common/decorators/actor-usuario-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SedeActual } from '../common/decorators/sede-actual.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { SedeGuard } from '../common/guards/sede.guard';
import { MallaCurricularService } from './malla-curricular.service';

const CINCO_MB = 5 * 1024 * 1024;

/**
 * `POST /carreras/:id/malla` — Fase 7, Día 23. Sub-recurso de `Carrera`
 * (regla 4 de `CLAUDE.md` raíz), mismo patrón de guards que
 * `CarrerasController` (`SedeGuard` primero, invariante de composición de
 * `RolesGuard`). `sedeId` siempre de `@SedeActual()`, nunca de body/param.
 */
@Controller('carreras')
@UseGuards(SedeGuard, RolesGuard)
export class MallaCurricularController {
  constructor(private readonly mallaCurricularService: MallaCurricularService) {}

  @Post(':id/malla')
  @HttpCode(HttpStatus.OK)
  @Roles(RolUsuario.ADMINISTRATIVO)
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: CINCO_MB } }))
  async subir(
    @Param('id') id: string,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const data = await this.mallaCurricularService.subir(id, sedeId, actorUsuarioId, file);
    return { data };
  }
}
