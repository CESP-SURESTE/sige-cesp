import { Module } from '@nestjs/common';
import { PersonasController } from './personas.controller';
import {
  PERSONAS_SUPABASE_CLIENT_OVERRIDE,
  PersonasService,
} from './personas.service';

/**
 * `PERSONAS_SUPABASE_CLIENT_OVERRIDE` vale `undefined` por default — en
 * producción `PersonasService` cae al `createAdminClient()` real de
 * `@supabase/server/core`. En tests se overridea vía
 * `Test.createTestingModule({ imports: [AppModule] })
 *   .overrideProvider(PERSONAS_SUPABASE_CLIENT_OVERRIDE)`
 * — mismo patrón que `AUTH_SUPABASE_CLIENT_OVERRIDE` en `auth.module.ts`,
 * ver `test/personas.e2e-spec.ts`. `PrismaService` no se importa acá porque
 * `PrismaModule` es `@Global()` (ver `prisma.module.ts`).
 */
@Module({
  controllers: [PersonasController],
  providers: [
    PersonasService,
    { provide: PERSONAS_SUPABASE_CLIENT_OVERRIDE, useValue: undefined },
  ],
  exports: [PERSONAS_SUPABASE_CLIENT_OVERRIDE],
})
export class PersonasModule {}
