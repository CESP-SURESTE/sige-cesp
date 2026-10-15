import { Module } from '@nestjs/common';
import { TelegramModule } from '../telegram/telegram.module';
import { SoporteController } from './soporte.controller';
import {
  SOPORTE_SUPABASE_CLIENT_OVERRIDE,
  SoporteService,
} from './soporte.service';

@Module({
  imports: [TelegramModule],
  controllers: [SoporteController],
  providers: [
    SoporteService,
    { provide: SOPORTE_SUPABASE_CLIENT_OVERRIDE, useValue: undefined },
  ],
  exports: [SoporteService, SOPORTE_SUPABASE_CLIENT_OVERRIDE],
})
export class SoporteModule {}
