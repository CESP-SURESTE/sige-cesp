# Bot de Soporte SIGE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a administrativos y maestros un widget de chat flotante con dos modos — FAQ de ayuda y reporte de bugs — y a la plataforma un panel para gestionar esos reportes y un interruptor para apagar el bot completo sin redeploy.

**Architecture:** Tabla singleton `ConfiguracionSoporte` (`id: 'global'`) controla si el bot está activo. Tabla `ReporteBug` (por sede) guarda cada reporte, con captura opcional en un bucket privado de Storage. `SoporteService`/`SoporteController` nuevos exponen config + reportes; `TelegramService` nuevo (mismo patrón que `MailService`: `fetch` nativo, sin SDK) manda el aviso best-effort. Frontend: componente `BotSoporte` duplicado en `app/admin/` y `app/maestro/` (regla 11), montado fuera de cualquier contenedor con `backdrop-blur-sm`/`sticky` para no repetir el bug de clipping de `position: fixed` ya documentado; `app/plataforma/soporte/` nuevo para el toggle + la tabla de reportes.

**Tech Stack:** NestJS + Prisma + Supabase Storage (backend), Next.js + React Query + `XMLHttpRequest` con progreso para la captura (frontend, mismo patrón que `subirFotoPropia`).

## Global Constraints

- Alcance del widget: SOLO `app/admin/` y `app/maestro/` — nunca `app/alumno/`.
- Tipos de archivo de captura permitidos: `image/jpeg`, `image/png`, `image/webp`. Cualquier otro → `400 VALIDATION_ERROR`. Límite 3MB → `400 VALIDATION_ERROR` (vía filter de `PayloadTooLargeException`, no un 413 genérico).
- El FAQ del modo "Necesito ayuda" es un array hardcodeado en el propio componente — sin backend, sin LLM.
- El toggle (`ConfiguracionSoporte.activo`) es UN SOLO interruptor para todo el bot (ayuda + reporte), respaldado en DB, editable solo por `PlatformAdminGuard`. El backend rechaza `POST /soporte/reportes` con `activo: false` (código `SOPORTE_DESACTIVADO`, 409) — defensa en profundidad además de ocultar el botón en el frontend.
- Telegram es best-effort: un fallo se loguea (`console.error`, regla 12) y NUNCA tumba el reporte ya guardado en la DB.
- `sedeId` siempre sale de `@SedeActual()`, `actorUsuarioId`/`usuarioId` siempre de `@ActorUsuarioId()` — nunca de body/param, mismo criterio que el resto del backend.
- Auditoría (`RegistroAuditoria`) reusa `AccionAuditoria.EDICION` para el toggle y el cambio de estatus de un reporte — NO se agrega un valor de enum nuevo (mismo criterio que Foto de perfil).
- Regla 11 (`CLAUDE.md` raíz): CERO imports cruzados entre `components/admin/` y `components/maestro/`.
- `prisma migrate dev` está roto en este repo (`P3006`) — toda migración se escribe a mano y se aplica con `prisma db execute` + `prisma migrate resolve --applied`, mismo flujo que las migraciones recientes.

---

## Task 1: Backend — Schema, migración y bucket de Storage

**Files:**
- Modify: `App/backend/prisma/schema.prisma` (modelos `Sede`, `Usuario`, y 2 modelos + 1 enum nuevos)
- Create: `App/backend/prisma/migrations/20260924120000_bot_soporte/migration.sql`
- Create: `App/backend/prisma/crear-bucket-reportes-bug.ts`

**Interfaces:**
- Produces: tablas `configuracion_soporte` (fila `id: 'global'` sembrada) y `reportes_bug`, enum Prisma `EstatusReporteBug`, bucket Storage `reportes-bug` — los consume `SoporteService` en los Tasks 3-5.

- [ ] **Step 1: Agregar los modelos al schema**

En `App/backend/prisma/schema.prisma`, dentro de `model Sede { ... }` (línea 182 aprox.), agregar la relación nueva junto a `telefonosEmergencia`:

```prisma
  telefonosEmergencia TelefonoEmergenciaSede[]
  reportesBug         ReporteBug[]
```

Dentro de `model Usuario { ... }`, agregar la relación nueva junto a `avisosCreados`:

```prisma
  avisosCreados        Aviso[]
  reportesBug          ReporteBug[]
```

Al final del archivo (después de `model PermisoAdministrativo { ... }`), agregar:

```prisma

// ============================
// SOPORTE (bot: FAQ + reporte de bugs)
// ============================

enum EstatusReporteBug {
  NUEVO
  EN_REVISION
  RESUELTO
}

/// Singleton real — `id` siempre `'global'`, una sola fila para todo el
/// sistema (sembrada por la propia migración). El toggle de
/// `app/plataforma/soporte/` opera SIEMPRE contra `id: 'global'` vía
/// `upsert`, nunca crea una fila nueva. Sin `sedeId` — es global, mismo
/// criterio que `AdminPlataforma`/`Sede`.
model ConfiguracionSoporte {
  id        String   @id @default("global")
  activo    Boolean  @default(true)
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("configuracion_soporte")
}

model ReporteBug {
  id                 String            @id @default(uuid())
  sedeId             String            @map("sede_id")
  sede               Sede              @relation(fields: [sedeId], references: [id], onDelete: Cascade)
  usuarioId          String            @map("usuario_id")
  usuario            Usuario           @relation(fields: [usuarioId], references: [id], onDelete: Cascade)
  descripcion        String
  capturaStoragePath String?           @map("captura_storage_path")
  estatus            EstatusReporteBug @default(NUEVO)
  createdAt          DateTime          @default(now()) @map("created_at")
  updatedAt          DateTime          @updatedAt @map("updated_at")

  @@index([estatus, createdAt])
  @@map("reportes_bug")
}
```

- [ ] **Step 2: Escribir la migración a mano**

Crear `App/backend/prisma/migrations/20260924120000_bot_soporte/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "EstatusReporteBug" AS ENUM ('NUEVO', 'EN_REVISION', 'RESUELTO');

-- CreateTable
CREATE TABLE "configuracion_soporte" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracion_soporte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reportes_bug" (
    "id" TEXT NOT NULL,
    "sede_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "captura_storage_path" TEXT,
    "estatus" "EstatusReporteBug" NOT NULL DEFAULT 'NUEVO',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reportes_bug_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reportes_bug_estatus_created_at_idx" ON "reportes_bug"("estatus", "created_at");

-- AddForeignKey
ALTER TABLE "reportes_bug" ADD CONSTRAINT "reportes_bug_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sedes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reportes_bug" ADD CONSTRAINT "reportes_bug_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: fila única de configuración (singleton) — sin esto, la primera
-- llamada a GET /soporte/config fallaría contra una tabla vacía.
INSERT INTO "configuracion_soporte" ("id", "activo", "updated_at")
VALUES ('global', true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- ============================================================
-- REPORTES_BUG (sede_id directo) — mismo patrón que telefonos_emergencia_sede
-- ============================================================
ALTER TABLE "reportes_bug" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "reportes_bug" TO authenticated;

CREATE POLICY "sede_isolation_reportes_bug" ON "reportes_bug"
  FOR ALL
  USING (sede_id = public.current_sede_id())
  WITH CHECK (sede_id = public.current_sede_id());

-- ============================================================
-- CONFIGURACION_SOPORTE — global (sin sede_id). RLS habilitada SIN
-- policies (mismo criterio que admin_plataforma): cerrado por default
-- para authenticated/anon. El backend conecta como rol postgres y
-- bypassa RLS de cualquier forma — esto es defensa en profundidad, el
-- control de acceso real es PlatformAdminGuard/RolesGuard.
-- ============================================================
ALTER TABLE "configuracion_soporte" ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 3: Aplicar la migración contra la DB de dev y regenerar el cliente**

Run: `cd App/backend && npx prisma db execute --file prisma/migrations/20260924120000_bot_soporte/migration.sql --schema prisma/schema.prisma`

Expected: sin error.

Run: `cd App/backend && npx prisma generate`

Expected: `Generated Prisma Client` sin error — `PrismaClient` ahora tipa `ConfiguracionSoporte`/`ReporteBug`/`EstatusReporteBug`.

Run: `cd App/backend && npx prisma migrate resolve --applied 20260924120000_bot_soporte`

Expected: `Migration ... marked as applied`.

- [ ] **Step 4: Script permanente del bucket**

Crear `App/backend/prisma/crear-bucket-reportes-bug.ts` (calco de `crear-bucket-fotos-perfil.ts`, NO es un script `-tmp.ts`):

```ts
/**
 * Bootstrap del bucket de Storage para capturas de reportes de bugs —
 * feature "Bot de soporte" (2026-09-24). Permanente, idempotente y
 * repetible (mismo criterio que `crear-bucket-fotos-perfil.ts`).
 *
 * Uso: `npx ts-node prisma/crear-bucket-reportes-bug.ts`
 */
import { loadEnv } from '../src/load-env';

loadEnv();

const NOMBRE_BUCKET = 'reportes-bug';

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
  console.error('Error en crear-bucket-reportes-bug:', e);
  process.exit(1);
});
```

Run: `cd App/backend && npx ts-node prisma/crear-bucket-reportes-bug.ts`

Expected: `Bucket "reportes-bug" creado (privado, 3MB, jpeg/png/webp).` (o "ya existe" si se re-corre).

- [ ] **Step 5: Confirmar que el build sigue limpio**

Run: `cd App/backend && npx nest build`

Expected: sin errores de TypeScript.

- [ ] **Step 6: Commit**

```bash
git add App/backend/prisma/schema.prisma App/backend/prisma/migrations/20260924120000_bot_soporte App/backend/prisma/crear-bucket-reportes-bug.ts
git commit -m "feat(backend): agrega ConfiguracionSoporte/ReporteBug + bucket reportes-bug"
```

---

## Task 2: Backend — `TelegramService`

**Files:**
- Create: `App/backend/src/telegram/telegram.service.ts`
- Create: `App/backend/src/telegram/telegram.module.ts`
- Create: `App/backend/src/telegram/telegram.service.spec.ts`
- Modify: `App/backend/src/app.module.ts`
- Create: `docs/setup-backend-telegram.md`

**Interfaces:**
- Produces: `TelegramService.enviarReporteBug(params: EnviarReporteBugParams): Promise<void>`, token `TELEGRAM_FETCH_OVERRIDE`, export `TelegramModule`. Consumido por `SoporteService` en el Task 4.
- Consumes: nada de tasks anteriores — módulo aislado, mismo criterio que `MailModule`.

- [ ] **Step 1: Escribir el test unitario (falla primero — la clase no existe)**

Crear `App/backend/src/telegram/telegram.service.spec.ts`:

```ts
import { TelegramService } from './telegram.service';

/**
 * Test unitario — mismo criterio que `mail.service.spec.ts`: `fetch` se
 * inyecta a mano vía el constructor (mismo mecanismo que
 * `TELEGRAM_FETCH_OVERRIDE`), sin Nest, sin red real.
 */
describe('TelegramService', () => {
  const ENV_ORIGINAL = { ...process.env };

  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
    process.env.TELEGRAM_CHAT_ID = '123456789';
  });

  afterEach(() => {
    process.env = { ...ENV_ORIGINAL };
  });

  function mockFetchOk(): jest.Mock {
    return jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve(''),
    });
  }

  it('sin capturaUrl, llama a sendMessage con chat_id y text', async () => {
    const fetchMock = mockFetchOk();
    const service = new TelegramService(fetchMock);

    await service.enviarReporteBug({
      descripcion: 'El botón de guardar no responde',
      nombreReportante: 'Ana Canul',
      sedeNombre: 'CESP Mérida',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/bottest-bot-token/sendMessage');
    const body = JSON.parse(init.body as string) as {
      chat_id: string;
      text: string;
    };
    expect(body.chat_id).toBe('123456789');
    expect(body.text).toContain('El botón de guardar no responde');
    expect(body.text).toContain('CESP Mérida');
    expect(body.text).toContain('Ana Canul');
  });

  it('con capturaUrl, llama a sendPhoto con photo y caption truncado a 1024', async () => {
    const fetchMock = mockFetchOk();
    const service = new TelegramService(fetchMock);
    const descripcionLarga = 'x'.repeat(2000);

    await service.enviarReporteBug({
      descripcion: descripcionLarga,
      nombreReportante: 'Jorge Ek',
      sedeNombre: 'CESP Valladolid',
      capturaUrl: 'https://storage.example.com/signed/captura.png',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/bottest-bot-token/sendPhoto');
    const body = JSON.parse(init.body as string) as {
      chat_id: string;
      photo: string;
      caption: string;
    };
    expect(body.photo).toBe('https://storage.example.com/signed/captura.png');
    expect(body.caption.length).toBeLessThanOrEqual(1024);
    expect(body.caption.endsWith('...')).toBe(true);
  });

  it('lanza si faltan TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const service = new TelegramService(mockFetchOk());

    await expect(
      service.enviarReporteBug({
        descripcion: 'x',
        nombreReportante: 'x',
        sedeNombre: 'x',
      }),
    ).rejects.toThrow('Falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID');
  });

  it('lanza si Telegram responde un status no-2xx', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: () => Promise.resolve('chat not found'),
    });
    const service = new TelegramService(fetchMock);

    await expect(
      service.enviarReporteBug({
        descripcion: 'x',
        nombreReportante: 'x',
        sedeNombre: 'x',
      }),
    ).rejects.toThrow('Telegram respondió 400');
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd App/backend && npx jest src/telegram/telegram.service.spec.ts`

Expected: FAIL — `Cannot find module './telegram.service'`.

- [ ] **Step 3: Implementar `TelegramService`**

Crear `App/backend/src/telegram/telegram.service.ts`:

```ts
import { Inject, Injectable, Optional } from '@nestjs/common';

/**
 * `TelegramService` — feature "Bot de soporte" (2026-09-24).
 *
 * Cliente mínimo de la Bot API de Telegram vía `fetch` nativo — mismo
 * criterio que `MailService`: sin SDK, un solo uso no lo amerita.
 *
 * Best-effort SIEMPRE desde el punto de vista del CALLER
 * (`SoporteService.crearReporte`): este service lanza si falta config o si
 * Telegram rechaza/la red falla, y es responsabilidad del caller envolver
 * la llamada en su propio try/catch sin dejar que un fallo de Telegram
 * tumbe el reporte ya guardado — mismo patrón que
 * `MailService.enviarNotificacion` + `PersonasService.altaPersona`.
 *
 * A diferencia de `MailService`, no hay un flag tipo
 * `MAILGUN_ENVIOS_HABILITADO` — el toggle `ConfiguracionSoporte.activo` ya
 * cumple ese rol un nivel arriba (`SoporteService.crearReporte` nunca llega
 * a llamar este service si el bot está desactivado).
 */
export const TELEGRAM_FETCH_OVERRIDE = 'TELEGRAM_FETCH_OVERRIDE';

export interface EnviarReporteBugParams {
  descripcion: string;
  nombreReportante: string;
  sedeNombre: string;
  /** URL firmada (signed URL) ya lista para que Telegram la descargue directo — el backend nunca sube el binario. */
  capturaUrl?: string | null;
}

/** Límite real de la Bot API para `caption` en `sendPhoto`. */
const LIMITE_CAPTION_TELEGRAM = 1024;

function truncar(texto: string, limite: number): string {
  return texto.length > limite ? `${texto.slice(0, limite - 3)}...` : texto;
}

@Injectable()
export class TelegramService {
  constructor(
    @Optional()
    @Inject(TELEGRAM_FETCH_OVERRIDE)
    private readonly fetchOverride?: typeof fetch,
  ) {}

  private getFetch(): typeof fetch {
    return this.fetchOverride ?? fetch;
  }

  private construirTexto(params: EnviarReporteBugParams): string {
    return [
      '🐛 Nuevo reporte de bug — SIGE',
      '',
      `Sede: ${params.sedeNombre}`,
      `Reportado por: ${params.nombreReportante}`,
      '',
      params.descripcion,
    ].join('\n');
  }

  /**
   * Envía el aviso de un reporte de bug — `sendPhoto` (con caption) si trae
   * `capturaUrl`, `sendMessage` (solo texto) si no. Lanza si falta
   * `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`, si Telegram responde no-2xx, o
   * si `fetch` rechaza (red) — ver comentario de la clase.
   */
  async enviarReporteBug(params: EnviarReporteBugParams): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      throw new Error(
        'Falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en el entorno',
      );
    }

    const texto = this.construirTexto(params);
    const endpoint = params.capturaUrl ? 'sendPhoto' : 'sendMessage';
    const body = params.capturaUrl
      ? {
          chat_id: chatId,
          photo: params.capturaUrl,
          caption: truncar(texto, LIMITE_CAPTION_TELEGRAM),
        }
      : { chat_id: chatId, text: texto };

    const clientFetch = this.getFetch();
    const response = await clientFetch(
      `https://api.telegram.org/bot${token}/${endpoint}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const detalle = await response.text().catch(() => '');
      throw new Error(
        `Telegram respondió ${response.status} ${response.statusText}: ${detalle}`,
      );
    }
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd App/backend && npx jest src/telegram/telegram.service.spec.ts`

Expected: PASS — 4/4.

- [ ] **Step 5: `TelegramModule`**

Crear `App/backend/src/telegram/telegram.module.ts` (calco de `mail.module.ts`):

```ts
import { Module } from '@nestjs/common';
import { TELEGRAM_FETCH_OVERRIDE, TelegramService } from './telegram.service';

@Module({
  providers: [
    TelegramService,
    { provide: TELEGRAM_FETCH_OVERRIDE, useValue: undefined },
  ],
  exports: [TelegramService, TELEGRAM_FETCH_OVERRIDE],
})
export class TelegramModule {}
```

- [ ] **Step 6: Registrar `TelegramModule` en `AppModule`**

Modificar `App/backend/src/app.module.ts` — agregar el import junto a `MailModule`:

```ts
import { MailModule } from './mail/mail.module';
import { TelegramModule } from './telegram/telegram.module';
```

Y en el array `imports`, junto a `MailModule`:

```ts
    MailModule,
    TelegramModule,
```

- [ ] **Step 7: Documentar el setup manual**

Crear `docs/setup-backend-telegram.md`:

```markdown
# Setup — Bot de Telegram para reportes de bugs

El "Bot de soporte" de SIGE avisa por Telegram cuando un administrativo o
maestro reporta un bug (`POST /soporte/reportes`). Requiere un bot de
Telegram propio y 2 variables de entorno en `App/backend/.env`.

## 1. Crear el bot

1. Abre Telegram y busca `@BotFather`.
2. Manda `/newbot`, sigue las instrucciones (nombre + username terminado en
   `bot`).
3. BotFather responde con un token con forma
   `123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` — esto es
   `TELEGRAM_BOT_TOKEN`.

## 2. Obtener tu `chat_id`

1. Busca tu bot nuevo en Telegram (por su username) y mándale cualquier
   mensaje (ej. "hola") para iniciar la conversación.
2. Abre en el navegador:
   `https://api.telegram.org/bot<TU_TOKEN>/getUpdates`
3. Busca `"chat":{"id":` en la respuesta JSON — ese número es
   `TELEGRAM_CHAT_ID`.

## 3. Configurar el backend

En `App/backend/.env`:

```
TELEGRAM_BOT_TOKEN=123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TELEGRAM_CHAT_ID=987654321
```

Sin estas 2 variables, `TelegramService` lanza al primer intento de envío
— el reporte de bug igual se guarda en la DB (best-effort), solo no llega
el aviso a Telegram. No hay flag de "envíos habilitados" separado — el
toggle de `app/plataforma/soporte/` (`ConfiguracionSoporte.activo`) ya
controla si se llega a intentar el envío.
```

- [ ] **Step 8: Confirmar que el build sigue limpio**

Run: `cd App/backend && npx nest build`

Expected: sin errores.

- [ ] **Step 9: Commit**

```bash
git add App/backend/src/telegram App/backend/src/app.module.ts docs/setup-backend-telegram.md
git commit -m "feat(backend): agrega TelegramService para avisos de reportes de bugs"
```

---

## Task 3: Backend — `SoporteService`/`SoporteController` (config) + `GET/PATCH /soporte/config`

**Files:**
- Create: `App/backend/src/soporte/soporte.service.ts`
- Create: `App/backend/src/soporte/soporte.module.ts`
- Create: `App/backend/src/soporte/soporte.controller.ts`
- Create: `App/backend/src/soporte/dto/actualizar-config-soporte.dto.ts`
- Modify: `App/backend/src/app.module.ts`
- Create: `App/backend/test/soporte-config.e2e-spec.ts`

**Interfaces:**
- Produces: `SoporteService.obtenerConfig(): Promise<{ activo: boolean }>`, `.actualizarConfig(activo: boolean, adminPlataformaId: string): Promise<{ activo: boolean }>` — el Task 4 depende de `obtenerConfig` (gate de `crearReporte`). `SoporteModule` exporta `SoporteService`.
- Consumes: `PrismaService` (existente), `PlatformAdminGuard`/`@PlatformAdminActual()`/`SedeGuard`/`RolesGuard`/`@Roles` (existentes).

- [ ] **Step 1: DTO de `PATCH /soporte/config`**

Crear `App/backend/src/soporte/dto/actualizar-config-soporte.dto.ts`:

```ts
import { IsBoolean } from 'class-validator';

export class ActualizarConfigSoporteDto {
  @IsBoolean({ message: 'activo debe ser booleano' })
  activo!: boolean;
}
```

- [ ] **Step 2: `SoporteService` (solo config por ahora)**

Crear `App/backend/src/soporte/soporte.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { AccionAuditoria } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Id fijo de la única fila de `ConfiguracionSoporte` — sembrada por la migración `20260924120000_bot_soporte`. */
export const CONFIGURACION_SOPORTE_ID = 'global';

@Injectable()
export class SoporteService {
  constructor(protected readonly prisma: PrismaService) {}

  /**
   * `upsert` en vez de `findUniqueOrThrow` — garantiza que la fila exista
   * incluso si el seed de la migración no corrió (ej. DB recreada a mano),
   * sin necesitar un chequeo defensivo aparte.
   */
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
}
```

- [ ] **Step 3: `SoporteController` (solo config por ahora)**

Crear `App/backend/src/soporte/soporte.controller.ts`:

```ts
import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { RolUsuario } from '@prisma/client';
import { PlatformAdminActual } from '../common/decorators/platform-admin-actual.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PlatformAdminGuard } from '../common/guards/platform-admin.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { SedeGuard } from '../common/guards/sede.guard';
import { ActualizarConfigSoporteDto } from './dto/actualizar-config-soporte.dto';
import { SoporteService } from './soporte.service';

/**
 * `SoporteController` — feature "Bot de soporte" (2026-09-24).
 *
 * Mezcla 2 actores distintos, igual que `SedesController`: guards por
 * MÉTODO, no a nivel de clase. `GET /soporte/config` lo consulta
 * ADMINISTRATIVO/MAESTRO (JWT de Supabase, `SedeGuard`+`RolesGuard`);
 * `PATCH /soporte/config` y las rutas de `/reportes` de gestión (Task 5)
 * son de `AdminPlataforma` (`PlatformAdminGuard`).
 */
@Controller('soporte')
export class SoporteController {
  constructor(protected readonly soporteService: SoporteService) {}

  @Get('config')
  @UseGuards(SedeGuard, RolesGuard)
  @Roles(RolUsuario.ADMINISTRATIVO, RolUsuario.MAESTRO)
  async obtenerConfig() {
    const data = await this.soporteService.obtenerConfig();
    return { data };
  }

  @Patch('config')
  @UseGuards(PlatformAdminGuard)
  async actualizarConfig(
    @Body() dto: ActualizarConfigSoporteDto,
    @PlatformAdminActual() adminId: string,
  ) {
    const data = await this.soporteService.actualizarConfig(
      dto.activo,
      adminId,
    );
    return { data };
  }
}
```

- [ ] **Step 4: `SoporteModule`**

Crear `App/backend/src/soporte/soporte.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { SoporteController } from './soporte.controller';
import { SoporteService } from './soporte.service';

@Module({
  controllers: [SoporteController],
  providers: [SoporteService],
  exports: [SoporteService],
})
export class SoporteModule {}
```

- [ ] **Step 5: Registrar `SoporteModule` en `AppModule`**

Modificar `App/backend/src/app.module.ts`:

```ts
import { SoporteModule } from './soporte/soporte.module';
```

Y en `imports`, al final:

```ts
    EmergenciaModule,
    SoporteModule,
```

- [ ] **Step 6: Escribir el test e2e**

Crear `App/backend/test/soporte-config.e2e-spec.ts` (mismo patrón de JWT firmado con `jose` que el resto de la suite e2e; para las rutas de `PlatformAdminGuard`, mismo patrón EXACTO de `test/sedes-crud.e2e-spec.ts` — crear un `AdminPlataforma` de prueba propio y firmar con `firmarPlatformAdminToken({ sub, email })`, NUNCA reusar uno del seed):

```ts
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { RolUsuario } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { SEDE_GUARD_ENV_OVERRIDE } from '../src/common/guards/sede.guard';
import { firmarPlatformAdminToken } from '../src/platform-admin/platform-admin-jwt.util';
import { hashPassword } from '../src/platform-admin/password.util';
import { loadEnv } from '../src/load-env';
import { PrismaService } from '../src/prisma/prisma.service';
import { CONFIGURACION_SOPORTE_ID } from '../src/soporte/soporte.service';
import { configureApp } from '../src/setup-app';

loadEnv();

interface ErrorBody {
  error: string;
  code: string;
}
interface ConfigBody {
  data: { activo: boolean };
}

describe('Soporte — GET/PATCH /soporte/config (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let adminMeridaId: string;
  let maestroMeridaId: string;
  let platformAdminId: string;
  let platformToken: string;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';
  const emailPlatformAdmin = 'e2e-soporte-config@example.com';

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

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SEDE_GUARD_ENV_OVERRIDE)
      .useValue({ jwks: { keys: [publicJwk] } })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    const merida = await prisma.sede.findUniqueOrThrow({ where: { nombre: 'CESP Mérida' } });
    sedeMeridaId = merida.id;
    const adminMerida = await prisma.usuario.findUniqueOrThrow({ where: { email: 'ana.canul@cesp-merida.edu.mx' } });
    adminMeridaId = adminMerida.id;
    const maestroMerida = await prisma.usuario.findFirstOrThrow({ where: { sedeId: sedeMeridaId, rol: RolUsuario.MAESTRO } });
    maestroMeridaId = maestroMerida.id;

    await prisma.adminPlataforma.deleteMany({ where: { email: emailPlatformAdmin } });
    const platformAdmin = await prisma.adminPlataforma.create({
      data: {
        email: emailPlatformAdmin,
        passwordHash: await hashPassword('password-e2e-123'),
        nombre: 'E2E Soporte Config',
      },
    });
    platformAdminId = platformAdmin.id;
    platformToken = await firmarPlatformAdminToken({
      sub: platformAdmin.id,
      email: platformAdmin.email,
    });
  });

  afterAll(async () => {
    // Deja el toggle en su estado por default para no afectar otras suites.
    await prisma.configuracionSoporte.upsert({
      where: { id: CONFIGURACION_SOPORTE_ID },
      create: { id: CONFIGURACION_SOPORTE_ID, activo: true },
      update: { activo: true },
    });
    await prisma.registroAuditoria.deleteMany({
      where: { adminPlataformaId: platformAdminId },
    });
    await prisma.adminPlataforma.delete({ where: { id: platformAdminId } });
    await app.close();
  });

  it('GET /soporte/config responde activo:true por default (ADMINISTRATIVO)', async () => {
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO },
      adminMeridaId,
    );
    const res = await request(app.getHttpServer())
      .get('/soporte/config')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect((res.body as ConfigBody).data.activo).toBe(true);
  });

  it('GET /soporte/config también responde para MAESTRO', async () => {
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.MAESTRO },
      maestroMeridaId,
    );
    const res = await request(app.getHttpServer())
      .get('/soporte/config')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('GET /soporte/config con rol ALUMNO responde 403 ROL_NO_AUTORIZADO', async () => {
    const alumno = await prisma.usuario.findFirstOrThrow({ where: { sedeId: sedeMeridaId, rol: RolUsuario.ALUMNO } });
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ALUMNO },
      alumno.id,
    );
    const res = await request(app.getHttpServer())
      .get('/soporte/config')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });

  it('PATCH /soporte/config con JWT de Supabase (no de plataforma) responde 401', async () => {
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO },
      adminMeridaId,
    );
    const res = await request(app.getHttpServer())
      .patch('/soporte/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ activo: false });
    expect(res.status).toBe(401);
  });

  it('PATCH /soporte/config apaga y GET refleja el cambio', async () => {
    const patch = await request(app.getHttpServer())
      .patch('/soporte/config')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ activo: false });
    expect(patch.status).toBe(200);
    expect((patch.body as ConfigBody).data.activo).toBe(false);

    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO },
      adminMeridaId,
    );
    const get = await request(app.getHttpServer())
      .get('/soporte/config')
      .set('Authorization', `Bearer ${token}`);
    expect((get.body as ConfigBody).data.activo).toBe(false);

    const registro = await prisma.registroAuditoria.findFirst({
      where: { entidad: 'ConfiguracionSoporte', accion: 'EDICION' },
      orderBy: { fecha: 'desc' },
    });
    expect(registro?.adminPlataformaId).toBe(platformAdminId);
  });
});
```

- [ ] **Step 7: Correr la suite nueva**

Run: `cd App/backend && npx jest test/soporte-config.e2e-spec.ts --runInBand`

Expected: 5/5 en verde.

- [ ] **Step 8: Correr la regresión completa del backend**

Run: `cd App/backend && npx nest build && npm run test:e2e`

Expected: build limpio, todas las suites en verde.

- [ ] **Step 9: Commit**

```bash
git add App/backend/src/soporte App/backend/src/app.module.ts App/backend/test/soporte-config.e2e-spec.ts
git commit -m "feat(backend): SoporteService + GET/PATCH /soporte/config"
```

---

## Task 4: Backend — `POST /soporte/reportes` (crear reporte, captura opcional, Telegram best-effort)

**Files:**
- Create: `App/backend/src/soporte/archivo-captura-invalida.filter.ts`
- Create: `App/backend/src/soporte/dto/crear-reporte-bug.dto.ts`
- Modify: `App/backend/src/soporte/soporte.service.ts`
- Modify: `App/backend/src/soporte/soporte.module.ts`
- Modify: `App/backend/src/soporte/soporte.controller.ts`
- Create: `App/backend/test/soporte-reportes.e2e-spec.ts`

**Interfaces:**
- Consumes: `TelegramService.enviarReporteBug` (Task 2), `SoporteService.obtenerConfig` (Task 3).
- Produces: `SoporteService.crearReporte(sedeId, usuarioId, descripcion, file?): Promise<{ id: string }>` — el Task 5 no depende de esto directo, pero comparte el mismo `SoporteService`/módulo.

- [ ] **Step 1: Filter de archivo inválido (local a `soporte/`, mismo criterio que `foto-perfil` — copia chica, no se comparte con `malla-curricular`)**

Crear `App/backend/src/soporte/archivo-captura-invalida.filter.ts`:

```ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';

@Catch(PayloadTooLargeException)
export class ArchivoCapturaInvalidaFilter implements ExceptionFilter {
  catch(exception: PayloadTooLargeException, host: ArgumentsHost): void {
    console.error(
      '[SoporteController] captura excede el límite de 3MB:',
      exception.message,
    );
    const response = host.switchToHttp().getResponse<Response>();
    response.status(400).json({
      error: 'La captura no puede pesar más de 3MB',
      code: 'VALIDATION_ERROR',
    });
  }
}
```

- [ ] **Step 2: DTO de `POST /soporte/reportes`**

Crear `App/backend/src/soporte/dto/crear-reporte-bug.dto.ts`:

```ts
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CrearReporteBugDto {
  @IsString()
  @IsNotEmpty({ message: 'descripcion no puede estar vacía' })
  @MaxLength(2000, { message: 'descripcion no puede exceder 2000 caracteres' })
  descripcion!: string;
}
```

- [ ] **Step 3: `SoporteService.crearReporte`**

Modificar `App/backend/src/soporte/soporte.service.ts` — agregar imports, inyectar `TelegramService`, agregar el método. Reemplazar el archivo completo:

```ts
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Optional,
} from '@nestjs/common';
import { AccionAuditoria } from '@prisma/client';
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
      if (entrada.error || !entrada.signedUrl) {
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
}
```

- [ ] **Step 4: `SoporteController` — `POST /soporte/reportes`**

Modificar `App/backend/src/soporte/soporte.controller.ts` — reemplazar el archivo completo:

```ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RolUsuario } from '@prisma/client';
import { ActorUsuarioId } from '../common/decorators/actor-usuario-id.decorator';
import { PlatformAdminActual } from '../common/decorators/platform-admin-actual.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SedeActual } from '../common/decorators/sede-actual.decorator';
import { PlatformAdminGuard } from '../common/guards/platform-admin.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { SedeGuard } from '../common/guards/sede.guard';
import { ArchivoCapturaInvalidaFilter } from './archivo-captura-invalida.filter';
import { ActualizarConfigSoporteDto } from './dto/actualizar-config-soporte.dto';
import { CrearReporteBugDto } from './dto/crear-reporte-bug.dto';
import { SoporteService } from './soporte.service';

const TRES_MB = 3 * 1024 * 1024;

@Controller('soporte')
export class SoporteController {
  constructor(protected readonly soporteService: SoporteService) {}

  @Get('config')
  @UseGuards(SedeGuard, RolesGuard)
  @Roles(RolUsuario.ADMINISTRATIVO, RolUsuario.MAESTRO)
  async obtenerConfig() {
    const data = await this.soporteService.obtenerConfig();
    return { data };
  }

  @Patch('config')
  @UseGuards(PlatformAdminGuard)
  async actualizarConfig(
    @Body() dto: ActualizarConfigSoporteDto,
    @PlatformAdminActual() adminId: string,
  ) {
    const data = await this.soporteService.actualizarConfig(
      dto.activo,
      adminId,
    );
    return { data };
  }

  @Post('reportes')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SedeGuard, RolesGuard)
  @Roles(RolUsuario.ADMINISTRATIVO, RolUsuario.MAESTRO)
  @UseInterceptors(
    FileInterceptor('captura', { limits: { fileSize: TRES_MB } }),
  )
  @UseFilters(ArchivoCapturaInvalidaFilter)
  async crearReporte(
    @Body() dto: CrearReporteBugDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() usuarioId: string,
  ) {
    const data = await this.soporteService.crearReporte(
      sedeId,
      usuarioId,
      dto.descripcion,
      file,
    );
    return { data };
  }
}
```

- [ ] **Step 5: `SoporteModule` inyecta `TelegramModule` + provider de override**

Modificar `App/backend/src/soporte/soporte.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TelegramModule } from '../telegram/telegram.module';
import { SoporteController } from './soporte.controller';
import {
  SOPORTE_SUPABASE_CLIENT_OVERRIDE,
  SoporteService,
} from './soporte.service';

@Module({
  imports: [TelegramModule],
  controllers: [SoporteController],
  providers: [
    SoporteService,
    { provide: SOPORTE_SUPABASE_CLIENT_OVERRIDE, useValue: undefined },
  ],
  exports: [SoporteService, SOPORTE_SUPABASE_CLIENT_OVERRIDE],
})
export class SoporteModule {}
```

- [ ] **Step 6: Escribir el test e2e**

Crear `App/backend/test/soporte-reportes.e2e-spec.ts` (mismo patrón de mock de Storage que `test/foto-perfil.e2e-spec.ts`, más `TELEGRAM_FETCH_OVERRIDE`):

```ts
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { RolUsuario } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { SEDE_GUARD_ENV_OVERRIDE } from '../src/common/guards/sede.guard';
import { loadEnv } from '../src/load-env';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  CONFIGURACION_SOPORTE_ID,
  SOPORTE_SUPABASE_CLIENT_OVERRIDE,
} from '../src/soporte/soporte.service';
import { TELEGRAM_FETCH_OVERRIDE } from '../src/telegram/telegram.service';
import { configureApp } from '../src/setup-app';

loadEnv();

interface ErrorBody {
  error: string;
  code: string;
}
interface ReporteCreadoBody {
  data: { id: string };
}

describe('Soporte — POST /soporte/reportes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let adminMeridaId: string;
  let upload: jest.Mock;
  let createSignedUrls: jest.Mock;
  let telegramFetch: jest.Mock;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';
  const reportesCreados: string[] = [];

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
      storage: { from: () => ({ upload, createSignedUrls }) },
    };

    telegramFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve(''),
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SEDE_GUARD_ENV_OVERRIDE)
      .useValue({ jwks: { keys: [publicJwk] } })
      .overrideProvider(SOPORTE_SUPABASE_CLIENT_OVERRIDE)
      .useValue(mockSupabaseAdminClient)
      .overrideProvider(TELEGRAM_FETCH_OVERRIDE)
      .useValue(telegramFetch)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    const merida = await prisma.sede.findUniqueOrThrow({ where: { nombre: 'CESP Mérida' } });
    sedeMeridaId = merida.id;
    const adminMerida = await prisma.usuario.findUniqueOrThrow({ where: { email: 'ana.canul@cesp-merida.edu.mx' } });
    adminMeridaId = adminMerida.id;

    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_CHAT_ID = '1';

    await prisma.configuracionSoporte.upsert({
      where: { id: CONFIGURACION_SOPORTE_ID },
      create: { id: CONFIGURACION_SOPORTE_ID, activo: true },
      update: { activo: true },
    });
  });

  afterEach(() => {
    upload.mockClear();
    createSignedUrls.mockClear();
    telegramFetch.mockClear();
  });

  afterAll(async () => {
    await prisma.reporteBug.deleteMany({ where: { id: { in: reportesCreados } } });
    await prisma.configuracionSoporte.upsert({
      where: { id: CONFIGURACION_SOPORTE_ID },
      create: { id: CONFIGURACION_SOPORTE_ID, activo: true },
      update: { activo: true },
    });
    await app.close();
  });

  it('crea un reporte sin captura y avisa por Telegram (sendMessage)', async () => {
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO },
      adminMeridaId,
    );

    const res = await request(app.getHttpServer())
      .post('/soporte/reportes')
      .set('Authorization', `Bearer ${token}`)
      .field('descripcion', 'El botón de guardar no responde');

    expect(res.status).toBe(201);
    const id = (res.body as ReporteCreadoBody).data.id;
    reportesCreados.push(id);

    const reporte = await prisma.reporteBug.findUniqueOrThrow({ where: { id } });
    expect(reporte.descripcion).toBe('El botón de guardar no responde');
    expect(reporte.capturaStoragePath).toBeNull();
    expect(reporte.estatus).toBe('NUEVO');
    expect(upload).not.toHaveBeenCalled();
    expect(telegramFetch).toHaveBeenCalledTimes(1);
    const [url] = telegramFetch.mock.calls[0] as [string];
    expect(url).toContain('/sendMessage');
  });

  it('crea un reporte con captura y avisa por Telegram (sendPhoto)', async () => {
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO },
      adminMeridaId,
    );

    const res = await request(app.getHttpServer())
      .post('/soporte/reportes')
      .set('Authorization', `Bearer ${token}`)
      .field('descripcion', 'La tabla de grupos no carga')
      .attach('captura', Buffer.from('contenido png de prueba'), {
        filename: 'captura.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(201);
    const id = (res.body as ReporteCreadoBody).data.id;
    reportesCreados.push(id);

    const reporte = await prisma.reporteBug.findUniqueOrThrow({ where: { id } });
    expect(reporte.capturaStoragePath).toBe(`${sedeMeridaId}/${id}.png`);
    expect(upload).toHaveBeenCalledWith(
      `${sedeMeridaId}/${id}.png`,
      expect.any(Buffer),
      { contentType: 'image/png' },
    );
    expect(telegramFetch).toHaveBeenCalledTimes(1);
    const [url] = telegramFetch.mock.calls[0] as [string];
    expect(url).toContain('/sendPhoto');
  });

  it('un tipo de archivo inválido responde 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO },
      adminMeridaId,
    );

    const res = await request(app.getHttpServer())
      .post('/soporte/reportes')
      .set('Authorization', `Bearer ${token}`)
      .field('descripcion', 'x')
      .attach('captura', Buffer.from('no es una imagen'), {
        filename: 'archivo.txt',
        contentType: 'text/plain',
      });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
    expect(upload).not.toHaveBeenCalled();
  });

  it('sin descripcion responde 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO },
      adminMeridaId,
    );

    const res = await request(app.getHttpServer())
      .post('/soporte/reportes')
      .set('Authorization', `Bearer ${token}`)
      .field('descripcion', '');

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('con el bot desactivado responde 409 SOPORTE_DESACTIVADO', async () => {
    await prisma.configuracionSoporte.update({
      where: { id: CONFIGURACION_SOPORTE_ID },
      data: { activo: false },
    });

    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO },
      adminMeridaId,
    );
    const res = await request(app.getHttpServer())
      .post('/soporte/reportes')
      .set('Authorization', `Bearer ${token}`)
      .field('descripcion', 'esto no debería crearse');

    expect(res.status).toBe(409);
    expect((res.body as ErrorBody).code).toBe('SOPORTE_DESACTIVADO');
    expect(telegramFetch).not.toHaveBeenCalled();

    await prisma.configuracionSoporte.update({
      where: { id: CONFIGURACION_SOPORTE_ID },
      data: { activo: true },
    });
  });

  it('rol ALUMNO responde 403 ROL_NO_AUTORIZADO', async () => {
    const alumno = await prisma.usuario.findFirstOrThrow({ where: { sedeId: sedeMeridaId, rol: RolUsuario.ALUMNO } });
    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ALUMNO },
      alumno.id,
    );
    const res = await request(app.getHttpServer())
      .post('/soporte/reportes')
      .set('Authorization', `Bearer ${token}`)
      .field('descripcion', 'x');

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });

  it('si Telegram falla, el reporte igual queda guardado (best-effort)', async () => {
    telegramFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.resolve('boom'),
    });

    const token = await firmarToken(
      { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO },
      adminMeridaId,
    );
    const res = await request(app.getHttpServer())
      .post('/soporte/reportes')
      .set('Authorization', `Bearer ${token}`)
      .field('descripcion', 'Telegram caído pero esto se debe guardar');

    expect(res.status).toBe(201);
    const id = (res.body as ReporteCreadoBody).data.id;
    reportesCreados.push(id);
    const reporte = await prisma.reporteBug.findUnique({ where: { id } });
    expect(reporte).not.toBeNull();
  });
});
```

- [ ] **Step 7: Correr la suite nueva**

Run: `cd App/backend && npx jest test/soporte-reportes.e2e-spec.ts --runInBand`

Expected: 7/7 en verde.

- [ ] **Step 8: Correr la regresión completa del backend**

Run: `cd App/backend && npx nest build && npm run test:e2e`

Expected: todo en verde.

- [ ] **Step 9: Commit**

```bash
git add App/backend/src/soporte App/backend/test/soporte-reportes.e2e-spec.ts
git commit -m "feat(backend): POST /soporte/reportes con captura opcional y aviso a Telegram"
```

---

## Task 5: Backend — `GET /soporte/reportes` + `PATCH /soporte/reportes/:id/estatus` (gestión desde plataforma)

**Files:**
- Create: `App/backend/src/soporte/dto/listar-reportes-bug.query.dto.ts`
- Create: `App/backend/src/soporte/dto/cambiar-estatus-reporte-bug.dto.ts`
- Modify: `App/backend/src/soporte/soporte.service.ts`
- Modify: `App/backend/src/soporte/soporte.controller.ts`
- Create: `App/backend/test/soporte-gestion.e2e-spec.ts`

**Interfaces:**
- Produces: `SoporteService.listarReportes(estatus?, page?, limit?): Promise<{ data: ReporteBugListItem[], page, limit, total }>`, `.cambiarEstatus(id, estatus, adminPlataformaId): Promise<{ ok: true }>`. `ReporteBugListItem = { id, sede: {id,nombre}, reportante: string, descripcion, capturaUrl: string|null, estatus, createdAt, updatedAt }` — lo consume el Task 8 del frontend.
- Consumes: `firmarUrls` (privado, ya existe en `SoporteService` desde el Task 4).

- [ ] **Step 1: DTOs**

Crear `App/backend/src/soporte/dto/listar-reportes-bug.query.dto.ts`:

```ts
import { EstatusReporteBug } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListarReportesBugQueryDto {
  @IsOptional()
  @IsEnum(EstatusReporteBug)
  estatus?: EstatusReporteBug;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
```

Crear `App/backend/src/soporte/dto/cambiar-estatus-reporte-bug.dto.ts`:

```ts
import { EstatusReporteBug } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class CambiarEstatusReporteBugDto {
  @IsEnum(EstatusReporteBug, { message: 'estatus inválido' })
  estatus!: EstatusReporteBug;
}
```

- [ ] **Step 2: `SoporteService.listarReportes` + `.cambiarEstatus`**

Modificar `App/backend/src/soporte/soporte.service.ts` — agregar imports (`EstatusReporteBug`, `NotFoundException`) y los 2 métodos, al final de la clase:

```ts
// agregar a los imports de @nestjs/common: NotFoundException
// agregar a los imports de @prisma/client: EstatusReporteBug

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
```

Actualizar los imports al inicio del archivo:

```ts
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
```

- [ ] **Step 3: `SoporteController` — `GET /soporte/reportes` + `PATCH /soporte/reportes/:id/estatus`**

Modificar `App/backend/src/soporte/soporte.controller.ts` — agregar imports y los 2 endpoints, al final de la clase:

```ts
// agregar a los imports: Param, Query
// agregar: import { CambiarEstatusReporteBugDto } from './dto/cambiar-estatus-reporte-bug.dto';
// agregar: import { ListarReportesBugQueryDto } from './dto/listar-reportes-bug.query.dto';

  @Get('reportes')
  @UseGuards(PlatformAdminGuard)
  async listarReportes(@Query() query: ListarReportesBugQueryDto) {
    return this.soporteService.listarReportes(
      query.estatus,
      query.page,
      query.limit,
    );
  }

  @Patch('reportes/:id/estatus')
  @UseGuards(PlatformAdminGuard)
  async cambiarEstatus(
    @Param('id') id: string,
    @Body() dto: CambiarEstatusReporteBugDto,
    @PlatformAdminActual() adminId: string,
  ) {
    const data = await this.soporteService.cambiarEstatus(
      id,
      dto.estatus,
      adminId,
    );
    return { data };
  }
```

(`listarReportes` retorna el shape `{ data, page, limit, total }` directo del service, sin envolver en `{ data: ... }` — mismo patrón que `PlatformAdminController.listarAuditoria`.)

- [ ] **Step 4: Escribir el test e2e**

Crear `App/backend/test/soporte-gestion.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { SEDE_GUARD_ENV_OVERRIDE } from '../src/common/guards/sede.guard';
import { firmarPlatformAdminToken } from '../src/platform-admin/platform-admin-jwt.util';
import { hashPassword } from '../src/platform-admin/password.util';
import { loadEnv } from '../src/load-env';
import { PrismaService } from '../src/prisma/prisma.service';
import { SOPORTE_SUPABASE_CLIENT_OVERRIDE } from '../src/soporte/soporte.service';
import { configureApp } from '../src/setup-app';

loadEnv();

interface ErrorBody {
  error: string;
  code: string;
}
interface ListaBody {
  data: { id: string; estatus: string; sede: { id: string } }[];
  page: number;
  limit: number;
  total: number;
}

describe('Soporte — GET/PATCH reportes (gestión, e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let adminMeridaId: string;
  let platformAdminId: string;
  let platformToken: string;
  let reporteId: string;
  const emailPlatformAdmin = 'e2e-soporte-gestion@example.com';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SEDE_GUARD_ENV_OVERRIDE)
      .useValue({ jwks: { keys: [] } })
      .overrideProvider(SOPORTE_SUPABASE_CLIENT_OVERRIDE)
      .useValue({ storage: { from: () => ({ createSignedUrls: () => Promise.resolve({ data: [], error: null }) }) } })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    const merida = await prisma.sede.findUniqueOrThrow({ where: { nombre: 'CESP Mérida' } });
    sedeMeridaId = merida.id;
    const adminMerida = await prisma.usuario.findUniqueOrThrow({ where: { email: 'ana.canul@cesp-merida.edu.mx' } });
    adminMeridaId = adminMerida.id;

    await prisma.adminPlataforma.deleteMany({ where: { email: emailPlatformAdmin } });
    const platformAdmin = await prisma.adminPlataforma.create({
      data: {
        email: emailPlatformAdmin,
        passwordHash: await hashPassword('password-e2e-123'),
        nombre: 'E2E Soporte Gestión',
      },
    });
    platformAdminId = platformAdmin.id;
    platformToken = await firmarPlatformAdminToken({
      sub: platformAdmin.id,
      email: platformAdmin.email,
    });

    const reporte = await prisma.reporteBug.create({
      data: {
        sedeId: sedeMeridaId,
        usuarioId: adminMeridaId,
        descripcion: 'Fixture de test — gestión de reportes',
      },
    });
    reporteId = reporte.id;
  });

  afterAll(async () => {
    await prisma.reporteBug.delete({ where: { id: reporteId } }).catch(() => undefined);
    await prisma.registroAuditoria.deleteMany({
      where: { adminPlataformaId: platformAdminId },
    });
    await prisma.adminPlataforma.delete({ where: { id: platformAdminId } });
    await app.close();
  });

  it('GET /soporte/reportes sin PlatformAdminGuard responde 401', async () => {
    const res = await request(app.getHttpServer()).get('/soporte/reportes');
    expect(res.status).toBe(401);
  });

  it('GET /soporte/reportes lista cross-sede, paginado', async () => {
    const res = await request(app.getHttpServer())
      .get('/soporte/reportes')
      .set('Authorization', `Bearer ${platformToken}`);

    expect(res.status).toBe(200);
    const body = res.body as ListaBody;
    expect(typeof body.total).toBe('number');
    expect(body.data.some((r) => r.id === reporteId)).toBe(true);
  });

  it('GET /soporte/reportes?estatus=NUEVO filtra', async () => {
    const res = await request(app.getHttpServer())
      .get('/soporte/reportes?estatus=NUEVO')
      .set('Authorization', `Bearer ${platformToken}`);

    expect(res.status).toBe(200);
    const body = res.body as ListaBody;
    expect(body.data.every((r) => r.estatus === 'NUEVO')).toBe(true);
  });

  it('GET /soporte/reportes?estatus=INVALIDO responde 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .get('/soporte/reportes?estatus=INVALIDO')
      .set('Authorization', `Bearer ${platformToken}`);

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('PATCH /soporte/reportes/:id/estatus cambia el estatus y audita', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/soporte/reportes/${reporteId}/estatus`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ estatus: 'EN_REVISION' });

    expect(res.status).toBe(200);
    const reporte = await prisma.reporteBug.findUniqueOrThrow({ where: { id: reporteId } });
    expect(reporte.estatus).toBe('EN_REVISION');

    const registro = await prisma.registroAuditoria.findFirst({
      where: { entidad: 'ReporteBug', entidadId: reporteId },
      orderBy: { fecha: 'desc' },
    });
    expect(registro?.adminPlataformaId).toBe(platformAdminId);
    expect(registro?.sedeId).toBe(sedeMeridaId);
  });

  it('PATCH con estatus inválido responde 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/soporte/reportes/${reporteId}/estatus`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ estatus: 'NO_EXISTE' });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('PATCH contra un id inexistente responde 404 NOT_FOUND', async () => {
    const res = await request(app.getHttpServer())
      .patch('/soporte/reportes/00000000-0000-0000-0000-000000000000/estatus')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ estatus: 'RESUELTO' });

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });
});
```

- [ ] **Step 5: Correr la suite nueva**

Run: `cd App/backend && npx jest test/soporte-gestion.e2e-spec.ts --runInBand`

Expected: 7/7 en verde. Si `firmarPlatformAdminToken` requiere setup adicional (ver nota del Task 3, Step 7), calcar el mecanismo real usado por los specs existentes de `PlatformAdminGuard`.

- [ ] **Step 6: Correr la regresión completa del backend**

Run: `cd App/backend && npx nest build && npm run test:e2e`

Expected: todo en verde — 3 suites nuevas de `soporte` + el resto sin romperse.

- [ ] **Step 7: Commit**

```bash
git add App/backend/src/soporte App/backend/test/soporte-gestion.e2e-spec.ts
git commit -m "feat(backend): GET /soporte/reportes + PATCH /soporte/reportes/:id/estatus"
```

---

## Task 6: Frontend — `lib/api/soporte.ts` + `BotSoporte` en `app/admin/`

**Files:**
- Create: `App/frontend/src/lib/api/soporte.ts`
- Create: `App/frontend/src/components/admin/ui/shell/BotSoporte.tsx`
- Create: `App/frontend/src/components/admin/ui/shell/faqSoporte.ts`
- Modify: `App/frontend/src/components/admin/ui/shell/AdminShell.tsx`

**Interfaces:**
- Produces: `lib/api/soporte.ts` exporta `obtenerConfigSoporte`, `crearReporteBug` — compartido (sin dueño de árbol, mismo criterio que `foto-perfil.ts`), lo reusa el Task 7 (maestro) y el Task 8 (plataforma, junto con `lib/api/platform-http.ts` para sus propias funciones).
- Consumes: `apiFetchAuth`, `API_URL`, `obtenerAccessToken`, `ApiError` (`lib/api/http.ts`, existentes).

- [ ] **Step 1: `lib/api/soporte.ts`**

Crear `App/frontend/src/lib/api/soporte.ts`:

```ts
import { API_URL, apiFetchAuth, ApiError, obtenerAccessToken } from './http';

export interface ConfigSoporte {
  activo: boolean;
}

export function obtenerConfigSoporte(): Promise<ConfigSoporte> {
  return apiFetchAuth<ConfigSoporte>('/soporte/config');
}

/**
 * Multipart — `descripcion` + `captura` opcional. Mismo patrón
 * `XMLHttpRequest` que `subirFotoPropia` (`lib/api/foto-perfil.ts`): expone
 * progreso real de subida cuando hay captura, `fetch` no lo da de forma
 * práctica en el navegador.
 */
export function crearReporteBug(
  descripcion: string,
  captura?: File,
  onProgress?: (porcentaje: number) => void,
): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    obtenerAccessToken()
      .then((token) => {
        const formData = new FormData();
        formData.append('descripcion', descripcion);
        if (captura) {
          formData.append('captura', captura);
        }

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_URL}/soporte/reportes`);
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
            const success = body as { data?: { id: string } } | null;
            if (success?.data) {
              resolve(success.data);
            } else {
              reject(
                new ApiError(
                  'Respuesta inesperada del servidor al enviar el reporte.',
                  'SERVER_ERROR',
                  xhr.status,
                ),
              );
            }
          } else {
            const failure = body as { error?: string; code?: string } | null;
            reject(
              new ApiError(
                failure?.error ?? 'No se pudo enviar el reporte. Intenta de nuevo.',
                failure?.code ?? 'SERVER_ERROR',
                xhr.status,
              ),
            );
          }
        };

        xhr.onerror = () => {
          reject(new ApiError('Error de red al enviar el reporte.', 'SERVER_ERROR', 0));
        };

        xhr.send(formData);
      })
      .catch(reject);
  });
}
```

- [ ] **Step 2: FAQ hardcodeado**

Crear `App/frontend/src/components/admin/ui/shell/faqSoporte.ts` (mismo contenido se duplica en `components/maestro/ui/shell/faqSoporte.ts` en el Task 7 — regla 11):

```ts
export interface PreguntaFaq {
  pregunta: string;
  respuesta: string;
}

export interface CategoriaFaq {
  id: string;
  titulo: string;
  preguntas: PreguntaFaq[];
}

export const CATEGORIAS_FAQ_SOPORTE: CategoriaFaq[] = [
  {
    id: 'personas',
    titulo: 'Alumnos, maestros y administrativos',
    preguntas: [
      {
        pregunta: '¿Cómo doy de alta a un alumno?',
        respuesta:
          'Ve a "Alumnos" en el menú lateral y usa el botón "+ Nuevo alumno". El sistema genera la matrícula y la contraseña temporal automáticamente.',
      },
      {
        pregunta: '¿Cómo cambio la contraseña de alguien que la olvidó?',
        respuesta:
          'En el listado de la persona (Alumnos/Maestros/Administrativos), usa el botón "Restablecer contraseña" de su fila. Le llega un correo con el enlace para elegir una nueva.',
      },
      {
        pregunta: '¿Cómo doy de baja a un maestro o administrativo?',
        respuesta:
          'Desde su listado, cambia su estatus a "Baja" y elige el motivo. Dependiendo del motivo, esto también revoca su acceso al sistema.',
      },
    ],
  },
  {
    id: 'grupos',
    titulo: 'Grupos y materias',
    preguntas: [
      {
        pregunta: '¿Cómo creo un grupo nuevo?',
        respuesta:
          'Ve a "Grupos" y usa el botón "+ Nuevo grupo". Necesitas tener ya creados la carrera y el salón donde va a estar.',
      },
      {
        pregunta: '¿Cómo asigno un maestro a una materia?',
        respuesta:
          'Entra al detalle del grupo (clic en la fila) y usa la sección de materias asignadas para agregar al maestro correspondiente.',
      },
    ],
  },
  {
    id: 'otros',
    titulo: 'Otros',
    preguntas: [
      {
        pregunta: '¿Cómo subo la malla curricular de una carrera?',
        respuesta:
          'Entra a "Carreras", edita la carrera y usa la sección de malla curricular para subir el PDF.',
      },
    ],
  },
];
```

- [ ] **Step 3: `BotSoporte`**

Crear `App/frontend/src/components/admin/ui/shell/BotSoporte.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { crearReporteBug, obtenerConfigSoporte } from '@/lib/api/soporte';
import { ApiError } from '@/lib/api/http';
import { CATEGORIAS_FAQ_SOPORTE, type CategoriaFaq } from './faqSoporte';

type Vista =
  | { tipo: 'menu' }
  | { tipo: 'categoria'; categoria: CategoriaFaq }
  | { tipo: 'reporte' }
  | { tipo: 'reporte-enviado' };

/**
 * `BotSoporte` — feature "Bot de soporte" (2026-09-24). Duplicado en
 * `components/maestro/ui/shell/` (regla 11, cero imports cruzados).
 *
 * Montado como SIBLING del `<header>` en `AdminShell` — NUNCA dentro de un
 * contenedor con `backdrop-blur-sm`/`sticky` (crea containing block para
 * `position: fixed` y recorta el overlay flotante, bug ya vivido con el
 * botón de pánico de Emergencia).
 */
export function BotSoporte() {
  const [abierto, setAbierto] = useState(false);
  const [vista, setVista] = useState<Vista>({ tipo: 'menu' });

  const { data: config } = useQuery({
    queryKey: ['soporte', 'config'],
    queryFn: obtenerConfigSoporte,
    staleTime: 5 * 60 * 1000,
  });

  function cerrarYReset() {
    setAbierto(false);
    setVista({ tipo: 'menu' });
  }

  if (!config?.activo) {
    return null;
  }

  return (
    <div className="fixed right-4 bottom-4 z-50 sm:right-6 sm:bottom-6">
      {abierto && (
        <div className="mb-3 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-mist bg-bone shadow-xl">
          <div className="flex items-center justify-between border-b border-mist bg-navy px-4 py-3">
            <span className="font-display text-sm font-semibold text-bone">Soporte SIGE</span>
            <button
              onClick={cerrarYReset}
              className="text-bone/70 hover:text-bone"
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto p-4">
            {vista.tipo === 'menu' && (
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setVista({ tipo: 'categoria', categoria: CATEGORIAS_FAQ_SOPORTE[0] })}
                  className="rounded-lg border border-mist px-4 py-3 text-left text-sm hover:bg-mist/40"
                >
                  💬 Necesito ayuda
                </button>
                <button
                  onClick={() => setVista({ tipo: 'reporte' })}
                  className="rounded-lg border border-mist px-4 py-3 text-left text-sm hover:bg-mist/40"
                >
                  🐛 Tengo un problema
                </button>
              </div>
            )}

            {vista.tipo === 'categoria' && (
              <VistaFaq
                categoriaInicial={vista.categoria}
                onVolverMenu={() => setVista({ tipo: 'menu' })}
              />
            )}

            {vista.tipo === 'reporte' && (
              <VistaReporte
                onVolverMenu={() => setVista({ tipo: 'menu' })}
                onEnviado={() => setVista({ tipo: 'reporte-enviado' })}
              />
            )}

            {vista.tipo === 'reporte-enviado' && (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <p className="text-sm text-slate">
                  Tu reporte fue enviado. Gracias por avisarnos.
                </p>
                <button
                  onClick={cerrarYReset}
                  className="text-sm font-medium text-navy hover:underline"
                >
                  Cerrar
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <button
        onClick={() => setAbierto((v) => !v)}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-navy text-2xl text-bone shadow-lg hover:bg-navy/90"
        aria-label={abierto ? 'Cerrar soporte' : 'Abrir soporte'}
      >
        {abierto ? '✕' : '💬'}
      </button>
    </div>
  );
}

function VistaFaq({
  categoriaInicial,
  onVolverMenu,
}: {
  categoriaInicial: CategoriaFaq;
  onVolverMenu: () => void;
}) {
  const [categoria, setCategoria] = useState<CategoriaFaq | null>(null);

  if (!categoria) {
    return (
      <div className="flex flex-col gap-2">
        <button onClick={onVolverMenu} className="mb-1 text-left text-xs text-slate/60 hover:underline">
          ← Atrás
        </button>
        {CATEGORIAS_FAQ_SOPORTE.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategoria(c)}
            className="rounded-lg border border-mist px-3 py-2 text-left text-sm hover:bg-mist/40"
          >
            {c.titulo}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={() => setCategoria(null)}
        className="text-left text-xs text-slate/60 hover:underline"
      >
        ← Atrás
      </button>
      {categoria.preguntas.map((p) => (
        <div key={p.pregunta} className="rounded-lg bg-mist/30 p-3">
          <p className="text-sm font-medium text-slate">{p.pregunta}</p>
          <p className="mt-1 text-sm text-slate/80">{p.respuesta}</p>
        </div>
      ))}
    </div>
  );
}

const TIPOS_ACEPTADOS = ['image/jpeg', 'image/png', 'image/webp'];
const TRES_MB = 3 * 1024 * 1024;

function VistaReporte({
  onVolverMenu,
  onEnviado,
}: {
  onVolverMenu: () => void;
  onEnviado: () => void;
}) {
  const [descripcion, setDescripcion] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  function seleccionarArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setArchivo(null);
      return;
    }
    if (!TIPOS_ACEPTADOS.includes(file.type)) {
      setError('La captura debe ser JPG, PNG o WEBP.');
      setArchivo(null);
      return;
    }
    if (file.size > TRES_MB) {
      setError('La captura no puede pesar más de 3MB.');
      setArchivo(null);
      return;
    }
    setError(null);
    setArchivo(file);
  }

  async function enviar() {
    if (!descripcion.trim()) {
      setError('Describe qué pasó.');
      return;
    }
    setError(null);
    setEnviando(true);
    try {
      await crearReporteBug(descripcion.trim(), archivo ?? undefined);
      onEnviado();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'No se pudo enviar el reporte. Intenta de nuevo.',
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button onClick={onVolverMenu} className="text-left text-xs text-slate/60 hover:underline">
        ← Atrás
      </button>
      <label className="text-sm font-medium text-slate">¿Qué pasó?</label>
      <textarea
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
        rows={4}
        maxLength={2000}
        className="rounded-lg border border-mist px-3 py-2 text-sm"
        placeholder="Describe el problema con el mayor detalle posible..."
      />
      <label className="text-sm font-medium text-slate">Captura de pantalla (opcional)</label>
      <input type="file" accept={TIPOS_ACEPTADOS.join(',')} onChange={seleccionarArchivo} className="text-sm" />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        onClick={enviar}
        disabled={enviando}
        className="mt-1 rounded-lg bg-navy px-4 py-2 text-sm font-medium text-bone hover:bg-navy/90 disabled:opacity-60"
      >
        {enviando ? 'Enviando...' : 'Enviar reporte'}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Montar `BotSoporte` en `AdminShell` — fuera del `<header>`**

Modificar `App/frontend/src/components/admin/ui/shell/AdminShell.tsx` — agregar el import:

```tsx
import { BotSoporte } from './BotSoporte';
```

Y en el `return`, agregar `<BotSoporte />` como sibling del `<div className="flex min-w-0 flex-1 flex-col">` (después de su cierre, antes del cierre del `<div className="flex min-h-screen bg-bone">` raíz) — NUNCA dentro del `<header>` de `Topbar`:

```tsx
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar email={email} onAbrirMobile={() => setAbiertoMobile(true)} />
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>

      <BotSoporte />
    </div>
  );
}
```

- [ ] **Step 5: Verificar tipos y lint**

Run: `cd App/frontend && pnpm build`

Expected: build limpio.

Run: `cd App/frontend && pnpm lint`

Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add App/frontend/src/lib/api/soporte.ts App/frontend/src/components/admin/ui/shell/BotSoporte.tsx App/frontend/src/components/admin/ui/shell/faqSoporte.ts App/frontend/src/components/admin/ui/shell/AdminShell.tsx
git commit -m "feat(admin): widget BotSoporte (FAQ + reporte de bugs)"
```

---

## Task 7: Frontend — `BotSoporte` en `app/maestro/`

**Files:**
- Create: `App/frontend/src/components/maestro/ui/shell/BotSoporte.tsx`
- Create: `App/frontend/src/components/maestro/ui/shell/faqSoporte.ts`
- Modify: `App/frontend/src/app/maestro/layout.tsx`

**Interfaces:**
- Consumes: `lib/api/soporte.ts` (Task 6, compartido — sin dueño de árbol).

- [ ] **Step 1: Copiar `faqSoporte.ts` al árbol de maestro**

Crear `App/frontend/src/components/maestro/ui/shell/faqSoporte.ts` — mismo contenido exacto del archivo creado en el Task 6 (`components/admin/ui/shell/faqSoporte.ts`), sin modificaciones. Regla 11: copia local, no import cruzado.

- [ ] **Step 2: Copiar `BotSoporte.tsx` al árbol de maestro**

Crear `App/frontend/src/components/maestro/ui/shell/BotSoporte.tsx` — mismo contenido exacto del `BotSoporte.tsx` del Task 6, con el único cambio del comentario de cabecera (mencionar que este vive en `maestro`, no en `admin`) y sin cambios de lógica/estilos (los tokens de color — `bg-navy`, `text-bone`, `border-mist`, etc. — son el mismo sistema de diseño en los 3 árboles).

- [ ] **Step 3: Montar `BotSoporte` en `MaestroLayout` — fuera del `<Header>`**

Modificar `App/frontend/src/app/maestro/layout.tsx`:

```tsx
import { createClient } from '@/lib/supabase/server';
import { Header } from '@/components/maestro/ui/shell/Header';
import { BotSoporte } from '@/components/maestro/ui/shell/BotSoporte';

export default async function MaestroLayout(props: LayoutProps<'/maestro'>) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === 'string' ? data.claims.email : null;

  return (
    <div className="flex min-h-screen flex-col bg-bone text-slate">
      <Header email={email} />
      <main className="flex-1 p-6">{props.children}</main>
      <BotSoporte />
    </div>
  );
}
```

- [ ] **Step 4: Verificar tipos y lint**

Run: `cd App/frontend && pnpm build`

Expected: build limpio.

Run: `cd App/frontend && pnpm lint`

Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add App/frontend/src/components/maestro/ui/shell/BotSoporte.tsx App/frontend/src/components/maestro/ui/shell/faqSoporte.ts App/frontend/src/app/maestro/layout.tsx
git commit -m "feat(maestro): widget BotSoporte (FAQ + reporte de bugs)"
```

---

## Task 8: Frontend — `app/plataforma/soporte/` (toggle + gestión de reportes)

**Files:**
- Create: `App/frontend/src/lib/api/soporte-plataforma.ts`
- Create: `App/frontend/src/app/plataforma/soporte/page.tsx`
- Modify: `App/frontend/src/app/plataforma/PlataformaNav.tsx`

**Interfaces:**
- Consumes: `platformFetch`/`platformFetchPaginated` (`lib/api/platform-http.ts`, existentes).

- [ ] **Step 1: `lib/api/soporte-plataforma.ts`**

Crear `App/frontend/src/lib/api/soporte-plataforma.ts` (separado de `soporte.ts` — este usa el JWT de `AdminPlataforma`, no el de Supabase, mismo criterio de separación que `platform-http.ts` vs. `http.ts`):

```ts
import { platformFetch, platformFetchPaginated } from './platform-http';

export interface ReporteBugItem {
  id: string;
  sede: { id: string; nombre: string };
  reportante: string;
  descripcion: string;
  capturaUrl: string | null;
  estatus: 'NUEVO' | 'EN_REVISION' | 'RESUELTO';
  createdAt: string;
  updatedAt: string;
}

export function obtenerConfigSoportePlataforma(): Promise<{ activo: boolean }> {
  return platformFetch<{ activo: boolean }>('/soporte/config');
}

export function actualizarConfigSoportePlataforma(
  activo: boolean,
): Promise<{ activo: boolean }> {
  return platformFetch<{ activo: boolean }>('/soporte/config', {
    method: 'PATCH',
    body: JSON.stringify({ activo }),
  });
}

export function listarReportesBug(params: {
  estatus?: string;
  page?: number;
  limit?: number;
}): Promise<{ data: ReporteBugItem[]; page: number; limit: number; total: number }> {
  const query = new URLSearchParams();
  if (params.estatus) query.set('estatus', params.estatus);
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  return platformFetchPaginated<ReporteBugItem>(
    `/soporte/reportes${qs ? `?${qs}` : ''}`,
  );
}

export function cambiarEstatusReporteBug(
  id: string,
  estatus: string,
): Promise<{ ok: true }> {
  return platformFetch<{ ok: true }>(`/soporte/reportes/${id}/estatus`, {
    method: 'PATCH',
    body: JSON.stringify({ estatus }),
  });
}
```

- [ ] **Step 2: Agregar el link de nav**

Modificar `App/frontend/src/app/plataforma/PlataformaNav.tsx`:

```tsx
const LINKS: { id: 'dashboard' | 'sedes' | 'auditoria' | 'soporte'; href: string; label: string }[] = [
  { id: 'dashboard', href: '/plataforma', label: 'Dashboard' },
  { id: 'sedes', href: '/plataforma/sedes', label: 'Sedes' },
  { id: 'auditoria', href: '/plataforma/auditoria', label: 'Auditoría' },
  { id: 'soporte', href: '/plataforma/soporte', label: 'Soporte' },
];

export function PlataformaNav({
  activo,
  titulo,
}: {
  activo: 'dashboard' | 'sedes' | 'auditoria' | 'soporte';
  titulo: string;
}) {
```

- [ ] **Step 3: `app/plataforma/soporte/page.tsx`**

Crear `App/frontend/src/app/plataforma/soporte/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PlataformaNav } from '../PlataformaNav';
import {
  actualizarConfigSoportePlataforma,
  cambiarEstatusReporteBug,
  listarReportesBug,
  obtenerConfigSoportePlataforma,
} from '@/lib/api/soporte-plataforma';

const ESTATUS_LABEL: Record<string, string> = {
  NUEVO: 'Nuevo',
  EN_REVISION: 'En revisión',
  RESUELTO: 'Resuelto',
};

export default function SoportePlataformaPage() {
  const queryClient = useQueryClient();
  const [filtroEstatus, setFiltroEstatus] = useState<string>('');
  const [page, setPage] = useState(1);

  const configQuery = useQuery({
    queryKey: ['plataforma', 'soporte', 'config'],
    queryFn: obtenerConfigSoportePlataforma,
  });

  const toggleMutation = useMutation({
    mutationFn: (activo: boolean) => actualizarConfigSoportePlataforma(activo),
    onSuccess: (data) => {
      queryClient.setQueryData(['plataforma', 'soporte', 'config'], data);
    },
  });

  const reportesQuery = useQuery({
    queryKey: ['plataforma', 'soporte', 'reportes', filtroEstatus, page],
    queryFn: () =>
      listarReportesBug({
        estatus: filtroEstatus || undefined,
        page,
        limit: 20,
      }),
  });

  const estatusMutation = useMutation({
    mutationFn: ({ id, estatus }: { id: string; estatus: string }) =>
      cambiarEstatusReporteBug(id, estatus),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['plataforma', 'soporte', 'reportes'],
      });
    },
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PlataformaNav activo="soporte" titulo="Soporte" />

      <div className="mt-6 flex items-center justify-between rounded-xl border border-mist bg-white p-4">
        <div>
          <p className="text-sm font-medium text-slate">Bot de soporte</p>
          <p className="text-xs text-slate/60">
            Controla si el widget de ayuda/reporte de bugs aparece para administrativos y maestros.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={configQuery.data?.activo ?? false}
          disabled={configQuery.isLoading || toggleMutation.isPending}
          onClick={() => toggleMutation.mutate(!(configQuery.data?.activo ?? false))}
          className={`relative h-7 w-12 rounded-full transition-colors ${
            configQuery.data?.activo ? 'bg-navy' : 'bg-mist'
          }`}
        >
          <span
            className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              configQuery.data?.activo ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <label className="text-sm text-slate/70">Filtrar por estatus:</label>
        <select
          value={filtroEstatus}
          onChange={(e) => {
            setFiltroEstatus(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-mist px-3 py-1.5 text-sm"
        >
          <option value="">Todos</option>
          <option value="NUEVO">Nuevo</option>
          <option value="EN_REVISION">En revisión</option>
          <option value="RESUELTO">Resuelto</option>
        </select>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-mist bg-white">
        <table className="w-full text-sm">
          <thead className="bg-mist/30 text-left text-xs text-slate/60">
            <tr>
              <th className="px-4 py-2">Fecha</th>
              <th className="px-4 py-2">Sede</th>
              <th className="px-4 py-2">Reportó</th>
              <th className="px-4 py-2">Descripción</th>
              <th className="px-4 py-2">Captura</th>
              <th className="px-4 py-2">Estatus</th>
            </tr>
          </thead>
          <tbody>
            {reportesQuery.data?.data.map((r) => (
              <tr key={r.id} className="border-t border-mist">
                <td className="px-4 py-2 whitespace-nowrap text-slate/70">
                  {new Date(r.createdAt).toLocaleString('es-MX')}
                </td>
                <td className="px-4 py-2">{r.sede.nombre}</td>
                <td className="px-4 py-2">{r.reportante}</td>
                <td className="max-w-xs truncate px-4 py-2" title={r.descripcion}>
                  {r.descripcion}
                </td>
                <td className="px-4 py-2">
                  {r.capturaUrl ? (
                    <a
                      href={r.capturaUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-navy hover:underline"
                    >
                      Ver
                    </a>
                  ) : (
                    <span className="text-slate/40">—</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <select
                    value={r.estatus}
                    onChange={(e) =>
                      estatusMutation.mutate({ id: r.id, estatus: e.target.value })
                    }
                    className="rounded-lg border border-mist px-2 py-1 text-xs"
                  >
                    {Object.entries(ESTATUS_LABEL).map(([valor, label]) => (
                      <option key={valor} value={valor}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
            {reportesQuery.data?.data.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate/50">
                  Sin reportes{filtroEstatus ? ` con estatus "${ESTATUS_LABEL[filtroEstatus]}"` : ''}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {reportesQuery.data && reportesQuery.data.total > reportesQuery.data.limit && (
        <div className="mt-3 flex items-center justify-center gap-3 text-sm">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-lg border border-mist px-3 py-1 disabled:opacity-40"
          >
            Anterior
          </button>
          <span className="text-slate/60">Página {page}</span>
          <button
            disabled={page * reportesQuery.data.limit >= reportesQuery.data.total}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-mist px-3 py-1 disabled:opacity-40"
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verificar tipos y lint**

Run: `cd App/frontend && pnpm build`

Expected: build limpio.

Run: `cd App/frontend && pnpm lint`

Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add App/frontend/src/lib/api/soporte-plataforma.ts App/frontend/src/app/plataforma/soporte App/frontend/src/app/plataforma/PlataformaNav.tsx
git commit -m "feat(plataforma): toggle de soporte + gestión de reportes de bugs"
```

---

## Verificación final (después del Task 8)

- [ ] Run: `cd App/backend && npx nest build && npm run test:e2e` — Expected: build limpio, todas las suites en verde (incluidas las 3 nuevas de `soporte`).
- [ ] Run: `cd App/frontend && pnpm build && pnpm lint` — Expected: ambos limpios.
- [ ] Verificación manual en navegador (a cargo del usuario, ver `docs/setup-backend-telegram.md` para configurar el bot antes de esto):
  - Abrir el widget desde `app/admin/` y desde `app/maestro/`, navegar el FAQ, mandar un reporte con y sin captura.
  - Confirmar que llega el mensaje a Telegram (con foto inline cuando aplica).
  - Verlo aparecer en `app/plataforma/soporte/`, cambiar su estatus.
  - Apagar el toggle y confirmar que el botón desaparece de admin/maestro.
  - Con el toggle apagado, mandar `POST /soporte/reportes` directo (Postman/curl) y confirmar `409 SOPORTE_DESACTIVADO`.
