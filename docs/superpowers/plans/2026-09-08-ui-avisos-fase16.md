# UI de Avisos (Fase 16, Días 47-48) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la UI de publicación (admin + maestro) y recepción (los 3 roles) de avisos sobre el backend de la Fase 16 ya existente, más el único endpoint de backend que falta (`GET /avisos/publicados`), y cerrar la Fase 16.

**Architecture:** Un endpoint nuevo de solo lectura en el `AvisosController`/`AvisosService` existentes lista los avisos publicados por el actor con contadores de recibo resueltos en batch. En el frontend, un API client compartido (`lib/api/avisos.ts`) y tres árboles de UI independientes (`app/admin/avisos/`, `app/maestro/avisos/`, `app/alumno/avisos/`), cada uno con sus modales locales (regla 11 — sin imports cruzados). El detalle de un aviso siempre es un modal que dispara `GET /avisos/:id` (marca leído). Sin migraciones nuevas.

**Tech Stack:** NestJS + Prisma 6 (backend), Next.js 16 + React Query + Tailwind (frontend), Jest + supertest (e2e backend). Gestor de paquetes `pnpm`.

## Global Constraints

Copiados del spec `docs/superpowers/specs/2026-09-08-ui-avisos-fase16-design.md` y del `CLAUDE.md` raíz. Cada task los hereda:

- **Contrato de API:** éxito `{ data: ... }` (+ `page`/`limit`/`total` en listas paginadas); error `{ error, code }`. Sin códigos de error nuevos en toda esta fase — reusar `VALIDATION_ERROR` / `NOT_FOUND` / `ROL_NO_AUTORIZADO`.
- **Regla 1:** nunca persistir datos calculables — `alcanceNombre`, `totalDestinatarios`, `leidos` se derivan al vuelo.
- **Regla 2:** `sedeId` SIEMPRE de `@SedeActual()` (JWT), nunca de body/query/path.
- **Regla 11:** árboles `app/{admin,maestro,alumno}` independientes. Cada uno duplica sus modales; ningún archivo bajo `app/maestro/` o `app/alumno/` importa de `app/admin/` ni de `components/admin/`. `lib/api/` SÍ es infraestructura compartida (ya lo es: `calendario.ts`, `perfil.ts`).
- **Regla 12:** todo `queryFn` / `mutationFn` / `catch` de backend loguea el error completo con `console.error` antes de propagar o responder.
- **Regla 13:** pantalla CRUD de admin = tabla + botón "+ Nuevo X" que abre un modal. Aquí solo hay alta (el backend no tiene `PATCH /avisos/:id`). Los campos del modal se limpian al cerrar (cancelar o guardar OK). Sin componente `Modal` genérico compartido entre árboles.
- **Convención de rutas:** segmento fijo antes de `:id` dinámico — `GET /avisos/publicados` se declara antes de `@Get(':id')`.
- **Ruta propia por árbol**, no "sección apilada" — mismo criterio que Calendario (Fase 15). El roadmap Día 48 dice "apilada" pero está desactualizado; manda el spec.
- **Backend responde camelCase, fechas ISO 8601.** Prisma camelCase/PascalCase ↔ DB snake_case ya resuelto en el schema.
- **`pnpm` siempre** (nunca `npm`/`yarn`). Backend: `cd App/backend`. Frontend: `cd App/frontend`.
- **No agregar dependencias nuevas.** Todo lo necesario ya está instalado (`@tanstack/react-query`, `sonner`, `@headlessui/react`).
- **`prisma migrate dev` está roto** (`P3006`) — pero esta fase no toca el schema, así que no aplica.

---

## Task 1: Backend — `GET /avisos/publicados`

**Files:**
- Modify: `App/backend/src/avisos/avisos.service.ts` (añadir interface `AvisoPublicadoItem` + método público `listarPublicadosPorActor` + 2 helpers privados `resolverAlcanceNombres`, `contarRecibosPorAviso`)
- Modify: `App/backend/src/avisos/avisos.controller.ts` (añadir handler `@Get('publicados')` justo después de `feed()`)
- Test: `App/backend/test/avisos.e2e-spec.ts` (añadir `describe('GET /avisos/publicados', ...)` con 6 casos)

**Interfaces:**
- Consumes: `PrismaService`, decorators `@SedeActual()` / `@ActorUsuarioId()` / `@Roles()`, `ListarAvisosQueryDto`, `RolUsuario`, `AlcanceDestino` (todos ya importados en esos archivos o en `@prisma/client`).
- Produces (lo consume el frontend en Task 2):
  - `GET /avisos/publicados?page=&limit=` → `200 { data: AvisoPublicadoItem[], page, limit, total }`
  - ```ts
    interface AvisoPublicadoItem {
      id: string;
      titulo: string;
      cuerpo: string;
      alcanceTipo: 'SEDE' | 'CARRERA' | 'GRUPO';
      alcanceId: string | null;
      alcanceNombre: string | null; // 'Toda la sede' | nombre de carrera | nombre de grupo | null si el alcanceId ya no existe
      createdAt: string;            // ISO
      totalDestinatarios: number;
      leidos: number;
    }
    ```

- [ ] **Step 1: Escribir el bloque de tests e2e que falla**

En `App/backend/test/avisos.e2e-spec.ts`, añadir después del `describe('GET /avisos/:id/recibos y DELETE /avisos/:id', ...)` (antes del cierre del `describe` raíz):

```ts
describe('GET /avisos/publicados', () => {
  it('el autor ve solo los avisos que publicó, no los de otro admin de la misma sede', async () => {
    // Aviso del admin de Mérida
    await postAviso(await tokenAdminMerida(), {
      titulo: 'Publicado por admin Mérida',
      cuerpo: 'x',
      alcanceTipo: 'GRUPO',
      alcanceId: grupoId,
    });
    // Aviso de un maestro de la misma sede (otro autor)
    await postAviso(await tokenMaestro(), {
      titulo: 'Publicado por maestro',
      cuerpo: 'y',
      alcanceTipo: 'GRUPO',
      alcanceId: grupoId,
    });

    const res = await request(app.getHttpServer())
      .get('/avisos/publicados?page=1&limit=50')
      .set('Authorization', `Bearer ${await tokenAdminMerida()}`);

    expect(res.status).toBe(200);
    const body = res.body as {
      data: { titulo: string }[];
      page: number;
      limit: number;
      total: number;
    };
    const titulos = body.data.map((a) => a.titulo);
    expect(titulos).toContain('Publicado por admin Mérida');
    expect(titulos).not.toContain('Publicado por maestro');
    expect(body.page).toBe(1);
  });

  it('no incluye avisos de otra sede', async () => {
    const res = await request(app.getHttpServer())
      .get('/avisos/publicados?page=1&limit=50')
      .set('Authorization', `Bearer ${await tokenAdminValladolid()}`);
    expect(res.status).toBe(200);
    const body = res.body as { data: { id: string }[] };
    // El admin de Valladolid no ha publicado nada en esta suite
    expect(body.data).toEqual([]);
  });

  it('totalDestinatarios y leidos son correctos tras una lectura', async () => {
    const pub = await postAviso(await tokenAdminMerida(), {
      titulo: 'Con recibo',
      cuerpo: 'z',
      alcanceTipo: 'GRUPO',
      alcanceId: grupoId,
    });
    const avisoId = (pub.body as AvisoBody).data.id;

    // El alumno matriculado lo abre → 1 recibo leído
    await request(app.getHttpServer())
      .get(`/avisos/${avisoId}`)
      .set('Authorization', `Bearer ${await tokenAlumno()}`);

    const res = await request(app.getHttpServer())
      .get('/avisos/publicados?page=1&limit=50')
      .set('Authorization', `Bearer ${await tokenAdminMerida()}`);
    const row = (res.body as { data: (AvisoPublicadoItemBody & { id: string })[] }).data.find(
      (a) => a.id === avisoId,
    );
    expect(row).toBeDefined();
    expect(row!.totalDestinatarios).toBeGreaterThanOrEqual(1);
    expect(row!.leidos).toBeGreaterThanOrEqual(1);
    expect(row!.leidos).toBeLessThanOrEqual(row!.totalDestinatarios);
  });

  it('alcanceNombre: "Toda la sede" para SEDE, nombre de grupo para GRUPO', async () => {
    await postAviso(await tokenAdminMerida(), {
      titulo: 'A toda la sede',
      cuerpo: 'a',
      alcanceTipo: 'SEDE',
    });
    const res = await request(app.getHttpServer())
      .get('/avisos/publicados?page=1&limit=50')
      .set('Authorization', `Bearer ${await tokenAdminMerida()}`);
    const data = (res.body as { data: AvisoPublicadoItemBody[] }).data;
    const sede = data.find((a) => a.titulo === 'A toda la sede');
    expect(sede!.alcanceNombre).toBe('Toda la sede');
    const grupo = data.find((a) => a.alcanceTipo === 'GRUPO');
    expect(typeof grupo!.alcanceNombre).toBe('string');
    expect(grupo!.alcanceNombre!.length).toBeGreaterThan(0);
  });

  it('un ALUMNO recibe 403 ROL_NO_AUTORIZADO', async () => {
    const res = await request(app.getHttpServer())
      .get('/avisos/publicados')
      .set('Authorization', `Bearer ${await tokenAlumno()}`);
    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });

  it('limit fuera de rango: 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .get('/avisos/publicados?limit=999')
      .set('Authorization', `Bearer ${await tokenAdminMerida()}`);
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });
});
```

Y añadir el tipo auxiliar junto a los otros `interface ...Body` del inicio del archivo (cerca de `interface FeedBody`):

```ts
interface AvisoPublicadoItemBody {
  id: string;
  titulo: string;
  cuerpo: string;
  alcanceTipo: string;
  alcanceId: string | null;
  alcanceNombre: string | null;
  createdAt: string;
  totalDestinatarios: number;
  leidos: number;
}
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd App/backend && pnpm test:e2e -- avisos`
Expected: FAIL — los 6 casos nuevos fallan con `404` (la ruta `/avisos/publicados` cae en `@Get(':id')` y responde "Aviso no encontrado") o `expect` no cumplido.

- [ ] **Step 3: Añadir `AvisoPublicadoItem` + `listarPublicadosPorActor` + helpers al service**

En `App/backend/src/avisos/avisos.service.ts`, después de la interface `FeedItem` (línea ~46), añadir:

```ts
/**
 * Item de `GET /avisos/publicados` — la tabla de gestión del autor (Día 47).
 * `alcanceNombre`, `totalDestinatarios` y `leidos` se derivan al vuelo
 * (regla 1), resueltos en batch para evitar N+1. `alcanceNombre` es `null`
 * si el `alcanceId` apunta a una carrera/grupo ya borrado (defensivo).
 */
export interface AvisoPublicadoItem {
  id: string;
  titulo: string;
  cuerpo: string;
  alcanceTipo: AlcanceDestino;
  alcanceId: string | null;
  alcanceNombre: string | null;
  createdAt: Date;
  totalDestinatarios: number;
  leidos: number;
}
```

Dentro de la clase `AvisosService`, después de `feedDelActor` (antes de `verDetalleYMarcarLeido`), añadir el método público:

```ts
/**
 * `GET /avisos/publicados` — Fase 16, Día 47. Los avisos que el actor
 * (`ADMINISTRATIVO`/`MAESTRO`) publicó en su sede, paginado, con
 * contadores de recibo. `where` acotado a `{ sedeId, autorUsuarioId }` —
 * el backend nunca confía en un `autorUsuarioId` de query (regla 2, mismo
 * criterio que `sedeId`).
 */
async listarPublicadosPorActor(
  actorUsuarioId: string,
  sedeId: string,
  page: number,
  limit: number,
): Promise<{
  data: AvisoPublicadoItem[];
  page: number;
  limit: number;
  total: number;
}> {
  try {
    const where = { sedeId, autorUsuarioId: actorUsuarioId };
    const [total, avisos] = await Promise.all([
      this.prisma.aviso.count({ where }),
      this.prisma.aviso.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          titulo: true,
          cuerpo: true,
          alcanceTipo: true,
          alcanceId: true,
          createdAt: true,
        },
      }),
    ]);

    const avisoIds = avisos.map((a) => a.id);
    const [alcanceNombres, contadores] = await Promise.all([
      this.resolverAlcanceNombres(avisos),
      this.contarRecibosPorAviso(avisoIds),
    ]);

    const data: AvisoPublicadoItem[] = avisos.map((a) => ({
      id: a.id,
      titulo: a.titulo,
      cuerpo: a.cuerpo,
      alcanceTipo: a.alcanceTipo,
      alcanceId: a.alcanceId,
      alcanceNombre: alcanceNombres.get(a.id) ?? null,
      createdAt: a.createdAt,
      totalDestinatarios: contadores.get(a.id)?.total ?? 0,
      leidos: contadores.get(a.id)?.leidos ?? 0,
    }));
    return { data, page, limit, total };
  } catch (err) {
    console.error(
      '[AvisosService.listarPublicadosPorActor] error inesperado:',
      err,
    );
    throw err;
  }
}
```

Al final de la clase (junto a `resolverNombresAutores`), añadir los 2 helpers privados:

```ts
/**
 * `alcanceId` → nombre legible, en batch. SEDE no tiene id ("Toda la
 * sede"); CARRERA/GRUPO se resuelven con un `findMany` cada uno. Un
 * `alcanceId` que ya no existe → `null` (no rompe la tabla del cliente).
 */
private async resolverAlcanceNombres(
  avisos: {
    id: string;
    alcanceTipo: AlcanceDestino;
    alcanceId: string | null;
  }[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  const carreraIds = new Set<string>();
  const grupoIds = new Set<string>();
  for (const a of avisos) {
    if (a.alcanceTipo === AlcanceDestino.SEDE) {
      map.set(a.id, 'Toda la sede');
    } else if (a.alcanceTipo === AlcanceDestino.CARRERA && a.alcanceId) {
      carreraIds.add(a.alcanceId);
    } else if (a.alcanceTipo === AlcanceDestino.GRUPO && a.alcanceId) {
      grupoIds.add(a.alcanceId);
    }
  }
  const [carreras, grupos] = await Promise.all([
    carreraIds.size
      ? this.prisma.carrera.findMany({
          where: { id: { in: [...carreraIds] } },
          select: { id: true, nombre: true },
        })
      : Promise.resolve([] as { id: string; nombre: string }[]),
    grupoIds.size
      ? this.prisma.grupo.findMany({
          where: { id: { in: [...grupoIds] } },
          select: { id: true, nombre: true },
        })
      : Promise.resolve([] as { id: string; nombre: string }[]),
  ]);
  const carreraNombre = new Map(carreras.map((c) => [c.id, c.nombre]));
  const grupoNombre = new Map(grupos.map((g) => [g.id, g.nombre]));
  for (const a of avisos) {
    if (map.has(a.id)) continue;
    if (a.alcanceTipo === AlcanceDestino.CARRERA) {
      map.set(a.id, carreraNombre.get(a.alcanceId ?? '') ?? null);
    } else if (a.alcanceTipo === AlcanceDestino.GRUPO) {
      map.set(a.id, grupoNombre.get(a.alcanceId ?? '') ?? null);
    } else {
      map.set(a.id, null);
    }
  }
  return map;
}

/**
 * `avisoId` → `{ total, leidos }` de sus `Notificacion` `tipo: AVISO`
 * (el snapshot de destinatarios fijado al publicar). Un solo `findMany`
 * para todos los avisos de la página.
 */
private async contarRecibosPorAviso(
  avisoIds: string[],
): Promise<Map<string, { total: number; leidos: number }>> {
  const map = new Map<string, { total: number; leidos: number }>();
  if (avisoIds.length === 0) return map;
  const notifs = await this.prisma.notificacion.findMany({
    where: { tipo: 'AVISO', referenciaId: { in: avisoIds } },
    select: { referenciaId: true, leidoEn: true },
  });
  for (const n of notifs) {
    const cur = map.get(n.referenciaId) ?? { total: 0, leidos: 0 };
    cur.total += 1;
    if (n.leidoEn !== null) cur.leidos += 1;
    map.set(n.referenciaId, cur);
  }
  return map;
}
```

Verificar que `AlcanceDestino` ya está en el `import { ... } from '@prisma/client'` del tope del archivo (lo está — línea 6). Si `AlcanceDestino.SEDE` etc. no tipa, usar los literales `'SEDE'`/`'CARRERA'`/`'GRUPO'` como en `crear-aviso.dto.ts`.

- [ ] **Step 4: Añadir el handler al controller**

En `App/backend/src/avisos/avisos.controller.ts`, inmediatamente **después** del método `feed()` (que termina en la línea ~70) y **antes** de `@Get(':id/recibos')`, añadir:

```ts
/**
 * `GET /avisos/publicados` — Fase 16, Día 47. Los avisos que publicó el
 * actor (no los que recibió — eso es `GET /avisos`). Segmento fijo
 * declarado antes de `@Get(':id')` (convención específico→genérico del
 * repo). `@Roles(ADMINISTRATIVO, MAESTRO)` — un ALUMNO no publica, 403.
 */
@Get('publicados')
@Roles(RolUsuario.ADMINISTRATIVO, RolUsuario.MAESTRO)
async publicados(
  @Query() query: ListarAvisosQueryDto,
  @SedeActual() sedeId: string,
  @ActorUsuarioId() actorUsuarioId: string,
) {
  return this.avisosService.listarPublicadosPorActor(
    actorUsuarioId,
    sedeId,
    query.page ?? 1,
    query.limit ?? 20,
  );
}
```

(No re-envolver en `{ data }` — `listarPublicadosPorActor` ya devuelve `{ data, page, limit, total }`, mismo patrón que `feed()`.)

- [ ] **Step 5: Correr los tests para verificar que pasan**

Run: `cd App/backend && pnpm test:e2e -- avisos`
Expected: PASS — la suite `avisos` completa en verde (los 6 casos nuevos + los ~30 previos sin regresión).

- [ ] **Step 6: Verificar build y suite e2e completa**

Run: `cd App/backend && pnpm build && pnpm test:e2e`
Expected: `nest build` sin errores; toda la suite e2e del backend en verde.

- [ ] **Step 7: Commit**

```bash
git add App/backend/src/avisos/ App/backend/test/avisos.e2e-spec.ts
git commit -m "feat(backend): GET /avisos/publicados (avisos publicados por el actor)"
```

---

## Task 2: Frontend — API client compartido `lib/api/avisos.ts`

**Files:**
- Create: `App/frontend/src/lib/api/avisos.ts`
- (Sin archivo de test — ningún `lib/api/*.ts` del repo tiene test unitario; la verificación es `tsc` + su consumo real en Tasks 3-5.)

**Interfaces:**
- Consumes: `apiFetchAuth`, `apiFetchAuthPaginado`, `ApiListaPaginada` de `./http`; el contrato de Task 1 (`GET /avisos/publicados`) y el contrato de backend ya existente (`POST /avisos`, `GET /avisos`, `GET /avisos/:id`, `GET /avisos/:id/recibos`, `DELETE /avisos/:id`).
- Produces (lo consumen Tasks 3, 4, 5):
  - `publicarAviso(input: CrearAvisoInput): Promise<Aviso>`
  - `listarAvisosPublicados(params?: { page?: number; limit?: number }): Promise<ApiListaPaginada<AvisoPublicadoItem>>`
  - `obtenerFeedAvisos(params?: { page?: number; limit?: number }): Promise<ApiListaPaginada<AvisoFeedItem>>`
  - `obtenerDetalleAviso(id: string): Promise<AvisoFeedItem>`
  - `obtenerRecibosAviso(id: string): Promise<RecibosAviso>`
  - `eliminarAviso(id: string): Promise<{ ok: true }>`
  - tipos: `AlcanceTipoAviso`, `CrearAvisoInput`, `Aviso`, `AvisoPublicadoItem`, `AvisoFeedItem`, `RecibosAviso`, `DestinatarioRecibo`

- [ ] **Step 1: Crear el archivo con todos los tipos y funciones**

`App/frontend/src/lib/api/avisos.ts`:

```ts
import { apiFetchAuth, apiFetchAuthPaginado, type ApiListaPaginada } from './http';

/**
 * `/avisos` — Fase 16 (backend Días 45-46, UI Días 47-48). Shape espejo de
 * `AvisosService` (`App/backend/src/avisos/`) + el endpoint `GET
 * /avisos/publicados` (Día 47). Mantener en sync a mano, mismo criterio que
 * `lib/api/carreras.ts` / `lib/api/grupos.ts`. `sedeId` NUNCA es parámetro
 * (el backend lo saca del JWT, regla 2). Compartido por los 3 árboles
 * (`app/{admin,maestro,alumno}/avisos/`) — `lib/api/` es infraestructura,
 * la regla 11 aplica a `app/` y `components/`, no acá.
 */

export type AlcanceTipoAviso = 'SEDE' | 'CARRERA' | 'GRUPO';

export interface CrearAvisoInput {
  titulo: string;
  cuerpo: string;
  alcanceTipo: AlcanceTipoAviso;
  /** Requerido si alcanceTipo es CARRERA o GRUPO; ausente si SEDE. */
  alcanceId?: string;
}

/** Lo que devuelve `POST /avisos` (fila plana del `Aviso`). */
export interface Aviso {
  id: string;
  sedeId: string;
  autorUsuarioId: string;
  titulo: string;
  cuerpo: string;
  alcanceTipo: AlcanceTipoAviso;
  alcanceId: string | null;
  createdAt: string;
}

/** Item de `GET /avisos/publicados` — la tabla de gestión del autor. */
export interface AvisoPublicadoItem {
  id: string;
  titulo: string;
  cuerpo: string;
  alcanceTipo: AlcanceTipoAviso;
  alcanceId: string | null;
  alcanceNombre: string | null;
  createdAt: string;
  totalDestinatarios: number;
  leidos: number;
}

/** Item de `GET /avisos` (feed de recibidos) y de `GET /avisos/:id`. */
export interface AvisoFeedItem {
  id: string;
  titulo: string;
  cuerpo: string;
  autor: { nombres: string; apellidoPaterno: string };
  createdAt: string;
  leidoEn: string | null;
}

export interface DestinatarioRecibo {
  usuarioId: string;
  nombreCompleto: string;
  rol: 'ALUMNO' | 'MAESTRO' | 'ADMINISTRATIVO';
  leidoEn: string | null;
}

export interface RecibosAviso {
  total: number;
  leidos: number;
  noLeidos: number;
  destinatarios: DestinatarioRecibo[];
}

export function publicarAviso(input: CrearAvisoInput): Promise<Aviso> {
  return apiFetchAuth<Aviso>('/avisos', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listarAvisosPublicados(params?: {
  page?: number;
  limit?: number;
}): Promise<ApiListaPaginada<AvisoPublicadoItem>> {
  const sp = new URLSearchParams();
  if (params?.page) sp.set('page', String(params.page));
  if (params?.limit) sp.set('limit', String(params.limit));
  const qs = sp.toString();
  return apiFetchAuthPaginado<AvisoPublicadoItem>(
    `/avisos/publicados${qs ? `?${qs}` : ''}`,
  );
}

export function obtenerFeedAvisos(params?: {
  page?: number;
  limit?: number;
}): Promise<ApiListaPaginada<AvisoFeedItem>> {
  const sp = new URLSearchParams();
  if (params?.page) sp.set('page', String(params.page));
  if (params?.limit) sp.set('limit', String(params.limit));
  const qs = sp.toString();
  return apiFetchAuthPaginado<AvisoFeedItem>(`/avisos${qs ? `?${qs}` : ''}`);
}

/** Dispara el efecto de backend: marca la `Notificacion` del actor como leída. */
export function obtenerDetalleAviso(id: string): Promise<AvisoFeedItem> {
  return apiFetchAuth<AvisoFeedItem>(`/avisos/${id}`);
}

export function obtenerRecibosAviso(id: string): Promise<RecibosAviso> {
  return apiFetchAuth<RecibosAviso>(`/avisos/${id}/recibos`);
}

export function eliminarAviso(id: string): Promise<{ ok: true }> {
  return apiFetchAuth<{ ok: true }>(`/avisos/${id}`, { method: 'DELETE' });
}
```

- [ ] **Step 2: Verificar tipos**

Run: `cd App/frontend && npx tsc --noEmit`
Expected: PASS — sin errores (el archivo compila; aún no tiene consumidores).

- [ ] **Step 3: Commit**

```bash
git add App/frontend/src/lib/api/avisos.ts
git commit -m "feat(frontend): API client de avisos (lib/api/avisos.ts)"
```

---

## Task 3: Admin — `app/admin/avisos/` (publicar + recibir)

**Files:**
- Create: `App/frontend/src/app/admin/avisos/page.tsx` — pantalla con 2 tabs (Publicados / Recibidos)
- Create: `App/frontend/src/app/admin/avisos/NuevoAvisoModal.tsx`
- Create: `App/frontend/src/app/admin/avisos/RecibosModal.tsx`
- Create: `App/frontend/src/app/admin/avisos/DetalleAvisoModal.tsx`
- Create: `App/frontend/src/app/admin/avisos/ConfirmarEliminarAvisoModal.tsx`
- Modify: `App/frontend/src/components/admin/ui/shell/icons.tsx` — añadir `IconAvisos` (SVG megáfono)
- Modify: `App/frontend/src/components/admin/ui/shell/Sidebar.tsx` — nuevo item de nav
- (Sin test automatizado — el árbol admin no tiene tests de componente; verificación = `pnpm build` + `pnpm lint` + QA en Task 6.)

**Interfaces:**
- Consumes: todo `lib/api/avisos.ts` (Task 2); `listarCarreras` de `lib/api/carreras.ts`; `listarGrupos` de `lib/api/grupos.ts`; `resolverMensajeError` / `MENSAJE_ERROR_GENERICO` de `components/admin/ui/persona-alta/mensajes-error`; `SkeletonTableRows` de `components/admin/ui/Skeleton`; `ApiError` de `lib/api/http`; `toast` de `sonner`.
- Produces: la ruta `/admin/avisos`. Nada que otra task consuma en código.

- [ ] **Step 1: Añadir `IconAvisos` a `icons.tsx`**

En `App/frontend/src/components/admin/ui/shell/icons.tsx`, junto a los demás iconos, añadir un megáfono (distinto de la campana de `NotificacionesBell`):

```tsx
/** Megáfono — ítem "Avisos" del sidebar (Fase 16, Día 47). */
export function IconAvisos({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1Z" />
      <path d="M10 14v3a2 2 0 0 0 4 0v-1" />
      <path d="M16 8a4 4 0 0 1 0 8" />
      <path d="M19 5a8 8 0 0 1 0 14" />
    </svg>
  );
}
```

(Usar la misma firma `IconProps` y estilo que el resto del archivo — copiar la estructura de `IconEmergencia` si el shape difiere.)

- [ ] **Step 2: Añadir el item de nav al Sidebar**

En `App/frontend/src/components/admin/ui/shell/Sidebar.tsx`:
1. Añadir `IconAvisos` al `import { ... } from './icons'` (orden alfabético).
2. En `NAV_PRINCIPAL`, insertar **después** del item `Calendario` y **antes** de `Administrativos`:

```ts
  { href: '/admin/avisos', label: 'Avisos', Icon: IconAvisos, match: 'prefijo' },
```

- [ ] **Step 3: `ConfirmarEliminarAvisoModal.tsx`**

Copia estructural de `app/admin/calendario/ConfirmarEliminarEventoModal.tsx` (mismas clases, mismo overlay `fixed inset-0 z-50 flex items-center justify-center bg-slate/40 p-4`). Props:

```ts
interface ConfirmarEliminarAvisoModalProps {
  titulo: string;
  onConfirmar: () => void;
  onCancelar: () => void;
  eliminando: boolean;
}
```

Texto: "¿Seguro que quieres eliminar el aviso **{titulo}**? Se borrará para todos los destinatarios y no se puede deshacer." Botón rojo "Eliminar" / "Eliminando…", botón "Cancelar". Ambos `disabled={eliminando}`.

- [ ] **Step 4: `DetalleAvisoModal.tsx`**

```ts
interface DetalleAvisoModalProps {
  avisoId: string;
  onCerrar: () => void;
}
```

- Overlay igual que los otros modales del árbol (`fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate/40 p-4 pt-16`), panel `w-full max-w-lg rounded-lg bg-white p-6 shadow-lg`.
- `useQuery({ queryKey: ['admin', 'avisos', 'detalle', avisoId], queryFn: async () => { try { return await obtenerDetalleAviso(avisoId); } catch (err) { console.error('[DetalleAvisoModal]', err); throw err; } } })`.
- Cerrar con Escape (`useEffect` + `window` keydown, mismo patrón que otros modales) y con click en backdrop.
- Contenido: `titulo` (h2), meta line "Por {autor.nombres} {autor.apellidoPaterno} · {fecha formateada}", `cuerpo` en un `<p className="whitespace-pre-wrap ...">`.
- Estados: loading ("Cargando…"), error (`ApiError` → `.message`, si no genérico).

- [ ] **Step 5: `RecibosModal.tsx`**

```ts
interface RecibosModalProps {
  avisoId: string;
  tituloAviso: string;
  onCerrar: () => void;
}
```

- Overlay + panel `max-w-lg`. Escape + backdrop cierran.
- `useQuery({ queryKey: ['admin', 'avisos', 'recibos', avisoId], queryFn: ... con try/catch/console.error })` → `obtenerRecibosAviso`.
- Encabezado: `{tituloAviso}` + línea grande **`{data.leidos} / {data.total} leyeron`** (y `{data.noLeidos} sin leer` en texto secundario).
- Lista de `data.destinatarios` (ya viene ordenada): por fila `nombreCompleto`, badge de `rol` (reutilizar clases de badge de `app/admin/emergencia` — chip `rounded-full bg-mist/60 px-2 py-0.5 text-xs`), y estado a la derecha: `leidoEn ? "Leído " + fecha : "Sin leer"` (usar `text-slate/50` para "Sin leer").
- Loading / error estándar.

- [ ] **Step 6: `NuevoAvisoModal.tsx`**

```ts
interface NuevoAvisoModalProps {
  onCerrar: () => void;
  onPublicado: () => void; // el padre invalida la query de publicados + cierra
}
```

- Overlay + panel `max-w-lg`. Escape + backdrop + botón "✕" cierran (llamando `onCerrar`).
- Estado local: `titulo`, `cuerpo`, `alcanceTipo` (`AlcanceTipoAviso`, default `'SEDE'`), `alcanceId` (`string`, default `''`).
- Campos:
  - `titulo`: `<input maxLength={160}>`.
  - `cuerpo`: `<textarea maxLength={5000} rows={5}>`.
  - `alcanceTipo`: `<select>` con `SEDE` ("Toda la sede") / `CARRERA` ("Una carrera") / `GRUPO` ("Un grupo"). Al cambiar, resetear `alcanceId` a `''`.
  - Si `alcanceTipo === 'CARRERA'`: `<select>` de carreras. `useQuery({ queryKey: ['admin','carreras'], queryFn: listarCarreras })` (misma key que `app/admin/carreras/` — caché compartida). Opciones `carrera.id` → `carrera.nombre`. Primera opción deshabilitada "Selecciona una carrera".
  - Si `alcanceTipo === 'GRUPO'`: `<select>` de grupos. `useQuery({ queryKey: ['admin','avisos','grupos-opciones'], queryFn: () => listarGrupos({ limit: 100 }) })`, mapear `result.data` → `{grupo.id}` / `"{grupo.nombre} · {grupo.carrera.nombre}"`. Nota: si hay >100 grupos el `<select>` no los trae todos — aceptable para v1 (mismo criterio que el dropdown de grupos en `app/admin/grupos/`); documentarlo con un comentario.
- Validación cliente mínima antes de mutar: `titulo.trim()` y `cuerpo.trim()` no vacíos; si `alcanceTipo !== 'SEDE'`, `alcanceId` no vacío. Si falla, `toast.error('Completa los campos requeridos')` y no mutar.
- `useMutation({ mutationFn: () => publicarAviso({ titulo: titulo.trim(), cuerpo: cuerpo.trim(), alcanceTipo, alcanceId: alcanceTipo === 'SEDE' ? undefined : alcanceId }), onSuccess: () => { toast.success('Aviso publicado'); onPublicado(); }, onError: (err) => { console.error('[NuevoAvisoModal] publicar:', err); toast.error(resolverMensajeError(err) ?? MENSAJE_ERROR_GENERICO); } })`.
- Botones: "Cancelar" (→ `onCerrar`) y "Publicar" / "Publicando…" (`disabled={mutation.isPending}`).
- Los campos NO necesitan limpieza explícita: el modal se desmonta al cerrar (el padre lo renderiza condicionalmente), así que el estado local se recrea vacío en la siguiente apertura (cumple regla 13).

- [ ] **Step 7: `page.tsx`**

```tsx
'use client';
```

- Estado: `const [tab, setTab] = useState<'publicados' | 'recibidos'>('publicados');`, `const [pagePub, setPagePub] = useState(1);`, `const [pageRec, setPageRec] = useState(1);`, `const [modalNuevo, setModalNuevo] = useState(false);`, `const [recibosDe, setRecibosDe] = useState<AvisoPublicadoItem | null>(null);`, `const [avisoAEliminar, setAvisoAEliminar] = useState<AvisoPublicadoItem | null>(null);`, `const [detalleId, setDetalleId] = useState<string | null>(null);`.
- `const queryClient = useQueryClient();`
- Encabezado de página: card `rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm` con `<h1>` "Avisos" + descripción corta.
- Barra de tabs: 2 botones ("Publicados" / "Recibidos"), el activo con `border-b-2 border-navy text-navy`, el otro `text-slate/60`.
- **Tab Publicados:**
  - `const publicadosQuery = useQuery({ queryKey: ['admin','avisos','publicados', pagePub], queryFn: async () => { try { return await listarAvisosPublicados({ page: pagePub, limit: 20 }); } catch (err) { console.error('[AdminAvisos] publicados:', err); throw err; } } });`
  - Botón "+ Nuevo aviso" (`bg-navy ...`) → `setModalNuevo(true)`.
  - Tabla (`overflow-x-auto rounded-lg border-l-4 border-navy bg-white shadow-sm`): columnas **Título · Alcance · Fecha · Leídos · (acciones)**.
    - Alcance: `{prefijoAlcance(row.alcanceTipo)}{row.alcanceNombre ?? '—'}` donde `prefijoAlcance` = `SEDE → ''`, `CARRERA → 'Carrera: '`, `GRUPO → 'Grupo: '`.
    - Leídos: `{row.leidos} / {row.totalDestinatarios}`.
    - Acciones: botón "Ver recibos" (`text-navy hover:underline`) → `setRecibosDe(row)`; botón "Eliminar" (`text-crimson hover:underline ml-4`) → `setAvisoAEliminar(row)`.
  - Estados: `isLoading` → `<SkeletonTableRows columns={5} />`; `isError` → fila con `colSpan={5}` y el mensaje (`ApiError` → `.message`); `data.data.length === 0` → fila "Todavía no has publicado avisos.".
  - Paginación: reusar el patrón de `app/admin/grupos/page.tsx` (botones Anterior/Siguiente + "Página X de Y" calculado con `Math.ceil(total/limit)`).
- **Tab Recibidos:**
  - `const recibidosQuery = useQuery({ queryKey: ['admin','avisos','feed', pageRec], queryFn: async () => { try { return await obtenerFeedAvisos({ page: pageRec, limit: 20 }); } catch (err) { console.error('[AdminAvisos] feed:', err); throw err; } } });`
  - Tabla: **Título · Autor · Fecha** + un punto/badge de no-leído cuando `row.leidoEn === null` (ej. `<span className="ml-2 inline-block size-2 rounded-full bg-navy" />`).
  - Fila clickeable (`<tr className="cursor-pointer hover:bg-mist/30" onClick={() => setDetalleId(row.id)}>`).
  - Mismos estados loading/error/vacío ("No has recibido avisos.") + paginación.
- **Modales (al final del JSX):**
  - `{modalNuevo && <NuevoAvisoModal onCerrar={() => setModalNuevo(false)} onPublicado={() => { setModalNuevo(false); void queryClient.invalidateQueries({ queryKey: ['admin','avisos','publicados'] }); }} />}`
  - `{recibosDe && <RecibosModal avisoId={recibosDe.id} tituloAviso={recibosDe.titulo} onCerrar={() => setRecibosDe(null)} />}`
  - `{avisoAEliminar && <ConfirmarEliminarAvisoModal titulo={avisoAEliminar.titulo} eliminando={eliminarMutation.isPending} onConfirmar={() => eliminarMutation.mutate(avisoAEliminar.id)} onCancelar={() => setAvisoAEliminar(null)} />}`
  - `{detalleId && <DetalleAvisoModal avisoId={detalleId} onCerrar={() => { setDetalleId(null); void queryClient.invalidateQueries({ queryKey: ['admin','avisos','feed'] }); }} />}`
- `const eliminarMutation = useMutation({ mutationFn: (id: string) => eliminarAviso(id), onSuccess: () => { toast.success('Aviso eliminado'); setAvisoAEliminar(null); void queryClient.invalidateQueries({ queryKey: ['admin','avisos','publicados'] }); }, onError: (err) => { console.error('[AdminAvisos] eliminar:', err); toast.error(resolverMensajeError(err) ?? MENSAJE_ERROR_GENERICO); setAvisoAEliminar(null); } });`

- [ ] **Step 8: Verificar build y lint**

Run: `cd App/frontend && npx tsc --noEmit && pnpm lint && pnpm build`
Expected: `tsc` sin errores; `pnpm lint` sin errores nuevos (los 2 warnings preexistentes en `app/admin/grupos/[id]/` no cuentan); `pnpm build` OK.

- [ ] **Step 9: Verificación manual rápida**

Con backend (`pnpm start:dev` en `App/backend`) y frontend (`pnpm dev`) corriendo, login como administrativo:
- `/admin/avisos` carga, tab Publicados por defecto.
- "+ Nuevo aviso" → publicar a "Toda la sede" → toast de éxito, aparece en la tabla con "Alcance = Toda la sede" y "Leídos = 0 / N".
- "Ver recibos" abre el modal con la lista.
- Tab Recibidos muestra el feed (vacío si nadie le ha publicado nada).
- "Eliminar" → confirmación → desaparece de la tabla.

- [ ] **Step 10: Commit**

```bash
git add App/frontend/src/app/admin/avisos/ App/frontend/src/components/admin/ui/shell/icons.tsx App/frontend/src/components/admin/ui/shell/Sidebar.tsx
git commit -m "feat(admin): UI de avisos (publicar, recibos, recibidos)"
```

---

## Task 4: Maestro — `app/maestro/avisos/`

**Files:**
- Create: `App/frontend/src/app/maestro/avisos/page.tsx` — 2 tabs (Publicados / Recibidos)
- Create: `App/frontend/src/app/maestro/avisos/NuevoAvisoModal.tsx` — solo alcance GRUPO, grupos desde `GET /perfil/asignaciones`
- Create: `App/frontend/src/app/maestro/avisos/RecibosModal.tsx`
- Create: `App/frontend/src/app/maestro/avisos/DetalleAvisoModal.tsx`
- Create: `App/frontend/src/app/maestro/avisos/ConfirmarEliminarAvisoModal.tsx`
- Modify: `App/frontend/src/components/maestro/ui/shell/Header.tsx` — link "Avisos" en `NavMaestro`

**Interfaces:**
- Consumes: `lib/api/avisos.ts` (Task 2); `obtenerMisAsignaciones` de `lib/api/perfil.ts` (devuelve `GrupoConMaterias[]` con `{ grupoId, nombre, carrera: { nombre } }`); helpers de error y skeleton del árbol maestro (`components/maestro/ui/...` — usar los que ya existan; si no hay `mensajes-error` en maestro, usar `ApiError` + un `MENSAJE_ERROR_GENERICO` local en el modal). `toast` de `sonner`.
- Produces: la ruta `/maestro/avisos`.

- [ ] **Step 1: Duplicar los 4 modales + page desde el árbol admin, adaptando**

Copiar `RecibosModal.tsx`, `DetalleAvisoModal.tsx`, `ConfirmarEliminarAvisoModal.tsx` de `app/admin/avisos/` a `app/maestro/avisos/` **sin cambios de lógica** (solo el comentario de cabecera: "local a `app/maestro/avisos/`, regla 11 — no se importa de `app/admin/`"). Cambiar los `queryKey` de `['admin', 'avisos', ...]` a `['maestro', 'avisos', ...]`.

`page.tsx`: copia de la de admin con estos cambios:
- Todos los `queryKey` `['admin','avisos',...]` → `['maestro','avisos',...]`.
- Encabezado "Avisos" con descripción para maestro ("Publica avisos a tus grupos y consulta los que recibes.").
- El resto idéntico (2 tabs, tabla de publicados con "Ver recibos"/"Eliminar", tab recibidos con detalle-modal, paginación).

- [ ] **Step 2: `NuevoAvisoModal.tsx` del maestro — solo GRUPO**

Igual que el de admin pero:
- Sin `<select>` de `alcanceTipo`. En su lugar, texto fijo: `<p className="text-sm text-slate/60">Alcance: un grupo donde impartes clase</p>`. `alcanceTipo: 'GRUPO'` va hardcodeado en el `publicarAviso({...})`.
- `<select>` de grupos alimentado por `useQuery({ queryKey: ['maestro','avisos','grupos-opciones'], queryFn: async () => { try { return await obtenerMisAsignaciones(); } catch (err) { console.error('[NuevoAvisoModal maestro] asignaciones:', err); throw err; } } })`. Opciones: `g.grupoId` → `"{g.nombre} · {g.carrera.nombre}"`.
- Si la query devuelve `[]`: el `<select>` muestra "No tienes grupos asignados" deshabilitado y el botón "Publicar" queda `disabled`.
- Validación cliente: `titulo`/`cuerpo` no vacíos + `alcanceId` (grupo) seleccionado.
- El padre (`page.tsx`): el botón "+ Nuevo aviso" puede quedar siempre habilitado (el modal maneja el caso "sin grupos" adentro); o —más simple— deshabilitarlo con `title` si `obtenerMisAsignaciones` (llamado también en la página con la misma key) devuelve `[]`. Elegir la primera opción (menos acoplamiento).

- [ ] **Step 3: Link "Avisos" en `NavMaestro`**

En `App/frontend/src/components/maestro/ui/shell/Header.tsx`, dentro de `NavMaestro`:
- Añadir `const enAvisos = pathname.startsWith('/maestro/avisos');`
- Ajustar el link "Mi perfil" para que su estado activo sea `!enCalendario && !enAvisos`.
- Añadir tras el link de Calendario:

```tsx
<Link
  href="/maestro/avisos"
  aria-current={enAvisos ? 'page' : undefined}
  className={enAvisos ? 'text-navy' : 'text-slate/60 hover:text-navy'}
>
  Avisos
</Link>
```

- [ ] **Step 4: Verificar build y lint**

Run: `cd App/frontend && npx tsc --noEmit && pnpm lint && pnpm build`
Expected: sin errores nuevos.

- [ ] **Step 5: Verificación manual rápida**

Login como maestro (uno con asignaciones):
- `/maestro/avisos` carga; link "Avisos" activo en el header.
- "+ Nuevo aviso" → el `<select>` de grupos solo lista los grupos donde imparte → publicar → aparece en Publicados.
- Tab Recibidos + detalle-modal funcionan.
- Con un maestro SIN asignaciones: el modal muestra "No tienes grupos asignados" y no deja publicar.

- [ ] **Step 6: Commit**

```bash
git add App/frontend/src/app/maestro/avisos/ App/frontend/src/components/maestro/ui/shell/Header.tsx
git commit -m "feat(maestro): UI de avisos (publicar a sus grupos + recibidos)"
```

---

## Task 5: Alumno — `app/alumno/avisos/`

**Files:**
- Create: `App/frontend/src/app/alumno/avisos/page.tsx` — solo feed de recibidos, paginado
- Create: `App/frontend/src/app/alumno/avisos/DetalleAvisoModal.tsx`
- Modify: `App/frontend/src/components/alumno/ui/shell/Header.tsx` — link "Avisos" en `NavAlumno`

**Interfaces:**
- Consumes: `obtenerFeedAvisos`, `AvisoFeedItem` de `lib/api/avisos.ts`; `obtenerDetalleAviso` (vía el modal); `ApiError` de `lib/api/http`; skeleton/estilos del árbol alumno (`components/alumno/ui/...`). `toast` de `sonner` (opcional, para error del detalle).
- Produces: la ruta `/alumno/avisos`.

- [ ] **Step 1: `DetalleAvisoModal.tsx`**

Copia del de admin (Task 3, Step 4) a `app/alumno/avisos/`, `queryKey` → `['alumno','avisos','detalle', avisoId]`. Comentario de cabecera: "local a `app/alumno/avisos/`, regla 11". Sin otros cambios.

- [ ] **Step 2: `page.tsx`**

```tsx
'use client';
```

- Estado: `const [page, setPage] = useState(1);`, `const [detalleId, setDetalleId] = useState<string | null>(null);`, `const queryClient = useQueryClient();`.
- `const feedQuery = useQuery({ queryKey: ['alumno','avisos','feed', page], queryFn: async () => { try { return await obtenerFeedAvisos({ page, limit: 20 }); } catch (err) { console.error('[AlumnoAvisos] feed:', err); throw err; } } });`
- Encabezado: card con `<h1>` "Avisos".
- Lista (tabla o lista de cards, seguir el estilo de `app/alumno/calendario/page.tsx`): por item `titulo`, `Por {autor.nombres} {autor.apellidoPaterno}`, fecha, y punto de no-leído si `leidoEn === null`. Item clickeable → `setDetalleId(item.id)`.
- Estados: loading (skeleton del árbol alumno), error (`ApiError` → `.message`), vacío ("No tienes avisos.").
- Paginación: Anterior/Siguiente + "Página X de Y" (`Math.ceil(total/limit)`).
- `{detalleId && <DetalleAvisoModal avisoId={detalleId} onCerrar={() => { setDetalleId(null); void queryClient.invalidateQueries({ queryKey: ['alumno','avisos','feed'] }); }} />}`

- [ ] **Step 3: Link "Avisos" en `NavAlumno`**

En `App/frontend/src/components/alumno/ui/shell/Header.tsx`, dentro de `NavAlumno`:
- `const enAvisos = pathname.startsWith('/alumno/avisos');`
- "Mi perfil" activo cuando `!enCalendario && !enAvisos`.
- Añadir tras el link de Calendario:

```tsx
<Link
  href="/alumno/avisos"
  aria-current={enAvisos ? 'page' : undefined}
  className={enAvisos ? 'text-navy' : 'text-slate/60 hover:text-navy'}
>
  Avisos
</Link>
```

- [ ] **Step 4: Verificar build y lint**

Run: `cd App/frontend && npx tsc --noEmit && pnpm lint && pnpm build`
Expected: sin errores nuevos.

- [ ] **Step 5: Verificación manual rápida**

Login como alumno:
- `/alumno/avisos` carga; link "Avisos" en el header.
- Si un admin publicó a la sede/carrera/grupo del alumno → aparece en el feed con punto de no-leído.
- Click en un aviso → modal con el contenido; al cerrar, el punto de no-leído desaparece (la query se invalidó y `leidoEn` ya no es null).

- [ ] **Step 6: Commit**

```bash
git add App/frontend/src/app/alumno/avisos/ App/frontend/src/components/alumno/ui/shell/Header.tsx
git commit -m "feat(alumno): feed de avisos recibidos"
```

---

## Task 6: Cierre de fase — QA + documentación

**Files:**
- Modify: `documentacion_de_agentes/ESTADO.md` — marcar Días 47-48 / Fase 16 en los dominios admin y alumno
- Modify: `docs/roadmap.md` — tachar Fase 16 (Días 47-48) + mover el puntero de fase
- Modify: `CLAUDE.md` (raíz) — actualizar la línea "Fase actual" (Fase 16 completa) + añadir `GET /avisos/publicados` a la sección "Contrato de API"

**Interfaces:**
- Consumes: nada de código.
- Produces: estado documental consistente.

- [ ] **Step 1: Documentar `GET /avisos/publicados` en el contrato de API**

En `CLAUDE.md` raíz, en el bloque de bullets de `POST/GET /avisos ...`, añadir un sub-bullet:

```
  - `GET /avisos/publicados?page=&limit=` (Fase 16, Día 47) — `@Roles(ADMINISTRATIVO,
    MAESTRO)`, declarado antes de `GET /avisos/:id`. Los avisos que el actor publicó en
    su sede (`where: { sedeId de @SedeActual(), autorUsuarioId de @ActorUsuarioId() }`),
    paginado, orden `createdAt desc`. `200 { data: AvisoPublicadoItem[], page, limit,
    total }` con `AvisoPublicadoItem = { id, titulo, cuerpo, alcanceTipo, alcanceId,
    alcanceNombre, createdAt, totalDestinatarios, leidos }` — `alcanceNombre`
    (`'Toda la sede'` | nombre de carrera | nombre de grupo | `null` si el alcanceId
    ya no existe), `totalDestinatarios`/`leidos` derivados de las `Notificacion`
    `tipo: AVISO` del aviso (regla 1, batch, sin N+1). ALUMNO → `403 ROL_NO_AUTORIZADO`.
    Sin códigos de error nuevos.
```

- [ ] **Step 2: Actualizar `ESTADO.md`**

En `documentacion_de_agentes/ESTADO.md`, en las secciones de dominio admin y alumno/maestro, marcar como Hecho: "Fase 16 Días 47-48 — UI de avisos (publicación admin/maestro con ruta propia + 2 tabs; recepción alumno/maestro/admin vía modal de detalle; `GET /avisos/publicados` nuevo). Build + lint limpios, e2e `avisos` en verde." Seguir el formato de checklist ya usado en ese archivo.

- [ ] **Step 3: Actualizar `docs/roadmap.md`**

Marcar `- [x]` los ítems de Día 47 y Día 48 de la `FASE 16`. En el encabezado de la fase, cambiar "UI (47-48) pendiente" por "COMPLETA (2026-09-08)". Mover el puntero de "fase en curso" a la Fase 13 (el orden efectivo tras esta fase es 13 → 17, según el `CLAUDE.md` raíz) — **sin retomar la Fase 13**, solo dejar el puntero.

- [ ] **Step 4: Actualizar la línea "Fase actual" del `CLAUDE.md` raíz**

Añadir al bloque de "Fase actual" que la Fase 16 quedó COMPLETA en código (Días 45-48): backend Días 45-46 + UI Días 47-48 (rutas propias `app/{admin,maestro,alumno}/avisos/`, `GET /avisos/publicados` nuevo, verificación manual pendiente del usuario). Mantener el estilo denso del resto de esa sección.

- [ ] **Step 5: Commit de documentación**

```bash
git add CLAUDE.md docs/roadmap.md documentacion_de_agentes/ESTADO.md
git commit -m "docs: cerrar Fase 16 (UI de avisos, Dias 47-48)"
```

- [ ] **Step 6: QA de dominio (dispatch)**

Lanzar en paralelo:
- `qa-admin` — audita `app/admin/avisos/` + `GET /avisos/publicados` (consumo) contra las reglas del `CLAUDE.md` raíz (regla 11 sin imports cruzados, regla 12 logging, regla 13 tabla+modal, contrato de API).
- `qa-alumno` — audita `app/maestro/avisos/` + `app/alumno/avisos/` (cubre ambos árboles).
- `qa-backend` — audita `GET /avisos/publicados` (regla 2 `sedeId`/`autorUsuarioId` del JWT, regla 1 derivados, regla 12, aislamiento cross-sede, orden de rutas).

Cada QA consigna su veredicto en `ESTADO.md`. Si hay hallazgos bloqueantes → nueva ronda de fix por el coder de dominio; si no → Fase 16 cerrada.

---

## Self-Review

**1. Spec coverage:**
- `GET /avisos/publicados` (spec Cambio 1) → Task 1. ✓ (endpoint, guards, shape, batch resolvers, 6 e2e — todos cubiertos).
- `lib/api/avisos.ts` (spec Cambio 2) → Task 2. ✓ (las 6 funciones + tipos).
- `app/admin/avisos/` con 2 tabs + 4 modales + Sidebar + IconAvisos (spec Cambio 3) → Task 3. ✓
- `app/maestro/avisos/` duplicado, solo GRUPO, grupos de `/perfil/asignaciones`, link NavMaestro (spec Cambio 4) → Task 4. ✓
- `app/alumno/avisos/` solo feed + DetalleAvisoModal + link NavAlumno (spec Cambio 5) → Task 5. ✓
- Fuera de alcance (deep-link, sub-rutas, edición) — no aparece ninguna task que lo implemente. ✓
- Cierre: QA qa-admin + qa-alumno + qa-backend, ESTADO.md, roadmap.md, CLAUDE.md (spec "Cierre de fase") → Task 6. ✓ (se añadió qa-backend por el endpoint nuevo, coherente con el spec que pide auditar el backend).

**2. Placeholder scan:** sin "TBD"/"TODO"/"add error handling" genéricos. Cada step de backend tiene código completo; los steps de React tienen prop-interfaces, query keys exactas, firmas de mutación y estructura de JSX descrita — el nivel de detalle que este repo usa para tasks de UI (los `page.tsx` de admin son de ~300 líneas, no se transcriben línea a línea, pero no queda ninguna decisión abierta).

**3. Type consistency:**
- `AvisoPublicadoItem` idéntico en Task 1 (backend, `createdAt: Date`) y Task 2 (frontend, `createdAt: string` — correcto, el JSON serializa Date→string; el resto de campos coinciden nombre por nombre).
- `AvisoFeedItem` (frontend) = `FeedItem` (backend) campo por campo: `id, titulo, cuerpo, autor: { nombres, apellidoPaterno }, createdAt, leidoEn`. ✓
- `RecibosAviso` / `DestinatarioRecibo` (frontend) = shape de `obtenerRecibos` (backend): `{ total, leidos, noLeidos, destinatarios: { usuarioId, nombreCompleto, rol, leidoEn }[] }`. ✓
- `publicarAviso` recibe `CrearAvisoInput` = `CrearAvisoDto` del backend (`titulo, cuerpo, alcanceTipo, alcanceId?`). ✓
- Query keys: `['<arbol>','avisos','publicados'|'feed'|'detalle'|'recibos', ...]` — consistentes entre `page.tsx` y cada modal dentro de cada árbol; distintos por árbol (regla 11). Invalidaciones en `page.tsx` usan el prefijo sin la página (`['admin','avisos','publicados']`) que React Query matchea contra `[...'publicados', pagePub]`. ✓
- `obtenerMisAsignaciones` (no `obtenerAsignaciones`) — nombre real verificado en `lib/api/perfil.ts:334`. ✓
- `listarGrupos({ limit: 100 })` devuelve `ApiListaPaginada<GrupoListItem>` → usar `.data` y `.data[i].carrera.nombre`. ✓
- `IconProps` — nombre del tipo de props de iconos; Task 3 Step 1 dice "copiar la estructura de `IconEmergencia` si el shape difiere" como salvaguarda. ✓

No se encontraron inconsistencias sin resolver.

---

## Execution Handoff

Ver la nota de arriba: ejecutar con **superpowers:subagent-driven-development** (un subagente por task + review de dominio entre tasks), que es el flujo estándar de este proyecto.
