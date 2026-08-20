import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AccionAuditoria, type MallaCurricular } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * `MallaCurricularService` — Fase 7, Día 23.
 *
 * Sub-recurso de `Carrera` (regla 4 de `CLAUDE.md` raíz) — módulo propio,
 * no vive dentro de `CarrerasModule`, porque `CarrerasModule` no necesita
 * saber de Supabase Storage.
 *
 * Mismo mecanismo de `import()` dinámico + caché de `createAdminClient`
 * que `personas.service.ts`/`auth.service.ts` (`@supabase/server` es
 * ESM-only) — y mismo patrón de override de cliente para tests
 * (`MALLA_SUPABASE_CLIENT_OVERRIDE`, ver `PERSONAS_SUPABASE_CLIENT_OVERRIDE`).
 */
type CreateAdminClientFn =
  typeof import('@supabase/server/core').createAdminClient;
type SupabaseAdminClient = ReturnType<CreateAdminClientFn>;

let createAdminClientFn: CreateAdminClientFn | undefined;

async function getCreateAdminClient(): Promise<CreateAdminClientFn> {
  if (!createAdminClientFn) {
    const core = await import('@supabase/server/core');
    createAdminClientFn =
      core.createAdminClient as unknown as CreateAdminClientFn;
  }
  return createAdminClientFn;
}

export const MALLA_SUPABASE_CLIENT_OVERRIDE = 'MALLA_SUPABASE_CLIENT_OVERRIDE';

/** Bucket privado creado por `prisma/crear-bucket-malla.ts` (Task 1). */
export const BUCKET_MALLA_CURRICULAR = 'mallas-curriculares';

@Injectable()
export class MallaCurricularService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(MALLA_SUPABASE_CLIENT_OVERRIDE)
    private readonly clientOverride?: SupabaseAdminClient,
  ) {}

  private async getClient(): Promise<SupabaseAdminClient> {
    if (this.clientOverride) {
      return this.clientOverride;
    }
    const createAdminClient = await getCreateAdminClient();
    return createAdminClient();
  }

  /**
   * `POST /carreras/:id/malla` — valida archivo (presente, PDF), valida
   * que la carrera exista Y pertenezca a la sede del actor (mismo criterio
   * que `carreraId` en `POST /personas`), sube a Storage (ruta fija
   * `{carreraId}/malla.pdf`, `upsert: true` — sobreescribe, sin versiones
   * viejas huérfanas) y hace `upsert` de `MallaCurricular` (1-a-1 con
   * `Carrera`, regla 6 de `CLAUDE.md` raíz).
   */
  async subir(
    carreraId: string,
    sedeId: string,
    actorUsuarioId: string,
    file: Express.Multer.File | undefined,
  ): Promise<MallaCurricular> {
    if (!file) {
      throw new BadRequestException({
        error: 'Falta el archivo de la malla curricular',
        code: 'VALIDATION_ERROR',
      });
    }
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException({
        error: 'El archivo debe ser un PDF',
        code: 'VALIDATION_ERROR',
      });
    }

    const carrera = await this.prisma.carrera.findFirst({
      where: { id: carreraId, sedeId },
    });
    if (!carrera) {
      throw new NotFoundException({
        error: 'Carrera no encontrada en tu sede',
        code: 'NOT_FOUND',
      });
    }

    const storagePath = `${carreraId}/malla.pdf`;
    const client = await this.getClient();
    const { error } = await client.storage
      .from(BUCKET_MALLA_CURRICULAR)
      .upload(storagePath, file.buffer, {
        contentType: 'application/pdf',
        upsert: true,
      });
    if (error) {
      console.error(
        '[MallaCurricularService.subir] error subiendo a Storage:',
        error,
      );
      throw new InternalServerErrorException({
        error: 'No se pudo subir la malla curricular. Intenta de nuevo.',
        code: 'SERVER_ERROR',
      });
    }

    const mallaExistente = await this.prisma.mallaCurricular.findUnique({
      where: { carreraId },
    });

    return this.prisma.$transaction(async (tx) => {
      const malla = await tx.mallaCurricular.upsert({
        where: { carreraId },
        create: {
          carreraId,
          storagePath,
          nombreArchivo: file.originalname,
          subidaPorId: actorUsuarioId,
        },
        update: {
          storagePath,
          nombreArchivo: file.originalname,
          subidaPorId: actorUsuarioId,
          subidaEn: new Date(),
        },
      });

      await tx.registroAuditoria.create({
        data: {
          usuarioId: actorUsuarioId,
          sedeId,
          accion: mallaExistente
            ? AccionAuditoria.EDICION
            : AccionAuditoria.ALTA,
          entidad: 'MallaCurricular',
          entidadId: malla.id,
        },
      });

      return malla;
    });
  }
}
