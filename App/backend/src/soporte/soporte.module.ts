import { Module } from '@nestjs/common';
import { SoporteController } from './soporte.controller';
import { SoporteService } from './soporte.service';

@Module({
  controllers: [SoporteController],
  providers: [SoporteService],
  exports: [SoporteService],
})
export class SoporteModule {}
