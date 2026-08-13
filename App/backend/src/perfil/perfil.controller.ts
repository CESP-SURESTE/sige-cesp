import { Controller, Get, UseGuards } from '@nestjs/common';
import { ActorUsuarioId } from '../common/decorators/actor-usuario-id.decorator';
import { SedeGuard } from '../common/guards/sede.guard';
import { PerfilService } from './perfil.service';

/**
 * `GET /perfil` — Fase 5, Día 16.
 *
 * Solo `SedeGuard` — sin `RolesGuard` — mismo criterio que
 * `PATCH /auth/cambiar-password` (Día 12): cualquier rol autenticado
 * consulta su propio perfil, no es una acción restringida a `ADMINISTRATIVO`
 * ni a ningún rol en particular.
 *
 * El `usuarioId` a consultar sale exclusivamente de `@ActorUsuarioId()`
 * (JWT `sub`, ver `PerfilService.obtenerPerfilPropio`) — no hay `:id` ni
 * query param por el que se pueda pedir el perfil de otra persona.
 */
@Controller('perfil')
@UseGuards(SedeGuard)
export class PerfilController {
  constructor(private readonly perfilService: PerfilService) {}

  @Get()
  async obtenerPropio(@ActorUsuarioId() actorUsuarioId: string) {
    const data = await this.perfilService.obtenerPerfilPropio(actorUsuarioId);
    return { data };
  }
}
