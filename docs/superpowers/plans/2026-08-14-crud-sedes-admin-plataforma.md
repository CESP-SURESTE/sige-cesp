# CRUD de sedes + AdminPlataforma — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `AdminPlataforma` (identidad de plataforma, separada de `Usuario`/JWT de
Supabase) puede loguearse y crear/listar/editar sedes de punta a punta.

**Architecture:** Identidad nueva y aislada (tabla `AdminPlataforma`, JWT propio firmado
con `jose`, `PlatformAdminGuard` — no toca `SedeGuard`/`RolesGuard` ni ninguna ruta
existente). `POST/GET/PATCH /sedes` se agregan al `SedesController` ya existente
(Día 6, hoy solo tenía `GET /sedes/:sedeId` de prueba), guardados por método (no a nivel
de controller) para no romper esa ruta vieja. `RegistroAuditoria` se extiende para poder
auditar acciones de `AdminPlataforma` (actor sin `Usuario`).

**Tech Stack:** NestJS + Prisma 6.x + Postgres (Supabase) · `jose` (ya transitivo, JWT
propio) · `node:crypto` `scrypt` (hash de password, sin dependencia nueva) · Next.js +
React Query (frontend, `app/plataforma/` nuevo).

## Global Constraints

- Sin dependencias nuevas — `jose` y `scrypt`/`node:crypto` ya cubren JWT y hashing.
- `jose` es ESM-only: SIEMPRE `await import('jose')` dinámico, nunca `import ... from
  'jose'` estático (revienta bajo Jest/ts-jest) — ver `sede.guard.ts` y cualquier
  `test/*.e2e-spec.ts` para el patrón exacto.
- Contrato de API: éxito `{ data }`, error `{ error, code }`. Sin códigos de error nuevos
  — reutilizar `VALIDATION_ERROR`/`CONFLICT`/`NOT_FOUND`/`UNAUTHORIZED`.
- `DELETE /sedes/:id` está FUERA de alcance de este plan (decisión explícita, ver spec).
- `POST /platform-admin` (alta de miembro nuevo) está FUERA de alcance de este plan — el
  único `AdminPlataforma` necesario hoy se crea con el script de bootstrap (Task 8).
- Regla 5 de `CLAUDE.md` raíz: `RegistroAuditoria` se crea automáticamente en cada acción
  sensible, nunca vía endpoint de escritura directa.
- Regla 11: `app/plataforma/` es un árbol de frontend nuevo y aislado — no comparte
  componentes con `app/admin`/`app/alumno`.
- Todo catch/error handler loguea con `console.error` antes de responder (regla 12).

Spec completo: `docs/superpowers/specs/2026-08-14-crud-sedes-admin-plataforma-design.md`.

---

### Task 1: Schema — `AdminPlataforma` + extensión de `RegistroAuditoria` + RLS

**Files:**
- Modify: `App/backend/prisma/schema.prisma`
- Create: `App/backend/prisma/migrations/<timestamp>_admin_plataforma/migration.sql`
  (generado por Prisma, luego editado a mano)

**Interfaces:**
- Produce: modelo `AdminPlataforma` (`id`, `email`, `passwordHash`, `nombre`, `activo`,
  `createdAt`) — usado por Task 2 (hash), Task 4 (login/guard), Task 6 (CRUD sedes,
  audit), Task 8 (bootstrap).
- Produce: `RegistroAuditoria.adminPlataformaId` (nullable) — usado por Task 6.

- [ ] **Step 1: Editar `schema.prisma`**

Agregar el modelo nuevo (después de `model Sede { ... }`, junto a `SedeResponsable` es
buen lugar por cercanía temática, pero cualquier posición está bien — Prisma no depende
del orden):

```prisma
model AdminPlataforma {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String   @map("password_hash")
  nombre       String
  activo       Boolean  @default(true)
  createdAt    DateTime @default(now()) @map("created_at")

  registrosAuditoria RegistroAuditoria[]

  @@map("admin_plataforma")
}
```

Editar `model RegistroAuditoria` (busca `usuarioId String @map("usuario_id")` — está
cerca de la línea 478 hoy):

```prisma
model RegistroAuditoria {
  id                String           @id @default(uuid())
  usuarioId         String?          @map("usuario_id")
  usuario           Usuario?         @relation(fields: [usuarioId], references: [id])
  adminPlataformaId String?          @map("admin_plataforma_id")
  adminPlataforma   AdminPlataforma? @relation(fields: [adminPlataformaId], references: [id])
  sedeId            String           @map("sede_id")
  sede              Sede             @relation(fields: [sedeId], references: [id])
  accion            AccionAuditoria
  entidad           String
  entidadId         String           @map("entidad_id")
  detalle           Json?
  fecha             DateTime         @default(now())

  @@map("registro_auditoria")
}
```

(Solo 4 líneas cambian de lo que ya existe: `usuarioId` y `usuario` ganan `?`, se agregan
`adminPlataformaId`/`adminPlataforma`.)

- [ ] **Step 2: Generar el diff de migración sin aplicarlo**

Run: `cd App/backend && pnpm exec prisma migrate dev --name admin_plataforma --create-only`

Esto crea `prisma/migrations/<timestamp>_admin_plataforma/migration.sql` con los
`CREATE TABLE "admin_plataforma"`, `ALTER TABLE "registro_auditoria" ALTER COLUMN
"usuario_id" DROP NOT NULL`, la columna nueva `admin_plataforma_id` y sus FKs — todo
generado automáticamente por Prisma. NO lo aplica todavía (`--create-only`).

- [ ] **Step 3: Agregar a mano el `CHECK` constraint y la RLS al final del archivo generado**

Al final de `migration.sql` (después de todo lo que Prisma generó), agregar:

```sql
-- ============================================================================
-- Fase 6, Día 20 — CHECK: un RegistroAuditoria tiene exactamente un actor
-- (Usuario XOR AdminPlataforma), nunca ambos, nunca ninguno.
-- ============================================================================
ALTER TABLE "registro_auditoria"
  ADD CONSTRAINT "registro_auditoria_actor_check"
  CHECK (("usuario_id" IS NOT NULL) != ("admin_plataforma_id" IS NOT NULL));

-- ============================================================================
-- ADMIN_PLATAFORMA — sin sede_id (por diseño, es una identidad cross-sede).
-- RLS habilitada SIN ninguna policy: cerrado por default para
-- authenticated/anon (mismo patrón que sede_responsables, sin policy de
-- UPDATE/DELETE, ver 20260806224102_rls_multisede/migration.sql). El backend
-- conecta como rol postgres y bypassa RLS (ver comentario en esa misma
-- migración) — esto es defensa en profundidad, no el mecanismo real de
-- control de acceso (ese es PlatformAdminGuard).
-- ============================================================================
ALTER TABLE "admin_plataforma" ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 4: Aplicar la migración**

Run: `cd App/backend && pnpm exec prisma migrate dev`

Expected: `Applying migration ... admin_plataforma ... The migration has been applied
successfully.` — sin errores. Si el `CHECK` constraint fallara por datos existentes
(`usuario_id` NULL en filas viejas), no debería pasar — todas las filas actuales de
`registro_auditoria` ya tienen `usuario_id` seteado (ninguna fue creada por
`AdminPlataforma` todavía).

- [ ] **Step 5: Regenerar el cliente de Prisma**

Run: `cd App/backend && pnpm exec prisma generate`

Expected: sin errores, `@prisma/client` ahora expone `prisma.adminPlataforma` y los
campos nuevos de `RegistroAuditoria`.

- [ ] **Step 6: Commit**

```bash
git add App/backend/prisma/schema.prisma App/backend/prisma/migrations/
git commit -m "feat(backend): schema AdminPlataforma + RegistroAuditoria extendido (Día 20)"
```

---

### Task 2: Hash de password (`scrypt`)

**Files:**
- Create: `App/backend/src/platform-admin/password.util.ts`
- Test: `App/backend/src/platform-admin/password.util.spec.ts`

**Interfaces:**
- Produce: `hashPassword(password: string): Promise<string>`,
  `verifyPassword(password: string, hash: string): Promise<boolean>` — usados por Task 4
  (login) y Task 8 (bootstrap).

- [ ] **Step 1: Escribir el test que falla**

```ts
import { hashPassword, verifyPassword } from './password.util';

describe('password.util', () => {
  it('verifyPassword regresa true con la password correcta', async () => {
    const hash = await hashPassword('una-password-de-prueba-123');
    await expect(verifyPassword('una-password-de-prueba-123', hash)).resolves.toBe(true);
  });

  it('verifyPassword regresa false con la password incorrecta', async () => {
    const hash = await hashPassword('una-password-de-prueba-123');
    await expect(verifyPassword('password-equivocada', hash)).resolves.toBe(false);
  });

  it('2 hashes de la misma password son distintos (salt aleatorio)', async () => {
    const hash1 = await hashPassword('misma-password');
    const hash2 = await hashPassword('misma-password');
    expect(hash1).not.toBe(hash2);
  });
});
```

- [ ] **Step 2: Correr el test, confirmar que falla**

Run: `cd App/backend && pnpm exec jest password.util.spec.ts`
Expected: FAIL — `Cannot find module './password.util'`

- [ ] **Step 3: Implementar**

```ts
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Hash de password de `AdminPlataforma` — Fase 6, Día 20.
 *
 * `scrypt` de `node:crypto` (nativo, sin `bcrypt`/`argon2` como dependencia
 * nueva — decisión ya tomada en `docs/roadmap.md`, nota de diseño del Día 20).
 * Formato de almacenamiento: `"<salt-hex>:<derivedKey-hex>"` — el salt viaja
 * junto al hash (estándar, no es secreto), se necesita para re-derivar la
 * key al verificar.
 */
const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  const [salt, key] = hash.split(':');
  if (!salt || !key) {
    return false;
  }

  const keyBuffer = Buffer.from(key, 'hex');
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;

  // Longitud debe coincidir antes de timingSafeEqual (revienta si difieren).
  if (derivedKey.length !== keyBuffer.length) {
    return false;
  }

  return timingSafeEqual(derivedKey, keyBuffer);
}
```

- [ ] **Step 4: Correr el test, confirmar que pasa**

Run: `cd App/backend && pnpm exec jest password.util.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add App/backend/src/platform-admin/password.util.ts App/backend/src/platform-admin/password.util.spec.ts
git commit -m "feat(backend): hash de password de AdminPlataforma (scrypt)"
```

---

### Task 3: JWT propio de plataforma (`jose`)

**Files:**
- Create: `App/backend/src/platform-admin/platform-admin-jwt.util.ts`
- Test: `App/backend/src/platform-admin/platform-admin-jwt.util.spec.ts`
- Modify: `App/backend/.env` (agregar `PLATFORM_ADMIN_JWT_SECRET`)
- Modify: `App/backend/.env.example` si existe (mismo nombre de var, valor placeholder)

**Interfaces:**
- Consume: `process.env.PLATFORM_ADMIN_JWT_SECRET`
- Produce: `firmarPlatformAdminToken(claims: { sub: string; email: string }):
  Promise<string>`, `verificarPlatformAdminToken(token: string): Promise<{ sub: string;
  email: string }>` — usados por Task 4 (`PlatformAdminGuard`) y Task 5 (login).

- [ ] **Step 1: Agregar la env var**

Generar un secreto y agregarlo a `App/backend/.env`:

Run (PowerShell): `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

Agregar al `.env` la línea `PLATFORM_ADMIN_JWT_SECRET=<el valor generado>` (junto a las
demás env vars del backend). Si existe `App/backend/.env.example`, agregar ahí
`PLATFORM_ADMIN_JWT_SECRET=` (sin valor real).

- [ ] **Step 2: Escribir el test que falla**

```ts
import {
  firmarPlatformAdminToken,
  verificarPlatformAdminToken,
} from './platform-admin-jwt.util';

describe('platform-admin-jwt.util', () => {
  beforeAll(() => {
    process.env.PLATFORM_ADMIN_JWT_SECRET = 'secreto-de-prueba-solo-para-tests-1234567890';
  });

  it('firma y verifica un token válido, recupera los claims', async () => {
    const token = await firmarPlatformAdminToken({
      sub: '11111111-1111-1111-1111-111111111111',
      email: 'plataforma.prueba@nexo-sd.mx',
    });

    const claims = await verificarPlatformAdminToken(token);

    expect(claims.sub).toBe('11111111-1111-1111-1111-111111111111');
    expect(claims.email).toBe('plataforma.prueba@nexo-sd.mx');
  });

  it('rechaza un token con firma inválida', async () => {
    const token = await firmarPlatformAdminToken({
      sub: '11111111-1111-1111-1111-111111111111',
      email: 'x@x.mx',
    });
    const tokenAlterado = token.slice(0, -2) + 'xx';

    await expect(verificarPlatformAdminToken(tokenAlterado)).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Correr el test, confirmar que falla**

Run: `cd App/backend && pnpm exec jest platform-admin-jwt.util.spec.ts`
Expected: FAIL — `Cannot find module './platform-admin-jwt.util'`

- [ ] **Step 4: Implementar**

```ts
/**
 * JWT propio de `AdminPlataforma` — Fase 6, Día 20.
 *
 * `jose` (v6) es ESM-only ("type": "module") — un `import ... from 'jose'`
 * estático revienta bajo Jest (ts-jest compila a CommonJS). Se resuelve con
 * `import()` dinámico + caché en módulo, mismo patrón exacto que
 * `src/common/guards/sede.guard.ts`.
 *
 * Secreto simétrico (`PLATFORM_ADMIN_JWT_SECRET`, HS256) — a diferencia del
 * JWT de Supabase (asimétrico, verificado contra JWKS), este JWT lo firma Y
 * verifica el propio backend, no hay tercero involucrado.
 */
let joseModule: typeof import('jose') | undefined;

async function getJose() {
  if (!joseModule) {
    joseModule = await import('jose');
  }
  return joseModule;
}

function getSecret(): Uint8Array {
  const secret = process.env.PLATFORM_ADMIN_JWT_SECRET;
  if (!secret) {
    throw new Error('Falta PLATFORM_ADMIN_JWT_SECRET en el entorno');
  }
  return new TextEncoder().encode(secret);
}

export interface PlatformAdminJwtClaims {
  sub: string;
  email: string;
}

export async function firmarPlatformAdminToken(
  claims: PlatformAdminJwtClaims,
): Promise<string> {
  const jose = await getJose();
  return new jose.SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(getSecret());
}

export async function verificarPlatformAdminToken(
  token: string,
): Promise<PlatformAdminJwtClaims> {
  const jose = await getJose();
  const { payload } = await jose.jwtVerify(token, getSecret());

  if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
    throw new Error('Token de plataforma con claims inválidos');
  }

  return { sub: payload.sub, email: payload.email };
}
```

- [ ] **Step 5: Correr el test, confirmar que pasa**

Run: `cd App/backend && pnpm exec jest platform-admin-jwt.util.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add App/backend/src/platform-admin/platform-admin-jwt.util.ts App/backend/src/platform-admin/platform-admin-jwt.util.spec.ts
git commit -m "feat(backend): JWT propio de AdminPlataforma (jose, HS256)"
```

(`.env` no se commitea — ya está en `.gitignore` del proyecto, igual que las demás env
vars del backend.)

---

### Task 4: `PlatformAdminGuard` + decorator + tipos

**Files:**
- Create: `App/backend/src/common/guards/platform-admin.guard.ts`
- Create: `App/backend/src/common/guards/platform-admin-guard.module.ts`
- Create: `App/backend/src/common/decorators/platform-admin-actual.decorator.ts`
- Modify: `App/backend/src/common/types/express.d.ts`
- Modify: `App/backend/src/app.module.ts`
- Test: `App/backend/src/common/guards/platform-admin.guard.spec.ts`

**Interfaces:**
- Consume: `verificarPlatformAdminToken` (Task 3)
- Produce: `request.platformAdminId: string` (populado tras el guard), decorator
  `@PlatformAdminActual()` — usado por Task 6 (`sedes.controller.ts`) para el actor de
  auditoría.

- [ ] **Step 1: Aumentar el tipo de `Request`**

En `App/backend/src/common/types/express.d.ts`, agregar dentro de `interface Request`:

```ts
      /** `AdminPlataforma.id` extraído del JWT propio de plataforma, ver `PlatformAdminGuard`. */
      platformAdminId?: string;
```

- [ ] **Step 2: Escribir el test unitario que falla**

Unitario, no e2e — a propósito: `GET /sedes` (la única ruta real que usará este guard)
no existe todavía, se agrega en Task 6. Probar el guard aislado (mismo patrón que
`src/common/guards/roles.guard.spec.ts`: mockear `ExecutionContext`/`Request` a mano) no
depende de que exista ninguna ruta.

```ts
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { firmarPlatformAdminToken } from '../../platform-admin/platform-admin-jwt.util';
import { PlatformAdminGuard } from './platform-admin.guard';

describe('PlatformAdminGuard (unit)', () => {
  beforeAll(() => {
    process.env.PLATFORM_ADMIN_JWT_SECRET =
      'secreto-de-prueba-solo-para-tests-1234567890';
  });

  function crearContexto(authHeader: string | undefined): {
    guard: PlatformAdminGuard;
    context: ExecutionContext;
    request: Request;
  } {
    const request = {
      headers: { authorization: authHeader },
    } as unknown as Request;
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    return { guard: new PlatformAdminGuard(), context, request };
  }

  it('sin Authorization header -> 401 UnauthorizedException', async () => {
    const { guard, context } = crearContexto(undefined);

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('con token inválido -> 401 UnauthorizedException', async () => {
    const { guard, context } = crearContexto('Bearer token-invalido');

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('con token válido -> deja pasar y puebla request.platformAdminId', async () => {
    const token = await firmarPlatformAdminToken({
      sub: '11111111-1111-1111-1111-111111111111',
      email: 'plataforma.prueba@nexo-sd.mx',
    });
    const { guard, context, request } = crearContexto(`Bearer ${token}`);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.platformAdminId).toBe(
      '11111111-1111-1111-1111-111111111111',
    );
  });
});
```

- [ ] **Step 3: Correr el test, confirmar que falla**

Run: `cd App/backend && pnpm test -- platform-admin.guard.spec.ts` (NO `pnpm exec jest`
directo — el archivo importa `firmarPlatformAdminToken`, que hace `import()` dinámico de
`jose`; Jest sin `--experimental-vm-modules` revienta con `TypeError: A dynamic import
callback was invoked without --experimental-vm-modules`. `pnpm test` ya usa el wrapper
`scripts/run-unit-tests.js` que agrega ese flag, ver Task 3.)
Expected: FAIL — `Cannot find module './platform-admin.guard'`

- [ ] **Step 4: Implementar el guard**

`App/backend/src/common/guards/platform-admin.guard.ts`:

```ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { verificarPlatformAdminToken } from '../../platform-admin/platform-admin-jwt.util';

/**
 * Guard de `AdminPlataforma` — Fase 6, Día 20.
 *
 * Aislado por completo de `SedeGuard`/`RolesGuard` (regla del roadmap: "cero
 * riesgo para las rutas existentes"). Verifica el JWT propio firmado por
 * `firmarPlatformAdminToken` (`platform-admin-jwt.util.ts`) y deja
 * `request.platformAdminId` disponible — `@PlatformAdminActual()` lo expone
 * a los controllers, mismo patrón que `@SedeActual()`/`SedeGuard`.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    const authHeader = request.headers['authorization'];
    const token =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : null;

    if (!token) {
      throw new UnauthorizedException({
        error: 'Falta el token de autenticación (Authorization: Bearer <token>)',
        code: 'UNAUTHORIZED',
      });
    }

    try {
      const claims = await verificarPlatformAdminToken(token);
      request.platformAdminId = claims.sub;
    } catch (err) {
      console.error('[PlatformAdminGuard] token inválido:', err);
      throw new UnauthorizedException({
        error: 'Token de plataforma inválido o expirado',
        code: 'UNAUTHORIZED',
      });
    }

    return true;
  }
}
```

`App/backend/src/common/guards/platform-admin-guard.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { PlatformAdminGuard } from './platform-admin.guard';

/**
 * Módulo `@Global()` — mismo patrón que `SedeGuardModule`/`RolesGuardModule`
 * (ver esos archivos): cualquier feature module puede usar
 * `@UseGuards(PlatformAdminGuard)` sin importar nada extra.
 */
@Global()
@Module({
  providers: [PlatformAdminGuard],
  exports: [PlatformAdminGuard],
})
export class PlatformAdminGuardModule {}
```

`App/backend/src/common/decorators/platform-admin-actual.decorator.ts`:

```ts
import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Inyecta el `AdminPlataforma.id` ya validado por `PlatformAdminGuard` —
 * mismo patrón que `@SedeActual()` (`sede-actual.decorator.ts`). Revienta
 * con 500 explícito si se usa en una ruta sin el guard, para que el error se
 * note en desarrollo.
 */
export const PlatformAdminActual = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();

    if (!request.platformAdminId) {
      throw new InternalServerErrorException({
        error:
          '@PlatformAdminActual() se usó en una ruta sin PlatformAdminGuard.',
        code: 'SERVER_ERROR',
      });
    }

    return request.platformAdminId;
  },
);
```

En `App/backend/src/app.module.ts`, agregar el import y registrarlo junto a los otros 2
guards globales:

```ts
import { PlatformAdminGuardModule } from './common/guards/platform-admin-guard.module';
// ...
  imports: [
    PrismaModule,
    SedeGuardModule,
    RolesGuardModule,
    PlatformAdminGuardModule,
    SedesModule,
    // ... resto igual
  ],
```

- [ ] **Step 5: Correr el test, confirmar que pasa**

Run: `cd App/backend && pnpm test -- platform-admin.guard.spec.ts` (NO `pnpm exec jest`
directo — el archivo importa `firmarPlatformAdminToken`, que hace `import()` dinámico de
`jose`; Jest sin `--experimental-vm-modules` revienta con `TypeError: A dynamic import
callback was invoked without --experimental-vm-modules`. `pnpm test` ya usa el wrapper
`scripts/run-unit-tests.js` que agrega ese flag, ver Task 3.)
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add App/backend/src/common/guards/platform-admin.guard.ts App/backend/src/common/guards/platform-admin.guard.spec.ts App/backend/src/common/guards/platform-admin-guard.module.ts App/backend/src/common/decorators/platform-admin-actual.decorator.ts App/backend/src/common/types/express.d.ts App/backend/src/app.module.ts
git commit -m "feat(backend): PlatformAdminGuard aislado (Día 20)"
```

---

### Task 5: `POST /platform-admin/login`

**Files:**
- Create: `App/backend/src/platform-admin/dto/login-platform-admin.dto.ts`
- Create: `App/backend/src/platform-admin/platform-admin.service.ts`
- Create: `App/backend/src/platform-admin/platform-admin.controller.ts`
- Create: `App/backend/src/platform-admin/platform-admin.module.ts`
- Modify: `App/backend/src/app.module.ts`
- Test: `App/backend/test/platform-admin-login.e2e-spec.ts`

**Interfaces:**
- Consume: `hashPassword`/`verifyPassword` (Task 2), `firmarPlatformAdminToken` (Task 3),
  `PrismaService.adminPlataforma` (Task 1)
- Produce: `POST /platform-admin/login` → `200 { data: { token: string } }`

- [ ] **Step 1: DTO**

```ts
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginPlatformAdminDto {
  @IsEmail({}, { message: 'email inválido' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'password es requerida' })
  password!: string;
}
```

- [ ] **Step 2: Escribir el test que falla**

```ts
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/load-env';
import { hashPassword } from '../src/platform-admin/password.util';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup-app';

loadEnv();

interface ErrorBody {
  error: string;
  code: string;
}
interface LoginBody {
  data: { token: string };
}

describe('POST /platform-admin/login (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const email = 'e2e.platform-admin-login@nexo-sd.mx';
  const password = 'password-de-prueba-e2e-123';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    await prisma.adminPlataforma.deleteMany({ where: { email } });
    await prisma.adminPlataforma.create({
      data: {
        email,
        passwordHash: await hashPassword(password),
        nombre: 'E2E Platform Admin',
      },
    });
  });

  afterAll(async () => {
    await prisma.adminPlataforma.deleteMany({ where: { email } });
    await app.close();
  });

  it('credenciales correctas -> 200 con token', async () => {
    const res = await request(app.getHttpServer())
      .post('/platform-admin/login')
      .send({ email, password });

    expect(res.status).toBe(200);
    expect(typeof (res.body as LoginBody).data.token).toBe('string');
  });

  it('password incorrecta -> 401 UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer())
      .post('/platform-admin/login')
      .send({ email, password: 'password-equivocada' });

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
  });

  it('email inexistente -> 401 UNAUTHORIZED (mismo código, no revela cuál falló)', async () => {
    const res = await request(app.getHttpServer())
      .post('/platform-admin/login')
      .send({ email: 'no-existe@nexo-sd.mx', password });

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
  });

  it('body inválido -> 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .post('/platform-admin/login')
      .send({ email: 'no-es-un-email', password: '' });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });
});
```

- [ ] **Step 3: Correr el test, confirmar que falla**

Run: `cd App/backend && pnpm test:e2e -- platform-admin-login.e2e-spec.ts` (NO `pnpm exec
jest` directo — los specs de `test/` usan una config de Jest separada
(`test/jest-e2e.json`) corrida vía el wrapper `scripts/run-e2e.js`, que ya trae
`--experimental-vm-modules` para los imports dinámicos de `jose`/`@supabase/server` —
mismo mecanismo que ya usa `test/sede-guard.e2e-spec.ts`.)
Expected: FAIL — 404, la ruta no existe.

- [ ] **Step 4: Implementar**

`App/backend/src/platform-admin/platform-admin.service.ts`:

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { verifyPassword } from './password.util';
import { firmarPlatformAdminToken } from './platform-admin-jwt.util';

@Injectable()
export class PlatformAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async login(email: string, password: string): Promise<{ token: string }> {
    const admin = await this.prisma.adminPlataforma.findUnique({
      where: { email },
    });

    // Mismo mensaje/código exista o no el email — no revelar cuál de los 2
    // datos falló (mismo criterio que el resto de la API).
    if (!admin || !admin.activo) {
      throw new UnauthorizedException({
        error: 'Correo o contraseña incorrectos',
        code: 'UNAUTHORIZED',
      });
    }

    const passwordValida = await verifyPassword(password, admin.passwordHash);
    if (!passwordValida) {
      throw new UnauthorizedException({
        error: 'Correo o contraseña incorrectos',
        code: 'UNAUTHORIZED',
      });
    }

    const token = await firmarPlatformAdminToken({
      sub: admin.id,
      email: admin.email,
    });

    return { token };
  }
}
```

`App/backend/src/platform-admin/platform-admin.controller.ts`:

```ts
import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { LoginThrottlerGuard } from '../auth/guards/login-throttler.guard';
import { LoginPlatformAdminDto } from './dto/login-platform-admin.dto';
import { PlatformAdminService } from './platform-admin.service';

/**
 * `POST /platform-admin/login` — Fase 6, Día 20.
 *
 * Reutiliza `LoginThrottlerGuard` (Fase 2, Día 9) tal cual — es genérico,
 * sin dependencias propias de `AuthModule`, mismo criterio de rate limiting
 * que `POST /auth/login` (5 intentos/IP/60s): es igual de sensible a fuerza
 * bruta, aunque sea una identidad distinta.
 */
@Controller('platform-admin')
export class PlatformAdminController {
  constructor(private readonly platformAdminService: PlatformAdminService) {}

  @Post('login')
  @HttpCode(200)
  @UseGuards(LoginThrottlerGuard)
  async login(@Body() body: LoginPlatformAdminDto) {
    const data = await this.platformAdminService.login(
      body.email,
      body.password,
    );
    return { data };
  }
}
```

`App/backend/src/platform-admin/platform-admin.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { LoginThrottlerGuard } from '../auth/guards/login-throttler.guard';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminService } from './platform-admin.service';

@Module({
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService, LoginThrottlerGuard],
})
export class PlatformAdminModule {}
```

En `App/backend/src/app.module.ts`, agregar `PlatformAdminModule` a `imports`.

- [ ] **Step 5: Correr el test, confirmar que pasa**

Run: `cd App/backend && pnpm test:e2e -- platform-admin-login.e2e-spec.ts` (NO `pnpm exec
jest` directo — los specs de `test/` usan una config de Jest separada
(`test/jest-e2e.json`) corrida vía el wrapper `scripts/run-e2e.js`, que ya trae
`--experimental-vm-modules` para los imports dinámicos de `jose`/`@supabase/server` —
mismo mecanismo que ya usa `test/sede-guard.e2e-spec.ts`.)
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add App/backend/src/platform-admin/ App/backend/src/app.module.ts App/backend/test/platform-admin-login.e2e-spec.ts
git commit -m "feat(backend): POST /platform-admin/login"
```

---

### Task 6: `POST/GET/PATCH /sedes` (extiende el `SedesController` del Día 6)

**Files:**
- Create: `App/backend/src/sedes/dto/crear-sede.dto.ts`
- Create: `App/backend/src/sedes/dto/actualizar-sede.dto.ts`
- Modify: `App/backend/src/sedes/sedes.controller.ts`
- Modify: `App/backend/src/sedes/sedes.service.ts`
- Test: `App/backend/test/sedes-crud.e2e-spec.ts`

**Interfaces:**
- Consume: `PlatformAdminGuard`/`PlatformAdminActual` (Task 4)
- Produce: `POST /sedes` → `201 { data: Sede }`, `GET /sedes` → `200 { data: Sede[] }`,
  `PATCH /sedes/:id` → `200 { data: Sede }`

- [ ] **Step 1: DTOs**

```ts
// crear-sede.dto.ts
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CrearSedeDto {
  @IsString()
  @IsNotEmpty({ message: 'nombre es requerido' })
  nombre!: string;

  @IsString()
  @IsNotEmpty({ message: 'direccion es requerida' })
  direccion!: string;

  @IsString()
  @IsNotEmpty({ message: 'ubicacionReferencia es requerida' })
  ubicacionReferencia!: string;

  @IsString()
  @IsNotEmpty({ message: 'telefono es requerido' })
  telefono!: string;

  @IsOptional()
  @IsNumber({}, { message: 'costoRenta debe ser un número' })
  costoRenta?: number;
}
```

```ts
// actualizar-sede.dto.ts
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class ActualizarSedeDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'nombre no puede ser vacío' })
  nombre?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'direccion no puede ser vacía' })
  direccion?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'ubicacionReferencia no puede ser vacía' })
  ubicacionReferencia?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'telefono no puede ser vacío' })
  telefono?: string;

  @IsOptional()
  @IsNumber({}, { message: 'costoRenta debe ser un número' })
  costoRenta?: number;
}
```

- [ ] **Step 2: Escribir el test que falla**

```ts
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/load-env';
import { firmarPlatformAdminToken } from '../src/platform-admin/platform-admin-jwt.util';
import { hashPassword } from '../src/platform-admin/password.util';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup-app';

loadEnv();

interface ErrorBody {
  error: string;
  code: string;
}
interface SedeBody {
  data: { id: string; nombre: string };
}

describe('CRUD /sedes con PlatformAdminGuard (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;
  const emailAdmin = 'e2e.sedes-crud@nexo-sd.mx';
  const nombreSedePrueba = `Sede E2E ${Date.now()}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    await prisma.adminPlataforma.deleteMany({ where: { email: emailAdmin } });
    const admin = await prisma.adminPlataforma.create({
      data: {
        email: emailAdmin,
        passwordHash: await hashPassword('password-e2e-123'),
        nombre: 'E2E Sedes',
      },
    });
    token = await firmarPlatformAdminToken({ sub: admin.id, email: admin.email });
  });

  afterAll(async () => {
    await prisma.sede.deleteMany({ where: { nombre: { startsWith: 'Sede E2E ' } } });
    await prisma.adminPlataforma.deleteMany({ where: { email: emailAdmin } });
    await app.close();
  });

  let sedeCreadaId: string;

  it('POST /sedes crea una sede y audita con adminPlataformaId', async () => {
    const res = await request(app.getHttpServer())
      .post('/sedes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: nombreSedePrueba,
        direccion: 'Calle Falsa 123',
        ubicacionReferencia: 'Frente al parque',
        telefono: '9991234567',
      });

    expect(res.status).toBe(201);
    expect((res.body as SedeBody).data.nombre).toBe(nombreSedePrueba);
    sedeCreadaId = (res.body as SedeBody).data.id;

    const registro = await prisma.registroAuditoria.findFirst({
      where: { entidad: 'Sede', entidadId: sedeCreadaId },
    });
    expect(registro?.adminPlataformaId).not.toBeNull();
    expect(registro?.usuarioId).toBeNull();
  });

  it('POST /sedes con nombre duplicado -> 409 CONFLICT', async () => {
    const res = await request(app.getHttpServer())
      .post('/sedes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: nombreSedePrueba,
        direccion: 'Otra dirección',
        ubicacionReferencia: 'Otra referencia',
        telefono: '9997654321',
      });

    expect(res.status).toBe(409);
    expect((res.body as ErrorBody).code).toBe('CONFLICT');
  });

  it('POST /sedes sin nombre -> 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .post('/sedes')
      .set('Authorization', `Bearer ${token}`)
      .send({ direccion: 'x', ubicacionReferencia: 'x', telefono: 'x' });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('GET /sedes incluye la sede recién creada', async () => {
    const res = await request(app.getHttpServer())
      .get('/sedes')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const nombres = (res.body as { data: { nombre: string }[] }).data.map(
      (s) => s.nombre,
    );
    expect(nombres).toContain(nombreSedePrueba);
  });

  it('PATCH /sedes/:id edita el teléfono', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/sedes/${sedeCreadaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ telefono: '9990000000' });

    expect(res.status).toBe(200);
    expect((res.body as { data: { telefono: string } }).data.telefono).toBe(
      '9990000000',
    );
  });

  it('PATCH /sedes/:id con id inexistente -> 404 NOT_FOUND', async () => {
    const res = await request(app.getHttpServer())
      .patch('/sedes/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ telefono: '9990000000' });

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('POST /sedes sin token -> 401 UNAUTHORIZED (PlatformAdminGuard sigue activo)', async () => {
    const res = await request(app.getHttpServer())
      .post('/sedes')
      .send({ nombre: 'x', direccion: 'x', ubicacionReferencia: 'x', telefono: 'x' });

    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 3: Correr el test, confirmar que falla**

Run: `cd App/backend && pnpm test:e2e -- sedes-crud.e2e-spec.ts` (mismo motivo que Task
5 — specs de `test/` corren vía `scripts/run-e2e.js`, no `pnpm exec jest` directo.)
Expected: FAIL — `POST /sedes` no existe (404).

- [ ] **Step 4: Implementar el service**

Reemplazar `App/backend/src/sedes/sedes.service.ts` completo:

```ts
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccionAuditoria, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ActualizarSedeDto } from './dto/actualizar-sede.dto';
import type { CrearSedeDto } from './dto/crear-sede.dto';

@Injectable()
export class SedesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Trae una sede por id. El `SedeGuard` ya garantizó, antes de llegar acá,
   * que `id` coincide con el `sede_id` del JWT de quien hace la request
   * (ver `SedeGuard` — compara el param `:sedeId` contra el JWT). Este
   * service solo se preocupa de la lectura en sí.
   */
  async obtenerPorId(id: string) {
    const sede = await this.prisma.sede.findUnique({ where: { id } });

    if (!sede) {
      throw new NotFoundException({
        error: 'Sede no encontrada',
        code: 'NOT_FOUND',
      });
    }

    return sede;
  }

  /**
   * `POST/GET/PATCH /sedes` — Fase 6, Día 20. Actor: `AdminPlataforma`, sin
   * `sedeId` de contexto (crear una sede es, por diseño, una acción sin
   * sede — ver nota en `docs/roadmap.md`). `RegistroAuditoria` se crea en la
   * misma transacción, con `adminPlataformaId` (nunca `usuarioId`, regla del
   * CHECK constraint de la migración de este día) y `sedeId` = la sede
   * recién creada/editada.
   */
  async crear(dto: CrearSedeDto, actorPlatformAdminId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const sede = await tx.sede.create({
          data: {
            nombre: dto.nombre,
            direccion: dto.direccion,
            ubicacionReferencia: dto.ubicacionReferencia,
            telefono: dto.telefono,
            costoRenta: dto.costoRenta,
          },
        });

        await tx.registroAuditoria.create({
          data: {
            adminPlataformaId: actorPlatformAdminId,
            sedeId: sede.id,
            accion: AccionAuditoria.ALTA,
            entidad: 'Sede',
            entidadId: sede.id,
          },
        });

        return sede;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          error: 'Ya existe una sede con ese nombre',
          code: 'CONFLICT',
        });
      }
      console.error('[SedesService.crear] error inesperado:', err);
      throw err;
    }
  }

  async listar() {
    return this.prisma.sede.findMany({ orderBy: { nombre: 'asc' } });
  }

  async actualizar(
    id: string,
    dto: ActualizarSedeDto,
    actorPlatformAdminId: string,
  ) {
    const existente = await this.prisma.sede.findUnique({ where: { id } });
    if (!existente) {
      throw new NotFoundException({
        error: 'Sede no encontrada',
        code: 'NOT_FOUND',
      });
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const sede = await tx.sede.update({
          where: { id },
          data: {
            nombre: dto.nombre,
            direccion: dto.direccion,
            ubicacionReferencia: dto.ubicacionReferencia,
            telefono: dto.telefono,
            costoRenta: dto.costoRenta,
          },
        });

        await tx.registroAuditoria.create({
          data: {
            adminPlataformaId: actorPlatformAdminId,
            sedeId: sede.id,
            accion: AccionAuditoria.EDICION,
            entidad: 'Sede',
            entidadId: sede.id,
          },
        });

        return sede;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          error: 'Ya existe una sede con ese nombre',
          code: 'CONFLICT',
        });
      }
      console.error('[SedesService.actualizar] error inesperado:', err);
      throw err;
    }
  }
}
```

- [ ] **Step 5: Implementar el controller**

Reemplazar `App/backend/src/sedes/sedes.controller.ts` completo — **ojo**: el guard baja
de nivel de controller a nivel de método, porque ahora conviven 2 actores distintos en el
mismo controller (`SedeGuard` para la ruta vieja de prueba, `PlatformAdminGuard` para el
CRUD nuevo):

```ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PlatformAdminActual } from '../common/decorators/platform-admin-actual.decorator';
import { SedeActual } from '../common/decorators/sede-actual.decorator';
import { PlatformAdminGuard } from '../common/guards/platform-admin.guard';
import { SedeGuard } from '../common/guards/sede.guard';
import { ActualizarSedeDto } from './dto/actualizar-sede.dto';
import { CrearSedeDto } from './dto/crear-sede.dto';
import { SedesService } from './sedes.service';

/**
 * `GET /sedes/:sedeId` — Fase 1, Día 6. Controller de prueba original del
 * `SedeGuard`, sin cambios de comportamiento.
 *
 * `POST/GET/PATCH /sedes` — Fase 6, Día 20. CRUD real, actor
 * `AdminPlataforma` (`PlatformAdminGuard`, ver nota de diseño en
 * `docs/roadmap.md`: crear una sede es una acción sin sede, no encaja en
 * `SedeGuard`). El guard se declara por MÉTODO, no a nivel de `@Controller`
 * — mezclar 2 actores en el mismo controller exige esto: si quedara
 * `@UseGuards(SedeGuard)` a nivel de clase, bloquearía silenciosamente las 3
 * rutas nuevas (esperan el JWT de plataforma, no el de Supabase).
 */
@Controller('sedes')
export class SedesController {
  constructor(private readonly sedesService: SedesService) {}

  @Get(':sedeId')
  @UseGuards(SedeGuard)
  async obtenerPorId(
    @Param('sedeId') sedeId: string,
    @SedeActual() sedeActual: string,
  ) {
    void sedeActual;
    const sede = await this.sedesService.obtenerPorId(sedeId);
    return { data: sede };
  }

  @Post()
  @HttpCode(201)
  @UseGuards(PlatformAdminGuard)
  async crear(
    @Body() body: CrearSedeDto,
    @PlatformAdminActual() actorId: string,
  ) {
    const data = await this.sedesService.crear(body, actorId);
    return { data };
  }

  @Get()
  @UseGuards(PlatformAdminGuard)
  async listar() {
    const data = await this.sedesService.listar();
    return { data };
  }

  @Patch(':id')
  @UseGuards(PlatformAdminGuard)
  async actualizar(
    @Param('id') id: string,
    @Body() body: ActualizarSedeDto,
    @PlatformAdminActual() actorId: string,
  ) {
    const data = await this.sedesService.actualizar(id, body, actorId);
    return { data };
  }
}
```

**IMPORTANTE — colisión de rutas**: Nest resuelve `GET /sedes` (sin parámetro) y `GET
/sedes/:sedeId` como patrones distintos, sin conflicto — pero el ORDEN de los métodos en
la clase importa en Nest para rutas con el mismo prefijo: `@Get(':sedeId')` debe quedar
ANTES que cualquier otra cosa solo si hubiera ambigüedad real; acá no la hay
(`GET /sedes` vs `GET /sedes/:sedeId` son inequívocos por longitud de path). No mover
`obtenerPorId` de su posición sin correr los tests de `sede-guard.e2e-spec.ts` después.

- [ ] **Step 6: Correr el test, confirmar que pasa**

Run: `cd App/backend && pnpm test:e2e -- sedes-crud.e2e-spec.ts` (mismo motivo que Task
5 — specs de `test/` corren vía `scripts/run-e2e.js`, no `pnpm exec jest` directo.)
Expected: PASS (7 tests)

- [ ] **Step 7: Correr TODA la suite de backend — nada se rompió**

Run: `cd App/backend && pnpm test && pnpm test:e2e`
Expected: PASS en ambas suites — `pnpm test` cubre todo `src/**/*.spec.ts` (incluye
`platform-admin.guard.spec.ts`, Task 4, unitario, ya estaba en verde desde esa task) y
`pnpm test:e2e` cubre todo `test/**/*.e2e-spec.ts` (incluye `sede-guard.e2e-spec.ts` — la
ruta vieja `GET /sedes/:sedeId` sigue funcionando igual — y los 2 e2e nuevos de este
plan, Tasks 5 y 6). Este proyecto usa 2 configs de Jest separadas (unit vs e2e, ver
`package.json`/`scripts/run-e2e.js`) — un solo `pnpm exec jest` nunca cubrió ambas.

- [ ] **Step 8: Commit**

```bash
git add App/backend/src/sedes/ App/backend/test/sedes-crud.e2e-spec.ts
git commit -m "feat(backend): POST/GET/PATCH /sedes (AdminPlataforma, Día 20)"
```

---

### Task 7: Actualizar `documentacion_de_agentes/ESTADO.md` y `docs/roadmap.md`

**Files:**
- Modify: `documentacion_de_agentes/ESTADO.md`
- Modify: `docs/roadmap.md`

**Interfaces:** ninguna — solo documentación.

- [ ] **Step 1:** Marcar el checkbox del Día 20 en `docs/roadmap.md` (tachar la línea del
  entregable, agregar 1-2 líneas de qué se construyó y qué quedó fuera de alcance —
  `DELETE`, `POST /platform-admin` de alta, dashboard — igual que se documentó en días
  anteriores).

- [ ] **Step 2:** Agregar entrada en `documentacion_de_agentes/ESTADO.md` (dominio
  backend) con lo construido: `AdminPlataforma`, `PlatformAdminGuard`,
  `POST/GET/PATCH /sedes`, extensión de `RegistroAuditoria`. Seguir el formato ya usado
  por las entradas de días anteriores en ese archivo (Hecho / Bugs / Siguiente).

- [ ] **Step 3: Commit**

```bash
git add documentacion_de_agentes/ESTADO.md docs/roadmap.md
git commit -m "docs: cierre Día 20 (CRUD de sedes + AdminPlataforma)"
```

---

### Task 8: Bootstrap del primer `AdminPlataforma` (no comiteado)

**Files:**
- Create (temporal, se borra al final): `App/backend/_bootstrap-platform-admin.mjs`

**Interfaces:** ninguna — script operativo, no código de producto.

- [ ] **Step 1: Escribir el script**

```js
// App/backend/_bootstrap-platform-admin.mjs — NO COMITEAR, se borra tras correrlo.
import { PrismaClient } from '@prisma/client';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const prisma = new PrismaClient();

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await scrypt(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

function genPassword() {
  return randomBytes(12).toString('base64url'); // 16 chars, alfanumérico + -_
}

const email = 'plataforma.prueba@nexo-sd.mx';
const password = genPassword();

await prisma.adminPlataforma.upsert({
  where: { email },
  update: { passwordHash: await hashPassword(password) },
  create: {
    email,
    passwordHash: await hashPassword(password),
    nombre: 'Plataforma Prueba',
  },
});

console.log('OK');
console.log('EMAIL:' + email);
console.log('PASSWORD:' + password);

await prisma.$disconnect();
```

- [ ] **Step 2: Correr el script**

Run: `cd App/backend && node _bootstrap-platform-admin.mjs`
Expected: imprime `OK`, `EMAIL:...`, `PASSWORD:...` — la password se entrega al usuario
SOLO en el chat de la sesión, nunca queda en un archivo.

- [ ] **Step 3: Borrar el script**

Run: `rm App/backend/_bootstrap-platform-admin.mjs`

No se commitea nada de este task.

---

### Task 9: Frontend — cliente HTTP de plataforma (token propio)

**Files:**
- Create: `App/frontend/src/lib/api/platform-http.ts`

**Interfaces:**
- Produce: `platformFetch<T>(path: string, init?: RequestInit): Promise<T>`,
  `savePlatformToken(token: string): void`, `getPlatformToken(): string | null`,
  `clearPlatformToken(): void` — usados por Task 10 y 11/12.

- [ ] **Step 1: Implementar**

```ts
import { ApiError } from './http';

/**
 * Cliente HTTP de `app/plataforma/` — Fase 6, Día 20.
 *
 * Análogo a `apiFetchAuth` (`http.ts`), pero para el JWT PROPIO de
 * `AdminPlataforma` (`PlatformAdminGuard`, backend) — no es una sesión de
 * Supabase, así que no puede reusar `createClient().auth.getSession()`
 * (eso es específico del árbol `app/admin`/`app/alumno`, regla 11 de
 * CLAUDE.md: `app/plataforma` es un sistema de identidad completamente
 * aparte). Se guarda en `localStorage` — sin cookies/SSR: este árbol no
 * pasa por `src/proxy.ts` (que solo entiende sesiones de Supabase), la
 * protección de ruta es del lado del cliente (ver `app/plataforma/sedes/page.tsx`).
 */
const TOKEN_KEY = 'sige_platform_admin_token';
const API_URL = process.env.NEXT_PUBLIC_API_URL;

export function savePlatformToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getPlatformToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearPlatformToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export async function platformFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  if (!API_URL) {
    throw new Error(
      'NEXT_PUBLIC_API_URL no está definida (App/frontend/.env.local)',
    );
  }

  const token = getPlatformToken();

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const failure = body as Partial<{ error: string; code: string }> | null;
    throw new ApiError(
      failure?.error ?? 'Error inesperado del servidor',
      failure?.code ?? 'SERVER_ERROR',
      res.status,
    );
  }

  return (body as { data: T }).data;
}
```

- [ ] **Step 2: Commit**

```bash
git add App/frontend/src/lib/api/platform-http.ts
git commit -m "feat(frontend): cliente HTTP de app/plataforma (token propio)"
```

---

### Task 10: Frontend — clientes de `login` y `sedes`

**Files:**
- Create: `App/frontend/src/lib/api/platform-admin.ts`
- Create: `App/frontend/src/lib/api/sedes.ts`

**Interfaces:**
- Consume: `platformFetch` (Task 9)
- Produce: `loginPlatformAdmin(email, password): Promise<{ token: string }>`,
  `listarSedes(): Promise<Sede[]>`, `crearSede(input): Promise<Sede>`,
  `actualizarSede(id, input): Promise<Sede>` — usados por Task 11/12.

- [ ] **Step 1: `platform-admin.ts`**

```ts
import { platformFetch } from './platform-http';

export function loginPlatformAdmin(
  email: string,
  password: string,
): Promise<{ token: string }> {
  return platformFetch<{ token: string }>('/platform-admin/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}
```

- [ ] **Step 2: `sedes.ts`**

```ts
import { platformFetch } from './platform-http';

/** Espejo de `model Sede` (`schema.prisma`) tal como lo devuelve el backend. */
export interface Sede {
  id: string;
  nombre: string;
  direccion: string;
  ubicacionReferencia: string;
  telefono: string;
  costoRenta: string | null; // Prisma Decimal serializa como string en JSON
  createdAt: string;
  updatedAt: string;
}

export interface SedeInput {
  nombre: string;
  direccion: string;
  ubicacionReferencia: string;
  telefono: string;
  costoRenta?: number;
}

export function listarSedes(): Promise<Sede[]> {
  return platformFetch<Sede[]>('/sedes');
}

export function crearSede(input: SedeInput): Promise<Sede> {
  return platformFetch<Sede>('/sedes', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function actualizarSede(
  id: string,
  input: Partial<SedeInput>,
): Promise<Sede> {
  return platformFetch<Sede>(`/sedes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add App/frontend/src/lib/api/platform-admin.ts App/frontend/src/lib/api/sedes.ts
git commit -m "feat(frontend): clientes de platform-admin login y sedes"
```

---

### Task 11: Frontend — `app/plataforma/login/page.tsx`

**Files:**
- Create: `App/frontend/src/app/plataforma/login/page.tsx`

**Interfaces:**
- Consume: `loginPlatformAdmin` (Task 10), `savePlatformToken` (Task 9)

- [ ] **Step 1: Implementar**

Mismo patrón visual que `app/login/page.tsx` (border-navy, font-display), pero guarda el
token propio en vez de `supabase.auth.setSession`:

```tsx
'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { loginPlatformAdmin } from '@/lib/api/platform-admin';
import { ApiError } from '@/lib/api/http';
import { savePlatformToken } from '@/lib/api/platform-http';

const MENSAJES_ERROR: Record<string, string> = {
  UNAUTHORIZED: 'Correo o contraseña incorrectos.',
  RATE_LIMIT_EXCEEDED: 'Demasiados intentos. Espera un minuto e intenta de nuevo.',
  VALIDATION_ERROR: 'Revisa que el correo y la contraseña sean válidos.',
};

export default function PlataformaLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { token } = await loginPlatformAdmin(email, password);
      savePlatformToken(token);
    },
    onSuccess: () => {
      router.push('/plataforma/sedes');
    },
    onError: (err) => {
      const mensaje =
        err instanceof ApiError
          ? (MENSAJES_ERROR[err.code] ?? 'Ocurrió un error inesperado. Intenta de nuevo.')
          : err.message;
      toast.error(mensaje);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.reset();
    mutation.mutate();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm rounded-lg border-l-4 border-navy bg-white px-6 py-8 shadow-sm">
        <p className="font-display text-sm font-semibold tracking-[0.14em] text-navy uppercase">
          SIGE · Plataforma
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-slate">Iniciar sesión</h1>
        <p className="mt-1 text-sm text-slate/60">Panel de administración de plataforma</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate/80">
              Correo
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={mutation.isPending}
              className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none disabled:opacity-50"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate/80">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={mutation.isPending}
              className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none disabled:opacity-50"
            />
          </div>

          <button
            type="submit"
            disabled={mutation.isPending}
            className="w-full rounded-lg bg-navy px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
          >
            {mutation.isPending ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verificación manual**

Con backend y frontend corriendo, navegar a `http://localhost:3000/plataforma/login`,
loguearse con las credenciales del Task 8. Expected: redirige a `/plataforma/sedes`
(Task 12 — si esa página no existe todavía, 404 esperado hasta terminar Task 12; el login
en sí debe mostrar el toast de éxito/redirigir sin error).

- [ ] **Step 3: Commit**

```bash
git add "App/frontend/src/app/plataforma/login/page.tsx"
git commit -m "feat(frontend): login de app/plataforma"
```

---

### Task 12: Frontend — `app/plataforma/sedes/page.tsx` (tabla + alta/edición)

**Files:**
- Create: `App/frontend/src/app/plataforma/sedes/page.tsx`

**Interfaces:**
- Consume: `listarSedes`/`crearSede`/`actualizarSede` (Task 10), `getPlatformToken`/
  `clearPlatformToken` (Task 9)

- [ ] **Step 1: Implementar**

```tsx
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api/http';
import { getPlatformToken, clearPlatformToken } from '@/lib/api/platform-http';
import { listarSedes, crearSede, actualizarSede, type Sede, type SedeInput } from '@/lib/api/sedes';

const FORM_VACIO: SedeInput = {
  nombre: '',
  direccion: '',
  ubicacionReferencia: '',
  telefono: '',
};

export default function PlataformaSedesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SedeInput>(FORM_VACIO);
  const [editandoId, setEditandoId] = useState<string | null>(null);

  // Protección de ruta del lado del cliente — app/plataforma no pasa por
  // src/proxy.ts (regla 11, sistema de identidad aparte, ver Task 9).
  useEffect(() => {
    if (!getPlatformToken()) {
      router.replace('/plataforma/login');
    }
  }, [router]);

  const sedesQuery = useQuery({
    queryKey: ['plataforma', 'sedes'],
    queryFn: listarSedes,
  });

  const crearMutation = useMutation({
    mutationFn: (input: SedeInput) => crearSede(input),
    onSuccess: () => {
      toast.success('Sede creada');
      setForm(FORM_VACIO);
      void queryClient.invalidateQueries({ queryKey: ['plataforma', 'sedes'] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Error al crear la sede');
    },
  });

  const actualizarMutation = useMutation({
    mutationFn: (vars: { id: string; input: SedeInput }) =>
      actualizarSede(vars.id, vars.input),
    onSuccess: () => {
      toast.success('Sede actualizada');
      setForm(FORM_VACIO);
      setEditandoId(null);
      void queryClient.invalidateQueries({ queryKey: ['plataforma', 'sedes'] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Error al actualizar la sede');
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (editandoId) {
      actualizarMutation.mutate({ id: editandoId, input: form });
    } else {
      crearMutation.mutate(form);
    }
  }

  function iniciarEdicion(sede: Sede) {
    setEditandoId(sede.id);
    setForm({
      nombre: sede.nombre,
      direccion: sede.direccion,
      ubicacionReferencia: sede.ubicacionReferencia,
      telefono: sede.telefono,
      costoRenta: sede.costoRenta ? Number(sede.costoRenta) : undefined,
    });
  }

  function cerrarSesion() {
    clearPlatformToken();
    router.push('/plataforma/login');
  }

  const guardando = crearMutation.isPending || actualizarMutation.isPending;

  return (
    <main className="mx-auto max-w-4xl p-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-display text-sm font-semibold tracking-[0.14em] text-navy uppercase">
            SIGE · Plataforma
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-slate">Sedes</h1>
        </div>
        <button
          onClick={cerrarSesion}
          className="text-sm text-slate/60 hover:text-navy"
        >
          Cerrar sesión
        </button>
      </div>

      <form
        onSubmit={handleSubmit}
        className="mt-6 space-y-4 rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm"
      >
        <h2 className="font-display text-lg font-semibold text-slate">
          {editandoId ? 'Editar sede' : 'Nueva sede'}
        </h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate/80">Nombre</label>
            <input
              required
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              disabled={guardando}
              className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate/80">Teléfono</label>
            <input
              required
              value={form.telefono}
              onChange={(e) => setForm({ ...form, telefono: e.target.value })}
              disabled={guardando}
              className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate/80">Dirección</label>
            <input
              required
              value={form.direccion}
              onChange={(e) => setForm({ ...form, direccion: e.target.value })}
              disabled={guardando}
              className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate/80">
              Referencia de ubicación
            </label>
            <input
              required
              value={form.ubicacionReferencia}
              onChange={(e) => setForm({ ...form, ubicacionReferencia: e.target.value })}
              disabled={guardando}
              className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={guardando}
            className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : editandoId ? 'Guardar cambios' : 'Crear sede'}
          </button>
          {editandoId && (
            <button
              type="button"
              onClick={() => {
                setEditandoId(null);
                setForm(FORM_VACIO);
              }}
              className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30"
            >
              Cancelar
            </button>
          )}
        </div>
      </form>

      <div className="mt-8 overflow-x-auto rounded-lg border-l-4 border-navy bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-mist text-left text-slate/60">
              <th className="px-4 py-3 font-medium">Nombre</th>
              <th className="px-4 py-3 font-medium">Dirección</th>
              <th className="px-4 py-3 font-medium">Teléfono</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {sedesQuery.isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate/60">
                  Cargando…
                </td>
              </tr>
            )}
            {sedesQuery.data?.map((sede) => (
              <tr key={sede.id} className="border-b border-mist last:border-0">
                <td className="px-4 py-3 text-slate">{sede.nombre}</td>
                <td className="px-4 py-3 text-slate/80">{sede.direccion}</td>
                <td className="px-4 py-3 text-slate/80">{sede.telefono}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => iniciarEdicion(sede)}
                    className="text-navy hover:underline"
                  >
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verificación manual de punta a punta**

1. Backend y frontend corriendo (`localhost:3001`/`3000`).
2. Ir a `http://localhost:3000/plataforma/login`, loguearse con credenciales del Task 8.
3. En `/plataforma/sedes`: llenar el formulario, crear una sede. Expected: aparece en la
   tabla sin recargar (React Query invalida la query).
4. Click "Editar" en la sede recién creada, cambiar el teléfono, guardar. Expected: la
   tabla refleja el cambio.
5. Refrescar la página (`F5`). Expected: sigue logueado (token persiste en localStorage),
   la sede sigue en la tabla.
6. Sin token (borrar `localStorage` o abrir en incógnito), ir directo a
   `/plataforma/sedes`. Expected: redirige a `/plataforma/login`.

- [ ] **Step 3: Commit**

```bash
git add "App/frontend/src/app/plataforma/sedes/page.tsx"
git commit -m "feat(frontend): tabla + alta/edición de sedes (app/plataforma)"
```

---

## Self-Review (completado por el autor del plan)

- **Spec coverage**: Task 1 → sección 1 del spec (schema+RLS). Task 2-4 → sección 2
  (identidad/auth). Task 5 → sección 2 (`login`, `POST /platform-admin` de alta
  explícitamente excluido, ver Global Constraints). Task 6 → sección 3
  (POST/GET/PATCH /sedes). Task 7 → cierre de documentación (convención del proyecto,
  no estaba en el spec pero es parte de "cerrar un entregable" del `CLAUDE.md` raíz).
  Task 8 → sección 5 (bootstrap). Task 9-12 → sección 4 (frontend). Dashboard cross-sede
  y "entrar a administrar sede X" quedan fuera, como dice el spec.
- **Placeholder scan**: sin TBD/TODO — todo el código de cada step está completo.
- **Type consistency**: `SedeInput`/`Sede` (Task 10) usados igual en Task 11/12.
  `PlatformAdminJwtClaims` (Task 3) consumido igual en Task 4/5/6 (`sub`/`email`).
  `crear`/`actualizar`/`listar` de `SedesService` (Task 6) llamados con esos nombres
  exactos desde `sedes.controller.ts`.
