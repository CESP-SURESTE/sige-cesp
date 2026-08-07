import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

/**
 * `POST /auth/login` — Fase 2, Día 7.
 *
 * Única ruta del API que NO exige `Authorization: Bearer <jwt>` (ver
 * CLAUDE.md, sección "Contrato de API") — por eso no lleva `@UseGuards(...)`.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: LoginDto) {
    const data = await this.authService.login(body?.email, body?.password);
    return { data };
  }
}
