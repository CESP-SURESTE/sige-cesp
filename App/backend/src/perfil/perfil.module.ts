import { Module } from '@nestjs/common';
import { FotoPerfilModule } from '../foto-perfil/foto-perfil.module';
import { MallaCurricularModule } from '../malla-curricular/malla-curricular.module';
import { PerfilController } from './perfil.controller';
import { PerfilService } from './perfil.service';

@Module({
  imports: [MallaCurricularModule, FotoPerfilModule],
  controllers: [PerfilController],
  providers: [PerfilService],
})
export class PerfilModule {}
