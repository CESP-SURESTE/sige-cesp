import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RolUsuario } from '@prisma/client';
import { ActorUsuarioId } from '../common/decorators/actor-usuario-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SedeActual } from '../common/decorators/sede-actual.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { SedeGuard } from '../common/guards/sede.guard';
import { ArchivoFotoInvalidaFilter } from '../foto-perfil/archivo-foto-invalida.filter';
import { FotoPerfilService } from '../foto-perfil/foto-perfil.service';
import { MallaCurricularService } from '../malla-curricular/malla-curricular.service';
import { PerfilService } from './perfil.service';

const TRES_MB = 3 * 1024 * 1024;

/**
 * `GET /perfil` — Fase 5, Día 16.
 *
 * Solo `SedeGuard` de clase — sin `RolesGuard` a nivel de clase — mismo
 * criterio que `PATCH /auth/cambiar-password` (Día 12): cualquier rol
 * autenticado consulta su propio perfil, no es una acción restringida a
 * `ADMINISTRATIVO` ni a ningún rol en particular.
 *
 * El `usuarioId` a consultar sale exclusivamente de `@ActorUsuarioId()`
 * (JWT `sub`, ver `PerfilService.obtenerPerfilPropio`) — no hay `:id` ni
 * query param por el que se pueda pedir el perfil de otra persona.
 *
 * `GET /perfil/malla` (Fase 7, Día 24) y `GET /perfil/grupo/companeros`
 * (Fase 11, Día 32) son las excepciones — sí restringidas a `ALUMNO`,
 * `RolesGuard` declarado a nivel de MÉTODO (no de clase, para no afectar
 * `GET /perfil`), mismo criterio de composición de guards que
 * `SedesController` (Día 20: guard declarado por método cuando la clase
 * sirve rutas con requisitos distintos).
 *
 * `GET /perfil/asignaciones` (Fase 12, Día 34) es el equivalente del lado
 * MAESTRO — mismo patrón de `RolesGuard` a nivel de MÉTODO, pero
 * `@Roles(MAESTRO)`: el maestro autenticado ve sus grupos y materias
 * asignados (`GrupoMateriaMaestro`).
 *
 * `POST/DELETE /perfil/foto` (feature "Foto de perfil", 2026-09-17) — sin
 * `@Roles(...)`, mismo criterio que `GET /perfil`: cualquier rol autenticado
 * gestiona su propia foto. Delegan 100% en `FotoPerfilService`
 * (`usuarioId === actorUsuarioId` en ambos casos — self-service), que
 * `PersonasController` reutiliza para el caso admin-sobre-otra-persona.
 */
@Controller('perfil')
@UseGuards(SedeGuard)
export class PerfilController {
  constructor(
    private readonly perfilService: PerfilService,
    private readonly mallaCurricularService: MallaCurricularService,
    private readonly fotoPerfilService: FotoPerfilService,
  ) {}

  @Get()
  async obtenerPropio(@ActorUsuarioId() actorUsuarioId: string) {
    const data = await this.perfilService.obtenerPerfilPropio(actorUsuarioId);
    return { data };
  }

  @Post('foto')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('archivo', { limits: { fileSize: TRES_MB } }),
  )
  @UseFilters(ArchivoFotoInvalidaFilter)
  async subirFotoPropia(
    @ActorUsuarioId() actorUsuarioId: string,
    @SedeActual() sedeId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const data = await this.fotoPerfilService.subir(
      actorUsuarioId,
      sedeId,
      actorUsuarioId,
      file,
    );
    return { data };
  }

  @Delete('foto')
  @HttpCode(HttpStatus.OK)
  async eliminarFotoPropia(
    @ActorUsuarioId() actorUsuarioId: string,
    @SedeActual() sedeId: string,
  ) {
    const data = await this.fotoPerfilService.eliminar(
      actorUsuarioId,
      sedeId,
      actorUsuarioId,
    );
    return { data };
  }

  @Get('malla')
  @UseGuards(RolesGuard)
  @Roles(RolUsuario.ALUMNO)
  async obtenerUrlDescargaMalla(@ActorUsuarioId() actorUsuarioId: string) {
    const data =
      await this.mallaCurricularService.obtenerUrlDescargaPropia(
        actorUsuarioId,
      );
    return { data };
  }

  @Get('grupo/companeros')
  @UseGuards(RolesGuard)
  @Roles(RolUsuario.ALUMNO)
  async obtenerCompaneros(@ActorUsuarioId() actorUsuarioId: string) {
    const data =
      await this.perfilService.obtenerCompanerosDeGrupo(actorUsuarioId);
    return { data };
  }

  @Get('asignaciones')
  @UseGuards(RolesGuard)
  @Roles(RolUsuario.MAESTRO)
  async obtenerAsignaciones(@ActorUsuarioId() actorUsuarioId: string) {
    const data =
      await this.perfilService.obtenerAsignacionesPropias(actorUsuarioId);
    return { data };
  }
}
