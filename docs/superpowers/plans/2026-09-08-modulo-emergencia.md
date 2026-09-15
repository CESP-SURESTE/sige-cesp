# Módulo de emergencia — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar al personal administrativo de una sede, durante una emergencia física, (a) un botón de pánico que muestra los teléfonos de emergencia locales de su sede y (b) un buscador cross-rol que saca al instante el tipo de sangre, alergias, padecimientos, medicamentos y contactos de emergencia de cualquier integrante de la sede, dejando rastro de auditoría al abrir un expediente.

**Architecture:** Módulo backend nuevo y aislado `EmergenciaModule` (`src/emergencia/`), que NO toca `personas.service.ts`. Una tabla nueva `TelefonoEmergenciaSede` con RLS por sede. Frontend todo bajo `app/admin/` + `components/admin/` (regla 11): un botón de pánico fijo en el shell y una página `app/admin/emergencia/`.

**Tech Stack:** NestJS + Prisma 6.x + PostgreSQL (Supabase) en el backend; Next.js 16 + React Query + Tailwind + `lucide-react` en el frontend. e2e con Jest + supertest + `jose` (JWT de prueba). El frontend no tiene test runner — su gate es `pnpm build` + `pnpm lint` + verificación manual en navegador.

## Global Constraints

- `sedeId` SIEMPRE de `@SedeActual()` (JWT) — nunca de body, query ni path (regla 2 de `CLAUDE.md`).
- Todos los endpoints bajo `@UseGuards(SedeGuard, RolesGuard)` a nivel de clase (SedeGuard primero, invariante de composición de `RolesGuard`) + `@Roles(RolUsuario.ADMINISTRATIVO)` por método. Sin jerarquía de `nivelPermiso` (mismo criterio que Carreras/Salones/Grupos).
- Contrato de API: éxito `{ data: ... }`; error `{ error: "mensaje", code: "TIPO" }`. JSON en camelCase, fechas ISO 8601 (`YYYY-MM-DD`).
- **Sin códigos de error de dominio nuevos** — reusar `VALIDATION_ERROR` (400) y `NOT_FOUND` (404). `UNAUTHORIZED` / `ROL_NO_AUTORIZADO` los aportan los guards.
- Regla 12: todo `catch` hace `console.error('[Clase.metodo] ...:', err)` con el error completo ANTES de responder o re-lanzar, backend y frontend.
- Regla 14: los e2e limpian de verdad en `afterAll`, acotados a los `id`s que la corrida creó — NUNCA por patrón de nombre/email (ese tipo de limpieza amplia ya causó un bug real en el Día 24).
- Prisma 6.x — NO subir a 7. `prisma migrate dev` está roto en el repo (`P3006`, choque Prisma+Supabase con la shadow DB): las migraciones se escriben a mano y se aplican con `npx prisma migrate deploy`. Revisar que ningún cambio salga como DROP+ADD.
- El backend corre con el rol `postgres` (BYPASSRLS) — el aislamiento por sede efectivo es el filtro explícito `where` en cada query del service, NO la RLS. La policy RLS se agrega igual como última línea de defensa.
- Regla 11: el árbol `app/admin/` no importa nada de `app/alumno/` ni `app/maestro/`. Helpers genéricos dentro de `components/admin/` sí se comparten.
- No agregar dependencias nuevas — `lucide-react` y `motion` ya están instalados; todo lo demás ya está.

---

## File Structure

**Backend (`App/backend/`)**

| Archivo | Responsabilidad |
|---|---|
| `prisma/schema.prisma` *(modificar)* | Modelo `TelefonoEmergenciaSede`; valor `CONSULTA_EMERGENCIA` en `enum AccionAuditoria`; relación inversa en `model Sede` |
| `prisma/migrations/<ts>_accion_auditoria_consulta_emergencia/migration.sql` *(crear)* | `ALTER TYPE "AccionAuditoria" ADD VALUE 'CONSULTA_EMERGENCIA';` — solo |
| `prisma/migrations/<ts>_telefonos_emergencia_sede/migration.sql` *(crear)* | `CREATE TABLE` + FK + índice + RLS enable + policy |
| `src/emergencia/emergencia.module.ts` *(crear)* | Wiring del módulo |
| `src/emergencia/emergencia.controller.ts` *(crear)* | 6 rutas HTTP, guards, extracción de `@SedeActual()` / `@ActorUsuarioId()` |
| `src/emergencia/emergencia.service.ts` *(crear)* | Lógica: CRUD de teléfonos, `buscar`, `obtenerExpediente` (+ auditoría) |
| `src/emergencia/emergencia.util.ts` *(crear)* | Funciones puras: `nombreCompleto`, `compararPorApellidos`, `hayCambiosRealesTelefono`, `calcularEdad` |
| `src/emergencia/emergencia.util.spec.ts` *(crear)* | Unit test de las funciones puras |
| `src/emergencia/dto/crear-telefono.dto.ts` *(crear)* | `{ etiqueta, telefono }` requeridos |
| `src/emergencia/dto/actualizar-telefono.dto.ts` *(crear)* | `{ etiqueta?, telefono? }` opcionales |
| `src/emergencia/dto/buscar-emergencia.query.dto.ts` *(crear)* | `{ q, limit? }` |
| `src/app.module.ts` *(modificar)* | Registrar `EmergenciaModule` |
| `test/emergencia.e2e-spec.ts` *(crear)* | e2e de las 6 rutas + verificación del `RegistroAuditoria` |

**Frontend (`App/frontend/src/`)**

| Archivo | Responsabilidad |
|---|---|
| `lib/api/emergencia.ts` *(crear)* | Tipos espejo + funciones de fetch de las 6 rutas |
| `components/admin/ui/shell/icons.tsx` *(modificar)* | `IconEmergencia` (SVG inline, mismo estilo que los demás) |
| `components/admin/ui/shell/PanicoButton.tsx` *(crear)* | Botón rojo del topbar + modal con los teléfonos |
| `components/admin/ui/shell/AdminShell.tsx` *(modificar)* | Montar `<PanicoButton />` en el `Topbar` |
| `components/admin/ui/shell/Sidebar.tsx` *(modificar)* | Item de navegación "Emergencia" |
| `app/admin/emergencia/page.tsx` *(crear)* | Página: buscador + panel de expediente + sección de teléfonos |
| `app/admin/emergencia/ExpedientePanel.tsx` *(crear)* | Render del expediente (identidad + médico + contactos) |
| `app/admin/emergencia/TelefonoModal.tsx` *(crear)* | Modal único alta/edición de teléfono |
| `app/admin/emergencia/ConfirmarEliminarTelefonoModal.tsx` *(crear)* | Modal de confirmación de borrado |

---

## Task 1: Modelo de datos y migraciones

**Files:**
- Modify: `App/backend/prisma/schema.prisma`
- Create: `App/backend/prisma/migrations/<timestamp>_accion_auditoria_consulta_emergencia/migration.sql`
- Create: `App/backend/prisma/migrations/<timestamp>_telefonos_emergencia_sede/migration.sql`

**Interfaces:**
- Produces: modelo Prisma `TelefonoEmergenciaSede` con campos `id: string`, `sedeId: string`, `etiqueta: string`, `telefono: string`, `orden: number`, `createdAt: Date`, `updatedAt: Date`. Enum `AccionAuditoria` gana el miembro `CONSULTA_EMERGENCIA`. Ambos disponibles en `@prisma/client` tras `prisma generate`.

- [ ] **Step 1: Agregar el modelo y el valor de enum al schema**

En `App/backend/prisma/schema.prisma`:

1. En `enum AccionAuditoria` (está cerca de la línea 75), agregar `CONSULTA_EMERGENCIA` como último miembro:

```prisma
enum AccionAuditoria {
  ALTA
  BAJA
  EDICION
  CAMBIO_PERMISO
  CAMBIO_ESTATUS
  ELIMINACION
  CONSULTA_EMERGENCIA
}
```

2. En `model Sede` (línea ~159), agregar la relación inversa junto a las demás (`avisos`, `eventosCalendario`, etc.):

```prisma
  telefonosEmergencia TelefonoEmergenciaSede[]
```

3. Agregar el modelo nuevo justo después de `model Salon` (o donde encaje temáticamente, cerca de `Sede`):

```prisma
model TelefonoEmergenciaSede {
  id        String   @id @default(uuid())
  sedeId    String   @map("sede_id")
  sede      Sede     @relation(fields: [sedeId], references: [id], onDelete: Cascade)
  etiqueta  String
  telefono  String
  orden     Int
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([sedeId])
  @@map("telefonos_emergencia_sede")
}
```

- [ ] **Step 2: Formatear y validar el schema**

Run: `cd App/backend && npx prisma format && npx prisma validate`
Expected: "The schema at prisma\schema.prisma is valid 🚀". `prisma format` puede reordenar alineación de columnas — es esperado.

- [ ] **Step 3: Escribir la migración del enum (archivo aislado)**

Crear `App/backend/prisma/migrations/<timestamp>_accion_auditoria_consulta_emergencia/migration.sql` con `<timestamp>` en formato `YYYYMMDDHHMMSS` posterior a `20260907160000`. Contenido completo:

```sql
-- AlterEnum
ALTER TYPE "AccionAuditoria" ADD VALUE 'CONSULTA_EMERGENCIA';
```

Va SOLO en su propio archivo: Postgres no permite usar un valor de enum recién agregado dentro de la misma transacción en que se agregó, y así un rollback parcial nunca deja el enum a medias. Precedente idéntico: `prisma/migrations/20260902183339_evento_nuevo_tipo_notificacion/migration.sql`.

- [ ] **Step 4: Escribir la migración de la tabla**

Crear `App/backend/prisma/migrations/<timestamp+1s>_telefonos_emergencia_sede/migration.sql` (timestamp posterior al del Step 3). Contenido completo (patrón calcado de `20260903125735_avisos/migration.sql`):

```sql
-- CreateTable
CREATE TABLE "telefonos_emergencia_sede" (
    "id" TEXT NOT NULL,
    "sede_id" TEXT NOT NULL,
    "etiqueta" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telefonos_emergencia_sede_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "telefonos_emergencia_sede_sede_id_idx" ON "telefonos_emergencia_sede"("sede_id");

-- AddForeignKey
ALTER TABLE "telefonos_emergencia_sede" ADD CONSTRAINT "telefonos_emergencia_sede_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sedes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- TELEFONOS DE EMERGENCIA POR SEDE (sede_id directo)
-- ============================================================
ALTER TABLE "telefonos_emergencia_sede" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "telefonos_emergencia_sede" TO authenticated;

CREATE POLICY "sede_isolation_telefonos_emergencia_sede" ON "telefonos_emergencia_sede"
  FOR ALL
  USING (sede_id = public.current_sede_id())
  WITH CHECK (sede_id = public.current_sede_id());
```

Nota: la FK usa `ON DELETE CASCADE` (a diferencia de `avisos`, que usa `RESTRICT`) — un teléfono de emergencia es config desechable, si se borra la sede se van con ella. Coincide con `onDelete: Cascade` del schema.

- [ ] **Step 5: Aplicar las migraciones**

Run: `cd App/backend && npx prisma migrate deploy`
Expected: "2 migrations found ... Applying migration ... The following migration(s) have been applied". Si `migrate deploy` reporta que la DB ya tiene cambios sin conocer estas migraciones, revisar `npx prisma migrate status`.

- [ ] **Step 6: Regenerar el cliente Prisma**

Run: `cd App/backend && npx prisma generate`
Expected: "Generated Prisma Client". Verificar que compila: `npx tsc --noEmit -p tsconfig.json` no debe reportar errores nuevos por `TelefonoEmergenciaSede` / `AccionAuditoria.CONSULTA_EMERGENCIA`.

- [ ] **Step 7: Commit**

```bash
cd App/backend
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(backend): modelo TelefonoEmergenciaSede + AccionAuditoria.CONSULTA_EMERGENCIA"
```

---

## Task 2: Backend — CRUD de teléfonos de emergencia

**Files:**
- Create: `App/backend/src/emergencia/emergencia.module.ts`
- Create: `App/backend/src/emergencia/emergencia.controller.ts`
- Create: `App/backend/src/emergencia/emergencia.service.ts`
- Create: `App/backend/src/emergencia/emergencia.util.ts`
- Create: `App/backend/src/emergencia/emergencia.util.spec.ts`
- Create: `App/backend/src/emergencia/dto/crear-telefono.dto.ts`
- Create: `App/backend/src/emergencia/dto/actualizar-telefono.dto.ts`
- Modify: `App/backend/src/app.module.ts`
- Create: `App/backend/test/emergencia.e2e-spec.ts` (bloque de teléfonos)

**Interfaces:**
- Consumes: `TelefonoEmergenciaSede`, `AccionAuditoria` de `@prisma/client` (Task 1). `PrismaService` de `../prisma/prisma.service`. Decoradores/guards de `../common/` (`SedeGuard`, `RolesGuard`, `@Roles`, `@SedeActual`, `@ActorUsuarioId`) — uso idéntico a `src/salones/salones.controller.ts`.
- Produces:
  - `EmergenciaService.listarTelefonos(sedeId: string): Promise<TelefonoEmergenciaSede[]>`
  - `EmergenciaService.crearTelefono(dto: CrearTelefonoDto, sedeId: string, actorUsuarioId: string): Promise<TelefonoEmergenciaSede>`
  - `EmergenciaService.actualizarTelefono(id: string, dto: ActualizarTelefonoDto, sedeId: string, actorUsuarioId: string): Promise<TelefonoEmergenciaSede>`
  - `EmergenciaService.eliminarTelefono(id: string, sedeId: string, actorUsuarioId: string): Promise<{ ok: true }>`
  - `emergencia.util.ts` exporta `hayCambiosRealesTelefono(dto, existente): boolean`
  - Rutas: `GET/POST/PATCH/DELETE /emergencia/telefonos[/:id]`

- [ ] **Step 1: Escribir el e2e de CRUD de teléfonos (falla)**

Crear `App/backend/test/emergencia.e2e-spec.ts`. Copiar el andamiaje de `test/salones.e2e-spec.ts` (imports, `firmarToken`, `beforeAll` que arranca la app con `SEDE_GUARD_ENV_OVERRIDE`, resolución de `sedeMeridaId`/`sedeValladolidId` y del actor admin `ana.canul@cesp-merida.edu.mx`). Estructura de este primer bloque:

```ts
describe('EmergenciaController — /emergencia/telefonos (e2e)', () => {
  // ... andamiaje idéntico a salones.e2e-spec.ts ...
  const telefonoIdsCreados: string[] = [];

  afterAll(async () => {
    await prisma.registroAuditoria.deleteMany({
      where: { entidad: 'TelefonoEmergenciaSede', entidadId: { in: telefonoIdsCreados } },
    });
    await prisma.telefonoEmergenciaSede.deleteMany({
      where: { id: { in: telefonoIdsCreados } },
    });
    await app.close();
  });

  it('POST /emergencia/telefonos crea con orden incremental y audita ALTA', async () => {
    const token = await firmarToken({ sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO });
    const r1 = await request(app.getHttpServer())
      .post('/emergencia/telefonos')
      .set('Authorization', `Bearer ${token}`)
      .send({ etiqueta: 'Cruz Roja E2E', telefono: '911' })
      .expect(201);
    const r2 = await request(app.getHttpServer())
      .post('/emergencia/telefonos')
      .set('Authorization', `Bearer ${token}`)
      .send({ etiqueta: 'Bomberos E2E', telefono: '(986) 863 00 00' })
      .expect(201);
    telefonoIdsCreados.push(r1.body.data.id, r2.body.data.id);
    expect(r2.body.data.orden).toBeGreaterThan(r1.body.data.orden);

    const auditoria = await prisma.registroAuditoria.findFirst({
      where: { entidad: 'TelefonoEmergenciaSede', entidadId: r1.body.data.id, accion: 'ALTA' },
    });
    expect(auditoria).not.toBeNull();
  });

  it('GET /emergencia/telefonos devuelve solo los de la sede del actor, orden asc', async () => {
    // crea uno en Valladolid vía prisma directo (push a telefonoIdsCreados),
    // luego GET con token de Mérida y verifica que NO aparece
  });

  it('PATCH /emergencia/telefonos/:id de otra sede → 404', async () => { /* ... */ });

  it('PATCH vacío {} es válido y responde 200 sin auditar', async () => { /* ... */ });

  it('DELETE /emergencia/telefonos/:id borra de verdad y audita ELIMINACION', async () => { /* ... */ });

  it('POST con etiqueta vacía → 400 VALIDATION_ERROR', async () => { /* ... */ });
});
```

- [ ] **Step 2: Correr el e2e para verlo fallar**

Run: `cd App/backend && npx jest --config test/jest-e2e.json emergencia --runInBand`
Expected: FAIL — `Cannot POST /emergencia/telefonos` (404, la ruta no existe todavía).

- [ ] **Step 3: Crear los DTOs**

`src/emergencia/dto/crear-telefono.dto.ts`:

```ts
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * `POST /emergencia/telefonos` — módulo de emergencia (2026-09-08). Ambos
 * campos requeridos; `sedeId` NUNCA va acá (regla 2 — sale de `@SedeActual()`
 * en el controller). `orden` lo asigna el service (`max+1` de la sede), el
 * cliente nunca lo manda (regla 1, mismo criterio que `Contacto*.orden`).
 * `telefono` es texto libre — sin validación de formato (admite "911",
 * extensiones, fijos con espacios).
 */
export class CrearTelefonoDto {
  @IsString()
  @IsNotEmpty({ message: 'etiqueta es requerida' })
  etiqueta!: string;

  @IsString()
  @IsNotEmpty({ message: 'telefono es requerido' })
  telefono!: string;
}
```

`src/emergencia/dto/actualizar-telefono.dto.ts`:

```ts
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * `PATCH /emergencia/telefonos/:id` — mismos campos que `CrearTelefonoDto`,
 * ambos opcionales (un `PATCH` vacío `{}` es válido, mismo criterio que
 * `ActualizarSalonDto`). Un campo presente no puede ser vacío.
 */
export class ActualizarTelefonoDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'etiqueta no puede ser vacía' })
  etiqueta?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'telefono no puede ser vacío' })
  telefono?: string;
}
```

- [ ] **Step 4: Crear `emergencia.util.ts` con `hayCambiosRealesTelefono`**

```ts
import type { TelefonoEmergenciaSede } from '@prisma/client';
import type { ActualizarTelefonoDto } from './dto/actualizar-telefono.dto';

/**
 * Compara cada campo presente en el `dto` contra el valor actual — mismo
 * criterio que `hayCambiosReales` de `SalonesService`/`CarrerasService`. Un
 * campo ausente del `dto` (PATCH parcial o vacío) nunca cuenta como cambio.
 */
export function hayCambiosRealesTelefono(
  dto: ActualizarTelefonoDto,
  existente: Pick<TelefonoEmergenciaSede, 'etiqueta' | 'telefono'>,
): boolean {
  const campos = ['etiqueta', 'telefono'] as const;
  for (const campo of campos) {
    if (dto[campo] !== undefined && dto[campo] !== existente[campo]) return true;
  }
  return false;
}
```

- [ ] **Step 5: Crear `emergencia.util.spec.ts`**

```ts
import { hayCambiosRealesTelefono } from './emergencia.util';

describe('hayCambiosRealesTelefono', () => {
  const existente = { etiqueta: 'Cruz Roja', telefono: '911' };

  it('PATCH vacío → false', () => {
    expect(hayCambiosRealesTelefono({}, existente)).toBe(false);
  });
  it('mismo valor → false', () => {
    expect(hayCambiosRealesTelefono({ telefono: '911' }, existente)).toBe(false);
  });
  it('valor distinto → true', () => {
    expect(hayCambiosRealesTelefono({ telefono: '065' }, existente)).toBe(true);
  });
});
```

Run: `cd App/backend && npx jest emergencia.util --runInBand`
Expected: 3 passing.

- [ ] **Step 6: Crear el service (métodos de teléfonos)**

`src/emergencia/emergencia.service.ts` — primera versión, solo teléfonos. Calcar la forma de `src/salones/salones.service.ts` (transacción + `registroAuditoria.create` en la misma tx, `console.error` en cada catch, `findFirst({ id, sedeId })` para verificar pertenencia a la sede):

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { AccionAuditoria, type TelefonoEmergenciaSede } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CrearTelefonoDto } from './dto/crear-telefono.dto';
import type { ActualizarTelefonoDto } from './dto/actualizar-telefono.dto';
import { hayCambiosRealesTelefono } from './emergencia.util';

@Injectable()
export class EmergenciaService {
  constructor(private readonly prisma: PrismaService) {}

  async listarTelefonos(sedeId: string): Promise<TelefonoEmergenciaSede[]> {
    try {
      return await this.prisma.telefonoEmergenciaSede.findMany({
        where: { sedeId },
        orderBy: { orden: 'asc' },
      });
    } catch (err) {
      console.error('[EmergenciaService.listarTelefonos] error inesperado:', err);
      throw err;
    }
  }

  async crearTelefono(
    dto: CrearTelefonoDto,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<TelefonoEmergenciaSede> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const agg = await tx.telefonoEmergenciaSede.aggregate({
          where: { sedeId },
          _max: { orden: true },
        });
        const orden = (agg._max.orden ?? 0) + 1;

        const telefono = await tx.telefonoEmergenciaSede.create({
          data: { sedeId, etiqueta: dto.etiqueta, telefono: dto.telefono, orden },
        });

        await tx.registroAuditoria.create({
          data: {
            usuarioId: actorUsuarioId,
            sedeId,
            accion: AccionAuditoria.ALTA,
            entidad: 'TelefonoEmergenciaSede',
            entidadId: telefono.id,
            detalle: { etiqueta: telefono.etiqueta, telefono: telefono.telefono },
          },
        });

        return telefono;
      });
    } catch (err) {
      console.error('[EmergenciaService.crearTelefono] error inesperado:', err);
      throw err;
    }
  }

  async actualizarTelefono(
    id: string,
    dto: ActualizarTelefonoDto,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<TelefonoEmergenciaSede> {
    const existente = await this.prisma.telefonoEmergenciaSede.findFirst({
      where: { id, sedeId },
    });
    if (!existente) {
      throw new NotFoundException({
        error: 'Teléfono de emergencia no encontrado en tu sede',
        code: 'NOT_FOUND',
      });
    }

    const registrarAuditoria = hayCambiosRealesTelefono(dto, existente);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const telefono = await tx.telefonoEmergenciaSede.update({
          where: { id },
          data: { etiqueta: dto.etiqueta, telefono: dto.telefono },
        });

        if (registrarAuditoria) {
          await tx.registroAuditoria.create({
            data: {
              usuarioId: actorUsuarioId,
              sedeId,
              accion: AccionAuditoria.EDICION,
              entidad: 'TelefonoEmergenciaSede',
              entidadId: telefono.id,
              detalle: { etiqueta: telefono.etiqueta, telefono: telefono.telefono },
            },
          });
        }

        return telefono;
      });
    } catch (err) {
      console.error('[EmergenciaService.actualizarTelefono] error inesperado:', err);
      throw err;
    }
  }

  async eliminarTelefono(
    id: string,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<{ ok: true }> {
    const existente = await this.prisma.telefonoEmergenciaSede.findFirst({
      where: { id, sedeId },
    });
    if (!existente) {
      throw new NotFoundException({
        error: 'Teléfono de emergencia no encontrado en tu sede',
        code: 'NOT_FOUND',
      });
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.registroAuditoria.create({
          data: {
            usuarioId: actorUsuarioId,
            sedeId,
            accion: AccionAuditoria.ELIMINACION,
            entidad: 'TelefonoEmergenciaSede',
            entidadId: existente.id,
            detalle: { etiqueta: existente.etiqueta, telefono: existente.telefono },
          },
        });
        await tx.telefonoEmergenciaSede.delete({ where: { id } });
      });
    } catch (err) {
      console.error('[EmergenciaService.eliminarTelefono] error inesperado:', err);
      throw err;
    }

    return { ok: true as const };
  }
}
```

- [ ] **Step 7: Crear el controller (rutas de teléfonos)**

`src/emergencia/emergencia.controller.ts` — calcar guards/decoradores de `src/salones/salones.controller.ts`:

```ts
import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import { RolUsuario } from '@prisma/client';
import { ActorUsuarioId } from '../common/decorators/actor-usuario-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SedeActual } from '../common/decorators/sede-actual.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { SedeGuard } from '../common/guards/sede.guard';
import { EmergenciaService } from './emergencia.service';
import { CrearTelefonoDto } from './dto/crear-telefono.dto';
import { ActualizarTelefonoDto } from './dto/actualizar-telefono.dto';

@Controller('emergencia')
@UseGuards(SedeGuard, RolesGuard)
export class EmergenciaController {
  constructor(private readonly emergenciaService: EmergenciaService) {}

  @Get('telefonos')
  @Roles(RolUsuario.ADMINISTRATIVO)
  async listarTelefonos(@SedeActual() sedeId: string) {
    const data = await this.emergenciaService.listarTelefonos(sedeId);
    return { data };
  }

  @Post('telefonos')
  @HttpCode(201)
  @Roles(RolUsuario.ADMINISTRATIVO)
  async crearTelefono(
    @Body() body: CrearTelefonoDto,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    const data = await this.emergenciaService.crearTelefono(body, sedeId, actorUsuarioId);
    return { data };
  }

  @Patch('telefonos/:id')
  @Roles(RolUsuario.ADMINISTRATIVO)
  async actualizarTelefono(
    @Param('id') id: string,
    @Body() body: ActualizarTelefonoDto,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    const data = await this.emergenciaService.actualizarTelefono(id, body, sedeId, actorUsuarioId);
    return { data };
  }

  @Delete('telefonos/:id')
  @Roles(RolUsuario.ADMINISTRATIVO)
  async eliminarTelefono(
    @Param('id') id: string,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    const data = await this.emergenciaService.eliminarTelefono(id, sedeId, actorUsuarioId);
    return { data };
  }
}
```

- [ ] **Step 8: Crear el módulo y registrarlo**

`src/emergencia/emergencia.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { EmergenciaController } from './emergencia.controller';
import { EmergenciaService } from './emergencia.service';

@Module({
  controllers: [EmergenciaController],
  providers: [EmergenciaService],
})
export class EmergenciaModule {}
```

En `src/app.module.ts`: agregar `import { EmergenciaModule } from './emergencia/emergencia.module';` y sumarlo al array `imports` (después de `AvisosModule`).

- [ ] **Step 9: Correr el e2e de teléfonos**

Run: `cd App/backend && npx jest --config test/jest-e2e.json emergencia --runInBand`
Expected: PASS — todos los `it` del bloque de teléfonos.

- [ ] **Step 10: Verificar build y suite completa de e2e (no regresiones)**

Run: `cd App/backend && npx nest build && npx jest --config test/jest-e2e.json --runInBand`
Expected: build limpio; suite completa en verde (el total sube por `emergencia.e2e-spec.ts`).

- [ ] **Step 11: Commit**

```bash
cd App/backend
git add src/emergencia src/app.module.ts test/emergencia.e2e-spec.ts
git commit -m "feat(backend): CRUD de telefonos de emergencia por sede (/emergencia/telefonos)"
```

---

## Task 3: Backend — buscador de integrantes y expediente de emergencia

**Files:**
- Modify: `App/backend/src/emergencia/emergencia.service.ts` (agregar `buscar`, `obtenerExpediente`, `cargarExpediente`)
- Modify: `App/backend/src/emergencia/emergencia.util.ts` (agregar `nombreCompleto`, `compararPorApellidos`, `calcularEdad`)
- Modify: `App/backend/src/emergencia/emergencia.util.spec.ts` (tests de las nuevas funciones puras)
- Create: `App/backend/src/emergencia/dto/buscar-emergencia.query.dto.ts`
- Modify: `App/backend/src/emergencia/emergencia.controller.ts` (2 rutas nuevas)
- Modify: `App/backend/test/emergencia.e2e-spec.ts` (bloques de `buscar` y `expediente`)

**Interfaces:**
- Consumes: modelos `PerfilAlumno`, `PerfilMaestro`, `PerfilAdministrativo`, `PersonalServicios`, `InfoMedica*`, `Contacto*` de `@prisma/client`. `AccionAuditoria.CONSULTA_EMERGENCIA` (Task 1).
- Produces:
  - `type TipoExpediente = 'ALUMNO' | 'MAESTRO' | 'ADMINISTRATIVO' | 'PERSONAL_SERVICIOS'`
  - `interface ResultadoBusqueda { tipo: TipoExpediente; perfilId: string; nombreCompleto: string; referencia: string; activo: boolean }`
  - `interface ExpedienteEmergencia { tipo: TipoExpediente; perfilId: string; identidad: {...}; infoMedica: {...} | null; contactos: [...] }` — shape exacto abajo
  - `EmergenciaService.buscar(sedeId: string, q: string, limit: number): Promise<ResultadoBusqueda[]>`
  - `EmergenciaService.obtenerExpediente(tipo: TipoExpediente, perfilId: string, actorUsuarioId: string, sedeId: string): Promise<ExpedienteEmergencia>`
  - `emergencia.util.ts` exporta `nombreCompleto(p: { nombres: string; apellidoPaterno: string; apellidoMaterno: string | null }): string`, `compararPorApellidos(a, b): number`, `calcularEdad(fechaNacimiento: Date): number`
  - Rutas: `GET /emergencia/buscar?q=&limit=`, `GET /emergencia/expediente/:tipo/:perfilId`

- [ ] **Step 1: Agregar los tests e2e de `buscar` y `expediente` (fallan)**

En `test/emergencia.e2e-spec.ts`, agregar dos `describe` nuevos. Usar las personas ancla ya sembradas de CESP Mérida (ver `prisma/seed-helpers.ts` — `EMAILS_ANCLA`: alumnos, maestros y administrativos por sede) y al menos un `PersonalServicios` de Mérida (buscar uno con `prisma.personalServicios.findFirst({ where: { sede: { nombre: 'CESP Mérida' } } })` en el `beforeAll`). Estos registros NO se crean ni se borran — son fixtures permanentes, no cuentan para el `afterAll`.

```ts
describe('EmergenciaController — GET /emergencia/buscar (e2e)', () => {
  // andamiaje compartido

  it('encuentra por apellido en los 4 roles dentro de la sede', async () => {
    const token = await firmarToken({ sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO });
    const res = await request(app.getHttpServer())
      .get('/emergencia/buscar')
      .query({ q: '<un apellido que exista en Mérida>' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    // al menos un resultado; cada item tiene tipo/perfilId/nombreCompleto/referencia/activo
  });

  it('NO devuelve personas de otra sede', async () => {
    // q = apellido que solo exista en Valladolid → data vacío o sin ese perfil
  });

  it('q de 1 caracter → 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({ sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO });
    await request(app.getHttpServer())
      .get('/emergencia/buscar').query({ q: 'a' })
      .set('Authorization', `Bearer ${token}`)
      .expect(400)
      .expect((r) => expect(r.body.code).toBe('VALIDATION_ERROR'));
  });

  it('respeta limit', async () => {
    // q amplio (ej. una vocal común como parte de "buscar"): con limit=2 → data.length <= 2
  });
});

describe('EmergenciaController — GET /emergencia/expediente/:tipo/:perfilId (e2e)', () => {
  it('devuelve identidad + infoMedica + contactos para un ALUMNO y audita CONSULTA_EMERGENCIA', async () => {
    const token = await firmarToken({ sede_id: sedeMeridaId, rol: RolUsuario.ADMINISTRATIVO });
    // resolver el PerfilAlumno.id de un alumno ancla de Mérida vía prisma
    const res = await request(app.getHttpServer())
      .get(`/emergencia/expediente/ALUMNO/${perfilAlumnoId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.data.tipo).toBe('ALUMNO');
    expect(res.body.data.identidad).toHaveProperty('referencia');
    expect(res.body.data.identidad).toHaveProperty('edad');
    expect(res.body.data).toHaveProperty('infoMedica');
    expect(Array.isArray(res.body.data.contactos)).toBe(true);

    const audit = await prisma.registroAuditoria.findFirst({
      where: {
        accion: 'CONSULTA_EMERGENCIA',
        entidad: 'ExpedienteEmergencia',
        entidadId: perfilAlumnoId,
        usuarioId: actorUsuarioId,
      },
      orderBy: { fecha: 'desc' },
    });
    expect(audit).not.toBeNull();
    auditoriaIdsCreados.push(audit!.id); // limpiar en afterAll
  });

  it('MAESTRO / ADMINISTRATIVO / PERSONAL_SERVICIOS: cada uno responde 200 con su shape', async () => { /* ... */ });

  it('infoMedica es null cuando la persona no tiene fila InfoMedica*', async () => {
    // usar un perfil ancla sin infoMedica, o crear uno mínimo y limpiarlo
  });

  it('expediente de un perfil de otra sede → 404 NOT_FOUND (nunca 403)', async () => { /* ... */ });

  it('tipo inválido → 400 VALIDATION_ERROR', async () => {
    // GET /emergencia/expediente/PROFESOR/<uuid> → 400
  });
});
```

Ampliar el `afterAll` del archivo para borrar también `registroAuditoria` por `id` en `auditoriaIdsCreados` (además del bloque de teléfonos ya existente).

- [ ] **Step 2: Correr para ver fallar**

Run: `cd App/backend && npx jest --config test/jest-e2e.json emergencia --runInBand`
Expected: FAIL en los describe nuevos (`Cannot GET /emergencia/buscar`).

- [ ] **Step 3: Crear el DTO de query de `buscar`**

`src/emergencia/dto/buscar-emergencia.query.dto.ts`:

```ts
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

/**
 * Query de `GET /emergencia/buscar` — módulo de emergencia (2026-09-08).
 * `q` requerido, mínimo 2 caracteres tras `trim` (si no → 400, evita volcar
 * toda la sede). `limit` opcional (default 20 en el controller, máx 50).
 * `@Type(() => Number)` para que el `ValidationPipe` global (`transform: true`,
 * `setup-app.ts`) coercione el query string — mismo patrón que
 * `ListarGruposQueryDto`.
 */
export class BuscarEmergenciaQueryDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2, { message: 'q debe tener al menos 2 caracteres' })
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit debe ser un entero' })
  @Min(1, { message: 'limit debe ser al menos 1' })
  @Max(50, { message: 'limit no puede exceder 50' })
  limit?: number;
}
```

- [ ] **Step 4: Agregar funciones puras a `emergencia.util.ts`**

```ts
type PersonaNombre = {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
};

/** "Nombres ApellidoPaterno ApellidoMaterno", sin espacios sobrantes. */
export function nombreCompleto(p: PersonaNombre): string {
  return [p.nombres, p.apellidoPaterno, p.apellidoMaterno]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join(' ');
}

/** Orden estable por apellido paterno, luego materno, luego nombres (es-MX). */
export function compararPorApellidos(a: PersonaNombre, b: PersonaNombre): number {
  const clave = (p: PersonaNombre) =>
    `${p.apellidoPaterno} ${p.apellidoMaterno ?? ''} ${p.nombres}`.toLocaleLowerCase('es');
  return clave(a).localeCompare(clave(b), 'es');
}

/** Edad en años cumplidos a la fecha de hoy. */
export function calcularEdad(fechaNacimiento: Date): number {
  const hoy = new Date();
  let edad = hoy.getUTCFullYear() - fechaNacimiento.getUTCFullYear();
  const m = hoy.getUTCMonth() - fechaNacimiento.getUTCMonth();
  if (m < 0 || (m === 0 && hoy.getUTCDate() < fechaNacimiento.getUTCDate())) edad--;
  return edad;
}
```

- [ ] **Step 5: Tests de las funciones puras**

Agregar a `emergencia.util.spec.ts`:

```ts
import { nombreCompleto, compararPorApellidos, calcularEdad } from './emergencia.util';

describe('nombreCompleto', () => {
  it('sin apellido materno no deja doble espacio', () => {
    expect(nombreCompleto({ nombres: 'Ana', apellidoPaterno: 'Canul', apellidoMaterno: null }))
      .toBe('Ana Canul');
  });
});

describe('compararPorApellidos', () => {
  it('ordena por apellido paterno', () => {
    const lista = [
      { nombres: 'Z', apellidoPaterno: 'Bravo', apellidoMaterno: null },
      { nombres: 'A', apellidoPaterno: 'Alfa', apellidoMaterno: null },
    ];
    lista.sort(compararPorApellidos);
    expect(lista[0].apellidoPaterno).toBe('Alfa');
  });
});

describe('calcularEdad', () => {
  it('cumpleaños ya pasado este año', () => {
    const nac = new Date(Date.UTC(2000, 0, 1));
    expect(calcularEdad(nac)).toBeGreaterThanOrEqual(25);
  });
});
```

Run: `cd App/backend && npx jest emergencia.util --runInBand`
Expected: todos en verde.

- [ ] **Step 6: Implementar `buscar` en el service**

Agregar a `EmergenciaService` (importar los helpers de `./emergencia.util` y los tipos). `TipoExpediente`, `ResultadoBusqueda` y `ExpedienteEmergencia` se definen y exportan al inicio del archivo del service:

```ts
export type TipoExpediente =
  | 'ALUMNO' | 'MAESTRO' | 'ADMINISTRATIVO' | 'PERSONAL_SERVICIOS';

export interface ResultadoBusqueda {
  tipo: TipoExpediente;
  perfilId: string;
  nombreCompleto: string;
  referencia: string;
  activo: boolean;
}
```

```ts
async buscar(sedeId: string, q: string, limit: number): Promise<ResultadoBusqueda[]> {
  const termino = q.trim();
  const porNombre = [
    { nombres: { contains: termino, mode: 'insensitive' as const } },
    { apellidoPaterno: { contains: termino, mode: 'insensitive' as const } },
    { apellidoMaterno: { contains: termino, mode: 'insensitive' as const } },
  ];

  try {
    const [alumnos, maestros, administrativos, personal] = await Promise.all([
      this.prisma.perfilAlumno.findMany({
        where: {
          usuario: { sedeId },
          OR: [...porNombre, { matricula: { contains: termino, mode: 'insensitive' } }],
        },
        select: {
          id: true, nombres: true, apellidoPaterno: true, apellidoMaterno: true,
          matricula: true, usuario: { select: { activo: true } },
        },
        take: limit,
      }),
      this.prisma.perfilMaestro.findMany({
        where: {
          usuario: { sedeId },
          OR: [...porNombre, { cedulaProfesional: { contains: termino, mode: 'insensitive' } }],
        },
        select: {
          id: true, nombres: true, apellidoPaterno: true, apellidoMaterno: true,
          cedulaProfesional: true, usuario: { select: { activo: true } },
        },
        take: limit,
      }),
      this.prisma.perfilAdministrativo.findMany({
        where: { usuario: { sedeId }, OR: porNombre },
        select: {
          id: true, nombres: true, apellidoPaterno: true, apellidoMaterno: true,
          puesto: true, usuario: { select: { activo: true } },
        },
        take: limit,
      }),
      this.prisma.personalServicios.findMany({
        where: { sedeId, OR: porNombre },
        select: {
          id: true, nombres: true, apellidoPaterno: true, apellidoMaterno: true,
          area: true, estatus: true,
        },
        take: limit,
      }),
    ]);

    const resultados: ResultadoBusqueda[] = [
      ...alumnos.map((a) => ({
        tipo: 'ALUMNO' as const, perfilId: a.id, nombreCompleto: nombreCompleto(a),
        referencia: a.matricula, activo: a.usuario.activo,
      })),
      ...maestros.map((m) => ({
        tipo: 'MAESTRO' as const, perfilId: m.id, nombreCompleto: nombreCompleto(m),
        referencia: m.cedulaProfesional ?? 'Sin cédula', activo: m.usuario.activo,
      })),
      ...administrativos.map((ad) => ({
        tipo: 'ADMINISTRATIVO' as const, perfilId: ad.id, nombreCompleto: nombreCompleto(ad),
        referencia: ad.puesto, activo: ad.usuario.activo,
      })),
      ...personal.map((p) => ({
        tipo: 'PERSONAL_SERVICIOS' as const, perfilId: p.id, nombreCompleto: nombreCompleto(p),
        referencia: p.area, activo: p.estatus === 'ACTIVO',
      })),
    ];

    resultados.sort(compararPorApellidos as (a: ResultadoBusqueda, b: ResultadoBusqueda) => number);
    return resultados.slice(0, limit);
  } catch (err) {
    console.error('[EmergenciaService.buscar] error inesperado:', err);
    throw err;
  }
}
```

Nota: `compararPorApellidos` espera `{ nombres, apellidoPaterno, apellidoMaterno }` — `ResultadoBusqueda` no los tiene. Opción limpia: ordenar ANTES de mapear, o incluir esos 3 campos en `ResultadoBusqueda` como internos y no documentarlos. **Elegir: ordenar cada array por `[apellidoPaterno, apellidoMaterno, nombres]` en la query (`orderBy`), concatenar en orden alumno→maestro→administrativo→personal, y hacer un merge-sort final** con una función `compararResultado` que reciba el `nombreCompleto` ya calculado NO sirve (el nombre completo empieza por `nombres`). En su lugar: agregar `orderBy: [{ apellidoPaterno: 'asc' }, { apellidoMaterno: 'asc' }, { nombres: 'asc' }]` a las 4 queries y quedarse con ese orden por-rol; el merge global final ordena por `nombreCompleto.toLocaleLowerCase('es')` con `localeCompare`. Documentar en el spec del contrato que el orden global es "aproximado por nombre visible" — es un lookup, no un listado formal. Ajustar el bullet del contrato en `CLAUDE.md` en la Task 7.

- [ ] **Step 7: Implementar `obtenerExpediente` + `cargarExpediente`**

Definir el shape exportado:

```ts
export interface ExpedienteEmergencia {
  tipo: TipoExpediente;
  perfilId: string;
  identidad: {
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string | null;
    curp: string | null;
    telefono: string | null;
    correoPersonal: string | null;
    referencia: string;
    fechaNacimiento: string | null; // ISO YYYY-MM-DD, solo ALUMNO
    edad: number | null;            // solo ALUMNO
    activo: boolean;
  };
  infoMedica: {
    tieneCondicionMedica: boolean;
    tipoSangre: string | null;
    padecimiento: string | null;
    medicamentos: string | null;
    alergias: string | null;
    tratamientoAdicional: string | null;
  } | null;
  contactos: Array<{
    nombre: string;
    telefono: string;
    correo: string | null;
    parentesco: string;
    tipo: 'TUTOR' | 'EMERGENCIA' | null; // solo ALUMNO
    orden: number;
  }>;
}
```

```ts
async obtenerExpediente(
  tipo: TipoExpediente,
  perfilId: string,
  actorUsuarioId: string,
  sedeId: string,
): Promise<ExpedienteEmergencia> {
  const expediente = await this.cargarExpediente(tipo, perfilId, sedeId);
  if (!expediente) {
    throw new NotFoundException({
      error: 'Persona no encontrada en tu sede',
      code: 'NOT_FOUND',
    });
  }

  // Auditoría best-effort: una emergencia no se bloquea por un fallo de
  // bitácora. Regla 12: se loguea completo; el expediente se devuelve igual.
  try {
    await this.prisma.registroAuditoria.create({
      data: {
        usuarioId: actorUsuarioId,
        sedeId,
        accion: AccionAuditoria.CONSULTA_EMERGENCIA,
        entidad: 'ExpedienteEmergencia',
        entidadId: perfilId,
        detalle: {
          tipo,
          nombreCompleto: nombreCompleto(expediente.identidad),
        },
      },
    });
  } catch (err) {
    console.error(
      '[EmergenciaService.obtenerExpediente] fallo al auditar la consulta (se devuelve el expediente igual):',
      err,
    );
  }

  return expediente;
}
```

`cargarExpediente` — un `switch (tipo)` con 4 ramas. Cada rama hace `findFirst` con el filtro de sede correcto e incluye `infoMedica` y `contactos` (ordenados). Ejemplo de la rama ALUMNO (las otras 3 son análogas, sin `carrera`/`fechaNacimiento`/`edad`, `curp`/`telefono` no-nullable salvo alumno):

```ts
private async cargarExpediente(
  tipo: TipoExpediente,
  perfilId: string,
  sedeId: string,
): Promise<ExpedienteEmergencia | null> {
  try {
    if (tipo === 'ALUMNO') {
      const a = await this.prisma.perfilAlumno.findFirst({
        where: { id: perfilId, usuario: { sedeId } },
        include: {
          usuario: { select: { activo: true } },
          infoMedica: true,
          contactos: { orderBy: { orden: 'asc' } },
        },
      });
      if (!a) return null;
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
        },
        infoMedica: a.infoMedica
          ? {
              tieneCondicionMedica: a.infoMedica.tieneCondicionMedica,
              tipoSangre: a.infoMedica.tipoSangre,
              padecimiento: a.infoMedica.padecimiento,
              medicamentos: a.infoMedica.medicamentos,
              alergias: a.infoMedica.alergias,
              tratamientoAdicional: a.infoMedica.tratamientoAdicional,
            }
          : null,
        contactos: a.contactos.map((c) => ({
          nombre: c.nombre, telefono: c.telefono, correo: c.correo,
          parentesco: c.parentesco, tipo: c.tipo, orden: c.orden,
        })),
      };
    }

    if (tipo === 'MAESTRO') {
      const m = await this.prisma.perfilMaestro.findFirst({
        where: { id: perfilId, usuario: { sedeId } },
        include: {
          usuario: { select: { activo: true } },
          infoMedica: true,
          contactos: { orderBy: { orden: 'asc' } },
        },
      });
      if (!m) return null;
      return {
        tipo, perfilId: m.id,
        identidad: {
          nombres: m.nombres, apellidoPaterno: m.apellidoPaterno,
          apellidoMaterno: m.apellidoMaterno, curp: m.curp, telefono: m.telefono,
          correoPersonal: m.correoPersonal,
          referencia: m.cedulaProfesional ?? 'Sin cédula',
          fechaNacimiento: null, edad: null, activo: m.usuario.activo,
        },
        infoMedica: m.infoMedica ? { /* mismos 6 campos */ } : null,
        contactos: m.contactos.map((c) => ({
          nombre: c.nombre, telefono: c.telefono, correo: c.correo,
          parentesco: c.parentesco, tipo: null, orden: c.orden,
        })),
      };
    }

    if (tipo === 'ADMINISTRATIVO') {
      const ad = await this.prisma.perfilAdministrativo.findFirst({
        where: { id: perfilId, usuario: { sedeId } },
        include: {
          usuario: { select: { activo: true } },
          infoMedica: true,
          contactos: { orderBy: { orden: 'asc' } },
        },
      });
      if (!ad) return null;
      return {
        tipo, perfilId: ad.id,
        identidad: {
          nombres: ad.nombres, apellidoPaterno: ad.apellidoPaterno,
          apellidoMaterno: ad.apellidoMaterno, curp: ad.curp, telefono: ad.telefono,
          correoPersonal: ad.correoPersonal, referencia: ad.puesto,
          fechaNacimiento: null, edad: null, activo: ad.usuario.activo,
        },
        infoMedica: ad.infoMedica ? { /* mismos 6 campos */ } : null,
        contactos: ad.contactos.map((c) => ({
          nombre: c.nombre, telefono: c.telefono, correo: c.correo,
          parentesco: c.parentesco, tipo: null, orden: c.orden,
        })),
      };
    }

    // PERSONAL_SERVICIOS — sede_id directo, sin Usuario
    const p = await this.prisma.personalServicios.findFirst({
      where: { id: perfilId, sedeId },
      include: {
        infoMedica: true,
        contactos: { orderBy: { orden: 'asc' } },
      },
    });
    if (!p) return null;
    return {
      tipo: 'PERSONAL_SERVICIOS', perfilId: p.id,
      identidad: {
        nombres: p.nombres, apellidoPaterno: p.apellidoPaterno,
        apellidoMaterno: p.apellidoMaterno, curp: p.curp, telefono: p.telefono,
        correoPersonal: p.correoPersonal, referencia: p.area,
        fechaNacimiento: null, edad: null, activo: p.estatus === 'ACTIVO',
      },
      infoMedica: p.infoMedica ? { /* mismos 6 campos */ } : null,
      contactos: p.contactos.map((c) => ({
        nombre: c.nombre, telefono: c.telefono, correo: c.correo,
        parentesco: c.parentesco, tipo: null, orden: c.orden,
      })),
    };
  } catch (err) {
    console.error('[EmergenciaService.cargarExpediente] error inesperado:', err);
    throw err;
  }
}
```

Rellenar los `{ /* mismos 6 campos */ }` con el mismo bloque `tieneCondicionMedica/tipoSangre/padecimiento/medicamentos/alergias/tratamientoAdicional` que la rama ALUMNO. Extraer un helper local `mapInfoMedica(im)` si se prefiere DRY.

- [ ] **Step 8: Agregar las 2 rutas al controller**

En `emergencia.controller.ts`, agregar. Para `:tipo` validar contra el set de 4 — usar un `ParseEnumPipe` no aplica (no es un enum de Prisma). Validar en el controller y lanzar `BadRequestException` con el contrato:

```ts
import { BadRequestException, Query } from '@nestjs/common';
import { BuscarEmergenciaQueryDto } from './dto/buscar-emergencia.query.dto';
import type { TipoExpediente } from './emergencia.service';

const TIPOS_EXPEDIENTE: readonly TipoExpediente[] = [
  'ALUMNO', 'MAESTRO', 'ADMINISTRATIVO', 'PERSONAL_SERVICIOS',
];

// ... dentro de la clase:

@Get('buscar')
@Roles(RolUsuario.ADMINISTRATIVO)
async buscar(@Query() query: BuscarEmergenciaQueryDto, @SedeActual() sedeId: string) {
  const data = await this.emergenciaService.buscar(sedeId, query.q, query.limit ?? 20);
  return { data };
}

@Get('expediente/:tipo/:perfilId')
@Roles(RolUsuario.ADMINISTRATIVO)
async expediente(
  @Param('tipo') tipo: string,
  @Param('perfilId') perfilId: string,
  @SedeActual() sedeId: string,
  @ActorUsuarioId() actorUsuarioId: string,
) {
  if (!TIPOS_EXPEDIENTE.includes(tipo as TipoExpediente)) {
    throw new BadRequestException({
      error: 'tipo debe ser ALUMNO, MAESTRO, ADMINISTRATIVO o PERSONAL_SERVICIOS',
      code: 'VALIDATION_ERROR',
    });
  }
  const data = await this.emergenciaService.obtenerExpediente(
    tipo as TipoExpediente, perfilId, actorUsuarioId, sedeId,
  );
  return { data };
}
```

Cuidado con el orden de rutas: `@Get('buscar')` y `@Get('expediente/:tipo/:perfilId')` no chocan con `@Get('telefonos')`. Ningún `:param` a nivel de `emergencia/` raíz, así que no hay ambigüedad.

- [ ] **Step 9: Correr el e2e de emergencia completo**

Run: `cd App/backend && npx jest --config test/jest-e2e.json emergencia --runInBand`
Expected: PASS — teléfonos + buscar + expediente.

- [ ] **Step 10: Build + suite e2e completa + unit**

Run: `cd App/backend && npx nest build && npx jest --config test/jest-e2e.json --runInBand && npx jest --runInBand`
Expected: build limpio, e2e completa en verde, unit en verde (sube por `emergencia.util.spec.ts`).

- [ ] **Step 11: Commit**

```bash
cd App/backend
git add src/emergencia test/emergencia.e2e-spec.ts
git commit -m "feat(backend): buscador cross-rol de emergencia + expediente con auditoria CONSULTA_EMERGENCIA"
```

---

## Task 4: Frontend — cliente de API y botón de pánico

**Files:**
- Create: `App/frontend/src/lib/api/emergencia.ts`
- Modify: `App/frontend/src/components/admin/ui/shell/icons.tsx`
- Create: `App/frontend/src/components/admin/ui/shell/PanicoButton.tsx`
- Modify: `App/frontend/src/components/admin/ui/shell/AdminShell.tsx`

**Interfaces:**
- Consumes: `apiFetchAuth` de `@/lib/api/http`. Backend rutas `/emergencia/*` (Tasks 2-3). Patrón de `Topbar` en `AdminShell.tsx`.
- Produces:
  - `lib/api/emergencia.ts` exporta: tipos `TelefonoEmergencia`, `ResultadoBusquedaEmergencia`, `ExpedienteEmergencia`, `TipoExpediente`, `CrearTelefonoInput`, `ActualizarTelefonoInput`; funciones `listarTelefonosEmergencia()`, `crearTelefonoEmergencia(input)`, `actualizarTelefonoEmergencia(id, input)`, `eliminarTelefonoEmergencia(id)`, `buscarEmergencia(q, limit?)`, `obtenerExpedienteEmergencia(tipo, perfilId)`.
  - `<PanicoButton />` — componente sin props, se monta en el `Topbar`.

- [ ] **Step 1: Crear `lib/api/emergencia.ts`**

Espejo de los shapes del backend (mismo criterio "mantener en sync a mano" que `lib/api/carreras.ts`):

```ts
import { apiFetchAuth } from './http';

export interface TelefonoEmergencia {
  id: string;
  sedeId: string;
  etiqueta: string;
  telefono: string;
  orden: number;
  createdAt: string;
  updatedAt: string;
}

export type TipoExpediente =
  | 'ALUMNO' | 'MAESTRO' | 'ADMINISTRATIVO' | 'PERSONAL_SERVICIOS';

export interface ResultadoBusquedaEmergencia {
  tipo: TipoExpediente;
  perfilId: string;
  nombreCompleto: string;
  referencia: string;
  activo: boolean;
}

export interface ExpedienteEmergencia {
  tipo: TipoExpediente;
  perfilId: string;
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
  };
  infoMedica: {
    tieneCondicionMedica: boolean;
    tipoSangre: string | null;
    padecimiento: string | null;
    medicamentos: string | null;
    alergias: string | null;
    tratamientoAdicional: string | null;
  } | null;
  contactos: Array<{
    nombre: string;
    telefono: string;
    correo: string | null;
    parentesco: string;
    tipo: 'TUTOR' | 'EMERGENCIA' | null;
    orden: number;
  }>;
}

export interface CrearTelefonoInput {
  etiqueta: string;
  telefono: string;
}
export type ActualizarTelefonoInput = Partial<CrearTelefonoInput>;

export function listarTelefonosEmergencia(): Promise<TelefonoEmergencia[]> {
  return apiFetchAuth<TelefonoEmergencia[]>('/emergencia/telefonos');
}

export function crearTelefonoEmergencia(
  input: CrearTelefonoInput,
): Promise<TelefonoEmergencia> {
  return apiFetchAuth<TelefonoEmergencia>('/emergencia/telefonos', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function actualizarTelefonoEmergencia(
  id: string,
  input: ActualizarTelefonoInput,
): Promise<TelefonoEmergencia> {
  return apiFetchAuth<TelefonoEmergencia>(`/emergencia/telefonos/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function eliminarTelefonoEmergencia(id: string): Promise<{ ok: true }> {
  return apiFetchAuth<{ ok: true }>(`/emergencia/telefonos/${id}`, {
    method: 'DELETE',
  });
}

export function buscarEmergencia(
  q: string,
  limit?: number,
): Promise<ResultadoBusquedaEmergencia[]> {
  const params = new URLSearchParams({ q });
  if (limit !== undefined) params.set('limit', String(limit));
  return apiFetchAuth<ResultadoBusquedaEmergencia[]>(
    `/emergencia/buscar?${params.toString()}`,
  );
}

export function obtenerExpedienteEmergencia(
  tipo: TipoExpediente,
  perfilId: string,
): Promise<ExpedienteEmergencia> {
  return apiFetchAuth<ExpedienteEmergencia>(
    `/emergencia/expediente/${tipo}/${perfilId}`,
  );
}
```

- [ ] **Step 2: Agregar `IconEmergencia` a `icons.tsx`**

En `App/frontend/src/components/admin/ui/shell/icons.tsx`, agregar un ícono con la misma firma que los demás (`{ className }: { className?: string }`, SVG inline `stroke="currentColor"` `fill="none"`, `viewBox="0 0 24 24"`). Usar una cruz médica / signo de alerta:

```tsx
export function IconEmergencia({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2 3 7v6c0 5 3.8 8.5 9 9 5.2-.5 9-4 9-9V7l-9-5Z" />
      <path d="M12 8v6M9 11h6" />
    </svg>
  );
}
```

- [ ] **Step 3: Crear `PanicoButton.tsx`**

`App/frontend/src/components/admin/ui/shell/PanicoButton.tsx` — botón + modal. Fetch con React Query (regla: no `fetch` suelto). El modal NO usa `alert()`/`confirm()`. `tel:` links. Estado local `abierto`. Manejo de error con `console.error` (regla 12) + fallback visible.

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { listarTelefonosEmergencia } from '@/lib/api/emergencia';
import { IconEmergencia } from './icons';

/**
 * Botón de pánico — módulo de emergencia (2026-09-08). Fijo en el topbar del
 * shell admin, visible en cualquier pantalla. Pasivo: solo muestra los
 * teléfonos de emergencia de la sede (911, Cruz Roja local, bomberos,
 * protección civil municipal, hospital). Sin efectos secundarios, sin
 * registro. Cada teléfono es un enlace `tel:` (tap-para-llamar en móvil).
 *
 * Local a `components/admin/ui/shell/` — no se comparte con otros árboles
 * (regla 11). El modal es un overlay propio, mismo patrón visual que
 * `app/admin/salones/ConfirmarEliminarSalonModal.tsx`; no usa diálogos
 * nativos del navegador (bloquean la extensión / la pestaña).
 */
export function PanicoButton() {
  const [abierto, setAbierto] = useState(false);

  const telefonosQuery = useQuery({
    queryKey: ['admin', 'emergencia', 'telefonos'],
    queryFn: async () => {
      try {
        return await listarTelefonosEmergencia();
      } catch (err) {
        console.error('[PanicoButton] Error al listar teléfonos de emergencia:', err);
        throw err;
      }
    },
    enabled: abierto, // solo pega al backend cuando se abre
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label="Teléfonos de emergencia"
        className="flex items-center gap-1.5 rounded-lg bg-crimson px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-crimson/90 focus-visible:ring-2 focus-visible:ring-crimson focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <IconEmergencia className="size-4" />
        <span className="hidden sm:inline">Emergencia</span>
      </button>

      {abierto && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate/40 p-4 pt-16"
          role="dialog"
          aria-modal="true"
          aria-label="Teléfonos de emergencia de la sede"
        >
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-crimson">
                Teléfonos de emergencia
              </h2>
              <button
                type="button"
                onClick={() => setAbierto(false)}
                aria-label="Cerrar"
                className="rounded-lg p-1 text-slate/60 hover:bg-mist/40"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {telefonosQuery.isLoading && (
                <p className="text-sm text-slate/60">Cargando…</p>
              )}
              {telefonosQuery.isError && (
                <p className="text-sm text-crimson">
                  No se pudieron cargar los teléfonos. Intenta de nuevo.
                </p>
              )}
              {telefonosQuery.data?.length === 0 && (
                <p className="text-sm text-slate/70">
                  No hay teléfonos de emergencia configurados. Agrégalos en la
                  sección Emergencia.
                </p>
              )}
              {telefonosQuery.data?.map((t) => (
                <a
                  key={t.id}
                  href={`tel:${t.telefono.replace(/\s+/g, '')}`}
                  className="flex items-center justify-between rounded-lg border border-mist px-4 py-3 transition-colors hover:bg-mist/30"
                >
                  <span className="text-sm font-medium text-slate">{t.etiqueta}</span>
                  <span className="font-display text-lg font-semibold text-navy">
                    {t.telefono}
                  </span>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Montar `<PanicoButton />` en el `Topbar` de `AdminShell.tsx`**

En `App/frontend/src/components/admin/ui/shell/AdminShell.tsx`, importar `PanicoButton` y agregarlo en el `<div>` de la derecha del `Topbar`, ANTES de `<NotificacionesBell />`:

```tsx
      <div className="flex shrink-0 items-center gap-1 justify-self-end">
        <PanicoButton />
        <NotificacionesBell />
        <ProfileDropdown email={email} />
      </div>
```

- [ ] **Step 5: Build + lint**

Run: `cd App/frontend && pnpm build && pnpm lint`
Expected: ambos limpios, sin errores de TS ni de ESLint.

- [ ] **Step 6: Verificación manual**

Con backend `:3001` y frontend `:3000` arriba, logueado como administrativo:
- El botón rojo "Emergencia" aparece en el topbar en todas las pantallas de `/admin/*`.
- Al abrirlo con la sede sin teléfonos → muestra el hint.
- (Se completa después de la Task 6, cuando se puedan cargar teléfonos.)

- [ ] **Step 7: Commit**

```bash
cd App/frontend
git add src/lib/api/emergencia.ts src/components/admin/ui/shell
git commit -m "feat(admin): boton de panico con telefonos de emergencia de la sede"
```

---

## Task 5: Frontend — página de Emergencia: buscador y expediente

**Files:**
- Create: `App/frontend/src/app/admin/emergencia/page.tsx` (buscador + panel; sección de teléfonos se agrega en Task 6)
- Create: `App/frontend/src/app/admin/emergencia/ExpedientePanel.tsx`
- Modify: `App/frontend/src/components/admin/ui/shell/Sidebar.tsx`

**Interfaces:**
- Consumes: `buscarEmergencia`, `obtenerExpedienteEmergencia`, tipos `ResultadoBusquedaEmergencia`/`ExpedienteEmergencia`/`TipoExpediente` de `@/lib/api/emergencia` (Task 4). `IconEmergencia` de `components/admin/ui/shell/icons` (Task 4).
- Produces: ruta `/admin/emergencia` navegable; `<ExpedientePanel expediente={...} />`.

- [ ] **Step 1: Agregar el item "Emergencia" al Sidebar**

En `App/frontend/src/components/admin/ui/shell/Sidebar.tsx`:
- Importar `IconEmergencia` junto a los demás íconos.
- Agregar al array `NAV_PRINCIPAL`, al final (después de Administrativos):

```ts
  {
    href: '/admin/emergencia',
    label: 'Emergencia',
    Icon: IconEmergencia,
    match: 'prefijo',
  },
```

- [ ] **Step 2: Crear `ExpedientePanel.tsx`**

`App/frontend/src/app/admin/emergencia/ExpedientePanel.tsx` — render puro (sin fetch), recibe el `ExpedienteEmergencia`. Bloque de tipo de sangre prominente; secciones médicas; contactos con `tel:`. Labels de `tipoSangre` legibles (`O_POSITIVO` → `O+`).

```tsx
'use client';

import type { ExpedienteEmergencia, TipoExpediente } from '@/lib/api/emergencia';

const TIPO_SANGRE_LABEL: Record<string, string> = {
  A_POSITIVO: 'A+', A_NEGATIVO: 'A−',
  B_POSITIVO: 'B+', B_NEGATIVO: 'B−',
  AB_POSITIVO: 'AB+', AB_NEGATIVO: 'AB−',
  O_POSITIVO: 'O+', O_NEGATIVO: 'O−',
};

const TIPO_ROL_LABEL: Record<TipoExpediente, string> = {
  ALUMNO: 'Alumno',
  MAESTRO: 'Maestro',
  ADMINISTRATIVO: 'Administrativo',
  PERSONAL_SERVICIOS: 'Personal de servicios',
};

export function ExpedientePanel({ expediente }: { expediente: ExpedienteEmergencia }) {
  const { identidad, infoMedica, contactos } = expediente;

  return (
    <div className="space-y-5 rounded-lg border-l-4 border-crimson bg-white p-6 shadow-sm">
      <header>
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
          {TIPO_ROL_LABEL[expediente.tipo]} · {identidad.referencia}
          {identidad.edad !== null && ` · ${identidad.edad} años`}
        </p>
        {identidad.telefono && (
          <p className="mt-1 text-sm text-slate/70">
            Tel. propio:{' '}
            <a href={`tel:${identidad.telefono.replace(/\s+/g, '')}`} className="text-navy hover:underline">
              {identidad.telefono}
            </a>
          </p>
        )}
      </header>

      {/* Tipo de sangre — bloque prominente */}
      <div className="flex items-center gap-4 rounded-lg bg-crimson/5 p-4">
        <span className="text-sm font-medium text-slate/70">Tipo de sangre</span>
        <span className="font-display text-3xl font-bold text-crimson">
          {infoMedica?.tipoSangre ? (TIPO_SANGRE_LABEL[infoMedica.tipoSangre] ?? infoMedica.tipoSangre) : '—'}
        </span>
      </div>

      {/* Info médica */}
      <section>
        <h3 className="font-display text-sm font-semibold tracking-wide text-slate/60 uppercase">
          Información médica
        </h3>
        {infoMedica === null ? (
          <p className="mt-2 text-sm text-slate/60">Sin expediente médico registrado.</p>
        ) : (
          <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            <Campo etiqueta="¿Condición médica?" valor={infoMedica.tieneCondicionMedica ? 'Sí' : 'No'} />
            <Campo etiqueta="Padecimiento" valor={infoMedica.padecimiento} />
            <Campo etiqueta="Medicamentos" valor={infoMedica.medicamentos} />
            <Campo etiqueta="Alergias" valor={infoMedica.alergias} />
            <Campo etiqueta="Tratamiento adicional" valor={infoMedica.tratamientoAdicional} />
          </dl>
        )}
      </section>

      {/* Contactos de emergencia */}
      <section>
        <h3 className="font-display text-sm font-semibold tracking-wide text-slate/60 uppercase">
          Contactos de emergencia
        </h3>
        {contactos.length === 0 ? (
          <p className="mt-2 text-sm text-slate/60">Sin contactos de emergencia registrados.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {contactos.map((c, i) => (
              <li key={i} className="rounded-lg border border-mist px-4 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate">
                    {c.nombre}
                    <span className="ml-2 font-normal text-slate/60">
                      {c.parentesco}{c.tipo ? ` · ${c.tipo === 'TUTOR' ? 'Tutor' : 'Emergencia'}` : ''}
                    </span>
                  </span>
                  <a href={`tel:${c.telefono.replace(/\s+/g, '')}`} className="font-display text-base font-semibold text-navy hover:underline">
                    {c.telefono}
                  </a>
                </div>
                {c.correo && <p className="mt-0.5 text-slate/60">{c.correo}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Campo({ etiqueta, valor }: { etiqueta: string; valor: string | null }) {
  return (
    <div>
      <dt className="text-slate/60">{etiqueta}</dt>
      <dd className="text-slate">{valor?.trim() ? valor : '—'}</dd>
    </div>
  );
}
```

- [ ] **Step 3: Crear `page.tsx` con el buscador**

`App/frontend/src/app/admin/emergencia/page.tsx`:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '@/lib/api/http';
import {
  buscarEmergencia,
  obtenerExpedienteEmergencia,
  type ResultadoBusquedaEmergencia,
} from '@/lib/api/emergencia';
import { ExpedientePanel } from './ExpedientePanel';

const TIPO_CHIP: Record<string, string> = {
  ALUMNO: 'Alumno',
  MAESTRO: 'Maestro',
  ADMINISTRATIVO: 'Administrativo',
  PERSONAL_SERVICIOS: 'Personal de servicios',
};

export default function AdminEmergenciaPage() {
  const [texto, setTexto] = useState('');
  const [seleccion, setSeleccion] = useState<ResultadoBusquedaEmergencia | null>(null);

  const termino = texto.trim();

  const busquedaQuery = useQuery({
    queryKey: ['admin', 'emergencia', 'buscar', termino],
    queryFn: async () => {
      try {
        return await buscarEmergencia(termino);
      } catch (err) {
        console.error('[AdminEmergenciaPage] Error al buscar:', err);
        throw err;
      }
    },
    enabled: termino.length >= 2,
  });

  const expedienteQuery = useQuery({
    queryKey: ['admin', 'emergencia', 'expediente', seleccion?.tipo, seleccion?.perfilId],
    queryFn: async () => {
      if (!seleccion) throw new Error('sin selección');
      try {
        return await obtenerExpedienteEmergencia(seleccion.tipo, seleccion.perfilId);
      } catch (err) {
        console.error('[AdminEmergenciaPage] Error al abrir expediente:', err);
        throw err;
      }
    },
    enabled: seleccion !== null,
  });

  return (
    <div className="space-y-6">
      <div className="rounded-lg border-l-4 border-crimson bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-crimson">Emergencia</h1>
        <p className="mt-1 text-sm text-slate/60">
          Busca a cualquier integrante de tu sede y consulta sus datos médicos y
          contactos de emergencia. Cada consulta queda registrada.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
        {/* Buscador */}
        <div className="space-y-3">
          <input
            type="search"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Nombre, apellido, matrícula o cédula…"
            className="w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none"
          />

          {termino.length > 0 && termino.length < 2 && (
            <p className="text-xs text-slate/50">Escribe al menos 2 letras.</p>
          )}

          <div className="space-y-1">
            {busquedaQuery.isLoading && (
              <p className="text-sm text-slate/60">Buscando…</p>
            )}
            {busquedaQuery.isError && (
              <p className="text-sm text-crimson">
                {busquedaQuery.error instanceof ApiError
                  ? busquedaQuery.error.message
                  : 'No se pudo completar la búsqueda.'}
              </p>
            )}
            {busquedaQuery.data?.length === 0 && (
              <p className="text-sm text-slate/60">Sin resultados.</p>
            )}
            {busquedaQuery.data?.map((r) => (
              <button
                key={`${r.tipo}-${r.perfilId}`}
                onClick={() => setSeleccion(r)}
                className={[
                  'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                  seleccion?.perfilId === r.perfilId && seleccion?.tipo === r.tipo
                    ? 'border-crimson bg-crimson/5'
                    : 'border-mist hover:bg-mist/30',
                ].join(' ')}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate">
                    {r.nombreCompleto}
                    {!r.activo && (
                      <span className="ml-2 text-xs font-normal text-slate/50">Inactivo</span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-slate/60">{r.referencia}</span>
                </span>
                <span className="ml-2 shrink-0 rounded-full bg-mist/60 px-2 py-0.5 text-xs text-slate/70">
                  {TIPO_CHIP[r.tipo]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Panel de expediente */}
        <div>
          {!seleccion && (
            <p className="rounded-lg border border-dashed border-mist p-6 text-sm text-slate/50">
              Selecciona una persona para ver su expediente de emergencia.
            </p>
          )}
          {seleccion && expedienteQuery.isLoading && (
            <p className="text-sm text-slate/60">Cargando expediente…</p>
          )}
          {seleccion && expedienteQuery.isError && (
            <p className="text-sm text-crimson">
              {expedienteQuery.error instanceof ApiError
                ? expedienteQuery.error.message
                : 'No se pudo abrir el expediente.'}
            </p>
          )}
          {expedienteQuery.data && <ExpedientePanel expediente={expedienteQuery.data} />}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Build + lint**

Run: `cd App/frontend && pnpm build && pnpm lint`
Expected: ambos limpios.

- [ ] **Step 5: Verificación manual**

Logueado como administrativo de Mérida:
- "Emergencia" aparece en el sidebar; abre `/admin/emergencia`.
- Escribir 1 letra → hint "Escribe al menos 2 letras", sin request.
- Escribir un apellido real → aparecen resultados de varios roles con su chip.
- Click en un alumno → expediente con edad, tipo de sangre, médico, contactos.
- Click en alguien sin info médica → "Sin expediente médico registrado".
- (Aislamiento cross-sede: cubierto por e2e; verificar con una 2ª sesión si hay credenciales de otra sede.)

- [ ] **Step 6: Commit**

```bash
cd App/frontend
git add src/app/admin/emergencia src/components/admin/ui/shell/Sidebar.tsx
git commit -m "feat(admin): pagina de emergencia con buscador de expedientes"
```

---

## Task 6: Frontend — gestión de teléfonos de emergencia

**Files:**
- Modify: `App/frontend/src/app/admin/emergencia/page.tsx` (agregar la sección de teléfonos)
- Create: `App/frontend/src/app/admin/emergencia/TelefonoModal.tsx`
- Create: `App/frontend/src/app/admin/emergencia/ConfirmarEliminarTelefonoModal.tsx`

**Interfaces:**
- Consumes: `listarTelefonosEmergencia`, `crearTelefonoEmergencia`, `actualizarTelefonoEmergencia`, `eliminarTelefonoEmergencia`, tipo `TelefonoEmergencia` de `@/lib/api/emergencia` (Task 4).
- Produces: sección "Teléfonos de emergencia de la sede" en `/admin/emergencia`, con tabla + `<TelefonoModal>` (alta/edición) + `<ConfirmarEliminarTelefonoModal>`.

- [ ] **Step 1: Crear `TelefonoModal.tsx`**

Modal único alta/edición — mismo patrón que `app/admin/carreras/CarreraModal.tsx` (`telefono: TelefonoEmergencia | null` decide el modo; overlay `fixed inset-0 z-50`; `max-h-[90vh] overflow-y-auto`; botón Cancelar; se limpia al cerrar porque se desmonta). La página es dueña de las mutations; el modal arma el payload y llama `onCrear`/`onEditar`.

```tsx
'use client';

import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { LABEL_CLASS, INPUT_CLASS } from '@/components/admin/ui/persona-alta/estilos';
import type {
  ActualizarTelefonoInput,
  CrearTelefonoInput,
  TelefonoEmergencia,
} from '@/lib/api/emergencia';

interface TelefonoModalProps {
  /** `null` = modo alta. Objeto real = modo edición, prellena. */
  telefono: TelefonoEmergencia | null;
  guardando: boolean;
  onCrear: (payload: CrearTelefonoInput) => void;
  onEditar: (payload: ActualizarTelefonoInput) => void;
  onCancelar: () => void;
}

export function TelefonoModal({
  telefono, guardando, onCrear, onEditar, onCancelar,
}: TelefonoModalProps) {
  const esAlta = telefono === null;
  const [etiqueta, setEtiqueta] = useState(telefono?.etiqueta ?? '');
  const [numero, setNumero] = useState(telefono?.telefono ?? '');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const et = etiqueta.trim();
    const nu = numero.trim();
    if (esAlta) {
      if (!et || !nu) {
        toast.error('Completa la etiqueta y el teléfono.');
        return;
      }
      onCrear({ etiqueta: et, telefono: nu });
      return;
    }
    const payload: ActualizarTelefonoInput = {};
    if (et) payload.etiqueta = et;
    if (nu) payload.telefono = nu;
    onEditar(payload);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-slate">
          {esAlta ? 'Nuevo teléfono de emergencia' : 'Editar teléfono de emergencia'}
        </h2>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="telefono-modal-etiqueta" className={LABEL_CLASS}>
              Etiqueta
            </label>
            <input
              id="telefono-modal-etiqueta"
              type="text"
              required={esAlta}
              disabled={guardando}
              placeholder="Cruz Roja Tizimín"
              className={INPUT_CLASS}
              value={etiqueta}
              onChange={(e) => setEtiqueta(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="telefono-modal-numero" className={LABEL_CLASS}>
              Teléfono
            </label>
            <input
              id="telefono-modal-numero"
              type="text"
              required={esAlta}
              disabled={guardando}
              placeholder="911 · (986) 863 00 00 · ext. 145"
              className={INPUT_CLASS}
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onCancelar}
              disabled={guardando}
              className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
            >
              {guardando ? 'Guardando…' : esAlta ? 'Agregar' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Crear `ConfirmarEliminarTelefonoModal.tsx`**

Copia estructural de `app/admin/salones/ConfirmarEliminarSalonModal.tsx`, adaptada a `TelefonoEmergencia` (muestra `telefono.etiqueta`). Props `{ telefono, onConfirmar, onCancelar, eliminando }`.

- [ ] **Step 3: Agregar la sección de teléfonos a `page.tsx`**

En `app/admin/emergencia/page.tsx`, debajo del grid buscador/expediente, agregar un bloque con `useQuery` (`['admin','emergencia','telefonos']` — misma key que `PanicoButton`, se comparten caché e invalidación) + 3 mutations (`crear`/`actualizar`/`eliminar`), tabla (`etiqueta`, `telefono`, acciones Editar/Eliminar), botón "+ Nuevo teléfono", y el `<TelefonoModal>` / `<ConfirmarEliminarTelefonoModal>` controlados por estado local. En cada `onSuccess`: `toast.success`, cerrar modal, `queryClient.invalidateQueries({ queryKey: ['admin','emergencia','telefonos'] })`. En cada `onError`: `console.error` + `toast.error` (regla 12). Estructura de tabla/estado calcada de `app/admin/carreras/page.tsx` (`EstadoModal` con `{ abierto, telefono }`, `MODAL_CERRADO`).

- [ ] **Step 4: Build + lint**

Run: `cd App/frontend && pnpm build && pnpm lint`
Expected: ambos limpios.

- [ ] **Step 5: Verificación manual (end-to-end del módulo)**

Logueado como administrativo:
- En `/admin/emergencia`, sección de teléfonos: "+ Nuevo teléfono" → modal → agregar "911" y "Cruz Roja". Aparecen en la tabla.
- Editar uno → cambia; Eliminar uno → modal de confirmación → desaparece.
- Abrir el botón de pánico del topbar → lista los teléfonos recién creados, con `tel:` (en móvil/emulación llama).
- Crear un 2º y 3º teléfono → respetan el orden de creación.

- [ ] **Step 6: Commit**

```bash
cd App/frontend
git add src/app/admin/emergencia
git commit -m "feat(admin): CRUD de telefonos de emergencia en la pagina de emergencia"
```

---

## Task 7: Documentación — CLAUDE.md y ESTADO.md

**Files:**
- Modify: `CLAUDE.md` (sección "Contrato de API" + "CRUD por tipo de entidad" + línea de fase)
- Modify: `documentacion_de_agentes/ESTADO.md` (checklist por dominio)

**Interfaces:**
- Consumes: nada de código — refleja lo construido en Tasks 1-6.

- [ ] **Step 1: Agregar el contrato de API a `CLAUDE.md`**

Bajo "Contrato de API", agregar los bullets (texto ya redactado en `docs/superpowers/specs/2026-09-08-modulo-emergencia-design.md`, sección "Contrato de API — texto para `CLAUDE.md` al cerrar"). Incluir explícitamente:
- `GET/POST/PATCH/DELETE /emergencia/telefonos*` — CRUD por sede, `orden` server-side, `DELETE` real, audita ALTA/EDICION/ELIMINACION.
- `GET /emergencia/buscar?q=&limit=` — cross-rol dentro de la sede, `q` ≥ 2, `limit` ≤ 50 (default 20), sin paginar, orden global aproximado por nombre visible.
- `GET /emergencia/expediente/:tipo/:perfilId` — identidad + infoMedica + contactos; escribe `RegistroAuditoria` `CONSULTA_EMERGENCIA` best-effort (un fallo de auditoría no bloquea la respuesta); cross-sede → 404 (nunca 403); `tipo` inválido → 400.
- `AccionAuditoria` gana `CONSULTA_EMERGENCIA` — primer `accion` de lectura del sistema.

- [ ] **Step 2: Actualizar "CRUD por tipo de entidad" en `CLAUDE.md`**

En la tabla, fila "Negocio (no CRUD)": agregar `Expediente de emergencia (GET buscar + GET expediente, con auditoría de consulta)`. Fila "CRUD completo" no aplica a `TelefonoEmergenciaSede` (no tiene `GET /:id`) — agregarlo a "Sin DELETE real"? No: sí tiene DELETE real. Crear mención en el texto: "`TelefonoEmergenciaSede` — GET lista + POST + PATCH + DELETE, sin `GET /:id` (mismo criterio que Salones)".

- [ ] **Step 3: Actualizar la línea "Fase actual" de `CLAUDE.md`**

Agregar una entrada tipo: "**Módulo de emergencia (botón de pánico + buscador de expedientes) CERRADO EN CÓDIGO** (2026-09-08 — `TelefonoEmergenciaSede` + `AccionAuditoria.CONSULTA_EMERGENCIA`; `EmergenciaModule` con CRUD de teléfonos + `GET /emergencia/buscar` (4 roles) + `GET /emergencia/expediente/:tipo/:perfilId` con auditoría; frontend: botón de pánico en el shell admin + `app/admin/emergencia/`. Vía Subagent-Driven Development, N tasks. Sin día de roadmap — pedido directo del usuario. 2 migraciones al backlog de prod)."

- [ ] **Step 4: Actualizar `documentacion_de_agentes/ESTADO.md`**

En los dominios `backend` y `admin`: marcar el módulo de emergencia como hecho, con el resumen de endpoints y la nota de las 2 migraciones pendientes de aplicar en prod (se suman al backlog: avisos, notif-index, tipo_sangre, cuatrimestre, tipo_contratacion, + `accion_auditoria_consulta_emergencia` + `telefonos_emergencia_sede`).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md documentacion_de_agentes/ESTADO.md
git commit -m "docs: contrato y estado del modulo de emergencia"
```

---

## Notas de cierre

- **Verificación manual final por el usuario** (patrón del proyecto): probar el flujo completo en navegador con una sesión real de administrativo — botón de pánico visible en todas las pantallas, alta/edición/borrado de teléfonos, búsqueda en los 4 roles, apertura de expediente con y sin info médica, y (si hay credenciales de otra sede) confirmar que no se filtra nada cross-sede. El e2e ya cubre el aislamiento y la auditoría.
- **`npx prisma format`** ya corre en la Task 1 Step 2; al commitear el schema no hace falta repetirlo.
- **Backlog de migraciones a prod**: este plan suma 2. No se aplican a prod como parte del plan (mismo criterio que los planes previos) — quedan anotadas en `ESTADO.md`.
- **QA de dominio**: al cerrar, correr `qa-backend` y `qa-admin` sobre lo construido (patrón del proyecto). `app/admin/emergencia/` sí tiene dueño de dominio (`qa-admin`), a diferencia de `app/plataforma/`.

---

## Self-Review

**1. Spec coverage:**
- Botón de pánico pasivo con teléfonos por sede → Tasks 1 (modelo), 2 (CRUD backend), 4 (`PanicoButton`), 6 (gestión UI). ✓
- Teléfonos gestionados por administrativos de la sede → Task 2 (guards `@Roles(ADMINISTRATIVO)`, `@SedeActual()`), Task 6 (UI). ✓
- `orden` server-side, sin reordenar → Task 2 Step 6 (`aggregate _max.orden + 1`). ✓
- Buscador cross-rol (4 roles) dentro de la sede → Task 3 Step 6 (`buscar`, 4 queries con filtro de sede). ✓
- `q` ≥ 2, `limit` ≤ 50 → Task 3 Step 3 (DTO). ✓
- Expediente con identidad + infoMedica + contactos, `infoMedica: null` posible → Task 3 Step 7 (`cargarExpediente`, `?  : null`). ✓
- Auditoría `CONSULTA_EMERGENCIA` best-effort → Task 1 (enum), Task 3 Step 7 (`try/catch` que loguea y sigue). ✓
- Cross-sede → 404 nunca 403 → Task 3 Step 7 (`findFirst` con filtro de sede → `null` → `NotFoundException`). ✓
- `tipo` inválido → 400 → Task 3 Step 8 (chequeo contra `TIPOS_EXPEDIENTE`). ✓
- RLS por sede → Task 1 Step 4 (policy `sede_isolation_telefonos_emergencia_sede`). ✓
- Botón fijo en el shell, visible en todo `/admin/*` → Task 4 Step 4 (`Topbar` de `AdminShell`). ✓
- Página con nav item → Task 5 Steps 1, 3. ✓
- `tel:` tap-para-llamar → Tasks 4, 5 (`href={`tel:...`}`). ✓
- Sección de teléfonos en la misma página → Task 6. ✓
- Regla 11 (sin imports cruzados) → todos los componentes en `app/admin/` o `components/admin/`. ✓
- Regla 12 (logging en catch) → todos los `catch` del plan hacen `console.error`. ✓
- Regla 14 (e2e limpia acotada por id) → Task 2 Step 1, Task 3 Step 1 (`afterAll` con `{ in: idsCreados }`). ✓
- Docs (CLAUDE.md contrato + ESTADO.md) → Task 7. ✓
- Migración del enum en archivo aislado → Task 1 Steps 3-4. ✓

**2. Placeholder scan:** Los `{ /* mismos 6 campos */ }` en Task 3 Step 7 tienen instrucción explícita de qué contienen (el bloque `tieneCondicionMedica/tipoSangre/padecimiento/medicamentos/alergias/tratamientoAdicional` de la rama ALUMNO, o extraer `mapInfoMedica`). El e2e de Task 3 Step 1 tiene `/* ... */` en algunos `it` — cada uno lleva un comentario de qué debe verificar; es un esqueleto deliberado para que el implementador escriba aserciones concretas siguiendo los `it` ya completos del mismo bloque. Task 6 Step 3 describe la sección sin código completo pero referencia el archivo exacto a calcar (`app/admin/carreras/page.tsx`) y enumera keys/handlers. Aceptable — no son "TODO"/"implementar después", son instrucciones ejecutables.

**3. Type consistency:**
- `TipoExpediente` — definido en `emergencia.service.ts` (Task 3 Step 6), reusado en el controller (Task 3 Step 8), espejado en `lib/api/emergencia.ts` (Task 4 Step 1) y en `ExpedientePanel.tsx` (Task 5 Step 2). Mismos 4 valores en todos. ✓
- `ResultadoBusqueda` (backend) ↔ `ResultadoBusquedaEmergencia` (frontend) — mismos campos `tipo/perfilId/nombreCompleto/referencia/activo`. ✓
- `ExpedienteEmergencia` — shape idéntico backend (Task 3 Step 7) y frontend (Task 4 Step 1). ✓
- `hayCambiosRealesTelefono(dto, existente)` — definido Task 2 Step 4, usado Task 2 Step 6, testeado Task 2 Step 5. ✓
- `nombreCompleto` / `compararPorApellidos` / `calcularEdad` — definidos Task 3 Step 4, usados Task 3 Steps 6-7. `compararPorApellidos` recibe `{nombres, apellidoPaterno, apellidoMaterno}` — Task 3 Step 6 aclara que el orden global final NO usa esta función sobre `ResultadoBusqueda` (que no tiene esos campos) sino `orderBy` en las queries + merge por `nombreCompleto`. Consistente tras la aclaración. ✓
- Funciones de `lib/api/emergencia.ts` — nombres usados en Tasks 4/5/6 coinciden con los exportados en Task 4 Step 1 (`listarTelefonosEmergencia`, `buscarEmergencia`, `obtenerExpedienteEmergencia`, etc.). ✓
- `queryKey` `['admin','emergencia','telefonos']` — misma en `PanicoButton` (Task 4) y en la sección de gestión (Task 6), para compartir caché/invalidación. ✓
