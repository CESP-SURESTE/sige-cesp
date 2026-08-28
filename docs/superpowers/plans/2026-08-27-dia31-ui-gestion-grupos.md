# Día 31 — UI de gestión de grupos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un `ADMINISTRATIVO` gestione la matrícula de un grupo desde la UI: ver los alumnos inscritos, agregar por búsqueda (autocomplete), y quitar con confirmación.

**Architecture:** Ruta nueva `app/admin/grupos/[id]/page.tsx` (primera ruta dinámica del proyecto). Consume `GET /grupos/:id` (adición de backend), `GET /grupos/:id/alumnos`, `POST`/`DELETE /grupos/:id/alumnos` (Día 30). El autocomplete se apoya en `@headlessui/react` `Combobox` (sin dep nueva) + `GET /personas?rol=ALUMNO&buscar=` con filtrado en cliente por carrera y no-ya-matriculado.

**Tech Stack:** NestJS + Prisma 6.x (backend). Next.js 16 App Router + React 19 + React Query + `@headlessui/react` v2 + Tailwind v4 (frontend). `pnpm test:e2e` / `pnpm test` (backend); `pnpm tsc --noEmit` / `pnpm build` (frontend).

## Global Constraints

- Backend: `GET /grupos/:id` con los mismos guards que el resto de `GruposController` (`SedeGuard`+`RolesGuard`, `@Roles(ADMINISTRATIVO)` por método). `sedeId` de `@SedeActual()`. `404 NOT_FOUND` si no es de la sede. Respuesta `200 { data: GrupoListItem }` — **mismo shape que `GET /grupos`**, sin tipo nuevo. `console.error` antes de re-lanzar en el catch (regla 12).
- NO se toca el helper privado `obtenerGrupoEnSede` (lo usan `matricular`/`desmatricular`/`listarAlumnos` y sólo necesitan `carreraId`/`capacidad`) — el nuevo `obtenerPorId` hace su propio `findFirst` con `select` expandido.
- NO hay `PATCH /grupos/:id` y no se agrega (sin edición de grupo).
- Frontend: separación admin/alumno (regla 11) — todo bajo `app/admin/` / `components/admin/`. El modal de confirmación es local a `app/admin/grupos/[id]/`, sin import cruzado.
- Todo `catch`/`onError` loguea con `console.error` antes de responder/toast (regla 12).
- El autocomplete filtra en cliente SOLO por `carrera.id === grupo.carreraId` y `!yaMatriculado`. NO por `activo` ni `estatusAcademico` (coherente con el backend del Día 30).
- Cuando `matriculados.length >= grupo.capacidad`: el Combobox se renderiza `disabled` con aviso "Grupo lleno". El `409 CAPACIDAD_EXCEDIDA` es la red del backend.
- `params` en el client component: usar `useParams()` de `next/navigation`. El implementador DEBE revisar `App/frontend/node_modules/next/dist/docs/01-app` (rutas dinámicas + `useParams`) antes de escribir — `App/frontend/AGENTS.md` advierte que esta versión de Next difiere de lo conocido.
- Sin dependencias nuevas. `@headlessui/react` ya está instalado (lo usa `Select`).
- Sin paginación en la tabla de matriculados (≤ capacidad).
- Prisma 6.x — no subir a Prisma 7.

---

### Task 1: Backend — `GET /grupos/:id`

**Files:**
- Modify: `App/backend/src/grupos/grupos.controller.ts` (1 handler nuevo)
- Modify: `App/backend/src/grupos/grupos.service.ts` (método `obtenerPorId`)
- Modify: `App/backend/test/grupos.e2e-spec.ts` (2 casos)

**Interfaces:**
- Consumes: `PrismaService`, decoradores/guards ya usados en el archivo.
- Produces:
  ```ts
  // grupos.service.ts
  class GruposService {
    obtenerPorId(id: string, sedeId: string): Promise<GrupoListItem>;
  }
  ```
  Ruta: `GET /grupos/:id` → `200 { data: GrupoListItem }` | `404 { error, code: 'NOT_FOUND' }`.

- [ ] **Step 1: Escribir los 2 casos e2e que fallan**

En `App/backend/test/grupos.e2e-spec.ts`, dentro del `describe` existente, agregar (usando los fixtures/helpers ya presentes: `firmarToken`, `sedeMeridaId`, `sedeValladolidId`, `carreraMeridaId`, `salonMeridaId`, `carreraValladolidId`, `salonValladolidId`, `actorUsuarioId`, y el patrón de `prisma.grupo.create` que ya usan otros casos):

```ts
it('GET /grupos/:id devuelve el grupo con carrera y salon expandidos', async () => {
  const grupo = await prisma.grupo.create({
    data: {
      sedeId: sedeMeridaId,
      carreraId: carreraMeridaId,
      salonId: salonMeridaId,
      nombre: `Grupo E2E GET ${Date.now()}`,
      anioInicio: 2027,
      cicloActual: 2,
      capacidad: 25,
    },
  });

  const token = await firmarToken({
    role: 'authenticated',
    rol: RolUsuario.ADMINISTRATIVO,
    sede_id: sedeMeridaId,
  });

  const res = await request(app.getHttpServer())
    .get(`/grupos/${grupo.id}`)
    .set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(200);
  const body = res.body as {
    data: {
      id: string;
      nombre: string;
      anioInicio: number;
      cicloActual: number;
      capacidad: number;
      carrera: { id: string; nombre: string };
      salon: { id: string; nombre: string };
    };
  };
  expect(body.data.id).toBe(grupo.id);
  expect(body.data.capacidad).toBe(25);
  expect(body.data.carrera.id).toBe(carreraMeridaId);
  expect(typeof body.data.carrera.nombre).toBe('string');
  expect(body.data.salon.id).toBe(salonMeridaId);
  expect(typeof body.data.salon.nombre).toBe('string');

  await prisma.grupo.delete({ where: { id: grupo.id } });
});

it('GET /grupos/:id de un grupo de otra sede -> 404 NOT_FOUND', async () => {
  const grupoVlld = await prisma.grupo.create({
    data: {
      sedeId: sedeValladolidId,
      carreraId: carreraValladolidId,
      salonId: salonValladolidId,
      nombre: `Grupo E2E GET ajeno ${Date.now()}`,
      anioInicio: 2027,
      cicloActual: 1,
      capacidad: 20,
    },
  });

  const token = await firmarToken({
    role: 'authenticated',
    rol: RolUsuario.ADMINISTRATIVO,
    sede_id: sedeMeridaId,
  });

  const res = await request(app.getHttpServer())
    .get(`/grupos/${grupoVlld.id}`)
    .set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(404);
  expect((res.body as { code: string }).code).toBe('NOT_FOUND');

  await prisma.grupo.delete({ where: { id: grupoVlld.id } });
});
```

> Si el `afterAll` del archivo borra grupos por `nombre: { startsWith: 'Grupo E2E' }`, estos fixtures caen ahí también; el `prisma.grupo.delete` explícito al final de cada caso es defensa extra, no rompe nada si el patrón ya los cubre.

- [ ] **Step 2: Correr y verificar RED**

Run: `cd App/backend && pnpm test:e2e -- grupos.e2e`
Expected: los 2 casos nuevos FALLAN — `GET /grupos/:id` hoy no existe, cae en el `@Get()` de listado o en un 404 de Nest sin el `{ code: 'NOT_FOUND' }` del contrato / el primero no trae `data.carrera`.

- [ ] **Step 3: Implementar `obtenerPorId` en el service**

En `App/backend/src/grupos/grupos.service.ts`, agregar a la clase `GruposService` (después de `listar`, antes de `eliminar`):

```ts
  /**
   * `GET /grupos/:id` — Fase 10, Día 31 (adición para la vista de detalle
   * de la UI). `id` debe existir Y pertenecer a la sede del actor -> 404
   * NOT_FOUND. Devuelve el mismo shape que un item de `GET /grupos`
   * (`carrera`/`salon` expandidos a `{ id, nombre }`) — no hay tipo nuevo.
   * NO reutiliza `obtenerGrupoEnSede` (ese helper devuelve el `Grupo` plano,
   * lo consumen `matricular`/`desmatricular`/`listarAlumnos`) — hace su
   * propio `findFirst` con el `select` expandido.
   */
  async obtenerPorId(id: string, sedeId: string): Promise<GrupoListItem> {
    try {
      const grupo = await this.prisma.grupo.findFirst({
        where: { id, sedeId },
        select: {
          id: true,
          nombre: true,
          anioInicio: true,
          cicloActual: true,
          capacidad: true,
          carrera: { select: { id: true, nombre: true } },
          salon: { select: { id: true, nombre: true } },
        },
      });
      if (!grupo) {
        throw new NotFoundException({
          error: 'Grupo no encontrado en tu sede',
          code: 'NOT_FOUND',
        });
      }
      return grupo;
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      console.error('[GruposService.obtenerPorId] error inesperado:', err);
      throw err;
    }
  }
```

- [ ] **Step 4: Implementar el handler en el controller**

En `App/backend/src/grupos/grupos.controller.ts`, agregar (después de `listar`, o en cualquier posición — `@Get(':id')` no colisiona con `@Get()` ni con `@Get(':id/alumnos')`):

```ts
  @Get(':id')
  @Roles(RolUsuario.ADMINISTRATIVO)
  async obtener(@Param('id') id: string, @SedeActual() sedeId: string) {
    const data = await this.gruposService.obtenerPorId(id, sedeId);
    return { data };
  }
```

> Ordenamiento: `@Get(':id/alumnos')` (3 segmentos con literal `alumnos`) y `@Get(':id')` (2 segmentos) no colisionan en Express/Nest. Declarar `@Get(':id/alumnos')` ANTES de `@Get(':id')` de todos modos, por claridad de lectura — si ya está después, moverlo antes en este mismo cambio.

- [ ] **Step 5: Correr los 2 casos + suite completa**

Run: `cd App/backend && pnpm test:e2e -- grupos.e2e` → 2 casos nuevos PASAN.
Run: `cd App/backend && pnpm test:e2e && pnpm test && pnpm build` → toda la suite e2e en verde (nada roto, en particular `grupos-alumnos.e2e-spec.ts`), unit en verde, build OK.

- [ ] **Step 6: Commit**

```bash
git add App/backend/src/grupos App/backend/test/grupos.e2e-spec.ts
git commit -m "feat(grupos): GET /grupos/:id para la vista de detalle"
```

---

### Task 2: Frontend — clientes de API + página de detalle (sin el autocomplete)

**Files:**
- Modify: `App/frontend/src/lib/api/grupos.ts` (4 funciones + 1 tipo)
- Create: `App/frontend/src/app/admin/grupos/[id]/page.tsx`
- Create: `App/frontend/src/app/admin/grupos/[id]/ConfirmarQuitarAlumnoModal.tsx`
- Modify: `App/frontend/src/app/admin/grupos/page.tsx` (link "Alumnos" por fila)

**Interfaces:**
- Consumes: `GET /grupos/:id` (Task 1), `GET /grupos/:id/alumnos` + `DELETE /grupos/:id/alumnos/:usuarioId` (Día 30). `apiFetchAuth<T>` (ya desenvuelve `data`), `GrupoListItem`/`Grupo` (ya en `grupos.ts`), `EstatusAcademico` (exportado por `lib/api/personas.ts`), `ApiError`, `resolverMensajeError`/`MENSAJE_ERROR_GENERICO` (`components/admin/ui/persona-alta/mensajes-error`).
- Produces (para la Task 3):
  ```ts
  // lib/api/grupos.ts
  export interface GrupoAlumnoListItem {
    usuarioId: string; nombres: string; apellidoPaterno: string;
    apellidoMaterno: string | null; matricula: string; semestreActual: number;
    estatusAcademico: EstatusAcademico; fechaInscripcion: string;
  }
  export function obtenerGrupo(id: string): Promise<GrupoListItem>;
  export function listarAlumnosDeGrupo(grupoId: string): Promise<GrupoAlumnoListItem[]>;
  export function matricularAlumno(grupoId: string, usuarioId: string): Promise<Grupo>;
  export function desmatricularAlumno(grupoId: string, usuarioId: string): Promise<{ ok: true }>;
  ```
  La página `app/admin/grupos/[id]/page.tsx` existe con: header (nombre/carrera/salón/periodo + badge `N / M`), tabla de matriculados con "Quitar" + `ConfirmarQuitarAlumnoModal` + `desmatricularMutation`, y un **placeholder comentado** donde la Task 3 monta el autocomplete.

- [ ] **Step 1: Clientes de API en `lib/api/grupos.ts`**

Agregar al import existente: `import type { EstatusAcademico } from './personas';`.

Agregar al final del archivo:

```ts
/**
 * Espejo de `GrupoAlumnoListItem` (`App/backend/src/grupos/grupos.service.ts`,
 * Fase 10 Día 30) — el shape que devuelve `GET /grupos/:id/alumnos`.
 * `estatusAcademico` reusa el tipo de `lib/api/personas.ts` (mismo enum del
 * schema, ya exportado — no se re-declara).
 */
export interface GrupoAlumnoListItem {
  usuarioId: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  matricula: string;
  semestreActual: number;
  estatusAcademico: EstatusAcademico;
  fechaInscripcion: string;
}

/** `GET /grupos/:id` — Fase 10, Día 31. Mismo shape que un item de `GET /grupos`. */
export function obtenerGrupo(id: string): Promise<GrupoListItem> {
  return apiFetchAuth<GrupoListItem>(`/grupos/${id}`);
}

/** `GET /grupos/:id/alumnos` — Fase 10, Día 30. Sin paginar. */
export function listarAlumnosDeGrupo(
  grupoId: string,
): Promise<GrupoAlumnoListItem[]> {
  return apiFetchAuth<GrupoAlumnoListItem[]>(`/grupos/${grupoId}/alumnos`);
}

/** `POST /grupos/:id/alumnos` — Fase 10, Día 30. */
export function matricularAlumno(
  grupoId: string,
  usuarioId: string,
): Promise<Grupo> {
  return apiFetchAuth<Grupo>(`/grupos/${grupoId}/alumnos`, {
    method: 'POST',
    body: JSON.stringify({ usuarioId }),
  });
}

/** `DELETE /grupos/:id/alumnos/:usuarioId` — Fase 10, Día 30. */
export function desmatricularAlumno(
  grupoId: string,
  usuarioId: string,
): Promise<{ ok: true }> {
  return apiFetchAuth<{ ok: true }>(`/grupos/${grupoId}/alumnos/${usuarioId}`, {
    method: 'DELETE',
  });
}
```

- [ ] **Step 2: `ConfirmarQuitarAlumnoModal.tsx`**

Crear `App/frontend/src/app/admin/grupos/[id]/ConfirmarQuitarAlumnoModal.tsx` — calco estructural de `App/frontend/src/app/admin/grupos/ConfirmarEliminarGrupoModal.tsx` (mismo overlay `fixed inset-0 z-50 ... bg-slate/40`, panel `max-w-md rounded-lg bg-white p-6 shadow-lg`, botón principal `bg-crimson`):

```tsx
'use client';

import type { GrupoAlumnoListItem } from '@/lib/api/grupos';

interface ConfirmarQuitarAlumnoModalProps {
  alumno: GrupoAlumnoListItem;
  grupoNombre: string;
  quitando: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}

/**
 * Modal de confirmación local a `app/admin/grupos/[id]/` — copia estructural
 * de `../ConfirmarEliminarGrupoModal.tsx`, adaptada a `GrupoAlumnoListItem`.
 * Sin import cruzado (regla 11, modal local por sección).
 */
export function ConfirmarQuitarAlumnoModal({
  alumno,
  grupoNombre,
  quitando,
  onConfirmar,
  onCancelar,
}: ConfirmarQuitarAlumnoModalProps) {
  const nombreCompleto = [
    alumno.apellidoPaterno,
    alumno.apellidoMaterno,
    alumno.nombres,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-slate">
          Quitar alumno del grupo
        </h2>
        <p className="mt-2 text-sm text-slate/80">
          ¿Quitar a <strong>{nombreCompleto}</strong> del grupo{' '}
          <strong>{grupoNombre}</strong>? Podrás volver a matricularlo después.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancelar}
            disabled={quitando}
            className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={quitando}
            className="rounded-lg bg-crimson px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-crimson/90 disabled:opacity-50"
          >
            {quitando ? 'Quitando…' : 'Quitar'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Leer la doc de Next para rutas dinámicas**

Antes de escribir la página: leer `App/frontend/node_modules/next/dist/docs/01-app` — buscar cómo se accede a los params de una ruta dinámica (`[id]`) DESDE UN CLIENT COMPONENT en esta versión de Next (16). Confirmar que `useParams()` de `next/navigation` es la vía correcta (debería serlo — es estable y client-safe). Si la doc dice otra cosa, seguir la doc y anotarlo en el reporte.

- [ ] **Step 4: `app/admin/grupos/[id]/page.tsx` (sin el autocomplete)**

Crear la página. `'use client'`. Estructura — seguir el patrón visual de `app/admin/grupos/page.tsx` (cards `rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm`, `useQuery`/`useMutation`, `toast`, `console.error` en cada `onError`/`queryFn` catch):

```tsx
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  MENSAJE_ERROR_GENERICO,
  resolverMensajeError,
} from '@/components/admin/ui/persona-alta/mensajes-error';
import { ApiError } from '@/lib/api/http';
import {
  desmatricularAlumno,
  listarAlumnosDeGrupo,
  obtenerGrupo,
  type GrupoAlumnoListItem,
} from '@/lib/api/grupos';
import type { EstatusAcademico } from '@/lib/api/personas';
import { ConfirmarQuitarAlumnoModal } from './ConfirmarQuitarAlumnoModal';

const ESTATUS_ACADEMICO_LABEL: Record<EstatusAcademico, string> = {
  INSCRITO: 'Inscrito',
  BAJA_TEMPORAL: 'Baja temporal',
  BAJA_DEFINITIVA: 'Baja definitiva',
  EGRESADO: 'Egresado',
};

function nombreAlumno(a: GrupoAlumnoListItem): string {
  return [a.apellidoPaterno, a.apellidoMaterno].filter(Boolean).join(' ') + `, ${a.nombres}`;
}

export default function AdminGrupoDetallePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();
  const [alumnoAQuitar, setAlumnoAQuitar] = useState<GrupoAlumnoListItem | null>(null);

  const grupoQuery = useQuery({
    queryKey: ['admin', 'grupos', 'detalle', id],
    queryFn: async () => {
      try {
        return await obtenerGrupo(id);
      } catch (err) {
        console.error('[AdminGrupoDetallePage] Error al obtener el grupo:', err);
        throw err;
      }
    },
  });

  const alumnosQuery = useQuery({
    queryKey: ['admin', 'grupos', 'detalle', id, 'alumnos'],
    queryFn: async () => {
      try {
        return await listarAlumnosDeGrupo(id);
      } catch (err) {
        console.error('[AdminGrupoDetallePage] Error al listar alumnos del grupo:', err);
        throw err;
      }
    },
  });

  const desmatricularMutation = useMutation({
    mutationFn: (usuarioId: string) => desmatricularAlumno(id, usuarioId),
    onSuccess: () => {
      toast.success('Alumno quitado del grupo');
      setAlumnoAQuitar(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'grupos', 'detalle', id] });
    },
    onError: (err) => {
      console.error('[AdminGrupoDetallePage] Error al quitar alumno:', err);
      toast.error(resolverMensajeError(err) ?? MENSAJE_ERROR_GENERICO);
      setAlumnoAQuitar(null);
    },
  });

  const grupo = grupoQuery.data;
  const alumnos = alumnosQuery.data ?? [];
  const inscritos = alumnos.length;
  const lleno = grupo ? inscritos >= grupo.capacidad : false;

  if (grupoQuery.isError) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border-l-4 border-crimson bg-white p-6 shadow-sm">
          <p className="text-sm text-crimson">
            {grupoQuery.error instanceof ApiError && grupoQuery.error.status === 404
              ? 'Grupo no encontrado en tu sede.'
              : 'No se pudo cargar el grupo. Intenta de nuevo más tarde.'}
          </p>
          <Link href="/admin/grupos" className="mt-3 inline-block text-sm text-navy hover:underline">
            ← Volver a grupos
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <Link href="/admin/grupos" className="text-sm text-navy hover:underline">
          ← Volver a grupos
        </Link>
        {grupoQuery.isLoading || !grupo ? (
          <p className="mt-2 text-sm text-slate/60">Cargando…</p>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <h1 className="font-display text-2xl font-semibold text-navy">{grupo.nombre}</h1>
              <span
                className={`rounded-full px-3 py-1 text-sm font-medium ${
                  lleno
                    ? 'border border-warning-border bg-warning-bg text-warning'
                    : 'border border-mist bg-bone text-slate'
                }`}
              >
                {inscritos} / {grupo.capacidad}
                {lleno ? ' · Lleno' : ''}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate/60">
              {grupo.carrera.nombre} · {grupo.salon.nombre} · {grupo.anioInicio} · Semestre{' '}
              {grupo.cicloActual}
            </p>
          </>
        )}
      </div>

      {/* PLACEHOLDER Task 3: aquí se monta el autocomplete de "Agregar alumno".
          Recibe: grupo (para carreraId + capacidad), alumnos (para el filtro de
          no-ya-matriculado), lleno (para deshabilitar), y una mutation de
          matricular que invalida ['admin','grupos','detalle',id] y
          ['admin','grupos','detalle',id,'alumnos']. */}

      {/* Tabla de matriculados */}
      <div className="rounded-lg border-l-4 border-navy bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-mist text-left text-slate/60">
                <th className="px-4 py-3 font-medium">Alumno</th>
                <th className="px-4 py-3 font-medium">Matrícula</th>
                <th className="px-4 py-3 font-medium">Semestre</th>
                <th className="px-4 py-3 font-medium">Estatus</th>
                <th className="px-4 py-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {alumnosQuery.isLoading && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate/60">Cargando…</td>
                </tr>
              )}
              {alumnosQuery.isError && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-crimson">
                    No se pudo cargar la lista de alumnos. Intenta de nuevo más tarde.
                  </td>
                </tr>
              )}
              {!alumnosQuery.isLoading && !alumnosQuery.isError && alumnos.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate/60">
                    Este grupo todavía no tiene alumnos matriculados.
                  </td>
                </tr>
              )}
              {alumnos.map((a) => (
                <tr key={a.usuarioId} className="border-b border-mist last:border-0">
                  <td className="px-4 py-3 text-slate">{nombreAlumno(a)}</td>
                  <td className="px-4 py-3 text-slate/80">{a.matricula}</td>
                  <td className="px-4 py-3 text-slate/80">{a.semestreActual}</td>
                  <td className="px-4 py-3 text-slate/80">
                    {ESTATUS_ACADEMICO_LABEL[a.estatusAcademico]}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setAlumnoAQuitar(a)}
                      className="text-crimson hover:underline"
                    >
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {alumnoAQuitar && grupo && (
        <ConfirmarQuitarAlumnoModal
          alumno={alumnoAQuitar}
          grupoNombre={grupo.nombre}
          quitando={desmatricularMutation.isPending}
          onConfirmar={() => desmatricularMutation.mutate(alumnoAQuitar.usuarioId)}
          onCancelar={() => setAlumnoAQuitar(null)}
        />
      )}
    </div>
  );
}
```

> `warning`/`warning-bg`/`warning-border` son tokens ya definidos en `globals.css` (los usa `EstatusEmpleadoBadge`).

- [ ] **Step 5: Link "Alumnos" en `app/admin/grupos/page.tsx`**

En la celda de "Acciones" de cada fila (hoy sólo tiene el botón "Eliminar"), agregar antes del botón:

```tsx
<Link
  href={`/admin/grupos/${grupo.id}`}
  className="mr-3 text-navy hover:underline"
>
  Alumnos
</Link>
```

`Link` ya está importado en ese archivo. No tocar nada más.

- [ ] **Step 6: Verificar**

Run: `cd App/frontend && pnpm tsc --noEmit` → limpio (en particular, `Record<EstatusAcademico, string>` obliga a cubrir los 4 valores).
Run: `cd App/frontend && pnpm build` → OK.

- [ ] **Step 7: Commit**

```bash
git add App/frontend/src/lib/api/grupos.ts App/frontend/src/app/admin/grupos
git commit -m "feat(admin): vista de detalle de grupo con lista de matriculados y quitar"
```

---

### Task 3: Frontend — autocomplete "Agregar alumno"

**Files:**
- Modify: `App/frontend/src/app/admin/grupos/[id]/page.tsx` (reemplazar el placeholder de la Task 2 por el bloque real)

**Interfaces:**
- Consumes: de la Task 2 — la página con `grupoQuery`/`alumnosQuery`/`queryClient`, `grupo`, `alumnos`, `lleno`, `id`. De la infra existente: `useBuscarDebounced` (`@/components/admin/ui/personas-listado/useBuscarDebounced`), `listarAlumnos` (`@/lib/api/personas`), `matricularAlumno` (`@/lib/api/grupos`), `@headlessui/react` `Combobox`.
- Produces: la pantalla completa del Día 31.

- [ ] **Step 1: Revisar la API de `Combobox` de `@headlessui/react` v2**

Leer `App/frontend/src/components/admin/ui/persona-alta/Select.tsx` (usa `Listbox`/`ListboxButton`/`ListboxOptions`/`ListboxOption` — la notación de componentes sueltos, NO la de punto `Listbox.Button`). El `Combobox` de la misma versión sigue el mismo estilo: `Combobox`, `ComboboxInput`, `ComboboxOptions`, `ComboboxOption` (comprobar en `App/frontend/node_modules/@headlessui/react/dist/components/combobox/combobox.d.ts` los nombres exactos exportados). Usar esos.

- [ ] **Step 2: Agregar imports y estado a la página**

En `app/admin/grupos/[id]/page.tsx`, agregar a los imports:

```tsx
import { useMemo } from 'react';
import {
  Combobox,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
} from '@headlessui/react';
import { useBuscarDebounced } from '@/components/admin/ui/personas-listado/useBuscarDebounced';
import { listarAlumnos, type PersonaListItemAlumno } from '@/lib/api/personas';
import { matricularAlumno } from '@/lib/api/grupos';
import { INPUT_CLASS, LABEL_CLASS } from '@/components/admin/ui/persona-alta/estilos';
```

(fusionar los que ya existan: `useMemo` va junto a `useState`; `matricularAlumno` junto a los otros de `@/lib/api/grupos`).

Dentro del componente, junto al resto de hooks:

```tsx
const { inputValue, setInputValue, buscar } = useBuscarDebounced();

const buscarQuery = useQuery({
  queryKey: ['admin', 'personas', 'ALUMNO', 'buscar-grupo', buscar],
  queryFn: async () => {
    try {
      return await listarAlumnos({ buscar, limit: 20 });
    } catch (err) {
      console.error('[AdminGrupoDetallePage] Error al buscar alumnos:', err);
      throw err;
    }
  },
  enabled: buscar.length >= 2,
});

const idsMatriculados = useMemo(
  () => new Set(alumnos.map((a) => a.usuarioId)),
  [alumnos],
);

const candidatos = useMemo(() => {
  if (!grupo) return [] as PersonaListItemAlumno[];
  return (buscarQuery.data?.data ?? []).filter(
    (p) => p.carrera.id === grupo.carreraId && !idsMatriculados.has(p.usuarioId),
  );
}, [buscarQuery.data, grupo, idsMatriculados]);

const matricularMutation = useMutation({
  mutationFn: (usuarioId: string) => matricularAlumno(id, usuarioId),
  onSuccess: () => {
    toast.success('Alumno matriculado');
    setInputValue('');
    void queryClient.invalidateQueries({ queryKey: ['admin', 'grupos', 'detalle', id] });
  },
  onError: (err) => {
    console.error('[AdminGrupoDetallePage] Error al matricular alumno:', err);
    if (
      err instanceof ApiError &&
      ['VALIDATION_ERROR', 'CAPACIDAD_EXCEDIDA', 'CONFLICT', 'NOT_FOUND'].includes(err.code)
    ) {
      toast.error(err.message);
      return;
    }
    toast.error(MENSAJE_ERROR_GENERICO);
  },
});
```

> `invalidateQueries({ queryKey: ['admin','grupos','detalle', id] })` sin `exact` invalida también `['admin','grupos','detalle', id, 'alumnos']` (React Query hace match por prefijo) — con eso se refrescan la tabla Y el contador. Confirmar ese comportamiento; si se prefiere ser explícito, invalidar las dos keys por separado.

- [ ] **Step 3: Reemplazar el placeholder por el bloque del autocomplete**

Sustituir el comentario `{/* PLACEHOLDER Task 3 ... */}` por:

```tsx
<div className="rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
  <label htmlFor="buscar-alumno" className={LABEL_CLASS}>
    Agregar alumno
  </label>
  {lleno ? (
    <p className="mt-2 rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning">
      Grupo lleno ({grupo?.capacidad} / {grupo?.capacidad}) — quita un alumno para
      agregar otro.
    </p>
  ) : (
    <Combobox
      immediate
      onChange={(usuarioId: string | null) => {
        if (usuarioId) matricularMutation.mutate(usuarioId);
      }}
      disabled={matricularMutation.isPending}
    >
      <div className="relative mt-1">
        <ComboboxInput
          id="buscar-alumno"
          className={INPUT_CLASS}
          placeholder="Busca por nombre o matrícula…"
          autoComplete="off"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
        />
        <ComboboxOptions className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-mist bg-white py-1 text-sm shadow-lg focus:outline-none">
          {buscar.length < 2 ? (
            <p className="px-3 py-2 text-xs text-slate/60">
              Escribe al menos 2 caracteres para buscar.
            </p>
          ) : buscarQuery.isLoading ? (
            <p className="px-3 py-2 text-xs text-slate/60">Buscando…</p>
          ) : buscarQuery.isError ? (
            <p className="px-3 py-2 text-xs text-crimson">
              No se pudo buscar. Intenta de nuevo.
            </p>
          ) : candidatos.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate/60">
              Sin alumnos de esta carrera para agregar.
            </p>
          ) : (
            candidatos.map((p) => (
              <ComboboxOption
                key={p.usuarioId}
                value={p.usuarioId}
                className="cursor-pointer px-3 py-2 text-slate data-[focus]:bg-mist/40"
              >
                {[p.apellidoPaterno, p.apellidoMaterno].filter(Boolean).join(' ')},{' '}
                {p.nombres} — {p.matricula}
              </ComboboxOption>
            ))
          )}
        </ComboboxOptions>
      </div>
    </Combobox>
  )}
  <p className="mt-2 text-xs text-slate/50">
    Solo aparecen alumnos de la carrera del grupo que aún no están matriculados.
  </p>
</div>
```

> Si `data-[focus]` no funciona con la versión de Tailwind/headless instalada, usar el render-prop de `ComboboxOption` (`{({ focus }) => ...}`) — comprobar contra `Select.tsx`, que ya resuelve el mismo tema para `ListboxOption`. El `immediate` prop abre el panel al enfocar sin escribir; si la versión no lo soporta, quitarlo (no es crítico).

- [ ] **Step 4: Verificar**

Run: `cd App/frontend && pnpm tsc --noEmit` → limpio.
Run: `cd App/frontend && pnpm build` → OK.
Revisar que el import de `useState` no quedó duplicado y que `PersonaListItemAlumno` se importa como type.

- [ ] **Step 5: Commit**

```bash
git add App/frontend/src/app/admin/grupos/[id]/page.tsx
git commit -m "feat(admin): autocomplete para matricular alumnos en el detalle de grupo"
```

---

### Task 4: Documentación

**Files:**
- Modify: `CLAUDE.md` (contrato: `GET /grupos/:id`; línea "Fase actual")
- Modify: `docs/roadmap.md` (Día 31 checkboxes + cerrar Fase 10)
- Modify: `documentacion_de_agentes/ESTADO.md` (entrada de cierre)

**Interfaces:**
- Consumes: nombres finales — `GET /grupos/:id`, `app/admin/grupos/[id]/page.tsx`.
- Produces: nada.

- [ ] **Step 1: `CLAUDE.md` — contrato de `GET /grupos/:id`**

En la sección "Contrato de API", en el bloque de `POST/GET /grupos` (Fase 9, Día 28) o inmediatamente después, agregar una frase:

```
- `GET /grupos/:id` (Fase 10, Día 31 — adición para la vista de detalle de la UI).
  Mismos guards que el resto de `GruposController`, `sedeId` de `@SedeActual()`. `id`
  de otra sede / inexistente → `404 NOT_FOUND`. Éxito: `200 { data: GrupoListItem }` —
  mismo shape que un item de `GET /grupos` (`carrera`/`salon` expandidos a
  `{ id, nombre }`), no hay tipo nuevo. Sigue sin haber `PATCH /grupos/:id`.
```

- [ ] **Step 2: `CLAUDE.md` — línea "Fase actual"**

Localizar la frase de Día 30 ("**Fase 10 — Gestión de grupos: Día 30 ... CERRADO** ... Día 31 —UI— pendiente"). Reemplazar "Día 31 —UI— pendiente" por el cierre:

```
**Día 31 (UI de gestión de grupos) CERRADO** (2026-08-27 — `app/admin/grupos/[id]/page.tsx`:
detalle con lista de matriculados, autocomplete `@headlessui/react` `Combobox` para
matricular filtrando por carrera + no-ya-matriculado, badge de capacidad `N / M` que
deshabilita el autocomplete al llenarse, modal de confirmación para quitar; backend ganó
`GET /grupos/:id`) — **Fase 10 — Gestión de grupos: COMPLETA** (Días 30-31).
```

Ajustar la redacción al estilo de la frase (una oración larga, marcadores en negrita).

- [ ] **Step 3: `docs/roadmap.md` — Día 31 + cierre de Fase 10**

En "### Día 31 — UI de gestión de grupos", cambiar los 3 `- [ ]` a `- [x]` y agregar debajo:

```
- [x] Gap de backend: `GET /grupos/:id` (la vista de detalle lo necesita para sobrevivir a refresh/deep-link — mismo criterio que `GET /salones` en el Día 29)

**Entregable visible:** admin entra a un grupo desde `/admin/grupos`, ve los matriculados,
agrega uno por búsqueda (autocomplete filtrado a la carrera del grupo), lo quita con
confirmación; el contador `N / M` se actualiza y bloquea el alta al llenarse.
```

Si la Fase 10 tiene un encabezado con marca de estado, actualizarlo a COMPLETA (Días 30-31), mismo formato que las fases previas (`## FASE 10 — ... — COMPLETA (2026-08-27)` o el patrón `~~...~~` que use el archivo).

- [ ] **Step 4: `documentacion_de_agentes/ESTADO.md` — entrada de cierre**

Después de la entrada del Día 30 (última de 2026-08-27), agregar:

```markdown
### Día 31 — UI de gestión de grupos — ✅ CERRADO EN CÓDIGO (2026-08-27)

- **Backend**: `GET /grupos/:id` nuevo en `GruposController` (`GruposService.obtenerPorId`,
  `findFirst` propio con `select` expandido — NO reutiliza `obtenerGrupoEnSede`). Mismos
  guards; `404 NOT_FOUND` si no es de la sede; `200 { data: GrupoListItem }` (mismo shape
  que `GET /grupos`). 2 casos e2e en `grupos.e2e-spec.ts`.
- **Frontend**: ruta nueva `app/admin/grupos/[id]/page.tsx` (primera ruta dinámica del
  proyecto, `params` vía `useParams()`). Encabezado con badge de capacidad `N / M`
  (color de alerta + "Lleno" al llegar a `capacidad`); tabla de matriculados
  (`GET /grupos/:id/alumnos`) con "Quitar" + `ConfirmarQuitarAlumnoModal` local;
  autocomplete de "Agregar alumno" con `@headlessui/react` `Combobox` +
  `useBuscarDebounced` + `GET /personas?rol=ALUMNO&buscar=`, **filtrado en cliente** a
  `carrera.id === grupo.carreraId && !yaMatriculado` (NO por `activo`/`estatusAcademico`,
  coherente con el backend del Día 30). El Combobox se deshabilita cuando el grupo está
  lleno. `lib/api/grupos.ts` ganó `obtenerGrupo`/`listarAlumnosDeGrupo`/`matricularAlumno`/
  `desmatricularAlumno` + tipo `GrupoAlumnoListItem`. Link "Alumnos" nuevo por fila en
  `app/admin/grupos/page.tsx`.
- **Fuera de alcance**: sin edición de grupo (no hay `PATCH /grupos/:id`); sin badge de
  `EstatusAcademico` (texto plano); sin paginación en la tabla de matriculados; sin
  filtro por `activo`/`estatusAcademico` en el autocomplete.
- **Verificación**: suite e2e completa del backend + unit + `tsc --noEmit` + build
  frontend en verde. Verificación manual en navegador — PENDIENTE (a cargo del usuario:
  entrar a un grupo, matricular por búsqueda, ver el contador, quitar con modal, llenar
  el grupo, refrescar el detalle).
- **Fase 10 — Gestión de grupos: COMPLETA** (Días 30-31).
- Spec → `docs/superpowers/specs/2026-08-27-dia31-ui-gestion-grupos-design.md`,
  plan → `docs/superpowers/plans/2026-08-27-dia31-ui-gestion-grupos.md`.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/roadmap.md documentacion_de_agentes/ESTADO.md
git commit -m "docs: Día 31 — UI de gestión de grupos (cierra Fase 10)"
```

---

## Self-Review

**1. Spec coverage:**
- Spec §1 (`GET /grupos/:id`, shape = `GrupoListItem`, 404, no toca `obtenerGrupoEnSede`, 2 e2e) → Task 1. ✅
- Spec §2 `lib/api/grupos.ts` (4 fns + `GrupoAlumnoListItem`, reusa `EstatusAcademico`) → Task 2 Step 1. ✅
- Spec §2 página de detalle (header + badge `N/M` + tabla matriculados + quitar-modal) → Task 2 Steps 2, 4. ✅
- Spec §2 autocomplete (`Combobox`, debounce, filtro carrera + no-matriculado, gate por lleno, mutation + invalidación) → Task 3. ✅
- Spec §2 `ConfirmarQuitarAlumnoModal` → Task 2 Step 2. ✅
- Spec §2 link "Alumnos" en la página de listado → Task 2 Step 5. ✅
- Spec §3 fuera de alcance (sin PATCH, sin badge nuevo, sin filtro por activo, sin paginación) → reflejado en Global Constraints + no se implementa; documentado en Task 4. ✅
- Spec §4 verificación → Task 1 Step 5, Task 2 Step 6, Task 3 Step 4. ✅
- Spec "CLAUDE.md" (`GET /grupos/:id`) → Task 4 Steps 1-2. ✅

**2. Placeholder scan:** No hay "TBD"/"TODO"/"handle errors". El código de las 4 tasks está literal. Los estados JSX de loading/error/vacío están escritos, no descritos. Los 2 puntos donde se pide "comprobar contra la doc de Next / contra `Select.tsx`" son verificaciones concretas con archivo fuente exacto, no huecos — la versión de la API de `Combobox`/`useParams` en esta build de Next/headless no se puede asumir de memoria (el `AGENTS.md` del frontend lo advierte explícitamente), así que la instrucción es "leer X y usar lo que diga", con el fallback escrito. ✅

**3. Type consistency:**
- `GrupoAlumnoListItem` — 8 llaves idénticas entre el spec, `lib/api/grupos.ts` (Task 2 Step 1), el uso en la página (Task 2 Step 4) y `ESTADO.md` (Task 4). ✅
- `obtenerGrupo(id): Promise<GrupoListItem>` — firma idéntica entre "Produces" de Task 2, el cliente (Step 1) y el `useQuery` de la página (Step 4). ✅
- `GET /grupos/:id` → `{ data: GrupoListItem }`: backend `obtenerPorId` (Task 1 Step 3) devuelve exactamente esas 6 propiedades con `carrera`/`salon` como `{ id, nombre }` — coincide con `GrupoListItem` de `lib/api/grupos.ts` (ya existente) y con lo que el cliente `obtenerGrupo` castea. ✅
- `matricularAlumno(grupoId, usuarioId): Promise<Grupo>` — el backend `POST /grupos/:id/alumnos` devuelve la fila `GrupoAlumno` plana, NO un `Grupo`. **Inconsistencia**: el tipo de retorno debería ser el shape de `GrupoAlumno` (`{ id, grupoId, alumnoId, fechaInscripcion }`), no `Grupo`. Corregir en Task 2 Step 1: el `matricularAlumno` no usa el valor de retorno (la mutation sólo invalida queries en `onSuccess`), así que tiparlo como `Promise<{ id: string; grupoId: string; alumnoId: string; fechaInscripcion: string }>` o simplemente `Promise<unknown>`. **Ajuste aplicado abajo.**
- `EstatusAcademico` — importado de `lib/api/personas.ts` en `lib/api/grupos.ts` y en la página; `Record<EstatusAcademico, string>` cubre los 4 valores del enum (`INSCRITO`/`BAJA_TEMPORAL`/`BAJA_DEFINITIVA`/`EGRESADO`, confirmados en `schema.prisma`). ✅
- `PersonaListItemAlumno` — tiene `carrera: { id, nombre }`, `usuarioId`, `nombres`, `apellidoPaterno`, `apellidoMaterno`, `matricula` (confirmado en `lib/api/personas.ts`). El filtro `p.carrera.id` y el render usan campos reales. ✅

**Ajuste (type consistency #4):** en Task 2 Step 1, cambiar la firma y el cuerpo de `matricularAlumno` a:

```ts
export interface GrupoAlumno {
  id: string;
  grupoId: string;
  alumnoId: string;
  fechaInscripcion: string;
}

/** `POST /grupos/:id/alumnos` — Fase 10, Día 30. Devuelve la fila de unión plana. */
export function matricularAlumno(
  grupoId: string,
  usuarioId: string,
): Promise<GrupoAlumno> {
  return apiFetchAuth<GrupoAlumno>(`/grupos/${grupoId}/alumnos`, {
    method: 'POST',
    body: JSON.stringify({ usuarioId }),
  });
}
```

y quitar el `type Grupo` del import/uso de `matricularAlumno` (el `Grupo` sigue existiendo para `crearGrupo`, no se toca). La página no referencia el tipo de retorno de `matricularAlumno`, así que no hay cambio en Task 3 por esto.
