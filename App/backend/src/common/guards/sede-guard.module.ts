import { Global, Module } from '@nestjs/common';
import { SEDE_GUARD_ENV_OVERRIDE, SedeGuard } from './sede.guard';

/**
 * Módulo `@Global()` para que cualquier feature module pueda usar
 * `@UseGuards(SedeGuard)` sin tener que importar nada extra, y para que los
 * tests puedan hacer `overrideProvider(SEDE_GUARD_ENV_OVERRIDE)` sobre
 * `AppModule` completo (el token tiene que existir en el grafo de módulos
 * para que Nest lo pueda overridear — ver `test/sede-guard.e2e-spec.ts`).
 *
 * `SEDE_GUARD_ENV_OVERRIDE` vale `undefined` por default — en producción el
 * guard cae a `SUPABASE_URL`/`SUPABASE_JWKS_URL` reales de `process.env`.
 */
@Global()
@Module({
  providers: [
    SedeGuard,
    { provide: SEDE_GUARD_ENV_OVERRIDE, useValue: undefined },
  ],
  exports: [SedeGuard, SEDE_GUARD_ENV_OVERRIDE],
})
export class SedeGuardModule {}
