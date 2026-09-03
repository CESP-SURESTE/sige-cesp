import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
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
import { CalendarioService } from './calendario.service';
import { ActualizarEventoDto } from './dto/actualizar-evento.dto';
import { CrearEventoDto } from './dto/crear-evento.dto';
import { ListarEventosListadoQueryDto } from './dto/listar-eventos-listado.query.dto';
import { ListarEventosQueryDto } from './dto/listar-eventos.query.dto';

/**
 * `POST/PATCH/DELETE /eventos` (Fase 15, Día 41) — solo
 * `ADMINISTRATIVO`/`MAESTRO` (`ALUMNO` siempre 403, `@Roles` a nivel de
 * método). `GET /eventos` — los 3 roles, sin `@Roles` (mismo criterio que
 * `GET /perfil`: `RolesGuard` deja pasar sin restringir si la ruta no
 * declara `@Roles`).
 *
 * El `rol` del actor sale de `request.jwtClaims['rol']` — no existe un
 * decorator `@ActorRol()` en el repo (se buscó en
 * `src/common/decorators/`, solo están `@ActorUsuarioId()`, `@SedeActual()`,
 * `@Roles()`, `@ActorEmail()`, `@PlatformAdminActual()`); se lee directo
 * del `Request` con el MISMO patrón que ya usa `RolesGuard`
 * (`request.jwtClaims?.['rol']`, ver `src/common/guards/roles.guard.ts`).
 * Es seguro sin chequeo adicional de tipo/presencia en `POST`/`PATCH`/
 * `DELETE` porque `RolesGuard` ya corrió antes con `@Roles(...)` y
 * garantiza que el claim es un string no vacío perteneciente a
 * `RolUsuario`; en `GET` (sin `@Roles`) no hay esa garantía explícita,
 * pero `SedeGuard` ya verificó el JWT y el Auth Hook siempre emite `rol`
 * para cualquier usuario con fila en `usuarios` — mismo criterio de
 * confianza que el resto de esta ruta.
 */
@Controller('eventos')
@UseGuards(SedeGuard, RolesGuard)
export class CalendarioController {
  constructor(private readonly calendarioService: CalendarioService) {}

  @Post()
  @HttpCode(201)
  @Roles(RolUsuario.ADMINISTRATIVO, RolUsuario.MAESTRO)
  async crear(
    @Body() body: CrearEventoDto,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
    @Req() req: Request,
  ) {
    const rol = req.jwtClaims?.['rol'] as RolUsuario;
    const data = await this.calendarioService.crear(body, {
      usuarioId: actorUsuarioId,
      rol,
      sedeId,
    });
    return { data };
  }

  /**
   * `GET /eventos/listado` — Fase 15 polish (2026-09-02). Declarado ANTES
   * del `@Get()` raíz a propósito: `listado` como segmento fijo debe
   * resolverse antes que el handler de la raíz. Solo `ADMINISTRATIVO`
   * (`@Roles` a nivel de método) — vista de gestión, un row por evento
   * base. El service ya devuelve la forma final `{ data, page, limit,
   * total }`, no se re-envuelve.
   */
  @Get('listado')
  @Roles(RolUsuario.ADMINISTRATIVO)
  async listarParaGestion(
    @SedeActual() sedeId: string,
    @Query() query: ListarEventosListadoQueryDto,
  ) {
    return this.calendarioService.listarParaGestion(sedeId, query);
  }

  @Get()
  async listar(
    @Query() query: ListarEventosQueryDto,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
    @Req() req: Request,
  ) {
    const rol = req.jwtClaims?.['rol'] as RolUsuario;
    const data = await this.calendarioService.listar(query.desde, query.hasta, {
      usuarioId: actorUsuarioId,
      rol,
      sedeId,
    });
    return { data };
  }

  @Patch(':id')
  @Roles(RolUsuario.ADMINISTRATIVO, RolUsuario.MAESTRO)
  async actualizar(
    @Param('id') id: string,
    @Body() body: ActualizarEventoDto,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
    @Req() req: Request,
  ) {
    const rol = req.jwtClaims?.['rol'] as RolUsuario;
    const data = await this.calendarioService.actualizar(id, body, {
      usuarioId: actorUsuarioId,
      rol,
      sedeId,
    });
    return { data };
  }

  @Delete(':id')
  @Roles(RolUsuario.ADMINISTRATIVO, RolUsuario.MAESTRO)
  async eliminar(
    @Param('id') id: string,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
    @Req() req: Request,
  ) {
    const rol = req.jwtClaims?.['rol'] as RolUsuario;
    const data = await this.calendarioService.eliminar(id, {
      usuarioId: actorUsuarioId,
      rol,
      sedeId,
    });
    return { data };
  }
}
