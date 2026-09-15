# Plan — Estatus avanzado de administrativo (color, licencia, motivo de baja) + DELETE /grupos

> **Para agentes:** ejecutar vía `superpowers:subagent-driven-development` —
> un subagente fresco por task, con review entre tasks. No ejecutar inline.

## Contexto

Spec completo (aprobado por el usuario, 2026-08-26):
`docs/superpowers/specs/2026-08-26-estatus-avanzado-y-borrado-grupos-design.md`.
4 ajustes pedidos tras la verificación en navegador de Día 29 + CRUD de
salones + CRUD de administrativos:

1. Badge de color en "Estatus" (`app/admin/administrativos/page.tsx`).
2. `TipoLicencia` (enum LFT/IMSS) para `EstatusEmpleado.LICENCIA`.
3. `MotivoBaja` para `EstatusEmpleado.BAJA`, con revocación automática de
   `Usuario.activo` solo si el motivo es `RENUNCIA`/`DESPIDO`.
4. `DELETE /grupos/:id`, bloqueado por alumnos inscritos (mismo patrón que
   `DELETE /salones/:id`).

## Decisiones de diseño (ya cerradas, no re-discutir)

- `BAJA` gana `motivoBaja`; `LICENCIA` se queda como estatus aparte con su
  propio `tipoLicencia` — la cuenta ahí **nunca** se revoca.
- `tipoLicencia`/`motivoBaja` se agregan a `PerfilAdministrativo` **y**
  `PerfilMaestro` (aunque Maestro no tenga UI de cambio de estatus todavía).
- `DELETE /grupos/:id` es un `DELETE` real bloqueado por alumnos inscritos,
  no baja lógica — `Grupo` sigue siendo "CRUD completo".
- Badge de "Estatus": `ACTIVO`→verde (`success`), `LICENCIA`→ámbar
  (`warning`), `BAJA`→rojo (`crimson`/`error`) — rompe a propósito la
  reserva de "rojo = solo errores del sistema" que documenta
  `EstadoActivoBadge.tsx`, aceptado explícitamente por el usuario.
- `tipoLicencia`/`motivoBaja` NO se limpian a `null` al volver a `ACTIVO` —
  quedan como rastro histórico del último evento.
- Sin UI nueva para `MAESTRO` en este plan — el backend queda simétrico y
  listo, pero `app/admin/maestros/page.tsx` sigue siendo solo lectura.

## Global Constraints

- `sedeId` NUNCA en body/query del cliente — regla 2 de `CLAUDE.md` raíz.
- Todo catch/error handler loguea antes de responder — regla 12.
- Contrato de API: éxito `{ data: ... }`, error `{ error, code }`. Sin
  códigos nuevos — reutiliza `VALIDATION_ERROR`/`NOT_FOUND`/`CONFLICT`.
- `RegistroAuditoria` se crea en la misma transacción del cambio/borrado —
  regla 5.
- Regla 14: máximo 3 escrituras reales a DB al verificar algo a mano — no
  aplica a la suite de Jest (corre completa), sí aplica a cualquier
  verificación manual del implementador contra Supabase real.
- Frontend: React Query para todo fetch, árbol `app/admin/` sin compartir
  componentes con `app/alumno/`/`app/maestro/`/`app/plataforma/` (regla 11).
  No agregar dependencias nuevas.
- Next.js 16 tiene breaking changes vs. training data — revisar
  `App/frontend/node_modules/next/dist/docs/` antes de asumir bug propio.

## Task 1 — Backend: schema + `PATCH /personas/:id/estatus` extendido

**Archivos:**
- `App/backend/prisma/schema.prisma` (editar)
- `App/backend/src/personas/dto/cambiar-estatus.dto.ts` (editar)
- `App/backend/src/personas/personas.service.ts` (editar —
  `PersonasService.cambiarEstatus`)
- `App/backend/src/personas/personas.controller.ts` (editar —
  `cambiarEstatus`)
- `App/backend/test/personas-estatus.e2e-spec.ts` (editar — ya existe, 2
  tests actuales se rompen con este cambio y hay que corregirlos, ver punto
  6)

**Requisitos:**

1. **Schema** — 2 enums nuevos, junto a `EstatusEmpleado` (línea ~33 de
   `schema.prisma`):

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

   Campo nuevo en `PerfilMaestro` (junto a `estatus`, línea ~362) y en
   `PerfilAdministrativo` (junto a `estatus`, línea ~413), ambos nullable:

```prisma
tipoLicencia TipoLicencia? @map("tipo_licencia")
motivoBaja   MotivoBaja?  @map("motivo_baja")
```

   Migración: `pnpm prisma migrate dev --name estatus_avanzado_administrativo`
   (correr dentro de `App/backend/`).

2. **`CambiarEstatusDto`** — 2 campos opcionales nuevos:

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
   Mismo criterio que `estatus`: se validan como `string` acá, la
   validación real contra el enum correcto vive en el service (dependen del
   valor de `estatus`, `class-validator` no resuelve limpio un enum
   condicional a un sibling field).

3. **`PersonasService.cambiarEstatus`** — cambia la firma para aceptar los
   2 campos nuevos:

```ts
async cambiarEstatus(
  id: string,
  estatus: string,
  sedeId: string,
  actorUsuarioId: string,
  opciones: { tipoLicencia?: string; motivoBaja?: string } = {},
): Promise<{ ok: true }> {
```

   Dentro del bloque `else` que ya valida `EstatusEmpleado` para
   `MAESTRO`/`ADMINISTRATIVO` (justo después del `if (!perfilEmpleado ||
   !Object.values(EstatusEmpleado).includes(...))` que ya existe, antes del
   chequeo de jerarquía de `nivelPermiso`), agrega:

```ts
if (estatus === EstatusEmpleado.LICENCIA) {
  if (
    !opciones.tipoLicencia ||
    !Object.values(TipoLicencia).includes(opciones.tipoLicencia as TipoLicencia)
  ) {
    throw new BadRequestException({
      error:
        'tipoLicencia es requerido y debe ser válido cuando el estatus es LICENCIA',
      code: 'VALIDATION_ERROR',
    });
  }
}

if (estatus === EstatusEmpleado.BAJA) {
  if (
    !opciones.motivoBaja ||
    !Object.values(MotivoBaja).includes(opciones.motivoBaja as MotivoBaja)
  ) {
    throw new BadRequestException({
      error:
        'motivoBaja es requerido y debe ser válido cuando el estatus es BAJA',
      code: 'VALIDATION_ERROR',
    });
  }
}
```

   Agrega `TipoLicencia`, `MotivoBaja` al import de `@prisma/client` al
   inicio del archivo (junto a `EstatusEmpleado`, etc.).

4. **Cálculo de `Usuario.activo`** — método privado nuevo en
   `PersonasService`, testeable por separado:

```ts
private calcularActivoPorEstatus(
  estatus: string,
  motivoBaja: string | undefined,
): boolean {
  if (estatus !== EstatusEmpleado.BAJA) return true; // ACTIVO y LICENCIA siempre reactivan
  return !(
    motivoBaja === MotivoBaja.RENUNCIA || motivoBaja === MotivoBaja.DESPIDO
  );
}
```

5. **Dentro de la transacción existente** de `cambiarEstatus` (el
   `await this.prisma.$transaction(async (tx) => { ... })` que ya existe),
   modifica el `data` de los `update` de `perfilMaestro`/
   `perfilAdministrativo` para incluir los campos nuevos, y agrega el
   `update` de `Usuario.activo` **solo si el rol es `MAESTRO` o
   `ADMINISTRATIVO`** (nunca para `ALUMNO`):

```ts
} else if (usuario.rol === RolUsuario.MAESTRO) {
  await tx.perfilMaestro.update({
    where: { usuarioId: id },
    data: {
      estatus: estatus as EstatusEmpleado,
      tipoLicencia: (opciones.tipoLicencia as TipoLicencia) ?? undefined,
      motivoBaja: (opciones.motivoBaja as MotivoBaja) ?? undefined,
    },
  });
} else {
  await tx.perfilAdministrativo.update({
    where: { usuarioId: id },
    data: {
      estatus: estatus as EstatusEmpleado,
      tipoLicencia: (opciones.tipoLicencia as TipoLicencia) ?? undefined,
      motivoBaja: (opciones.motivoBaja as MotivoBaja) ?? undefined,
    },
  });
}

let activoNuevo: boolean | undefined;
if (usuario.rol === RolUsuario.MAESTRO || usuario.rol === RolUsuario.ADMINISTRATIVO) {
  activoNuevo = this.calcularActivoPorEstatus(estatus, opciones.motivoBaja);
  await tx.usuario.update({ where: { id }, data: { activo: activoNuevo } });
}
```

   `undefined` en Prisma `update` significa "no tocar el campo" (a
   diferencia de `null`) — así que en `ACTIVO`, donde `opciones.tipoLicencia`/
   `motivoBaja` no vienen, el `update` no los pisa a `null`, respetando la
   decisión de diseño "no se limpian, quedan como rastro histórico".

6. **`RegistroAuditoria.detalle`** — agrega los campos nuevos:

```ts
detalle: {
  rol: usuario.rol,
  estatusNuevo: estatus,
  tipoLicencia: opciones.tipoLicencia,
  motivoBaja: opciones.motivoBaja,
  cuentaRevocada: activoNuevo === false,
},
```

7. **`PersonasController.cambiarEstatus`** — pasa los 2 campos nuevos:

```ts
const data = await this.personasService.cambiarEstatus(
  id,
  body.estatus,
  sedeId,
  actorUsuarioId,
  { tipoLicencia: body.tipoLicencia, motivoBaja: body.motivoBaja },
);
```

8. **Corregir 2 tests existentes que este cambio rompe** en
   `personas-estatus.e2e-spec.ts` (ambos mandan `estatus: 'BAJA'`/
   `'LICENCIA'` sin los campos ahora requeridos):
   - `'actor ADMIN cambia el estatus de un administrativo AUXILIAR -> 200...'`
     (envía `{ estatus: 'BAJA' }`) → cambiar el `.send(...)` a
     `{ estatus: 'BAJA', motivoBaja: 'RENUNCIA' }`, y agregar una aserción
     nueva: `const usuarioActualizado = await prisma.usuario.findUnique({ where: { id: objetivoId }, select: { activo: true } }); expect(usuarioActualizado?.activo).toBe(false);`
   - `'actor SUPER_ADMIN cambia el estatus de otro SUPER_ADMIN -> 200...'`
     (envía `{ estatus: 'LICENCIA' }`) → cambiar a
     `{ estatus: 'LICENCIA', tipoLicencia: 'VACACIONES' }`.

9. **Tests nuevos** (agregar al mismo archivo, reusando
   `crearAdministrativoFixture` ya existente):
   - `estatus: LICENCIA` sin `tipoLicencia` → `400 VALIDATION_ERROR`.
   - `estatus: BAJA` sin `motivoBaja` → `400 VALIDATION_ERROR`.
   - `estatus: BAJA, motivoBaja: DESPIDO` → `200`, y
     `prisma.usuario.findUnique(...).activo === false`.
   - `estatus: BAJA, motivoBaja: BAJA_TEMPORAL_SALUD` → `200`, y
     `.activo === true` (sin cambio, el fixture nace `activo: true` por
     default de Supabase Auth/schema).
   - Reingreso: crear fixture, `PATCH .../estatus` con
     `{ estatus: 'BAJA', motivoBaja: 'RENUNCIA' }` (→ `activo: false`),
     luego un segundo `PATCH` con `{ estatus: 'ACTIVO' }` sobre el mismo
     `objetivoId` → `.activo === true` de nuevo.
   - `motivoBaja`/`tipoLicencia` con valor fuera del enum (ej.
     `motivoBaja: 'NO_EXISTE'`) → `400 VALIDATION_ERROR`.
   - `RegistroAuditoria.detalle` (castear a `Record<string, unknown>`)
     contiene `cuentaRevocada: true` en el caso `RENUNCIA`/`DESPIDO` y
     `cuentaRevocada: false` en `BAJA_TEMPORAL_SALUD`.

**Verificación:** `pnpm prisma migrate dev` corrido sin error, suite e2e
completa del backend en verde (no solo el archivo nuevo/editado) —
`cd App/backend && pnpm test:e2e`.

## Task 2 — Frontend: color de estatus + campos condicionales del modal

**Depende de Task 1.** No arrancar hasta que Task 1 tenga review clean —
necesita el shape real de la respuesta/enum del backend.

**Archivos:**
- `App/frontend/src/lib/api/personas.ts` (editar)
- `App/frontend/src/components/admin/ui/personas-listado/EstatusEmpleadoBadge.tsx`
  (nuevo)
- `App/frontend/src/app/admin/administrativos/page.tsx` (editar)
- `App/frontend/src/app/admin/administrativos/CambiarEstatusModal.tsx`
  (editar)

**Requisitos:**

0. `page.tsx` y `CambiarEstatusModal.tsx` importan `TipoLicencia`/
   `MotivoBaja` de `@/lib/api/personas`, junto a los tipos que ya importan
   de ahí (`EstatusEmpleado`, etc.).

1. **`lib/api/personas.ts`** — agrega, espejo de los 2 enums nuevos del
   backend (mismo criterio que `EstatusEmpleado` ya exportado ahí):

```ts
export type TipoLicencia =
  | 'VACACIONES'
  | 'INCAPACIDAD_ENFERMEDAD_GENERAL'
  | 'INCAPACIDAD_RIESGO_TRABAJO'
  | 'MATERNIDAD'
  | 'PATERNIDAD'
  | 'ADOPCION'
  | 'PERMISO_CON_GOCE_SUELDO'
  | 'PERMISO_SIN_GOCE_SUELDO'
  | 'OTRO';

export type MotivoBaja = 'RENUNCIA' | 'DESPIDO' | 'BAJA_TEMPORAL_SALUD' | 'OTRO';
```

   Y modifica `cambiarEstatusPersona` para aceptar los campos opcionales:

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

2. **`EstatusEmpleadoBadge.tsx`** (nuevo, mismo directorio/patrón que
   `EstadoActivoBadge.tsx` — leerlo primero):

```tsx
import type { EstatusEmpleado } from '@/lib/api/personas';

const ESTATUS_EMPLEADO_LABEL: Record<EstatusEmpleado, string> = {
  ACTIVO: 'Activo',
  LICENCIA: 'Licencia',
  BAJA: 'Baja',
};

const ESTATUS_EMPLEADO_ESTILO: Record<EstatusEmpleado, string> = {
  ACTIVO: 'border-success-border bg-success-bg text-success',
  LICENCIA: 'border-warning-border bg-warning-bg text-warning',
  BAJA: 'border-error-border bg-error-bg text-crimson',
};

/**
 * Badge de color para `EstatusEmpleado` (MAESTRO/ADMINISTRATIVO) — a
 * diferencia de `EstadoActivoBadge` (verde/ámbar, "inactivo" es ciclo de
 * vida no error), acá SÍ se usa rojo/crimson para BAJA a propósito: con 3
 * estados reales (no 2) se necesita diferenciar visualmente BAJA de
 * LICENCIA, y "dar de baja" (sobre todo por renuncia/despido) amerita la
 * alerta fuerte. Decisión explícita del usuario, 2026-08-26.
 */
export function EstatusEmpleadoBadge({ estatus }: { estatus: EstatusEmpleado }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${ESTATUS_EMPLEADO_ESTILO[estatus]}`}
    >
      {ESTATUS_EMPLEADO_LABEL[estatus]}
    </span>
  );
}
```

3. **`app/admin/administrativos/page.tsx`** — importa
   `EstatusEmpleadoBadge` y reemplaza la celda plana de estatus:

```tsx
<Td>
  <EstatusEmpleadoBadge estatus={administrativo.estatus} />
</Td>
```
   (reemplaza `<Td>{ESTATUS_EMPLEADO_LABEL[administrativo.estatus]}</Td>` —
   la constante `ESTATUS_EMPLEADO_LABEL` local de este archivo se queda tal
   cual, la sigue usando `ESTATUS_EMPLEADO_OPTIONS` para el filtro de
   `BuscadorFiltro`).

4. **`CambiarEstatusModal.tsx`** — agrega estado local y campos
   condicionales:

```tsx
const TIPO_LICENCIA_LABEL: Record<TipoLicencia, string> = {
  VACACIONES: 'Vacaciones',
  INCAPACIDAD_ENFERMEDAD_GENERAL: 'Incapacidad por enfermedad general',
  INCAPACIDAD_RIESGO_TRABAJO: 'Incapacidad por riesgo de trabajo',
  MATERNIDAD: 'Maternidad',
  PATERNIDAD: 'Paternidad',
  ADOPCION: 'Adopción',
  PERMISO_CON_GOCE_SUELDO: 'Permiso con goce de sueldo',
  PERMISO_SIN_GOCE_SUELDO: 'Permiso sin goce de sueldo',
  OTRO: 'Otro',
};
const TIPO_LICENCIA_OPTIONS = (
  Object.entries(TIPO_LICENCIA_LABEL) as Array<[TipoLicencia, string]>
).map(([value, label]) => ({ value, label }));

const MOTIVO_BAJA_LABEL: Record<MotivoBaja, string> = {
  RENUNCIA: 'Renuncia',
  DESPIDO: 'Despido',
  BAJA_TEMPORAL_SALUD: 'Baja temporal por salud',
  OTRO: 'Otro',
};
const MOTIVO_BAJA_OPTIONS = (
  Object.entries(MOTIVO_BAJA_LABEL) as Array<[MotivoBaja, string]>
).map(([value, label]) => ({ value, label }));
```

   Estado nuevo dentro del componente:

```tsx
const [tipoLicencia, setTipoLicencia] = useState<TipoLicencia | ''>('');
const [motivoBaja, setMotivoBaja] = useState<MotivoBaja | ''>('');
```

   Debajo del `<Select>` de estatus, condicional:

```tsx
{estatus === 'LICENCIA' && (
  <div className="mt-4">
    <label htmlFor="tipo-licencia-select" className={LABEL_CLASS}>
      Tipo de licencia
    </label>
    <Select
      id="tipo-licencia-select"
      value={tipoLicencia}
      onChange={(valor) => setTipoLicencia(valor as TipoLicencia)}
      options={TIPO_LICENCIA_OPTIONS}
      placeholder="Selecciona un tipo de licencia"
      disabled={guardando}
    />
  </div>
)}

{estatus === 'BAJA' && (
  <div className="mt-4">
    <label htmlFor="motivo-baja-select" className={LABEL_CLASS}>
      Motivo de baja
    </label>
    <Select
      id="motivo-baja-select"
      value={motivoBaja}
      onChange={(valor) => setMotivoBaja(valor as MotivoBaja)}
      options={MOTIVO_BAJA_OPTIONS}
      placeholder="Selecciona un motivo"
      disabled={guardando}
    />
    {(motivoBaja === 'RENUNCIA' || motivoBaja === 'DESPIDO') && (
      <p className="mt-2 rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning">
        Esto revocará el acceso a la cuenta de este administrativo.
      </p>
    )}
  </div>
)}
```

   El botón "Guardar" se deshabilita también cuando el campo condicional
   requerido está vacío:

```tsx
const faltaCondicional =
  (estatus === 'LICENCIA' && !tipoLicencia) ||
  (estatus === 'BAJA' && !motivoBaja);

// ...
<button
  type="button"
  onClick={() =>
    onGuardar(estatus, {
      tipoLicencia: tipoLicencia || undefined,
      motivoBaja: motivoBaja || undefined,
    })
  }
  disabled={guardando || faltaCondicional}
  className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
>
```

   `CambiarEstatusModalProps.onGuardar` cambia su firma a
   `onGuardar: (estatus: EstatusEmpleado, extra: { tipoLicencia?: TipoLicencia; motivoBaja?: MotivoBaja }) => void`.

   En `page.tsx`, el tipo de `vars` de `cambiarEstatusMutation` gana los 2
   campos opcionales y `mutationFn` los pasa a `cambiarEstatusPersona`:

```tsx
const cambiarEstatusMutation = useMutation({
  mutationFn: (vars: {
    usuarioId: string;
    estatus: EstatusEmpleado;
    tipoLicencia?: TipoLicencia;
    motivoBaja?: MotivoBaja;
  }) =>
    cambiarEstatusPersona(vars.usuarioId, vars.estatus, {
      tipoLicencia: vars.tipoLicencia,
      motivoBaja: vars.motivoBaja,
    }),
  // ...onSuccess/onError sin cambios
});
```

   Y el `onGuardar` del `<CambiarEstatusModal>` pasa esos valores:

```tsx
onGuardar={(estatusNuevo, extra) =>
  cambiarEstatusMutation.mutate({
    usuarioId: administrativoAEditar.usuarioId,
    estatus: estatusNuevo,
    ...extra,
  })
}
```

**Verificación:** sin suite de tests de frontend en este proyecto — `tsc
--noEmit` limpio + build sin errores + (si es posible) confirmar
visualmente en `localhost:3000/admin/administrativos`: badge con los 3
colores, campo de tipo de licencia al elegir LICENCIA, campo + aviso de
motivo al elegir BAJA con RENUNCIA/DESPIDO.

## Task 3 — Backend: `DELETE /grupos/:id`

**Independiente de Tasks 1-2** (dominio distinto, sin dependencias
cruzadas) — puede correr en paralelo.

**Archivos:**
- `App/backend/src/grupos/grupos.controller.ts` (editar)
- `App/backend/src/grupos/grupos.service.ts` (editar)
- `App/backend/test/grupos.e2e-spec.ts` (editar — ya existe, agregar
  bloque de tests de `DELETE`)

**Requisitos:**

1. **`GruposService.eliminar`** — calco exacto del patrón de
   `SalonesService.eliminar` (`App/backend/src/salones/salones.service.ts:220-260`,
   leerlo primero):

```ts
async eliminar(
  id: string,
  sedeId: string,
  actorUsuarioId: string,
): Promise<{ ok: true }> {
  const grupo = await this.prisma.grupo.findFirst({ where: { id, sedeId } });
  if (!grupo) {
    throw new NotFoundException({
      error: 'Grupo no encontrado en tu sede',
      code: 'NOT_FOUND',
    });
  }

  const alumnosInscritos = await this.prisma.grupoAlumno.count({
    where: { grupoId: id },
  });
  if (alumnosInscritos > 0) {
    throw new ConflictException({
      error: `No se puede eliminar: el grupo tiene ${alumnosInscritos} alumno(s) inscrito(s)`,
      code: 'CONFLICT',
    });
  }

  try {
    await this.prisma.$transaction(async (tx) => {
      await tx.registroAuditoria.create({
        data: {
          usuarioId: actorUsuarioId,
          sedeId,
          accion: AccionAuditoria.ELIMINACION,
          entidad: 'Grupo',
          entidadId: grupo.id,
          detalle: { nombre: grupo.nombre },
        },
      });
      await tx.grupo.delete({ where: { id } });
    });
  } catch (err) {
    console.error('[GruposService.eliminar] Error inesperado eliminando grupo:', err);
    throw new InternalServerErrorException({
      error: 'Error inesperado al eliminar el grupo',
      code: 'SERVER_ERROR',
    });
  }

  return { ok: true };
}
```
   Agrega `NotFoundException`, `InternalServerErrorException` al import de
   `@nestjs/common` si no están ya (ya está `ConflictException`,
   `Injectable`).

2. **`GruposController`** — nuevo método:

```ts
@Delete(':id')
@Roles(RolUsuario.ADMINISTRATIVO)
async eliminar(
  @Param('id') id: string,
  @SedeActual() sedeId: string,
  @ActorUsuarioId() actorUsuarioId: string,
) {
  const data = await this.gruposService.eliminar(id, sedeId, actorUsuarioId);
  return { data };
}
```
   Agrega `Delete`, `Param` al import de `@nestjs/common` (ya están `Body`,
   `Controller`, `Get`, `HttpCode`, `Post`, `Query`, `UseGuards`). Sin
   `@HttpCode` explícito → default `200`, mismo criterio que `DELETE
   /salones/:id`.

3. **Tests nuevos** en `grupos.e2e-spec.ts` (agregar al final del
   `describe` existente, reusando `firmarToken`/`sedeMeridaId`/
   `carreraMeridaId`/`salonMeridaId` ya declarados en el `beforeAll`):
   - Crear un grupo nuevo vía `POST /grupos` dentro del test (nombre con
     prefijo `Grupo E2E` para que el `afterAll` existente lo limpie), luego
     `DELETE /grupos/:id` → `200 { data: { ok: true } }`, y un segundo
     `GET /grupos` confirma que ya no aparece.
   - Grupo con un alumno inscrito → `409 CONFLICT` con la cantidad en el
     mensaje, el grupo sigue existiendo. Para inscribir el alumno sin crear
     un `Usuario`/`PerfilAlumno` nuevo, usa un alumno YA sembrado de Mérida:
     `const alumnoFixture = await prisma.perfilAlumno.findFirstOrThrow({ where: { usuario: { sedeId: sedeMeridaId } } });`
     y crea el `GrupoAlumno` directo con
     `await prisma.grupoAlumno.create({ data: { grupoId: idDelGrupoDePrueba, alumnoId: alumnoFixture.id } })`.
     **Importante:** el `afterAll` existente borra grupos por
     `nombre: { startsWith: 'Grupo E2E' }` — si este test deja un
     `GrupoAlumno` apuntando a ese grupo, el borrado del `afterAll` falla
     por FK. Agrega, ANTES del `deleteMany` de `grupo` en el `afterAll`
     existente:
     ```ts
     await prisma.grupoAlumno.deleteMany({
       where: { grupo: { nombre: { startsWith: 'Grupo E2E' } } },
     });
     ```
   - `id` de un grupo de otra sede (Valladolid) → `404 NOT_FOUND`.
   - `id` inexistente → `404 NOT_FOUND`.
   - Rol no `ADMINISTRATIVO` → `403 ROL_NO_AUTORIZADO`.
   - Sin `Authorization` → `401 UNAUTHORIZED`.

**Verificación:** suite e2e completa del backend en verde —
`cd App/backend && pnpm test:e2e`.

## Task 4 — Frontend: eliminar grupo (`app/admin/grupos/`)

**Depende de Task 3.** No arrancar hasta que Task 3 tenga review clean.

**Archivos:**
- `App/frontend/src/lib/api/grupos.ts` (editar)
- `App/frontend/src/app/admin/grupos/page.tsx` (editar)
- `App/frontend/src/app/admin/grupos/ConfirmarEliminarGrupoModal.tsx`
  (nuevo)

**Requisitos:**

1. **`lib/api/grupos.ts`** — agrega:

```ts
export function eliminarGrupo(id: string): Promise<{ ok: true }> {
  return apiFetchAuth<{ ok: true }>(`/grupos/${id}`, { method: 'DELETE' });
}
```

2. **`ConfirmarEliminarGrupoModal.tsx`** (nuevo) — copia estructural de
   `app/admin/salones/ConfirmarEliminarSalonModal.tsx` (leerlo primero),
   adaptado a `GrupoListItem` en vez de `Salon`:

```tsx
'use client';

import type { GrupoListItem } from '@/lib/api/grupos';

interface ConfirmarEliminarGrupoModalProps {
  grupo: GrupoListItem;
  onConfirmar: () => void;
  onCancelar: () => void;
  eliminando: boolean;
}

export function ConfirmarEliminarGrupoModal({
  grupo,
  onConfirmar,
  onCancelar,
  eliminando,
}: ConfirmarEliminarGrupoModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-slate">
          Eliminar grupo
        </h2>
        <p className="mt-2 text-sm text-slate/80">
          ¿Seguro que quieres eliminar <strong>{grupo.nombre}</strong>? Esta
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

3. **`app/admin/grupos/page.tsx`** — agrega estado, mutación y columna de
   acciones:

```tsx
const [grupoAEliminar, setGrupoAEliminar] = useState<GrupoListItem | null>(null);

const eliminarMutation = useMutation({
  mutationFn: (id: string) => eliminarGrupo(id),
  onSuccess: () => {
    toast.success('Grupo eliminado');
    setGrupoAEliminar(null);
    void queryClient.invalidateQueries({ queryKey: ['admin', 'grupos'] });
  },
  onError: (err) => {
    console.error('[AdminGruposPage] Error al eliminar grupo:', err);
    // Sin mapa de mensajes específicos acá a propósito: `resolverMensajeError`
    // ya hace passthrough del mensaje real del backend para CONFLICT (trae
    // la cantidad de alumnos inscritos) — pasar `MENSAJES_ERROR_GRUPO` acá
    // sería un bug, ese mapa tiene un CONFLICT distinto (nombre duplicado,
    // del alta) que pisaría el mensaje real de este error.
    toast.error(resolverMensajeError(err) ?? MENSAJE_ERROR_GENERICO);
    setGrupoAEliminar(null);
  },
});
```

   Nueva columna `Acciones` en el `<thead>` (después de "Capacidad") y su
   `<td>` correspondiente en cada fila:

```tsx
<td className="px-4 py-3">
  <button
    type="button"
    onClick={() => setGrupoAEliminar(grupo)}
    className="text-crimson hover:underline"
  >
    Eliminar
  </button>
</td>
```

   `colSpan` de las filas de "Cargando…"/error/vacío pasa de `5` a `6`
   (una columna más). Modal renderizado al final del componente:

```tsx
{grupoAEliminar && (
  <ConfirmarEliminarGrupoModal
    grupo={grupoAEliminar}
    eliminando={eliminarMutation.isPending}
    onConfirmar={() => eliminarMutation.mutate(grupoAEliminar.id)}
    onCancelar={() => setGrupoAEliminar(null)}
  />
)}
```

   Imports nuevos: `eliminarGrupo` de `@/lib/api/grupos`,
   `ConfirmarEliminarGrupoModal` de `./ConfirmarEliminarGrupoModal`.

**Verificación:** sin suite de tests de frontend en este proyecto — `tsc
--noEmit` limpio + build sin errores + (si es posible) confirmar
visualmente en `localhost:3000/admin/grupos`: eliminar un grupo vacío
funciona, un grupo con alumnos inscritos muestra el mensaje real del
backend con la cantidad (no el genérico de "nombre duplicado").

## Fuera de alcance (a propósito, ya en el spec)

- UI de cambio de estatus para `MAESTRO` — el backend ya lo soporta (Task
  1), pero nadie pidió la pantalla.
- Limpiar `tipoLicencia`/`motivoBaja` a `null` al volver a `ACTIVO`.
- Toggle manual de `Usuario.activo` fuera de "cambiar estatus" — no existe
  ni existía antes.
- `PersonalServicios` — no tiene `Usuario`/cuenta (regla 8), estos cambios
  no lo tocan.
- `Grupo.capacidad <= Salon.capacidad`, choque de horario/salón — mismo
  alcance ya establecido en Día 28, sin cambios acá.
