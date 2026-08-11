import { apiFetchAuth } from './http';

/**
 * `GET /carreras` — Fase 4, Día 14.
 *
 * Endpoint construido en paralelo por otro agente para desbloquear el
 * dropdown de `carreraId` del formulario de alta de alumno
 * (`app/admin/alumnos/nuevo/page.tsx`). Shape espejo de
 * `App/backend/src/carreras/carreras.service.ts` (`listarPorSede`) —
 * mantener en sync a mano si cambia el backend, mismo criterio que
 * `lib/api/auth.ts` con `LoginResult`.
 *
 * `sedeId` no es un parámetro aquí: el backend lo saca del JWT
 * (`@SedeActual()`, regla 2 de CLAUDE.md raíz), nunca de query/param.
 */
export interface Carrera {
  id: string;
  nombre: string;
  clave: string;
}

export function listarCarreras(): Promise<Carrera[]> {
  return apiFetchAuth<Carrera[]>('/carreras');
}
