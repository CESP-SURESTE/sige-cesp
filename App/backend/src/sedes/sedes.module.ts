import { Module } from '@nestjs/common';
import { PersonasModule } from '../personas/personas.module';
import { SedesController } from './sedes.controller';
import { SedesService } from './sedes.service';

@Module({
  imports: [PersonasModule],
  controllers: [SedesController],
  providers: [SedesService],
})
export class SedesModule {}
