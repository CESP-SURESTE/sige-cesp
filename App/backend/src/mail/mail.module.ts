import { Module } from '@nestjs/common';
import { MAIL_FETCH_OVERRIDE, MailService } from './mail.service';

/**
 * `MAIL_FETCH_OVERRIDE` vale `undefined` por default — en producción
 * `MailService` cae al `fetch` global real. En tests se overridea vía
 * `Test.createTestingModule({ imports: [AppModule] })
 *   .overrideProvider(MAIL_FETCH_OVERRIDE)` — mismo patrón que
 * `PERSONAS_SUPABASE_CLIENT_OVERRIDE` (`personas.module.ts`), evita que la
 * suite le pegue a la red real de Mailgun.
 */
@Module({
  providers: [
    MailService,
    { provide: MAIL_FETCH_OVERRIDE, useValue: undefined },
  ],
  exports: [MailService, MAIL_FETCH_OVERRIDE],
})
export class MailModule {}
