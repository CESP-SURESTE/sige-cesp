# Malla curricular — Storage y subida (Fase 7, Día 23)

**Fecha:** 2026-08-19
**Fase:** 7 (Malla curricular), Día 23 de `docs/roadmap.md`.

## Contexto

`MallaCurricular` ya existe en `schema.prisma` (24 tablas migradas desde el
inicio del proyecto) — 1-a-1 con `Carrera` (`carreraId @unique`),
`storagePath`/`nombreArchivo`/`subidaEn`/`subidaPorId`. Nunca se construyó
el endpoint ni el bucket de Storage. Regla 6 de `CLAUDE.md` raíz:
"`MallaCurricular` es upsert — 1-a-1 con Carrera; subir PDF reemplaza al
vigente; apartado independiente del alta de Carrera (ningún campo de malla
es obligatorio ahí)".

Alcance de hoy: **backend + frontend** (decisión del usuario — el
entregable del roadmap, "admin sube un PDF real", implica poder hacerlo
desde la UI real, no solo Postman). Descarga/signed URLs es Día 24, fuera
de alcance.

## Decisiones (confirmadas con el usuario)

1. **Bucket privado `mallas-curriculares`**, creado una sola vez vía script
   de backend (Admin API de Supabase Storage) — mismo patrón que
   `seed.ts`/el bootstrap de `AdminPlataforma`, no manual en el Dashboard.
2. **Límite de tamaño: 5 MB.**
3. **Backend + frontend hoy**, no solo backend.

## Diseño

### 1. Bucket — script de bootstrap

`App/backend/prisma/crear-bucket-malla.ts` (permanente, a diferencia de los
scripts `-tmp.ts` de hoy — es infraestructura repetible, como `seed.ts`, no
un one-off): llama a
`(await getAdminClient()).storage.createBucket('mallas-curriculares', {
public: false, fileSizeLimit: '5MB', allowedMimeTypes: ['application/pdf']
})`. Idempotente — si el bucket ya existe, Supabase devuelve un error
`Bucket already exists` que el script atrapa y trata como éxito (no falla
la segunda corrida). Sin políticas RLS de Storage — el backend siempre usa
el service role (bypassa RLS igual que ya hace con Auth Admin API), el
frontend nunca toca Supabase Storage directo (mismo criterio ya
establecido: todo pasa por el backend).

Ruta de cada archivo dentro del bucket: `{carreraId}/malla.pdf` — nombre
fijo, cada subida nueva sobreescribe (`upsert: true` en la llamada de
Storage), consistente con "reemplaza al vigente" — sin versiones viejas
huérfanas acumulándose.

### 2. Backend — `POST /carreras/:id/malla`

Nuevo módulo `App/backend/src/malla-curricular/` (`MallaCurricularModule`,
`MallaCurricularController`, `MallaCurricularService`) — sub-recurso de
`Carrera` (regla 4, mismo criterio que contactos/info médica), no se mete
dentro de `CarrerasController` para no mezclar responsabilidades (el
módulo de carreras no necesita saber de Storage).

- **Guards:** `SedeGuard` + `RolesGuard(ADMINISTRATIVO)` — igual que
  `CarrerasController`.
- **Interceptor:** `FileInterceptor('archivo', { limits: { fileSize: 5 *
  1024 * 1024 } })` de `@nestjs/platform-express` — rechaza antes de
  llegar al handler si excede el límite.
- **Validación en el service:**
  - Carrera debe existir y pertenecer a `@SedeActual()` → `404 NOT_FOUND`
    si no (mismo patrón que `carreraId` en `POST /personas`).
  - `file.mimetype !== 'application/pdf'` → `400 VALIDATION_ERROR`.
  - Sin archivo en el request → `400 VALIDATION_ERROR`.
- **Flujo:** sube el buffer a Storage (`{carreraId}/malla.pdf`, `upsert:
  true`) → `prisma.mallaCurricular.upsert()` (`where: { carreraId }`,
  `storagePath`, `nombreArchivo: file.originalname`, `subidaPorId:
  @ActorUsuarioId()`, `subidaEn` la maneja el default de Prisma en create
  pero hay que setearla explícito en el `update` del upsert — `subidaEn:
  new Date()` — para que quede la fecha de la subida más reciente, no la
  de la primera vez).
- **Éxito:** `200 { data: { id, carreraId, nombreArchivo, subidaEn,
  subidaPorId } }` — siempre 200 (semánticamente "fijar la malla vigente",
  no una creación estricta, mismo criterio que otros upserts de esta API).
- **Sin código de error nuevo** — reutiliza `VALIDATION_ERROR`/`NOT_FOUND`.

**Dependencia nueva:** `@types/multer` (devDependency) — `multer` en sí ya
está instalado transitivamente vía `@nestjs/platform-express`, solo faltan
los tipos de TS para `Express.Multer.File`.

### 3. Frontend — botón "Subir malla" en `app/admin/carreras/page.tsx`

Regla 6: "apartado independiente del alta de Carrera" — no se agrega al
formulario de alta/edición existente. Se agrega una acción más en la fila
de la tabla (junto a "Editar"): botón "Subir malla" que abre un `<input
type="file" accept="application/pdf">` oculto (mismo patrón sin librería
nueva que el resto del árbol admin). Al seleccionar un PDF, dispara una
`useMutation` que hace `POST /carreras/:id/malla` con `FormData` — éxito:
`toast.success('Malla curricular actualizada')`; error: `console.error` +
`toast.error(...)` (mismo patrón de regla 12 ya establecido en todo el
árbol admin esta sesión). Validación en cliente antes de mandar (tipo
`application/pdf`, tamaño ≤ 5MB) con `toast.error` si falla — evita un
round-trip al backend para errores obvios, pero el backend valida igual
por su cuenta (nunca confiar solo en el cliente).

`lib/api/carreras.ts` gana `subirMallaCurricular(carreraId: string, file:
File): Promise<MallaCurricular>` — usa `apiFetchAuth` pero con
`FormData` en vez de JSON (sin `Content-Type` manual, el navegador lo pone
solo con el boundary correcto).

No se agrega indicador visual de "esta carrera ya tiene malla" hoy — fuera
de alcance, no lo pidió el roadmap ni el usuario; se puede agregar cuando
se construya Día 24 (descarga), que sí necesita saber si existe.

## Fuera de alcance

- Descarga/signed URLs, botón de descarga en perfil de alumno (Día 24).
- Indicador de "malla ya subida" en la tabla de carreras.
- Reemplazar el bucket/política si en algún momento el frontend necesitara
  acceso directo a Storage (no aplica con el diseño actual, todo pasa por
  el backend).
