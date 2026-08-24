import { Module } from '@nestjs/common';
import { GruposController } from './grupos.controller';
import { GruposService } from './grupos.service';

@Module({
  controllers: [GruposController],
  providers: [GruposService],
})
export class GruposModule {}
