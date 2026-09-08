# Plan — Perfil de maestro igual al de alumno + tipo de sangre obligatorio + RVOE opcional/procedencia

Fecha: 2026-09-07. Pedido directo del usuario, 4 cambios concretos, sin roadmap
asignado. Ejecutado vía Subagent-Driven Development con los agentes propios de
este proyecto (`backend-coder`, `admin-coder`, `alumno-coder`, `qa-backend`,
`qa-admin`, `qa-alumno`) — sin worktree, directo sobre `dev` (criterio ya
establecido en este repo).

## Contexto verificado antes de planear

- `Carrera.rvoe` es `String` (requerido) en el schema hoy; no existe
  `procedenciaRvoe`.
- `InfoMedicaAlumno`/`InfoMedicaMaestro`/`InfoMedicaAdministrativo` (+
  `InfoMedicaPersonalServicios`, sin código de aplicación — `PersonalServicios`
  no tiene ni controller ni service, regla 8) son idénticos entre sí, sin
  campo de tipo de sangre.
- `InfoMedicaDto` (backend) y `infoMedicaSchema`/`InfoMedicaFieldset.tsx`
  (frontend) son compartidos por los 3 roles — un solo cambio cubre a
  ALUMNO/MAESTRO/ADMINISTRATIVO, que es "toda la gente" real de este sistema
  (`PersonalServicios` no pasa por `POST /personas`).
- `app/alumno/page.tsx` (rediseño 2026-08-21): banner+avatar (`EncabezadoPerfil`)
  + sidebar de navegación (`SidebarSecciones`) + panel de una sección a la vez
  (`PanelSeccion`), secciones reales: Datos personales, Sede, Carrera,
  Contactos, Compañeros.
- `app/maestro/page.tsx` (Día 17, sin rediseñar): una sola tarjeta con
  secciones apiladas (Datos personales, Sede, Contactos, Asignaciones). Regla
  11 aplica también entre `app/alumno/` y `app/maestro/` (árboles
  independientes, sin componentes compartidos) — el propio archivo lo dice:
  "no importa nada de `app/alumno/page.tsx`".
- `prisma migrate dev` sigue roto en este repo (`P3006`, shadow DB sin schema
  `auth`). Migraciones se generan con
  `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script`
  y se aplican con `npx prisma migrate deploy` — nunca `migrate dev`.

## Decisiones de diseño (documentadas acá, sin pedido explícito de la forma exacta)

1. **`tipoSangre` es NOT NULL a nivel de aplicación, NULLABLE a nivel de DB.**
   Las 3 tablas `InfoMedica*` ya tienen filas reales (seed + altas hechas en
   dev) sin este dato — no existe un valor de sangre real que se pueda
   inventar para retro-llenarlas. En vez de forzar un `NOT NULL` con un valor
   default falso (dato médico sensible, no es aceptable adivinar), el campo
   Prisma es `TipoSangre?` (nullable), y la obligatoriedad real vive en
   `InfoMedicaDto.tipoSangre` (`@IsEnum`, SIN `@IsOptional`) — ninguna alta
   nueva puede omitirlo, los registros viejos simplemente quedan `null`
   (mismo criterio de "rastro histórico, no se retro-completa" que
   `tipoLicencia`/`motivoBaja`). Aplica a
   `InfoMedicaAlumno`/`InfoMedicaMaestro`/`InfoMedicaAdministrativo`. Se
   agrega también a `InfoMedicaPersonalServicios` en el schema por
   consistencia entre los 4 modelos idénticos, aunque ese modelo sigue sin
   código de aplicación (no se toca nada de `PersonalServicios` en este plan).
2. **Enum `TipoSangre`** con 8 valores: `A_POSITIVO`, `A_NEGATIVO`,
   `B_POSITIVO`, `B_NEGATIVO`, `AB_POSITIVO`, `AB_NEGATIVO`, `O_POSITIVO`,
   `O_NEGATIVO` (Prisma no permite `+`/`-` en nombres de enum). El label
   legible (`A+`, `O-`, etc.) vive solo en el frontend.
3. **`Carrera.rvoe` pasa a `String?` (nullable en DB)** — coherente con
   hacerlo opcional en el DTO; un `rvoe` opcional en la validación pero
   `NOT NULL` en la columna sería un error de inserción. `GET /perfil` y
   `GET /carreras` ya devuelven el objeto completo; el frontend pasa a tratar
   `rvoe`/`procedenciaRvoe` como `string | null`.
4. **`Carrera.procedenciaRvoe` nuevo, `String?` opcional siempre** (no
   depende de si `rvoe` viene o no) — texto libre (ej. "Yucatán",
   "Campeche"), sin catálogo cerrado de estados (no se pidió, YAGNI). Se
   muestra en el admin (`CarreraModal`) y en el perfil del alumno
   (`SeccionCarrera`), junto al campo RVOE, solo si tiene valor.
5. **Ocultar "Compañeros" en el perfil de alumno = comentar, no borrar.**
   Pedido explícito del usuario ("solo comenta el código"). Se comenta en
   bloque: la entrada del sidebar, el `case` del switch, las funciones
   `SeccionCompaneros`/`GrupoCompaneros` y los imports que quedan sin uso
   (`obtenerCompaneros`, `CompaneroItem`, `GrupoConCompaneros`) — con un
   comentario que explique por qué y la fecha, para que sea trivial
   reactivarlo. El backend (`GET /perfil/grupo/companeros`) NO se toca — el
   pedido es solo ocultar la UI.
6. **Rediseño de `app/maestro/page.tsx` "igual al del alumno"** = mismo
   patrón visual (banner con arcos + avatar circular + sidebar de navegación
   + panel de una sección a la vez), aplicado a las secciones reales que YA
   tiene el maestro: Datos personales, Sede, Contactos, Asignaciones. Sin
   inventar secciones "próximamente" (no se pidió, y el maestro no tiene un
   backlog de features futuras documentado como el alumno). Sin importar
   nada de `app/alumno/` (regla 11) — se duplica el patrón dentro del árbol
   de maestro, mismo criterio que ya usa ese archivo para la sección Sede.
   El subtítulo del encabezado usa puesto/cédula en vez de matrícula/carrera
   (el maestro no tiene esos campos); el badge de estatus usa
   `EstatusEmpleado` en vez de `EstatusAcademico`; sin badge de "menor de
   edad" (no aplica, `PerfilMaestro` no tiene `fechaNacimiento`).

## Global Constraints

- Regla 1 (CLAUDE.md raíz): nunca persistir algo calculable.
- Regla 2: `sedeId` siempre de `@SedeActual()`, nunca de body/query (no
  aplica directamente a este plan, pero ningún cambio debe romperlo).
- Regla 11: árboles de frontend independientes — sin componentes
  compartidos entre `app/admin/`, `app/alumno/`, `app/maestro/`.
- Regla 12: todo catch loguea antes de responder.
- Migraciones: `migrate diff` + `migrate deploy`, nunca `migrate dev` (ver
  contexto arriba para el comando exacto).
- No agregar dependencias nuevas.
- Contrato de errores sin código nuevo — reutilizar `VALIDATION_ERROR` para
  `tipoSangre` faltante/inválido (mismo criterio que el resto de
  `InfoMedicaDto`).

## Task 1 — Backend (`backend-coder`)

**Schema (`App/backend/prisma/schema.prisma`):**
- Nuevo enum `TipoSangre` (junto a los otros enums de la sección de
  personas): `A_POSITIVO`, `A_NEGATIVO`, `B_POSITIVO`, `B_NEGATIVO`,
  `AB_POSITIVO`, `AB_NEGATIVO`, `O_POSITIVO`, `O_NEGATIVO`.
- Agregar `tipoSangre TipoSangre? @map("tipo_sangre")` a `InfoMedicaAlumno`,
  `InfoMedicaMaestro`, `InfoMedicaAdministrativo`, `InfoMedicaPersonalServicios`
  (los 4, por consistencia — nullable en los 4, ver decisión 1 arriba).
- Cambiar `Carrera.rvoe` de `String` a `String?`.
- Agregar `Carrera.procedenciaRvoe String? @map("procedencia_rvoe")`.

**Migración:**
1. `cd App/backend && npx prisma generate` (verificar que el schema
   compila).
2. Generar el diff SQL:
   ```
   npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script
   ```
   guardarlo en un archivo temporal del scratchpad de la sesión (NO `/tmp`,
   estamos en Windows), revisar que solo toque las 6 tablas/columnas
   esperadas (4× `ADD COLUMN tipo_sangre`, `ALTER COLUMN rvoe DROP NOT NULL`,
   `ADD COLUMN procedencia_rvoe`, `CREATE TYPE "TipoSangre"`).
3. Crear `prisma/migrations/<timestamp>_tipo_sangre_y_rvoe_opcional/migration.sql`
   con ese contenido (sin bloque RLS nuevo — no hay tabla nueva, las policies
   existentes de `carreras`/`info_medica_*` ya cubren estas columnas).
4. `npx prisma migrate deploy` contra la DB real de dev, luego
   `npx prisma migrate status` para confirmar `up to date`.

**DTOs (`App/backend/src/personas/dto/crear-persona.dto.ts`):**
- Importar `TipoSangre` de `@prisma/client`.
- `InfoMedicaDto` gana `@IsEnum(TipoSangre, { message: 'tipoSangre debe ser un tipo de sangre válido' }) tipoSangre!: TipoSangre;` — SIN `@IsOptional`, es requerido para toda alta nueva de los 3 roles.

**Service (`App/backend/src/personas/personas.service.ts`):**
- `datosInfoMedica(infoMedica: InfoMedicaDto)` agrega `tipoSangre:
  infoMedica.tipoSangre` al objeto que arma (usado por los 3
  `infoMedicaAlumno/Maestro/Administrativo.create`).

**DTOs de Carrera (`App/backend/src/carreras/dto/`):**
- `crear-carrera.dto.ts`: `rvoe` pasa de requerido a
  `@IsOptional() @IsString() @IsNotEmpty({ message: 'rvoe no puede ser vacío si se envía' }) rvoe?: string;`
  Agregar `@IsOptional() @IsString() @IsNotEmpty(...) procedenciaRvoe?: string;`.
- `actualizar-carrera.dto.ts`: agregar el mismo campo opcional
  `procedenciaRvoe?: string` (rvoe ya era opcional acá).

**Service de Carreras (`App/backend/src/carreras/carreras.service.ts`):**
- `crear()`: pasar `rvoe: dto.rvoe` (ya opcional, Prisma acepta `undefined`)
  y `procedenciaRvoe: dto.procedenciaRvoe` en el `data` del `create`.
- `actualizar()`: agregar `procedenciaRvoe: dto.procedenciaRvoe` al `data`
  del `update`.
- `hayCambiosReales()`: agregar `'procedenciaRvoe'` a la lista `campos`.

**`GET /perfil` (`App/backend/src/perfil/perfil.service.ts`):**
- Revisar el `select`/objeto de `carrera` que arma para el alumno — hoy ya
  incluye `rvoe` (el frontend lo muestra). Agregar `procedenciaRvoe` al mismo
  nivel.

**Tests e2e:** revisar y ajustar si algún test existente de
`carreras.e2e-spec.ts`/`carreras-crud.e2e-spec.ts`/`personas*.e2e-spec.ts`
asume que `rvoe` es requerido (400 si falta) o que `infoMedica` no necesita
`tipoSangre` — actualizar esos casos a la nueva realidad y agregar al menos:
un caso de `POST /personas` que falle con `VALIDATION_ERROR` si
`tipoSangre` falta (para los 3 roles o al menos uno representativo), y un
caso de `POST /carreras` sin `rvoe` que pase con `201` (y uno con
`procedenciaRvoe`). Correr la suite completa del backend al final y
confirmar verde (regla 12 de la memoria de la sesión — no es la regla de
límite de escrituras, pero igual evitar generar filas de prueba de más:
usar los helpers de limpieza en `afterAll` ya existentes en esos archivos).

**Reporta en el report file:** el nombre exacto de la carpeta de migración
creada, y la lista de archivos tocados.

## Task 2 — Frontend admin (`admin-coder`)

Depende de Task 1 (los tipos/enum del backend deben existir, aunque el
frontend define sus propios espejos en TS — coordinar solo para no
inventar nombres de enum distintos a `TipoSangre` real).

**`components/admin/ui/persona-alta/schemas.ts`:**
- `infoMedicaSchema` gana:
  ```ts
  tipoSangre: z.enum(
    ['A_POSITIVO','A_NEGATIVO','B_POSITIVO','B_NEGATIVO','AB_POSITIVO','AB_NEGATIVO','O_POSITIVO','O_NEGATIVO'],
    { message: 'Selecciona el tipo de sangre' },
  ),
  ```

**`components/admin/ui/persona-alta/InfoMedicaFieldset.tsx`:**
- `InfoMedicaFormValues` gana `tipoSangre: TipoSangre` (definir el type
  union local, mismo patrón que otros types de este árbol — no importar de
  `@prisma/client`, es frontend).
- Agregar un `<select>` requerido "Tipo de sangre" — SIEMPRE visible (no
  depende de `tieneCondicionMedica`, el tipo de sangre no es una condición
  médica), con opciones etiquetadas `A+`, `A-`, `B+`, `B-`, `AB+`, `AB-`,
  `O+`, `O-` (mapeo local `TIPO_SANGRE_LABEL`), colocado antes del checkbox
  de condición médica o justo después — decisión de layout del
  implementador, mismo estilo (`LABEL_CLASS`/`INPUT_CLASS`) que el resto del
  fieldset. Usar el componente `Select` ya existente en
  `components/admin/ui/persona-alta/Select.tsx` si aplica el mismo patrón
  que `CarreraModal`/otros — revisar cómo se usa en ese árbol antes de
  reinventar un `<select>` nativo.

**3 páginas de alta** (`app/admin/{alumnos,maestros,administrativos}/nuevo/page.tsx`):
- Agregar `tipoSangre: ''` (o el valor por defecto que use `zodResolver`) a
  `DEFAULT_VALUES.infoMedica` en las 3.
- En el bloque que arma el payload real de `POST /personas` al enviar,
  incluir `tipoSangre: values.perfil*.infoMedica.tipoSangre` de forma
  INCONDICIONAL (fuera del ternario de `tieneCondicionMedica`, es un campo
  independiente) en las 3 páginas.

**`app/admin/carreras/CarreraModal.tsx`:**
- Quitar `required={esAlta}` del input de RVOE (pasa a ser siempre
  opcional, en alta y edición).
- Agregar un nuevo campo "Procedencia del RVOE (opcional)" — input de texto
  libre, mismo estilo que el resto, con un texto de ayuda breve tipo "Solo
  si el RVOE fue emitido en otro estado". Incluirlo en
  `construirPayloadAlta`/`construirPayloadEdicion` (opcional, se manda solo
  si tiene valor en alta; en edición sigue el patrón "en blanco = sin
  cambio" ya usado por los demás campos opcionales de edición — pero
  cuidado: a diferencia de los otros campos de edición, un valor en blanco
  acá podría significar "borrar la procedencia", no "sin cambio". Documentar
  la decisión que se tome (ver nota abajo) en un comentario.
  - Nota: si se necesita distinguir "no tocar" vs. "borrar", puede quedar
    fuera de alcance por ahora (edición): que un `CarreraModal` en modo
    edición con procedencia en blanco simplemente no la envíe (mismo
    comportamiento que los demás campos "en blanco = sin cambio"), y si el
    admin de verdad quiere borrarla, es un gap conocido a documentar, no a
    resolver con un campo de más en esta tarea (YAGNI, nadie lo ha pedido).

**`lib/api/carreras.ts`:**
- `CarreraCompleta.rvoe` → `string | null`. Agregar
  `procedenciaRvoe: string | null`.
- `CrearCarreraInput.rvoe` → opcional (`rvoe?: string`). Agregar
  `procedenciaRvoe?: string`.
- `ActualizarCarreraInput` ya deriva de `Partial<CrearCarreraInput & ...>`,
  no necesita cambio aparte de que el tipo base cambió.

**Verificación:** `pnpm build` y `pnpm lint` del frontend limpios. No hace
falta e2e de frontend (no existe en este árbol) — verificación manual queda
para el cierre del plan completo (ver "Cierre" abajo).

## Task 3 — Frontend alumno/maestro (`alumno-coder`)

Depende de Task 1 (tipos de `Carrera`/`Perfil` con `procedenciaRvoe`).
Independiente de Task 2 en la práctica (puede correr en paralelo con esa,
ambas después de Task 1) — pero no lo dispares en paralelo con otro
implementador vivo (regla de la skill: nunca 2 implementadores a la vez);
corre después de Task 2 en esta sesión.

**3a. `app/maestro/page.tsx` — rediseño igual al de alumno:**
- Reemplazar el layout actual (tarjeta única con secciones apiladas) por el
  mismo patrón de `app/alumno/page.tsx`: `EncabezadoPerfil` (banner con
  arcos SVG + avatar circular + nombre + badges) +
  `SidebarSecciones`/`PanelSeccion` (una sección visible a la vez, estado
  `useState<SeccionId>`).
- `SeccionId` para maestro: `'datos' | 'sede' | 'contactos' | 'asignaciones'`
  (sin `'carrera'`/`'companeros'`, no aplican a maestro).
- Encabezado: subtítulo con puesto o cédula profesional en vez de
  matrícula/carrera (el maestro no tiene esos campos — usar
  `cedulaProfesional` si existe, si no dejar solo el nombre). Badge de
  estatus usa `ESTATUS_EMPLEADO_LABEL` (ya existe en el archivo actual). Sin
  badge de "menor de edad".
- Reutilizar/duplicar el `BannerArcos` SVG dentro de este mismo archivo
  (regla 11 — no importar de `app/alumno/`).
- Las 4 secciones migran su contenido actual (ya existen como funciones:
  `SeccionDatosPersonales`, `SeccionSede`, `SeccionContactos`,
  `SeccionAsignaciones`) al nuevo panel, sin cambiar su lógica de datos
  interna (siguen usando `obtenerPerfil()`/`obtenerMisAsignaciones()`
  igual que hoy).
- Mantener el manejo de `isLoading`/`isError` igual que hoy, adaptado al
  nuevo contenedor (`max-w-6xl` en vez de `max-w-3xl`, mismo criterio que
  alumno).

**3b. `app/alumno/page.tsx` — ocultar Compañeros (comentado, no borrado):**
- Comentar (bloque `/* ... */` o `//`, con nota fechada explicando el
  motivo: "oculto a pedido del usuario, 2026-09-07 — no borrar") las
  siguientes piezas, dejando el archivo compilando:
  - la entrada `{ id: 'companeros', ... }` de `SECCIONES_REALES`,
  - el `case 'companeros': return <SeccionCompaneros />;` de `PanelSeccion`
    (y ajustar el guard de exhaustividad si hace falta — puede requerir
    quitar `'companeros'` del type `SeccionId` para que el switch siga
    siendo exhaustivo sin ese case; si se hace así, dejar un comentario en
    el type explicando que el id sigue existiendo en las funciones
    comentadas más abajo, listo para reactivarse),
  - las funciones `SeccionCompaneros`/`GrupoCompaneros` completas,
  - los imports que queden sin uso (`obtenerCompaneros`, `CompaneroItem`,
    `GrupoConCompaneros`) — comentarlos también, no borrarlos, para que
    reactivar la sección sea un solo "descomentar".
- El backend (`GET /perfil/grupo/companeros`) NO se toca.

**3c. `app/alumno/page.tsx` — mostrar procedencia del RVOE:**
- En `SeccionCarrera`, agregar un campo `<Campo etiqueta="Procedencia del
  RVOE" valor={carrera.procedenciaRvoe} />` justo después del campo RVOE
  — el componente `Campo` ya maneja `null`/`undefined` mostrando "—", así
  que no hace falta un `if` extra.

**`lib/api/perfil.ts`:**
- Actualizar el tipo de `carrera` dentro de `PerfilAlumno` (o donde esté
  definido `rvoe`) a `rvoe: string | null` y agregar
  `procedenciaRvoe: string | null`.

**Verificación:** `pnpm build` y `pnpm lint` del frontend limpios.

## Cierre del plan

1. Después de las 3 tasks: `qa-backend`, `qa-admin`, `qa-alumno` en paralelo
   — cada uno audita solo su dominio contra `CLAUDE.md` raíz (reglas 1, 2,
   11, 12 aplican directo a este plan) y contra este mismo plan (para
   verificar que "toda la gente" realmente cubre los 3 roles, que RVOE
   opcional no rompe nada de auditoría/duplicados, que el maestro quedó
   "igual" al alumno en patrón visual, que Compañeros quedó comentado y no
   borrado).
2. Si hay hallazgos Important/Critical: 1 ronda de fix con el coder del
   dominio correspondiente, luego confirmar.
3. Actualizar `documentacion_de_agentes/ESTADO.md` con el cierre (fecha,
   qué se hizo, resultado de QA) y una línea nueva en `CLAUDE.md` raíz
   (sección "Fase actual") documentando: `tipoSangre` obligatorio (con la
   decisión de nullable en DB), RVOE opcional + `procedenciaRvoe`, perfil de
   maestro rediseñado, Compañeros oculto — sin día de roadmap asignado,
   mismo criterio que otras features "construidas directo" de este proyecto.
4. NO commitear/pushear sin que el usuario lo pida (hay trabajo en curso sin
   commitear de otras sesiones — login/ProfileDropdown — no mezclar).
5. Reportar al usuario cuando todo esté verde.
