import {
  Body,
  Controller,
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
import { CambiarEstatusDto } from './dto/cambiar-estatus.dto';
import { CrearPersonaDto } from './dto/crear-persona.dto';
import { ListarPersonasQueryDto } from './dto/listar-personas.query.dto';
import { PersonasService } from './personas.service';

/**
 * `POST /personas` — Fase 4, Día 11.
 *
 * Alta transaccional de personas (regla 9 de CLAUDE.md raíz): crea la cuenta
 * real en Supabase Auth, la fila en `Usuario` y el perfil correspondiente al
 * `rol` (ALUMNO/MAESTRO/ADMINISTRATIVO) en una sola operación con rollback
 * si falla cualquier paso — ver `PersonasService.altaPersona`.
 *
 * Solo `ADMINISTRATIVO` (checklist del roadmap Día 11: "solo admin").
 *
 * Jerarquía de `NivelPermiso` en el alta de `ADMINISTRATIVO` (regla 7 de
 * CLAUDE.md raíz, corregida tras observación A de QA — Día 11): no vive en
 * este controller ni en un guard — `PersonasService.verificarJerarquiaNivelPermiso`
 * consulta el `PerfilAdministrativo` del actor en DB (el JWT no trae
 * `nivelPermiso`) y rechaza con 403 `NIVEL_PERMISO_INSUFICIENTE` si intenta
 * asignar un nivel por encima del suyo propio (o si es `AUXILIAR`, cualquier
 * nivel).
 *
 * `sedeId` SIEMPRE sale de `@SedeActual()` (JWT, regla 2 de CLAUDE.md raíz),
 * nunca del body — un admin solo puede dar de alta gente en su propia sede.
 * El actor para `RegistroAuditoria` sale de `@ActorUsuarioId()` (JWT `sub`),
 * tampoco del body (regla 5).
 *
 * `GET /personas` — Fase 5, Día 19. "Listados PARA administrativos" (de
 * ALUMNO/MAESTRO, no de ADMINISTRATIVO mismos, ver encargo del día). Mismos
 * guards que `POST /personas`; cualquier `ADMINISTRATIVO` sin importar
 * `nivelPermiso` — es solo lectura, no aplica la jerarquía de
 * `NivelPermiso` que sí aplica al dar de alta administrativos. `sedeId`
 * también sale SIEMPRE de `@SedeActual()`, nunca de query.
 *
 * `GET /personas/resumen` — dashboard de admin. Mismos guards que
 * `GET /personas` (`SedeGuard` + `RolesGuard`, `@Roles(ADMINISTRATIVO)`) —
 * cualquier `ADMINISTRATIVO` sin importar `nivelPermiso`, es solo lectura.
 * `sedeId` sale SIEMPRE de `@SedeActual()`, nunca de query/param (regla 2 de
 * CLAUDE.md raíz). Declarado ANTES de `GET /personas/:id` si algún día se
 * agrega esa ruta — no hay conflicto hoy porque no existe `:id` en este
 * controller, pero `resumen` como segmento fijo debe ganarle a cualquier
 * `:id` futuro.
 *
 * `PATCH /personas/:id/estatus` — Fase 10 (unificación CRUD admin), primer
 * código real del patrón "baja lógica" (regla 3 de CLAUDE.md raíz). Mismos
 * guards que el resto de este controller. `id` es el `Usuario` objetivo (no
 * el actor); `sedeId`/`actorUsuarioId` siempre del JWT. La jerarquía de
 * `NivelPermiso` (regla 7) solo aplica cuando el objetivo es
 * `ADMINISTRATIVO` — ver `PersonasService.cambiarEstatus`.
 */
@Controller('personas')
@UseGuards(SedeGuard, RolesGuard)
export class PersonasController {
  constructor(private readonly personasService: PersonasService) {}

  @Post()
  @HttpCode(201)
  @Roles(RolUsuario.ADMINISTRATIVO)
  async crear(
    @Body() body: CrearPersonaDto,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    const data = await this.personasService.altaPersona(
      body,
      sedeId,
      actorUsuarioId,
    );
    return { data };
  }

  @Get()
  @Roles(RolUsuario.ADMINISTRATIVO)
  async listar(
    @Query() query: ListarPersonasQueryDto,
    @SedeActual() sedeId: string,
  ) {
    return this.personasService.listarPorSedeYRol(sedeId, query);
  }

  @Get('resumen')
  @Roles(RolUsuario.ADMINISTRATIVO)
  async resumen(@SedeActual() sedeId: string) {
    const data = await this.personasService.resumenPorSede(sedeId);
    return { data };
  }

  @Patch(':id/estatus')
  @Roles(RolUsuario.ADMINISTRATIVO)
  async cambiarEstatus(
    @Param('id') id: string,
    @Body() body: CambiarEstatusDto,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    const data = await this.personasService.cambiarEstatus(
      id,
      body.estatus,
      sedeId,
      actorUsuarioId,
      { tipoLicencia: body.tipoLicencia, motivoBaja: body.motivoBaja },
    );
    return { data };
  }
}
