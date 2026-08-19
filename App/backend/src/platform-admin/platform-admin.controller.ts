import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { LoginThrottlerGuard } from '../auth/guards/login-throttler.guard';
import { PlatformAdminGuard } from '../common/guards/platform-admin.guard';
import { LoginPlatformAdminDto } from './dto/login-platform-admin.dto';
import { PlatformAdminService } from './platform-admin.service';

/**
 * `POST /platform-admin/login` — Fase 6, Día 20.
 *
 * Reutiliza `LoginThrottlerGuard` (Fase 2, Día 9) tal cual — es genérico,
 * sin dependencias propias de `AuthModule`, mismo criterio de rate limiting
 * que `POST /auth/login` (5 intentos/IP/60s): es igual de sensible a fuerza
 * bruta, aunque sea una identidad distinta.
 *
 * `GET /platform-admin/resumen` — dashboard global de plataforma. Solo
 * lectura, sin `@PlatformAdminActual()` (no audita), `PlatformAdminGuard`
 * como cualquier otra ruta de este actor.
 */
@Controller('platform-admin')
export class PlatformAdminController {
  constructor(private readonly platformAdminService: PlatformAdminService) {}

  @Post('login')
  @HttpCode(200)
  @UseGuards(LoginThrottlerGuard)
  async login(@Body() body: LoginPlatformAdminDto) {
    const data = await this.platformAdminService.login(
      body.email,
      body.password,
    );
    return { data };
  }

  @Get('resumen')
  @UseGuards(PlatformAdminGuard)
  async resumen() {
    const data = await this.platformAdminService.resumenGlobal();
    return { data };
  }
}
