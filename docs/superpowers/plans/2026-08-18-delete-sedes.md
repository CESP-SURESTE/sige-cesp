# DELETE /sedes/:id Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar `DELETE /sedes/:id` (actor `AdminPlataforma`), bloqueado si la sede tiene alumnos activos o cualquier otro dato asociado, con UI de confirmación en `app/plataforma/sedes/page.tsx`.

**Architecture:** Migración chica (`RegistroAuditoria.sedeId` nullable + `onDelete: SetNull`, resuelve el choque con regla 5) → `SedesService.eliminar` (chequeo explícito de alumnos activos + catch de FK genérico para todo lo demás) → `SedesController` DELETE → cliente frontend + modal de confirmación local.

**Tech Stack:** NestJS + Prisma 6.x + Postgres (Supabase) · Next.js + React Query · Jest/Supertest (e2e).

## Global Constraints

- Contrato de API: éxito `{ data: ... }`, error `{ error, code }`. Este endpoint reutiliza `NOT_FOUND` y `CONFLICT` — sin código nuevo.
- `sedeId` de negocio (alumnos, carreras, etc.) sale siempre de la DB/params, nunca hay `sedeId` de JWT involucrado acá — el actor es `AdminPlataforma`, sin sede de contexto (mismo criterio que el resto de `SedesController`).
- Regla 5 (`CLAUDE.md`): `RegistroAuditoria` es solo inserción — ningún `UPDATE`/`DELETE` de código de aplicación la toca. El `onDelete: SetNull` es un efecto estructural de Postgres al borrar el padre, no una operación de la app sobre esa tabla.
- Migraciones: la shadow DB de `prisma migrate dev` no tiene el schema `auth` de Supabase (bloqueo conocido, Días 8/12/20) — se genera con `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` y se aplica con `prisma migrate deploy`, nunca `migrate dev`.
- No agregar dependencias nuevas.

---

### Task 1: Migración — `RegistroAuditoria.sedeId` nullable + `onDelete: SetNull`

**Files:**
- Modify: `App/backend/prisma/schema.prisma` (modelo `RegistroAuditoria`, líneas 509-524)
- Create: `App/backend/prisma/migrations/<timestamp>_registro_auditoria_sede_nullable/migration.sql`

**Interfaces:**
- Produces: `RegistroAuditoria.sedeId: string | null` (antes `string`) en el cliente Prisma generado — lo consume `Task 2` al crear el registro de `ELIMINACION` (sigue mandando `sedeId` en el create, sigue siendo válido mandar un string ahí).

- [ ] **Step 1: Editar el schema**

En `App/backend/prisma/schema.prisma`, dentro de `model RegistroAuditoria`, cambiar:

```prisma
  sedeId            String           @map("sede_id")
  sede              Sede             @relation(fields: [sedeId], references: [id])
```

por:

```prisma
  sedeId            String?          @map("sede_id")
  sede              Sede?            @relation(fields: [sedeId], references: [id], onDelete: SetNull)
```

No se toca `model Sede` (el lado `registrosAuditoria RegistroAuditoria[]` no cambia — Prisma no requiere anotación en ambos lados de la relación).

- [ ] **Step 2: Regenerar el cliente Prisma**

Run: `cd App/backend && npx prisma generate`
Expected: `✔ Generated Prisma Client`, sin errores. `tsc --noEmit` va a fallar hasta este punto en cualquier archivo que asuma `sedeId: string` no-nulo en `RegistroAuditoria` — no debería haber ninguno hoy (verificar con el Step 3 de Task 2 más abajo si aparece alguno inesperado).

- [ ] **Step 3: Generar el diff SQL contra la DB real**

Run:
```bash
cd App/backend
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > /tmp/registro_auditoria_sede_nullable.sql
cat /tmp/registro_auditoria_sede_nullable.sql
```
Expected: SQL con 3 statements — `DROP CONSTRAINT` del FK viejo, `ALTER COLUMN "sede_id" DROP NOT NULL`, `ADD CONSTRAINT` del FK nuevo con `ON DELETE SET NULL`. Revisar que el nombre de la tabla sea `"registro_auditoria"` y la columna `"sede_id"` (nombres de la DB vía `@map`/`@@map`, no los nombres de Prisma).

- [ ] **Step 4: Guardar la migración en el repo**

```bash
cd App/backend
mkdir -p "prisma/migrations/$(date +%Y%m%d%H%M%S)_registro_auditoria_sede_nullable"
```
Copiar el contenido de `/tmp/registro_auditoria_sede_nullable.sql` a
`prisma/migrations/<ese-timestamp>_registro_auditoria_sede_nullable/migration.sql`
(mismo formato que `prisma/migrations/20260818190142_contador_matricula/migration.sql` — sin encabezado adicional, el SQL generado ya trae comentarios `-- DropForeignKey`/`-- AlterTable`/`-- AddForeignKey`).

- [ ] **Step 5: Aplicar contra la DB real**

Run: `cd App/backend && npx prisma migrate deploy`
Expected: `The following migration(s) have been applied: ... registro_auditoria_sede_nullable`, sin errores.

- [ ] **Step 6: Verificar con `migrate status`**

Run: `cd App/backend && npx prisma migrate status`
Expected: `Database schema is up to date!`

- [ ] **Step 7: Commit**

```bash
cd "C:\Users\sebas\OneDrive\Desktop\Proyectos\sige-cesp"
git add App/backend/prisma/schema.prisma App/backend/prisma/migrations/
git commit -m "feat(backend): RegistroAuditoria.sedeId nullable + onDelete SetNull

Resuelve el choque entre DELETE real de Sede y regla 5 (RegistroAuditoria
solo insercion) - toda sede tiene al menos 1 registro de auditoria desde
su propia alta, asi que sin esto ninguna sede seria borrable jamas.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Backend — `DELETE /sedes/:id`, con tests e2e

**Files:**
- Modify: `App/backend/src/sedes/sedes.service.ts`
- Modify: `App/backend/src/sedes/sedes.controller.ts`
- Modify: `App/backend/test/sedes-crud.e2e-spec.ts`

**Interfaces:**
- Consumes: `PlatformAdminGuard` (`../common/guards/platform-admin.guard`, sin cambios), `@PlatformAdminActual()` (`../common/decorators/platform-admin-actual.decorator`, sin cambios), `RolUsuario` (`@prisma/client`).
- Produces: `SedesService.eliminar(id: string, actorPlatformAdminId: string): Promise<{ ok: true }>` — lo consume `Task 3` (frontend) vía el nuevo endpoint HTTP `DELETE /sedes/:id` → `200 { data: { ok: true } }`.

- [ ] **Step 1: Escribir los tests e2e (deben fallar — la ruta no existe todavía)**

Agregar al final de `App/backend/test/sedes-crud.e2e-spec.ts`, antes del `});` que cierra el `describe` principal (después del último `it(...)` existente, línea ~208):

```typescript
  describe('DELETE /sedes/:id', () => {
    async function crearSedeDePrueba(nombre: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post('/sedes')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre,
          direccion: 'Calle Falsa 123',
          ubicacionReferencia: 'Frente al parque',
          telefono: '9991234567',
        });
      return (res.body as SedeBody).data.id;
    }

    it('sede vacía se elimina exitosamente', async () => {
      const id = await crearSedeDePrueba(`Sede E2E Delete Vacia ${Date.now()}`);

      const res = await request(app.getHttpServer())
        .delete(`/sedes/${id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect((res.body as { data: { ok: boolean } }).data.ok).toBe(true);

      const sedeEnDb = await prisma.sede.findUnique({ where: { id } });
      expect(sedeEnDb).toBeNull();
    });

    it('el RegistroAuditoria de la ALTA original sobrevive con sedeId null', async () => {
      const nombre = `Sede E2E Delete Auditoria ${Date.now()}`;
      const id = await crearSedeDePrueba(nombre);

      const registroAlta = await prisma.registroAuditoria.findFirst({
        where: { entidad: 'Sede', entidadId: id, accion: 'ALTA' },
      });
      expect(registroAlta).not.toBeNull();

      const res = await request(app.getHttpServer())
        .delete(`/sedes/${id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);

      const registroAltaDespues = await prisma.registroAuditoria.findUnique({
        where: { id: registroAlta!.id },
      });
      expect(registroAltaDespues).not.toBeNull();
      expect(registroAltaDespues!.sedeId).toBeNull();

      const registroEliminacion = await prisma.registroAuditoria.findFirst({
        where: { entidad: 'Sede', entidadId: id, accion: 'ELIMINACION' },
      });
      expect(registroEliminacion).not.toBeNull();
      expect(registroEliminacion!.sedeId).toBeNull();
      expect(registroEliminacion!.detalle).toEqual({ nombre });
    });

    it('sede con alumno activo -> 409 CONFLICT, no se borra', async () => {
      const id = await crearSedeDePrueba(`Sede E2E Delete AlumnoActivo ${Date.now()}`);
      const usuario = await prisma.usuario.create({
        data: {
          id: randomUUID(),
          email: `fixture.delete-sede.${randomUUID()}@example.com`,
          rol: RolUsuario.ALUMNO,
          sedeId: id,
          activo: true,
        },
      });

      const res = await request(app.getHttpServer())
        .delete(`/sedes/${id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(409);
      expect((res.body as ErrorBody).code).toBe('CONFLICT');
      expect((res.body as ErrorBody).error).toMatch(/alumno/i);

      const sedeEnDb = await prisma.sede.findUnique({ where: { id } });
      expect(sedeEnDb).not.toBeNull();

      await prisma.usuario.delete({ where: { id: usuario.id } });
    });

    it('sede con alumno dado de baja (activo=false) SÍ se elimina', async () => {
      const id = await crearSedeDePrueba(`Sede E2E Delete AlumnoBaja ${Date.now()}`);
      await prisma.usuario.create({
        data: {
          id: randomUUID(),
          email: `fixture.delete-sede.${randomUUID()}@example.com`,
          rol: RolUsuario.ALUMNO,
          sedeId: id,
          activo: false,
        },
      });

      const res = await request(app.getHttpServer())
        .delete(`/sedes/${id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const sedeEnDb = await prisma.sede.findUnique({ where: { id } });
      expect(sedeEnDb).toBeNull();
    });

    it('sede con una carrera asociada (sin alumnos) -> 409 CONFLICT por datos asociados', async () => {
      const id = await crearSedeDePrueba(`Sede E2E Delete Carrera ${Date.now()}`);
      const carrera = await prisma.carrera.create({
        data: {
          sedeId: id,
          nombre: `Carrera E2E Delete ${Date.now()}`,
          clave: `CED${Date.now()}`,
          duracion: 8,
          nivel: 'LICENCIATURA',
          modalidad: 'PRESENCIAL',
          rvoe: 'RVOE-E2E-DELETE',
          descripcion: 'Carrera de prueba para el test de DELETE /sedes',
        },
      });

      const res = await request(app.getHttpServer())
        .delete(`/sedes/${id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(409);
      expect((res.body as ErrorBody).code).toBe('CONFLICT');

      const sedeEnDb = await prisma.sede.findUnique({ where: { id } });
      expect(sedeEnDb).not.toBeNull();

      await prisma.carrera.delete({ where: { id: carrera.id } });
    });

    it('id inexistente -> 404 NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .delete('/sedes/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
    });

    it('sin token -> 401 UNAUTHORIZED', async () => {
      const id = await crearSedeDePrueba(`Sede E2E Delete SinToken ${Date.now()}`);

      const res = await request(app.getHttpServer()).delete(`/sedes/${id}`);

      expect(res.status).toBe(401);

      await prisma.registroAuditoria.deleteMany({ where: { sedeId: id } });
      await prisma.sede.delete({ where: { id } });
    });
  });
```

Agregar los imports que este bloque necesita al inicio del archivo (`App/backend/test/sedes-crud.e2e-spec.ts`, junto a los imports existentes):

```typescript
import { randomUUID } from 'node:crypto';
import { RolUsuario } from '@prisma/client';
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd App/backend && npm run test:e2e`
Expected: FAIL — los 7 tests nuevos del bloque `DELETE /sedes/:id` fallan con `404` (ruta inexistente) en vez de los status esperados, o con `TypeError` si el método `eliminar` no existe. El resto de la suite (`sedes-crud.e2e-spec.ts` original + las otras 12 suites) debe seguir en verde.

- [ ] **Step 3: Implementar `SedesService.eliminar`**

En `App/backend/src/sedes/sedes.service.ts`, agregar al final de la clase `SedesService` (después de `actualizar`, antes del `}` que cierra la clase):

```typescript
  /**
   * `DELETE /sedes/:id` — Fase 6, Día 22. Actor `AdminPlataforma`, mismo
   * patrón que `crear`/`actualizar`. DELETE real (Sede sigue en el patrón
   * "CRUD completo" de CLAUDE.md, no baja lógica) — no soft delete.
   *
   * Chequeo de negocio explícito: no se puede eliminar una sede con alumnos
   * `activo: true` (mismo campo de baja lógica que usa todo el sistema,
   * regla 3 — un alumno dado de baja no bloquea, sin importar su
   * `estatusAcademico`). Cualquier otro dato asociado (carreras, salones,
   * grupos, personal, maestros/administrativos) cae en el catch de `P2003`
   * de abajo — enumerar cada tabla posible acá sería frágil y se
   * desactualizaría con cada tabla nueva que referencie `Sede` a futuro.
   *
   * El `RegistroAuditoria` de `ELIMINACION` se crea ANTES del `tx.sede.delete`
   * dentro de la misma transacción — el `onDelete: SetNull` de la migración
   * de este día nulifica `sedeId` en ese registro (y en cualquier otro
   * histórico de esta sede) automáticamente al borrar el padre, sin que la
   * app ejecute ningún UPDATE/DELETE sobre `registro_auditoria` (regla 5).
   * `detalle: { nombre: sede.nombre }` es un snapshot — después del delete,
   * `entidadId` es lo único que queda para identificar qué sede era.
   */
  async eliminar(id: string, actorPlatformAdminId: string) {
    const sede = await this.prisma.sede.findUnique({ where: { id } });
    if (!sede) {
      throw new NotFoundException({
        error: 'Sede no encontrada',
        code: 'NOT_FOUND',
      });
    }

    const alumnosActivos = await this.prisma.usuario.count({
      where: { sedeId: id, rol: 'ALUMNO', activo: true },
    });
    if (alumnosActivos > 0) {
      throw new ConflictException({
        error: `No se puede eliminar: la sede tiene ${alumnosActivos} alumno(s) activo(s)`,
        code: 'CONFLICT',
      });
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.registroAuditoria.create({
          data: {
            adminPlataformaId: actorPlatformAdminId,
            sedeId: sede.id,
            accion: AccionAuditoria.ELIMINACION,
            entidad: 'Sede',
            entidadId: sede.id,
            detalle: { nombre: sede.nombre },
          },
        });

        await tx.sede.delete({ where: { id } });
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        throw new ConflictException({
          error:
            'No se puede eliminar: la sede tiene otros datos asociados (carreras, personal, etc.)',
          code: 'CONFLICT',
        });
      }
      console.error('[SedesService.eliminar] error inesperado:', err);
      throw err;
    }

    return { ok: true as const };
  }
```

`RolUsuario` no hace falta importarlo aparte en este archivo — Prisma acepta el string literal `'ALUMNO'` en el `where` tipado. Si TypeScript se queja (`tsc --noEmit`, Step 4 de abajo), importar `RolUsuario` de `@prisma/client` en la línea del `import { AccionAuditoria, Prisma, type Sede } from '@prisma/client';` existente (línea 6) y usar `RolUsuario.ALUMNO` en vez del string literal.

- [ ] **Step 4: Implementar el endpoint en `SedesController`**

En `App/backend/src/sedes/sedes.controller.ts`, agregar `Delete` al import de `@nestjs/common` (línea 1-10, junto a `Patch`/`Post`), y agregar el método al final de la clase, después de `actualizar`:

```typescript
  @Delete(':id')
  @UseGuards(PlatformAdminGuard)
  async eliminar(
    @Param('id') id: string,
    @PlatformAdminActual() actorId: string,
  ) {
    const data = await this.sedesService.eliminar(id, actorId);
    return { data };
  }
```

- [ ] **Step 5: Correr `tsc --noEmit` y `eslint`**

Run: `cd App/backend && npx tsc --noEmit && npx eslint src test`
Expected: limpio, sin errores.

- [ ] **Step 6: Correr los tests e2e y verificar que pasan**

Run: `cd App/backend && npm run test:e2e`
Expected: PASS — las 13 suites existentes + los 7 tests nuevos del bloque `DELETE /sedes/:id`, todo en verde (14+109 = revisar el conteo real en la salida, sin regresión en ninguna otra suite).

- [ ] **Step 7: Correr los tests unit**

Run: `cd App/backend && npm test`
Expected: PASS, 28 tests (sin cambios — este endpoint no tiene lógica que amerite un unit test dedicado, toda su lógica de negocio está cubierta por los e2e de arriba).

- [ ] **Step 8: Commit**

```bash
cd "C:\Users\sebas\OneDrive\Desktop\Proyectos\sige-cesp"
git add App/backend/src/sedes/sedes.service.ts App/backend/src/sedes/sedes.controller.ts App/backend/test/sedes-crud.e2e-spec.ts
git commit -m "feat(backend): DELETE /sedes/:id con bloqueo por alumnos activos (Dia 22)

- Bloquea si la sede tiene Usuario.activo=true con rol ALUMNO (409 CONFLICT,
  mensaje con la cantidad).
- Catch generico de P2003 para cualquier otro dato asociado (carreras,
  salones, grupos, personal, maestros/administrativos) - red de seguridad
  vía el FK constraint de Postgres, sin enumerar cada tabla.
- RegistroAuditoria de ELIMINACION con snapshot del nombre en detalle.
- 7 tests e2e nuevos, 109+7 en verde, 28 unit sin cambios.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Frontend — botón "Eliminar" + modal de confirmación

**Files:**
- Modify: `App/frontend/src/lib/api/sedes.ts`
- Create: `App/frontend/src/app/plataforma/sedes/ConfirmarEliminarSedeModal.tsx`
- Modify: `App/frontend/src/app/plataforma/sedes/page.tsx`

**Interfaces:**
- Consumes: `platformFetch<T>` (`../../../lib/api/platform-http`, sin cambios), `Sede` (`./sedes.ts`, sin cambios).
- Produces: `eliminarSede(id: string): Promise<{ ok: true }>` (`lib/api/sedes.ts`) — lo consume `page.tsx`. `ConfirmarEliminarSedeModal` — props `{ sede: Sede; onConfirmar: () => void; onCancelar: () => void; eliminando: boolean }`, consumido solo por `page.tsx`.

- [ ] **Step 1: Agregar `eliminarSede` al cliente API**

En `App/frontend/src/lib/api/sedes.ts`, agregar al final del archivo:

```typescript
export function eliminarSede(id: string): Promise<{ ok: true }> {
  return platformFetch<{ ok: true }>(`/sedes/${id}`, {
    method: 'DELETE',
  });
}
```

- [ ] **Step 2: Crear el modal de confirmación**

Crear `App/frontend/src/app/plataforma/sedes/ConfirmarEliminarSedeModal.tsx`:

```typescript
'use client';

import type { Sede } from '@/lib/api/sedes';

interface ConfirmarEliminarSedeModalProps {
  sede: Sede;
  onConfirmar: () => void;
  onCancelar: () => void;
  eliminando: boolean;
}

/**
 * Modal de confirmación local a `app/plataforma/sedes/` — sin componente
 * compartido con `admin`/`alumno` (este árbol ya vive aislado del resto del
 * frontend desde Día 20: JWT propio, `localStorage`, sin `proxy.ts`). Primer
 * modal del repo — no hay un componente `Modal`/`Dialog` genérico que
 * reusar todavía.
 */
export function ConfirmarEliminarSedeModal({
  sede,
  onConfirmar,
  onCancelar,
  eliminando,
}: ConfirmarEliminarSedeModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-slate">
          Eliminar sede
        </h2>
        <p className="mt-2 text-sm text-slate/80">
          ¿Seguro que quieres eliminar <strong>{sede.nombre}</strong>? Esta
          acción no se puede deshacer.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancelar}
            disabled={eliminando}
            className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={eliminando}
            className="rounded-lg bg-crimson px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-crimson/90 disabled:opacity-50"
          >
            {eliminando ? 'Eliminando…' : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verificar tsc/eslint del modal en aislado**

Run: `cd App/frontend && npx tsc --noEmit`
Expected: limpio (el modal no está importado en ningún lado todavía, así que este check solo valida que el archivo en sí compila sin errores de sintaxis/tipos propios).

- [ ] **Step 4: Wirear el modal y el botón "Eliminar" en `page.tsx`**

En `App/frontend/src/app/plataforma/sedes/page.tsx`:

Agregar el import (junto a los imports existentes, línea 1-9):
```typescript
import { ConfirmarEliminarSedeModal } from './ConfirmarEliminarSedeModal';
```

Y ajustar el import de `lib/api/sedes` (línea 9) para incluir `eliminarSede`:
```typescript
import { listarSedes, crearSede, actualizarSede, eliminarSede, type Sede, type SedeInput } from '@/lib/api/sedes';
```

Agregar el estado nuevo, junto a `editandoId` (después de la línea `const [editandoId, setEditandoId] = useState<string | null>(null);`):
```typescript
  const [sedeAEliminar, setSedeAEliminar] = useState<Sede | null>(null);
```

Agregar la mutation nueva, después de `actualizarMutation` (antes de `function handleSubmit`):
```typescript
  const eliminarMutation = useMutation({
    mutationFn: (id: string) => eliminarSede(id),
    onSuccess: () => {
      toast.success('Sede eliminada');
      setSedeAEliminar(null);
      void queryClient.invalidateQueries({ queryKey: ['plataforma', 'sedes'] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Error al eliminar la sede');
      setSedeAEliminar(null);
    },
  });
```

En la fila de la tabla, cambiar la celda del botón "Editar" (busca `<td className="px-4 py-3 text-right">`, dentro del `.map`) para agregar el botón "Eliminar" al lado:
```typescript
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => iniciarEdicion(sede)}
                    className="text-navy hover:underline"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => setSedeAEliminar(sede)}
                    className="ml-4 text-crimson hover:underline"
                  >
                    Eliminar
                  </button>
                </td>
```

Y antes del `</main>` de cierre (al final del `return`), agregar el render condicional del modal:
```typescript
      {sedeAEliminar && (
        <ConfirmarEliminarSedeModal
          sede={sedeAEliminar}
          eliminando={eliminarMutation.isPending}
          onConfirmar={() => eliminarMutation.mutate(sedeAEliminar.id)}
          onCancelar={() => setSedeAEliminar(null)}
        />
      )}
```

- [ ] **Step 5: Verificar tsc/eslint de todo el frontend**

Run: `cd App/frontend && npx tsc --noEmit && npx eslint src/app/plataforma src/lib/api/sedes.ts`
Expected: limpio, sin errores.

- [ ] **Step 6: Commit**

```bash
cd "C:\Users\sebas\OneDrive\Desktop\Proyectos\sige-cesp"
git add App/frontend/src/lib/api/sedes.ts App/frontend/src/app/plataforma/sedes/
git commit -m "feat(frontend): boton Eliminar + modal de confirmacion en app/plataforma/sedes (Dia 22)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Verificación manual en navegador (opcional, requiere credenciales)

**Files:** ninguno — solo verificación.

- [ ] **Step 1: Levantar backend y frontend**

```bash
cd App/backend && npm run start:dev   # background
cd App/frontend && npm run dev         # background
```

- [ ] **Step 2: Probar en `http://localhost:3000/plataforma/login`**

Login con un `AdminPlataforma` real → `/plataforma/sedes` → crear una sede de prueba vacía → click "Eliminar" → confirmar en el modal → verificar que desaparece de la tabla y aparece el toast "Sede eliminada". Crear otra sede, darle de alta un alumno activo en esa sede (vía `app/admin/alumnos/nuevo`, requiere una cuenta `ADMINISTRATIVO` de esa sede) → intentar eliminar la sede → verificar que el toast muestra el mensaje de error claro (409, "tiene N alumno(s) activo(s)") y la sede sigue en la tabla.

Nota: igual que en la sesión anterior, esto requiere credenciales que no viven en el repo — pedir al usuario si quiere hacerlo él mismo o dar la contraseña.

---

## Self-Review

**Spec coverage:** migración (Task 1) ✅, `SedesService.eliminar` con los 2 niveles de bloqueo + auditoría (Task 2, Step 3) ✅, endpoint del controller (Task 2, Step 4) ✅, testing (Task 2, Step 1, cubre las 6 escenarios del spec: vacía, alumno activo, alumno de baja, carrera asociada, 404, 401 — falta explícitamente un test de "actor sin JWT válido" que ya está cubierto por el test "sin token") ✅, frontend botón+modal+mutation (Task 3) ✅. Verificación manual opcional (Task 4) — cubre el "Entregable visible" del roadmap ("casos límite cubiertos sin romper nada").

**Placeholder scan:** sin TBD/TODO, todo el código de cada step está completo y es el código real a escribir.

**Type consistency:** `eliminarSede(id: string): Promise<{ ok: true }>` (Task 3, Step 1) coincide con `SedesService.eliminar(...): Promise<{ ok: true }>` (Task 2, Step 3) y con el shape `{ data: { ok: true } }` que devuelve `SedesController.eliminar` (Task 2, Step 4) — `platformFetch` desenvuelve `data` automáticamente (ya confirmado en `platform-http.ts`, sin cambios). `ConfirmarEliminarSedeModal` recibe `sede: Sede` (mismo tipo ya exportado por `lib/api/sedes.ts`) — sin tipos nuevos que se desalineen entre tasks.
