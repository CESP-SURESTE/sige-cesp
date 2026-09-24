import { Module } from '@nestjs/common';
import { FotoPerfilModule } from '../foto-perfil/foto-perfil.module';
import { EmergenciaController } from './emergencia.controller';
import { EmergenciaService } from './emergencia.service';

@Module({
  imports: [FotoPerfilModule],
  controllers: [EmergenciaController],
  providers: [EmergenciaService],
})
export class EmergenciaModule {}
