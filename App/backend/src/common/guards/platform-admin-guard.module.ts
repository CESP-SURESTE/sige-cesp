import { Global, Module } from '@nestjs/common';
import { PlatformAdminGuard } from './platform-admin.guard';

/**
 * Módulo `@Global()` — mismo patrón que `SedeGuardModule`/`RolesGuardModule`
 * (ver esos archivos): cualquier feature module puede usar
 * `@UseGuards(PlatformAdminGuard)` sin importar nada extra.
 */
@Global()
@Module({
  providers: [PlatformAdminGuard],
  exports: [PlatformAdminGuard],
})
export class PlatformAdminGuardModule {}
