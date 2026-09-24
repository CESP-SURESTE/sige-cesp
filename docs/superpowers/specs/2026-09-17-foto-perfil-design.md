# Foto de perfil (alumno/maestro/administrativo)

**Fecha:** 2026-09-17
**Estado:** aprobado, pendiente de implementación
**Alcance:** solo ALUMNO/MAESTRO/ADMINISTRATIVO (los 3 roles con cuenta Supabase Auth). `PersonalServicios` (sin cuenta, regla 8) y `AdminPlataforma` (identidad separada) quedan fuera.

## Motivación

Hoy no existe ningún mecanismo para asociar una foto a una persona — los avatares del `ProfileDropdown`, los listados de administrativos y el expediente de emergencia solo muestran iniciales. Pedido explícito del usuario: dar la opción de subir una foto real, visible en esos mismos lugares.

## Decisiones de diseño (del brainstorming)

- **Quién sube:** la propia persona desde su perfil, Y un administrativo desde el CRUD de personas (ambos pueden subir/reemplazar la foto de cualquier persona que ya podían editar/consultar).
- **Dónde se ve:** perfil propio, `ProfileDropdown` (navbar), listados de administrativos (`app/admin/alumnos|maestros|administrativos`), y el expediente del módulo de emergencia.
- **Dato:** `Usuario.fotoStoragePath` (nullable) — a nivel de `Usuario`, no duplicado en cada `Perfil*`. La foto no es dato específico de rol.
- **Storage:** bucket privado nuevo `fotos-perfil`, ruta fija por persona `{usuarioId}/foto.{ext}`, `upsert: true` (subir una nueva siempre reemplaza — mismo criterio que `MallaCurricular`, regla 6). Solo `image/jpeg`, `image/png`, `image/webp`. Límite 3MB.
- **Sin N+1 de signed URLs:** el backend firma en batch (`createSignedUrls`, plural — mismo cliente de Storage que ya usa `MallaCurricularService`) y **embebe `fotoUrl` directo** en las respuestas que el frontend ya consume (`GET /perfil`, `GET /personas?rol=...`, `GET /emergencia/expediente/...`) — nadie pide una URL aparte. Expiración: 15 minutos (más larga que la de malla, 300s, porque se re-consulta más seguido y no es un documento con datos médicos).
- **Fuera de alcance a propósito:** recorte/crop de imagen (se sube tal cual, el CSS la recorta a círculo visualmente), historial de fotos anteriores, `PersonalServicios`, `AdminPlataforma`.

## Backend

### 1. Migración — `Usuario.fotoStoragePath`

```prisma
model Usuario {
  // ...campos existentes...
  fotoStoragePath String? @map("foto_storage_path")
}
```

Nullable, sin backfill (mismo criterio de "rastro histórico, no se inventa" que `tipoSangre`/`tipoLicencia`). `prisma migrate dev` sigue roto en el repo (`P3006`) — generar con `prisma migrate diff` + aplicar con `migrate deploy`, mismo flujo que las migraciones recientes.

### 2. Bucket de Storage — script permanente `prisma/crear-bucket-fotos-perfil.ts`

Calco exacto de `prisma/crear-bucket-malla.ts` (idempotente, permanente, no es un script `-tmp.ts`):

```ts
const NOMBRE_BUCKET = 'fotos-perfil';
// createBucket(NOMBRE_BUCKET, { public: false, fileSizeLimit: '3MB',
//   allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] })
```

### 3. `FotoPerfilService` — módulo nuevo `src/foto-perfil/`

Mismo patrón de `MallaCurricularService`: `import()` dinámico + caché de `createAdminClient`, override de cliente para tests (`FOTO_PERFIL_SUPABASE_CLIENT_OVERRIDE`).

```ts
export const BUCKET_FOTOS_PERFIL = 'fotos-perfil';
const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];
const TRES_MB = 3 * 1024 * 1024;

class FotoPerfilService {
  // subir(usuarioId: string, sedeId: string, actorUsuarioId: string, file): Promise<{ ok: true }>
  // eliminar(usuarioId: string, sedeId: string, actorUsuarioId: string): Promise<{ ok: true }>
  // firmarUrls(paths: { usuarioId: string; storagePath: string }[]): Promise<Map<string, string>>
}
```

**`subir`:**
1. Validar `file` presente y `mimetype` en `TIPOS_PERMITIDOS` → `400 VALIDATION_ERROR` si no (mismo mensaje/código que `MallaCurricularService.subir`).
2. `usuario.findFirst({ where: { id: usuarioId, sedeId } })` — `404 NOT_FOUND` si no existe en la sede del actor (mismo criterio que `resetearPassword`). Si el actor es la propia persona (self-service vía `POST /perfil/foto`), `usuarioId` viene de `@ActorUsuarioId()`, nunca de un param — no hace falta este `findFirst` en ese caso, ya se sabe que existe (es el JWT).
3. `extension = mimetype → 'jpg'|'png'|'webp'` (whitelist explícita, nunca se toma del nombre de archivo que manda el cliente). `storagePath = \`${usuarioId}/foto.${extension}\`\`.
4. Si ya existía una foto con OTRA extensión (ej. tenía `.png` y ahora sube un `.jpg`), borrar el archivo viejo primero (`storage.remove([pathViejo])`) para no dejar huérfanos — el `upsert: true` de Storage solo sobreescribe si la ruta es idéntica.
5. `storage.from(BUCKET_FOTOS_PERFIL).upload(storagePath, file.buffer, { contentType: mimetype, upsert: true })` → `500 SERVER_ERROR` logueado si falla (regla 12).
6. `usuario.update({ where: { id: usuarioId }, data: { fotoStoragePath: storagePath } })` + `RegistroAuditoria` (`accion: EDICION`, `entidad: 'Usuario'`, `entidadId: usuarioId`, `detalle: { accion: 'foto_perfil_actualizada' }`) — en una transacción. Mismo criterio que `PATCH /auth/cambiar-password`: reusa `EDICION`, sin inventar un valor de enum nuevo (esto no es lo bastante sensible como para merecer uno propio, a diferencia de `CONSULTA_EMERGENCIA`/`RESETEO_PASSWORD`).
7. Retorna `{ ok: true }`.

**`eliminar`:** borra el archivo de Storage (best-effort — si Storage falla pero igual se limpia `fotoStoragePath`, la persona vuelve a ver su avatar de iniciales, que es el objetivo; un archivo huérfano en Storage no es un problema visible) + `usuario.update({ fotoStoragePath: null })` + auditoría `EDICION` en transacción.

**`firmarUrls`:** recibe una lista de `{ usuarioId, storagePath }` (ya filtrada a los que SÍ tienen `fotoStoragePath`, no `null`), llama `storage.from(BUCKET_FOTOS_PERFIL).createSignedUrls(paths, 900)` (900s = 15min) en una sola llamada, devuelve un `Map<usuarioId, url>` — silencioso ante errores individuales de un path (si uno falla, ese usuario simplemente no trae `fotoUrl` en la respuesta, no tumba toda la lista; loguear el error completo, regla 12).

### 4. Puntos de integración — dónde se llama `firmarUrls`

- **`PerfilService.obtenerPerfilPropio`** — si `usuario.fotoStoragePath` no es `null`, firma 1 sola URL (no hace falta batch para 1), agrega `fotoUrl` a la raíz de `data` (mismo nivel que `sede`/`alumno`/`maestro`/`administrativo`).
- **`PersonasService.listarPorSedeYRol`** — tras traer la página de `PersonaListItem[]`, recolectar los `usuarioId`+`fotoStoragePath` no nulos de esa página (nunca de toda la tabla — solo la página actual, evita firmar de más), batch-firmar, mapear `fotoUrl` a cada item. Campo nuevo en `PersonaListItem` (los 3 roles): `fotoUrl: string | null`.
- **`EmergenciaService` (expediente)** — 1 sola URL igual que el perfil propio, agregada a `identidad.fotoUrl`.

### 5. Endpoints nuevos

**Self-service — `PerfilController`:**
```ts
@Post('foto')
@UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: TRES_MB } }))
@UseFilters(ArchivoMuyGrandeFilter) // reusar el filtro existente de malla-curricular, no duplicar
async subirFoto(@ActorUsuarioId() actorUsuarioId, @SedeActual() sedeId, @UploadedFile() file) { ... }

@Delete('foto')
async eliminarFoto(@ActorUsuarioId() actorUsuarioId, @SedeActual() sedeId) { ... }
```
Sin `@Roles(...)` — mismo criterio que el resto de `PerfilController` de clase (`SedeGuard` solo), cualquier rol autenticado gestiona su propia foto.

**Admin — `PersonasController`:**
```ts
@Post(':id/foto')
@Roles(RolUsuario.ADMINISTRATIVO)
@UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: TRES_MB } }))
@UseFilters(ArchivoMuyGrandeFilter)
async subirFotoPersona(@Param('id') id, @SedeActual() sedeId, @ActorUsuarioId() actorUsuarioId, @UploadedFile() file) { ... }

@Delete(':id/foto')
@Roles(RolUsuario.ADMINISTRATIVO)
async eliminarFotoPersona(@Param('id') id, @SedeActual() sedeId, @ActorUsuarioId() actorUsuarioId) { ... }
```
Mismos guards que el resto de `PersonasController` (`SedeGuard`+`RolesGuard`, clase). **Sin** jerarquía de `nivelPermiso` — subir una foto no es una acción sobre la cuenta de un `ADMINISTRATIVO` en el sentido de la regla 7 (no cambia permisos ni estatus), mismo criterio que `POST /grupos`/`POST /carreras` (sin jerarquía).

`ArchivoMuyGrandeFilter` (hoy en `src/malla-curricular/`) se mueve a `src/common/filters/` para reusarlo desde 3 controllers sin import cruzado entre módulos de dominio — único cambio de ubicación de este plan, justificado por reuso real (no es refactor especulativo).

## Frontend

### 1. `lib/api/foto-perfil.ts` (compartido, `lib/api/` ya no tiene dueño de árbol — igual que `auth.ts`/`http.ts`)

```ts
export function subirFotoPropia(archivo: File): Promise<{ ok: true }>
export function eliminarFotoPropia(): Promise<{ ok: true }>
export function subirFotoPersona(usuarioId: string, archivo: File): Promise<{ ok: true }>
export function eliminarFotoPersona(usuarioId: string): Promise<{ ok: true }>
```

### 2. Componente `Avatar` — duplicado por árbol (regla 11)

`components/{admin,alumno,maestro}/ui/Avatar.tsx` — mismo componente, 3 copias (ningún import cruzado). Props `{ fotoUrl: string | null; nombre: string; tamano?: 'sm' | 'md' | 'lg' }`. Si `fotoUrl` es `null`, cae al mismo fallback de iniciales que ya usan `ProfileDropdown`/listados hoy (extraer la lógica de iniciales ya existente hacia este componente en vez de duplicarla otra vez).

### 3. Subida — modal reutilizando el patrón de `SubirMallaModal.tsx`

- **Self-service:** control nuevo en los 3 perfiles propios (`app/admin/perfil`, `app/alumno` sección de perfil, `app/maestro`) — preview + drag&drop, mismo esqueleto visual que `SubirMallaModal.tsx` (barra de progreso, auto-cierre 1.5s tras éxito), adaptado a imagen en vez de PDF (preview con `<img>`/object URL en vez de `<embed>`).
- **Admin sobre otra persona:** ícono de cámara por fila en los 3 listados (`app/admin/alumnos|maestros|administrativos/page.tsx`) que abre el mismo tipo de modal, apuntando a `subirFotoPersona(usuarioId, ...)`. Independiente del estándar de modal único alta/edición (regla 13, pausado) — esto es una acción puntual sobre una fila, no un CRUD de la entidad completa.

### 4. Integración de `Avatar`

- `ProfileDropdown.tsx` (3 árboles) — círculo de iniciales reemplazado por `<Avatar fotoUrl={perfil.fotoUrl} .../>`, usando el `fotoUrl` que ya trae `GET /perfil` (sin fetch nuevo).
- Listados de `app/admin/alumnos|maestros|administrativos` — columna nueva al inicio de cada fila con `<Avatar tamano="sm" .../>`, usando el `fotoUrl` que ya trae `GET /personas`.
- `app/admin/emergencia/` (panel de expediente) — `<Avatar tamano="lg" .../>` junto a la identidad, usando el `fotoUrl` que ya trae `GET /emergencia/expediente/...`.

## Fuera de alcance

- Recorte/crop de imagen en el cliente o servidor.
- Historial de fotos anteriores (cada subida reemplaza, sin versiones).
- `PersonalServicios` (sin cuenta) y `AdminPlataforma` (identidad separada).
- Mover el estándar de modal único alta/edición (regla 13) a los listados — el ícono de cámara es una acción puntual, no reabre ese trabajo pausado.
- Redimensionar/comprimir la imagen server-side (se sube tal cual, dentro del límite de 3MB).

## Verificación

- `nest build` + suite e2e (`foto-perfil` nueva: self-service sube/reemplaza/borra, admin sube/borra para otra persona, tipo de archivo inválido → 400, archivo >3MB → 400, `GET /perfil`/`GET /personas`/`GET /emergencia/expediente` traen `fotoUrl` correcto tras subir, aislamiento cross-sede en `POST /personas/:id/foto`).
- `pnpm build` + `pnpm lint` del frontend limpios.
- Verificación manual en navegador: subir foto propia desde los 3 perfiles, subir/reemplazar/quitar foto de otra persona desde cada uno de los 3 listados admin, confirmar que se ve en el navbar, en la fila del listado, y en el expediente de emergencia.
