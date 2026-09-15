# Motivos de baja por terminación (art. 53 LFT) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que dar de baja a un maestro/administrativo por fallecimiento o por incapacidad permanente revoque el acceso (`Usuario.activo = false`), igual que renuncia y despido.

**Architecture:** Se agregan 2 valores al enum `MotivoBaja` de Prisma (`FALLECIMIENTO`, `TERMINACION_INCAPACIDAD_PERMANENTE`). La función pura `PersonasService.calcularActivoPorEstatus` deja de comparar contra un OR inline y usa un `ReadonlySet` estático nombrado — única fuente de verdad de "qué motivos revocan acceso". El frontend replica el tipo espejo y el modal muestra el aviso de revocación para los 4 motivos. No cambia el contrato de request de `PATCH /personas/:id/estatus`.

**Tech Stack:** NestJS + Prisma 6.x (Postgres/Supabase) en `App/backend/`; Next.js + TS en `App/frontend/`; Jest e2e (`pnpm test:e2e` → `node scripts/run-e2e.js`).

## Global Constraints

- Fundamento legal: art. 53 fr. II LFT (muerte del trabajador) y art. 53 fr. IV LFT (incapacidad/inhabilidad permanente) — ambas extinguen la relación laboral, por eso revocan acceso.
- `BAJA_TEMPORAL_SALUD` y `OTRO` **NO** revocan (fail-safe: cortar acceso es acción deliberada). No cambiar ese comportamiento.
- Solo se agregan esos 2 valores. NO agregar `MUTUO_ACUERDO` ni `FIN_CONTRATO_TEMPORAL` (fuera de alcance, decisión del usuario).
- `Usuario.activo` solo se toca para `MAESTRO`/`ADMINISTRATIVO`, nunca para `ALUMNO` (regla 3 de `CLAUDE.md`).
- `RegistroAuditoria` solo inserción, dentro de la misma transacción (regla 5).
- Prisma 6.x — NO subir a Prisma 7.
- Convención Prisma camelCase/PascalCase; DB snake_case vía `@map`/`@@map` (los campos `motivo_baja` ya existen, no se tocan mappings).
- Separación total admin/alumno en frontend (regla 11) — el modal afectado vive en `components/admin/ui/personas-listado/`, no compartido con árbol alumno.
- e2e: la limpieza en `afterAll` va acotada a los `id`s que la corrida creó, nunca por patrón de email/nombre (regla 14 + bug de Día 24).

---

### Task 1: Backend — enum `MotivoBaja`, migración, lógica de revocación y e2e

**Files:**
- Modify: `App/backend/prisma/schema.prisma` (enum `MotivoBaja`, líneas 51-56)
- Create: `App/backend/prisma/migrations/<timestamp>_motivo_baja_terminaciones_art53/migration.sql` (lo genera Prisma; se hand-edita)
- Modify: `App/backend/src/personas/personas.service.ts` (`calcularActivoPorEstatus`, líneas ~1454-1462; agregar constante estática de clase)
- Test: `App/backend/test/personas-estatus.e2e-spec.ts` (agregar 4 `it(...)` en el bloque "Estatus avanzado")

**Interfaces:**
- Consumes: enum `MotivoBaja` de `@prisma/client` (ya importado en `personas.service.ts`); helpers de test `crearAdministrativoFixture({ sedeId, nivelPermiso })`, `crearMaestroFixture({ sedeId })`, `firmarToken(usuarioId, rol, sedeId)`, y las vars de suite `sedeMeridaId`, `actorAdminId` (todos ya existentes en `personas-estatus.e2e-spec.ts`).
- Produces:
  - Enum `MotivoBaja` con valores `RENUNCIA | DESPIDO | BAJA_TEMPORAL_SALUD | FALLECIMIENTO | TERMINACION_INCAPACIDAD_PERMANENTE | OTRO`.
  - `PersonasService.calcularActivoPorEstatus(estatus: string, motivoBaja: string | undefined): boolean` — misma firma, ahora devuelve `false` para `estatus === 'BAJA'` con `motivoBaja` en `{ RENUNCIA, DESPIDO, FALLECIMIENTO, TERMINACION_INCAPACIDAD_PERMANENTE }`.

- [ ] **Step 1: Escribir los 4 tests que fallan**

En `App/backend/test/personas-estatus.e2e-spec.ts`, dentro del `describe` de "Estatus avanzado" (donde ya viven los tests de `motivoBaja: DESPIDO` y `BAJA_TEMPORAL_SALUD`), agregar estos 4 `it(...)`. Seguir el patrón exacto de los tests vecinos (mismo `firmarToken`, mismo `select: { activo: true }`, misma consulta de `RegistroAuditoria`):

```ts
it('estatus: BAJA, motivoBaja: FALLECIMIENTO -> 200, revoca Usuario.activo y RegistroAuditoria.detalle marca cuentaRevocada: true', async () => {
  const objetivoId = await crearAdministrativoFixture({
    sedeId: sedeMeridaId,
    nivelPermiso: NivelPermiso.AUXILIAR,
  });

  const res = await request(app.getHttpServer())
    .patch(`/personas/${objetivoId}/estatus`)
    .send({ estatus: 'BAJA', motivoBaja: 'FALLECIMIENTO' })
    .set(
      'Authorization',
      `Bearer ${await firmarToken(actorAdminId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
    );

  expect(res.status).toBe(200);

  const usuarioActualizado = await prisma.usuario.findUnique({
    where: { id: objetivoId },
    select: { activo: true },
  });
  expect(usuarioActualizado?.activo).toBe(false);

  const registro = await prisma.registroAuditoria.findFirst({
    where: { entidadId: objetivoId, accion: AccionAuditoria.CAMBIO_ESTATUS },
    orderBy: { fecha: 'desc' },
  });
  expect(
    (registro?.detalle as Record<string, unknown> | null)?.cuentaRevocada,
  ).toBe(true);
});

it('estatus: BAJA, motivoBaja: TERMINACION_INCAPACIDAD_PERMANENTE -> 200, revoca Usuario.activo', async () => {
  const objetivoId = await crearAdministrativoFixture({
    sedeId: sedeMeridaId,
    nivelPermiso: NivelPermiso.AUXILIAR,
  });

  const res = await request(app.getHttpServer())
    .patch(`/personas/${objetivoId}/estatus`)
    .send({ estatus: 'BAJA', motivoBaja: 'TERMINACION_INCAPACIDAD_PERMANENTE' })
    .set(
      'Authorization',
      `Bearer ${await firmarToken(actorAdminId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
    );

  expect(res.status).toBe(200);

  const usuarioActualizado = await prisma.usuario.findUnique({
    where: { id: objetivoId },
    select: { activo: true },
  });
  expect(usuarioActualizado?.activo).toBe(false);
});

it('MAESTRO: BAJA, motivoBaja: FALLECIMIENTO -> 200, revoca Usuario.activo y RegistroAuditoria.detalle marca cuentaRevocada: true', async () => {
  const objetivoId = await crearMaestroFixture({ sedeId: sedeMeridaId });

  const res = await request(app.getHttpServer())
    .patch(`/personas/${objetivoId}/estatus`)
    .send({ estatus: 'BAJA', motivoBaja: 'FALLECIMIENTO' })
    .set(
      'Authorization',
      `Bearer ${await firmarToken(actorAdminId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
    );

  expect(res.status).toBe(200);

  const usuario = await prisma.usuario.findUnique({
    where: { id: objetivoId },
    select: { activo: true },
  });
  expect(usuario?.activo).toBe(false);

  const registro = await prisma.registroAuditoria.findFirst({
    where: { entidadId: objetivoId, accion: AccionAuditoria.CAMBIO_ESTATUS },
    orderBy: { fecha: 'desc' },
  });
  expect(
    (registro?.detalle as Record<string, unknown> | null)?.cuentaRevocada,
  ).toBe(true);
});

it('MAESTRO: BAJA, motivoBaja: TERMINACION_INCAPACIDAD_PERMANENTE -> 200, revoca Usuario.activo', async () => {
  const objetivoId = await crearMaestroFixture({ sedeId: sedeMeridaId });

  const res = await request(app.getHttpServer())
    .patch(`/personas/${objetivoId}/estatus`)
    .send({ estatus: 'BAJA', motivoBaja: 'TERMINACION_INCAPACIDAD_PERMANENTE' })
    .set(
      'Authorization',
      `Bearer ${await firmarToken(actorAdminId, RolUsuario.ADMINISTRATIVO, sedeMeridaId)}`,
    );

  expect(res.status).toBe(200);

  const usuario = await prisma.usuario.findUnique({
    where: { id: objetivoId },
    select: { activo: true },
  });
  expect(usuario?.activo).toBe(false);
});
```

- [ ] **Step 2: Correr los 4 tests y verificar que fallan**

Run: `cd App/backend && pnpm test:e2e -- personas-estatus`
Expected: los 4 tests nuevos FALLAN en `expect(res.status).toBe(200)` recibiendo `400` (el enum `MotivoBaja` actual rechaza `FALLECIMIENTO` / `TERMINACION_INCAPACIDAD_PERMANENTE` vía la validación `Object.values(MotivoBaja).includes(...)` en `cambiarEstatus`). El resto de la suite sigue verde.

- [ ] **Step 3: Agregar los 2 valores al enum en el schema**

En `App/backend/prisma/schema.prisma`, reemplazar el enum `MotivoBaja` (líneas 51-56):

```prisma
enum MotivoBaja {
  RENUNCIA
  DESPIDO
  BAJA_TEMPORAL_SALUD
  FALLECIMIENTO                      // art. 53 fr. II LFT — muerte del trabajador
  TERMINACION_INCAPACIDAD_PERMANENTE // art. 53 fr. IV LFT — incapacidad/inhabilidad permanente
  OTRO
}
```

- [ ] **Step 4: Generar la migración y el cliente, y hand-editar el SQL**

Run: `cd App/backend && pnpm prisma migrate dev --name motivo_baja_terminaciones_art53`

Esto crea `prisma/migrations/<timestamp>_motivo_baja_terminaciones_art53/migration.sql`, lo aplica a la DB de dev y regenera `@prisma/client`.

Abrir el `migration.sql` generado. Prisma emite algo como:

```sql
ALTER TYPE "MotivoBaja" ADD VALUE 'FALLECIMIENTO';
ALTER TYPE "MotivoBaja" ADD VALUE 'TERMINACION_INCAPACIDAD_PERMANENTE';
```

Editarlo para que los valores queden **antes** de `OTRO` (cosmético — el enum nunca se usa para ordenar — pero mantiene el schema legible y consistente con el orden declarado):

```sql
ALTER TYPE "MotivoBaja" ADD VALUE 'FALLECIMIENTO' BEFORE 'OTRO';
ALTER TYPE "MotivoBaja" ADD VALUE 'TERMINACION_INCAPACIDAD_PERMANENTE' BEFORE 'OTRO';
```

> Nota: si `migrate dev` ya aplicó la versión sin `BEFORE`, el orden real en la DB de dev queda con los valores al final — no rompe nada. Dejar el `migration.sql` con `BEFORE 'OTRO'` para que en un entorno limpio (prod) el orden salga correcto. No crear una segunda migración solo por el orden.

Si `migrate dev` no regeneró el cliente por algún motivo, correr: `cd App/backend && pnpm prisma generate`.

- [ ] **Step 5: Refactorizar `calcularActivoPorEstatus` al set nombrado**

En `App/backend/src/personas/personas.service.ts`, agregar la constante estática de clase (junto a `JERARQUIA_NIVEL_PERMISO`, que ya es una estática de la clase) y reescribir el método:

```ts
/**
 * Motivos de `BAJA` que extinguen la relación laboral (arts. 47 y 53 LFT) y
 * por tanto revocan el acceso (`Usuario.activo = false`):
 * - RENUNCIA / DESPIDO — rescisión (art. 47) / terminación por voluntad del trabajador
 * - FALLECIMIENTO — art. 53 fr. II
 * - TERMINACION_INCAPACIDAD_PERMANENTE — art. 53 fr. IV
 *
 * `BAJA_TEMPORAL_SALUD` (suspensión, art. 42) y `OTRO` (sin clasificar) NO
 * revocan: la baja es cosmética hasta que se elija un motivo de terminación
 * explícito. Fail-safe: cortar acceso es una acción deliberada del admin.
 */
private static readonly MOTIVOS_BAJA_QUE_REVOCAN: ReadonlySet<string> = new Set([
  MotivoBaja.RENUNCIA,
  MotivoBaja.DESPIDO,
  MotivoBaja.FALLECIMIENTO,
  MotivoBaja.TERMINACION_INCAPACIDAD_PERMANENTE,
]);

private calcularActivoPorEstatus(
  estatus: string,
  motivoBaja: string | undefined,
): boolean {
  if (estatus !== EstatusEmpleado.BAJA) return true; // ACTIVO y LICENCIA siempre reactivan
  return !PersonasService.MOTIVOS_BAJA_QUE_REVOCAN.has(motivoBaja ?? '');
}
```

No tocar la validación de `motivoBaja` en `cambiarEstatus` — ya valida incondicionalmente contra `Object.values(MotivoBaja)`, así que los 2 valores nuevos se aceptan solos.

- [ ] **Step 6: Correr los 4 tests nuevos y verificar que pasan**

Run: `cd App/backend && pnpm test:e2e -- personas-estatus`
Expected: los 4 tests nuevos PASAN. El resto del archivo sigue verde (los tests de `BAJA_TEMPORAL_SALUD` / `OTRO` → `activo` sin revocar siguen pasando: guard de regresión).

- [ ] **Step 7: Correr la suite e2e completa**

Run: `cd App/backend && pnpm test:e2e`
Expected: todas las suites verdes (la corrida previa de referencia fue ~13 suites / ~209+ tests). Confirmar que ninguna suite existente se rompió.

- [ ] **Step 8: Commit**

```bash
git add App/backend/prisma/schema.prisma App/backend/prisma/migrations App/backend/src/personas/personas.service.ts App/backend/test/personas-estatus.e2e-spec.ts
git commit -m "feat(personas): fallecimiento e incapacidad permanente revocan acceso (art. 53 LFT)"
```

---

### Task 2: Frontend — tipo espejo `MotivoBaja` y aviso de revocación en el modal

**Files:**
- Modify: `App/frontend/src/lib/api/personas.ts` (tipo `MotivoBaja`, línea 341)
- Modify: `App/frontend/src/components/admin/ui/personas-listado/CambiarEstatusModal.tsx` (`MOTIVO_BAJA_LABEL` líneas 51-56; condición del aviso línea 151)

**Interfaces:**
- Consumes: enum `MotivoBaja` del backend (Task 1) — valores `RENUNCIA | DESPIDO | BAJA_TEMPORAL_SALUD | FALLECIMIENTO | TERMINACION_INCAPACIDAD_PERMANENTE | OTRO`.
- Produces: tipo `MotivoBaja` de `lib/api/personas.ts` actualizado; `CambiarEstatusModal` muestra el aviso "Esto revocará el acceso…" para los 4 motivos que revocan.

- [ ] **Step 1: Actualizar el tipo espejo**

En `App/frontend/src/lib/api/personas.ts`, línea 341, reemplazar:

```ts
export type MotivoBaja = 'RENUNCIA' | 'DESPIDO' | 'BAJA_TEMPORAL_SALUD' | 'OTRO';
```

por:

```ts
export type MotivoBaja =
  | 'RENUNCIA'
  | 'DESPIDO'
  | 'BAJA_TEMPORAL_SALUD'
  | 'FALLECIMIENTO'
  | 'TERMINACION_INCAPACIDAD_PERMANENTE'
  | 'OTRO';
```

- [ ] **Step 2: Agregar labels y el array de motivos que revocan en el modal**

En `App/frontend/src/components/admin/ui/personas-listado/CambiarEstatusModal.tsx`:

Reemplazar `MOTIVO_BAJA_LABEL` (líneas 51-56):

```ts
const MOTIVO_BAJA_LABEL: Record<MotivoBaja, string> = {
  RENUNCIA: 'Renuncia',
  DESPIDO: 'Despido',
  BAJA_TEMPORAL_SALUD: 'Baja temporal por salud',
  FALLECIMIENTO: 'Fallecimiento',
  TERMINACION_INCAPACIDAD_PERMANENTE: 'Terminación por incapacidad permanente',
  OTRO: 'Otro',
};
```

Justo debajo de `MOTIVO_BAJA_OPTIONS`, agregar:

```ts
/** Motivos que revocan el acceso a la cuenta — espejo de
 * `PersonasService.MOTIVOS_BAJA_QUE_REVOCAN` (backend). Mantener en sync. */
const MOTIVOS_BAJA_REVOCAN: MotivoBaja[] = [
  'RENUNCIA',
  'DESPIDO',
  'FALLECIMIENTO',
  'TERMINACION_INCAPACIDAD_PERMANENTE',
];
```

- [ ] **Step 3: Usar el array en la condición del aviso**

En el mismo archivo, la línea que hoy dice:

```tsx
{(motivoBaja === 'RENUNCIA' || motivoBaja === 'DESPIDO') && (
```

reemplazar por:

```tsx
{motivoBaja !== '' && MOTIVOS_BAJA_REVOCAN.includes(motivoBaja) && (
```

- [ ] **Step 4: Type-check**

Run: `cd App/frontend && pnpm tsc --noEmit`
Expected: sin errores. (El `Record<MotivoBaja, string>` obliga a que los 6 valores estén cubiertos; si falta uno, `tsc` lo marca acá.)

- [ ] **Step 5: Build**

Run: `cd App/frontend && pnpm build`
Expected: build exitoso, sin errores de tipos ni de lint que rompan la compilación.

- [ ] **Step 6: Commit**

```bash
git add App/frontend/src/lib/api/personas.ts App/frontend/src/components/admin/ui/personas-listado/CambiarEstatusModal.tsx
git commit -m "feat(admin): fallecimiento e incapacidad permanente en el modal de cambio de estatus"
```

---

### Task 3: Documentación

**Files:**
- Modify: `CLAUDE.md` (línea ~155 — nota de "Fase actual"; líneas ~401 y ~410-411 — contrato de `PATCH /personas/:id/estatus`)
- Modify: `documentacion_de_agentes/ESTADO.md` (agregar entrada de cierre al final, junto a la última entrada de 2026-08-27)

**Interfaces:**
- Consumes: nombres finales del enum y de la constante de Task 1 (`FALLECIMIENTO`, `TERMINACION_INCAPACIDAD_PERMANENTE`, `MOTIVOS_BAJA_QUE_REVOCAN`).
- Produces: docs consistentes con el código. No hay consumidores posteriores.

- [ ] **Step 1: Actualizar el contrato de `MotivoBaja` en `CLAUDE.md`**

En `CLAUDE.md`, línea ~401, reemplazar:

```
  contra el enum `MotivoBaja` (`RENUNCIA`, `DESPIDO`, `BAJA_TEMPORAL_SALUD`, `OTRO`),
```

por:

```
  contra el enum `MotivoBaja` (`RENUNCIA`, `DESPIDO`, `BAJA_TEMPORAL_SALUD`,
  `FALLECIMIENTO`, `TERMINACION_INCAPACIDAD_PERMANENTE`, `OTRO` — los 2 de terminación
  investigados contra el art. 53 fr. II y IV LFT),
```

- [ ] **Step 2: Actualizar la regla de `calcularActivoPorEstatus` en `CLAUDE.md`**

En `CLAUDE.md`, líneas ~410-411, reemplazar:

```
  (`false`) SOLO si `motivoBaja` es `RENUNCIA` o `DESPIDO` — `BAJA_TEMPORAL_SALUD`/
  `OTRO` NO revocan acceso.
```

por:

```
  (`false`) SOLO si `motivoBaja` es `RENUNCIA`, `DESPIDO`, `FALLECIMIENTO` o
  `TERMINACION_INCAPACIDAD_PERMANENTE` (los 4 extinguen la relación laboral, arts. 47 y
  53 LFT) — `BAJA_TEMPORAL_SALUD` (suspensión, art. 42) y `OTRO` NO revocan acceso. La
  lista vive en `PersonasService.MOTIVOS_BAJA_QUE_REVOCAN` (set estático).
```

- [ ] **Step 3: Actualizar la nota de "Fase actual" en `CLAUDE.md`**

En `CLAUDE.md`, línea ~155, reemplazar:

```
pendiente de si "Baja" revoca acceso real — resuelta: depende del `motivoBaja`,
`RENUNCIA`/`DESPIDO` sí revocan `Usuario.activo`, `BAJA_TEMPORAL_SALUD`/`OTRO` no,
`LICENCIA` nunca revoca.
```

por:

```
pendiente de si "Baja" revoca acceso real — resuelta: depende del `motivoBaja`,
`RENUNCIA`/`DESPIDO`/`FALLECIMIENTO`/`TERMINACION_INCAPACIDAD_PERMANENTE` (terminaciones,
arts. 47 y 53 LFT) sí revocan `Usuario.activo`, `BAJA_TEMPORAL_SALUD`/`OTRO` no,
`LICENCIA` nunca revoca.
```

- [ ] **Step 4: Agregar la entrada de cierre en `ESTADO.md`**

En `documentacion_de_agentes/ESTADO.md`, después de la última entrada de 2026-08-27 (la de "Cambio de estatus para MAESTRO (paridad con ADMINISTRATIVO)"), agregar:

```markdown
### Motivos de baja por terminación — `FALLECIMIENTO` / `TERMINACION_INCAPACIDAD_PERMANENTE` (art. 53 LFT) — ✅ CERRADO EN CÓDIGO (2026-08-27)

- **Contexto**: al verificar el modelo de estatus avanzado contra la Ley Federal
  del Trabajo se detectó que fallecimiento del trabajador (art. 53 fr. II) e
  incapacidad/inhabilidad permanente (art. 53 fr. IV) son terminaciones de la
  relación laboral que solo podían capturarse como `motivoBaja: OTRO`, que no
  revoca `Usuario.activo` — inconsistente con la regla ya acordada de que la baja
  definitiva revoca acceso.
- **Decisión de alcance**: se agregan SOLO esos 2 valores. `MUTUO_ACUERDO`
  (art. 53 fr. I) y `FIN_CONTRATO_TEMPORAL` (art. 53 fr. III) quedan fuera
  (decisión explícita del usuario). `OTRO` y `BAJA_TEMPORAL_SALUD` siguen sin
  revocar (fail-safe).
- **Backend**: enum `MotivoBaja` gana `FALLECIMIENTO` y
  `TERMINACION_INCAPACIDAD_PERMANENTE` (migración
  `motivo_baja_terminaciones_art53`, `ALTER TYPE ... ADD VALUE`, sin backfill).
  `PersonasService.calcularActivoPorEstatus` deja el OR inline y pasa a la
  constante estática `MOTIVOS_BAJA_QUE_REVOCAN` (`ReadonlySet`) con los 4 motivos
  que revocan — única fuente de verdad. La validación de `motivoBaja` contra el
  enum ya era incondicional, no se tocó.
- **Frontend**: tipo espejo `MotivoBaja` (`lib/api/personas.ts`) + labels en
  `CambiarEstatusModal.tsx`; el aviso "Esto revocará el acceso…" pasa de un
  check hardcodeado `RENUNCIA || DESPIDO` a un array `MOTIVOS_BAJA_REVOCAN` con
  los 4. Sin cambios en `administrativos/page.tsx` ni `maestros/page.tsx`.
- **Tests**: 4 casos e2e nuevos en `personas-estatus.e2e-spec.ts` (2 por rol,
  ADMINISTRATIVO y MAESTRO: `FALLECIMIENTO` y `TERMINACION_INCAPACIDAD_PERMANENTE`
  → `activo=false` + `cuentaRevocada=true`). Los casos de `BAJA_TEMPORAL_SALUD` /
  `OTRO` → sin revocar quedan como guard de regresión.
- **Verificación**: suite e2e completa en verde; `tsc --noEmit` + build frontend
  limpios.
- **Pendiente**: verificación manual en navegador (baja con cada motivo nuevo,
  confirmar cuenta sin acceso); push a `origin/dev`.
- Spec → `docs/superpowers/specs/2026-08-27-motivos-baja-terminacion-art53-design.md`,
  plan → `docs/superpowers/plans/2026-08-27-motivos-baja-terminacion-art53.md`.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md documentacion_de_agentes/ESTADO.md
git commit -m "docs: motivos de baja por terminación (art. 53 LFT) revocan acceso"
```

---

## Self-Review

**1. Spec coverage:**
- Spec §1 (schema + migración) → Task 1 Steps 3-4. ✅
- Spec §2 (backend `calcularActivoPorEstatus` → set nombrado) → Task 1 Step 5. ✅
- Spec §3 (frontend: tipo espejo + labels + array de aviso) → Task 2 Steps 1-3. ✅
- Spec §4 (4 casos e2e) → Task 1 Step 1. ✅
- Spec §5 (docs: `CLAUDE.md` contrato + `ESTADO.md`) → Task 3 Steps 1-4. ✅ (nota: la nota de "Fase actual" línea 155 se agregó como Step 3, no estaba explícita en el spec pero es coherente con "docs consistentes").
- Spec "Verificación" (e2e suite, tsc, build) → Task 1 Step 7, Task 2 Steps 4-5. ✅

**2. Placeholder scan:** Sin "TBD"/"TODO"/"handle edge cases"/"similar to Task N". Todo el código está escrito literal. ✅

**3. Type consistency:**
- `MOTIVOS_BAJA_QUE_REVOCAN` (backend, Task 1) vs `MOTIVOS_BAJA_REVOCAN` (frontend, Task 2) — nombres distintos a propósito (árboles distintos, sin código compartido, regla 11); el comentario de cada uno referencia al otro. Consistente.
- `calcularActivoPorEstatus(estatus, motivoBaja)` — firma idéntica antes y después. ✅
- Valores de enum `FALLECIMIENTO` / `TERMINACION_INCAPACIDAD_PERMANENTE` escritos igual en schema, service, tests, tipo frontend, labels y docs. ✅
- Helpers de test (`crearAdministrativoFixture`, `crearMaestroFixture`, `firmarToken`, `sedeMeridaId`, `actorAdminId`, `NivelPermiso`, `RolUsuario`, `AccionAuditoria`) — todos ya existen en `personas-estatus.e2e-spec.ts` (verificado contra los tests vecinos). ✅
