# DELETE /sedes/:id — regla de bloqueo por alumnos activos

**Fecha:** 2026-08-18
**Fase:** 6 (Sedes y carreras configurables), Día 22 — primer sub-proyecto de 3
(los otros dos, "mensajes de error en UI" y "ajustes de UX sueltos", se
brainstorming/planean por separado, uno a la vez).

## Contexto

`docs/roadmap.md`, Día 22: "Regla: no se puede eliminar una sede con alumnos
activos (bloqueo o soft delete)". `DELETE /sedes/:id` nunca se construyó — Día
20 lo dejó explícitamente fuera de alcance (`docs/roadmap.md`, nota de Día 20).

`CLAUDE.md` raíz clasifica `Sede` en la tabla "CRUD por tipo de entidad" bajo
"CRUD completo" (GET, GET/:id, POST, PUT, DELETE) — no bajo "Sin DELETE real"
(reservado a `Usuario` + los 4 perfiles + `PersonalServicios`, regla 3). El
diseño de este documento sigue ese patrón: DELETE real, no soft delete.

## Hallazgo que cambió el diseño inicial

`Sede` no tiene columna `activo`. `Carrera`, `Salon`, `Grupo`,
`PersonalServicios` y `Usuario` (maestros/administrativos) apuntan a `Sede`
sin `onDelete: Cascade` — Postgres rechaza el `DELETE` si existe cualquier fila
asociada, no solo alumnos activos.

Más importante: **`RegistroAuditoria.sedeId` es un FK obligatorio a `Sede`**, y
regla 5 (`CLAUDE.md`) dice que esa tabla es "solo inserción, nadie la
edita/borra". Toda sede tiene al menos 1 registro de auditoría desde el
momento en que se crea (su propia alta ya genera uno) — sin resolver esto,
**ninguna sede sería borrable jamás**, ni siquiera una vacía recién creada.

**Decisión:** `RegistroAuditoria.sedeId` pasa a nullable, con
`onDelete: SetNull`. El historial de auditoría sobrevive intacto (`accion`/
`entidad`/`detalle` no se tocan) pero pierde la referencia a la sede ya
eliminada — es una consecuencia estructural del `DELETE` del padre a nivel de
FK de Postgres, no un `UPDATE`/`DELETE` que la aplicación ejecute sobre
`registro_auditoria`, así que no viola regla 5 en espíritu.

## Diseño

### 1. Migración

`prisma/schema.prisma`:
```prisma
model RegistroAuditoria {
  ...
  sedeId  String?  @map("sede_id")
  sede    Sede?    @relation(fields: [sedeId], references: [id], onDelete: SetNull)
  ...
}
```
Sin otros cambios de schema — `Sede` no gana columna `activo`.

### 2. Backend — `SedesService.eliminar(id, actorPlatformAdminId)`

1. `findUnique` por `id` → `404 NOT_FOUND` si no existe (mismo patrón que
   `actualizar`).
2. Chequeo de negocio: `prisma.usuario.count({ where: { sedeId: id, rol:
   RolUsuario.ALUMNO, activo: true } })`. Si `> 0` → `409 CONFLICT`,
   `"No se puede eliminar: la sede tiene N alumno(s) activo(s)"` (N real en el
   mensaje).
   - **Criterio de "activo":** `Usuario.activo === true` — el mismo campo de
     baja lógica que ya usa todo el sistema (regla 3). Un alumno con
     `activo: false` no bloquea, sin importar su `PerfilAlumno.estatusAcademico`.
3. Si pasa el chequeo, transacción (`$transaction`):
   - `tx.registroAuditoria.create({ adminPlataformaId: actorPlatformAdminId,
     sedeId: sede.id, accion: AccionAuditoria.ELIMINACION, entidad: 'Sede',
     entidadId: sede.id, detalle: { nombre: sede.nombre } })` — snapshot del
     nombre, porque después del delete `entidadId` es lo único que queda para
     identificar qué sede era.
   - `tx.sede.delete({ where: { id } })` — el `onDelete: SetNull` de la
     migración nulifica `sedeId` en el registro recién creado (y en cualquier
     otro histórico de esa sede) automáticamente, dentro de la misma
     transacción.
4. Catch de `Prisma.PrismaClientKnownRequestError` con `code === 'P2003'`
   (FK violation — carreras/salones/grupos/personal/maestros/administrativos
   aún ligados a la sede) → `409 CONFLICT`,
   `"No se puede eliminar: la sede tiene otros datos asociados (carreras, personal, etc.)"`.
   Red de seguridad genérica — enumerar cada tabla posible sería frágil y se
   desactualizaría con cada tabla nueva que referencie `Sede` a futuro.

### 3. Backend — `SedesController`

```ts
@Delete(':id')
@UseGuards(PlatformAdminGuard)
async eliminar(@Param('id') id: string, @PlatformAdminActual() actorId: string) {
  const data = await this.sedesService.eliminar(id, actorId);
  return { data };
}
```
Mismo patrón de guard que `POST`/`PATCH`/`GET /sedes`. Éxito:
`200 { data: { ok: true } }` — mismo shape que `PATCH /auth/cambiar-password`
(no hay recurso que devolver tras un delete).

### 4. Frontend — `app/plataforma/sedes/page.tsx`

- `lib/api/sedes.ts` gana `eliminarSede(id: string): Promise<{ ok: true }>`.
- Botón "Eliminar" por fila de la tabla, junto a "Editar".
- Modal de confirmación nuevo y local a este árbol (archivo nuevo, ej.
  `app/plataforma/sedes/ConfirmarEliminarSedeModal.tsx`, o inline en
  `page.tsx` si queda simple) — sin componente compartido con `admin`/`alumno`,
  coherente con que `app/plataforma` ya vive aislado del resto del frontend
  desde Día 20 (JWT propio, `localStorage`, sin `proxy.ts`). Muestra el
  nombre de la sede a borrar, advierte que es irreversible, requiere click de
  confirmación explícito (no `window.confirm()` nativo — decisión del
  usuario).
- `useMutation` nueva: éxito → `toast.success` + invalida
  `['plataforma', 'sedes']`; error → `toast.error(err instanceof ApiError ?
  err.message : 'Error al eliminar la sede')`, mismo patrón que
  `crearMutation`/`actualizarMutation` ya en la página (el mensaje claro del
  backend —409 con la razón específica— llega tal cual al toast).

### 5. Testing

`test/sedes-crud.e2e-spec.ts` (ya existe, cubre POST/GET/PATCH de Día 20 —
se le agrega el describe block de `DELETE`):
- Sede vacía (recién creada, sin nada asociado) → `DELETE` exitoso, `200`.
- Sede con un alumno `activo: true` → `409 CONFLICT`, mensaje menciona la
  cantidad.
- Sede con un alumno `activo: false` (dado de baja) y sin ningún otro dato
  asociado → `DELETE` exitoso (el alumno de baja no bloquea).
- Sede con una carrera asociada (sin alumnos) → `409 CONFLICT` vía el catch de
  `P2003`.
- `id` inexistente → `404 NOT_FOUND`.
- Actor sin JWT de plataforma válido → `401 UNAUTHORIZED` (`PlatformAdminGuard`,
  sin test nuevo si ya hay cobertura genérica del guard — verificar).
- Verificar que el `RegistroAuditoria` de la `ALTA` original de una sede que
  se borra sobrevive después, con `sedeId: null`.

## Fuera de alcance de este sub-proyecto

- "Mensajes de error en UI" (pulido general, no solo de este flujo) y
  "ajustes de UX sueltos" (ej. botón "Copiar") — Día 22 los trae como puntos
  separados, se abordan uno a la vez en sesiones/specs propias.
- Cualquier tabla nueva que referencie `Sede` a futuro seguirá cayendo en el
  catch genérico de `P2003` sin necesitar cambios en este código — a
  propósito.
