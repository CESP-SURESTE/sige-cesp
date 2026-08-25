import { apiFetchAuth } from './http';

/**
 * `GET /salones` — Fase 9, Día 29. Espejo mínimo de
 * `App/backend/src/salones/salones.service.ts` (`SalonListItem`) — catálogo
 * chico por sede, sin paginar (mismo criterio que `GET /carreras`).
 *
 * `sedeId` no es un parámetro acá: el backend lo saca del JWT
 * (`@SedeActual()`, regla 2 de `CLAUDE.md` raíz), nunca de query/param.
 */
export interface Salon {
  id: string;
  nombre: string;
  capacidad: number;
}

export function listarSalones(): Promise<Salon[]> {
  return apiFetchAuth<Salon[]>('/salones');
}
