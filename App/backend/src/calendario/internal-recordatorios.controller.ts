import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { InternalJobGuard } from '../common/guards/internal-job.guard';
import { CalendarioService } from './calendario.service';

/**
 * `POST /internal/recordatorios/ejecutar` — Fase 15, Día 42. Disparado
 * por `pg_cron`/`pg_net` de Supabase (o una GitHub Action equivalente),
 * NUNCA por un cliente humano — ver `docs/setup-backend-recordatorios-cron.md`
 * para cómo se programa. `InternalJobGuard`, no `SedeGuard`/`RolesGuard`.
 *
 * `@HttpCode(200)` explícito — mismo criterio que todo endpoint estilo
 * RPC/acción de este backend (`POST /auth/login`, `POST
 * /platform-admin/login`): ejecuta algo y devuelve un resultado, no crea un
 * recurso durable, así que no aplica el `201` default de Nest para `POST`.
 * Corrección de un hallazgo del review de Task 6 (suite e2e) — este era el
 * único `@Post()` del backend sin el decorador explícito.
 */
@Controller('internal/recordatorios')
@UseGuards(InternalJobGuard)
export class InternalRecordatoriosController {
  constructor(private readonly calendarioService: CalendarioService) {}

  @Post('ejecutar')
  @HttpCode(200)
  async ejecutar() {
    const data = await this.calendarioService.generarRecordatoriosPendientes();
    return { data };
  }
}
