import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AUTH_SUPABASE_CLIENT_OVERRIDE, AuthService } from './auth.service';

/**
 * `AUTH_SUPABASE_CLIENT_OVERRIDE` vale `undefined` por default — en
 * producción `AuthService` cae al `createAdminClient()` real de
 * `@supabase/server/core`. En tests se overridea vía
 * `Test.createTestingModule({ imports: [AppModule] })
 *   .overrideProvider(AUTH_SUPABASE_CLIENT_OVERRIDE)`
 * — ver `test/auth.e2e-spec.ts` (mismo patrón que `SedeGuardModule` +
 * `SEDE_GUARD_ENV_OVERRIDE`).
 */
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: AUTH_SUPABASE_CLIENT_OVERRIDE, useValue: undefined },
  ],
  exports: [AUTH_SUPABASE_CLIENT_OVERRIDE],
})
export class AuthModule {}
