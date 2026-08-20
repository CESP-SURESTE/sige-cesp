# Malla curricular — Storage y subida Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un admin pueda subir el PDF de malla curricular de una carrera desde la UI real, guardado en un bucket privado de Supabase Storage, con el registro `MallaCurricular` (upsert 1-a-1) actualizado en Postgres.

**Architecture:** Bucket privado creado por un script de bootstrap permanente (Admin API de Storage). Nuevo módulo backend `malla-curricular/` (sub-recurso de `Carrera`, mismos guards que `CarrerasController`) con `POST /carreras/:id/malla` (multipart, `FileInterceptor`). Frontend: botón nuevo en la tabla de `app/admin/carreras/page.tsx`, con un fix necesario en el fetcher compartido (`lib/api/http.ts`) para no forzar `Content-Type: application/json` en bodies `FormData`.

**Tech Stack:** NestJS + `@nestjs/platform-express` (`FileInterceptor`, multer ya instalado transitivamente) + `@supabase/server` (Storage Admin API) + Prisma. Frontend: React Query + fetch nativo (sin librería de upload nueva).

## Global Constraints

- Bucket `mallas-curriculares`, privado, `fileSizeLimit: '5MB'`, `allowedMimeTypes: ['application/pdf']` (spec, sección 1).
- Ruta de cada archivo: `{carreraId}/malla.pdf`, `upsert: true` — cada subida sobreescribe, sin versiones viejas (spec, sección 1).
- Guards del endpoint: `SedeGuard` + `RolesGuard(ADMINISTRATIVO)`, `SedeGuard` primero en `@UseGuards(...)` (invariante de composición ya documentada en `roles.guard.ts`), mismo patrón que `CarrerasController` (spec, sección 2).
- Sin código de error nuevo — reutiliza `VALIDATION_ERROR`/`NOT_FOUND` (spec, sección 2).
- Éxito siempre `200`, nunca `201` — es upsert, no creación estricta (spec, sección 2).
- Regla 12 de `CLAUDE.md` raíz — todo catch/error handler real (no validación deliberada) loguea con `console.error` antes de responder.
- No se agrega indicador de "malla ya subida" en la tabla — fuera de alcance (spec, "Fuera de alcance").
- Descarga/signed URLs — fuera de alcance, es Día 24 (spec, "Fuera de alcance").

---

### Task 1: Bucket de Storage — script de bootstrap

**Files:**
- Create: `App/backend/prisma/crear-bucket-malla.ts`

**Interfaces:**
- Produces: nada — script hoja, ningún otro archivo lo importa. Constante `mallas-curriculares` (nombre del bucket) queda hardcodeada acá Y en `malla-curricular.service.ts` (Task 2) — no hay módulo compartido entre `prisma/` y `src/` en este repo (`seed.ts` tampoco comparte constantes con `src/`), mismo criterio ya establecido.

- [ ] **Step 1: Crear el script**

```ts
/**
 * Bootstrap del bucket de Storage para mallas curriculares — Fase 7, Día
 * 23. Permanente (a diferencia de los scripts `-tmp.ts` de mantenimiento
 * de datos) — idempotente y repetible, mismo criterio que `seed.ts`.
 *
 * Uso: `npx ts-node prisma/crear-bucket-malla.ts`
 */
import { loadEnv } from '../src/load-env';

loadEnv();

const NOMBRE_BUCKET = 'mallas-curriculares';

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
    fileSizeLimit: '5MB',
    allowedMimeTypes: ['application/pdf'],
  });
  if (error) {
    throw new Error(
      `Error creando el bucket "${NOMBRE_BUCKET}": ${error.message}`,
    );
  }
  console.log(`Bucket "${NOMBRE_BUCKET}" creado (privado, 5MB, solo PDF).`);
}

main().catch((e: unknown) => {
  console.error('Error en crear-bucket-malla:', e);
  process.exit(1);
});
```

- [ ] **Step 2: Correr el script contra la base real**

Run: `cd App/backend && npx ts-node prisma/crear-bucket-malla.ts`
Expected: `Bucket "mallas-curriculares" creado (privado, 5MB, solo PDF).` (o el mensaje de "ya existe" si se corre dos veces — confirma idempotencia corriéndolo de nuevo inmediatamente después).

- [ ] **Step 3: Commit**

```bash
git add App/backend/prisma/crear-bucket-malla.ts
git commit -m "feat(backend): script de bootstrap del bucket de Storage para mallas curriculares

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Backend — `POST /carreras/:id/malla`

**Files:**
- Create: `App/backend/src/malla-curricular/malla-curricular.service.ts`
- Create: `App/backend/src/malla-curricular/malla-curricular.controller.ts`
- Create: `App/backend/src/malla-curricular/malla-curricular.module.ts`
- Modify: `App/backend/src/app.module.ts:1-35`
- Modify: `App/backend/package.json` (vía `pnpm add -D @types/multer`)
- Create: `App/backend/test/malla-curricular.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (`../prisma/prisma.service`), decoradores `ActorUsuarioId`/`Roles`/`SedeActual` y guards `RolesGuard`/`SedeGuard` (todos ya existentes, mismos imports que `carreras.controller.ts`).
- Produces:
  - `export const MALLA_SUPABASE_CLIENT_OVERRIDE = 'MALLA_SUPABASE_CLIENT_OVERRIDE'` — token de DI para overridear el cliente de Supabase en tests (mismo patrón que `PERSONAS_SUPABASE_CLIENT_OVERRIDE`).
  - `export class MallaCurricularService { subir(carreraId: string, sedeId: string, actorUsuarioId: string, file: Express.Multer.File | undefined): Promise<MallaCurricular> }`
  - `export class MallaCurricularModule` — se importa en `AppModule`.

- [ ] **Step 1: Instalar `@types/multer`**

Run: `cd App/backend && pnpm add -D @types/multer`
Expected: exit 0, `package.json`/`pnpm-lock.yaml` actualizados con la entrada nueva en `devDependencies`.

- [ ] **Step 2: Crear el service**

`App/backend/src/malla-curricular/malla-curricular.service.ts`:

```ts
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { MallaCurricular } from '@prisma/client';
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
      throw error;
    }

    return this.prisma.mallaCurricular.upsert({
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
  }
}
```

- [ ] **Step 3: Crear el controller**

`App/backend/src/malla-curricular/malla-curricular.controller.ts`:

```ts
import { Controller, Param, Post, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RolUsuario } from '@prisma/client';
import { ActorUsuarioId } from '../common/decorators/actor-usuario-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SedeActual } from '../common/decorators/sede-actual.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { SedeGuard } from '../common/guards/sede.guard';
import { MallaCurricularService } from './malla-curricular.service';

const CINCO_MB = 5 * 1024 * 1024;

/**
 * `POST /carreras/:id/malla` — Fase 7, Día 23. Sub-recurso de `Carrera`
 * (regla 4 de `CLAUDE.md` raíz), mismo patrón de guards que
 * `CarrerasController` (`SedeGuard` primero, invariante de composición de
 * `RolesGuard`). `sedeId` siempre de `@SedeActual()`, nunca de body/param.
 */
@Controller('carreras')
@UseGuards(SedeGuard, RolesGuard)
export class MallaCurricularController {
  constructor(private readonly mallaCurricularService: MallaCurricularService) {}

  @Post(':id/malla')
  @Roles(RolUsuario.ADMINISTRATIVO)
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: CINCO_MB } }))
  async subir(
    @Param('id') id: string,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const data = await this.mallaCurricularService.subir(id, sedeId, actorUsuarioId, file);
    return { data };
  }
}
```

- [ ] **Step 4: Crear el module**

`App/backend/src/malla-curricular/malla-curricular.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { MallaCurricularController } from './malla-curricular.controller';
import { MallaCurricularService } from './malla-curricular.service';

@Module({
  controllers: [MallaCurricularController],
  providers: [MallaCurricularService],
})
export class MallaCurricularModule {}
```

- [ ] **Step 5: Registrar el módulo en `AppModule`**

En `App/backend/src/app.module.ts`, agrega el import (junto a `CarrerasModule`):

```ts
import { MallaCurricularModule } from './malla-curricular/malla-curricular.module';
```

Y agrégalo al arreglo `imports` (junto a `CarrerasModule`):

```ts
  imports: [
    PrismaModule,
    SedeGuardModule,
    RolesGuardModule,
    PlatformAdminGuardModule,
    SedesModule,
    AuthModule,
    PruebaRolesModule,
    MailModule,
    PersonasModule,
    CarrerasModule,
    MallaCurricularModule,
    PerfilModule,
    PlatformAdminModule,
  ],
```

- [ ] **Step 6: Verificar tipos**

Run: `cd App/backend && npx tsc --noEmit`
Expected: sin salida, exit 0.

- [ ] **Step 7: Escribir el test e2e**

`App/backend/test/malla-curricular.e2e-spec.ts` — mismo mecanismo de JWT/JWKS que `carreras-crud.e2e-spec.ts`, con `MALLA_SUPABASE_CLIENT_OVERRIDE` mockeando `client.storage.from(...).upload(...)` (mismo patrón que `PERSONAS_SUPABASE_CLIENT_OVERRIDE` mockea `auth.admin.{createUser,deleteUser}` en `personas.e2e-spec.ts`) — nunca toca el bucket real:

```ts
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { RolUsuario } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { SEDE_GUARD_ENV_OVERRIDE } from '../src/common/guards/sede.guard';
import { MALLA_SUPABASE_CLIENT_OVERRIDE } from '../src/malla-curricular/malla-curricular.service';
import { loadEnv } from '../src/load-env';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup-app';

loadEnv();

interface ErrorBody {
  error: string;
  code: string;
}
interface MallaBody {
  data: {
    id: string;
    carreraId: string;
    nombreArchivo: string;
    subidaPorId: string;
  };
}

describe('MallaCurricularController — POST /carreras/:id/malla (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let sedeValladolidId: string;
  let carreraMeridaId: string;
  let actorUsuarioId: string;
  let upload: jest.Mock;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';

  async function firmarToken(claims: Record<string, unknown>): Promise<string> {
    return new jose.SignJWT(claims)
      .setProtectedHeader({ alg, kid })
      .setSubject(actorUsuarioId)
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
    const mockSupabaseAdminClient = {
      storage: { from: () => ({ upload }) },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SEDE_GUARD_ENV_OVERRIDE)
      .useValue({ jwks: { keys: [publicJwk] } })
      .overrideProvider(MALLA_SUPABASE_CLIENT_OVERRIDE)
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
    const carrera = await prisma.carrera.findUniqueOrThrow({ where: { clave: 'LAE-MID' } });
    carreraMeridaId = carrera.id;
    const actor = await prisma.usuario.findUniqueOrThrow({ where: { email: 'ana.canul@cesp-merida.edu.mx' } });
    actorUsuarioId = actor.id;
  });

  afterEach(() => {
    upload.mockClear();
  });

  afterAll(async () => {
    await prisma.mallaCurricular.deleteMany({ where: { carreraId: carreraMeridaId } });
    await app.close();
  });

  it('POST /carreras/:id/malla sube un PDF y crea el registro (primera vez)', async () => {
    const token = await firmarToken({ role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO });

    const res = await request(app.getHttpServer())
      .post(`/carreras/${carreraMeridaId}/malla`)
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', Buffer.from('%PDF-1.4 contenido de prueba'), {
        filename: 'malla.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(200);
    const body = res.body as MallaBody;
    expect(body.data.carreraId).toBe(carreraMeridaId);
    expect(body.data.nombreArchivo).toBe('malla.pdf');
    expect(body.data.subidaPorId).toBe(actorUsuarioId);
    expect(upload).toHaveBeenCalledWith(
      `${carreraMeridaId}/malla.pdf`,
      expect.any(Buffer),
      { contentType: 'application/pdf', upsert: true },
    );
  });

  it('POST /carreras/:id/malla una segunda vez actualiza (upsert, no duplica)', async () => {
    const token = await firmarToken({ role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO });

    await request(app.getHttpServer())
      .post(`/carreras/${carreraMeridaId}/malla`)
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', Buffer.from('%PDF-1.4 v1'), { filename: 'v1.pdf', contentType: 'application/pdf' });

    const res = await request(app.getHttpServer())
      .post(`/carreras/${carreraMeridaId}/malla`)
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', Buffer.from('%PDF-1.4 v2'), { filename: 'v2.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(200);
    expect((res.body as MallaBody).data.nombreArchivo).toBe('v2.pdf');

    const total = await prisma.mallaCurricular.count({ where: { carreraId: carreraMeridaId } });
    expect(total).toBe(1);
  });

  it('POST /carreras/:id/malla sin archivo -> 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({ role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO });

    const res = await request(app.getHttpServer())
      .post(`/carreras/${carreraMeridaId}/malla`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('POST /carreras/:id/malla con archivo que no es PDF -> 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({ role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO });

    const res = await request(app.getHttpServer())
      .post(`/carreras/${carreraMeridaId}/malla`)
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', Buffer.from('no soy un pdf'), { filename: 'malla.txt', contentType: 'text/plain' });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
    expect(upload).not.toHaveBeenCalled();
  });

  it('POST /carreras/:id/malla con carrera de otra sede -> 404 NOT_FOUND', async () => {
    const token = await firmarToken({ role: 'authenticated', sede_id: sedeValladolidId, rol: RolUsuario.ADMINISTRATIVO });

    const res = await request(app.getHttpServer())
      .post(`/carreras/${carreraMeridaId}/malla`)
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', Buffer.from('%PDF-1.4'), { filename: 'malla.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('POST /carreras/:id/malla rol no ADMINISTRATIVO -> 403 ROL_NO_AUTORIZADO', async () => {
    const token = await firmarToken({ role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ALUMNO });

    const res = await request(app.getHttpServer())
      .post(`/carreras/${carreraMeridaId}/malla`)
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', Buffer.from('%PDF-1.4'), { filename: 'malla.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });

  it('POST /carreras/:id/malla sin Authorization -> 401 UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer())
      .post(`/carreras/${carreraMeridaId}/malla`)
      .attach('archivo', Buffer.from('%PDF-1.4'), { filename: 'malla.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
  });
});
```

- [ ] **Step 8: Correr la suite e2e**

Run: `cd App/backend && npm run test:e2e -- malla-curricular`
Expected: 7 tests en verde.

- [ ] **Step 9: Correr la suite e2e completa (sin regresión)**

Run: `cd App/backend && npm run test:e2e`
Expected: todas las suites existentes en verde, más las 7 nuevas.

- [ ] **Step 10: Commit**

```bash
git add App/backend/src/malla-curricular App/backend/src/app.module.ts App/backend/package.json App/backend/pnpm-lock.yaml App/backend/test/malla-curricular.e2e-spec.ts
git commit -m "feat(backend): POST /carreras/:id/malla - subida de malla curricular a Storage

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Frontend — botón "Subir malla" en `app/admin/carreras/page.tsx`

**Files:**
- Modify: `App/frontend/src/lib/api/http.ts:55-84` (fix de `Content-Type` para `FormData`)
- Modify: `App/frontend/src/lib/api/carreras.ts` (agrega tipo + función nuevos)
- Modify: `App/frontend/src/app/admin/carreras/page.tsx`

**Interfaces:**
- Consumes: `apiFetchAuth` (de `./http`, fixeado en este mismo task).
- Produces: `export interface MallaCurricular { id: string; carreraId: string; nombreArchivo: string; subidaEn: string; subidaPorId: string }`, `export function subirMallaCurricular(carreraId: string, file: File): Promise<MallaCurricular>` — ambos en `lib/api/carreras.ts`, consumidos solo por `app/admin/carreras/page.tsx` en este plan.

- [ ] **Step 1: Fix de `apiFetchRaw` para no forzar `Content-Type: application/json` en `FormData`**

El fetcher compartido (`apiFetchRaw`, usado por todo `apiFetch`/`apiFetchAuth`/etc.) hoy pone `'Content-Type': 'application/json'` SIEMPRE — si se manda un body `FormData` (necesario para subir el PDF), ese header incorrecto pisa el `multipart/form-data; boundary=...` que el navegador necesita generar solo, y el backend no podría parsear el archivo. Es un gap real de la infraestructura compartida que bloquea este feature — se corrige acá, no se inventa un fetcher aparte (evita duplicar la lógica de auth/manejo de errores ya centralizada).

En `App/frontend/src/lib/api/http.ts`, el bloque actual (líneas 64-70) es:

```ts
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
```

Reemplázalo por:

```ts
  // `FormData` (subida de archivos, ej. malla curricular) necesita que el
  // navegador ponga su propio `Content-Type: multipart/form-data;
  // boundary=...` — forzar `application/json` acá rompería el parseo del
  // archivo en el backend. Para cualquier otro body (JSON, el caso normal)
  // el default de siempre se mantiene igual.
  const esFormData = init?.body instanceof FormData;
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(esFormData ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  });
```

- [ ] **Step 2: Verificar tipos tras el fix de `http.ts`**

Run: `cd App/frontend && npx tsc --noEmit`
Expected: sin salida, exit 0.

- [ ] **Step 3: Agregar `MallaCurricular` y `subirMallaCurricular` a `lib/api/carreras.ts`**

Al final de `App/frontend/src/lib/api/carreras.ts`, agrega:

```ts

/**
 * `MallaCurricular` — Fase 7, Día 23. Espejo de `model MallaCurricular`
 * (`schema.prisma`) tal como lo devuelve `POST /carreras/:id/malla` —
 * sin `carrera` (relación completa, el frontend no la necesita acá).
 */
export interface MallaCurricular {
  id: string;
  carreraId: string;
  storagePath: string;
  nombreArchivo: string;
  subidaEn: string;
  subidaPorId: string;
}

/**
 * `POST /carreras/:id/malla` — sube el PDF de malla curricular (multipart,
 * campo `archivo`). Upsert 1-a-1 con la carrera (regla 6 de `CLAUDE.md`
 * raíz) — reemplaza la malla vigente si ya había una.
 */
export function subirMallaCurricular(
  carreraId: string,
  file: File,
): Promise<MallaCurricular> {
  const formData = new FormData();
  formData.append('archivo', file);
  return apiFetchAuth<MallaCurricular>(`/carreras/${carreraId}/malla`, {
    method: 'POST',
    body: formData,
  });
}
```

- [ ] **Step 4: Botón "Subir malla" en la tabla de carreras**

En `App/frontend/src/app/admin/carreras/page.tsx`:

Agrega el import (junto a los otros de `@/lib/api/carreras`):

```ts
import {
  actualizarCarrera,
  crearCarrera,
  listarCarreras,
  subirMallaCurricular,
  type ActualizarCarreraInput,
  type Carrera,
  type CrearCarreraInput,
  type EstatusCarrera,
  type ModalidadCarrera,
  type NivelCarrera,
} from '@/lib/api/carreras';
```

Dentro de `AdminCarrerasPage`, después de la declaración de `actualizarMutation` (antes de `function handleSubmitNuevo`), agrega el estado y la mutación de subida:

```tsx
  const [carreraIdParaMalla, setCarreraIdParaMalla] = useState<string | null>(null);
  const inputMallaRef = useRef<HTMLInputElement>(null);

  const subirMallaMutation = useMutation({
    mutationFn: (vars: { carreraId: string; file: File }) =>
      subirMallaCurricular(vars.carreraId, vars.file),
    onSuccess: () => {
      toast.success('Malla curricular actualizada');
    },
    onError: (err, vars) => {
      console.error('[AdminCarrerasPage] Error al subir malla curricular:', {
        carreraId: vars.carreraId,
        nombreArchivo: vars.file.name,
        err,
      });
      toast.error(resolverMensajeError(err, MENSAJES_ERROR_CARRERA) ?? MENSAJE_ERROR_GENERICO);
    },
  });

  function iniciarSubidaMalla(carreraId: string) {
    setCarreraIdParaMalla(carreraId);
    inputMallaRef.current?.click();
  }

  function handleArchivoMallaSeleccionado(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite volver a seleccionar el mismo archivo dos veces seguidas
    if (!file || !carreraIdParaMalla) return;

    if (file.type !== 'application/pdf') {
      toast.error('El archivo debe ser un PDF.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('El archivo no puede pesar más de 5MB.');
      return;
    }

    subirMallaMutation.mutate({ carreraId: carreraIdParaMalla, file });
  }
```

`useState` ya viene importado de `react` en este archivo — reemplaza el import existente `import { useState, type FormEvent } from 'react';` por `import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';` (agrega `useRef` y `type ChangeEvent`).

En el JSX, agrega el `<input>` oculto una sola vez, justo antes del `<div className="overflow-x-auto ...">` de la tabla:

```tsx
      <input
        ref={inputMallaRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={handleArchivoMallaSeleccionado}
      />
```

Y en la fila de la tabla, junto al botón "Editar" existente (dentro de la celda `<td className="px-4 py-3 text-right">`):

```tsx
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => iniciarSubidaMalla(carrera.id)}
                    disabled={subirMallaMutation.isPending}
                    className="mr-4 text-navy hover:underline disabled:opacity-50"
                  >
                    {subirMallaMutation.isPending && subirMallaMutation.variables?.carreraId === carrera.id
                      ? 'Subiendo…'
                      : 'Subir malla'}
                  </button>
                  <button
                    onClick={() => iniciarEdicion(carrera)}
                    className="text-navy hover:underline"
                  >
                    Editar
                  </button>
                </td>
```

- [ ] **Step 5: Verificar tipos**

Run: `cd App/frontend && npx tsc --noEmit`
Expected: sin salida, exit 0.

- [ ] **Step 6: Verificar lint**

Run: `cd App/frontend && npx eslint src/lib/api/http.ts src/lib/api/carreras.ts src/app/admin/carreras/page.tsx`
Expected: sin salida, exit 0.

- [ ] **Step 7: Commit**

```bash
git add App/frontend/src/lib/api/http.ts App/frontend/src/lib/api/carreras.ts App/frontend/src/app/admin/carreras/page.tsx
git commit -m "feat(frontend): boton Subir malla en la tabla de carreras + fix de Content-Type para FormData

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Verificación manual final (opcional, recomendada antes de cerrar Día 23)

Con backend y frontend corriendo (`npm run start:dev` / `pnpm dev`): entrar a `/admin/carreras` como un administrativo real, click en "Subir malla" de cualquier carrera, seleccionar un PDF real de menos de 5MB → confirmar el toast de éxito. Repetir con un PDF distinto sobre la misma carrera → confirmar que sigue siendo un solo registro (`SELECT COUNT(*) FROM mallas_curriculares WHERE carrera_id = '...'` debe dar 1). Este es el entregable visible literal del roadmap ("admin sube un PDF real de malla curricular de prueba").
