import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AccionAuditoria, EstatusReporteBug } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';

export const CONFIGURACION_SOPORTE_ID = 'global';

/**
 * Mismo mecanismo de `import()` dinámico + caché de `createAdminClient` que
 * `FotoPerfilService`/`MallaCurricularService` (`@supabase/server` es
 * ESM-only), y mismo patrón de override de cliente para tests.
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

export const SOPORTE_SUPABASE_CLIENT_OVERRIDE =
  'SOPORTE_SUPABASE_CLIENT_OVERRIDE';

/** Bucket privado creado por `prisma/crear-bucket-reportes-bug.ts`. */
export const BUCKET_REPORTES_BUG = 'reportes-bug';

/** El límite de 3MB real lo aplica `FileInterceptor` en el controller — aquí solo se valida el tipo. */
const MIME_A_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** 15 minutos — mismo criterio que `fotoUrl` (se re-consulta al abrir el detalle en plataforma). */
const SEGUNDOS_SIGNED_URL = 900;

@Injectable()
export class SoporteService {
  constructor(
    protected readonly prisma: PrismaService,
    protected readonly telegramService: TelegramService,
    @Optional()
    @Inject(SOPORTE_SUPABASE_CLIENT_OVERRIDE)
    private readonly clientOverride?: SupabaseAdminClient,
  ) {}

  private async getClient(): Promise<SupabaseAdminClient> {
    if (this.clientOverride) {
      return this.clientOverride;
    }
    const createAdminClient = await getCreateAdminClient();
    return createAdminClient();
  }

  async obtenerConfig(): Promise<{ activo: boolean }> {
    const config = await this.prisma.configuracionSoporte.upsert({
      where: { id: CONFIGURACION_SOPORTE_ID },
      create: { id: CONFIGURACION_SOPORTE_ID },
      update: {},
    });
    return { activo: config.activo };
  }

  async actualizarConfig(
    activo: boolean,
    adminPlataformaId: string,
  ): Promise<{ activo: boolean }> {
    const config = await this.prisma.$transaction(async (tx) => {
      const actualizado = await tx.configuracionSoporte.upsert({
        where: { id: CONFIGURACION_SOPORTE_ID },
        create: { id: CONFIGURACION_SOPORTE_ID, activo },
        update: { activo },
      });
      await tx.registroAuditoria.create({
        data: {
          adminPlataformaId,
          accion: AccionAuditoria.EDICION,
          entidad: 'ConfiguracionSoporte',
          entidadId: CONFIGURACION_SOPORTE_ID,
          detalle: { activo },
        },
      });
      return actualizado;
    });
    return { activo: config.activo };
  }

  /**
   * Firma en batch (`createSignedUrls`, plural) los `storagePath` recibidos
   * — mismo patrón que `FotoPerfilService.firmarUrls`. Silencioso ante
   * errores (logueados, regla 12): un path que falla simplemente no trae
   * URL, nunca tumba el resto.
   */
  private async firmarUrls(paths: string[]): Promise<Map<string, string>> {
    const resultado = new Map<string, string>();
    if (paths.length === 0) {
      return resultado;
    }
    const client = await this.getClient();
    const { data, error } = await client.storage
      .from(BUCKET_REPORTES_BUG)
      .createSignedUrls(paths, SEGUNDOS_SIGNED_URL);
    if (error || !data) {
      console.error(
        '[SoporteService.firmarUrls] error firmando URLs en batch:',
        error,
      );
      return resultado;
    }
    for (const entrada of data) {
      if (entrada.error || !entrada.signedUrl || !entrada.path) {
        console.error(
          '[SoporteService.firmarUrls] error firmando un path individual:',
          entrada.path,
          entrada.error,
        );
        continue;
      }
      resultado.set(entrada.path, entrada.signedUrl);
    }
    return resultado;
  }

  private async resolverNombreReportante(usuarioId: string): Promise<string> {
    const actor = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: {
        perfilMaestro: { select: { nombres: true, apellidoPaterno: true } },
        perfilAdministrativo: {
          select: { nombres: true, apellidoPaterno: true },
        },
      },
    });
    const perfil = actor?.perfilMaestro ?? actor?.perfilAdministrativo;
    return perfil ? `${perfil.nombres} ${perfil.apellidoPaterno}` : 'Desconocido';
  }

  /**
   * Crea un reporte de bug — rechaza si el bot está desactivado
   * (`SOPORTE_DESACTIVADO`, defensa en profundidad además de que el
   * frontend ya oculta el botón). Sube la captura a Storage si viene, crea
   * el `ReporteBug` (sin auditoría — mismo criterio que `GET
   * /personas/:id`, es autogestión del propio actor). Después, best-effort:
   * intenta avisar por Telegram — un fallo se loguea y NUNCA revierte el
   * reporte ya guardado.
   */
  async crearReporte(
    sedeId: string,
    usuarioId: string,
    descripcion: string,
    file: Express.Multer.File | undefined,
  ): Promise<{ id: string }> {
    const config = await this.obtenerConfig();
    if (!config.activo) {
      throw new ConflictException({
        error: 'El sistema de soporte está desactivado',
        code: 'SOPORTE_DESACTIVADO',
      });
    }

    const id = randomUUID();
    let capturaStoragePath: string | null = null;

    if (file) {
      const extension = MIME_A_EXTENSION[file.mimetype];
      if (!extension) {
        throw new BadRequestException({
          error: 'La captura debe ser JPG, PNG o WEBP',
          code: 'VALIDATION_ERROR',
        });
      }
      capturaStoragePath = `${sedeId}/${id}.${extension}`;
      const client = await this.getClient();
      const { error } = await client.storage
        .from(BUCKET_REPORTES_BUG)
        .upload(capturaStoragePath, file.buffer, {
          contentType: file.mimetype,
        });
      if (error) {
        console.error(
          '[SoporteService.crearReporte] error subiendo captura a Storage:',
          error,
        );
        throw new InternalServerErrorException({
          error: 'No se pudo subir la captura. Intenta de nuevo.',
          code: 'SERVER_ERROR',
        });
      }
    }

    await this.prisma.reporteBug.create({
      data: { id, sedeId, usuarioId, descripcion, capturaStoragePath },
    });

    try {
      const [nombreReportante, sede, capturaUrl] = await Promise.all([
        this.resolverNombreReportante(usuarioId),
        this.prisma.sede.findUniqueOrThrow({
          where: { id: sedeId },
          select: { nombre: true },
        }),
        capturaStoragePath
          ? this.firmarUrls([capturaStoragePath]).then(
              (urls) => urls.get(capturaStoragePath!) ?? null,
            )
          : Promise.resolve(null),
      ]);
      await this.telegramService.enviarReporteBug({
        descripcion,
        nombreReportante,
        sedeNombre: sede.nombre,
        capturaUrl,
      });
    } catch (err) {
      console.error(
        '[SoporteService.crearReporte] error enviando aviso a Telegram (best-effort, el reporte ya quedó guardado):',
        err,
      );
    }

    return { id };
  }

  async listarReportes(
    estatus: EstatusReporteBug | undefined,
    page = 1,
    limit = 20,
  ): Promise<{
    data: {
      id: string;
      sede: { id: string; nombre: string };
      reportante: string;
      descripcion: string;
      capturaUrl: string | null;
      estatus: EstatusReporteBug;
      createdAt: Date;
      updatedAt: Date;
    }[];
    page: number;
    limit: number;
    total: number;
  }> {
    const where = estatus ? { estatus } : {};

    const [filas, total] = await Promise.all([
      this.prisma.reporteBug.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          sede: { select: { id: true, nombre: true } },
          usuario: {
            select: {
              perfilMaestro: { select: { nombres: true, apellidoPaterno: true } },
              perfilAdministrativo: {
                select: { nombres: true, apellidoPaterno: true },
              },
            },
          },
        },
      }),
      this.prisma.reporteBug.count({ where }),
    ]);

    const pathsConCaptura = filas
      .map((f) => f.capturaStoragePath)
      .filter((p): p is string => p !== null);
    const urls = await this.firmarUrls(pathsConCaptura);

    return {
      data: filas.map((f) => {
        const perfil = f.usuario.perfilMaestro ?? f.usuario.perfilAdministrativo;
        return {
          id: f.id,
          sede: f.sede,
          reportante: perfil
            ? `${perfil.nombres} ${perfil.apellidoPaterno}`
            : 'Desconocido',
          descripcion: f.descripcion,
          capturaUrl: f.capturaStoragePath
            ? urls.get(f.capturaStoragePath) ?? null
            : null,
          estatus: f.estatus,
          createdAt: f.createdAt,
          updatedAt: f.updatedAt,
        };
      }),
      page,
      limit,
      total,
    };
  }

  async cambiarEstatus(
    id: string,
    estatus: EstatusReporteBug,
    adminPlataformaId: string,
  ): Promise<{ ok: true }> {
    const reporte = await this.prisma.reporteBug.findUnique({
      where: { id },
      select: { sedeId: true },
    });
    if (!reporte) {
      throw new NotFoundException({
        error: 'Reporte no encontrado',
        code: 'NOT_FOUND',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.reporteBug.update({ where: { id }, data: { estatus } });
      await tx.registroAuditoria.create({
        data: {
          adminPlataformaId,
          sedeId: reporte.sedeId,
          accion: AccionAuditoria.EDICION,
          entidad: 'ReporteBug',
          entidadId: id,
          detalle: { estatus },
        },
      });
    });

    return { ok: true };
  }
}
