import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AUTH_SUPABASE_CLIENT_OVERRIDE, AuthService } from './auth.service';
import { LoginThrottlerGuard } from './guards/login-throttler.guard';

/**
 * `AUTH_SUPABASE_CLIENT_OVERRIDE` vale `undefined` por default — en
 * producción `AuthService` cae al `createAdminClient()` real de
 * `@supabase/server/core`. En tests se overridea vía
 * `Test.createTestingModule({ imports: [AppModule] })
 *   .overrideProvider(AUTH_SUPABASE_CLIENT_OVERRIDE)`
 * — ver `test/auth.e2e-spec.ts` (mismo patrón que `SedeGuardModule` +
 * `SEDE_GUARD_ENV_OVERRIDE`).
 *
 * `ThrottlerModule.forRoot(...)` — Fase 2, Día 9. Registra la config de
 * rate limiting (5 intentos / 60s, ver `guards/login-throttler.guard.ts`)
 * como providers; `ThrottlerModule` es `@Global()` internamente (lo declara
 * el propio paquete), así que sus providers quedan disponibles en toda la
 * app apenas se importa una vez acá — pero eso NO activa el guard en
 * ninguna ruta por sí solo. `LoginThrottlerGuard` solo se aplica donde hay
 * `@UseGuards(LoginThrottlerGuard)` explícito (`auth.controller.ts`, solo
 * en `POST /auth/login`) — no hay `APP_GUARD` global.
 */
@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000, // 1 minuto
        limit: 5, // 5 intentos de login por IP por minuto
      },
    ]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LoginThrottlerGuard,
    { provide: AUTH_SUPABASE_CLIENT_OVERRIDE, useValue: undefined },
  ],
  exports: [AUTH_SUPABASE_CLIENT_OVERRIDE],
})
export class AuthModule {}
