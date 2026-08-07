import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * `@Global()` porque prácticamente todo módulo de negocio va a necesitar
 * `PrismaService` — evita re-importar `PrismaModule` en cada feature module.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
