import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ActorUsuarioId } from '../common/decorators/actor-usuario-id.decorator';
import { SedeGuard } from '../common/guards/sede.guard';
import { ListarNotificacionesQueryDto } from './dto/listar-notificaciones.query.dto';
import { NotificacionesService } from './notificaciones.service';

/**
 * `GET /notificaciones`, `GET /notificaciones/conteo-no-leidas`,
 * `PATCH /notificaciones/:id/leido` — Fase 14, Día 38.
 *
 * Solo `SedeGuard` (sin `RolesGuard`) — cualquier rol autenticado ve/gestiona
 * SUS notificaciones, mismo criterio que `GET /perfil`. El actor sale de
 * `@ActorUsuarioId()`, nunca de la ruta. `conteo-no-leidas` se declara como
 * segmento fijo ANTES de cualquier futura ruta con `:id` (hoy no hay `GET
 * /:id`, pero se respeta el orden por si se agrega).
 */
@Controller('notificaciones')
@UseGuards(SedeGuard)
export class NotificacionesController {
  constructor(private readonly notificacionesService: NotificacionesService) {}

  @Get()
  async listar(
    @Query() query: ListarNotificacionesQueryDto,
    @ActorUsuarioId() usuarioId: string,
  ) {
    return this.notificacionesService.listar(
      usuarioId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  @Get('conteo-no-leidas')
  async conteoNoLeidas(@ActorUsuarioId() usuarioId: string) {
    const data = await this.notificacionesService.contarNoLeidas(usuarioId);
    return { data };
  }

  @Patch(':id/leido')
  async marcarLeida(
    @Param('id') id: string,
    @ActorUsuarioId() usuarioId: string,
  ) {
    const data = await this.notificacionesService.marcarLeida(id, usuarioId);
    return { data };
  }
}
