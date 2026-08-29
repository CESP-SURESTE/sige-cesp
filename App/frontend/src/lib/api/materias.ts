import { apiFetchAuth } from './http';

/**
 * `GET/POST /materias` — Fase 12, Día 33 (backend) / Día 34 (frontend).
 *
 * Shape espejo de `MateriasService` (`App/backend/src/materias/`) — mantener
 * en sync a mano, mismo criterio que `lib/api/carreras.ts`/`lib/api/grupos.ts`.
 * `sedeId` NUNCA es parámetro (el backend lo saca del JWT, regla 2).
 * `GET /materias` acá siempre se llama con `carreraId` + `ciclo` (la sección
 * de asignaciones del detalle de grupo, único consumidor).
 */
export interface Materia {
  id: string;
  nombre: string;
  carreraId: string;
  ciclo: number;
}

export interface CrearMateriaInput {
  nombre: string;
  carreraId: string;
  ciclo: number;
}

export function listarMaterias(
  carreraId: string,
  ciclo: number,
): Promise<Materia[]> {
  const query = `?carreraId=${encodeURIComponent(carreraId)}&ciclo=${ciclo}`;
  return apiFetchAuth<Materia[]>(`/materias${query}`);
}

export function crearMateria(input: CrearMateriaInput): Promise<Materia> {
  return apiFetchAuth<Materia>('/materias', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
