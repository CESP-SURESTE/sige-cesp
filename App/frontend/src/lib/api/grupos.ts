import { apiFetchAuth, apiFetchAuthPaginado, type ApiListaPaginada } from './http';

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
