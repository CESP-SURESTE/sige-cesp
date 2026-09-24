import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { SedeGuardModule } from './common/guards/sede-guard.module';
import { RolesGuardModule } from './common/guards/roles-guard.module';
import { PlatformAdminGuardModule } from './common/guards/platform-admin-guard.module';
import { InternalJobGuardModule } from './common/guards/internal-job-guard.module';
import { SedesModule } from './sedes/sedes.module';
import { AuthModule } from './auth/auth.module';
import { PersonasModule } from './personas/personas.module';
import { CarrerasModule } from './carreras/carreras.module';
import { MallaCurricularModule } from './malla-curricular/malla-curricular.module';
import { PerfilModule } from './perfil/perfil.module';
import { PlatformAdminModule } from './platform-admin/platform-admin.module';
import { MailModule } from './mail/mail.module';
import { TelegramModule } from './telegram/telegram.module';
import { GruposModule } from './grupos/grupos.module';
import { SalonesModule } from './salones/salones.module';
import { MateriasModule } from './materias/materias.module';
import { NotificacionesModule } from './notificaciones/notificaciones.module';
import { CalendarioModule } from './calendario/calendario.module';
import { AvisosModule } from './avisos/avisos.module';
import { EmergenciaModule } from './emergencia/emergencia.module';

@Module({
  imports: [
    PrismaModule,
    SedeGuardModule,
    RolesGuardModule,
    PlatformAdminGuardModule,
    InternalJobGuardModule,
    SedesModule,
    AuthModule,
    MailModule,
    TelegramModule,
    PersonasModule,
    CarrerasModule,
    MallaCurricularModule,
    PerfilModule,
    PlatformAdminModule,
    GruposModule,
    SalonesModule,
    MateriasModule,
    NotificacionesModule,
    CalendarioModule,
    AvisosModule,
    EmergenciaModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
