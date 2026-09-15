import { Module } from '@nestjs/common';
import { EmergenciaController } from './emergencia.controller';
import { EmergenciaService } from './emergencia.service';

@Module({
  controllers: [EmergenciaController],
  providers: [EmergenciaService],
})
export class EmergenciaModule {}
