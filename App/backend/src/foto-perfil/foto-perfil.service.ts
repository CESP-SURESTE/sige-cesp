import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AccionAuditoria } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * `FotoPerfilService` — feature "Foto de perfil" (2026-09-17).
 *
 * Consumido directo por `PerfilController` (self-service,
 * `POST/DELETE /perfil/foto`) y `PersonasController` (admin sobre otra
 * persona, `POST/DELETE /personas/:id/foto`) — sin controller propio, mismo
 * criterio que `contactos`/`infoMedica` (regla 4 de `CLAUDE.md` raíz:
 * sub-recurso, no ruta raíz independiente).
 *
 * Mismo mecanismo de `import()` dinámico + caché de `createAdminClient` que
 * `MallaCurricularService`/`personas.service.ts` (`@supabase/server` es
 * ESM-only), y mismo patrón de override de cliente para tests
 * (`FOTO_PERFIL_SUPABASE_CLIENT_OVERRIDE`).
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

export const FOTO_PERFIL_SUPABASE_CLIENT_OVERRIDE =
  'FOTO_PERFIL_SUPABASE_CLIENT_OVERRIDE';

/** Bucket privado creado por `prisma/crear-bucket-fotos-perfil.ts`. */
export const BUCKET_FOTOS_PERFIL = 'fotos-perfil';

const TRES_MB = 3 * 1024 * 1024;

const MIME_A_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Firma de 15 minutos (900s) — más larga que los 300s de la malla curricular
 * porque una foto de perfil se re-consulta mucho más seguido (navbar,
 * listados) y no es un documento con datos médicos. */
const SEGUNDOS_SIGNED_URL = 900;

@Injectable()
export class FotoPerfilService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(FOTO_PERFIL_SUPABASE_CLIENT_OVERRIDE)
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
   * Sube/reemplaza la foto de `usuarioId` — llamado tanto para self-service
   * (`usuarioId === actorUsuarioId`) como para un admin subiendo la foto de
   * otra persona; la única diferencia entre ambos casos vive en el
   * controller que llama esto (quién puede invocarlo), no acá.
   *
   * `usuarioId` debe pertenecer a `sedeId` — `404 NOT_FOUND` si no (mismo
   * criterio que `resetearPassword`). Valida tipo de archivo (whitelist de
   * MIME, nunca se confía en la extensión del nombre que manda el cliente).
   *
   * Orden de operaciones (importante — corrige un hallazgo de review):
   * el archivo NUEVO se sube primero (a una ruta distinta si la extensión
   * cambió, el `upsert: true` de Storage solo sobreescribe si la ruta es
   * idéntica — nunca toca el archivo viejo). Si la subida falla, se corta
   * ahí: ni el archivo viejo ni la DB se tocaron. Solo DESPUÉS de que la
   * transacción de DB (`fotoStoragePath` + auditoría) ya confirmó, se borra
   * el archivo viejo (si existía y era una ruta distinta) como limpieza
   * best-effort — evita que un fallo de la subida nueva deje
   * `fotoStoragePath` apuntando a un archivo ya borrado (URL firmada rota,
   * sin error visible para la persona).
   */
  async subir(
    usuarioId: string,
    sedeId: string,
    actorUsuarioId: string,
    file: Express.Multer.File | undefined,
  ): Promise<{ ok: true }> {
    if (!file) {
      throw new BadRequestException({
        error: 'Falta el archivo de la foto',
        code: 'VALIDATION_ERROR',
      });
    }
    const extension = MIME_A_EXTENSION[file.mimetype];
    if (!extension) {
      throw new BadRequestException({
        error: 'La foto debe ser JPG, PNG o WEBP',
        code: 'VALIDATION_ERROR',
      });
    }

    const usuario = await this.prisma.usuario.findFirst({
      where: { id: usuarioId, sedeId },
      select: { fotoStoragePath: true },
    });
    if (!usuario) {
      throw new NotFoundException({
        error: 'Persona no encontrada en tu sede',
        code: 'NOT_FOUND',
      });
    }

    const storagePath = `${usuarioId}/foto.${extension}`;
    const client = await this.getClient();

    // Subir el archivo NUEVO primero — es una ruta distinta a la vieja
    // siempre que la extensión cambió, así que nunca toca el archivo
    // anterior. Si esto falla, se corta acá: ni el archivo viejo ni la DB
    // se tocaron, la persona conserva su foto anterior intacta.
    const { error } = await client.storage
      .from(BUCKET_FOTOS_PERFIL)
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });
    if (error) {
      console.error('[FotoPerfilService.subir] error subiendo a Storage:', error);
      throw new InternalServerErrorException({
        error: 'No se pudo subir la foto. Intenta de nuevo.',
        code: 'SERVER_ERROR',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.usuario.update({
        where: { id: usuarioId },
        data: { fotoStoragePath: storagePath },
      });
      await tx.registroAuditoria.create({
        data: {
          usuarioId: actorUsuarioId,
          sedeId,
          accion: AccionAuditoria.EDICION,
          entidad: 'Usuario',
          entidadId: usuarioId,
          detalle: { accion: 'foto_perfil_actualizada' },
        },
      });
    });

    // Limpieza del archivo viejo — SOLO después de que el archivo nuevo ya
    // subió Y la DB ya quedó consistente (fotoStoragePath apuntando al
    // nuevo path). Best-effort, mismo criterio que `eliminar()`: si falla,
    // se loguea completo (regla 12) pero no se lanza — para este punto la
    // DB ya está correcta, un archivo viejo huérfano en Storage no es un
    // problema visible para nadie.
    if (usuario.fotoStoragePath && usuario.fotoStoragePath !== storagePath) {
      const { error: errorLimpieza } = await client.storage
        .from(BUCKET_FOTOS_PERFIL)
        .remove([usuario.fotoStoragePath]);
      if (errorLimpieza) {
        console.error(
          '[FotoPerfilService.subir] error borrando la foto vieja de Storage (se deja huérfana, la DB ya quedó consistente):',
          errorLimpieza,
        );
      }
    }

    return { ok: true };
  }

  /**
   * Quita la foto de `usuarioId` (vuelve al avatar de iniciales en el
   * frontend). El borrado en Storage es best-effort — si falla, se loguea
   * completo (regla 12) pero igual se limpia `fotoStoragePath`: el objetivo
   * (que la persona deje de ver esa foto) se cumple aunque quede un archivo
   * huérfano en el bucket, que no es un problema visible para nadie.
   */
  async eliminar(
    usuarioId: string,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<{ ok: true }> {
    const usuario = await this.prisma.usuario.findFirst({
      where: { id: usuarioId, sedeId },
      select: { fotoStoragePath: true },
    });
    if (!usuario) {
      throw new NotFoundException({
        error: 'Persona no encontrada en tu sede',
        code: 'NOT_FOUND',
      });
    }

    if (usuario.fotoStoragePath) {
      const client = await this.getClient();
      const { error } = await client.storage
        .from(BUCKET_FOTOS_PERFIL)
        .remove([usuario.fotoStoragePath]);
      if (error) {
        console.error(
          '[FotoPerfilService.eliminar] error borrando de Storage (se limpia igual el campo):',
          error,
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.usuario.update({
        where: { id: usuarioId },
        data: { fotoStoragePath: null },
      });
      await tx.registroAuditoria.create({
        data: {
          usuarioId: actorUsuarioId,
          sedeId,
          accion: AccionAuditoria.EDICION,
          entidad: 'Usuario',
          entidadId: usuarioId,
          detalle: { accion: 'foto_perfil_eliminada' },
        },
      });
    });

    return { ok: true };
  }

  /**
   * Firma en batch (`createSignedUrls`, plural — UNA sola llamada a
   * Storage) las URLs de todos los `storagePath` recibidos, devuelve un
   * `Map<usuarioId, url>`. Si Storage rechaza todo el batch, o un path
   * individual falla, se loguea completo (regla 12) y esa(s) persona(s)
   * simplemente no traen `fotoUrl` en la respuesta — nunca tumba la
   * request completa por un problema de firma.
   */
  async firmarUrls(
    items: { usuarioId: string; storagePath: string }[],
  ): Promise<Map<string, string>> {
    const resultado = new Map<string, string>();
    if (items.length === 0) {
      return resultado;
    }

    const client = await this.getClient();
    const { data, error } = await client.storage
      .from(BUCKET_FOTOS_PERFIL)
      .createSignedUrls(
        items.map((item) => item.storagePath),
        SEGUNDOS_SIGNED_URL,
      );
    if (error || !data) {
      console.error(
        '[FotoPerfilService.firmarUrls] error firmando URLs en batch:',
        error,
      );
      return resultado;
    }

    const pathAUsuarioId = new Map(
      items.map((item) => [item.storagePath, item.usuarioId]),
    );
    for (const entrada of data) {
      if (entrada.error || !entrada.signedUrl || !entrada.path) {
        console.error(
          '[FotoPerfilService.firmarUrls] error firmando un path individual:',
          entrada.path,
          entrada.error,
        );
        continue;
      }
      const usuarioId = pathAUsuarioId.get(entrada.path);
      if (usuarioId) {
        resultado.set(usuarioId, entrada.signedUrl);
      }
    }
    return resultado;
  }
}
