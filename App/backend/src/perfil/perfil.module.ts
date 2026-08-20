import { Module } from '@nestjs/common';
import { MallaCurricularModule } from '../malla-curricular/malla-curricular.module';
import { PerfilController } from './perfil.controller';
import { PerfilService } from './perfil.service';

@Module({
  imports: [MallaCurricularModule],
  controllers: [PerfilController],
  providers: [PerfilService],
})
export class PerfilModule {}
