import { Module } from '@nestjs/common';
import {
  FOTO_PERFIL_SUPABASE_CLIENT_OVERRIDE,
  FotoPerfilService,
} from './foto-perfil.service';

/**
 * Sin `controllers` — `FotoPerfilService` se consume directo desde
 * `PerfilController` (self-service) y `PersonasController` (admin), no
 * tiene rutas propias (regla 4 de `CLAUDE.md` raíz: sub-recurso).
 */
@Module({
  providers: [
    FotoPerfilService,
    { provide: FOTO_PERFIL_SUPABASE_CLIENT_OVERRIDE, useValue: undefined },
  ],
  exports: [FOTO_PERFIL_SUPABASE_CLIENT_OVERRIDE, FotoPerfilService],
})
export class FotoPerfilModule {}
