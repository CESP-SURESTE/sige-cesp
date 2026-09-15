# Plan — Renombrar "semestre" → "cuatrimestre" en todo el sistema

Fecha: 2026-09-07. Pedido directo del usuario ("cambiamos semestre por cuatrimestre"),
confirmado vía preguntas: (1) renombrar el campo/columna real, no solo la etiqueta
visible; (2) NO recalcular ningún número — `duracion`/`semestreActual` guardan
exactamente los mismos valores que hoy, solo cambia cómo se llaman/etiquetan.

Ejecutado vía Subagent-Driven Development con los agentes propios de este proyecto
(`backend-coder`, `admin-coder`, `alumno-coder`, `qa-backend`, `qa-admin`,
`qa-alumno`), sin worktree, directo sobre `dev`.

## Alcance exacto (barrido ya hecho con grep sobre "emestre")

**Renombrar el identificador real** `semestreActual` → `cuatrimestreActual` en:
- `PerfilAlumno.semestreActual` (schema, `@map("semestre_actual")` → `@map("cuatrimestre_actual")`).
- Columna real en DB: `perfiles_alumno.semestre_actual` → `cuatrimestre_actual` (RENAME, no drop+add — ver Global Constraints).
- `PerfilAlumnoDto.semestreActual` (`crear-persona.dto.ts`).
- Toda referencia de servicio/tipo que usa ese campo (backend: `personas.service.ts`,
  `perfil.service.ts`, `grupos.service.ts`; frontend: `lib/api/{personas,perfil,grupos}.ts`,
  y los componentes que los consumen).
- Todos los tests e2e que arman el payload de alta de alumno o leen `semestreActual`
  de una respuesta.

**Renombrar SOLO el texto/label** (sin tocar ningún identificador de código, porque el
campo real no se llama "semestre") en los lugares donde "Ciclo actual" (`Grupo.cicloActual`)
se etiqueta como "semestre" para el usuario — `cicloActual` NO se renombra, es un campo
distinto que ya no contiene la palabra "semestre" en su nombre.

**No tocar ningún número** — `Carrera.duracion` guarda los mismos valores sembrados hoy
(ej. `8` para las 4 licenciaturas). Ver Decisión de diseño 1 abajo para cómo documentar
esto sin dejar un comentario matemáticamente incorrecto.

## Decisiones de diseño

1. **El comentario de `crear-carrera.dto.ts` que justifica `duracion: 8` como "4 años x
   2 semestres/año"** queda desactualizado en su aritmética si solo se cambia la palabra
   a "cuatrimestres" (4 años x 3 cuatrimestres/año = 12, no 8). Se actualiza el
   comentario para que sea honesto: el campo se sigue llamando `duracion` y sigue
   contando lo mismo que contaba antes (una unidad de avance académico, hoy con el
   mismo valor numérico sembrado), pero la ETIQUETA de esa unidad cambió de "semestre" a
   "cuatrimestre" por decisión explícita del usuario SIN recalcular los valores ya
   sembrados — dejar esto anotado como una inconsistencia conocida y aceptada (no
   "arreglarla" inventando un recálculo que nadie pidió).
2. **Migración**: `prisma migrate diff` puede generar `DROP COLUMN` +
   `ADD COLUMN` para un rename de campo (no detecta renames semánticamente, solo
   diffea estructura) — eso BORRARÍA los valores reales de `semestre_actual` de
   cualquier alumno ya creado en la DB de dev (seed + altas de pruebas). El
   `backend-coder` DEBE generar el diff, inspeccionarlo, y si no es un
   `ALTER TABLE ... RENAME COLUMN`, reescribir la migración a mano como
   `ALTER TABLE "perfiles_alumno" RENAME COLUMN "semestre_actual" TO "cuatrimestre_actual";`
   antes de aplicarla — nunca aplicar un DROP+ADD sobre esta columna.

## Global Constraints

- Migraciones: `migrate diff` + `migrate deploy`, nunca `migrate dev` (roto, P3006).
- Regla 1/2/11/12 de `CLAUDE.md` raíz aplican igual que en el plan anterior.
- No cambiar ningún valor numérico de `duracion` ni de `semestreActual`/`cuatrimestreActual`
  ya sembrado — es un rename puro.
- No renombrar `Grupo.cicloActual` ni ninguna otra cosa que no contenga literalmente
  la palabra "semestre" en su identificador.

## Task 1 — Backend (`backend-coder`)

**Schema (`schema.prisma`):** línea ~386, `semestreActual Int @map("semestre_actual")`
→ `cuatrimestreActual Int @map("cuatrimestre_actual")`.

**Migración:** generar vía `migrate diff` (guardar el SQL en el scratchpad de sesión,
no en `/tmp`), verificar que sea un `RENAME COLUMN` (ver Decisión 2 — si no lo es,
reescribirlo a mano), aplicar con `migrate deploy`, confirmar `migrate status` up to date.

**DTO** `src/personas/dto/crear-persona.dto.ts` (líneas ~187-189): renombrar
`semestreActual` → `cuatrimestreActual` en el campo, decorators y mensajes de error
(`'semestreActual debe ser un entero'` → `'cuatrimestreActual debe ser un entero'`, etc.).

**`src/personas/personas.service.ts`:** interfaz `PersonaListItem`-ish (líneas ~34-35),
armado del `create` de `PerfilAlumno` (líneas ~791-792), `select` del listado (líneas
~1124-1125) y mapeo de salida (líneas ~1147-1148) — renombrar todas las ocurrencias.

**`src/perfil/perfil.service.ts`:** `select` del perfil propio de alumno (líneas
~140-141) y `select` del alumno en el contexto de compañeros (líneas ~430-431) —
renombrar ambas.

**`src/grupos/grupos.service.ts`:** interfaz de item de alumno matriculado (líneas
~43-44), `select` (líneas ~563-564) y mapeo (líneas ~576-577) — renombrar todas.

**`src/carreras/dto/crear-carrera.dto.ts`:** actualizar el comentario (líneas ~19-25)
según la Decisión de diseño 1 — cambiar "semestre(s)" por "cuatrimestre(s)" en el texto
y agregar la nota de que los valores sembrados NO se recalcularon.

**Tests e2e** — renombrar `semestreActual` → `cuatrimestreActual` en TODOS estos
archivos (payloads de alta y/o assertions, según cada caso — ya localizados por línea):
`test/personas.e2e-spec.ts` (líneas ~192, 416, 552, 633, 683), `test/personas-mail.e2e-spec.ts`
(~151), `test/personas-listado.e2e-spec.ts` (~33, 382, 393), `test/personas-estatus.e2e-spec.ts`
(~223), `test/perfil.e2e-spec.ts` (~54, 215, 385), `test/perfil-companeros.e2e-spec.ts`
(~33, 75, 100, 258), `test/grupos-alumnos.e2e-spec.ts` (~34, 113, 577), `test/calendario.e2e-spec.ts`
(~1016), `test/avisos.e2e-spec.ts` (~203), `test/malla-curricular.e2e-spec.ts` (~482, 507),
`test/publicacion-destinatarios.e2e-spec.ts` (~149). También `prisma/seed-helpers.ts`
(~183).

**No tocar** `prisma/migrations/20260805204943_init_modelo_completo/migration.sql` (línea
168) — es una migración histórica ya aplicada, nunca se edita retroactivamente.

**Verificación:** correr la suite completa (unit + e2e) y confirmar verde. `npx nest
build` limpio.

## Task 2 — Frontend admin (`admin-coder`)

Depende de Task 1 (nombres de campo del backend ya definidos: `cuatrimestreActual`).

- `src/lib/api/personas.ts` (líneas ~89, ~260): renombrar el campo en los tipos
  `CrearPersonaInput`/`PersonaListItem`.
- `src/lib/api/grupos.ts` (línea ~138): renombrar en `GrupoAlumnoListItem` (o el tipo
  equivalente de alumno matriculado).
- `src/app/admin/alumnos/nuevo/page.tsx`: renombrar el campo en el schema de Zod
  (~línea 90-93, incluye mensajes "El semestre debe..." → "El cuatrimestre debe..."),
  `DEFAULT_VALUES` (~124), label "Semestre actual" → "Cuatrimestre actual" (~331), `id`
  del input y su `htmlFor` (~330, 334), `register('perfilAlumno.semestreActual')` →
  `cuatrimestreActual` (~340), y el comentario del archivo (~101, ~108) que menciona el
  campo por nombre.
- `src/app/admin/alumnos/page.tsx`: encabezados de tabla "Semestre" → "Cuatrimestre"
  (hay 2, uno para la vista mobile y otro desktop — líneas ~99 y ~146), y
  `{alumno.semestreActual}` → `{alumno.cuatrimestreActual}` (~161).
- `src/app/admin/carreras/CarreraModal.tsx` (línea ~228): label "Duración (semestres)"
  → "Duración (cuatrimestres)". El campo `duracion` en sí NO se renombra (ver Global
  Constraints), solo el texto.
- `src/app/admin/grupos/NuevoGrupoModal.tsx` (líneas ~259, ~275-276): "Ciclo actual
  (semestre)" → "Ciclo actual (cuatrimestre)"; "Esta carrera tiene {duracion}
  semestre{...}" → "cuatrimestre{...}" (la lógica de pluralización `{'' : 's'}` no
  cambia, ambas palabras pluralizan igual agregando "s").
- `src/app/admin/grupos/page.tsx` (líneas ~65, ~255): `formatearPeriodo` — "Semestre
  ${cicloActual}" → "Cuatrimestre ${cicloActual}"; label del filtro "Ciclo actual
  (semestre)" → "(cuatrimestre)".
- `src/app/admin/grupos/[id]/page.tsx` (líneas ~235, ~323, ~361): "· Semestre
  {grupo.cicloActual}" → "· Cuatrimestre {...}"; encabezado de tabla "Semestre" →
  "Cuatrimestre"; `{a.semestreActual}` → `{a.cuatrimestreActual}`.
- `src/app/admin/grupos/[id]/ConfirmarMatricularAlumnoModal.tsx` (línea ~54): label
  "Semestre actual" → "Cuatrimestre actual", `alumno.semestreActual` →
  `alumno.cuatrimestreActual`.

**Verificación:** `pnpm build` y `pnpm lint` limpios.

## Task 3 — Frontend alumno (`alumno-coder`)

Depende de Task 1.

- `src/lib/api/perfil.ts` (líneas ~169, ~277): renombrar el campo en `PerfilAlumno` y
  en `CompaneroItem`.
- `src/app/alumno/page.tsx`:
  - Línea ~346: label "Semestre actual" → "Cuatrimestre actual",
    `alumno.semestreActual` → `alumno.cuatrimestreActual`.
  - Línea ~410: `` `${duracion} ${duracion === 1 ? 'semestre' : 'semestres'}` `` →
    `'cuatrimestre'`/`'cuatrimestres'`.
  - Líneas ~514-515 y ~588 (dentro del bloque YA COMENTADO de "Compañeros", oculto por
    el plan anterior 2026-09-07 — sigue comentado, no se reactiva acá): actualizar el
    texto/identificador `semestreActual`/"semestre" dentro del comentario también, para
    que si algún día se reactiva esa sección ya esté en sync con el campo renombrado —
    no descomentar nada, solo mantener el comentario correcto.

**Verificación:** `pnpm build` y `pnpm lint` limpios.

## Cierre del plan

1. `qa-backend`, `qa-admin`, `qa-alumno` en paralelo — cada uno confirma que no quedó
   ninguna referencia viva a `semestreActual` (grep de verificación) fuera de las
   migraciones históricas, que los tests pasan, que `duracion` no cambió de valor en
   ningún lado, y que el contrato frontend↔backend sigue coincidiendo campo por campo.
2. 1 ronda de fix si hay hallazgos Important/Critical.
3. Actualizar `documentacion_de_agentes/ESTADO.md` (cierre) y `CLAUDE.md` raíz —
   buscar TODAS las menciones de `semestreActual`/"semestre" en el "Contrato de API" y
   renombrarlas ahí también (es documentación viva del contrato actual, no un registro
   histórico como `ESTADO.md`), agregando una nota breve del rename en "Fase actual".
   No reescribir las entradas históricas de `ESTADO.md` de días pasados (esas son
   narrativa de lo que se construyó en su momento, no se corrigen retroactivamente).
4. NO commitear/pushear sin que el usuario lo pida (sigue habiendo WIP de otra sesión
   sin cerrar — login/ProfileDropdown — no mezclar; y el plan anterior de
   `tipoSangre`/RVOE tampoco se ha commiteado todavía).
5. Avisar al usuario cuando todo esté verde.
