# Malla curricular — Descarga desde perfil de alumno (Fase 7, Día 24)

**Fecha:** 2026-08-20
**Fase:** 7 (Malla curricular), Día 24 de `docs/roadmap.md` — cierra la fase.

## Contexto

Día 23 (2026-08-19) construyó `MallaCurricularModule` completo del lado de
subida: bucket privado `mallas-curriculares` en Supabase Storage (sin
políticas RLS, el backend siempre usa el service role), `POST
/carreras/:id/malla` (solo `ADMINISTRATIVO`), upsert 1-a-1 con `Carrera`
(regla 6 de `CLAUDE.md` raíz), ruta fija `{carreraId}/malla.pdf` en el
bucket. `GET /perfil` ya devuelve `alumno.carrera.id` desde Día 16. Falta
el lado de descarga: que el propio alumno pueda bajar el PDF de su carrera
desde su perfil, sin exponer el bucket públicamente.

## Decisiones (confirmadas con el usuario)

1. **Endpoint sin `:id` en la ruta** — `GET /perfil/malla`, el backend
   deriva la carrera del actor desde su propio `PerfilAlumno` (JWT `sub`
   vía `@ActorUsuarioId()`), igual que `GET /perfil` y `PATCH
   /auth/cambiar-password`. Se descartó `GET /carreras/:id/malla/descarga`
   (reusar el patrón sub-recurso con `:id` explícito) porque habría exigido
   una capa extra de validación (verificar que el `:id` recibido coincide
   con la carrera real del actor) que la opción elegida no necesita al no
   confiar nunca en un `:id` del cliente para esto.
2. **Expiración de la signed URL: 5 minutos.** Se genera una URL nueva en
   cada click del alumno (nunca se cachea en el frontend).
3. **"Carrera sin malla subida todavía" → `200` con `data: null`**, mismo
   criterio que `MallaCurricularService.obtener()` (Día 23): es un estado
   normal, no un error. El frontend muestra un mensaje tranquilizador
   ("tu malla aún no ha sido cargada por la escuela, estará disponible
   pronto"), sin `toast.error` ni `console.error` — no es una falla.
4. **El botón pide la signed URL en el click**, no la precarga al montar la
   página — sin `useQuery` adicional, sin URL firmada generada de más que
   nunca se usa, sin riesgo de que expire antes de que el alumno la use.

## Diseño

### 1. Backend — `MallaCurricularService.obtenerUrlDescargaPropia`

Nuevo método en el service ya existente (`App/backend/src/malla-curricular/malla-curricular.service.ts`)
— toda la lógica de Storage (cliente admin, bucket, `storagePath`) ya vive
ahí, no se duplica en `PerfilService`.

```ts
async obtenerUrlDescargaPropia(
  actorUsuarioId: string,
): Promise<{ url: string; nombreArchivo: string } | null> {
  const perfilAlumno = await this.prisma.perfilAlumno.findUnique({
    where: { usuarioId: actorUsuarioId },
    select: { carreraId: true },
  });
  if (!perfilAlumno) {
    // Defensivo — no debería pasar nunca (regla 3: baja lógica, un
    // usuario con rol ALUMNO siempre tiene su PerfilAlumno).
    throw new NotFoundException({
      error: 'Perfil de alumno no encontrado',
      code: 'NOT_FOUND',
    });
  }

  const malla = await this.prisma.mallaCurricular.findUnique({
    where: { carreraId: perfilAlumno.carreraId },
    select: { storagePath: true, nombreArchivo: true },
  });
  if (!malla) return null; // estado normal, decisión 3

  const client = await this.getClient();
  const { data, error } = await client.storage
    .from(BUCKET_MALLA_CURRICULAR)
    .createSignedUrl(malla.storagePath, 300); // 5 min, decisión 2
  if (error || !data) {
    console.error('[MallaCurricularService.obtenerUrlDescargaPropia] error de Storage:', error);
    throw new InternalServerErrorException({
      error: 'No se pudo generar el enlace de descarga. Intenta de nuevo.',
      code: 'SERVER_ERROR',
    });
  }

  return { url: data.signedUrl, nombreArchivo: malla.nombreArchivo };
}
```

### 2. Backend — `GET /perfil/malla`

`PerfilModule` importa `MallaCurricularModule` (que exporta
`MallaCurricularService`). `PerfilController` gana la ruta:

```ts
@Get('malla')
@UseGuards(RolesGuard)
@Roles(RolUsuario.ALUMNO)
async obtenerUrlDescargaMalla(@ActorUsuarioId() actorUsuarioId: string) {
  const data = await this.mallaCurricularService.obtenerUrlDescargaPropia(actorUsuarioId);
  return { data };
}
```

`RolesGuard` se declara a nivel de método (no de clase — `PerfilController`
hoy solo tiene `SedeGuard` de clase, porque `GET /perfil` es para
cualquier rol). Sin código de error nuevo — reutiliza `NOT_FOUND` (caso
defensivo) y `SERVER_ERROR` (falla real de Storage). `ROL_NO_AUTORIZADO`
(`RolesGuard`) aplica igual que en cualquier ruta con `@Roles(...)` — un
maestro o administrativo que llame este endpoint recibe `403`.

**Éxito:** `200 { data: { url: string; nombreArchivo: string } | null } }`.

### 3. Frontend — `lib/api/perfil.ts`

Mismo archivo (no uno nuevo — es un campo lógico del perfil de alumno, no
un dominio aparte):

```ts
export function obtenerUrlDescargaMalla(): Promise<{ url: string; nombreArchivo: string } | null> {
  return apiFetchAuth('/perfil/malla');
}
```

### 4. Frontend — `SeccionCarrera` (`app/alumno/page.tsx`)

Botón "Descargar malla curricular" al final de la sección, con estado
local `descargando: boolean` (deshabilita el botón mientras la petición
está en vuelo, evita doble-click abriendo 2 pestañas):

```ts
async function handleDescargar() {
  setDescargando(true);
  try {
    const resultado = await obtenerUrlDescargaMalla();
    if (!resultado) {
      toast.info(
        'Tu malla curricular aún no ha sido cargada por la escuela. Estará disponible pronto.',
      );
      return;
    }
    window.open(resultado.url, '_blank');
  } catch (err) {
    console.error('[SeccionCarrera] Error al descargar malla:', err);
    toast.error(
      err instanceof ApiError ? err.message : 'No se pudo descargar la malla. Intenta de nuevo.',
    );
  } finally {
    setDescargando(false);
  }
}
```

`toast.info` (sonner, ya usado en el proyecto) para el caso "aún no
subida" — no es un error. `toast.error` + `console.error` (regla 12 de
`CLAUDE.md` raíz) solo para fallas reales de red/servidor.

## Testing

- **Backend e2e** (extiende `test/malla-curricular.e2e-spec.ts` de Día 23):
  - Alumno con malla en su carrera → `200` con `url`/`nombreArchivo`
    reales; se valida forma de la URL (contiene el `storagePath`
    esperado), sin descargar el PDF real.
  - Alumno cuya carrera no tiene malla → `200 data: null`.
  - Maestro/administrativo llamando el endpoint → `403 ROL_NO_AUTORIZADO`.
  - Sin JWT → `401`.
- **Frontend:** `tsc --noEmit` + `eslint` en los archivos tocados — sin
  suite de tests (`App/frontend/src` no tiene ninguna, mismo criterio ya
  documentado para el resto del árbol de UI).
- **Verificación manual** (entregable visible del roadmap): alumno de
  prueba descarga su malla real desde `/alumno` en el navegador.

## Fuera de alcance

- Descarga desde la vista de maestro/administrativo — el roadmap pide
  específicamente perfil de alumno.
- Precarga del estado "tiene/no tiene malla" al montar la página (se pidió
  explícitamente que la URL se pida solo en el click).
- Indicador de "última vez descargada" o cualquier registro de auditoría
  de la descarga — `RegistroAuditoria` (regla 5) audita acciones de
  escritura del sistema, no lecturas/descargas de un alumno sobre su
  propio recurso; no hay precedente de auditar un `GET` en este proyecto.
