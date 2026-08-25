import { apiFetchAuth } from './http';

/**
 * `GET /salones` — Fase 9, Día 29. Espejo mínimo de
 * `App/backend/src/salones/salones.service.ts` (`SalonListItem`) — catálogo
 * chico por sede, sin paginar (mismo criterio que `GET /carreras`).
 *
 * `sedeId` no es un parámetro acá: el backend lo saca del JWT
 * (`@SedeActual()`, regla 2 de `CLAUDE.md` raíz), nunca de query/param.
 *
 * ACTUALIZADO — CRUD completo de Salón (Fase 9, día CRUD de Salón, Task 2):
 * agrega `crearSalon`/`actualizarSalon`/`eliminarSalon`, leyendo el backend
 * real de Task 1 (`salones.controller.ts`/`salones.service.ts`/
 * `dto/crear-salon.dto.ts`/`dto/actualizar-salon.dto.ts`) para el shape
 * exacto de request/response.
 */
export interface Salon {
  id: string;
  nombre: string;
  capacidad: number;
}

export function listarSalones(): Promise<Salon[]> {
  return apiFetchAuth<Salon[]>('/salones');
}

/** Body de `POST`/`PATCH /salones` — `sedeId` NUNCA va acá (regla 2), sale de `@SedeActual()` en el backend. */
export interface SalonInput {
  nombre: string;
  capacidad: number;
}

export function crearSalon(input: SalonInput): Promise<Salon> {
  return apiFetchAuth<Salon>('/salones', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function actualizarSalon(
  id: string,
  input: Partial<SalonInput>,
): Promise<Salon> {
  return apiFetchAuth<Salon>(`/salones/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function eliminarSalon(id: string): Promise<{ ok: true }> {
  return apiFetchAuth<{ ok: true }>(`/salones/${id}`, {
    method: 'DELETE',
  });
}
