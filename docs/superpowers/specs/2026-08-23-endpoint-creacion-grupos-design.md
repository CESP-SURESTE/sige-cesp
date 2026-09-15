# POST/GET /grupos — endpoint y lógica de creación de grupos

**Fecha:** 2026-08-23
**Fase:** 9 (Grupos/salones), Día 28 — primer trabajo nuevo real de la fase
(Día 27 fue cierre retroactivo: `Grupo`/`GrupoAlumno`/`Materia` ya existían en
el schema desde el Día 2, sin código de aplicación).

## Contexto

`docs/roadmap.md`, Día 28: `POST /grupos`, validaciones (periodo válido,
capacidad > 0, carrera pertenece a la sede), `GET /grupos` con filtro por
periodo/carrera. Ningún controller/service/UI existe todavía para
`Grupo` — se confirmó en Día 27 (`find` sobre `App/backend/src` y
`App/frontend/src` sin resultados para `*grupo*`).

`Materia` (entidad estructurada, `nombre`/`carreraId`/`ciclo`, ya en el
schema desde Día 2) **no participa en este día** — solo entra en Fase 12
(Día 33, asignación de maestros). La pregunta de si "Materia" necesita
diseño adicional para CESP sigue abierta, pero no bloquea Día 28.

Modelo `Grupo` (`schema.prisma`, ya migrado):
```prisma
model Grupo {
  id          String   @id @default(uuid())
  sedeId      String   @map("sede_id")
  carreraId   String   @map("carrera_id")
  salonId     String   @map("salon_id")
  nombre      String
  anioInicio  Int      @map("anio_inicio")
  cicloActual Int      @map("ciclo_actual")
  capacidad   Int
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  alumnos     GrupoAlumno[]
}
```
Sin `@@unique` compuesto — cualquier unicidad de `nombre` se valida a nivel
de aplicación (mismo criterio que `Carrera.nombre`, Día 21).

## Diseño

### 1. Backend — `App/backend/src/grupos/` (módulo nuevo)

Mismo esqueleto que `CarrerasController`/`CarrerasService` (Día 21):
`GruposModule`, `GruposController`, `GruposService`, DTOs con
`class-validator`.

**Guards:** `SedeGuard` + `RolesGuard(@Roles(RolUsuario.ADMINISTRATIVO))` a
nivel de clase — cualquier administrativo, sin jerarquía de `nivelPermiso`
(mismo criterio que Carreras: crear/listar grupos no es tan sensible como dar
de alta personal vía `POST /personas`). `sedeId` siempre de `@SedeActual()`.

### 2. `POST /grupos`

**DTO (`CrearGrupoDto`):** `carreraId: string`, `salonId: string`,
`nombre: string`, `anioInicio: number`, `cicloActual: number`,
`capacidad: number` — `@IsInt() @Min(1)` en `anioInicio`/`cicloActual`/
`capacidad` a nivel de DTO (primera línea de validación, `400
VALIDATION_ERROR` automático vía `ValidationPipe` si falla).

**`GruposService.crear(dto, sedeId)` — orden de validaciones:**
1. (Ya cubierto por el DTO) `capacidad > 0`, `anioInicio`/`cicloActual`
   enteros positivos.
2. `carrera = prisma.carrera.findFirst({ where: { id: dto.carreraId,
   sedeId } })` → si `null`, `404 NOT_FOUND` ("carrera no existe o no
   pertenece a la sede").
3. `dto.cicloActual` debe estar entre `1` y `carrera.duracion` (inclusive)
   → si no, `400 VALIDATION_ERROR` ("cicloActual fuera de rango para la
   duración de la carrera").
4. `salon = prisma.salon.findFirst({ where: { id: dto.salonId, sedeId } })`
   → si `null`, `404 NOT_FOUND` ("salón no existe o no pertenece a la
   sede").
5. Unicidad: `prisma.grupo.findFirst({ where: { sedeId, anioInicio:
   dto.anioInicio, cicloActual: dto.cicloActual, nombre: { equals:
   dto.nombre, mode: 'insensitive' } } })` → si existe, `409 CONFLICT`
   ("ya existe un grupo con ese nombre en ese periodo"). Sin `@@unique`
   nuevo en el schema, mismo criterio que `Carrera.nombre`.
6. Transacción (`$transaction`): `tx.grupo.create({ data: { sedeId,
   ...dto } })` + `tx.registroAuditoria.create({ usuarioId: actorId,
   sedeId, accion: AccionAuditoria.ALTA, entidad: 'Grupo', entidadId:
   grupo.id, detalle: { nombre, anioInicio, cicloActual } })` (regla 5).

**Controller:**
```ts
@Post()
async crear(@Body() dto: CrearGrupoDto, @SedeActual() sedeId: string,
            @ActorUsuarioId() actorId: string) {
  const data = await this.gruposService.crear(dto, sedeId, actorId);
  return { data };
}
```

**Éxito:** `201 { data: Grupo }` — shape completo del modelo (`id, sedeId,
carreraId, salonId, nombre, anioInicio, cicloActual, capacidad, createdAt,
updatedAt`), sin relaciones expandidas (mismo criterio que `POST
/carreras`/`POST /sedes`, que tampoco expanden en la respuesta de alta).

### 3. `GET /grupos`

**Query params (`ListarGruposDto`):** `anioInicio?: number`,
`cicloActual?: number`, `carreraId?: string`, `page?: number` (default 1),
`limit?: number` (default 20, 1-100) — mismo shape que `GET /personas`
(Día 19). Todos los filtros opcionales — sin filtro, devuelve todos los
grupos de la sede paginados.

**`GruposService.listar(filtros, sedeId)`:**
- `where: { sedeId, ...(anioInicio && { anioInicio }), ...(cicloActual &&
  { cicloActual }), ...(carreraId && { carreraId }) }`.
- `orderBy: [{ anioInicio: 'desc' }, { cicloActual: 'desc' }, { nombre:
  'asc' }]` (periodos más recientes primero).
- `select` expandido a `carrera: { select: { id: true, nombre: true } }` y
  `salon: { select: { id: true, nombre: true } }` — a diferencia del
  `POST`, aquí sí conviene para que la UI de Día 29 no haga N+1 requests.
- `skip`/`take` estándar + `count` en paralelo (`Promise.all`), mismo
  patrón que `PersonasService.listarPorSedeYRol`.

**Éxito:** `200 { data: GrupoListItem[], page, limit, total }` —
`GrupoListItem`: `{ id, nombre, anioInicio, cicloActual, capacidad,
carrera: { id, nombre }, salon: { id, nombre } }`. Sin
`totalAlumnosInscritos` — depende de `GrupoAlumno`, fuera de alcance (Fase
10, Día 30).

### 4. Fuera de alcance de Día 28 (decisiones explícitas del diseño)

- **`Grupo.capacidad <= Salon.capacidad`**: sin validar. `Grupo.capacidad`
  es un campo independiente por diseño (Día 27) — se deja libre por ahora,
  se ajusta si CESP lo pide.
- **Choque de salón** (mismo `salonId` con 2 grupos activos en el mismo
  `anioInicio`+`cicloActual`): sin validar. El modelo no tiene
  hora/turno — bloquear por salón+periodo asumiría "un salón, un grupo por
  periodo" sin esa info, que podría ser incorrecto si CESP maneja turnos.
- `GET /grupos/:id`, `PATCH /grupos/:id`, `DELETE /grupos/:id`: no pedidos
  por el roadmap para este día.
- `Materia`: no participa (ver Contexto).

### 5. Testing

`test/grupos.e2e-spec.ts` (nuevo):
- `POST /grupos` exitoso → `201`, grupo real en DB, `RegistroAuditoria`
  con `accion: ALTA`.
- `carreraId` de otra sede → `404 NOT_FOUND`.
- `salonId` de otra sede → `404 NOT_FOUND`.
- `cicloActual` fuera de rango de `carrera.duracion` (ej. `cicloActual: 99`
  en carrera de 8 semestres) → `400 VALIDATION_ERROR`.
- `capacidad: 0` o negativa → `400 VALIDATION_ERROR`.
- Nombre duplicado en misma sede+periodo → `409 CONFLICT`; mismo nombre en
  periodo distinto → permitido.
- `GET /grupos` sin filtros → todos los grupos de la sede, paginados,
  `carrera`/`salon` expandidos.
- `GET /grupos?carreraId=...` y `?anioInicio=...&cicloActual=...` →
  filtrado correcto.
- Aislamiento cruzado: grupo de sede A no aparece en `GET /grupos` de sede
  B (mismo patrón de test que el resto de la Fase 8, Día 25).
- Actor sin rol `ADMINISTRATIVO` → `403 ROL_NO_AUTORIZADO`.
