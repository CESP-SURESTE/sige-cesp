import { Module } from '@nestjs/common';
import { TELEGRAM_FETCH_OVERRIDE, TelegramService } from './telegram.service';

@Module({
  providers: [
    TelegramService,
    { provide: TELEGRAM_FETCH_OVERRIDE, useValue: undefined },
  ],
  exports: [TelegramService, TELEGRAM_FETCH_OVERRIDE],
})
export class TelegramModule {}
