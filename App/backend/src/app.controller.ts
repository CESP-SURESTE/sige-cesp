import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

/**
 * `GET /` — health-check. Público a propósito (sin `Authorization`, sin
 * `SedeGuard`/`RolesGuard`) — es el endpoint que un load balancer o monitor
 * de uptime pega sin credenciales. Sigue el contrato `{ data }` como
 * cualquier otra ruta de la API.
 */
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  obtenerEstado() {
    const data = this.appService.obtenerEstado();
    return { data };
  }
}
