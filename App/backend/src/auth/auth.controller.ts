import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { LoginThrottlerGuard } from './guards/login-throttler.guard';

/**
 * `POST /auth/login` — Fase 2, Día 7.
 *
 * Única ruta del API que NO exige `Authorization: Bearer <jwt>` (ver
 * CLAUDE.md, sección "Contrato de API") — por eso no lleva
 * `@UseGuards(SedeGuard, ...)`. Sí lleva `LoginThrottlerGuard` (Día 9) —
 * rate limiting propio de esta ruta, no relacionado con auth/sede/rol.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @UseGuards(LoginThrottlerGuard)
  async login(@Body() body: LoginDto) {
    const data = await this.authService.login(body?.email, body?.password);
    return { data };
  }
}
