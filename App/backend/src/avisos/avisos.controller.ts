import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { RolUsuario } from '@prisma/client';
import { ActorUsuarioId } from '../common/decorators/actor-usuario-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SedeActual } from '../common/decorators/sede-actual.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { SedeGuard } from '../common/guards/sede.guard';
import { CrearAvisoDto } from './dto/crear-aviso.dto';
import { AvisosService } from './avisos.service';

/**
 * Avisos — Fase 16. `SedeGuard` (clase) + `RolesGuard`; `@Roles` por
 * método. `sedeId` de `@SedeActual()`, `rol` de `req.jwtClaims['rol']`
 * (mismo patrón que `CalendarioController` — no hay decorator `@ActorRol()`
 * en el repo).
 */
@Controller('avisos')
@UseGuards(SedeGuard, RolesGuard)
export class AvisosController {
  constructor(private readonly avisosService: AvisosService) {}

  @Post()
  @HttpCode(201)
  @Roles(RolUsuario.ADMINISTRATIVO, RolUsuario.MAESTRO)
  async publicar(
    @Body() body: CrearAvisoDto,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
    @Req() req: Request,
  ) {
    const rol = req.jwtClaims?.['rol'] as RolUsuario;
    const data = await this.avisosService.publicar(body, {
      usuarioId: actorUsuarioId,
      rol,
      sedeId,
    });
    return { data };
  }
}
