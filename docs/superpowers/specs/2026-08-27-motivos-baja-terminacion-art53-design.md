# Motivos de baja por terminación (art. 53 LFT) — diseño

Fecha: 2026-08-27
Fases relacionadas: 9/10 (estatus avanzado — sin día de roadmap asignado)
Spec previo relacionado: `docs/superpowers/specs/2026-08-26-estatus-avanzado-y-borrado-grupos-design.md`

## Problema

`PATCH /personas/:id/estatus` (estatus avanzado, 2026-08-26) revoca `Usuario.activo`
únicamente cuando `estatus === 'BAJA'` y `motivoBaja ∈ { RENUNCIA, DESPIDO }`.
`BAJA_TEMPORAL_SALUD` y `OTRO` no revocan.

Brecha detectada al verificar el modelo contra la Ley Federal del Trabajo: el art. 53
lista otras causas de **terminación** de la relación de trabajo que la extinguen de
forma definitiva igual que renuncia/despido y que hoy solo pueden capturarse como
`OTRO` (que no revoca):

- Art. 53 fr. II — **muerte del trabajador**.
- Art. 53 fr. IV — **incapacidad física o mental o inhabilidad manifiesta** del
  trabajador que haga imposible la prestación del trabajo.

En ambos la persona deja de ser empleada, por lo que su cuenta debe quedar sin
acceso. Con el enum actual, un admin que da de baja por fallecimiento o incapacidad
permanente elige `OTRO` y la cuenta sigue activa — inconsistente con la regla de
negocio ya acordada ("la baja definitiva revoca acceso").

## Decisión de alcance

Se cierran **solo** las dos causas flageadas. No se agregan `MUTUO_ACUERDO` (art. 53
fr. I) ni `FIN_CONTRATO_TEMPORAL` (art. 53 fr. III) — decisión explícita del usuario
(2026-08-27): mínimo para cerrar exactamente la brecha reportada, sin ampliar el enum
más de lo necesario.

Fundamento legal (contraste que rige el diseño):

| Figura LFT | Vínculo laboral | Motivo en SIGE | Revoca `Usuario.activo` |
|---|---|---|---|
| Suspensión (arts. 42–45) | Subsiste, temporal | `BAJA` + `BAJA_TEMPORAL_SALUD` | No |
| Licencia con protección de empleo (arts. 132 fr. XXVII Bis, 170, 487+) | Subsiste | `LICENCIA` + cualquier `TipoLicencia` | No (nunca) |
| Rescisión / terminación (arts. 46–55) | Se extingue, definitivo | `BAJA` + `RENUNCIA` / `DESPIDO` / `FALLECIMIENTO` / `TERMINACION_INCAPACIDAD_PERMANENTE` | Sí |
| Motivo desconocido / no clasificado | — | `BAJA` + `OTRO` | No (fail-safe) |

`OTRO` se mantiene como "no revoca" a propósito: para cortar acceso el admin debe
elegir un motivo de terminación explícito. Esto evita bloquear a alguien por accidente
y deja el corte de acceso como acción deliberada.

## Cambios

### 1. Schema Prisma + migración

`App/backend/prisma/schema.prisma` — enum `MotivoBaja`:

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

Migración `motivo_baja_terminaciones_art53`:

- Generada con `pnpm prisma migrate dev --name motivo_baja_terminaciones_art53` desde
  `App/backend/`.
- Se hand-edita el SQL para insertar los valores en posición
  (`ALTER TYPE "MotivoBaja" ADD VALUE 'FALLECIMIENTO' BEFORE 'OTRO'`,
  `ALTER TYPE "MotivoBaja" ADD VALUE 'TERMINACION_INCAPACIDAD_PERMANENTE' BEFORE 'OTRO'`)
  para conservar `OTRO` como último valor del enum. Es cosmético (el enum nunca se usa
  para ordenar) pero mantiene el schema legible.
- Sin backfill: ninguna fila existente de `PerfilMaestro`/`PerfilAdministrativo`
  cambia. Los campos `motivoBaja` siguen nullable.

### 2. Backend — `App/backend/src/personas/personas.service.ts`

`calcularActivoPorEstatus` deja de comparar con un OR inline y usa un set estático
nombrado, única fuente de verdad de "qué motivos revocan acceso":

```ts
/**
 * Motivos de `BAJA` que extinguen la relación laboral (arts. 47 y 53 LFT) y por
 * tanto revocan el acceso (`Usuario.activo = false`). El resto de motivos
 * (`BAJA_TEMPORAL_SALUD` — suspensión art. 42; `OTRO` — sin clasificar) NO revocan:
 * la baja es cosmética hasta que se elija un motivo de terminación explícito.
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

La validación de `motivoBaja` contra el enum en `cambiarEstatus` ya es incondicional
(`Object.values(MotivoBaja).includes(...)`), así que los dos valores nuevos se aceptan
sin tocar esa rama. `RegistroAuditoria.detalle` (`tipoLicencia`, `motivoBaja`,
`cuentaRevocada`) tampoco cambia de forma — `cuentaRevocada` pasa a ser `true` para los
dos motivos nuevos porque `calcularActivoPorEstatus` devuelve `false`.

### 3. Frontend

`App/frontend/src/lib/api/personas.ts` — tipo espejo:

```ts
export type MotivoBaja =
  | 'RENUNCIA'
  | 'DESPIDO'
  | 'BAJA_TEMPORAL_SALUD'
  | 'FALLECIMIENTO'
  | 'TERMINACION_INCAPACIDAD_PERMANENTE'
  | 'OTRO';
```

`App/frontend/src/components/admin/ui/personas-listado/CambiarEstatusModal.tsx`:

- `MOTIVO_BAJA_LABEL` gana:
  - `FALLECIMIENTO: 'Fallecimiento'`
  - `TERMINACION_INCAPACIDAD_PERMANENTE: 'Terminación por incapacidad permanente'`
- El aviso inline "Esto revocará el acceso a la cuenta de esta persona." hoy usa
  `motivoBaja === 'RENUNCIA' || motivoBaja === 'DESPIDO'` hardcodeado. Pasa a un array
  local `MOTIVOS_BAJA_REVOCAN` con los 4 valores, para no volver a desincronizarse con
  el backend.
- Sin cambios en `app/admin/administrativos/page.tsx` ni `app/admin/maestros/page.tsx`
  — la jerarquía de `nivelPermiso` es ortogonal al motivo de baja.

### 4. Tests — `App/backend/test/personas-estatus.e2e-spec.ts`

Cuatro casos nuevos, dos por rol:

- `ADMINISTRATIVO: BAJA, motivoBaja: FALLECIMIENTO -> 200, revoca Usuario.activo,
  RegistroAuditoria.detalle.cuentaRevocada === true`
- `ADMINISTRATIVO: BAJA, motivoBaja: TERMINACION_INCAPACIDAD_PERMANENTE -> 200,
  revoca Usuario.activo`
- `MAESTRO: BAJA, motivoBaja: FALLECIMIENTO -> 200, revoca Usuario.activo,
  cuentaRevocada === true`
- `MAESTRO: BAJA, motivoBaja: TERMINACION_INCAPACIDAD_PERMANENTE -> 200,
  revoca Usuario.activo`

Los casos existentes de `BAJA_TEMPORAL_SALUD` / `OTRO` → `activo` sin revocar quedan
como guard de regresión (ya presentes, no se tocan). Los fixtures y su limpieza en
`afterAll` siguen el patrón ya corregido (2026-08-25): limpieza acotada a los `id`s
que la corrida creó, nunca por patrón de email/nombre.

### 5. Documentación

- Root `CLAUDE.md` — párrafo de contrato de `PATCH /personas/:id/estatus`: actualizar
  la lista del enum `MotivoBaja` (`RENUNCIA`, `DESPIDO`, `BAJA_TEMPORAL_SALUD`,
  `FALLECIMIENTO`, `TERMINACION_INCAPACIDAD_PERMANENTE`, `OTRO`) y la regla de
  `calcularActivoPorEstatus` (revoca si `motivoBaja` es `RENUNCIA` / `DESPIDO` /
  `FALLECIMIENTO` / `TERMINACION_INCAPACIDAD_PERMANENTE`; `BAJA_TEMPORAL_SALUD` / `OTRO`
  no revocan).
- `documentacion_de_agentes/ESTADO.md` — entrada de cierre nueva bajo el dominio de
  personas/backend + admin, con el fundamento legal (art. 53 fr. II y IV LFT) y el
  detalle de los 4 archivos tocados.

## Fuera de alcance

- `MUTUO_ACUERDO` (art. 53 fr. I) y `FIN_CONTRATO_TEMPORAL` (art. 53 fr. III) — no se
  agregan (decisión del usuario).
- UI de cambio de estatus para `ALUMNO` — `EstatusAcademico` no tiene el concepto de
  motivo de baja; la baja lógica de alumno sigue siendo cosmética.
- Limpiar `motivoBaja` a `null` al volver a `ACTIVO` — se mantiene como rastro
  histórico (decisión de diseño previa, sin cambio).
- Cualquier flujo administrativo especial para fallecimiento (notificaciones, cierre de
  expediente, etc.) — solo se cubre la revocación de acceso.

## Verificación

- Backend: `pnpm test:e2e` desde `App/backend/` (la suite auto-limpia sus fixtures).
- Frontend: `pnpm tsc --noEmit` y build (`pnpm build`) desde `App/frontend/`.
- Verificación manual en navegador (dar de baja un maestro/administrativo de prueba con
  cada motivo nuevo y confirmar que la cuenta queda sin acceso) — a cargo del usuario.
