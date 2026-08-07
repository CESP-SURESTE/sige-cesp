import { Module } from '@nestjs/common';
import { PruebaRolesController } from './prueba-roles.controller';

@Module({
  controllers: [PruebaRolesController],
})
export class PruebaRolesModule {}
