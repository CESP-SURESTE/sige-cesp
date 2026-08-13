import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { SedeGuardModule } from './common/guards/sede-guard.module';
import { RolesGuardModule } from './common/guards/roles-guard.module';
import { SedesModule } from './sedes/sedes.module';
import { AuthModule } from './auth/auth.module';
import { PruebaRolesModule } from './prueba-roles/prueba-roles.module';
import { PersonasModule } from './personas/personas.module';
import { CarrerasModule } from './carreras/carreras.module';
import { PerfilModule } from './perfil/perfil.module';

@Module({
  imports: [
    PrismaModule,
    SedeGuardModule,
    RolesGuardModule,
    SedesModule,
    AuthModule,
    PruebaRolesModule,
    PersonasModule,
    CarrerasModule,
    PerfilModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
