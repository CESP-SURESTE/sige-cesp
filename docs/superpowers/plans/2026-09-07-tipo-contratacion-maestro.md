# Plan — Tipo de contratación del maestro (base / temporal / contrato)

Fecha: 2026-09-07. Pedido directo del usuario, confirmado vía preguntas:
- Solo `PerfilMaestro` (NO `PerfilAdministrativo` — a diferencia del criterio de paridad
  usado para `tipoLicencia`/`motivoBaja`, el usuario pidió explícitamente "solo Maestro"
  esta vez, no extender a Administrativo).
- `TEMPORAL` captura un número de días (entero simple, sin fechas).
- `CONTRATO` captura fecha de inicio y fecha de fin (rango explícito).
- `BASE` no necesita ningún dato adicional (trabaja de forma indefinida).
- Obligatorio en el alta — como `tipoSangre`, sin poder omitirse al dar de alta un maestro.

Se ejecuta DESPUÉS de que el plan `2026-09-07-semestre-a-cuatrimestre.md` cierre por
completo (mismos archivos de backend en juego — `crear-persona.dto.ts`,
`personas.service.ts` — correr ambos planes a la vez sin worktree arriesga conflictos
de edición concurrente). Mismo criterio de ejecución: Subagent-Driven Development con
los agentes propios de este proyecto, sin worktree, directo sobre `dev`.

## Decisiones de diseño

1. **`tipoContratacion` nullable en DB, obligatorio solo a nivel de aplicación** —
   mismo criterio ya aceptado para `tipoSangre` (Fase de hoy, plan anterior): los
   maestros ya existentes en la DB de dev no tienen este dato y no se les puede inventar
   uno real; la columna es `TipoContratacion?`, pero `PerfilMaestroDto.tipoContratacion`
   es requerido (`@IsEnum` sin `@IsOptional`) para toda alta nueva.
2. **`diasTemporal`/`contratoFechaInicio`/`contratoFechaFin` son condicionales, no
   siempre requeridos** — mismo patrón ya usado para `tipoLicencia`/`motivoBaja` (Día
   22): la validación de "requerido SI el tipo elegido lo necesita" vive en el DTO vía
   `@ValidateIf` (para los checks de forma/tipo) y en el service (`PersonasService`)
   para la regla cruzada `contratoFechaFin` no puede ser anterior/igual a
   `contratoFechaInicio` — mismo criterio que las validaciones de fechas cruzadas de
   Calendario. `BASE` no usa ninguno de los 3 campos — si el cliente los manda de
   todos modos con `tipoContratacion: BASE`, se ignoran (no se valida activamente que
   NO vengan, mismo criterio ya documentado para los perfiles que no coinciden con
   `rol` en `CrearPersonaDto`).
3. **Se expone en `GET /perfil` (maestro) y se muestra en `app/maestro/page.tsx`** —
   aunque el pedido original solo mencionaba el alta, dejar un dato capturado pero
   invisible en el propio perfil rompería el patrón que sigue TODO el resto de este
   sistema (cada campo del alta termina viéndose en el perfil correspondiente). Se
   agrega a la sección "Datos personales" ya existente del perfil de maestro (que ya
   mezcla datos personales y laborales para este rol — no hay una sección "Datos
   laborales" separada en el perfil, solo en el formulario de alta del admin).
4. **Sin cambios en el listado de maestros del admin** (`GET /personas?rol=MAESTRO`,
   `app/admin/maestros/page.tsx`) — no se pidió, fuera de alcance (YAGNI). Tampoco se
   toca `PATCH /personas/:id/estatus` ni el flujo de baja/licencia — es un campo
   independiente, capturado solo al alta, sin flujo de edición posterior (mismo
   alcance que `cedulaProfesional`/`fechaContratacion` hoy, que tampoco son editables
   después del alta).

## Global Constraints

- Reglas 1/2/11/12 de `CLAUDE.md` raíz aplican.
- Migraciones: `migrate diff` + `migrate deploy`, nunca `migrate dev`.
- Sin código de error nuevo — reutilizar `VALIDATION_ERROR` para cualquier combinación
  inválida (`diasTemporal` faltante con `TEMPORAL`, fechas faltantes/cruzadas con
  `CONTRATO`, enum inválido).

## Task 1 — Backend (`backend-coder`)

**Schema (`schema.prisma`):**
- Nuevo enum `TipoContratacion { BASE, TEMPORAL, CONTRATO }`.
- En `PerfilMaestro`, agregar:
  - `tipoContratacion TipoContratacion? @map("tipo_contratacion")`
  - `diasTemporal Int? @map("dias_temporal")`
  - `contratoFechaInicio DateTime? @map("contrato_fecha_inicio")`
  - `contratoFechaFin DateTime? @map("contrato_fecha_fin")`

**Migración:** `migrate diff` + `migrate deploy` (todas columnas nuevas — sin riesgo de
rename esta vez, a diferencia del plan de `semestreActual`). Confirmar `migrate status`
up to date.

**DTO (`src/personas/dto/crear-persona.dto.ts`, `PerfilMaestroDto`):**
```ts
@IsEnum(TipoContratacion, { message: 'tipoContratacion debe ser BASE, TEMPORAL o CONTRATO' })
tipoContratacion!: TipoContratacion;

@ValidateIf((dto: PerfilMaestroDto) => dto.tipoContratacion === TipoContratacion.TEMPORAL)
@IsInt({ message: 'diasTemporal debe ser un entero' })
@Min(1, { message: 'diasTemporal debe ser al menos 1' })
diasTemporal?: number;

@ValidateIf((dto: PerfilMaestroDto) => dto.tipoContratacion === TipoContratacion.CONTRATO)
@IsDateString({}, { message: 'contratoFechaInicio debe ser una fecha ISO 8601 válida' })
contratoFechaInicio?: string;

@ValidateIf((dto: PerfilMaestroDto) => dto.tipoContratacion === TipoContratacion.CONTRATO)
@IsDateString({}, { message: 'contratoFechaFin debe ser una fecha ISO 8601 válida' })
contratoFechaFin?: string;
```
(nombres/mensajes exactos — el implementador puede ajustar redacción menor, pero los
nombres de campo y el criterio de `@ValidateIf` son vinculantes).

**`PersonasService.altaPersona`:**
- Al armar el `tx.perfilMaestro.create({ data: {...} })`, incluir los 4 campos nuevos.
- Antes de la transacción (o al inicio de ella, junto a otras validaciones de
  `PerfilMaestro`), agregar el chequeo cruzado: si `tipoContratacion === CONTRATO` y
  `contratoFechaFin <= contratoFechaInicio` → `400 VALIDATION_ERROR` (mensaje tipo
  "contratoFechaFin no puede ser anterior o igual a contratoFechaInicio").

**`perfil.service.ts`:** agregar `tipoContratacion`, `diasTemporal`,
`contratoFechaInicio`, `contratoFechaFin` al `select`/shape de `maestro` en
`GET /perfil` (mismo nivel que `cedulaProfesional`/`fechaContratacion`).

**Tests e2e:** el helper que arma `perfilMaestroValido()` (o equivalente) en
`test/personas.e2e-spec.ts`/`test/personas-mail.e2e-spec.ts`/cualquier otro que cree un
MAESTRO vía `POST /personas` necesita `tipoContratacion` por defecto (ej. `'BASE'`) para
no romper con el nuevo campo requerido — mismo patrón que se usó para `tipoSangre` en el
plan anterior. Agregar casos nuevos: alta de maestro sin `tipoContratacion` → 400; alta
`TEMPORAL` sin `diasTemporal` → 400; alta `CONTRATO` con `contratoFechaFin` anterior a
`contratoFechaInicio` → 400; alta `CONTRATO` válida → 201 con los campos persistidos;
`GET /perfil` de un maestro con `CONTRATO` devuelve las 2 fechas.

**Verificación:** suite completa (unit + e2e) en verde, `npx nest build` limpio.

## Task 2 — Frontend admin (`admin-coder`)

Depende de Task 1.

**`lib/api/personas.ts`:** agregar `TipoContratacion` (type union: `'BASE' | 'TEMPORAL'
| 'CONTRATO'`) y los 4 campos nuevos al tipo de `perfilMaestro` en el input de
`crearMaestro` (`tipoContratacion` requerido, los otros 3 opcionales).

**`app/admin/maestros/nuevo/page.tsx`** — dentro del fieldset "Datos laborales" ya
existente (líneas ~208-238), junto a `cedulaProfesional`/`fechaContratacion`:
- Agregar `tipoContratacion` al `maestroSchema` (zod `z.enum(['BASE','TEMPORAL','CONTRATO'])`,
  requerido) y a `DEFAULT_VALUES`.
- Agregar un `<select>` "Tipo de contratación" (usar el mismo componente `Select` que
  ya usa `InfoMedicaFieldset`/`CarreraModal`, no un `<select>` nativo) con labels
  legibles: "Base (planta)", "Temporal", "Por contrato".
- Con `useWatch` sobre `perfilMaestro.tipoContratacion` (mismo patrón que
  `tieneCondicionMedica`), mostrar condicionalmente:
  - Si `TEMPORAL`: input numérico "Días" (`diasTemporal`, requerido, entero ≥ 1).
  - Si `CONTRATO`: 2 inputs de fecha "Fecha de inicio"/"Fecha de fin"
    (`contratoFechaInicio`/`contratoFechaFin`, ambos requeridos) — con validación de
    cliente (zod `.refine` o similar) de que fin no sea anterior/igual a inicio, mismo
    espíritu que la validación del backend (UX, no reemplaza la validación real).
  - Si `BASE`: no mostrar ningún campo extra.
- Incluir estos campos en el payload de `crearMaestro(...)` de forma condicional según
  el tipo elegido (mismo patrón que el bloque condicional de `infoMedica` ya existente
  en este archivo).

**Verificación:** `pnpm build` y `pnpm lint` limpios.

## Task 3 — Frontend alumno/maestro (`alumno-coder`)

Depende de Task 1.

**`lib/api/perfil.ts`:** agregar `tipoContratacion`/`diasTemporal`/
`contratoFechaInicio`/`contratoFechaFin` (todos opcionales/nullable) al tipo
`PerfilMaestro`.

**`app/maestro/page.tsx`** — en `SeccionDatosPersonales` (la sección ya existe, mezcla
datos personales y laborales para este rol), agregar después de "Estatus laboral":
- `<Campo etiqueta="Tipo de contratación" valor={TIPO_CONTRATACION_LABEL[maestro.tipoContratacion]} />`
  (con un map de labels tipo `ESTATUS_EMPLEADO_LABEL` ya existente en ese archivo;
  manejar `null`/`undefined` con fallback "—", mismo criterio que el resto de `Campo`).
- Si `tipoContratacion === 'TEMPORAL'`: `<Campo etiqueta="Días" valor={String(maestro.diasTemporal)} />`.
- Si `tipoContratacion === 'CONTRATO'`: 2 campos con las fechas formateadas (reusar el
  helper `formatearFecha` que ya existe en este mismo archivo).

**Verificación:** `pnpm build` y `pnpm lint` limpios.

## Cierre del plan

1. `qa-backend`, `qa-admin`, `qa-alumno` en paralelo.
2. 1 ronda de fix si hay hallazgos Important/Critical.
3. Actualizar `ESTADO.md` y el "Contrato de API" de `CLAUDE.md` raíz (nuevo bullet para
   `PerfilMaestroDto.tipoContratacion`/`diasTemporal`/`contratoFechaInicio`/
   `contratoFechaFin`, mismo nivel de detalle que el resto del contrato).
4. NO commitear/pushear sin que el usuario lo pida.
5. Avisar al usuario cuando todo esté verde.
