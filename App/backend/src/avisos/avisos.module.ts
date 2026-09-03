import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { AvisosController } from './avisos.controller';
import { AvisosService } from './avisos.service';

@Module({
  imports: [MailModule],
  controllers: [AvisosController],
  providers: [AvisosService],
})
export class AvisosModule {}
