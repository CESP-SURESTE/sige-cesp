import { Controller, Get, UseGuards } from '@nestjs/common';
import { RolUsuario } from '@prisma/client';
import { ActorUsuarioId } from '../common/decorators/actor-usuario-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { SedeGuard } from '../common/guards/sede.guard';
import { MallaCurricularService } from '../malla-curricular/malla-curricular.service';
import { PerfilService } from './perfil.service';

/**
 * `GET /perfil` — Fase 5, Día 16.
 *
 * Solo `SedeGuard` de clase — sin `RolesGuard` a nivel de clase — mismo
 * criterio que `PATCH /auth/cambiar-password` (Día 12): cualquier rol
 * autenticado consulta su propio perfil, no es una acción restringida a
 * `ADMINISTRATIVO` ni a ningún rol en particular.
 *
 * El `usuarioId` a consultar sale exclusivamente de `@ActorUsuarioId()`
 * (JWT `sub`, ver `PerfilService.obtenerPerfilPropio`) — no hay `:id` ni
 * query param por el que se pueda pedir el perfil de otra persona.
 *
 * `GET /perfil/malla` (Fase 7, Día 24) es la excepción — sí restringida a
 * `ALUMNO`, `RolesGuard` declarado a nivel de MÉTODO (no de clase, para no
 * afectar `GET /perfil`), mismo criterio de composición de guards que
 * `SedesController` (Día 20: guard declarado por método cuando la clase
 * sirve rutas con requisitos distintos).
 */
@Controller('perfil')
@UseGuards(SedeGuard)
export class PerfilController {
  constructor(
    private readonly perfilService: PerfilService,
    private readonly mallaCurricularService: MallaCurricularService,
  ) {}

  @Get()
  async obtenerPropio(@ActorUsuarioId() actorUsuarioId: string) {
    const data = await this.perfilService.obtenerPerfilPropio(actorUsuarioId);
    return { data };
  }

  @Get('malla')
  @UseGuards(RolesGuard)
  @Roles(RolUsuario.ALUMNO)
  async obtenerUrlDescargaMalla(@ActorUsuarioId() actorUsuarioId: string) {
    const data =
      await this.mallaCurricularService.obtenerUrlDescargaPropia(actorUsuarioId);
    return { data };
  }
}
