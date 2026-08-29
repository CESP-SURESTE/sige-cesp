import { apiFetchAuth, apiFetchAuthPaginado, type ApiListaPaginada } from './http';
import type { EstatusAcademico } from './personas';

/**
 * `POST`/`GET /grupos` — Fase 9, Día 28 (backend) / Día 29 (frontend).
 *
 * Shape espejo de `App/backend/src/grupos/grupos.controller.ts`,
 * `grupos.service.ts` (`GrupoListItem`/`ListarGruposResult`) y
 * `dto/crear-grupo.dto.ts`/`dto/listar-grupos.query.dto.ts` — mantener en
 * sync a mano, mismo criterio que `lib/api/carreras.ts`/`lib/api/personas.ts`.
 *
 * `sedeId` NUNCA es un parámetro acá — igual que `listarCarreras`/
 * `listarAlumnos`, el backend lo saca del JWT (`@SedeActual()`, regla 2 de
 * `CLAUDE.md` raíz), nunca de body/query.
 */

/** Body de `POST /grupos` — todos los campos requeridos (`CrearGrupoDto`). */
export interface CrearGrupoInput {
  carreraId: string;
  salonId: string;
  nombre: string;
  anioInicio: number;
  cicloActual: number;
  capacidad: number;
}

/**
 * Shape plano del modelo `Grupo` — lo que devuelve `POST /grupos`
 * (`GruposService.crear`, sin relaciones expandidas, a diferencia de
 * `GrupoListItem`). Espejo de `model Grupo` en `schema.prisma` (sin
 * `sedeId`, redundante — el frontend nunca lo necesita, regla 2).
 */
export interface Grupo {
  id: string;
  carreraId: string;
  salonId: string;
  nombre: string;
  anioInicio: number;
  cicloActual: number;
  capacidad: number;
  createdAt: string;
  updatedAt: string;
}

export function crearGrupo(input: CrearGrupoInput): Promise<Grupo> {
  return apiFetchAuth<Grupo>('/grupos', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Item de `GET /grupos` — a diferencia de `Grupo` (respuesta de `POST`),
 * `carrera`/`salon` vienen expandidos a `{ id, nombre }` para que la tabla
 * no haga N+1 requests (`GruposService.listar`).
 */
export interface GrupoListItem {
  id: string;
  nombre: string;
  anioInicio: number;
  cicloActual: number;
  capacidad: number;
  carrera: { id: string; nombre: string };
  salon: { id: string; nombre: string };
}

/** Filtros de `GET /grupos` — todos opcionales (`ListarGruposQueryDto`). */
export interface ListarGruposFiltros {
  anioInicio?: number;
  cicloActual?: number;
  carreraId?: string;
  salonId?: string;
  /** Default backend: 1. */
  page?: number;
  /** Default backend: 20, máximo 100. */
  limit?: number;
}

export type ListarGruposResult = ApiListaPaginada<GrupoListItem>;

/**
 * Arma el querystring filtrando valores `undefined`/`''` — duplicado de
 * propósito de `construirQueryString` en `lib/api/personas.ts` (no
 * exportado ahí): cada `lib/api/*.ts` mantiene su propia copia en vez de
 * cruzar imports entre módulos de API, mismo criterio ya documentado en
 * `personas.ts` para los enums duplicados (`EstatusAcademico` vs.
 * `lib/api/perfil.ts`).
 */
function construirQueryString(
  params: Record<string, string | number | undefined>,
): string {
  const sp = new URLSearchParams();
  for (const [clave, valor] of Object.entries(params)) {
    if (valor !== undefined && valor !== '') {
      sp.set(clave, String(valor));
    }
  }
  const query = sp.toString();
  return query ? `?${query}` : '';
}

export function listarGrupos(
  filtros: ListarGruposFiltros,
): Promise<ListarGruposResult> {
  const query = construirQueryString({ ...filtros });
  return apiFetchAuthPaginado<GrupoListItem>(`/grupos${query}`);
}

export function eliminarGrupo(id: string): Promise<{ ok: true }> {
  return apiFetchAuth<{ ok: true }>(`/grupos/${id}`, { method: 'DELETE' });
}

/**
 * Fila plana de la tabla de unión `GrupoAlumno` (`schema.prisma`) — lo que
 * devuelve `POST /grupos/:id/alumnos` (`GruposService.matricular`, Fase 10
 * Día 30): la fila recién creada, sin relaciones expandidas ni datos del
 * alumno (para eso está `GrupoAlumnoListItem` de `GET /grupos/:id/alumnos`).
 */
export interface GrupoAlumno {
  id: string;
  grupoId: string;
  alumnoId: string;
  fechaInscripcion: string;
}

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

/**
 * `POST /grupos/:id/alumnos` — Fase 10, Día 30. Devuelve la fila `GrupoAlumno`
 * PLANA recién creada (no un `Grupo`).
 */
export function matricularAlumno(
  grupoId: string,
  usuarioId: string,
): Promise<GrupoAlumno> {
  return apiFetchAuth<GrupoAlumno>(`/grupos/${grupoId}/alumnos`, {
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

/**
 * `AsignacionListItem` — espejo de `App/backend/src/grupos/grupos.service.ts`
 * (Día 33). Lo que devuelve `GET /grupos/:id/asignaciones`.
 */
export interface AsignacionListItem {
  id: string;
  materia: { id: string; nombre: string; ciclo: number };
  maestro: {
    usuarioId: string;
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string | null;
  };
}

/**
 * Fila plana de `GrupoMateriaMaestro` (`schema.prisma`, Día 33) — lo que
 * devuelve `POST /grupos/:id/asignaciones` (`GruposService.asignarMaestro`).
 */
export interface GrupoMateriaMaestro {
  id: string;
  grupoId: string;
  materiaId: string;
  maestroId: string;
  asignadoEn: string;
}

/** `GET /grupos/:id/asignaciones` — Fase 12, Día 33. Sin paginar. */
export function listarAsignaciones(
  grupoId: string,
): Promise<AsignacionListItem[]> {
  return apiFetchAuth<AsignacionListItem[]>(`/grupos/${grupoId}/asignaciones`);
}

/**
 * `POST /grupos/:id/asignaciones` — Fase 12, Día 33. Devuelve la fila
 * `GrupoMateriaMaestro` PLANA. `usuarioId` es un `Usuario.id` de un maestro.
 */
export function asignarMaestro(
  grupoId: string,
  input: { materiaId: string; usuarioId: string },
): Promise<GrupoMateriaMaestro> {
  return apiFetchAuth<GrupoMateriaMaestro>(`/grupos/${grupoId}/asignaciones`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** `DELETE /grupos/:id/asignaciones/:asignacionId` — Fase 12, Día 33. */
export function eliminarAsignacion(
  grupoId: string,
  asignacionId: string,
): Promise<{ ok: true }> {
  return apiFetchAuth<{ ok: true }>(
    `/grupos/${grupoId}/asignaciones/${asignacionId}`,
    { method: 'DELETE' },
  );
}
