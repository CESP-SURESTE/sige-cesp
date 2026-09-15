# Estatus avanzado de administrativo (color, licencia, motivo de baja) + DELETE /grupos

**Fecha:** 2026-08-26
**Fase:** ajustes post-verificación de Días 29/CRUD de salones/CRUD de
administrativos — el usuario probó todo en navegador (2026-08-26, "todo
correcto") y pidió estos 4 cambios antes de seguir.

## Contexto

Verificación manual en navegador de Día 29 + CRUD de `Salon` + CRUD de
`Administrativos` quedó **correcta**. Como parte de esa revisión, 4 ajustes:

1. El badge de "Estatus" en `app/admin/administrativos/page.tsx` hoy es
   texto plano, sin color — pedido: resaltarlo con color, mismo criterio que
   `EstadoActivoBadge` (columna "Cuenta").
2. `EstatusEmpleado.LICENCIA` no captura de qué tipo de licencia se trata —
   pedido: anotar el tipo (Vacaciones, con/sin goce de sueldo, etc.),
   investigado contra la Ley Federal del Trabajo (LFT) y práctica de IMSS.
3. `Grupo` está listado como "CRUD completo" en la tabla de `CLAUDE.md` raíz
   pero `DELETE /grupos/:id` nunca se construyó (Día 28 lo dejó fuera de
   alcance a propósito) — pedido: decidir e implementar la mejor manera.
4. La decisión pendiente documentada en `ESTADO.md` ("¿dar de Baja a un
   administrativo revoca acceso real?") se resuelve: depende del motivo —
   renuncia/despido sí revoca, baja temporal por salud u otro motivo no.

Decisiones ya cerradas con el usuario en esta sesión de brainstorming:
- `BAJA` gana un `motivo`; `LICENCIA` se queda como estatus aparte con su
  propio `tipoLicencia` — la cuenta ahí **nunca** se revoca.
- Los campos nuevos (`tipoLicencia`, `motivoBaja`) se agregan a
  `PerfilAdministrativo` **y** `PerfilMaestro` (aunque Maestro no tenga UI de
  cambio de estatus todavía — ver alcance de la sección 3).
- `DELETE /grupos/:id` es un `DELETE` real bloqueado por alumnos inscritos
  (mismo patrón que `DELETE /salones/:id`), no baja lógica.
- El badge de "Estatus" usa rojo (`crimson`/`error`) para `BAJA` — rompe a
  propósito la reserva de "rojo = solo errores del sistema" que documenta
  `EstadoActivoBadge.tsx`, aceptado explícitamente por el usuario.

## Diseño

### 1. Schema (`App/backend/prisma/schema.prisma`)

Dos enums nuevos:

```prisma
enum TipoLicencia {
  VACACIONES
  INCAPACIDAD_ENFERMEDAD_GENERAL
  INCAPACIDAD_RIESGO_TRABAJO
  MATERNIDAD
  PATERNIDAD
  ADOPCION
  PERMISO_CON_GOCE_SUELDO
  PERMISO_SIN_GOCE_SUELDO
  OTRO
}

enum MotivoBaja {
  RENUNCIA
  DESPIDO
  BAJA_TEMPORAL_SALUD
  OTRO
}
```

Campos nuevos, ambos nullable, en `PerfilAdministrativo` y `PerfilMaestro`:

```prisma
tipoLicencia TipoLicencia? @map("tipo_licencia")
motivoBaja   MotivoBaja?  @map("motivo_baja")
```

Nullable porque solo tienen sentido para el estatus correspondiente
(`LICENCIA`/`BAJA`) — en `ACTIVO` ambos quedan en `null` (no se limpian
retroactivamente los históricos al reactivar; el valor viejo queda como
rastro de la última licencia/baja, mismo criterio que "no hay borrado real
de historial de negocio" ya usado en `RegistroAuditoria`).

Migración: `pnpm prisma migrate dev --name estatus_avanzado_administrativo`.

### 2. Backend — `PersonasService.cambiarEstatus` (extensión, no módulo nuevo)

**DTO (`CambiarEstatusDto`)** gana 2 campos opcionales:

```ts
export class CambiarEstatusDto {
  @IsString()
  @IsNotEmpty({ message: 'estatus es requerido' })
  estatus!: string;

  @IsOptional()
  @IsString()
  tipoLicencia?: string;

  @IsOptional()
  @IsString()
  motivoBaja?: string;
}
```

Mismo criterio que `estatus`: se validan como `string` en el DTO, la
validación real contra el enum correcto vive en el service (dependen de
`estatus`, no son autocontenidas).

**`PersonasService.cambiarEstatus` — validaciones nuevas** (justo después de
validar que `estatus` es válido para el rol, antes de la transacción):

- Solo aplica si `usuario.rol` es `MAESTRO` o `ADMINISTRATIVO` (los únicos 2
  con `EstatusEmpleado` que ahora tienen estos campos en el schema; `ALUMNO`
  nunca los toca).
- `estatus === 'LICENCIA'` → `tipoLicencia` requerido y debe pertenecer a
  `TipoLicencia`, si no `400 VALIDATION_ERROR` ("tipoLicencia es requerido y
  debe ser válido cuando el estatus es LICENCIA").
- `estatus === 'BAJA'` → `motivoBaja` requerido y debe pertenecer a
  `MotivoBaja`, mismo código si falla.
- `estatus === 'ACTIVO'` → si vienen `tipoLicencia`/`motivoBaja` en el body,
  se ignoran (no se persisten, no es error — evita que la UI tenga que
  limpiarlos a mano si el usuario cambia de opinión en el modal antes de
  guardar).

**Cálculo de `Usuario.activo`** (función pura nueva,
`PersonasService.calcularActivoPorEstatus`, para poder testear la matriz
sin pasar por HTTP):

```ts
private calcularActivoPorEstatus(
  estatus: string,
  motivoBaja: string | undefined,
): boolean {
  if (estatus !== 'BAJA') return true; // ACTIVO y LICENCIA siempre reactivan
  return !(motivoBaja === MotivoBaja.RENUNCIA || motivoBaja === MotivoBaja.DESPIDO);
}
```

Dentro de la transacción existente de `cambiarEstatus`, junto al `update`
del perfil (`perfilMaestro`/`perfilAdministrativo`, incluyendo ahora
`tipoLicencia`/`motivoBaja`) se agrega, **solo si `rol` es `MAESTRO` o
`ADMINISTRATIVO`**:

```ts
const activoNuevo = this.calcularActivoPorEstatus(estatus, dto.motivoBaja);
await tx.usuario.update({ where: { id }, data: { activo: activoNuevo } });
```

`ALUMNO` no se toca — su `Usuario.activo` sigue totalmente fuera de alcance
de este cambio (nadie lo pidió, `EstatusAcademico` no tiene el concepto de
"renuncia").

`RegistroAuditoria.detalle` gana los 2 campos nuevos + el resultado:
`{ rol, estatusNuevo, tipoLicencia, motivoBaja, cuentaRevocada: !activoNuevo }`.

**Nota de alcance:** el backend acepta `tipoLicencia`/`motivoBaja` para
`MAESTRO` igual que para `ADMINISTRATIVO` (el schema ya tiene el campo en
ambos, por decisión del usuario), aunque hoy **ningún frontend** dispara un
cambio de estatus para `MAESTRO` — `app/admin/maestros/page.tsx` sigue
siendo solo lectura (Día 19). El endpoint queda simétrico y listo, sin
construir la UI de Maestro hoy (nadie la pidió).

### 3. Frontend — `app/admin/administrativos/`

**`EstatusEmpleadoBadge.tsx` (componente nuevo, mismo directorio/patrón que
`EstadoActivoBadge`):**

```tsx
const ESTILO: Record<EstatusEmpleado, string> = {
  ACTIVO: 'border-success-border bg-success-bg text-success',
  LICENCIA: 'border-warning-border bg-warning-bg text-warning',
  BAJA: 'border-error-border bg-error-bg text-crimson',
};
```
Mismo `<span>` de badge redondeado que `EstadoActivoBadge`, con el label ya
existente (`ESTATUS_EMPLEADO_LABEL`). Reemplaza el `<Td>{ESTATUS_EMPLEADO_LABEL[...]}</Td>`
plano de la tabla.

**`CambiarEstatusModal.tsx` — campos condicionales:**
- `estatus === 'LICENCIA'` → aparece `<Select>` "Tipo de licencia"
  (`TIPO_LICENCIA_OPTIONS`, labels en español: "Vacaciones", "Incapacidad
  por enfermedad general", "Incapacidad por riesgo de trabajo",
  "Maternidad", "Paternidad", "Adopción", "Permiso con goce de sueldo",
  "Permiso sin goce de sueldo", "Otro"), requerido antes de habilitar
  "Guardar".
- `estatus === 'BAJA'` → aparece `<Select>` "Motivo de baja"
  (`MOTIVO_BAJA_OPTIONS`: "Renuncia", "Despido", "Baja temporal por salud",
  "Otro"), requerido antes de habilitar "Guardar". Si el motivo elegido es
  `RENUNCIA` o `DESPIDO`, se muestra un aviso inline (`bg-warning-bg` o
  similar, no modal de confirmación aparte — mismo modal) del tipo: "Esto
  revocará el acceso a la cuenta de este administrativo."
- Botón "Guardar" deshabilitado (además de `guardando`) si el campo
  condicional requerido está vacío.

**`lib/api/personas.ts` — `cambiarEstatusPersona`:** gana params opcionales:

```ts
export function cambiarEstatusPersona(
  usuarioId: string,
  estatus: string,
  extra?: { tipoLicencia?: string; motivoBaja?: string },
): Promise<{ ok: true }> {
  return apiFetchAuth<{ ok: true }>(`/personas/${usuarioId}/estatus`, {
    method: 'PATCH',
    body: JSON.stringify({ estatus, ...extra }),
  });
}
```
Más los tipos `TipoLicencia`/`MotivoBaja` (espejo de los enums nuevos, mismo
criterio que `EstatusEmpleado` ya exportado ahí).

Toast de éxito en `page.tsx` se mantiene genérico ("Estatus actualizado") —
sin variante especial para "cuenta revocada": el admin ya vio el aviso
inline antes de confirmar, no hace falta repetirlo después.

### 4. `DELETE /grupos/:id`

**`GruposController`:** nuevo método, mismos guards de clase
(`SedeGuard`+`RolesGuard(ADMINISTRATIVO)`).

**`GruposService.eliminar(id, sedeId, actorUsuarioId)`** — calco exacto de
`SalonesService.eliminar`:

```ts
async eliminar(id: string, sedeId: string, actorUsuarioId: string) {
  const grupo = await this.prisma.grupo.findFirst({ where: { id, sedeId } });
  if (!grupo) {
    throw new NotFoundException({ error: 'Grupo no encontrado en tu sede', code: 'NOT_FOUND' });
  }

  const alumnosInscritos = await this.prisma.grupoAlumno.count({ where: { grupoId: id } });
  if (alumnosInscritos > 0) {
    throw new ConflictException({
      error: `No se puede eliminar: el grupo tiene ${alumnosInscritos} alumno(s) inscrito(s)`,
      code: 'CONFLICT',
    });
  }

  await this.prisma.$transaction(async (tx) => {
    await tx.registroAuditoria.create({
      data: { usuarioId: actorUsuarioId, sedeId, accion: AccionAuditoria.ELIMINACION,
        entidad: 'Grupo', entidadId: grupo.id, detalle: { nombre: grupo.nombre } },
    });
    await tx.grupo.delete({ where: { id } });
  });

  return { ok: true };
}
```

Éxito: `200 { data: { ok: true } }`. Sin código de error nuevo.

**Frontend — `app/admin/grupos/`:** botón "Eliminar" por fila +
`ConfirmarEliminarGrupoModal.tsx` nuevo, calco de
`ConfirmarEliminarSalonModal.tsx` (mismo overlay, mismo botón rojo
`bg-crimson`, mismo manejo de error `409` mostrando el mensaje real del
backend en vez del genérico).

### 5. Fuera de alcance (explícito)

- UI de cambio de estatus para `MAESTRO` — el schema/backend ya lo soportan
  (sección 2), pero nadie pidió la pantalla.
- Limpiar `tipoLicencia`/`motivoBaja` a `null` al volver a `ACTIVO` — se
  quedan como rastro histórico del último evento, no se borran.
- Reactivar manualmente `Usuario.activo` de un `RENUNCIA` sin pasar por
  "cambiar estatus a ACTIVO" — no existe (ni existía antes) un toggle
  directo de `Usuario.activo`; reingresar significa volver a cambiar el
  estatus, que ya reactiva automáticamente (sección 2).
- Alcance de `PersonalServicios`: no tiene `Usuario`/cuenta (regla 8), estos
  cambios no lo tocan en absoluto.

### 6. Testing

`personas-estatus.e2e-spec.ts` (extender el existente):
- `estatus: LICENCIA` sin `tipoLicencia` → `400 VALIDATION_ERROR`.
- `estatus: LICENCIA` con `tipoLicencia` válido → `200`, perfil actualizado,
  `Usuario.activo` sigue `true`.
- `estatus: BAJA` sin `motivoBaja` → `400 VALIDATION_ERROR`.
- `estatus: BAJA, motivoBaja: RENUNCIA` → `200`, `Usuario.activo === false`.
- `estatus: BAJA, motivoBaja: DESPIDO` → `Usuario.activo === false`.
- `estatus: BAJA, motivoBaja: BAJA_TEMPORAL_SALUD` → `Usuario.activo === true`.
- Reingreso: `BAJA/RENUNCIA` (activo=false) → luego `estatus: ACTIVO` →
  `Usuario.activo === true` de nuevo.
- `RegistroAuditoria.detalle` contiene `cuentaRevocada` correcto en los
  casos de arriba.
- Rol `MAESTRO` con los mismos casos (schema simétrico, sección 2) — sin UI
  todavía, pero el endpoint ya es consumible.

`grupos.e2e-spec.ts` (extender):
- `DELETE /grupos/:id` sin alumnos inscritos → `200`, grupo ya no existe.
- Con al menos 1 `GrupoAlumno` → `409 CONFLICT` con la cantidad en el
  mensaje, grupo sigue existiendo.
- `id` de otra sede → `404 NOT_FOUND`.
- Actor sin rol `ADMINISTRATIVO` → `403 ROL_NO_AUTORIZADO`.

Verificación manual: los 4 casos de estatus (Activo/Licencia/Baja-renuncia/
Baja-temporal) desde `app/admin/administrativos/page.tsx`, confirmando color
del badge y que la cuenta efectivamente se revoca solo cuando corresponde;
borrado de un grupo vacío vs. uno con alumnos desde `app/admin/grupos/page.tsx`.
