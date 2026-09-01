import { Controller, Post, UseGuards } from '@nestjs/common';
import { InternalJobGuard } from '../common/guards/internal-job.guard';
import { CalendarioService } from './calendario.service';

/**
 * `POST /internal/recordatorios/ejecutar` — Fase 15, Día 42. Disparado
 * por `pg_cron`/`pg_net` de Supabase (o una GitHub Action equivalente),
 * NUNCA por un cliente humano — ver `docs/setup-backend-recordatorios-cron.md`
 * para cómo se programa. `InternalJobGuard`, no `SedeGuard`/`RolesGuard`.
 */
@Controller('internal/recordatorios')
@UseGuards(InternalJobGuard)
export class InternalRecordatoriosController {
  constructor(private readonly calendarioService: CalendarioService) {}

  @Post('ejecutar')
  async ejecutar() {
    const data = await this.calendarioService.generarRecordatoriosPendientes();
    return { data };
  }
}
