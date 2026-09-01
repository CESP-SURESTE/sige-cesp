import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { CalendarioController } from './calendario.controller';
import { CalendarioService } from './calendario.service';
import { InternalRecordatoriosController } from './internal-recordatorios.controller';

@Module({
  imports: [MailModule],
  controllers: [CalendarioController, InternalRecordatoriosController],
  providers: [CalendarioService],
  exports: [CalendarioService],
})
export class CalendarioModule {}
