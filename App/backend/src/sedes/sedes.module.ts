import { Module } from '@nestjs/common';
import { SedesController } from './sedes.controller';
import { SedesService } from './sedes.service';

@Module({
  controllers: [SedesController],
  providers: [SedesService],
})
export class SedesModule {}
