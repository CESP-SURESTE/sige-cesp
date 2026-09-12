import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
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
 *
 * `MailModule` (Día 13, correo de bienvenida best-effort) SÍ se importa acá
 * de forma explícita — no es `@Global()`, `PersonasService` necesita
 * `MailService` inyectado en su constructor.
 */
@Module({
  imports: [MailModule],
  controllers: [PersonasController],
  providers: [
    PersonasService,
    { provide: PERSONAS_SUPABASE_CLIENT_OVERRIDE, useValue: undefined },
  ],
  exports: [PersonasService, PERSONAS_SUPABASE_CLIENT_OVERRIDE],
})
export class PersonasModule {}
