import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RolUsuario } from '@prisma/client';
import { ActorUsuarioId } from '../common/decorators/actor-usuario-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SedeActual } from '../common/decorators/sede-actual.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { SedeGuard } from '../common/guards/sede.guard';
import { CarrerasService } from './carreras.service';
import { ActualizarCarreraDto } from './dto/actualizar-carrera.dto';
import { CrearCarreraDto } from './dto/crear-carrera.dto';

/**
 * `GET /carreras` — nació MÍNIMO en Día 14 (`{ id, nombre, clave }`) para
 * desbloquear el dropdown de `carreraId` del formulario de alta de alumno
 * (`POST /personas`, Día 11). Extendido en Día 21 al objeto `Carrera`
 * completo — la pantalla de gestión de carreras del admin (`app/admin/
 * carreras/`) necesita todos los campos para tabla + prellenar edición; sin
 * `GET /carreras/:id` (fuera de alcance de hoy), esta lista es la única
 * fuente de datos completos. El dropdown de alta de alumno sigue
 * funcionando igual, solo lee 3 campos del objeto e ignora el resto.
 *
 * `POST`/`PATCH /carreras` — Fase 6, Día 21: CRUD real de `Carrera`.
 * `DELETE /carreras/:id` y `GET /carreras/:id` quedan fuera de alcance
 * explícito de hoy (mismo criterio que `DELETE /sedes` en Día 20 —
 * deferido, ver `docs/roadmap.md`).
 *
 * Mismo patrón de guards que `PersonasController`: `@UseGuards(SedeGuard,
 * RolesGuard)` con `SedeGuard` primero (invariante de composición de
 * `RolesGuard`, ver `roles.guard.ts`) a nivel de `@Controller`, y
 * `@Roles(ADMINISTRATIVO)` en los 3 métodos. A diferencia de `POST
 * /personas` con `rol: ADMINISTRATIVO`, acá NO aplica la jerarquía de
 * `nivelPermiso` (regla 7) — decisión explícita del usuario: cualquier
 * `ADMINISTRATIVO`, sin importar su `nivelPermiso`, puede crear/editar
 * carreras.
 *
 * `sedeId` sale siempre de `@SedeActual()` (JWT, regla 2 de CLAUDE.md raíz)
 * — nunca de body/query/param.
 */
@Controller('carreras')
@UseGuards(SedeGuard, RolesGuard)
export class CarrerasController {
  constructor(private readonly carrerasService: CarrerasService) {}

  @Get()
  @Roles(RolUsuario.ADMINISTRATIVO)
  async listar(@SedeActual() sedeId: string) {
    const data = await this.carrerasService.listarPorSede(sedeId);
    return { data };
  }

  @Post()
  @HttpCode(201)
  @Roles(RolUsuario.ADMINISTRATIVO)
  async crear(
    @Body() body: CrearCarreraDto,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    const data = await this.carrerasService.crear(body, sedeId, actorUsuarioId);
    return { data };
  }

  @Patch(':id')
  @Roles(RolUsuario.ADMINISTRATIVO)
  async actualizar(
    @Param('id') id: string,
    @Body() body: ActualizarCarreraDto,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    const data = await this.carrerasService.actualizar(
      id,
      body,
      sedeId,
      actorUsuarioId,
    );
    return { data };
  }
}
