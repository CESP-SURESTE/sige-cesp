import { Global, Module } from '@nestjs/common';
import { InternalJobGuard } from './internal-job.guard';

@Global()
@Module({
  providers: [InternalJobGuard],
  exports: [InternalJobGuard],
})
export class InternalJobGuardModule {}
