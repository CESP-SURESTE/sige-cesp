# Día 33 — Maestro por materia (Fase 12)

**Fecha:** 2026-08-28
**Roadmap:** `docs/roadmap.md` — FASE 12, Día 33.
**Entregable visible:** asignación de prueba creada vía Postman — maestro X → materia Y → grupo Z.
**Alcance:** solo backend (modelo + endpoints). La UI de admin y la vista del maestro son Día 34.

## Objetivo

Un administrativo puede asignar maestros a materias dentro de un grupo. Requiere
traer a la vida la entidad `Materia` (existe en el schema desde el Día 2 pero sin
código, sin seed y sin forma de crearla) y un modelo de unión nuevo
`GrupoMateriaMaestro`.

## Decisiones tomadas (brainstorming 2026-08-28)

1. **Bootstrap de `Materia`:** sub-tarea del mismo día — `GET /materias` +
   `POST /materias` (módulo nuevo) + seed de unas cuantas materias. `PATCH`/
   `DELETE`/`GET /materias/:id` se difieren (mismo criterio que Carreras).
   Precedente: Día 29 agregó `GET /salones` como sub-tarea al planear la UI de
   grupos.
2. **Co-docencia permitida:** `@@unique([grupoId, materiaId, maestroId])` — una
   materia de un grupo puede tener 2+ maestros; solo se bloquea el triple exacto
   duplicado (`409 CONFLICT`).
3. **Materia válida para un grupo:** `materia.carreraId === grupo.carreraId` **y**
   `materia.ciclo === grupo.cicloActual`. Si no → `400 VALIDATION_ERROR`.
4. **Enfoque A:** `MateriasModule` propio (entidad top-level, RLS propia, figura
   como "CRUD completo" en `CLAUDE.md`); las asignaciones son sub-recurso de
   `Grupo`, en `GruposController`/`GruposService`, exactamente como
   `/grupos/:id/alumnos`.
5. **`estatus` del maestro NO se valida** al asignar (coherente con Día 30, que
   tampoco filtra alumnos por `activo`/`estatusAcademico`).
6. **DELETE de asignación por `GrupoMateriaMaestro.id`** (el `GET` lo devuelve),
   no por tupla compuesta en el path.

## 1. Modelo nuevo `GrupoMateriaMaestro` + migración

```prisma
model GrupoMateriaMaestro {
  id         String        @id @default(uuid())
  grupoId    String        @map("grupo_id")
  grupo      Grupo         @relation(fields: [grupoId], references: [id])
  materiaId  String        @map("materia_id")
  materia    Materia       @relation(fields: [materiaId], references: [id])
  maestroId  String        @map("maestro_id") // PerfilMaestro.id
  maestro    PerfilMaestro @relation(fields: [maestroId], references: [id])
  asignadoEn DateTime      @default(now())    @map("asignado_en")

  @@unique([grupoId, materiaId, maestroId])
  @@map("grupo_materia_maestro")
}
```

Back-relations nuevas:
- `Grupo`: `asignaciones GrupoMateriaMaestro[]`
- `Materia`: `asignaciones GrupoMateriaMaestro[]`
- `PerfilMaestro`: `asignaciones GrupoMateriaMaestro[]`

**Migración** (`prisma migrate dev`, aplicada en dev):
- `CREATE TABLE "grupo_materia_maestro"` con las 3 FKs `ON DELETE RESTRICT ON
  UPDATE CASCADE` (mismo patrón que `grupo_alumnos` en la migración `init`).
- `CREATE UNIQUE INDEX` sobre `(grupo_id, materia_id, maestro_id)`.
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`
- `GRANT SELECT, INSERT, UPDATE, DELETE ON "grupo_materia_maestro" TO
  authenticated;`
- `CREATE POLICY "sede_isolation_grupo_materia_maestro"` calcada de
  `sede_isolation_grupo_alumnos` (migración `20260806224102_rls_multisede`):
  `USING` + `WITH CHECK` con subquery `EXISTS (SELECT 1 FROM grupos g WHERE g.id
  = "grupo_materia_maestro".grupo_id AND g.sede_id = current_setting('...')::uuid)`
  — copiar la forma exacta de la policy de `grupo_alumnos`, incluyendo el nombre
  del setting de sesión que ya usa.

Pendiente futuro: `prisma migrate deploy` en prod antes de tocar `main` (se suma
a la migración del art. 53 que ya está pendiente).

### Documentar en `CLAUDE.md`

- Contrato de API: entradas nuevas para `GET/POST /materias` y
  `POST/GET/DELETE /grupos/:id/asignaciones`.
- Tabla "CRUD por tipo de entidad": `GrupoMateriaMaestro` es "Negocio (no CRUD)"
  — `POST`/`DELETE` + `GET` de listado, como `GrupoAlumno`.

## 2. `MateriasModule` — `GET` y `POST /materias`

Módulo nuevo `src/materias/` (`materias.module.ts`, `materias.controller.ts`,
`materias.service.ts`, `dto/`). Guards `SedeGuard` + `RolesGuard` con
`@Roles(RolUsuario.ADMINISTRATIVO)` por método, sin jerarquía de `nivelPermiso`
(mismo criterio que `CarrerasController`/`GruposController`/`SalonesController`).
`sedeId` SIEMPRE de `@SedeActual()`.

### `GET /materias?carreraId=&ciclo=`

- `carreraId` **requerido** (query). La carrera debe existir y pertenecer a la
  sede del actor → si no `404 NOT_FOUND`.
- `ciclo` filtro opcional, entero ≥ 1 (validado en el DTO). Fuera de rango →
  `400 VALIDATION_ERROR`.
- Sin paginación (catálogo chico — no sigue el shape `page`/`limit`/`total`).
- Éxito: `200 { data: Materia[] }` con `Materia = { id, nombre, carreraId,
  ciclo }`. Orden `ciclo asc, nombre asc`.

### `POST /materias`

- Body: `{ nombre: string, carreraId: string, ciclo: number }` (todos
  requeridos, `ValidationPipe` con `forbidNonWhitelisted`).
- La carrera debe pertenecer a la sede del actor → `404 NOT_FOUND`.
- `ciclo` entre 1 y `carrera.duracion` → si no `400 VALIDATION_ERROR`
  (validado en el service, depende de la carrera).
- `nombre` único por `(carreraId, ciclo)` case-insensitive, validado a nivel de
  aplicación (sin `@@unique` compuesto nuevo en el schema — mismo criterio que
  `Carrera.nombre` único por sede, Día 21) → `409 CONFLICT`.
- Audita `ALTA` (`entidad: 'Materia'`) en la misma transacción del insert.
- Éxito: `201 { data: Materia }`.

Sin `GET /materias/:id` / `PATCH` / `DELETE` (diferidos).

## 3. Asignaciones — sub-recurso de `Grupo`

En `GruposController` / `GruposService` (NO en `MateriasModule`). Mismos guards
que el resto de `GruposController` (`SedeGuard` + `RolesGuard(ADMINISTRATIVO)`),
`sedeId` de `@SedeActual()`. El `:id` del grupo debe existir y ser de la sede →
`404 NOT_FOUND` (reutiliza el helper de resolución de grupo que ya usan
`POST/GET /grupos/:id/alumnos`).

### `POST /grupos/:id/asignaciones`

- Body: `{ materiaId: string, usuarioId: string }` (requeridos).
- `materiaId` debe existir y cumplir `materia.carreraId === grupo.carreraId`
  **y** `materia.ciclo === grupo.cicloActual` → si no `400 VALIDATION_ERROR`.
- `usuarioId` (un `Usuario.id`) se resuelve a `PerfilMaestro.id` exigiendo el
  `Usuario` con `rol: MAESTRO` **y** `sedeId === @SedeActual()` — id
  inexistente / maestro de otra sede / un no-MAESTRO → `404 NOT_FOUND`. El
  `estatus` del `PerfilMaestro` (`ACTIVO`/`LICENCIA`/`BAJA`) NO se valida
  (coherente con Día 30).
- Triple `(grupoId, materiaId, maestroId)` ya existente → `409 CONFLICT`
  (pre-check dentro de la transacción, respaldado por el `@@unique`). Un
  segundo maestro distinto en la misma materia del mismo grupo → `201`
  (co-docencia permitida).
- Audita `ALTA` (`entidad: 'GrupoMateriaMaestro'`, `detalle: { grupoId,
  materiaId, maestroId }`) en la misma transacción.
- Éxito: `201 { data: GrupoMateriaMaestro }` (fila plana, sin relaciones
  expandidas — mismo criterio que `POST /grupos/:id/alumnos`).

### `GET /grupos/:id/asignaciones`

- Sin paginar (catálogo chico, acotado por nº de materias del ciclo × maestros).
- Éxito: `200 { data: AsignacionListItem[] }`:

```ts
AsignacionListItem = {
  id: string;
  materia: { id: string; nombre: string; ciclo: number };
  maestro: {
    usuarioId: string;
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string | null;
  };
};
```

- Orden: `materia.nombre asc, maestro.apellidoPaterno asc, maestro.apellidoMaterno
  asc`.
- Grupo sin asignaciones → `200 { data: [] }`.

### `DELETE /grupos/:id/asignaciones/:asignacionId`

- `:asignacionId` es un `GrupoMateriaMaestro.id`.
- `404 NOT_FOUND` si no existe, o si su `grupoId !== :id`, o si el grupo no es
  de la sede del actor.
- DELETE real de la fila de unión (regla 3 no aplica a esta tabla, igual que
  `GrupoAlumno`). Audita `ELIMINACION` antes del delete, en la misma
  transacción.
- Éxito: `200 { data: { ok: true } }`.

Sin códigos de error nuevos — reusa `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`,
y `ROL_NO_AUTORIZADO` vía `RolesGuard`.

## 4. Seed

En `prisma/seed.ts` (el que consumen los e2e por `clave` de carrera): agregar
`materias` para las carreras ya sembradas — p. ej. 3-4 materias de `ciclo: 1`
por cada carrera de Mérida (`LAE-MID`, `ING-SIS-MID`) y alguna de Valladolid
(`LC-VLD`), con nombres realistas por área. Sin `GrupoMateriaMaestro` sembrado
(eso lo crea el admin desde la UI de Día 34 / Postman).

Verificar que el bloque de seed sea idempotente igual que el resto del archivo
(el proyecto reseedea con frecuencia) — usar `upsert` o un `deleteMany` +
`createMany` acotado a las carreras del seed, siguiendo el patrón que ya use
`seed.ts` para grupos/salones.

## 5. Pruebas (e2e, backend)

Mismo andamiaje JWKS/`SEDE_GUARD_ENV_OVERRIDE` que `grupos-alumnos.e2e-spec.ts`.

### `test/materias.e2e-spec.ts` (nuevo)

- `GET /materias?carreraId=<Mérida>` → lista ordenada `ciclo asc, nombre asc`.
- `GET /materias` sin `carreraId` → `400 VALIDATION_ERROR`.
- `GET /materias?carreraId=<Valladolid>` con token de admin Mérida → `404
  NOT_FOUND` (carrera de otra sede).
- `POST /materias` OK → `201`, y existe un `RegistroAuditoria` `ALTA`
  `entidad: 'Materia'` con `entidadId` = la materia creada.
- `POST /materias` con `ciclo` fuera de `1..carrera.duracion` → `400`.
- `POST /materias` con `nombre` duplicado en la misma carrera+ciclo
  (case-insensitive) → `409 CONFLICT`.
- `POST /materias` con `carreraId` de otra sede → `404`.
- `GET`/`POST /materias` con token rol `MAESTRO` → `403 ROL_NO_AUTORIZADO`.
- `afterAll` limpia por los `id` de materia + registros de auditoría creados en
  la corrida (regla 14, acotado a ids — nunca por patrón).

### `test/grupos-asignaciones.e2e-spec.ts` (nuevo)

- `POST /grupos/:id/asignaciones` OK (maestro de la misma sede, materia de la
  misma carrera+ciclo del grupo) → `201`; audita `ALTA` `entidad:
  'GrupoMateriaMaestro'`.
- Co-docencia: un 2º maestro distinto a la misma materia del mismo grupo →
  `201`.
- Triple duplicado exacto (mismo grupo, materia, maestro) → `409 CONFLICT`.
- Materia de otra carrera → `400 VALIDATION_ERROR`.
- Materia de la carrera correcta pero de otro `ciclo` → `400 VALIDATION_ERROR`.
- `usuarioId` de un `ALUMNO` → `404`; de un maestro de otra sede → `404`; id
  inexistente → `404`.
- `:id` de grupo de otra sede → `404`.
- `GET /grupos/:id/asignaciones` → shape `AsignacionListItem[]` + orden
  (`materia.nombre`, luego `maestro.apellidoPaterno`); grupo sin asignaciones →
  `{ data: [] }`.
- `DELETE /grupos/:id/asignaciones/:asignacionId` OK → `200 { data: { ok: true }
  }`; audita `ELIMINACION`. `:asignacionId` inexistente → `404`. `:asignacionId`
  que pertenece a OTRO grupo → `404`.
- Las 3 rutas con token rol `MAESTRO` → `403 ROL_NO_AUTORIZADO`.
- `afterAll` limpia acotado a los `id`s creados (`GrupoMateriaMaestro`, `Grupo`,
  `Usuario`/perfiles, `Materia`, `RegistroAuditoria`) — nunca por patrón de
  email/nombre (regla 14; patrón ya corregido en los otros specs).

### Verificación global

Suite e2e completa (`pnpm test:e2e`) + unit (`pnpm test`) + `pnpm build` en
verde. Lint del backend con `npx eslint "<archivos nuevos>"` **sin `--fix`**
(el `pnpm lint` del repo es `eslint --fix` y reformatea archivos ajenos —
hallazgo del Día 32, no repetirlo). Verificación manual del "entregable
visible" (asignación por Postman) a cargo del usuario.

## 6. Fuera de alcance (explícito)

- `PATCH /grupos/:id/asignaciones/:id` — cambiar el maestro de una asignación
  se hace con `DELETE` + `POST`.
- `GET /materias/:id`, `PATCH /materias/:id`, `DELETE /materias/:id`.
- Cualquier UI (Día 34): tabla de asignación del admin, vista "mis grupos y
  materias" del maestro.
- Validar que TODAS las materias del ciclo del grupo tengan maestro asignado.
- Choque de horario del maestro / carga máxima de materias por maestro.
- `GrupoMateriaMaestro` con histórico (`activo`/`desde`/`hasta`) — se descartó
  en el brainstorming.

## Ejecución

Subagent-Driven Development:

1. **Task 1 — Modelo + migración + seed** (`backend-coder`): schema
   `GrupoMateriaMaestro` + back-relations, migración con RLS calcada de
   `grupo_alumnos`, seed de materias en `seed.ts`. Deliverable testeable:
   `prisma migrate dev` corre limpio, `prisma db seed` (o el script de seed)
   corre limpio, `pnpm build` verde.
2. **Task 2 — `MateriasModule` (`GET`/`POST /materias`) + e2e**
   (`backend-coder`): módulo nuevo + `test/materias.e2e-spec.ts`.
3. **Task 3 — Asignaciones en `GruposController` (`POST`/`GET`/`DELETE`) + e2e**
   (`backend-coder`): endpoints + `test/grupos-asignaciones.e2e-spec.ts` +
   entradas en `CLAUDE.md`.
4. **Review final** del árbol de cambios.
5. **QA:** `qa-backend` consigna veredicto en `ESTADO.md`.
6. Marcar checkbox de Día 33 en `ESTADO.md`; `roadmap.md` NO se tacha todavía
   (Fase 12 cierra con Día 34).
