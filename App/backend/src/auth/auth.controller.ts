import {
  Body,
  Controller,
  HttpCode,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ActorEmail } from '../common/decorators/actor-email.decorator';
import { ActorUsuarioId } from '../common/decorators/actor-usuario-id.decorator';
import { SedeActual } from '../common/decorators/sede-actual.decorator';
import { SedeGuard } from '../common/guards/sede.guard';
import { AuthService } from './auth.service';
import { CambiarPasswordDto } from './dto/cambiar-password.dto';
import { LoginDto } from './dto/login.dto';
import { LoginThrottlerGuard } from './guards/login-throttler.guard';

/**
 * `AuthController` — Fase 2, Día 7 (`POST /auth/login`) + Fase 4, Día 12
 * (`PATCH /auth/cambiar-password`).
 *
 * `POST /auth/login` es la ÚNICA ruta del API que NO exige
 * `Authorization: Bearer <jwt>` (ver CLAUDE.md, sección "Contrato de API")
 * — por eso no lleva `@UseGuards(SedeGuard, ...)`. Sí lleva
 * `LoginThrottlerGuard` (Día 9) — rate limiting propio de esta ruta, no
 * relacionado con auth/sede/rol.
 *
 * `PATCH /auth/cambiar-password` sí exige el JWT (`@UseGuards(SedeGuard)`
 * únicamente, sin `RolesGuard` — cualquier rol autenticado puede cambiar su
 * propia contraseña, no es una acción restringida a `ADMINISTRATIVO`).
 * Decisión de módulo (encargo de Día 12, "tu criterio, documenta cuál
 * elegiste"): se agregó acá, no en un módulo nuevo — es la misma capa de
 * "credenciales/sesión" que `login()`, reutiliza el mismo mecanismo de
 * cliente Supabase (`AUTH_SUPABASE_CLIENT_OVERRIDE`/`createAdminClient()`)
 * ya cacheado en `AuthService`, y no hay ninguna razón de dominio (regla 4,
 * sub-recursos anidados) que empuje a separarlo.
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

  @Patch('cambiar-password')
  @HttpCode(200)
  @UseGuards(SedeGuard)
  async cambiarPassword(
    @Body() body: CambiarPasswordDto,
    @ActorUsuarioId() actorUsuarioId: string,
    @ActorEmail() actorEmail: string,
    @SedeActual() sedeId: string,
  ) {
    const data = await this.authService.cambiarPassword(
      actorUsuarioId,
      actorEmail,
      sedeId,
      body?.passwordActual,
      body?.passwordNueva,
    );
    return { data };
  }
}
