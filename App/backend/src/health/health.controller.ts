import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';

/**
 * `GET /health` — health-check con DB, para un monitor externo (cada ~5 min)
 * que además mantiene despierta la base de Supabase. Público a propósito: no
 * lleva `SedeGuard`/`RolesGuard`/`InternalJobGuard` (en este proyecto los
 * guards son por controller/ruta, no globales — una ruta sin `@UseGuards`
 * es pública) ni toca contexto de sede/RLS. Respuesta mínima y SIN el
 * contrato `{ data }`/`{ error, code }`: un monitor solo necesita el código
 * HTTP, y no se filtra nada interno.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check(): Promise<{ status: 'ok' }> {
    const viva = await this.healthService.dbEstaViva();
    if (!viva) {
      throw new ServiceUnavailableException({ status: 'error' });
    }
    return { status: 'ok' };
  }
}
