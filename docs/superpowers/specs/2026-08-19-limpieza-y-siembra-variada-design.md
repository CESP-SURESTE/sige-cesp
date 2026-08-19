# Limpieza de datos de prueba + siembra variada (3 sedes)

**Fecha:** 2026-08-19
**Alcance:** Mantenimiento de datos — no es un objetivo del roadmap, es limpieza +
enriquecimiento de la base de datos de desarrollo, pedido directo del usuario.

## Contexto

Auditoría de solo lectura sobre la base real (Supabase, la misma que usa
`pnpm dev`/`npm run start:dev`) encontró:

| | Total | De `seed.ts` (real) | Basura |
|---|---|---|---|
| Alumnos | 219 | 16 | 203 |
| Maestros | 176 | 6 | 170 |
| Administrativos | 141 | 4 | 137 |
| Personal servicios | 4 | 4 | 0 |
| **Usuarios (Supabase Auth)** | **595** | 26 | **569** |

Los nombres genéricos (`Prueba`, `Fixture`, `Correo`, `Sin relación con el
marker`, strings aleatorios tipo `Yymrdslfqiduh`) indican que **la suite e2e
del backend corre contra esta misma base y no limpia después de cada
corrida** — cada `npm run test:e2e` deja basura permanente. Causa raíz
señalada y **parked a propósito** (decisión del usuario, 2026-08-19): se
documenta en `ESTADO.md` para una sesión futura dedicada a aislar la DB de
tests, no se corrige hoy.

También se encontraron 3 registros "Sebastian" (pruebas manuales del propio
usuario, uno con su correo real filtrado en `correoPersonal`) — caen dentro
de "basura" con el mismo criterio.

`AdminPlataforma` tiene una sola cuenta real (`plataforma.prueba@nexo-sd.mx`)
— fuera de alcance total, no se toca (es el único acceso a `/plataforma`).

## Decisiones (confirmadas con el usuario)

1. **Las 26 personas de `seed.ts` (anclas de tests e2e) se conservan** — se
   borra todo lo demás. No se reconstruye desde cero.
2. **Causa raíz (e2e ensuciando la DB) queda parked**, anotada en `ESTADO.md`,
   sin ticket formal — el usuario decide después si vale la pena atenderla.
3. **Volumen "extenso"** por sede: +12 alumnos variados, +4 maestros
   variados, +4 administrativos variados, +2 carreras nuevas.
4. **Se agrega una tercera sede, CESP Tizimín**, con el mismo bloque de
   anclas que Mérida/Valladolid (13 personas + 2 carreras + 2 personal de
   servicios) y el mismo tratamiento "extenso" encima.
5. **Fuera de alcance a propósito**: `PersonalServicios` no se enriquece (no
   se pidió), los alumnos nuevos NO se asignan a `GrupoAlumno` (esa feature
   no tiene pantalla en el admin todavía — Fase 9 del roadmap, sin
   construir — asignarlos sería trabajo sin ningún consumidor), y
   `AdminPlataforma` no se toca.

## Diseño

### 1. Identificación precisa de "basura" — lista de anclas, no heurística

`prisma/seed-helpers.ts` (nuevo, ver sección 2) exporta
`EMAILS_ANCLA: readonly string[]` — la lista exacta y completa de los
39 emails institucionales reales (13 por sede × 3 sedes: Mérida, Valladolid,
Tizimín) que NUNCA se borran. El script de limpieza borra todo `Usuario` con
`rol IN (ALUMNO, MAESTRO, ADMINISTRATIVO)` cuyo `email` no esté en esa lista
— sin depender de coincidencia de nombre (evita falsos positivos/negativos).

### 2. Refactor — extraer helpers de `seed.ts` a módulo compartido

Hoy `altaUsuarioSeed`/`seedAlumno`/`seedMaestro`/`seedAdministrativo`/
`seedPersonalServicios`/`seedSede`/`INFO_MEDICA_DEFAULT`/`getAdminClient` son
funciones locales no exportadas en `seed.ts` — no reutilizables desde otro
script. Se extraen tal cual (sin cambiar su lógica) a
`prisma/seed-helpers.ts`, con dos cambios mínimos:

- `seedAlumno` gana un parámetro opcional
  `estatusAcademico?: EstatusAcademico` (default `INSCRITO`, mismo
  comportamiento actual si no se pasa).
- `seedMaestro`/`seedAdministrativo` ganan un parámetro opcional
  `estatus?: EstatusEmpleado` (default `ACTIVO`, mismo comportamiento
  actual).
- `seedSede` gana un parámetro opcional en cada entrada de `alumnos`/
  `maestros`/`administrativos` (`estatusAcademico?`/`estatus?`) que se
  reenvía tal cual a los helpers de arriba.
- Se agrega `EMAILS_ANCLA` (sección 1), derivado de las 39 llamadas reales
  (una constante `as const`, no calculada dinámicamente — más simple y sin
  riesgo de desincronizarse si `seed.ts` cambia sin querer).

`seed.ts` pasa a importar estos helpers desde `seed-helpers.ts` en vez de
declararlos — su `main()` (las 3 llamadas a `seedSede`, ahora Mérida +
Valladolid + **Tizimín nueva**) no cambia de forma, solo de dónde vienen las
funciones. Sigue siendo el "seed base" — idempotente, seguro de re-correr.

### 3. Sede nueva — CESP Tizimín, mismo bloque que las otras 2

Agregada como tercera llamada a `seedSede` dentro de `seed.ts`, con el mismo
shape exacto que Mérida/Valladolid (2 carreras, 2 salones, 2 grupos, 2
administrativos, 3 maestros, 8 alumnos, 2 personal de servicios):

- `nombre`: "CESP Tizimín" (dato real usado por RLS/tests de aislamiento
  multi-sede a partir de hoy — igual de "ancla" que las otras 2 sedes,
  aunque ningún test e2e existente la referencie todavía).
- `direccion`/`ubicacionReferencia`: nomenclatura de calles real de Tizimín,
  referencia a la Catedral de los Santos Reyes (su landmark más conocido).
- `telefono`: lada 986 (código real de Tizimín).
- `dominio`: `cesp-tizimin.edu.mx`.
- `carreras`: `Licenciatura en Agronegocios` (clave `LAGRO-TIZ` — coherente
  con la vocación ganadera/agrícola real de la región, mismo criterio de
  "apariencia de producción" que ya sigue el resto del seed) e
  `Ingeniería en Sistemas` (clave `ING-SIS-TIZ`, mismo patrón de sufijo que
  `ING-SIS-MID`).
- `alumnos`/`maestros`/`administrativos`: nombres yucatecos nuevos, sin
  repetir ningún nombre/apellido/CURP/matrícula ya usado en Mérida o
  Valladolid. Matrículas `TIZ-2026-0001`..`0008`. El primer alumno y el
  primer administrativo de la lista quedan marcados como ancla (mismo
  patrón `// ANCLA` que ya usa el archivo para Mérida/Valladolid), aunque
  hoy ningún test los verifique — es la misma convención para cuando algún
  test futuro sí lo haga.

### 4. Script de siembra variada — `prisma/seed-variado.ts` (nuevo)

Consume `seed-helpers.ts` (no duplica lógica). Idempotente por el mismo
mecanismo que `seed.ts` (`altaUsuarioSeed` busca por email primero). Uso:
`SEED_DEMO_PASSWORD='...' npx ts-node prisma/seed-variado.ts` — requiere que
`seed.ts` ya se haya corrido antes (necesita las 3 sedes y sus carreras
base ya creadas; falla explícito y claro si una sede no existe, no la
crea él mismo — responsabilidad separada).

Por cada una de las 3 sedes:

- **+2 carreras**: incrementa la variedad de `nivel`/`modalidad` — hoy el
  100% de las carreras existentes son `LICENCIATURA`/`PRESENCIAL`
  (hardcodeado en `seedSede`, ver `seed-helpers.ts`). Las 2 nuevas por sede
  usan una combinación distinta cada una (ej. `TECNICO`/`EN_LINEA`,
  `MAESTRIA`/`SEMIPRESENCIAL`) — variedad real, no solo más filas iguales.
  Esto requiere que `seedSede`/`seedHelpers` dejen de hardcodear
  `nivel`/`modalidad` en la creación de carrera — se parametrizan (mismo
  criterio: default `LICENCIATURA`/`PRESENCIAL` si no se especifica, para
  no romper las llamadas existentes de `seed.ts`).
- **+12 alumnos**: distribución fija de `estatusAcademico` — 6
  `INSCRITO`, 2 `BAJA_TEMPORAL`, 2 `BAJA_DEFINITIVA`, 2 `EGRESADO`.
  Repartidos entre las 4 carreras de la sede (las 2 originales + las 2
  nuevas), matrícula continuando la secuencia ya usada por esa sede.
- **+4 maestros**: 2 `ACTIVO`, 1 `BAJA`, 1 `LICENCIA`.
- **+4 administrativos**: 2 `ACTIVO`, 1 `BAJA` (despedido), 1 `LICENCIA`
  (vacaciones) — puesto/nivelPermiso variado entre `AUXILIAR`/`RECEPCION`/
  `COORDINADOR_ACADEMICO` (ningún `SUPER_ADMIN` nuevo, ya hay uno real por
  sede desde `seed.ts`).

Total tras correr los 2 scripts: 3 sedes, 12 carreras (4 por sede), 105
personas con cuenta (35 por sede: 13 anclas + 22 nuevas), 6 personal de
servicios (sin cambio, 2 por sede).

### 5. Script de limpieza — `prisma/limpiar-datos-prueba.ts` (nuevo)

Orden de borrado, verificado contra las FK reales de las migraciones (no
supuestos):

1. Query de `Usuario` con `rol IN (ALUMNO, MAESTRO, ADMINISTRATIVO)` y
   `email NOT IN (EMAILS_ANCLA)`.
2. Para los que son `ALUMNO`: borrar primero sus filas de `GrupoAlumno`
   (`grupo_alumnos.alumno_id` es `ON DELETE RESTRICT` — bloquea el borrado
   del alumno si no se limpia antes).
3. Borrar esos `Usuario` por `id` — cascada automática a
   `PerfilAlumno`/`PerfilMaestro`/`PerfilAdministrativo` y sus
   `Contacto*`/`InfoMedica*` (`ON DELETE CASCADE` en las 3 relaciones).
   `RegistroAuditoria.usuarioId` ya es `ON DELETE SET NULL` (migración de
   Día 20) — el historial de auditoría sobrevive, solo pierde la
   referencia al usuario borrado, mismo criterio ya aceptado para `Sede`.
4. Por cada `Usuario` borrado en Postgres, borrar también la cuenta
   correspondiente en Supabase Auth (`client.auth.admin.deleteUser(id)`) —
   si no, el email queda huérfano en Auth y nadie podría volver a
   registrarse con él. Best-effort con logging por cada fallo individual
   (no aborta el resto del batch) — mismo criterio ya establecido en este
   proyecto para efectos secundarios no transaccionales (ej. Mailgun en el
   alta real). Con ~569 cuentas a borrar, se ejecuta en lotes pequeños con
   una pausa breve entre cada uno para no saturar la Admin API de Supabase.
5. Imprime el resumen final (cuántos de cada tipo se borraron, cuántos
   fallos de Auth si los hubo).

**Modo dry-run obligatorio primero**: el script corre en modo dry-run por
default (falla cerrado) — solo cuenta y lista qué se borraría, sin tocar
nada. Requiere el flag explícito `--confirmar` para ejecutar el borrado
real. Se corre el dry-run, se le muestra el resultado al usuario, y solo se
ejecuta con `--confirmar` tras su confirmación explícita en el chat — no
basta con la aprobación de este spec.

## Orden de ejecución

1. `seed-helpers.ts` (refactor, sin cambio de comportamiento para `seed.ts`).
2. `seed.ts` actualizado (Tizimín agregada) — se corre primero, sin tocar
   nada existente (upsert/idempotente).
3. `seed-variado.ts` — se corre después (necesita las 3 sedes ya existentes).
4. `limpiar-datos-prueba.ts` en modo dry-run — se revisa el resultado.
5. `limpiar-datos-prueba.ts` en modo real — solo tras confirmación explícita.

El orden 2-3 antes de 4-5 es deliberado: sembrar primero, limpiar después,
así el dry-run/borrado real ya ve la base final completa (3 sedes, datos
variados) y no hay ventana intermedia rara donde falte contenido.

## Fuera de alcance

- Aislar la suite e2e de esta base de datos (causa raíz, parked).
- `PersonalServicios` variado, `GrupoAlumno` para los alumnos nuevos,
  cualquier cambio a `AdminPlataforma`.
- Cualquier cambio de código de producción (`PersonasService`, endpoints,
  frontend) — esto es 100% scripts de mantenimiento de datos en `prisma/`.
