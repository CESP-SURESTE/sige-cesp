# Fase 6, Día 20 — CRUD de sedes + identidad de plataforma (`AdminPlataforma`)

**Fecha:** 2026-08-14
**Meta del día:** `AdminPlataforma` puede crear una sede nueva desde el dashboard de
plataforma, de punta a punta (login → crear sede → verla en la lista).

Este spec formaliza para implementación la nota de diseño ya decidida el 2026-08-12 en
`docs/roadmap.md` (Fase 6, Día 20), más 3 decisiones tomadas en esta sesión.

## Contexto

Crear una sede es, por definición, una acción sin sede — ningún actor del modelo actual
(`ALUMNO`/`MAESTRO`/`ADMINISTRATIVO`, todos atados a un `sedeId` fijo vía JWT, regla 2 de
`CLAUDE.md` raíz) encaja ahí, ni siquiera `PerfilAdministrativo.nivelPermiso: SUPER_ADMIN`
(jerarquía *dentro* de una sede, regla 7 — mezclarlo es ambiguo y riesgoso). Se confirmó
en esta sesión (pregunta directa al usuario) que "el superadmin" que pide el objetivo de
hoy es esta identidad nueva y separada, `AdminPlataforma` — no el `nivelPermiso` existente.

## Decisiones tomadas hoy

1. **Auditoría de acciones de `AdminPlataforma`**: se extiende `RegistroAuditoria`
   (`usuarioId` pasa a nullable + columna nueva `adminPlataformaId` nullable + `CHECK`
   exactamente-uno-de-los-dos) en vez de omitir auditoría o crear una tabla paralela.
2. **`DELETE /sedes/:id`**: fuera de alcance. El roadmap del Día 20 solo pide
   POST/GET/PATCH; borrar una sede con carreras/salones/usuarios/grupos dependientes
   necesita su propia decisión de política (baja lógica vs bloqueo por dependientes) —
   se resuelve como día aparte. Esto NO contradice la tabla CRUD de `CLAUDE.md` (que
   marca `Sede` como CRUD completo) — es un recorte de alcance explícito de hoy, a
   documentar ahí cuando se construya.
3. **Bootstrap**: cuenta de prueba genérica `plataforma.prueba@nexo-sd.mx` (no el email
   real del usuario), password generada en chat, nunca persistida en archivo — mismo
   criterio ya usado para `qa.prueba@cesp-merida.edu.mx`.

## Alcance de HOY (P0)

### 1. Schema (`schema.prisma` + migración nueva)

```prisma
model AdminPlataforma {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String   @map("password_hash")
  nombre       String
  activo       Boolean  @default(true)
  createdAt    DateTime @default(now()) @map("created_at")

  registrosAuditoria RegistroAuditoria[]

  @@map("admin_plataforma")
}
```

`RegistroAuditoria` — cambios:
- `usuarioId String` → `usuarioId String?`
- nueva `adminPlataformaId String? @map("admin_plataforma_id")` + relación a
  `AdminPlataforma`
- `CHECK` constraint (SQL crudo en la migración, Prisma no lo expresa en el schema):
  `(usuario_id IS NOT NULL) != (admin_plataforma_id IS NOT NULL)`

Migración SQL adicional:
- `ALTER TABLE "admin_plataforma" ENABLE ROW LEVEL SECURITY;` — **sin ninguna policy**
  (cerrado por default para `authenticated`/`anon`, mismo patrón ya usado en
  `sede_responsables` para UPDATE/DELETE — sin policy = bloqueado). El backend conecta
  como rol `postgres` (bypassa RLS, ver comentario en
  `20260806224102_rls_multisede/migration.sql`), así que esto es defensa en profundidad,
  no el mecanismo real de control de acceso.
- Las policies existentes de `registro_auditoria` (`sede_isolation_registro_auditoria_*`)
  filtran por `sede_id`, no por `usuario_id` — no requieren cambio.

### 2. Identidad y auth (backend)

- Hash de password: `scrypt` de `node:crypto` (sin dependencia nueva) — módulo
  `src/platform-admin/password.util.ts` (o similar), reutilizable por el guard y el
  bootstrap.
- JWT propio firmado con `jose` (ya es dependencia transitiva vía `@supabase/server`) —
  claims mínimos: `sub` (id de `AdminPlataforma`), `email`. Secreto en env var nueva
  `PLATFORM_ADMIN_JWT_SECRET` (ambos `.env`, solo backend la usa para firmar/verificar).
- `PlatformAdminGuard` nuevo — verifica ese JWT, puebla `request.platformAdminId`. Vive
  aislado, no toca `SedeGuard`/`RolesGuard` ni las rutas existentes.
- `POST /platform-admin/login` — `{ email, password }` → `200 { data: { token } }`.
  Errores: `UNAUTHORIZED` (401 — password o email inválido, mismo código reutilizado que
  el resto de la API; no revelar cuál de los dos falló).

**Fuera de alcance de hoy**: `POST /platform-admin` (alta de un miembro nuevo,
protegido, sin UI). No hace falta para la meta de hoy — el único `AdminPlataforma` de
prueba se crea directo en la DB vía script de bootstrap. Se construye cuando haga falta
un segundo miembro real.

### 3. `POST/GET/PATCH /sedes`

Guard: **solo** `PlatformAdminGuard` (sin `SedeGuard`/`RolesGuard` — esta ruta es, por
diseño, la única de toda la API sin contexto de sede).

- `POST /sedes` — body: `nombre` (string, requerido, único), `direccion`,
  `ubicacionReferencia`, `telefono` (requeridos), `costoRenta` (opcional, decimal).
  Éxito `201 { data: Sede }`. Errores: `VALIDATION_ERROR` (400 — falta campo requerido),
  `CONFLICT` (409 — `nombre` duplicado). Crea `RegistroAuditoria` en la misma transacción
  (`accion: ALTA`, `entidad: 'Sede'`, `entidadId` = id de la sede recién creada,
  `sedeId` = esa misma sede, `adminPlataformaId` del actor, `usuarioId: null`).
- `GET /sedes` — `200 { data: Sede[] }`. Sin paginación (2 sedes hoy, volumen bajo por
  naturaleza del recurso — no hay cientos de sedes en un ERP escolar regional).
- `PATCH /sedes/:id` — mismos campos que `POST`, todos opcionales (edición parcial).
  Errores: `VALIDATION_ERROR`, `CONFLICT` (nombre duplicado con otra sede), `NOT_FOUND`
  (404 — id no existe). Audita igual que `POST` (`accion: EDICION`).

Sin códigos de error nuevos — reutiliza los fijos.

### 4. Frontend

Árbol nuevo y aislado `App/frontend/src/app/plataforma/` (ni `app/admin` ni
`app/alumno`, mismo criterio que regla 11 de `CLAUDE.md` — identidad de plataforma es un
sistema de auth distinto):
- `app/plataforma/login/page.tsx` — form email+password, guarda el JWT propio (mismo
  mecanismo de storage que ya usa `app/login` para el JWT de Supabase, ver
  `lib/api/http.ts`).
- `app/plataforma/sedes/page.tsx` — tabla de sedes + formulario de alta/edición
  (mismo patrón de tabla ya usado en `app/admin/alumnos` y `app/admin/maestros`:
  React Query, sin fetch nativo suelto).
- `lib/api/sedes.ts` — cliente de los 3 endpoints, mismo patrón que
  `lib/api/personas.ts`.

**Fuera de alcance de hoy**: dashboard de plataforma con estadísticas cross-sede (el
roadmap ya lo marca "pendiente de alcance exacto, se define cuando se llegue a este
día" — es una feature aparte de la mera capacidad de crear sedes).

### 5. Bootstrap

Script de un solo uso, **no comiteado** (mismo patrón ya usado hoy para resetear la
password de `qa.prueba@cesp-merida.edu.mx`: se escribe, se corre, se borra). Crea
`plataforma.prueba@nexo-sd.mx` con password generada al momento, entregada solo en chat.

## Explícitamente fuera de alcance de hoy (P1, no bloquea la meta)

- `DELETE /sedes/:id` (decisión 2 arriba).
- `POST /platform-admin` (alta de miembro nuevo).
- Dashboard de plataforma con stats cross-sede.
- Mecanismo "entrar a administrar la sede X" desde el dashboard sin cuenta de esa sede
  (ya documentado como pendiente en `roadmap.md`, no lo toca este spec).

## Testing

- Backend: unit del guard (JWT válido/inválido/expirado), unit del hash de password,
  e2e de `POST/GET/PATCH /sedes` (incluye caso `CONFLICT` de nombre duplicado y
  `NOT_FOUND` en PATCH), verificación de que `RegistroAuditoria` queda bien poblado.
- Frontend: smoke manual (login real + crear sede real + verla en la tabla) — mismo
  criterio que el resto del proyecto, sin suite de tests de frontend instalada.
