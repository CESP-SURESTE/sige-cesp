import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { SedeGuard } from '../common/guards/sede.guard';
import { SedeActual } from '../common/decorators/sede-actual.decorator';
import { SedesService } from './sedes.service';

/**
 * Controller de prueba para el `SedeGuard` — Fase 1, Día 6.
 *
 * `GET /sedes/:sedeId` es intencionalmente el endpoint más simple posible:
 * su único propósito es demostrar, de punta a punta, que el guard extrae
 * `sede_id` del JWT y que una request cross-sede (pidiendo el `:sedeId` de
 * OTRA sede) responde 403 — no que se necesite. El CRUD real de `Sede`
 * (Fase 6 del roadmap) se construye más adelante.
 */
@Controller('sedes')
@UseGuards(SedeGuard)
export class SedesController {
  constructor(private readonly sedesService: SedesService) {}

  @Get(':sedeId')
  async obtenerPorId(
    @Param('sedeId') sedeId: string,
    @SedeActual() sedeActual: string,
  ) {
    // `SedeGuard` ya rechazó con 403 cualquier :sedeId que no coincidiera
    // con el JWT antes de llegar aquí — este assert documenta esa garantía
    // en vez de confiar en ella silenciosamente.
    void sedeActual;

    const sede = await this.sedesService.obtenerPorId(sedeId);
    return { data: sede };
  }
}
