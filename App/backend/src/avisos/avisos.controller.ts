import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
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
import { ListarAvisosQueryDto } from './dto/listar-avisos.query.dto';
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

  /**
   * `GET /avisos` — feed del actor. Sin `@Roles`: los 3 roles leen sus
   * propios avisos (mismo criterio que `GET /perfil` / `GET /notificaciones`).
   * `feedDelActor` ya devuelve `{ data, page, limit, total }` — no re-envolver.
   */
  @Get()
  async feed(
    @Query() query: ListarAvisosQueryDto,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    return this.avisosService.feedDelActor(
      actorUsuarioId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  /**
   * `GET /avisos/:id/recibos` — reporte de recibos de lectura. Declarado
   * ANTES de `GET /avisos/:id` (convención específico→genérico del repo,
   * ver `GET /eventos/listado` antes de `GET /eventos`). Sin `@Roles`: la
   * autorización fina (autor o `ADMINISTRATIVO` de la sede del aviso) la
   * hace `verificarPuedeGestionar` en el service — un ALUMNO/MAESTRO
   * no-autor sale con 403 `ROL_NO_AUTORIZADO`.
   */
  @Get(':id/recibos')
  async recibos(
    @Param('id') id: string,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
    @Req() req: Request,
  ) {
    const rol = req.jwtClaims?.['rol'] as RolUsuario;
    const data = await this.avisosService.obtenerRecibos(id, {
      usuarioId: actorUsuarioId,
      rol,
      sedeId,
    });
    return { data };
  }

  /**
   * `GET /avisos/:id` — detalle del aviso + marca la `Notificacion` del
   * actor como leída (recibo). 404 si el actor no era destinatario.
   */
  @Get(':id')
  async detalle(
    @Param('id') id: string,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    const data = await this.avisosService.verDetalleYMarcarLeido(
      id,
      actorUsuarioId,
    );
    return { data };
  }

  /**
   * `DELETE /avisos/:id` — borrado real del `Aviso` + sus `Notificacion`.
   * `@Roles(ADMINISTRATIVO, MAESTRO)` (un ALUMNO ni entra); el service
   * exige además autor o `ADMINISTRATIVO` de la sede. Otra sede → 404.
   */
  @Delete(':id')
  @Roles(RolUsuario.ADMINISTRATIVO, RolUsuario.MAESTRO)
  async eliminar(
    @Param('id') id: string,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
    @Req() req: Request,
  ) {
    const rol = req.jwtClaims?.['rol'] as RolUsuario;
    const data = await this.avisosService.eliminar(id, {
      usuarioId: actorUsuarioId,
      rol,
      sedeId,
    });
    return { data };
  }
}
