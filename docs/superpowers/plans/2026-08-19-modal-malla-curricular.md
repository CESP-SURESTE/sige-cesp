# Modal de subida de malla curricular Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el flujo actual de "Subir malla" (botón + selector nativo, ya cerrado y funcionando) por un modal con drag&drop, preview, progreso real de subida, y visibilidad de quién/cuándo subió la malla vigente.

**Architecture:** 2 endpoints backend nuevos/extendidos en el módulo ya existente (`GET /carreras` gana `tieneMalla`; `GET /carreras/:id/malla` nuevo, mismo módulo `malla-curricular/`). Frontend: fetcher compartido extendido para soportar progreso de subida (`XMLHttpRequest`, no `fetch`), un componente de modal nuevo y local a la ruta, e integración en la página existente.

**Tech Stack:** NestJS + Prisma (backend, sin cambios de stack). Frontend: React Query + `XMLHttpRequest` nativo (sin librería de upload/progreso nueva).

## Global Constraints

- `GET /carreras/:id/malla` devuelve `200 { data: MallaInfo | null }` — `null` cuando no hay malla, NUNCA `404` para ese caso (404 es solo para carrera inexistente/de otra sede).
- Mismos guards en todo el módulo `malla-curricular/`: `SedeGuard` + `RolesGuard(ADMINISTRATIVO)`, `SedeGuard` primero.
- El nuevo upload por `XMLHttpRequest` es EXCLUSIVO de `subirMallaCurricular` — ningún otro fetcher del árbol cambia de `fetch` a XHR.
- El modal es local a `app/admin/carreras/` — no se crea un componente `Modal`/`Dialog` genérico compartido.
- Límites de archivo en cliente (PDF, ≤5MB) deben seguir coincidiendo exactamente con los del backend — mismos mensajes ya usados hoy.
- Regla 12 de `CLAUDE.md` raíz — todo catch real (no validación deliberada) loguea con `console.error` antes de responder/mostrar el error.

---

### Task 1: Backend — `tieneMalla` en `GET /carreras` + `GET /carreras/:id/malla`

**Files:**
- Modify: `App/backend/src/carreras/carreras.service.ts:57-62` (método `listarPorSede`)
- Modify: `App/backend/src/malla-curricular/malla-curricular.service.ts` (agrega `MallaCurricularInfo` + método `obtener`)
- Modify: `App/backend/src/malla-curricular/malla-curricular.controller.ts` (agrega `GET :id/malla`)
- Modify: `App/backend/test/carreras.e2e-spec.ts` (agrega verificación de `tieneMalla`)
- Modify: `App/backend/test/malla-curricular.e2e-spec.ts` (agrega tests de `GET :id/malla` y de `tieneMalla` tras subir)

**Interfaces:**
- Produces: `MallaCurricularService.obtener(carreraId: string, sedeId: string): Promise<MallaCurricularInfo | null>`, `export interface MallaCurricularInfo { nombreArchivo: string; subidaEn: Date; subidaPor: { nombres: string; apellidoPaterno: string; apellidoMaterno: string | null } }`. `CarrerasService.listarPorSede` ahora devuelve `Array<Carrera & { tieneMalla: boolean }>` en vez de `Carrera[]`.

- [ ] **Step 1: `tieneMalla` en `CarrerasService.listarPorSede`**

En `App/backend/src/carreras/carreras.service.ts`, el método actual (líneas 57-62) es:

```ts
  async listarPorSede(sedeId: string): Promise<Carrera[]> {
    return this.prisma.carrera.findMany({
      where: { sedeId },
      orderBy: { nombre: 'asc' },
    });
  }
```

Reemplázalo por:

```ts
  async listarPorSede(
    sedeId: string,
  ): Promise<Array<Carrera & { tieneMalla: boolean }>> {
    const carreras = await this.prisma.carrera.findMany({
      where: { sedeId },
      orderBy: { nombre: 'asc' },
      include: { mallaCurricular: { select: { id: true } } },
    });

    return carreras.map(({ mallaCurricular, ...carrera }) => ({
      ...carrera,
      tieneMalla: mallaCurricular !== null,
    }));
  }
```

Actualiza también el comentario de cabecera de este método (líneas 46-56) agregando una línea que documente el campo nuevo: "`tieneMalla` (2026-08-19) — booleano derivado de si existe la relación 1-a-1 con `MallaCurricular` (regla 1: nunca se persiste, se deriva al vuelo); alimenta el indicador de la tabla del modal de subida de malla."

- [ ] **Step 2: `MallaCurricularInfo` + `obtener` en `MallaCurricularService`**

En `App/backend/src/malla-curricular/malla-curricular.service.ts`, agrega (después de la constante `BUCKET_MALLA_CURRICULAR`, antes de la clase):

```ts
/**
 * `GET /carreras/:id/malla` — detalle de la malla vigente (quién y cuándo
 * la subió), consumido por el modal de subida al abrirse.
 */
export interface MallaCurricularInfo {
  nombreArchivo: string;
  subidaEn: Date;
  subidaPor: {
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string | null;
  };
}
```

Dentro de la clase `MallaCurricularService`, después del método `subir` (al final, antes del cierre `}` de la clase), agrega:

```ts

  /**
   * `GET /carreras/:id/malla` — `null` (200, NUNCA 404 para este caso) si
   * la carrera todavía no tiene malla, es un estado normal. La carrera
   * debe existir y pertenecer a la sede del actor, mismo criterio que
   * `subir` — `404 NOT_FOUND` si no.
   */
  async obtener(
    carreraId: string,
    sedeId: string,
  ): Promise<MallaCurricularInfo | null> {
    const carrera = await this.prisma.carrera.findFirst({
      where: { id: carreraId, sedeId },
    });
    if (!carrera) {
      throw new NotFoundException({
        error: 'Carrera no encontrada en tu sede',
        code: 'NOT_FOUND',
      });
    }

    const malla = await this.prisma.mallaCurricular.findUnique({
      where: { carreraId },
      select: {
        nombreArchivo: true,
        subidaEn: true,
        subidaPor: {
          select: {
            perfilAdministrativo: {
              select: {
                nombres: true,
                apellidoPaterno: true,
                apellidoMaterno: true,
              },
            },
          },
        },
      },
    });

    if (!malla) {
      return null;
    }
    if (!malla.subidaPor.perfilAdministrativo) {
      // Defensivo — no debería pasar nunca en la práctica (regla 3: baja
      // lógica, un `Usuario` que alguna vez subió una malla siempre tuvo
      // rol ADMINISTRATIVO, y su `PerfilAdministrativo` nunca se borra).
      console.error(
        '[MallaCurricularService.obtener] malla sin perfilAdministrativo del actor:',
        carreraId,
      );
      return null;
    }

    return {
      nombreArchivo: malla.nombreArchivo,
      subidaEn: malla.subidaEn,
      subidaPor: malla.subidaPor.perfilAdministrativo,
    };
  }
```

- [ ] **Step 3: `GET :id/malla` en `MallaCurricularController`**

En `App/backend/src/malla-curricular/malla-curricular.controller.ts`, agrega `Get` al import existente de `@nestjs/common` (línea 1-11, junto a `Controller`, `HttpCode`, etc.). Dentro de la clase, después del método `subir` (al final, antes del cierre `}` de la clase), agrega:

```ts

  @Get(':id/malla')
  @Roles(RolUsuario.ADMINISTRATIVO)
  async obtener(@Param('id') id: string, @SedeActual() sedeId: string) {
    const data = await this.mallaCurricularService.obtener(id, sedeId);
    return { data };
  }
```

- [ ] **Step 4: Verificar tipos**

Run: `cd App/backend && npx tsc --noEmit`
Expected: sin salida, exit 0.

- [ ] **Step 5: Extender `test/carreras.e2e-spec.ts` con `tieneMalla`**

El `interface ListarCarrerasBody` actual (tras el fix de la sesión anterior) es:

```ts
interface ListarCarrerasBody {
  data: Array<{ id: string; nombre: string; clave: string; sedeId: string }>;
}
```

Reemplázalo por:

```ts
interface ListarCarrerasBody {
  data: Array<{
    id: string;
    nombre: string;
    clave: string;
    sedeId: string;
    tieneMalla: boolean;
  }>;
}
```

En el test `'caso feliz -> 200, ...'`, dentro del `for (const carrera of body.data) { ... }` que ya verifica las claves del objeto completo, agrega la verificación del campo nuevo — el bloque actual termina con `expect(claves).toContain('descripcion');`, agrégale justo después:

```ts
      expect(claves).toContain('tieneMalla');
      expect(typeof carrera.tieneMalla).toBe('boolean');
```

- [ ] **Step 6: Agregar tests de `GET :id/malla` y `tieneMalla` a `test/malla-curricular.e2e-spec.ts`**

Dentro del mismo `describe('MallaCurricularController — POST /carreras/:id/malla (e2e)', ...)` (no crees un describe nuevo — mismo módulo, mismo setup de JWT/mock ya existente), agrega estos `it(...)` al final, antes del cierre `});` del describe:

```ts

  it('GET /carreras/:id/malla sin malla previa -> 200 con data null', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeValladolidId,
      rol: RolUsuario.ADMINISTRATIVO,
    });
    const carreraSinMalla = await prisma.carrera.findUniqueOrThrow({
      where: { clave: 'LC-VLD' },
    });

    const res = await request(app.getHttpServer())
      .get(`/carreras/${carreraSinMalla.id}/malla`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect((res.body as { data: unknown }).data).toBeNull();
  });

  it('GET /carreras/:id/malla con malla previa -> 200 con nombreArchivo/subidaEn/subidaPor', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    await request(app.getHttpServer())
      .post(`/carreras/${carreraMeridaId}/malla`)
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', Buffer.from('%PDF-1.4'), {
        filename: 'malla.pdf',
        contentType: 'application/pdf',
      });

    const res = await request(app.getHttpServer())
      .get(`/carreras/${carreraMeridaId}/malla`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as {
      data: {
        nombreArchivo: string;
        subidaEn: string;
        subidaPor: { nombres: string; apellidoPaterno: string };
      };
    };
    expect(body.data.nombreArchivo).toBe('malla.pdf');
    expect(body.data.subidaPor.nombres).toBe('Ana María');
    expect(body.data.subidaPor.apellidoPaterno).toBe('Canul');
  });

  it('GET /carreras/:id/malla con carrera de otra sede -> 404 NOT_FOUND', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeValladolidId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .get(`/carreras/${carreraMeridaId}/malla`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('GET /carreras refleja tieneMalla:true tras una subida exitosa', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    await request(app.getHttpServer())
      .post(`/carreras/${carreraMeridaId}/malla`)
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', Buffer.from('%PDF-1.4'), {
        filename: 'malla.pdf',
        contentType: 'application/pdf',
      });

    const listado = await request(app.getHttpServer())
      .get('/carreras')
      .set('Authorization', `Bearer ${token}`);

    const body = listado.body as {
      data: Array<{ id: string; tieneMalla: boolean }>;
    };
    const carreraListada = body.data.find((c) => c.id === carreraMeridaId);
    expect(carreraListada?.tieneMalla).toBe(true);
  });
```

- [ ] **Step 7: Correr la suite e2e**

Run: `cd App/backend && npm run test:e2e -- carreras.e2e-spec` (4 tests, incluida la verificación de `tieneMalla`)
Run: `cd App/backend && npm run test:e2e -- malla-curricular` (13 tests: 9 de antes + 4 nuevos de este task)
Expected: ambas suites en verde.

- [ ] **Step 8: Correr la suite e2e completa (sin regresión)**

Run: `cd App/backend && npm run test:e2e`
Expected: todas las suites en verde (la sesión anterior dejó 133/133, sin fallas — debe seguir así, más los 4 tests nuevos).

- [ ] **Step 9: Verificar lint**

Run: `cd App/backend && npx eslint src test`
Expected: sin salida, exit 0.

- [ ] **Step 10: Commit**

```bash
git add App/backend/src/carreras/carreras.service.ts App/backend/src/malla-curricular/malla-curricular.service.ts App/backend/src/malla-curricular/malla-curricular.controller.ts App/backend/test/carreras.e2e-spec.ts App/backend/test/malla-curricular.e2e-spec.ts
git commit -m "feat(backend): tieneMalla en GET /carreras + GET /carreras/:id/malla

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Frontend — API layer (`http.ts` + `carreras.ts`)

**Files:**
- Modify: `App/frontend/src/lib/api/http.ts:17,55-133`
- Modify: `App/frontend/src/lib/api/carreras.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores en este repo (frontend, independiente del backend en tiempo de compilación — el contrato ya está fijado por el spec).
- Produces: `export const API_URL` (de `http.ts`), `export async function obtenerAccessToken(): Promise<string>` (de `http.ts`), `export interface MallaCurricularInfo { nombreArchivo: string; subidaEn: string; subidaPor: { nombres: string; apellidoPaterno: string; apellidoMaterno: string | null } }` (de `carreras.ts`), `export function obtenerMallaCurricular(carreraId: string): Promise<MallaCurricularInfo | null>`, `export function subirMallaCurricular(carreraId: string, file: File, onProgress?: (porcentaje: number) => void): Promise<MallaCurricular>` (firma cambiada — gana el 3er parámetro opcional, `MallaCurricular` ya existe de Día 23, sin cambios).

- [ ] **Step 1: Exportar `API_URL` y extraer `obtenerAccessToken` en `http.ts`**

En `App/frontend/src/lib/api/http.ts`, línea 17, cambia:

```ts
const API_URL = process.env.NEXT_PUBLIC_API_URL;
```

por:

```ts
export const API_URL = process.env.NEXT_PUBLIC_API_URL;
```

El bloque actual (líneas 113-133) es:

```ts
/** Compartido entre `apiFetchAuth` y `apiFetchAuthPaginado` — resuelve el
 * mismo `Authorization: Bearer <token>` una sola vez. */
async function resolveAuthHeaders(
  init?: RequestInit,
): Promise<RequestInit> {
  const supabase = createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  if (!accessToken) {
    throw new Error('No hay una sesión activa. Vuelve a iniciar sesión.');
  }

  return {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...init?.headers,
    },
  };
}
```

Reemplázalo por:

```ts
/**
 * Resuelve el `access_token` de la sesión actual — extraído de
 * `resolveAuthHeaders` (2026-08-19) porque `subirMallaCurricular`
 * (`carreras.ts`) lo necesita para construir un `XMLHttpRequest` a mano
 * (progreso real de subida, `fetch` no lo expone de forma práctica) sin
 * pasar por `apiFetchAuth`.
 */
export async function obtenerAccessToken(): Promise<string> {
  const supabase = createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  if (!accessToken) {
    throw new Error('No hay una sesión activa. Vuelve a iniciar sesión.');
  }
  return accessToken;
}

/** Compartido entre `apiFetchAuth` y `apiFetchAuthPaginado` — resuelve el
 * mismo `Authorization: Bearer <token>` una sola vez. */
async function resolveAuthHeaders(
  init?: RequestInit,
): Promise<RequestInit> {
  const accessToken = await obtenerAccessToken();
  return {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...init?.headers,
    },
  };
}
```

- [ ] **Step 2: Verificar tipos tras el cambio de `http.ts`**

Run: `cd App/frontend && npx tsc --noEmit`
Expected: sin salida, exit 0.

- [ ] **Step 3: Agregar `MallaCurricularInfo`/`obtenerMallaCurricular` y reescribir `subirMallaCurricular` en `carreras.ts`**

En `App/frontend/src/lib/api/carreras.ts`, agrega `API_URL` y `obtenerAccessToken` al import de `./http` que ya existe (`import { apiFetchAuth } from './http';` pasa a `import { apiFetchAuth, API_URL, ApiError, obtenerAccessToken } from './http';`).

El bloque actual de `MallaCurricular`/`subirMallaCurricular` (agregado en Día 23, al final del archivo) es:

```ts
/**
 * `MallaCurricular` — Fase 7, Día 23. Espejo de `model MallaCurricular`
 * (`schema.prisma`) tal como lo devuelve `POST /carreras/:id/malla` —
 * sin `carrera` (relación completa, el frontend no la necesita acá).
 */
export interface MallaCurricular {
  id: string;
  carreraId: string;
  storagePath: string;
  nombreArchivo: string;
  subidaEn: string;
  subidaPorId: string;
}

/**
 * `POST /carreras/:id/malla` — sube el PDF de malla curricular (multipart,
 * campo `archivo`). Upsert 1-a-1 con la carrera (regla 6 de `CLAUDE.md`
 * raíz) — reemplaza la malla vigente si ya había una.
 */
export function subirMallaCurricular(
  carreraId: string,
  file: File,
): Promise<MallaCurricular> {
  const formData = new FormData();
  formData.append('archivo', file);
  return apiFetchAuth<MallaCurricular>(`/carreras/${carreraId}/malla`, {
    method: 'POST',
    body: formData,
  });
}
```

Reemplázalo por (mantiene `MallaCurricular` sin cambios, reescribe solo `subirMallaCurricular`, y agrega `MallaCurricularInfo`/`obtenerMallaCurricular` nuevos):

```ts
/**
 * `MallaCurricular` — Fase 7, Día 23. Espejo de `model MallaCurricular`
 * (`schema.prisma`) tal como lo devuelve `POST /carreras/:id/malla` —
 * sin `carrera` (relación completa, el frontend no la necesita acá).
 */
export interface MallaCurricular {
  id: string;
  carreraId: string;
  storagePath: string;
  nombreArchivo: string;
  subidaEn: string;
  subidaPorId: string;
}

/**
 * `GET /carreras/:id/malla` — detalle de quién y cuándo subió la malla
 * vigente. `null` si la carrera todavía no tiene malla (no es un error).
 */
export interface MallaCurricularInfo {
  nombreArchivo: string;
  subidaEn: string;
  subidaPor: {
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string | null;
  };
}

export function obtenerMallaCurricular(
  carreraId: string,
): Promise<MallaCurricularInfo | null> {
  return apiFetchAuth<MallaCurricularInfo | null>(
    `/carreras/${carreraId}/malla`,
  );
}

/**
 * `POST /carreras/:id/malla` con progreso real de subida — usa
 * `XMLHttpRequest` en vez de `apiFetchAuth`/`fetch` (2026-08-19) porque
 * `fetch` no expone eventos de progreso de subida de forma práctica en el
 * navegador; es la única llamada de este árbol que lo necesita. Mismo
 * contrato de retorno y de errores (`ApiError` con `code`/`status`) que
 * el resto de la API — `onProgress` es opcional, sin cambio de
 * comportamiento para callers que no lo pasan.
 */
export function subirMallaCurricular(
  carreraId: string,
  file: File,
  onProgress?: (porcentaje: number) => void,
): Promise<MallaCurricular> {
  return new Promise((resolve, reject) => {
    obtenerAccessToken()
      .then((token) => {
        const formData = new FormData();
        formData.append('archivo', file);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_URL}/carreras/${carreraId}/malla`);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);

        xhr.upload.onprogress = (e) => {
          if (onProgress && e.lengthComputable) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        };

        xhr.onload = () => {
          let body: unknown = null;
          try {
            body = JSON.parse(xhr.responseText);
          } catch {
            body = null;
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve((body as { data: MallaCurricular }).data);
          } else {
            const failure = body as Partial<{ error: string; code: string }> | null;
            reject(
              new ApiError(
                failure?.error ?? 'Error inesperado del servidor',
                failure?.code ?? 'SERVER_ERROR',
                xhr.status,
              ),
            );
          }
        };

        xhr.onerror = () => {
          reject(new Error('Error de red al subir la malla curricular.'));
        };

        xhr.send(formData);
      })
      .catch(reject);
  });
}
```

También agrega `tieneMalla: boolean` a la interfaz `CarreraCompleta` ya existente en este archivo (el campo va al final, junto a `updatedAt`):

```ts
export interface CarreraCompleta {
  id: string;
  nombre: string;
  clave: string;
  duracion: number;
  nivel: NivelCarrera;
  modalidad: ModalidadCarrera;
  estatus: EstatusCarrera;
  rvoe: string;
  descripcion: string;
  createdAt: string;
  updatedAt: string;
  tieneMalla: boolean;
}
```

- [ ] **Step 4: Verificar tipos**

Run: `cd App/frontend && npx tsc --noEmit`
Expected: sin salida, exit 0. (`Carrera` sigue siendo alias de `CarreraCompleta` — el campo nuevo se propaga solo, sin tocar `admin/carreras/page.tsx` todavía, eso es Task 4.)

- [ ] **Step 5: Verificar lint**

Run: `cd App/frontend && npx eslint src/lib/api/http.ts src/lib/api/carreras.ts`
Expected: sin salida, exit 0.

- [ ] **Step 6: Commit**

```bash
git add App/frontend/src/lib/api/http.ts App/frontend/src/lib/api/carreras.ts
git commit -m "feat(frontend): API layer para modal de malla - progreso real de subida + tieneMalla

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Frontend — componente `SubirMallaModal.tsx`

**Files:**
- Create: `App/frontend/src/app/admin/carreras/SubirMallaModal.tsx`

**Interfaces:**
- Consumes: `obtenerMallaCurricular`, `subirMallaCurricular`, `type Carrera`, `type MallaCurricularInfo` (todos de `@/lib/api/carreras`, producidos en Task 2), `ApiError` (de `@/lib/api/http`).
- Produces: `export interface SubirMallaModalProps { carrera: Carrera; onClose: () => void; onSubidoConExito: () => void }`, `export function SubirMallaModal(props: SubirMallaModalProps)` — consumido por Task 4.

- [ ] **Step 1: Crear el componente**

```tsx
'use client';

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api/http';
import {
  obtenerMallaCurricular,
  subirMallaCurricular,
  type Carrera,
} from '@/lib/api/carreras';

const CINCO_MB = 5 * 1024 * 1024;

export interface SubirMallaModalProps {
  carrera: Carrera;
  onClose: () => void;
  onSubidoConExito: () => void;
}

function formatearPeso(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Mismo criterio exacto que `app/admin/perfil/page.tsx` (fechas ISO 8601
 * del backend, se formatea solo la parte de fecha, sin hora). */
function formatearFecha(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return iso;
  return new Intl.DateTimeFormat('es-MX', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(fecha);
}

/**
 * Modal de subida de malla curricular — mejora de UX sobre el flujo
 * mecánico de Día 23 (botón + selector nativo, ya cerrado y probado).
 * Local a esta ruta, sin componente `Modal`/`Dialog` genérico — mismo
 * criterio que `app/plataforma/sedes/ConfirmarEliminarSedeModal.tsx`
 * (primer modal "real" de este árbol, no se justifica generalizar
 * todavía con un solo caso más).
 */
export function SubirMallaModal({
  carrera,
  onClose,
  onSubidoConExito,
}: SubirMallaModalProps) {
  const [arrastrando, setArrastrando] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [exito, setExito] = useState(false);
  const [errorSubida, setErrorSubida] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cierreTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mallaQuery = useQuery({
    queryKey: ['admin', 'carreras', carrera.id, 'malla'],
    queryFn: async () => {
      try {
        return await obtenerMallaCurricular(carrera.id);
      } catch (err) {
        console.error(
          '[SubirMallaModal] Error al obtener la malla vigente:',
          err,
        );
        throw err;
      }
    },
  });

  // El object URL de la preview se revoca al cambiar de archivo o al
  // desmontar — evita acumular blobs sin liberar en la sesión del navegador.
  useEffect(() => {
    if (!archivo) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(archivo);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [archivo]);

  useEffect(() => {
    return () => {
      if (cierreTimeoutRef.current) clearTimeout(cierreTimeoutRef.current);
    };
  }, []);

  function seleccionarArchivo(file: File) {
    setErrorSubida(null);
    if (file.type !== 'application/pdf') {
      toast.error('El archivo debe ser un PDF.');
      return;
    }
    if (file.size > CINCO_MB) {
      toast.error('El archivo no puede pesar más de 5MB.');
      return;
    }
    setArchivo(file);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setArrastrando(false);
    if (subiendo) return;
    const file = e.dataTransfer.files?.[0];
    if (file) seleccionarArchivo(file);
  }

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) seleccionarArchivo(file);
  }

  function handleSubir() {
    if (!archivo) return;
    setSubiendo(true);
    setProgreso(0);
    setErrorSubida(null);

    subirMallaCurricular(carrera.id, archivo, setProgreso)
      .then(() => {
        setSubiendo(false);
        setExito(true);
        onSubidoConExito();
        cierreTimeoutRef.current = setTimeout(() => {
          onClose();
        }, 1500);
      })
      .catch((err: unknown) => {
        console.error(
          '[SubirMallaModal] Error al subir la malla curricular:',
          { carreraId: carrera.id, nombreArchivo: archivo.name, err },
        );
        setSubiendo(false);
        const mensaje =
          err instanceof ApiError
            ? err.message
            : 'No se pudo subir la malla curricular. Intenta de nuevo.';
        setErrorSubida(mensaje);
        toast.error(mensaje);
      });
  }

  function handleCerrar() {
    if (subiendo) return;
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate/40 p-4"
      onClick={handleCerrar}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-slate">
            Malla curricular — {carrera.nombre}
          </h2>
          <button
            type="button"
            onClick={handleCerrar}
            disabled={subiendo}
            className="text-slate/60 hover:text-slate disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {exito ? (
          <div className="mt-6 rounded-lg border border-success-border bg-success-bg p-4 text-center">
            <p className="text-sm font-medium text-success">
              Malla curricular actualizada
            </p>
          </div>
        ) : (
          <>
            {mallaQuery.isLoading && (
              <p className="mt-4 text-sm text-slate/60">Cargando…</p>
            )}
            {mallaQuery.data && (
              <p className="mt-4 rounded-lg border border-mist bg-bone/60 px-3 py-2 text-xs text-slate/70">
                Subida por {mallaQuery.data.subidaPor.nombres}{' '}
                {mallaQuery.data.subidaPor.apellidoPaterno}
                {mallaQuery.data.subidaPor.apellidoMaterno
                  ? ` ${mallaQuery.data.subidaPor.apellidoMaterno}`
                  : ''}{' '}
                el {formatearFecha(mallaQuery.data.subidaEn)}
              </p>
            )}

            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (!subiendo) setArrastrando(true);
              }}
              onDragLeave={() => setArrastrando(false)}
              onDrop={handleDrop}
              onClick={() => !subiendo && inputRef.current?.click()}
              className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                arrastrando ? 'border-navy bg-navy/5' : 'border-mist'
              } ${subiendo ? 'pointer-events-none opacity-50' : ''}`}
            >
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={handleInputChange}
                disabled={subiendo}
              />
              {archivo && previewUrl ? (
                <div className="w-full space-y-2">
                  <p className="text-sm font-medium text-slate">{archivo.name}</p>
                  <p className="text-xs text-slate/60">{formatearPeso(archivo.size)}</p>
                  <embed
                    src={previewUrl}
                    type="application/pdf"
                    className="h-48 w-full rounded border border-mist"
                  />
                </div>
              ) : (
                <p className="text-sm text-slate/60">
                  Arrastra un PDF aquí, o haz click para seleccionarlo (máx. 5MB)
                </p>
              )}
            </div>

            {errorSubida && (
              <p className="mt-3 rounded-lg border border-error-border bg-error-bg px-3 py-2 text-sm text-crimson">
                {errorSubida}
              </p>
            )}

            {subiendo && (
              <div className="mt-4">
                <div className="h-2 w-full rounded-full bg-mist">
                  <div
                    className="h-2 rounded-full bg-navy transition-all"
                    style={{ width: `${progreso}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-slate/60">{progreso}%</p>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={handleCerrar}
                disabled={subiendo}
                className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSubir}
                disabled={!archivo || subiendo}
                className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
              >
                {subiendo ? 'Subiendo…' : 'Subir'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `cd App/frontend && npx tsc --noEmit`
Expected: sin salida, exit 0. (Este archivo todavía no se importa desde ningún lado — Task 4 lo conecta — así que `tsc` solo confirma que el archivo en sí compila.)

- [ ] **Step 3: Verificar lint**

Run: `cd App/frontend && npx eslint src/app/admin/carreras/SubirMallaModal.tsx`
Expected: sin salida, exit 0.

- [ ] **Step 4: Commit**

```bash
git add App/frontend/src/app/admin/carreras/SubirMallaModal.tsx
git commit -m "feat(frontend): componente SubirMallaModal (drag&drop, preview, progreso real)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Frontend — integrar el modal en `app/admin/carreras/page.tsx`

**Files:**
- Modify: `App/frontend/src/app/admin/carreras/page.tsx`

**Interfaces:**
- Consumes: `SubirMallaModal`, `type SubirMallaModalProps` (de `./SubirMallaModal`, Task 3). `Carrera.tieneMalla` (de Task 2).
- Produces: nada — hoja del árbol, nadie más importa `page.tsx`.

- [ ] **Step 1: Quitar el mecanismo viejo, agregar el estado del modal**

El import actual de React (línea 4) es:

```ts
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
```

Reemplázalo por (ya no se necesitan `useRef` ni `ChangeEvent` en este archivo — el modal los maneja internamente):

```ts
import { useState, type FormEvent } from 'react';
```

El import de `@/lib/api/carreras` actual (líneas 13-24) es:

```ts
import {
  actualizarCarrera,
  crearCarrera,
  listarCarreras,
  subirMallaCurricular,
  type ActualizarCarreraInput,
  type Carrera,
  type CrearCarreraInput,
  type EstatusCarrera,
  type ModalidadCarrera,
  type NivelCarrera,
} from '@/lib/api/carreras';
```

Reemplázalo por (ya no se llama `subirMallaCurricular` directo desde esta página, el modal lo hace):

```ts
import {
  actualizarCarrera,
  crearCarrera,
  listarCarreras,
  type ActualizarCarreraInput,
  type Carrera,
  type CrearCarreraInput,
  type EstatusCarrera,
  type ModalidadCarrera,
  type NivelCarrera,
} from '@/lib/api/carreras';
```

Agrega el import del modal nuevo, junto a los demás imports locales:

```ts
import { SubirMallaModal } from './SubirMallaModal';
```

- [ ] **Step 2: Quitar el bloque viejo de estado/mutación de malla**

El bloque actual (después de `actualizarMutation`, antes de `function handleSubmitNuevo`) es:

```ts
  const [carreraIdParaMalla, setCarreraIdParaMalla] = useState<string | null>(null);
  const inputMallaRef = useRef<HTMLInputElement>(null);

  const subirMallaMutation = useMutation({
    mutationFn: (vars: { carreraId: string; file: File }) =>
      subirMallaCurricular(vars.carreraId, vars.file),
    onSuccess: () => {
      toast.success('Malla curricular actualizada');
    },
    onError: (err, vars) => {
      console.error('[AdminCarrerasPage] Error al subir malla curricular:', {
        carreraId: vars.carreraId,
        nombreArchivo: vars.file.name,
        err,
      });
      toast.error(resolverMensajeError(err, MENSAJES_ERROR_CARRERA) ?? MENSAJE_ERROR_GENERICO);
    },
  });

  function iniciarSubidaMalla(carreraId: string) {
    setCarreraIdParaMalla(carreraId);
    inputMallaRef.current?.click();
  }

  function handleArchivoMallaSeleccionado(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite volver a seleccionar el mismo archivo dos veces seguidas
    if (!file || !carreraIdParaMalla) return;

    if (file.type !== 'application/pdf') {
      toast.error('El archivo debe ser un PDF.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('El archivo no puede pesar más de 5MB.');
      return;
    }

    subirMallaMutation.mutate({ carreraId: carreraIdParaMalla, file });
  }
```

Elimínalo por completo y reemplázalo por una sola línea:

```ts
  const [carreraParaMalla, setCarreraParaMalla] = useState<Carrera | null>(null);
```

- [ ] **Step 3: Quitar el `<input>` oculto**

El bloque actual (entre el cierre del `form`/`if` de alta-o-edición y el `<div className="overflow-x-auto ...">` de la tabla) es:

```tsx
      <input
        ref={inputMallaRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={handleArchivoMallaSeleccionado}
      />

```

Elimínalo por completo (incluida la línea en blanco que lo separa del `<div>` siguiente).

- [ ] **Step 4: Actualizar el botón "Subir malla" de la fila**

El bloque actual dentro de `<td className="px-4 py-3 text-right">` es:

```tsx
                  <button
                    onClick={() => iniciarSubidaMalla(carrera.id)}
                    disabled={subirMallaMutation.isPending}
                    className="mr-4 text-navy hover:underline disabled:opacity-50"
                  >
                    {subirMallaMutation.isPending && subirMallaMutation.variables?.carreraId === carrera.id
                      ? 'Subiendo…'
                      : 'Subir malla'}
                  </button>
```

Reemplázalo por:

```tsx
                  <button
                    onClick={() => setCarreraParaMalla(carrera)}
                    className="mr-4 text-navy hover:underline"
                  >
                    {carrera.tieneMalla && (
                      <span className="mr-1 text-success">✓</span>
                    )}
                    Subir malla
                  </button>
```

- [ ] **Step 5: Renderizar el modal**

Justo antes del `</div>` final que cierra el componente `AdminCarrerasPage` (después del `</div>` que cierra la tabla), agrega:

```tsx

      {carreraParaMalla && (
        <SubirMallaModal
          carrera={carreraParaMalla}
          onClose={() => setCarreraParaMalla(null)}
          onSubidoConExito={() => {
            toast.success('Malla curricular actualizada');
            void queryClient.invalidateQueries({ queryKey: ['admin', 'carreras'] });
          }}
        />
      )}
```

- [ ] **Step 6: Verificar tipos**

Run: `cd App/frontend && npx tsc --noEmit`
Expected: sin salida, exit 0.

- [ ] **Step 7: Verificar lint**

Run: `cd App/frontend && npx eslint src/app/admin/carreras/page.tsx`
Expected: sin salida, exit 0.

- [ ] **Step 8: Commit**

```bash
git add App/frontend/src/app/admin/carreras/page.tsx
git commit -m "feat(frontend): integra SubirMallaModal en la tabla de carreras

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Verificación manual final (recomendada antes de cerrar)

Con backend y frontend corriendo: entrar a `/admin/carreras`, click en "Subir malla" de una carrera sin malla (sin la palomita ✓) → confirmar que el modal abre sin banner de "Subida por...". Arrastrar un PDF válido (<5MB) sobre la zona de drop → confirmar que aparece nombre/peso/preview. Click "Subir" → confirmar barra de progreso avanzando, todo bloqueado, mensaje de éxito, cierre automático, toast, y que la fila ahora muestra la palomita ✓. Reabrir el modal de esa misma carrera → confirmar que ahora sí muestra "Subida por {tu nombre} el {fecha de hoy}". Repetir con un archivo >5MB y con un archivo no-PDF (arrastrando, no solo con click) → confirmar que ambos se rechazan con el mensaje correcto sin llegar a la barra de progreso.
