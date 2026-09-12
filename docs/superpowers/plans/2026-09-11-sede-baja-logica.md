# Sede — baja lógica (`Sede.activa`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `DELETE /sedes/:id` deja de ser un callejón sin salida para toda
sede creada por el flujo de fundadores (2026-09-11). Cuando el borrado real
bloquearía (alumnos activos, o cualquier dato asociado vía `P2003` —
incluidos los 2 fundadores `ADMINISTRATIVO` que ahora toda sede tiene),
en vez de `409 CONFLICT` se hace baja lógica (`Sede.activa = false`). El
borrado real sigue existiendo tal cual para una sede genuinamente vacía.

**Architecture:** Migración aditiva (`Sede.activa Boolean @default(true)`,
sin backfill necesario). `SedesService.eliminar` gana una rama de fallback:
intenta el `DELETE` real de siempre: si el `alumnosActivos.count` bloquea o
el `tx.sede.delete` truena `P2003`, en vez de lanzar hace
`sede.update({ activa: false })` dentro de su propia transacción y responde
éxito igual, con un flag `eliminacionReal` para que el frontend sepa cuál
pasó. `PATCH /sedes/:id` gana `activa?: boolean` para reactivar. Frontend:
badge de estado en la tabla + mensaje de éxito distinto según
`eliminacionReal`.

**Tech Stack:** NestJS + Prisma (backend), Next.js + React Query
(frontend), Jest + Supertest (e2e).

## Global Constraints

- Regla 1 de `CLAUDE.md` raíz: nada de esto es un campo calculable — sin
  cambios de esa regla acá, `activa` es un flag persistido explícito, igual
  que `AdminPlataforma.activo` (mismo patrón ya usado en el schema).
- Regla 3 (no negociable): la baja lógica de `Sede` NUNCA borra ni modifica
  `Usuario`/perfiles — los fundadores quedan exactamente como estaban.
- Regla 5: `RegistroAuditoria` solo inserción — la baja lógica audita
  `CAMBIO_ESTATUS` (mismo valor de enum que `PATCH /personas/:id/estatus`
  usa para el mismo concepto), el borrado real sigue auditando
  `ELIMINACION` sin cambios.
- Regla 11: `app/plataforma/` no importa de `app/admin/`.
- Regla 12: todo catch/error handler loguea con `console.error`.
- Contrato de API: éxito `{ data: ... }`, error `{ error, code }`; sin
  códigos nuevos — el 409 de "datos asociados" para `DELETE /sedes/:id`
  DEJA DE EXISTIR (ya no es un error, es un camino de éxito distinto).
- `Sede.activa` es puramente informativo/de gestión — NO bloquea ninguna
  operación de negocio (alta de personas, login, grupos, etc.) dentro de
  esa sede. Fuera de alcance a propósito (YAGNI), ver el spec de diseño.
- Spec de referencia:
  `docs/superpowers/specs/2026-09-11-sede-baja-logica-design.md`.

---

### Task 1: Backend — `Sede.activa` + `DELETE /sedes/:id` con fallback a baja lógica + `PATCH` reactiva

**Files:**
- Modify: `App/backend/prisma/schema.prisma` (agregar `activa` a `model Sede`)
- Create: migración nueva (vía `prisma migrate diff` + `migrate deploy` —
  `prisma migrate dev` está roto en este repo, `P3006` shadow-DB, ver
  `docs/setup-backend-prisma-supabase.md`)
- Modify: `App/backend/src/sedes/sedes.service.ts` (`eliminar`, `actualizar`,
  `hayCambiosReales`)
- Modify: `App/backend/src/sedes/dto/actualizar-sede.dto.ts`
- Modify: `App/backend/test/sedes-crud.e2e-spec.ts` (4 tests del describe
  `DELETE /sedes/:id` cambian de esperar `409` a esperar `200` con baja
  lógica; 2 tests nuevos: reactivar vía `PATCH`, y el caso feliz de baja
  lógica con fundadores intactos)
- Modify: `CLAUDE.md` raíz — bullet de `DELETE /sedes/:id` en "Contrato de
  API" (agregar el comportamiento nuevo, sin borrar la descripción del
  borrado real que sigue existiendo) + la fila de `Sede` en la tabla "CRUD
  por tipo de entidad" si aplica una nota como las de `Salon`/`Materia`.

**Interfaces:**
- Produces: `Sede.activa: boolean` (schema); `SedesService.eliminar(id,
  actorId): Promise<{ ok: true; eliminacionReal: boolean }>` (firma de
  retorno cambia — antes `{ ok: true }`); `ActualizarSedeDto.activa?:
  boolean` — usados por Task 2 (frontend).

- [ ] **Step 1: Migración — `Sede.activa`**

En `App/backend/prisma/schema.prisma`, en `model Sede` (línea ~160-183),
agrega el campo (después de `costoRenta`, antes de `createdAt` — mismo
orden que el resto de campos "de negocio" antes de los timestamps):

```prisma
model Sede {
  id                  String   @id @default(uuid())
  nombre              String   @unique
  direccion           String
  ubicacionReferencia String   @map("ubicacion_referencia")
  telefono            String
  costoRenta          Decimal? @map("costo_renta") @db.Decimal(10, 2)
  activa              Boolean  @default(true)
  createdAt           DateTime @default(now()) @map("created_at")
  updatedAt           DateTime @updatedAt @map("updated_at")
  // ... resto sin cambios
}
```

Genera la migración con el mismo procedimiento ya usado en este repo para
todas las migraciones recientes (`prisma migrate dev` no funciona acá):

```bash
cd App/backend
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > /tmp/diff.sql
# revisa /tmp/diff.sql — debe ser solo:
#   ALTER TABLE "sedes" ADD COLUMN "activa" BOOLEAN NOT NULL DEFAULT true;
```

Si tu entorno tiene otro flujo ya establecido para generar migraciones en
este repo (revisa migraciones recientes en `prisma/migrations/` para
confirmar el patrón exacto usado, ej. `20260908120001_telefonos_emergencia_sede`),
síguelo — el punto no negociable es: migración aditiva, `NOT NULL DEFAULT
true`, sin backfill manual (el default ya cubre las filas existentes).
Aplícala con `npx prisma migrate deploy` contra la DB de dev de Supabase.
Corre `npx prisma generate` después.

- [ ] **Step 2: `SedesService.eliminar` — fallback a baja lógica**

En `App/backend/src/sedes/sedes.service.ts`, reescribe el método `eliminar`
completo. La lógica de detección de bloqueo es la misma de hoy (conteo de
`alumnosActivos` + catch de `P2003`), pero en vez de lanzar `ConflictException`
en cualquiera de los 2 casos, hace baja lógica:

```ts
  /**
   * `DELETE /sedes/:id` — Fase 6, Día 22, EXTENDIDO 2026-09-11 (ver
   * `docs/superpowers/specs/2026-09-11-sede-baja-logica-design.md`). Desde
   * que `POST /sedes` siempre crea 2 fundadores `ADMINISTRATIVO`, ninguna
   * sede nueva queda vacía nunca — el `409 CONFLICT` de antes se volvía un
   * callejón sin salida permanente. Ahora: intenta el DELETE real de
   * siempre; si bloquearía por cualquiera de los 2 motivos (alumnos
   * activos, o cualquier dato asociado vía P2003 — incluidos los propios
   * fundadores), hace baja lógica (`activa: false`) en su lugar y responde
   * éxito igual. Nunca hay ya un 409 de "datos asociados" — ese caso pasó
   * de ser un error a ser un camino de éxito distinto, señalizado por
   * `eliminacionReal`.
   */
  async eliminar(
    id: string,
    actorPlatformAdminId: string,
  ): Promise<{ ok: true; eliminacionReal: boolean }> {
    const sede = await this.prisma.sede.findUnique({ where: { id } });
    if (!sede) {
      throw new NotFoundException({
        error: 'Sede no encontrada',
        code: 'NOT_FOUND',
      });
    }

    const alumnosActivos = await this.prisma.usuario.count({
      where: { sedeId: id, rol: RolUsuario.ALUMNO, activo: true },
    });

    if (alumnosActivos > 0) {
      await this.darDeBajaLogica(sede, actorPlatformAdminId);
      return { ok: true, eliminacionReal: false };
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
      return { ok: true, eliminacionReal: true };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        await this.darDeBajaLogica(sede, actorPlatformAdminId);
        return { ok: true, eliminacionReal: false };
      }
      console.error('[SedesService.eliminar] error inesperado:', err);
      throw err;
    }
  }

  /**
   * Baja lógica de una sede — fallback de `eliminar` cuando el borrado
   * real bloquearía. Auditar `CAMBIO_ESTATUS` (mismo valor de enum que
   * `PATCH /personas/:id/estatus` usa para el mismo concepto — un cambio
   * de estatus, no una edición de campos ni una eliminación real).
   */
  private async darDeBajaLogica(
    sede: Sede,
    actorPlatformAdminId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.sede.update({ where: { id: sede.id }, data: { activa: false } });
      await tx.registroAuditoria.create({
        data: {
          adminPlataformaId: actorPlatformAdminId,
          sedeId: sede.id,
          accion: AccionAuditoria.CAMBIO_ESTATUS,
          entidad: 'Sede',
          entidadId: sede.id,
          detalle: { nombre: sede.nombre, activa: false },
        },
      });
    });
  }
```

Nota: `darDeBajaLogica` es idempotente si se llama sobre una sede ya
`activa: false` (redundante pero inofensivo — no hace falta guardarla).

- [ ] **Step 3: `ActualizarSedeDto` + `hayCambiosReales` — reactivar**

En `App/backend/src/sedes/dto/actualizar-sede.dto.ts`, agrega al final de
la clase:

```ts
  @IsOptional()
  @IsBoolean({ message: 'activa debe ser booleano' })
  activa?: boolean;
```

(agrega `IsBoolean` al import existente de `class-validator`).

En `App/backend/src/sedes/sedes.service.ts`, extiende `hayCambiosReales`
(la función standalone al tope del archivo) para contemplar `activa`:

```ts
  if (dto.activa !== undefined && dto.activa !== existente.activa) {
    return true;
  }
```

Y en `actualizar`, agrega `activa: dto.activa` al `data` del
`tx.sede.update` (junto a `nombre`/`direccion`/etc. — `undefined` en
Prisma `update` significa "no tocar este campo", mismo comportamiento que
ya tienen los demás campos ahí).

- [ ] **Step 4: Actualizar `CLAUDE.md` raíz**

Sección "Contrato de API", bullet de `DELETE /sedes/:id` (Fase 6, Día 22)
— agrega el comportamiento nuevo sin borrar la descripción del caso de
borrado real (sigue existiendo para una sede genuinamente vacía). Menciona
la fecha (2026-09-11), que reemplaza el `409 CONFLICT` de "datos
asociados"/"alumnos activos" por baja lógica (`activa: false`,
`eliminacionReal: false` en la respuesta), y que `PATCH /sedes/:id` ganó
`activa?: boolean` para reactivar. Sigue el estilo denso ya usado en el
resto del archivo. NO toques ningún otro bullet — en particular no el de
`POST/GET/PATCH /sedes` de Día 20 (ya actualizado por otro fix reciente
para el contrato de fundadores) ni la tabla de reglas de arquitectura.

- [ ] **Step 5: Reescribir los 4 tests que hoy esperan `409` + agregar 2 nuevos**

En `App/backend/test/sedes-crud.e2e-spec.ts`, describe `DELETE /sedes/:id`
(línea ~473). Los 4 tests que hoy esperan `res.status === 409` para "sede
con alumno activo", "sede con alumno de baja", "sede con maestro activo",
"sede con una carrera asociada" — todos deben cambiar a esperar `200` con
baja lógica: `res.status` → `200`, `data.ok` → `true`, `data.eliminacionReal`
→ `false`, y verificar `prisma.sede.findUnique({ where: { id } })` sigue
existiendo PERO con `activa: false` (en vez de "sedeEnDb no es null" sin
más, ahora afirma también el campo `activa`). Ajusta los nombres de los
`it(...)` para reflejar el comportamiento nuevo (ej. "sede con alumno
activo -> baja lógica, no se borra" en vez de "-> 409 CONFLICT, no se
borra"). El test de "el `RegistroAuditoria` de la ALTA original sobrevive
con `sedeId` null" (borrado real) NO cambia — sigue probando el camino de
`DELETE` real con una sede genuinamente vacía.

Agrega 2 tests nuevos al mismo describe:

```ts
    it('sede con fundadores intactos -> baja lógica (no se borra ni la sede ni los fundadores)', async () => {
      mockCreateUserExitoso();
      const nombre = `Sede E2E Delete ConFundadores ${Date.now()}`;
      const res1 = await request(app.getHttpServer())
        .post('/sedes')
        .set('Authorization', `Bearer ${token}`)
        .send(bodySedeConFundadores(nombre));
      const { sede, director, administrativo } = (res1.body as {
        data: {
          sede: { id: string };
          director: { usuario: { id: string } };
          administrativo: { usuario: { id: string } } | null;
        };
      }).data;

      const res = await request(app.getHttpServer())
        .delete(`/sedes/${sede.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const body = res.body as { data: { ok: boolean; eliminacionReal: boolean } };
      expect(body.data.ok).toBe(true);
      expect(body.data.eliminacionReal).toBe(false);

      const sedeEnDb = await prisma.sede.findUnique({ where: { id: sede.id } });
      expect(sedeEnDb).not.toBeNull();
      expect(sedeEnDb!.activa).toBe(false);

      // regla 3 — los fundadores siguen existiendo, intactos
      const directorEnDb = await prisma.usuario.findUnique({
        where: { id: director.usuario.id },
      });
      expect(directorEnDb).not.toBeNull();
      if (administrativo) {
        const administrativoEnDb = await prisma.usuario.findUnique({
          where: { id: administrativo.usuario.id },
        });
        expect(administrativoEnDb).not.toBeNull();
      }
    });

    it('PATCH /sedes/:id con activa: true reactiva una sede dada de baja lógica', async () => {
      const id = await crearSedeDePrueba(
        `Sede E2E Reactivar ${Date.now()}`,
      );
      // Fuerza baja lógica creando un alumno activo, luego DELETE
      await prisma.usuario.create({
        data: {
          id: randomUUID(),
          email: `fixture.reactivar-sede.${randomUUID()}@example.com`,
          rol: RolUsuario.ALUMNO,
          sedeId: id,
          activo: true,
        },
      });
      await request(app.getHttpServer())
        .delete(`/sedes/${id}`)
        .set('Authorization', `Bearer ${token}`);

      const res = await request(app.getHttpServer())
        .patch(`/sedes/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ activa: true });

      expect(res.status).toBe(200);
      const sedeEnDb = await prisma.sede.findUnique({ where: { id } });
      expect(sedeEnDb!.activa).toBe(true);
    });
```

(Ambos tests usan `bodySedeConFundadores`/`mockCreateUserExitoso`/
`crearSedeDePrueba`, ya existentes en este archivo desde tasks previas —
no los recrees.)

- [ ] **Step 6: Verificar**

Run: `cd App/backend && pnpm build` — sin errores.
Run: `cd App/backend && pnpm test:e2e -- sedes-crud.e2e-spec.ts` — todos en
verde, incluyendo los 4 reescritos y los 2 nuevos.
Run: `cd App/backend && pnpm test:e2e` — regresión completa en verde.

- [ ] **Step 7: Commit**

```bash
git add App/backend/prisma/schema.prisma App/backend/prisma/migrations \
  App/backend/src/sedes App/backend/test/sedes-crud.e2e-spec.ts CLAUDE.md
git commit -m "feat(backend): DELETE /sedes/:id cae a baja lógica en vez de bloquear

Sede.activa (boolean, default true) nueva. Desde que POST /sedes crea
siempre 2 fundadores ADMINISTRATIVO, ninguna sede nueva quedaba vacía
y el 409 CONFLICT de datos asociados era un callejón sin salida
permanente (regla 3 prohíbe deshacer las personas). Ahora el DELETE
real se sigue intentando primero; si bloquearía, hace baja lógica
(activa: false) y responde éxito con eliminacionReal: false. PATCH
/sedes/:id gana activa?: boolean para reactivar."
```

---

### Task 2: Frontend — badge de estado + mensaje de éxito según `eliminacionReal`

**Files:**
- Modify: `App/frontend/src/lib/api/sedes.ts` (`Sede.activa`,
  `eliminarSede` retorna `eliminacionReal`, `actualizarSede` acepta
  `activa`)
- Modify: `App/frontend/src/app/plataforma/sedes/page.tsx` (badge en la
  tabla, mensaje de éxito condicional)
- Modify: `App/frontend/src/app/plataforma/sedes/SedeModal.tsx` (checkbox
  "Activa" — permite reactivar sin pasar por el flujo de eliminar)

**Interfaces:**
- Consumes: `Sede.activa`, `eliminarSede`, `actualizarSede` (Task 1's
  contrato real).

- [ ] **Step 1: `lib/api/sedes.ts`**

Agrega `activa: boolean;` a `interface Sede` (después de `costoRenta`).

Cambia la firma de `eliminarSede`:

```ts
export function eliminarSede(id: string): Promise<{ ok: true; eliminacionReal: boolean }> {
  return platformFetch(`/sedes/${id}`, { method: 'DELETE' });
}
```

`actualizarSede` ya acepta `Partial<SedeInput>` — `activa` no es parte de
`SedeInput` (ese tipo es "datos capturables al crear/editar campos de
sede", `activa` es un flag de estado separado). Cambia la firma para
aceptar ambos:

```ts
export function actualizarSede(
  id: string,
  input: Partial<SedeInput> & { activa?: boolean },
): Promise<Sede> {
  return platformFetch(`/sedes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
```

- [ ] **Step 2: `page.tsx` — badge + mensaje de éxito**

En la tabla, agrega una columna "Estado" (o reusa la celda ya existente al
lado del nombre) con un badge simple:

```tsx
<td className="px-4 py-3">
  <span
    className={
      sede.activa
        ? 'rounded-full bg-success-bg px-2 py-1 text-xs font-medium text-success-text'
        : 'rounded-full bg-bone px-2 py-1 text-xs font-medium text-slate/60'
    }
  >
    {sede.activa ? 'Activa' : 'Inactiva'}
  </span>
</td>
```

(ajusta las clases de color a los tokens reales que ya usa el resto de
`app/plataforma/` — revisa `EstatusEmpleadoBadge` o el badge de estatus de
administrativos en `app/admin/` como referencia de paleta, sin importar de
ahí — regla 11, solo mira el patrón visual). Agrega el `<th>` correspondiente
en el `<thead>`.

En `eliminarMutation.onSuccess`, cambia el mensaje según `eliminacionReal`:

```ts
    onSuccess: (data, id) => {
      toast.success(
        data.eliminacionReal
          ? 'Sede eliminada'
          : 'La sede tenía datos asociados — se marcó como inactiva en vez de eliminarse',
      );
      setSedeAEliminar(null);
      if (sedeAEditar?.id === id) {
        setSedeAEditar(null);
      }
    },
```

- [ ] **Step 3: `SedeModal.tsx` — checkbox "Activa"**

Agrega un campo checkbox al form de edición (junto a los 4 inputs
existentes) ligado a `form.activa` (inicializado desde `sede.activa` en
`formDesdeSede`), y agrégalo a `construirPayloadEdicion` solo si cambió
respecto al valor original de la sede (mismo criterio "blanco = sin
cambio" ya establecido, pero acá es un boolean, no un string vacío — compara
contra `sede.activa` directo, no contra "vacío").

- [ ] **Step 4: Verificar**

Run: `cd App/frontend && pnpm build` — sin errores.
Run: `cd App/frontend && pnpm lint` — limpio.

- [ ] **Step 5: Commit**

```bash
git add App/frontend/src/lib/api/sedes.ts App/frontend/src/app/plataforma/sedes
git commit -m "feat(frontend): badge de estado de sede + reactivar desde el modal de edición

'+Eliminar' ahora puede terminar en baja lógica en vez de borrado real
- el toast de éxito lo distingue (eliminacionReal). Tabla de sedes
gana un badge Activa/Inactiva. SedeModal (edición) gana un checkbox
para reactivar una sede sin pasar por el flujo de alumnos/personal."
```

---

## Verificación final (después de las 2 tasks)

- [ ] Run: `cd App/backend && pnpm test:e2e` — suite completa en verde.
- [ ] Run: `cd App/backend && pnpm build` — sin errores.
- [ ] Run: `cd App/frontend && pnpm build && pnpm lint` — ambos limpios.
- [ ] Verificación manual en navegador (usuario): `/plataforma/sedes` →
  eliminar una sede recién creada por el flujo de fundadores → confirmar
  toast de "se marcó como inactiva" (no "eliminada") → badge "Inactiva" en
  la tabla → editar esa sede → marcar "Activa" → guardar → badge vuelve a
  "Activa".
