import { Controller, Get, UseGuards } from '@nestjs/common';
import { RolUsuario } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { SedeActual } from '../common/decorators/sede-actual.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { SedeGuard } from '../common/guards/sede.guard';
import { CarrerasService } from './carreras.service';

/**
 * `GET /carreras` — agregado MÍNIMO (no el CRUD completo de `Carrera`, que
 * la tabla de `CLAUDE.md` raíz marca como pendiente en su propio día
 * futuro). Se construyó puntualmente para desbloquear el dropdown de
 * `carreraId` en el formulario de alta de alumno del frontend (Día 14),
 * que consume `POST /personas` (Día 11) — ver instrucción de la tarea en la
 * bitácora de este día. NO agrega `POST`/`PUT`/`DELETE`.
 *
 * Mismo patrón de guards que `PersonasController` (Día 11):
 * `@UseGuards(SedeGuard, RolesGuard)` con `SedeGuard` primero (invariante de
 * composición de `RolesGuard`, ver `roles.guard.ts`). Solo `ADMINISTRATIVO`
 * — quien consume este endpoint es el formulario de alta, que ya está
 * restringido a ese rol.
 *
 * `sedeId` sale siempre de `@SedeActual()` (JWT, regla 2 de CLAUDE.md raíz)
 * — nunca de query/param, para no permitir que un admin liste carreras de
 * otra sede.
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
}
