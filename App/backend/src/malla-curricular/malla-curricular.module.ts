import { Module } from '@nestjs/common';
import { MallaCurricularController } from './malla-curricular.controller';
import {
  MALLA_SUPABASE_CLIENT_OVERRIDE,
  MallaCurricularService,
} from './malla-curricular.service';

/**
 * `MALLA_SUPABASE_CLIENT_OVERRIDE` vale `undefined` por default — en
 * producción `MallaCurricularService` cae al `createAdminClient()` real de
 * `@supabase/server/core`. En tests se overridea vía
 * `Test.createTestingModule({ imports: [AppModule] })
 *   .overrideProvider(MALLA_SUPABASE_CLIENT_OVERRIDE)`
 * — mismo patrón que `PERSONAS_SUPABASE_CLIENT_OVERRIDE` en
 * `personas.module.ts`. Sin este provider registrado acá, `overrideProvider`
 * no tiene token que sobreescribir y el service cae al cliente real
 * (bug detectado en Task 2 al correr el e2e — el primer intento subió un
 * archivo real al bucket en vez de usar el mock).
 */
@Module({
  controllers: [MallaCurricularController],
  providers: [
    MallaCurricularService,
    { provide: MALLA_SUPABASE_CLIENT_OVERRIDE, useValue: undefined },
  ],
  exports: [MALLA_SUPABASE_CLIENT_OVERRIDE],
})
export class MallaCurricularModule {}
