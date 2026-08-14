import { Module } from '@nestjs/common';
import { LoginThrottlerGuard } from '../auth/guards/login-throttler.guard';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminService } from './platform-admin.service';

@Module({
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService, LoginThrottlerGuard],
})
export class PlatformAdminModule {}
