# Día 30 — Matrícula de alumnos en grupo (backend) — diseño

Fecha: 2026-08-27
Fase: 10 (Gestión de grupos), Día 30. El Día 31 (UI) es trabajo aparte.

## Contexto

`GrupoAlumno` ya existe en el schema desde el Día 2/5 — nunca tuvo código de
aplicación. Modelo real:

```prisma
model GrupoAlumno {
  id               String       @id @default(uuid())
  grupoId          String       @map("grupo_id")
  grupo            Grupo        @relation(fields: [grupoId], references: [id])
  alumnoId         String       @map("alumno_id")   // FK a PerfilAlumno.id
  alumno           PerfilAlumno @relation(fields: [alumnoId], references: [id])
  fechaInscripcion DateTime     @default(now()) @map("fecha_inscripcion")

  @@unique([grupoId, alumnoId])
  @@map("grupo_alumnos")
}
```

No tiene columna `periodo` — el periodo vive en `Grupo` (`anioInicio` + `cicloActual`).
`alumnoId` referencia `PerfilAlumno.id`, no `Usuario.id`.

`CLAUDE.md` ya clasifica `GrupoAlumno` como "Negocio (no CRUD) — solo POST/DELETE" y
anticipa el código de dominio `CAPACIDAD_EXCEDIDA`.

El módulo `grupos` (`App/backend/src/grupos/`) ya tiene el patrón: `GruposController`
con `@UseGuards(SedeGuard, RolesGuard)` a nivel de clase, `@Roles(RolUsuario.ADMINISTRATIVO)`
por método, `sedeId` de `@SedeActual()`, `actorUsuarioId` de `@ActorUsuarioId()`,
auditoría dentro de la misma `$transaction`, `console.error` en cada catch.

## Endpoints nuevos (todos en `GruposController`)

Mismos guards que el resto del controller. `sedeId` SIEMPRE de `@SedeActual()`.

### `POST /grupos/:id/alumnos`

Body: `MatricularAlumnoDto { usuarioId: string }` — `@IsUUID()` (los `Usuario.id`
vienen de Supabase Auth y son UUID); malformado → `400 VALIDATION_ERROR` vía
`ValidationPipe`.

El `usuarioId` se resuelve server-side a `PerfilAlumno`:
`usuario.findFirst({ where: { id: usuarioId, sedeId, rol: RolUsuario.ALUMNO }, include: { perfilAlumno: true } })`.

Éxito: `201 { data: { id, grupoId, alumnoId, fechaInscripcion } }` — fila `GrupoAlumno`
plana, sin relaciones expandidas (mismo criterio que `POST /grupos` que devuelve el
`Grupo` plano).

### `DELETE /grupos/:id/alumnos/:usuarioId`

`:usuarioId` es un `Usuario.id` (consistente con el `POST` y con `PATCH /personas/:id/estatus`).
Se resuelve igual que en el `POST`.

DELETE real de la fila `GrupoAlumno` (fila de unión, no una persona — la regla 3 de
baja lógica NO aplica; `CLAUDE.md` ya lista `GrupoAlumno` como "solo POST/DELETE").

Éxito: `200 { data: { ok: true } }` (mismo shape que `DELETE /grupos/:id`).

### `GET /grupos/:id/alumnos`

Sin paginar — un grupo tiene a lo sumo `capacidad` alumnos (típico 20-40), catálogo
chico, mismo criterio que `GET /salones` / `GET /carreras`.

Éxito: `200 { data: GrupoAlumnoListItem[] }` con

```ts
interface GrupoAlumnoListItem {
  usuarioId: string;          // Usuario.id — lo que el DELETE y el enlace al perfil necesitan
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  matricula: string;
  semestreActual: number;
  estatusAcademico: EstatusAcademico; // 'INSCRITO' | 'BAJA_TEMPORAL' | 'BAJA_DEFINITIVA' | 'EGRESADO'
  fechaInscripcion: string;  // ISO
}
```

Orden: `apellidoPaterno asc, apellidoMaterno asc, nombres asc` (igual que `GET /personas`).

## Validaciones y códigos de error (`POST`)

En este orden:

1. **Grupo**: `grupo.findFirst({ where: { id, sedeId } })` — no existe / otra sede →
   `404 NOT_FOUND` ("Grupo no encontrado en tu sede").
2. **Alumno**: el `usuario.findFirst` de arriba no devuelve fila, o no trae
   `perfilAlumno` → `404 NOT_FOUND` ("Alumno no encontrado en tu sede"). Cubre:
   `usuarioId` inexistente, alumno de otra sede (`sedeId` en el `where`), un
   `Usuario` que es `MAESTRO`/`ADMINISTRATIVO` (`rol` en el `where`).
3. **Carrera**: `perfilAlumno.carreraId !== grupo.carreraId` → `400 VALIDATION_ERROR`
   ("El alumno pertenece a otra carrera"). Mismo código que usa `GruposService.crear`
   para el chequeo cruzado análogo (`cicloActual` fuera del rango de la carrera).
4. **No duplicado en ESTE grupo**: pre-check explícito
   `grupoAlumno.findUnique({ where: { grupoId_alumnoId: { grupoId, alumnoId } } })`
   dentro de la transacción → `409 CONFLICT` ("El alumno ya está inscrito en este
   grupo").
5. **Capacidad**: dentro de la `$transaction`,
   `grupoAlumno.count({ where: { grupoId } }) >= grupo.capacidad` →
   `409 CAPACIDAD_EXCEDIDA` — **código de dominio nuevo**, ya anticipado en
   `CLAUDE.md`. Se agrega a la lista de "Códigos de dominio ya en uso" del contrato.

`DELETE`:
- Grupo no existe / otra sede → `404 NOT_FOUND`.
- Alumno (`usuarioId`) no resuelve a un `PerfilAlumno` de la sede → `404 NOT_FOUND`.
- No hay fila `GrupoAlumno` para `(grupoId, alumnoId)` → `404 NOT_FOUND` ("El alumno
  no está inscrito en este grupo").

`GET`:
- Grupo no existe / otra sede → `404 NOT_FOUND`.
- Grupo sin alumnos → `200 { data: [] }` (estado normal, no error).

Sin código nuevo salvo `CAPACIDAD_EXCEDIDA`.

## Auditoría y transaccionalidad

- `POST`: dentro de una `$transaction` — pre-check de duplicado (paso 4), `count` de
  capacidad (paso 5), `grupoAlumno.create`, y `registroAuditoria.create`
  (`accion: ALTA`, `entidad: 'GrupoAlumno'`, `entidadId` = id de la fila nueva,
  `detalle: { grupoId, alumnoId, matricula }`).
- `DELETE`: dentro de una `$transaction` — `registroAuditoria.create`
  (`accion: ELIMINACION`, `entidad: 'GrupoAlumno'`, `entidadId` = id de la fila que se
  borra, `detalle: { grupoId, alumnoId, matricula }`) ANTES del `grupoAlumno.delete`.
- `GET` no audita.
- La carrera de capacidad se maneja con `count` + `create` dentro de la misma
  transacción. Riesgo residual (dos `POST` simultáneos al mismo grupo) aceptado —
  mismo criterio pragmático ya adoptado para `Carrera.nombre` (Día 21) y el login
  sintético (2026-08-18). No se usa `SELECT ... FOR UPDATE`.

## Fuera de alcance (decisiones explícitas)

- **"Alumno no duplicado en el mismo periodo"** (que el roadmap Día 30 menciona
  textualmente): **NO se enforza** — decisión explícita del usuario, 2026-08-27. Un
  alumno puede estar inscrito en varios grupos que compartan `anioInicio`+`cicloActual`.
  Lo único que aplica es el `@@unique([grupoId, alumnoId])`: no dos veces en el MISMO
  grupo.
- Bloqueo por `estatusAcademico` (`EGRESADO` / `BAJA_DEFINITIVA`) o por
  `Usuario.activo === false` — no se valida (decisión del usuario). El admin decide.
- `semestreActual` del alumno vs `cicloActual` del grupo — no se valida.
- `Grupo.capacidad` vs `Salon.capacidad`, choque de salón en el mismo periodo,
  matrícula por lote (varios alumnos en un request) — nada de eso.
- Frontend (`lib/api` clients, UI de detalle de grupo, autocomplete) — es el Día 31.
- `GET /grupos/:id` (detalle del grupo solo) — la UI del Día 31 prellena los datos del
  grupo desde el caché de React Query del listado (mismo patrón que Carreras); solo se
  agrega `GET /grupos/:id/alumnos`.

## Testing

Suite e2e nueva `App/backend/test/grupos-alumnos.e2e-spec.ts`:

- `POST` OK → `201`, fila creada, `RegistroAuditoria` de `ALTA` con `detalle` correcto.
- `POST` grupo de otra sede → `404`.
- `POST` `usuarioId` inexistente → `404`.
- `POST` `usuarioId` de un `MAESTRO` → `404`.
- `POST` alumno de otra sede → `404`.
- `POST` alumno de otra carrera → `400 VALIDATION_ERROR`.
- `POST` alumno ya inscrito en ese grupo → `409 CONFLICT`.
- `POST` con el grupo lleno (`capacidad` alumnos ya inscritos) → `409 CAPACIDAD_EXCEDIDA`.
- `POST` sin `usuarioId` / con uno no-UUID → `400 VALIDATION_ERROR`.
- `DELETE` OK → `200`, fila borrada, `RegistroAuditoria` de `ELIMINACION`.
- `DELETE` de un alumno no inscrito → `404`.
- `DELETE` grupo de otra sede → `404`.
- `GET` devuelve los inscritos con los campos y el orden esperados; grupo vacío →
  `200 { data: [] }`.
- Aislamiento: un `ADMINISTRATIVO` de la sede B no ve/afecta la matrícula de un grupo
  de la sede A (todas las rutas → `404`).
- Fixtures: helpers que registran cada `id` creado; limpieza en `afterAll` acotada a
  esos `id`s (nunca por patrón de email/nombre — regla 14).

Verificación: `pnpm test:e2e` completo (toda la suite del backend en verde) + `pnpm test`
(unit) + `pnpm build`.

## Contrato de API — texto a agregar en `CLAUDE.md`

- Nueva entrada en "Códigos de dominio ya en uso": `CAPACIDAD_EXCEDIDA` (409,
  `POST /grupos/:id/alumnos` — el grupo ya tiene `capacidad` alumnos inscritos).
- Nuevo bloque describiendo `POST/DELETE/GET /grupos/:id/alumnos` (Fase 10, Día 30) en
  la sección "Contrato de API", con el detalle de arriba.
- La tabla "CRUD por tipo de entidad" ya lista `GrupoAlumno (solo POST/DELETE)` —
  ajustar a `(POST/DELETE + GET de listado)`.
