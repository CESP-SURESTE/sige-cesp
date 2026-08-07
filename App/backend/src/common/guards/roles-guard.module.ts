import { Global, Module } from '@nestjs/common';
import { RolesGuard } from './roles.guard';

/**
 * Módulo `@Global()` para que cualquier feature module pueda usar
 * `@UseGuards(..., RolesGuard)` sin tener que importar nada extra — simétrico
 * a `SedeGuardModule` (Fase 1, Día 6, `src/common/guards/sede-guard.module.ts`).
 *
 * No tiene ningún override de env como `SedeGuardModule` porque `RolesGuard`
 * no verifica el JWT por su cuenta (ver invariante de composición en
 * `roles.guard.ts`) — solo lee `request.jwtClaims` que `SedeGuard` ya dejó.
 */
@Global()
@Module({
  providers: [RolesGuard],
  exports: [RolesGuard],
})
export class RolesGuardModule {}
