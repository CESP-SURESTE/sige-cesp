# Foto de Perfil (Alumno/Maestro/Administrativo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar que alumnos, maestros y administrativos suban/reemplacen/quiten una foto de perfil (ellos mismos o un administrativo por ellos), visible en el navbar, en los listados de administrativos y en el expediente de emergencia.

**Architecture:** Campo nuevo `Usuario.fotoStoragePath` (nullable). Bucket privado nuevo de Supabase Storage `fotos-perfil`, ruta fija `{usuarioId}/foto.{ext}` (upsert). `FotoPerfilService` nuevo (`subir`/`eliminar`/`firmarUrls` en batch) consumido directo por `PerfilController` (self-service) y `PersonasController` (admin sobre otra persona) — sin controller propio. `fotoUrl` (signed URL, 15 min) se embebe en las respuestas que YA existen (`GET /perfil`, `GET /personas`, `GET /emergencia/expediente/...`), nunca en un endpoint aparte.

**Tech Stack:** NestJS + Prisma + Supabase Storage (backend), Next.js + React Query + `XMLHttpRequest` con progreso (frontend, mismo patrón que `subirMallaCurricular`).

## Global Constraints

- Alcance: SOLO `ALUMNO`/`MAESTRO`/`ADMINISTRATIVO`. `PersonalServicios` y `AdminPlataforma` quedan fuera — no tocar esos flujos.
- Tipos de archivo permitidos: `image/jpeg`, `image/png`, `image/webp`. Cualquier otro → `400 VALIDATION_ERROR`.
- Límite de tamaño: 3MB (`TRES_MB = 3 * 1024 * 1024`). Exceso → `400 VALIDATION_ERROR` (vía filter de `PayloadTooLargeException`, no un 413 genérico).
- Storage: bucket privado `fotos-perfil`, ruta `{usuarioId}/foto.{ext}`, `upsert: true`. Auditoría de subir/eliminar reusa `AccionAuditoria.EDICION` — NO se agrega un valor de enum nuevo.
- `fotoUrl` (signed URL) expira en 900s (15 min) — SIEMPRE se firma en batch (`createSignedUrls`, plural) cuando hay más de 1 persona en la respuesta, nunca N llamadas individuales.
- Sin crop/resize, sin historial de fotos anteriores — cada subida reemplaza a la anterior sin dejar rastro.
- `sedeId` siempre sale de `@SedeActual()` (JWT), `actorUsuarioId` siempre de `@ActorUsuarioId()` — nunca de body/param, mismo criterio que el resto del backend.
- Regla 11 (`CLAUDE.md` raíz): CERO imports cruzados entre `components/admin/`, `components/alumno/`, `components/maestro/`.

---

## Task 1: Backend — Schema, migración y bucket de Storage

**Files:**
- Modify: `App/backend/prisma/schema.prisma` (modelo `Usuario`)
- Create: `App/backend/prisma/migrations/20260917150000_foto_storage_path_usuario/migration.sql`
- Create: `App/backend/prisma/crear-bucket-fotos-perfil.ts`

**Interfaces:**
- Produces: columna `usuarios.foto_storage_path` (nullable) y bucket Storage `fotos-perfil` — los consume `FotoPerfilService` en el Task 2.

- [ ] **Step 1: Agregar el campo al schema**

En `App/backend/prisma/schema.prisma`, dentro de `model Usuario { ... }`, agregar la columna junto a los demás campos simples (después de `ultimoAcceso`, antes de `createdAt`):

```prisma
model Usuario {
  id            String     @id
  email         String     @unique
  rol           RolUsuario
  sedeId        String     @map("sede_id")
  sede          Sede       @relation(fields: [sedeId], references: [id])
  codigoExterno String?    @unique @map("codigo_externo")
  primerIngreso Boolean    @default(true) @map("primer_ingreso")
  activo        Boolean    @default(true)
  ultimoAcceso  DateTime?  @map("ultimo_acceso")
  /// Ruta dentro del bucket privado `fotos-perfil` (`{usuarioId}/foto.{ext}`),
  /// NUNCA una URL — las URLs firmadas se generan al vuelo por request
  /// (`FotoPerfilService.firmarUrls`). `null` = sin foto subida, cae al
  /// avatar de iniciales en el frontend. Sin backfill para altas anteriores
  /// (mismo criterio que `tipoSangre`/`tipoLicencia`).
  fotoStoragePath String?  @map("foto_storage_path")
  createdAt     DateTime   @default(now()) @map("created_at")
  updatedAt     DateTime   @updatedAt @map("updated_at")

  perfilAlumno         PerfilAlumno?
  perfilMaestro        PerfilMaestro?
  perfilAdministrativo PerfilAdministrativo?
  mallasSubidas        MallaCurricular[]
  registrosAuditoria   RegistroAuditoria[]
  notificaciones       Notificacion[]
  eventosCreados       EventoCalendario[]
  avisosCreados        Aviso[]

  @@map("usuarios")
}
```

- [ ] **Step 2: Escribir la migración a mano**

`prisma migrate dev` está roto en este repo (`P3006`, shadow-DB) — mismo flujo ya usado para las migraciones recientes (`tipo_contratacion_maestro`, `sede_activa`, etc.): crear la carpeta y el SQL a mano.

Crear `App/backend/prisma/migrations/20260917150000_foto_storage_path_usuario/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN "foto_storage_path" TEXT;
```

- [ ] **Step 3: Aplicar la migración contra la DB de dev y regenerar el cliente**

Run: `cd App/backend && npx prisma migrate resolve --applied 20260917150000_foto_storage_path_usuario 2>&1 || true`

Esto solo registra el estado si Prisma ya detectó la migración aplicada por otra vía; el paso real es:

Run: `cd App/backend && npx prisma db execute --file prisma/migrations/20260917150000_foto_storage_path_usuario/migration.sql --schema prisma/schema.prisma`

Expected: sin error. Luego:

Run: `cd App/backend && npx prisma generate`

Expected: `Generated Prisma Client` sin error — `PrismaClient` ahora tipa `fotoStoragePath` en `Usuario`.

Run: `cd App/backend && npx prisma migrate resolve --applied 20260917150000_foto_storage_path_usuario`

Expected: `Migration ... marked as applied` — deja la tabla `_prisma_migrations` en sync para que futuros `migrate deploy` (Día 50) no intenten reaplicarla.

- [ ] **Step 4: Script permanente del bucket**

Crear `App/backend/prisma/crear-bucket-fotos-perfil.ts` (calco exacto de `crear-bucket-malla.ts`, NO es un script `-tmp.ts`):

```ts
/**
 * Bootstrap del bucket de Storage para fotos de perfil — feature "Foto de
 * perfil" (2026-09-17). Permanente, idempotente y repetible (mismo criterio
 * que `crear-bucket-malla.ts`/`seed.ts`).
 *
 * Uso: `npx ts-node prisma/crear-bucket-fotos-perfil.ts`
 */
import { loadEnv } from '../src/load-env';

loadEnv();

const NOMBRE_BUCKET = 'fotos-perfil';

async function main() {
  const { createAdminClient } = await import('@supabase/server/core');
  const client = createAdminClient();

  const { data: existente } = await client.storage.getBucket(NOMBRE_BUCKET);
  if (existente) {
    console.log(`Bucket "${NOMBRE_BUCKET}" ya existe, nada que hacer.`);
    return;
  }

  const { error } = await client.storage.createBucket(NOMBRE_BUCKET, {
    public: false,
    fileSizeLimit: '3MB',
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  });
  if (error) {
    throw new Error(
      `Error creando el bucket "${NOMBRE_BUCKET}": ${error.message}`,
    );
  }
  console.log(
    `Bucket "${NOMBRE_BUCKET}" creado (privado, 3MB, jpeg/png/webp).`,
  );
}

main().catch((e: unknown) => {
  console.error('Error en crear-bucket-fotos-perfil:', e);
  process.exit(1);
});
```

Run: `cd App/backend && npx ts-node prisma/crear-bucket-fotos-perfil.ts`

Expected: `Bucket "fotos-perfil" creado (privado, 3MB, jpeg/png/webp).` (o "ya existe" si se re-corre).

- [ ] **Step 5: Confirmar que el build sigue limpio**

Run: `cd App/backend && npx nest build`

Expected: sin errores de TypeScript (el campo nuevo ya está tipado por Prisma Client).

- [ ] **Step 6: Commit**

```bash
git add App/backend/prisma/schema.prisma App/backend/prisma/migrations/20260917150000_foto_storage_path_usuario App/backend/prisma/crear-bucket-fotos-perfil.ts
git commit -m "feat(backend): agrega Usuario.fotoStoragePath + bucket fotos-perfil"
```

---

## Task 2: Backend — `FotoPerfilService` + self-service (`POST/DELETE /perfil/foto`) + `fotoUrl` en `GET /perfil`

**Files:**
- Create: `App/backend/src/foto-perfil/foto-perfil.service.ts`
- Create: `App/backend/src/foto-perfil/foto-perfil.module.ts`
- Create: `App/backend/src/foto-perfil/archivo-foto-invalida.filter.ts`
- Modify: `App/backend/src/perfil/perfil.module.ts`
- Modify: `App/backend/src/perfil/perfil.controller.ts`
- Modify: `App/backend/src/perfil/perfil.service.ts`
- Create: `App/backend/test/foto-perfil.e2e-spec.ts`

**Interfaces:**
- Produces: `FotoPerfilService.subir(usuarioId, sedeId, actorUsuarioId, file): Promise<{ ok: true }>`, `.eliminar(usuarioId, sedeId, actorUsuarioId): Promise<{ ok: true }>`, `.firmarUrls(items: { usuarioId: string; storagePath: string }[]): Promise<Map<string, string>>`, constante `BUCKET_FOTOS_PERFIL`, token `FOTO_PERFIL_SUPABASE_CLIENT_OVERRIDE`. Consumido por Task 3 (`PersonasController`/`PersonasService`) y Task 4 (`EmergenciaService`).
- Consumes: nada nuevo — mismo patrón de `import()` dinámico de `@supabase/server/core` que `MallaCurricularService`.

- [ ] **Step 1: Filter de archivo inválido (local a este módulo, NO compartido con malla-curricular)**

Crear `App/backend/src/foto-perfil/archivo-foto-invalida.filter.ts`:

```ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * Mismo problema/solución que `malla-curricular/archivo-muy-grande.filter.ts`
 * (`FileInterceptor` rechaza el archivo DENTRO de multer con
 * `PayloadTooLargeException`, que sin este filter escapa al contrato
 * `{ error, code }`) — copia local con el límite/mensaje de foto (3MB), no
 * se comparte con malla-curricular (mensajes distintos, y este proyecto
 * prefiere una copia chica por dominio a una generalización prematura con
 * un solo caso más — mismo criterio que `SubirMallaModal.tsx`).
 */
@Catch(PayloadTooLargeException)
export class ArchivoFotoInvalidaFilter implements ExceptionFilter {
  catch(exception: PayloadTooLargeException, host: ArgumentsHost): void {
    console.error(
      '[FotoPerfil] archivo excede el límite de 3MB:',
      exception.message,
    );
    const response = host.switchToHttp().getResponse<Response>();
    response.status(400).json({
      error: 'La foto no puede pesar más de 3MB',
      code: 'VALIDATION_ERROR',
    });
  }
}
```

- [ ] **Step 2: `FotoPerfilService`**

Crear `App/backend/src/foto-perfil/foto-perfil.service.ts`:

```ts
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
   * Si la persona ya tenía una foto con OTRA extensión, borra el archivo
   * viejo antes de subir el nuevo (el `upsert: true` de Storage solo
   * sobreescribe si la ruta es idéntica).
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

    if (usuario.fotoStoragePath && usuario.fotoStoragePath !== storagePath) {
      await client.storage
        .from(BUCKET_FOTOS_PERFIL)
        .remove([usuario.fotoStoragePath]);
    }

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
      if (entrada.error || !entrada.signedUrl) {
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
```

- [ ] **Step 3: `FotoPerfilModule`**

Crear `App/backend/src/foto-perfil/foto-perfil.module.ts`:

```ts
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
```

- [ ] **Step 4: `PerfilModule` importa `FotoPerfilModule`**

Modificar `App/backend/src/perfil/perfil.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { FotoPerfilModule } from '../foto-perfil/foto-perfil.module';
import { MallaCurricularModule } from '../malla-curricular/malla-curricular.module';
import { PerfilController } from './perfil.controller';
import { PerfilService } from './perfil.service';

@Module({
  imports: [MallaCurricularModule, FotoPerfilModule],
  controllers: [PerfilController],
  providers: [PerfilService],
})
export class PerfilModule {}
```

- [ ] **Step 5: `PerfilController` — `POST/DELETE /perfil/foto`**

Modificar `App/backend/src/perfil/perfil.controller.ts` — agregar imports y los 2 endpoints nuevos, inyectar `FotoPerfilService` en el constructor (mismo patrón que `MallaCurricularService` ya inyectado ahí):

```ts
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
```

(No se declara `@Roles(...)` en `foto`, mismo criterio que `GET /perfil`/`PATCH /auth/cambiar-password`: cualquier rol autenticado gestiona su propia foto.)

- [ ] **Step 6: `fotoUrl` en `GET /perfil`**

Modificar `App/backend/src/perfil/perfil.service.ts`. Inyectar `FotoPerfilService` en el constructor:

```ts
constructor(
  private readonly prisma: PrismaService,
  private readonly fotoPerfilService: FotoPerfilService,
) {}
```

(agregar `import { FotoPerfilService } from '../foto-perfil/foto-perfil.service';` al inicio del archivo.)

En el `select` del `usuario.findUnique` dentro de `obtenerPerfilPropio`, agregar `fotoStoragePath: true` junto a los demás campos simples (después de `ultimoAcceso: true,`):

```ts
        ultimoAcceso: true,
        fotoStoragePath: true,
        sede: {
```

Al final del método, ANTES del `const { perfilAlumno, perfilMaestro, perfilAdministrativo, ...usuarioComun } = usuario;`, resolver la URL:

```ts
    const fotoUrl = usuario.fotoStoragePath
      ? (
          await this.fotoPerfilService.firmarUrls([
            { usuarioId: usuario.id, storagePath: usuario.fotoStoragePath },
          ])
        ).get(usuario.id) ?? null
      : null;

    const {
      perfilAlumno,
      perfilMaestro,
      perfilAdministrativo,
      fotoStoragePath: _fotoStoragePathSinUsar,
      ...usuarioComun
    } = usuario;
```

Y en el `return`, agregar `fotoUrl` a la raíz (mismo nivel que `sede`):

```ts
    return {
      ...usuarioComun,
      fotoUrl,
      alumno:
```

(`fotoStoragePath` se destructura fuera para que NUNCA se filtre la ruta interna de Storage en la respuesta — solo la URL firmada, mismo criterio ya usado con `perfilAlumno`/`perfilMaestro`/`perfilAdministrativo`.)

- [ ] **Step 7: Escribir los tests e2e — self-service**

Crear `App/backend/test/foto-perfil.e2e-spec.ts` (mismo patrón exacto de `test/malla-curricular.e2e-spec.ts`: JWT firmado con `jose`, cliente de Storage mockeado vía `FOTO_PERFIL_SUPABASE_CLIENT_OVERRIDE`):

```ts
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { RolUsuario } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { SEDE_GUARD_ENV_OVERRIDE } from '../src/common/guards/sede.guard';
import { FOTO_PERFIL_SUPABASE_CLIENT_OVERRIDE } from '../src/foto-perfil/foto-perfil.service';
import { loadEnv } from '../src/load-env';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup-app';

loadEnv();

interface ErrorBody {
  error: string;
  code: string;
}
interface OkBody {
  data: { ok: true };
}

describe('FotoPerfil — POST/DELETE /perfil/foto y /personas/:id/foto (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let sedeValladolidId: string;
  let alumnoMeridaId: string;
  let adminMeridaId: string;
  let adminValladolidId: string;
  let upload: jest.Mock;
  let remove: jest.Mock;
  let createSignedUrls: jest.Mock;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';

  async function firmarToken(claims: Record<string, unknown>, subject: string): Promise<string> {
    return new jose.SignJWT(claims)
      .setProtectedHeader({ alg, kid })
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  beforeAll(async () => {
    jose = await import('jose');
    const keyPair = await jose.generateKeyPair(alg, { extractable: true });
    privateKey = keyPair.privateKey;
    const publicJwk = await jose.exportJWK(keyPair.publicKey);
    publicJwk.kid = kid;
    publicJwk.alg = alg;
    publicJwk.use = 'sig';

    upload = jest.fn().mockResolvedValue({ data: { path: 'x' }, error: null });
    remove = jest.fn().mockResolvedValue({ data: [], error: null });
    createSignedUrls = jest.fn().mockImplementation((paths: string[]) =>
      Promise.resolve({
        data: paths.map((path) => ({
          path,
          signedUrl: `https://storage.example.com/signed/${path}`,
          error: null,
        })),
        error: null,
      }),
    );
    const mockSupabaseAdminClient = {
      storage: { from: () => ({ upload, remove, createSignedUrls }) },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SEDE_GUARD_ENV_OVERRIDE)
      .useValue({ jwks: { keys: [publicJwk] } })
      .overrideProvider(FOTO_PERFIL_SUPABASE_CLIENT_OVERRIDE)
      .useValue(mockSupabaseAdminClient)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    const merida = await prisma.sede.findUniqueOrThrow({ where: { nombre: 'CESP Mérida' } });
    sedeMeridaId = merida.id;
    const valladolid = await prisma.sede.findUniqueOrThrow({ where: { nombre: 'CESP Valladolid' } });
    sedeValladolidId = valladolid.id;
    const alumno = await prisma.usuario.findUniqueOrThrow({ where: { email: 'luis.chan@cesp-merida.edu.mx' } });
    alumnoMeridaId = alumno.id;
    const adminMerida = await prisma.usuario.findUniqueOrThrow({ where: { email: 'ana.canul@cesp-merida.edu.mx' } });
    adminMeridaId = adminMerida.id;
    const adminValladolid = await prisma.usuario.findUniqueOrThrow({ where: { email: 'jorge.ek@cesp-valladolid.edu.mx' } });
    adminValladolidId = adminValladolid.id;
  });

  afterEach(() => {
    upload.mockClear();
    remove.mockClear();
    createSignedUrls.mockClear();
  });

  afterAll(async () => {
    await prisma.registroAuditoria.deleteMany({
      where: { entidad: 'Usuario', detalle: { path: ['accion'], string_contains: 'foto_perfil' } },
    });
    await prisma.usuario.updateMany({
      where: { id: { in: [alumnoMeridaId, adminMeridaId, adminValladolidId] } },
      data: { fotoStoragePath: null },
    });
    await app.close();
  });

  it('POST /perfil/foto sube la foto propia del alumno', async () => {
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ALUMNO },
      alumnoMeridaId,
    );

    const res = await request(app.getHttpServer())
      .post('/perfil/foto')
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', Buffer.from('contenido jpg de prueba'), {
        filename: 'foto.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(200);
    expect((res.body as OkBody).data).toEqual({ ok: true });
    expect(upload).toHaveBeenCalledWith(
      `${alumnoMeridaId}/foto.jpg`,
      expect.any(Buffer),
      { contentType: 'image/jpeg', upsert: true },
    );

    const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: alumnoMeridaId } });
    expect(usuario.fotoStoragePath).toBe(`${alumnoMeridaId}/foto.jpg`);

    const registro = await prisma.registroAuditoria.findFirst({
      where: { entidad: 'Usuario', entidadId: alumnoMeridaId, accion: 'EDICION' },
      orderBy: { createdAt: 'desc' },
    });
    expect(registro?.usuarioId).toBe(alumnoMeridaId);
  });

  it('POST /perfil/foto con un tipo de archivo inválido responde 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ALUMNO },
      alumnoMeridaId,
    );

    const res = await request(app.getHttpServer())
      .post('/perfil/foto')
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', Buffer.from('no es una imagen'), {
        filename: 'archivo.txt',
        contentType: 'text/plain',
      });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
    expect(upload).not.toHaveBeenCalled();
  });

  it('GET /perfil trae fotoUrl null si no hay foto, y la URL firmada tras subir una', async () => {
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeValladolidId, rol: RolUsuario.ADMINISTRATIVO },
      adminValladolidId,
    );

    const antes = await request(app.getHttpServer())
      .get('/perfil')
      .set('Authorization', `Bearer ${token}`);
    expect((antes.body as { data: { fotoUrl: string | null } }).data.fotoUrl).toBeNull();

    await request(app.getHttpServer())
      .post('/perfil/foto')
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', Buffer.from('contenido png de prueba'), {
        filename: 'foto.png',
        contentType: 'image/png',
      });

    const despues = await request(app.getHttpServer())
      .get('/perfil')
      .set('Authorization', `Bearer ${token}`);
    const body = despues.body as { data: { fotoUrl: string | null } };
    expect(body.data.fotoUrl).toBe(
      `https://storage.example.com/signed/${adminValladolidId}/foto.png`,
    );
  });

  it('DELETE /perfil/foto quita la foto y GET /perfil vuelve a traer fotoUrl null', async () => {
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ALUMNO },
      alumnoMeridaId,
    );

    await request(app.getHttpServer())
      .post('/perfil/foto')
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', Buffer.from('x'), { filename: 'foto.webp', contentType: 'image/webp' });

    const del = await request(app.getHttpServer())
      .delete('/perfil/foto')
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect(remove).toHaveBeenCalled();

    const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: alumnoMeridaId } });
    expect(usuario.fotoStoragePath).toBeNull();
  });
});
```

- [ ] **Step 8: Correr la suite nueva**

Run: `cd App/backend && npx jest test/foto-perfil.e2e-spec.ts --runInBand`

Expected: 4/4 tests en verde. Si falla por cuentas seed faltantes, correr primero `SEED_DEMO_PASSWORD=<valor> npx ts-node prisma/seed.ts` contra la DB de test/dev.

- [ ] **Step 9: Correr la regresión completa del backend**

Run: `cd App/backend && npx nest build && npm run test:e2e`

Expected: build limpio, todas las suites en verde (ninguna existente debería romperse — solo se agregaron campos/rutas nuevas).

- [ ] **Step 10: Commit**

```bash
git add App/backend/src/foto-perfil App/backend/src/perfil App/backend/test/foto-perfil.e2e-spec.ts
git commit -m "feat(backend): FotoPerfilService + self-service /perfil/foto + fotoUrl en GET /perfil"
```

---

## Task 3: Backend — Admin (`POST/DELETE /personas/:id/foto`) + `fotoUrl` en `GET /personas`

**Files:**
- Modify: `App/backend/src/personas/personas.module.ts`
- Modify: `App/backend/src/personas/personas.controller.ts`
- Modify: `App/backend/src/personas/personas.service.ts`
- Modify: `App/backend/test/foto-perfil.e2e-spec.ts`

**Interfaces:**
- Consumes: `FotoPerfilService.subir`/`.eliminar`/`.firmarUrls` (Task 2).
- Produces: `fotoUrl: string | null` agregado a `PersonaListItemAlumno`, `PersonaListItemMaestro`, `PersonaListItemAdministrativo` — lo consume el Task 7 del frontend.

- [ ] **Step 1: `PersonasModule` importa `FotoPerfilModule`**

Modificar `App/backend/src/personas/personas.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { FotoPerfilModule } from '../foto-perfil/foto-perfil.module';
import { MailModule } from '../mail/mail.module';
import { PersonasController } from './personas.controller';
import {
  PERSONAS_SUPABASE_CLIENT_OVERRIDE,
  PersonasService,
} from './personas.service';

@Module({
  imports: [MailModule, FotoPerfilModule],
  controllers: [PersonasController],
  providers: [
    PersonasService,
    { provide: PERSONAS_SUPABASE_CLIENT_OVERRIDE, useValue: undefined },
  ],
  exports: [PersonasService, PERSONAS_SUPABASE_CLIENT_OVERRIDE],
})
export class PersonasModule {}
```

- [ ] **Step 2: `PersonasController` — `POST/DELETE /personas/:id/foto`**

Modificar `App/backend/src/personas/personas.controller.ts` — agregar imports, inyectar `FotoPerfilService`, agregar los 2 endpoints al final de la clase (después de `resetearPassword`):

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
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
import { CambiarEstatusDto } from './dto/cambiar-estatus.dto';
import { CrearPersonaDto } from './dto/crear-persona.dto';
import { ListarPersonasQueryDto } from './dto/listar-personas.query.dto';
import { PersonasService } from './personas.service';

const TRES_MB = 3 * 1024 * 1024;

@Controller('personas')
@UseGuards(SedeGuard, RolesGuard)
export class PersonasController {
  constructor(
    private readonly personasService: PersonasService,
    private readonly fotoPerfilService: FotoPerfilService,
  ) {}

  // ...crear/listar/resumen/cambiarEstatus/resetearPassword sin cambios...

  @Post(':id/foto')
  @HttpCode(HttpStatus.OK)
  @Roles(RolUsuario.ADMINISTRATIVO)
  @UseInterceptors(
    FileInterceptor('archivo', { limits: { fileSize: TRES_MB } }),
  )
  @UseFilters(ArchivoFotoInvalidaFilter)
  async subirFotoPersona(
    @Param('id') id: string,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const data = await this.fotoPerfilService.subir(
      id,
      sedeId,
      actorUsuarioId,
      file,
    );
    return { data };
  }

  @Delete(':id/foto')
  @HttpCode(HttpStatus.OK)
  @Roles(RolUsuario.ADMINISTRATIVO)
  async eliminarFotoPersona(
    @Param('id') id: string,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    const data = await this.fotoPerfilService.eliminar(
      id,
      sedeId,
      actorUsuarioId,
    );
    return { data };
  }
}
```

(Sin jerarquía de `nivelPermiso` — mismo criterio que `POST /grupos`/`POST /carreras`: subir una foto no cambia permisos ni estatus de la cuenta objetivo.)

- [ ] **Step 3: `fotoUrl` en las 3 ramas de `listarPorSedeYRol`**

Modificar `App/backend/src/personas/personas.service.ts`.

Agregar `fotoUrl: string | null;` a las 3 interfaces (después de `activo: boolean;` en cada una):

```ts
export interface PersonaListItemAlumno {
  // ...campos existentes...
  activo: boolean;
  fotoUrl: string | null;
}

export interface PersonaListItemMaestro {
  // ...campos existentes...
  activo: boolean;
  fotoUrl: string | null;
}

export interface PersonaListItemAdministrativo {
  // ...campos existentes...
  activo: boolean;
  fotoUrl: string | null;
}
```

Inyectar `FotoPerfilService` en el constructor (junto a `mailService`):

```ts
constructor(
  private readonly prisma: PrismaService,
  private readonly mailService: MailService,
  private readonly fotoPerfilService: FotoPerfilService,
  @Optional()
  @Inject(PERSONAS_SUPABASE_CLIENT_OVERRIDE)
  private readonly clientOverride?: SupabaseAdminClient,
) {}
```

(agregar `import { FotoPerfilService } from '../foto-perfil/foto-perfil.service';` al inicio del archivo.)

Agregar un helper privado, cerca de `listarPorSedeYRol`:

```ts
  /**
   * Firma en batch (`FotoPerfilService.firmarUrls`) las fotos de una página
   * de resultados — filtra primero a quienes SÍ tienen `fotoStoragePath`
   * (nunca se firma de más), y solo de la página actual, nunca de toda la
   * tabla.
   */
  private async resolverFotosPerfil(
    items: { usuarioId: string; fotoStoragePath: string | null }[],
  ): Promise<Map<string, string>> {
    const conFoto = items.filter(
      (item): item is { usuarioId: string; fotoStoragePath: string } =>
        item.fotoStoragePath !== null,
    );
    if (conFoto.length === 0) {
      return new Map();
    }
    return this.fotoPerfilService.firmarUrls(
      conFoto.map((item) => ({
        usuarioId: item.usuarioId,
        storagePath: item.fotoStoragePath,
      })),
    );
  }
```

**Rama ALUMNO** — en el `select` del `perfilAlumno.findMany`, agregar `fotoStoragePath: true` dentro de `usuario: { select: { activo: true, fotoStoragePath: true } }`. Antes del `return`, resolver el batch y mapear:

```ts
      const fotosUrl = await this.resolverFotosPerfil(
        alumnos.map((alumno) => ({
          usuarioId: alumno.usuarioId,
          fotoStoragePath: alumno.usuario.fotoStoragePath,
        })),
      );

      return {
        data: alumnos.map((alumno) => ({
          usuarioId: alumno.usuarioId,
          nombres: alumno.nombres,
          apellidoPaterno: alumno.apellidoPaterno,
          apellidoMaterno: alumno.apellidoMaterno,
          matricula: alumno.matricula,
          carrera: alumno.carrera,
          estatusAcademico: alumno.estatusAcademico,
          cuatrimestreActual: alumno.cuatrimestreActual,
          activo: alumno.usuario.activo,
          fotoUrl: fotosUrl.get(alumno.usuarioId) ?? null,
        })),
        page,
        limit,
        total,
      };
```

**Rama MAESTRO** — mismo cambio: `usuario: { select: { activo: true, fotoStoragePath: true } }` en el `select`, batch antes del `return`, `fotoUrl: fotosUrl.get(maestro.usuarioId) ?? null` agregado al `map`.

**Rama ADMINISTRATIVO (`listarAdministrativos`)** — mismo cambio, dentro del método privado: agregar `fotoStoragePath: true` al `select.usuario`, batch antes del `return`, `fotoUrl` en el `map`.

- [ ] **Step 4: Agregar casos de test al spec de Task 2**

En `App/backend/test/foto-perfil.e2e-spec.ts`, agregar al final del `describe` (antes del cierre):

```ts
  it('POST /personas/:id/foto (admin) sube la foto de otra persona de su sede', async () => {
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO },
      adminMeridaId,
    );

    const res = await request(app.getHttpServer())
      .post(`/personas/${alumnoMeridaId}/foto`)
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', Buffer.from('contenido jpg de prueba'), {
        filename: 'foto.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(200);
    const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: alumnoMeridaId } });
    expect(usuario.fotoStoragePath).toBe(`${alumnoMeridaId}/foto.jpg`);
  });

  it('POST /personas/:id/foto contra una persona de OTRA sede responde 404 NOT_FOUND', async () => {
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeValladolidId, rol: RolUsuario.ADMINISTRATIVO },
      adminValladolidId,
    );

    const res = await request(app.getHttpServer())
      .post(`/personas/${alumnoMeridaId}/foto`)
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', Buffer.from('x'), { filename: 'foto.png', contentType: 'image/png' });

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('GET /personas?rol=ADMINISTRATIVO trae fotoUrl en el listado tras subir una foto', async () => {
    const tokenSubida = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO },
      adminMeridaId,
    );
    await request(app.getHttpServer())
      .post(`/personas/${adminMeridaId}/foto`)
      .set('Authorization', `Bearer ${tokenSubida}`)
      .attach('archivo', Buffer.from('x'), { filename: 'foto.png', contentType: 'image/png' });

    const res = await request(app.getHttpServer())
      .get('/personas?rol=ADMINISTRATIVO')
      .set('Authorization', `Bearer ${tokenSubida}`);

    expect(res.status).toBe(200);
    interface ListaBody {
      data: { usuarioId: string; fotoUrl: string | null }[];
    }
    const item = (res.body as ListaBody).data.find((p) => p.usuarioId === adminMeridaId);
    expect(item?.fotoUrl).toBe(`https://storage.example.com/signed/${adminMeridaId}/foto.png`);
  });
```

- [ ] **Step 5: Correr la suite y la regresión completa**

Run: `cd App/backend && npx jest test/foto-perfil.e2e-spec.ts --runInBand`

Expected: 7/7 en verde.

Run: `cd App/backend && npx nest build && npm run test:e2e`

Expected: todo en verde.

- [ ] **Step 6: Commit**

```bash
git add App/backend/src/personas App/backend/test/foto-perfil.e2e-spec.ts
git commit -m "feat(backend): admin sube/quita foto de otra persona + fotoUrl en GET /personas"
```

---

## Task 4: Backend — `fotoUrl` en `GET /emergencia/expediente/:tipo/:perfilId`

**Files:**
- Modify: `App/backend/src/emergencia/emergencia.module.ts`
- Modify: `App/backend/src/emergencia/emergencia.service.ts`
- Modify: `App/backend/test/foto-perfil.e2e-spec.ts`

**Interfaces:**
- Consumes: `FotoPerfilService.firmarUrls` (Task 2).
- Produces: `ExpedienteEmergencia.identidad.fotoUrl: string | null` — lo consume el Task 8 del frontend.

- [ ] **Step 1: `EmergenciaModule` importa `FotoPerfilModule`**

Modificar `App/backend/src/emergencia/emergencia.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { FotoPerfilModule } from '../foto-perfil/foto-perfil.module';
import { EmergenciaController } from './emergencia.controller';
import { EmergenciaService } from './emergencia.service';

@Module({
  imports: [FotoPerfilModule],
  controllers: [EmergenciaController],
  providers: [EmergenciaService],
})
export class EmergenciaModule {}
```

- [ ] **Step 2: `fotoUrl` en `ExpedienteEmergencia.identidad` y en `cargarExpediente`**

Modificar `App/backend/src/emergencia/emergencia.service.ts`.

En la interfaz `ExpedienteEmergencia`, agregar `fotoUrl: string | null;` dentro de `identidad` (después de `activo: boolean;`):

```ts
  identidad: {
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string | null;
    curp: string | null;
    telefono: string | null;
    correoPersonal: string | null;
    referencia: string;
    fechaNacimiento: string | null;
    edad: number | null;
    activo: boolean;
    fotoUrl: string | null;
  };
```

Inyectar `FotoPerfilService` en el constructor:

```ts
constructor(
  private readonly prisma: PrismaService,
  private readonly fotoPerfilService: FotoPerfilService,
) {}
```

(agregar `import { FotoPerfilService } from '../foto-perfil/foto-perfil.service';` al inicio.)

En `cargarExpediente`, en las 3 ramas ALUMNO/MAESTRO/ADMINISTRATIVO (NO en `PERSONAL_SERVICIOS` — no tiene `Usuario`, regla 8), agregar `id: true, fotoStoragePath: true` al `select` de `usuario` (queda `usuario: { select: { id: true, activo: true, fotoStoragePath: true } }`), y en cada `identidad`, calcular `fotoUrl` antes de construir el objeto de retorno:

```ts
      if (tipo === 'ALUMNO') {
        const a = await this.prisma.perfilAlumno.findFirst({
          where: { id: perfilId, usuario: { sedeId } },
          include: {
            usuario: { select: { id: true, activo: true, fotoStoragePath: true } },
            infoMedica: true,
            contactos: { orderBy: { orden: 'asc' } },
          },
        });
        if (!a) return null;
        const fotoUrlAlumno = a.usuario.fotoStoragePath
          ? (
              await this.fotoPerfilService.firmarUrls([
                { usuarioId: a.usuario.id, storagePath: a.usuario.fotoStoragePath },
              ])
            ).get(a.usuario.id) ?? null
          : null;
        return {
          tipo,
          perfilId: a.id,
          identidad: {
            nombres: a.nombres,
            apellidoPaterno: a.apellidoPaterno,
            apellidoMaterno: a.apellidoMaterno,
            curp: a.curp,
            telefono: a.telefono,
            correoPersonal: a.correoPersonal,
            referencia: a.matricula,
            fechaNacimiento: a.fechaNacimiento.toISOString().slice(0, 10),
            edad: calcularEdad(a.fechaNacimiento),
            activo: a.usuario.activo,
            fotoUrl: fotoUrlAlumno,
          },
          infoMedica: mapInfoMedica(a.infoMedica),
          contactos: mapContactos(a.contactos, true),
        };
      }
```

Mismo patrón exacto (variable `fotoUrlMaestro`/`fotoUrlAdmin`, `select` con `id`/`fotoStoragePath`, `fotoUrl` en `identidad`) para las ramas `MAESTRO` y `ADMINISTRATIVO`.

Para la rama `PERSONAL_SERVICIOS` (sin `Usuario`, sin cuenta — regla 8), agregar `fotoUrl: null` directo en su `identidad`, sin tocar el `select` (no tiene de dónde sacarlo):

```ts
        identidad: {
          nombres: p.nombres,
          apellidoPaterno: p.apellidoPaterno,
          apellidoMaterno: p.apellidoMaterno,
          curp: p.curp,
          telefono: p.telefono,
          correoPersonal: p.correoPersonal,
          referencia: p.area,
          fechaNacimiento: null,
          edad: null,
          activo: p.activo,
          fotoUrl: null,
        },
```

- [ ] **Step 3: Agregar un caso de test**

En `App/backend/test/foto-perfil.e2e-spec.ts`, agregar (necesita el `perfilAlumno.id` del alumno de prueba — resolverlo en `beforeAll` junto a lo demás: agregar `let perfilAlumnoMeridaId: string;` y, tras resolver `alumnoMeridaId`, `perfilAlumnoMeridaId = (await prisma.perfilAlumno.findUniqueOrThrow({ where: { usuarioId: alumnoMeridaId } })).id;`):

```ts
  it('GET /emergencia/expediente/ALUMNO/:perfilId trae fotoUrl tras subir la foto', async () => {
    const tokenAdmin = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO },
      adminMeridaId,
    );
    await request(app.getHttpServer())
      .post(`/personas/${alumnoMeridaId}/foto`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .attach('archivo', Buffer.from('x'), { filename: 'foto.webp', contentType: 'image/webp' });

    const res = await request(app.getHttpServer())
      .get(`/emergencia/expediente/ALUMNO/${perfilAlumnoMeridaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    interface ExpedienteBody {
      data: { identidad: { fotoUrl: string | null } };
    }
    expect((res.body as ExpedienteBody).data.identidad.fotoUrl).toBe(
      `https://storage.example.com/signed/${alumnoMeridaId}/foto.webp`,
    );
  });
```

- [ ] **Step 4: Correr la suite y la regresión completa**

Run: `cd App/backend && npx jest test/foto-perfil.e2e-spec.ts --runInBand`

Expected: 8/8 en verde.

Run: `cd App/backend && npx nest build && npm run test:e2e`

Expected: todo en verde — cierra el backend completo de esta feature.

- [ ] **Step 5: Commit**

```bash
git add App/backend/src/emergencia App/backend/test/foto-perfil.e2e-spec.ts
git commit -m "feat(backend): fotoUrl en el expediente de emergencia"
```

---

## Task 5: Frontend — API client, tipos espejo, y avatar real en los 3 `ProfileDropdown`

**Files:**
- Create: `App/frontend/src/lib/api/foto-perfil.ts`
- Modify: `App/frontend/src/lib/api/perfil.ts`
- Modify: `App/frontend/src/lib/api/personas.ts`
- Modify: `App/frontend/src/lib/api/emergencia.ts`
- Modify: `App/frontend/src/components/admin/ui/shell/ProfileDropdown.tsx`
- Modify: `App/frontend/src/components/alumno/ui/shell/ProfileDropdown.tsx`
- Modify: `App/frontend/src/components/maestro/ui/shell/ProfileDropdown.tsx`

**Interfaces:**
- Produces: `subirFotoPropia(archivo, onProgress?)`, `eliminarFotoPropia()`, `subirFotoPersona(usuarioId, archivo, onProgress?)`, `eliminarFotoPersona(usuarioId)` en `lib/api/foto-perfil.ts` — los consumen los Tasks 6 y 7.
- Consumes: `apiFetchAuth`, `obtenerAccessToken`, `ApiError`, `API_URL` de `lib/api/http.ts` (ya existen).

- [ ] **Step 1: `lib/api/foto-perfil.ts`**

Crear `App/frontend/src/lib/api/foto-perfil.ts` (mismo patrón exacto de `subirMallaCurricular` en `lib/api/carreras.ts` — `XMLHttpRequest` para progreso real de subida):

```ts
import { API_URL, apiFetchAuth, ApiError, obtenerAccessToken } from './http';

/**
 * `lib/api/foto-perfil.ts` — feature "Foto de perfil" (2026-09-17).
 *
 * Mismo patrón que `subirMallaCurricular` (`lib/api/carreras.ts`): usa
 * `XMLHttpRequest` en vez de `fetch` para exponer progreso real de subida
 * (`fetch` no lo da de forma práctica en el navegador). Mismo contrato de
 * errores (`ApiError` con `code`/`status`).
 */

function subir(
  path: string,
  archivo: File,
  onProgress?: (porcentaje: number) => void,
): Promise<{ ok: true }> {
  return new Promise((resolve, reject) => {
    obtenerAccessToken()
      .then((token) => {
        const formData = new FormData();
        formData.append('archivo', archivo);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_URL}${path}`);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);

        xhr.upload.onprogress = (e) => {
          if (onProgress && e.lengthComputable) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        };

        xhr.onload = () => {
          let body: unknown = null;
          try {
            body = JSON.parse(xhr.responseText);
          } catch {
            body = null;
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            const success = body as { data?: { ok: true } } | null;
            if (success && success.data) {
              resolve(success.data);
            } else {
              reject(
                new ApiError(
                  'Respuesta inesperada del servidor al subir la foto.',
                  'SERVER_ERROR',
                  xhr.status,
                ),
              );
            }
          } else {
            const failure = body as { error?: string; code?: string } | null;
            reject(
              new ApiError(
                failure?.error ?? 'No se pudo subir la foto. Intenta de nuevo.',
                failure?.code ?? 'SERVER_ERROR',
                xhr.status,
              ),
            );
          }
        };

        xhr.onerror = () => {
          reject(new ApiError('Error de red al subir la foto.', 'SERVER_ERROR', 0));
        };

        xhr.send(formData);
      })
      .catch(reject);
  });
}

export function subirFotoPropia(
  archivo: File,
  onProgress?: (porcentaje: number) => void,
): Promise<{ ok: true }> {
  return subir('/perfil/foto', archivo, onProgress);
}

export function eliminarFotoPropia(): Promise<{ ok: true }> {
  return apiFetchAuth<{ ok: true }>('/perfil/foto', { method: 'DELETE' });
}

export function subirFotoPersona(
  usuarioId: string,
  archivo: File,
  onProgress?: (porcentaje: number) => void,
): Promise<{ ok: true }> {
  return subir(`/personas/${usuarioId}/foto`, archivo, onProgress);
}

export function eliminarFotoPersona(usuarioId: string): Promise<{ ok: true }> {
  return apiFetchAuth<{ ok: true }>(`/personas/${usuarioId}/foto`, {
    method: 'DELETE',
  });
}
```

- [ ] **Step 2: `fotoUrl` en los tipos espejo del frontend**

En `App/frontend/src/lib/api/perfil.ts`, agregar `fotoUrl: string | null;` a `interface Perfil` (después de `ultimoAcceso`):

```ts
export interface Perfil {
  id: string;
  email: string;
  rol: RolUsuario;
  sedeId: string;
  codigoExterno: string | null;
  primerIngreso: boolean;
  activo: boolean;
  ultimoAcceso: string | null;
  fotoUrl: string | null;
  sede: PerfilSede;
  // ...resto sin cambios...
```

En `App/frontend/src/lib/api/personas.ts`, agregar `fotoUrl: string | null;` a las 3 interfaces (`PersonaListItemAlumno`, `PersonaListItemMaestro`, `PersonaListItemAdministrativo`), después de `activo: boolean;` en cada una.

En `App/frontend/src/lib/api/emergencia.ts`, agregar `fotoUrl: string | null;` dentro de `identidad` en `ExpedienteEmergencia` (después de `activo: boolean;`).

- [ ] **Step 3: Avatar real en `ProfileDropdown` — admin**

Modificar `App/frontend/src/components/admin/ui/shell/ProfileDropdown.tsx`. Agregar imports (`useQuery`, `obtenerPerfil`):

```ts
import { useQuery } from '@tanstack/react-query';
import { obtenerPerfil } from '@/lib/api/perfil';
```

Dentro del componente, después de `const inicial = ...`:

```ts
  const { data: perfil } = useQuery({
    queryKey: ['admin', 'perfil'],
    queryFn: obtenerPerfil,
  });
```

Reemplazar el CONTENIDO de los 2 `motion.span` que hoy solo renderizan `{inicial}` (líneas ~91-98 y ~110-117) para mostrar la foto si existe:

```tsx
            <motion.span
              layoutId="profile-avatar"
              transition={SPRING}
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-navy text-sm font-semibold text-bone"
            >
              {perfil?.fotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Supabase Storage (dominio externo), mismo criterio que FondoEventos en app/login/page.tsx
                <img
                  src={perfil.fotoUrl}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                inicial
              )}
            </motion.span>
```

(el mismo bloque se repite 2 veces en el archivo — botón cerrado y tarjeta abierta — reemplazar ambos.)

- [ ] **Step 4: Mismo cambio en `ProfileDropdown` — alumno y maestro**

Repetir el Step 3 EXACTO en `App/frontend/src/components/alumno/ui/shell/ProfileDropdown.tsx` con `queryKey: ['alumno', 'perfil']`, y en `App/frontend/src/components/maestro/ui/shell/ProfileDropdown.tsx` con `queryKey: ['maestro', 'perfil']`. Mismo import, misma variable `perfil`, mismo JSX — 3 copias independientes (regla 11, sin componente compartido entre árboles).

- [ ] **Step 5: Typecheck y lint**

Run: `cd App/frontend && npx tsc --noEmit`

Expected: sin errores.

Run: `cd App/frontend && npx eslint src/lib/api/foto-perfil.ts src/lib/api/perfil.ts src/lib/api/personas.ts src/lib/api/emergencia.ts src/components/admin/ui/shell/ProfileDropdown.tsx src/components/alumno/ui/shell/ProfileDropdown.tsx src/components/maestro/ui/shell/ProfileDropdown.tsx`

Expected: sin errores (puede haber el warning pre-existente de `no-img-element` si el `eslint-disable` no calza exacto con la línea — ajustar la posición del comentario si el lint lo señala).

- [ ] **Step 6: Commit**

```bash
git add App/frontend/src/lib/api/foto-perfil.ts App/frontend/src/lib/api/perfil.ts App/frontend/src/lib/api/personas.ts App/frontend/src/lib/api/emergencia.ts App/frontend/src/components/admin/ui/shell/ProfileDropdown.tsx App/frontend/src/components/alumno/ui/shell/ProfileDropdown.tsx App/frontend/src/components/maestro/ui/shell/ProfileDropdown.tsx
git commit -m "feat(frontend): cliente de API de foto de perfil + avatar real en el navbar"
```

---

## Task 6: Frontend — `Avatar` (árbol admin) + modal de subida propia en los 3 perfiles

**Files:**
- Create: `App/frontend/src/components/admin/ui/Avatar.tsx`
- Create: `App/frontend/src/app/admin/perfil/SubirFotoModal.tsx`
- Modify: `App/frontend/src/app/admin/perfil/page.tsx`
- Create: `App/frontend/src/app/alumno/SubirFotoModal.tsx`
- Modify: `App/frontend/src/app/alumno/page.tsx`
- Create: `App/frontend/src/app/maestro/SubirFotoModal.tsx`
- Modify: `App/frontend/src/app/maestro/page.tsx`

**Interfaces:**
- Produces: `<Avatar fotoUrl iniciales tamano? className? />` (`components/admin/ui/Avatar.tsx`) — lo consume el Task 7 (listados) y el Task 8 (expediente de emergencia), ambos dentro del árbol admin.
- Consumes: `subirFotoPropia`/`eliminarFotoPropia` (Task 5).

- [ ] **Step 1: Componente `Avatar` (solo árbol admin — es el único con más de 1 superficie que lo necesita: 3 listados + expediente de emergencia)**

Crear `App/frontend/src/components/admin/ui/Avatar.tsx`:

```tsx
/**
 * `Avatar` — feature "Foto de perfil" (2026-09-17). Solo existe en el árbol
 * `admin` (regla 11 de `CLAUDE.md` raíz) porque es el único con más de una
 * superficie que lo necesita (los 3 listados + el expediente de emergencia)
 * — los `ProfileDropdown` de los 3 árboles NO lo usan: ahí la foto vive
 * dentro de un `motion.span` con `layoutId` compartido para la animación de
 * Framer Motion (ver `ProfileDropdown.tsx`), envolverlo en este componente
 * complicaría esa coreografía sin ganar nada (un solo caso más no justifica
 * generalizar — mismo criterio que `SubirMallaModal.tsx`).
 */
export interface AvatarProps {
  fotoUrl: string | null;
  iniciales: string;
  tamano?: 'sm' | 'md' | 'lg';
  className?: string;
}

const TAMANOS: Record<NonNullable<AvatarProps['tamano']>, string> = {
  sm: 'size-6 text-xs',
  md: 'size-8 text-sm',
  lg: 'size-16 text-xl',
};

export function Avatar({
  fotoUrl,
  iniciales,
  tamano = 'md',
  className = '',
}: AvatarProps) {
  const base = `flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-navy font-semibold text-bone ${TAMANOS[tamano]} ${className}`;

  if (fotoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Supabase Storage (dominio externo), mismo criterio que FondoEventos en app/login/page.tsx
      <img src={fotoUrl} alt="" className={`${base} object-cover`} />
    );
  }
  return (
    <span aria-hidden="true" className={base}>
      {iniciales}
    </span>
  );
}
```

- [ ] **Step 2: Modal de subida propia — admin**

Crear `App/frontend/src/app/admin/perfil/SubirFotoModal.tsx` (mismo esqueleto que `app/admin/carreras/SubirMallaModal.tsx`, adaptado a imagen: preview con `<img>` en vez de `<embed>`, sin `useQuery` de "malla vigente" porque el perfil ya trae `fotoUrl`):

```tsx
'use client';

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api/http';
import { eliminarFotoPropia, subirFotoPropia } from '@/lib/api/foto-perfil';

const TRES_MB = 3 * 1024 * 1024;
const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];

export interface SubirFotoModalProps {
  fotoUrlActual: string | null;
  onClose: () => void;
  onCambioConExito: () => void;
}

function formatearPeso(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Modal de "mi foto de perfil" — self-service. Mismo patrón visual que
 * `app/admin/carreras/SubirMallaModal.tsx` (drag&drop, barra de progreso,
 * auto-cierre 1.5s tras éxito). Local a esta ruta, sin componente
 * `Modal`/`Dialog` genérico compartido (mismo criterio que el resto de
 * modales de este árbol).
 */
export function SubirFotoModal({
  fotoUrlActual,
  onClose,
  onCambioConExito,
}: SubirFotoModalProps) {
  const [arrastrando, setArrastrando] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [exito, setExito] = useState(false);
  const [errorSubida, setErrorSubida] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cierreTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!archivo) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(archivo);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [archivo]);

  useEffect(() => {
    return () => {
      if (cierreTimeoutRef.current) clearTimeout(cierreTimeoutRef.current);
    };
  }, []);

  function seleccionarArchivo(file: File) {
    setErrorSubida(null);
    if (!TIPOS_PERMITIDOS.includes(file.type)) {
      toast.error('La foto debe ser JPG, PNG o WEBP.');
      return;
    }
    if (file.size > TRES_MB) {
      toast.error('La foto no puede pesar más de 3MB.');
      return;
    }
    setArchivo(file);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setArrastrando(false);
    if (subiendo) return;
    const file = e.dataTransfer.files?.[0];
    if (file) seleccionarArchivo(file);
  }

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) seleccionarArchivo(file);
  }

  function handleSubir() {
    if (!archivo) return;
    setSubiendo(true);
    setProgreso(0);
    setErrorSubida(null);

    subirFotoPropia(archivo, setProgreso)
      .then(() => {
        setSubiendo(false);
        setExito(true);
        onCambioConExito();
        cierreTimeoutRef.current = setTimeout(() => onClose(), 1500);
      })
      .catch((err: unknown) => {
        console.error('[SubirFotoModal] Error al subir la foto:', {
          nombreArchivo: archivo.name,
          err,
        });
        setSubiendo(false);
        const mensaje =
          err instanceof ApiError
            ? err.message
            : 'No se pudo subir la foto. Intenta de nuevo.';
        setErrorSubida(mensaje);
        toast.error(mensaje);
      });
  }

  function handleEliminar() {
    setEliminando(true);
    eliminarFotoPropia()
      .then(() => {
        setEliminando(false);
        toast.success('Foto eliminada.');
        onCambioConExito();
        onClose();
      })
      .catch((err: unknown) => {
        console.error('[SubirFotoModal] Error al eliminar la foto:', err);
        setEliminando(false);
        toast.error('No se pudo eliminar la foto. Intenta de nuevo.');
      });
  }

  function handleCerrar() {
    if (subiendo || eliminando) return;
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate/40 p-4"
      onClick={handleCerrar}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-slate">
            Foto de perfil
          </h2>
          <button
            type="button"
            onClick={handleCerrar}
            disabled={subiendo || eliminando}
            className="text-slate/60 hover:text-slate disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {exito ? (
          <div className="mt-6 rounded-lg border border-success-border bg-success-bg p-4 text-center">
            <p className="text-sm font-medium text-success">
              Foto de perfil actualizada
            </p>
          </div>
        ) : (
          <>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (!subiendo) setArrastrando(true);
              }}
              onDragLeave={() => setArrastrando(false)}
              onDrop={handleDrop}
              onClick={() => !subiendo && inputRef.current?.click()}
              className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                arrastrando ? 'border-navy bg-navy/5' : 'border-mist'
              } ${subiendo ? 'pointer-events-none opacity-50' : ''}`}
            >
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleInputChange}
                disabled={subiendo}
              />
              {previewUrl ? (
                <div className="w-full space-y-2">
                  <p className="text-sm font-medium text-slate">{archivo?.name}</p>
                  {archivo && (
                    <p className="text-xs text-slate/60">{formatearPeso(archivo.size)}</p>
                  )}
                  {/* eslint-disable-next-line @next/next/no-img-element -- object URL local (blob:), no aplica next/image */}
                  <img
                    src={previewUrl}
                    alt="Previsualización"
                    className="mx-auto h-32 w-32 rounded-full border border-mist object-cover"
                  />
                </div>
              ) : fotoUrlActual ? (
                <div className="space-y-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Supabase Storage, dominio externo */}
                  <img
                    src={fotoUrlActual}
                    alt="Foto actual"
                    className="mx-auto h-32 w-32 rounded-full border border-mist object-cover"
                  />
                  <p className="text-sm text-slate/60">
                    Arrastra una foto aquí, o haz click para reemplazarla (JPG/PNG/WEBP, máx. 3MB)
                  </p>
                </div>
              ) : (
                <p className="text-sm text-slate/60">
                  Arrastra una foto aquí, o haz click para seleccionarla (JPG/PNG/WEBP, máx. 3MB)
                </p>
              )}
            </div>

            {errorSubida && (
              <p className="mt-3 rounded-lg border border-error-border bg-error-bg px-3 py-2 text-sm text-crimson">
                {errorSubida}
              </p>
            )}

            {subiendo && (
              <div className="mt-4">
                <div className="h-2 w-full rounded-full bg-mist">
                  <div
                    className="h-2 rounded-full bg-navy transition-all"
                    style={{ width: `${progreso}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-slate/60">{progreso}%</p>
              </div>
            )}

            <div className="mt-6 flex items-center justify-between gap-3">
              {fotoUrlActual && !archivo && (
                <button
                  type="button"
                  onClick={handleEliminar}
                  disabled={subiendo || eliminando}
                  className="text-sm font-medium text-crimson hover:underline disabled:opacity-50"
                >
                  {eliminando ? 'Quitando…' : 'Quitar foto'}
                </button>
              )}
              <div className="ml-auto flex gap-3">
                <button
                  type="button"
                  onClick={handleCerrar}
                  disabled={subiendo || eliminando}
                  className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSubir}
                  disabled={!archivo || subiendo}
                  className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
                >
                  {subiendo ? 'Subiendo…' : 'Subir'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Integrar el modal en `app/admin/perfil/page.tsx`**

Agregar el estado, el botón/avatar disparador, y el modal condicional. Al inicio del archivo, agregar imports:

```ts
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@/components/admin/ui/Avatar';
import { SubirFotoModal } from './SubirFotoModal';
```

Dentro del componente de página, junto a los demás hooks (después de la `useQuery` que trae `perfil`):

```ts
  const queryClient = useQueryClient();
  const [modalFotoAbierto, setModalFotoAbierto] = useState(false);
  const iniciales = perfil
    ? `${perfil.administrativo?.nombres.charAt(0) ?? ''}${perfil.administrativo?.apellidoPaterno.charAt(0) ?? ''}`.toUpperCase()
    : '?';
```

En el JSX, cerca del encabezado del perfil (donde hoy se muestra el nombre — buscar el `<h1>`/banner con el nombre completo), agregar el disparador ANTES o al lado de ese encabezado:

```tsx
      <button
        type="button"
        onClick={() => setModalFotoAbierto(true)}
        className="group relative"
        aria-label="Cambiar foto de perfil"
      >
        <Avatar fotoUrl={perfil?.fotoUrl ?? null} iniciales={iniciales} tamano="lg" />
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-slate/0 text-xs font-medium text-transparent transition-colors group-hover:bg-slate/40 group-hover:text-white">
          Cambiar
        </span>
      </button>

      {modalFotoAbierto && (
        <SubirFotoModal
          fotoUrlActual={perfil?.fotoUrl ?? null}
          onClose={() => setModalFotoAbierto(false)}
          onCambioConExito={() =>
            queryClient.invalidateQueries({ queryKey: ['admin', 'perfil'] })
          }
        />
      )}
```

(Ajustar el punto exacto de inserción al banner/encabezado real de la página — el patrón de arriba es el bloque completo a insertar, la ubicación es "junto al nombre del administrativo en la parte superior del perfil".)

- [ ] **Step 4: Mismo patrón en `app/alumno/` y `app/maestro/`**

Crear `App/frontend/src/app/alumno/SubirFotoModal.tsx` — copia EXACTA del Step 2 (mismo contenido, mismo nombre de archivo, distinta carpeta — regla 11, sin compartir entre árboles).

Crear `App/frontend/src/app/maestro/SubirFotoModal.tsx` — misma copia exacta.

Modificar `App/frontend/src/app/alumno/page.tsx`: mismo patrón del Step 3, pero:
- Import `Avatar` desde `'@/components/alumno/ui/Avatar'` — **crear también este archivo** (copia exacta del Step 1, en `App/frontend/src/components/alumno/ui/Avatar.tsx`) porque el árbol alumno SÍ necesita `Avatar` aquí (aunque no lo use en su `ProfileDropdown`, sí en su propia página de perfil).
- `queryKey: ['alumno', 'perfil']` al invalidar.
- Iniciales desde `perfil.alumno?.nombres`/`apellidoPaterno`.

Modificar `App/frontend/src/app/maestro/page.tsx`: mismo patrón, con `App/frontend/src/components/maestro/ui/Avatar.tsx` (copia exacta), `queryKey: ['maestro', 'perfil']`, iniciales desde `perfil.maestro?.nombres`/`apellidoPaterno`.

- [ ] **Step 5: Typecheck y lint**

Run: `cd App/frontend && npx tsc --noEmit`

Expected: sin errores.

Run: `cd App/frontend && npx eslint src/components/admin/ui/Avatar.tsx src/components/alumno/ui/Avatar.tsx src/components/maestro/ui/Avatar.tsx src/app/admin/perfil/SubirFotoModal.tsx src/app/admin/perfil/page.tsx src/app/alumno/SubirFotoModal.tsx src/app/alumno/page.tsx src/app/maestro/SubirFotoModal.tsx src/app/maestro/page.tsx`

Expected: sin errores nuevos (warnings pre-existentes de esos archivos, si los hay, no aumentan).

- [ ] **Step 6: Verificación manual en navegador**

Levantar backend + frontend, entrar como alumno/maestro/admin de prueba, abrir su propio perfil, subir una foto (JPG y PNG), confirmar que aparece en el avatar del banner Y en el navbar tras refrescar. Probar "Quitar foto" y confirmar que vuelve a iniciales.

- [ ] **Step 7: Commit**

```bash
git add App/frontend/src/components/admin/ui/Avatar.tsx App/frontend/src/components/alumno/ui/Avatar.tsx App/frontend/src/components/maestro/ui/Avatar.tsx App/frontend/src/app/admin/perfil App/frontend/src/app/alumno App/frontend/src/app/maestro
git commit -m "feat(frontend): subida de foto propia en los 3 perfiles (self-service)"
```

---

## Task 7: Frontend — Admin sube/quita foto de otra persona (3 listados)

**Files:**
- Create: `App/frontend/src/components/admin/ui/personas-listado/SubirFotoPersonaModal.tsx`
- Modify: `App/frontend/src/app/admin/alumnos/page.tsx`
- Modify: `App/frontend/src/app/admin/maestros/page.tsx`
- Modify: `App/frontend/src/app/admin/administrativos/page.tsx`

**Interfaces:**
- Consumes: `Avatar` (Task 6), `subirFotoPersona`/`eliminarFotoPersona` (Task 5).

- [ ] **Step 1: Modal compartido dentro del árbol admin**

Crear `App/frontend/src/components/admin/ui/personas-listado/SubirFotoPersonaModal.tsx` — mismo cuerpo que `app/admin/perfil/SubirFotoModal.tsx` (Task 6, Step 2), con 2 diferencias: recibe `usuarioId`+`nombreCompleto` como props (para el título y para llamar `subirFotoPersona(usuarioId, ...)`/`eliminarFotoPersona(usuarioId)` en vez de las variantes propias), y vive en `personas-listado/` porque SÍ se comparte entre los 3 listados de este mismo árbol (igual que `ResetearPasswordModal.tsx`/`CambiarEstatusModal.tsx`):

```tsx
'use client';

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api/http';
import { eliminarFotoPersona, subirFotoPersona } from '@/lib/api/foto-perfil';

const TRES_MB = 3 * 1024 * 1024;
const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];

export interface SubirFotoPersonaModalProps {
  usuarioId: string;
  nombreCompleto: string;
  fotoUrlActual: string | null;
  onClose: () => void;
  onCambioConExito: () => void;
}

function formatearPeso(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Modal compartido DENTRO del árbol admin (regla 11 sigue aplicando entre
 * árboles, no dentro de uno) — mismo patrón que `ResetearPasswordModal.tsx`/
 * `CambiarEstatusModal.tsx`: un admin dispara esto desde la fila de
 * cualquiera de los 3 listados (alumnos/maestros/administrativos).
 */
export function SubirFotoPersonaModal({
  usuarioId,
  nombreCompleto,
  fotoUrlActual,
  onClose,
  onCambioConExito,
}: SubirFotoPersonaModalProps) {
  const [arrastrando, setArrastrando] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [exito, setExito] = useState(false);
  const [errorSubida, setErrorSubida] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cierreTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!archivo) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(archivo);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [archivo]);

  useEffect(() => {
    return () => {
      if (cierreTimeoutRef.current) clearTimeout(cierreTimeoutRef.current);
    };
  }, []);

  function seleccionarArchivo(file: File) {
    setErrorSubida(null);
    if (!TIPOS_PERMITIDOS.includes(file.type)) {
      toast.error('La foto debe ser JPG, PNG o WEBP.');
      return;
    }
    if (file.size > TRES_MB) {
      toast.error('La foto no puede pesar más de 3MB.');
      return;
    }
    setArchivo(file);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setArrastrando(false);
    if (subiendo) return;
    const file = e.dataTransfer.files?.[0];
    if (file) seleccionarArchivo(file);
  }

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) seleccionarArchivo(file);
  }

  function handleSubir() {
    if (!archivo) return;
    setSubiendo(true);
    setProgreso(0);
    setErrorSubida(null);

    subirFotoPersona(usuarioId, archivo, setProgreso)
      .then(() => {
        setSubiendo(false);
        setExito(true);
        onCambioConExito();
        cierreTimeoutRef.current = setTimeout(() => onClose(), 1500);
      })
      .catch((err: unknown) => {
        console.error('[SubirFotoPersonaModal] Error al subir la foto:', {
          usuarioId,
          nombreArchivo: archivo.name,
          err,
        });
        setSubiendo(false);
        const mensaje =
          err instanceof ApiError
            ? err.message
            : 'No se pudo subir la foto. Intenta de nuevo.';
        setErrorSubida(mensaje);
        toast.error(mensaje);
      });
  }

  function handleEliminar() {
    setEliminando(true);
    eliminarFotoPersona(usuarioId)
      .then(() => {
        setEliminando(false);
        toast.success('Foto eliminada.');
        onCambioConExito();
        onClose();
      })
      .catch((err: unknown) => {
        console.error('[SubirFotoPersonaModal] Error al eliminar la foto:', {
          usuarioId,
          err,
        });
        setEliminando(false);
        toast.error('No se pudo eliminar la foto. Intenta de nuevo.');
      });
  }

  function handleCerrar() {
    if (subiendo || eliminando) return;
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate/40 p-4"
      onClick={handleCerrar}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-slate">
            Foto de {nombreCompleto}
          </h2>
          <button
            type="button"
            onClick={handleCerrar}
            disabled={subiendo || eliminando}
            className="text-slate/60 hover:text-slate disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {exito ? (
          <div className="mt-6 rounded-lg border border-success-border bg-success-bg p-4 text-center">
            <p className="text-sm font-medium text-success">Foto actualizada</p>
          </div>
        ) : (
          <>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (!subiendo) setArrastrando(true);
              }}
              onDragLeave={() => setArrastrando(false)}
              onDrop={handleDrop}
              onClick={() => !subiendo && inputRef.current?.click()}
              className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                arrastrando ? 'border-navy bg-navy/5' : 'border-mist'
              } ${subiendo ? 'pointer-events-none opacity-50' : ''}`}
            >
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleInputChange}
                disabled={subiendo}
              />
              {previewUrl ? (
                <div className="w-full space-y-2">
                  <p className="text-sm font-medium text-slate">{archivo?.name}</p>
                  {archivo && (
                    <p className="text-xs text-slate/60">{formatearPeso(archivo.size)}</p>
                  )}
                  {/* eslint-disable-next-line @next/next/no-img-element -- object URL local (blob:) */}
                  <img
                    src={previewUrl}
                    alt="Previsualización"
                    className="mx-auto h-32 w-32 rounded-full border border-mist object-cover"
                  />
                </div>
              ) : fotoUrlActual ? (
                <div className="space-y-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Supabase Storage */}
                  <img
                    src={fotoUrlActual}
                    alt="Foto actual"
                    className="mx-auto h-32 w-32 rounded-full border border-mist object-cover"
                  />
                  <p className="text-sm text-slate/60">
                    Arrastra una foto aquí, o haz click para reemplazarla (JPG/PNG/WEBP, máx. 3MB)
                  </p>
                </div>
              ) : (
                <p className="text-sm text-slate/60">
                  Arrastra una foto aquí, o haz click para seleccionarla (JPG/PNG/WEBP, máx. 3MB)
                </p>
              )}
            </div>

            {errorSubida && (
              <p className="mt-3 rounded-lg border border-error-border bg-error-bg px-3 py-2 text-sm text-crimson">
                {errorSubida}
              </p>
            )}

            {subiendo && (
              <div className="mt-4">
                <div className="h-2 w-full rounded-full bg-mist">
                  <div
                    className="h-2 rounded-full bg-navy transition-all"
                    style={{ width: `${progreso}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-slate/60">{progreso}%</p>
              </div>
            )}

            <div className="mt-6 flex items-center justify-between gap-3">
              {fotoUrlActual && !archivo && (
                <button
                  type="button"
                  onClick={handleEliminar}
                  disabled={subiendo || eliminando}
                  className="text-sm font-medium text-crimson hover:underline disabled:opacity-50"
                >
                  {eliminando ? 'Quitando…' : 'Quitar foto'}
                </button>
              )}
              <div className="ml-auto flex gap-3">
                <button
                  type="button"
                  onClick={handleCerrar}
                  disabled={subiendo || eliminando}
                  className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSubir}
                  disabled={!archivo || subiendo}
                  className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
                >
                  {subiendo ? 'Subiendo…' : 'Subir'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Integrar en `app/admin/alumnos/page.tsx`**

Agregar imports:

```ts
import { Avatar } from '@/components/admin/ui/Avatar';
import { SubirFotoPersonaModal } from '@/components/admin/ui/personas-listado/SubirFotoPersonaModal';
```

Agregar estado (junto al `useState` de `alumnoAResetear`):

```ts
  const [alumnoAFotografiar, setAlumnoAFotografiar] = useState<PersonaListItemAlumno | null>(null);
```

Agregar una columna nueva "Foto" AL INICIO de la tabla — en el `<thead>`, antes de `<Th>Nombre completo</Th>` (en AMBOS `<thead>` del archivo, el de loading-skeleton y el real, igual que ya existen 2 copias del `<thead>` completo hoy):

```tsx
<Th>Foto</Th>
```

En el `<tbody>`, dentro de `alumnos.map((alumno) => (<tr key={alumno.usuarioId}>`, agregar la celda AL INICIO (antes de `<Td>{[alumno.nombres...`):

```tsx
              <Td>
                <button
                  type="button"
                  onClick={() => setAlumnoAFotografiar(alumno)}
                  aria-label={`Cambiar foto de ${alumno.nombres}`}
                >
                  <Avatar
                    fotoUrl={alumno.fotoUrl}
                    iniciales={`${alumno.nombres.charAt(0)}${alumno.apellidoPaterno.charAt(0)}`.toUpperCase()}
                    tamano="sm"
                  />
                </button>
              </Td>
```

Y el modal condicional, junto al `<ResetearPasswordModal ... />` ya existente:

```tsx
      {alumnoAFotografiar && (
        <SubirFotoPersonaModal
          usuarioId={alumnoAFotografiar.usuarioId}
          nombreCompleto={[
            alumnoAFotografiar.nombres,
            alumnoAFotografiar.apellidoPaterno,
            alumnoAFotografiar.apellidoMaterno,
          ]
            .filter(Boolean)
            .join(' ')}
          fotoUrlActual={alumnoAFotografiar.fotoUrl}
          onClose={() => setAlumnoAFotografiar(null)}
          onCambioConExito={() =>
            queryClient.invalidateQueries({ queryKey: ['admin', 'alumnos'] })
          }
        />
      )}
```

(Usar el mismo `queryKey` que ya invalida esta página tras otras mutaciones — confirmar el nombre exacto leyendo el `useQuery` de la lista en el archivo; si no hay un `queryClient` importado todavía, agregar `import { useQueryClient } from '@tanstack/react-query';` y `const queryClient = useQueryClient();` junto a los demás hooks.)

- [ ] **Step 3: Mismo patrón en `app/admin/maestros/page.tsx` y `app/admin/administrativos/page.tsx`**

Repetir el Step 2 completo en ambos archivos — mismos imports, mismo estado (`maestroAFotografiar`/`administrativoAFotografiar`), misma columna "Foto" al inicio de sus tablas, mismo modal condicional, ajustando el tipo (`PersonaListItemMaestro`/`PersonaListItemAdministrativo`) y el `queryKey` de invalidación al de cada página.

- [ ] **Step 4: Typecheck y lint**

Run: `cd App/frontend && npx tsc --noEmit`

Expected: sin errores.

Run: `cd App/frontend && npx eslint src/components/admin/ui/personas-listado/SubirFotoPersonaModal.tsx src/app/admin/alumnos/page.tsx src/app/admin/maestros/page.tsx src/app/admin/administrativos/page.tsx`

Expected: sin errores nuevos.

- [ ] **Step 5: Verificación manual en navegador**

Como administrativo, abrir cada uno de los 3 listados, subir una foto para una fila, confirmar que el avatar de esa fila se actualiza sin recargar la página (tras la invalidación), y que "Quitar foto" la regresa a iniciales.

- [ ] **Step 6: Commit**

```bash
git add App/frontend/src/components/admin/ui/personas-listado/SubirFotoPersonaModal.tsx App/frontend/src/app/admin/alumnos/page.tsx App/frontend/src/app/admin/maestros/page.tsx App/frontend/src/app/admin/administrativos/page.tsx
git commit -m "feat(frontend): admin sube/quita foto de otra persona desde los 3 listados"
```

---

## Task 8: Frontend — Avatar en el expediente de emergencia

**Files:**
- Modify: `App/frontend/src/app/admin/emergencia/ExpedientePanel.tsx`

**Interfaces:**
- Consumes: `Avatar` (Task 6), `ExpedienteEmergencia.identidad.fotoUrl` (Task 5).

- [ ] **Step 1: Avatar junto al nombre en el header del expediente**

Modificar `App/frontend/src/app/admin/emergencia/ExpedientePanel.tsx`. Agregar import:

```ts
import { Avatar } from '@/components/admin/ui/Avatar';
```

En el JSX, dentro de `<header>`, envolver el bloque existente para agregar el avatar al lado (reemplazar el `<div className="flex items-center gap-2">` actual):

```tsx
      <header className="flex items-start gap-4">
        <Avatar
          fotoUrl={identidad.fotoUrl}
          iniciales={`${identidad.nombres.charAt(0)}${identidad.apellidoPaterno.charAt(0)}`.toUpperCase()}
          tamano="lg"
        />
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl font-semibold text-slate">
              {[identidad.nombres, identidad.apellidoPaterno, identidad.apellidoMaterno]
                .filter(Boolean)
                .join(' ')}
            </h2>
            {!identidad.activo && (
              <span className="rounded-full bg-mist px-2 py-0.5 text-xs font-medium text-slate/70">
                Inactivo
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate/70">
            {TIPO_ROL_LABEL[expediente.tipo]} ·{' '}
            {humanizarReferencia(expediente.tipo, identidad.referencia)}
            {identidad.edad !== null && ` · ${identidad.edad} años`}
          </p>
        </div>
      </header>
```

(El resto del componente — CURP, teléfono, info médica, contactos — queda sin cambios; solo se mueve el bloque del nombre/badge dentro de un `<div>` hermano del `Avatar`, y `<header>` gana `flex items-start gap-4`.)

- [ ] **Step 2: Typecheck y lint**

Run: `cd App/frontend && npx tsc --noEmit && npx eslint src/app/admin/emergencia/ExpedientePanel.tsx`

Expected: sin errores.

- [ ] **Step 3: Verificación manual en navegador**

Buscar a una persona con foto ya subida (de los Tasks 6/7) en `/admin/emergencia`, confirmar que el expediente muestra su foto real; buscar a alguien sin foto, confirmar que muestra iniciales.

- [ ] **Step 4: Regresión final completa**

Run: `cd App/backend && npx nest build && npm run test:e2e`

Run: `cd App/frontend && npx tsc --noEmit && npm run lint && npm run build`

Expected: todo en verde — cierra la feature completa (backend + frontend).

- [ ] **Step 5: Commit**

```bash
git add App/frontend/src/app/admin/emergencia/ExpedientePanel.tsx
git commit -m "feat(frontend): avatar en el expediente de emergencia"
```

---

## Verificación final (checklist manual, cubre "Verificación" del spec)

- [ ] Self-service: subir/reemplazar/quitar foto desde los 3 perfiles propios (admin/alumno/maestro).
- [ ] Admin: subir/reemplazar/quitar foto de otra persona desde los 3 listados.
- [ ] Se ve en el navbar (`ProfileDropdown`) de los 3 árboles tras refrescar.
- [ ] Se ve en la columna "Foto" de los 3 listados de `app/admin/`.
- [ ] Se ve en el expediente de `app/admin/emergencia/`.
- [ ] Tipo de archivo inválido y archivo >3MB rechazados con el mensaje correcto en los 2 flujos de subida.
- [ ] Aislamiento cross-sede: un admin no puede subir/quitar la foto de alguien de otra sede (`404`).
- [ ] `RegistroAuditoria` tiene una fila `EDICION` por cada subida/eliminación.
