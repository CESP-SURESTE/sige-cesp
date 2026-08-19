import { platformFetch } from './platform-http';

/** Espejo de `model Sede` (`schema.prisma`) tal como lo devuelve el backend. */
export interface Sede {
  id: string;
  nombre: string;
  direccion: string;
  ubicacionReferencia: string;
  telefono: string;
  costoRenta: string | null; // Prisma Decimal serializa como string en JSON
  createdAt: string;
  updatedAt: string;
}

export interface SedeInput {
  nombre: string;
  direccion: string;
  ubicacionReferencia: string;
  telefono: string;
  costoRenta?: number;
}

export function listarSedes(): Promise<Sede[]> {
  return platformFetch<Sede[]>('/sedes');
}

export function crearSede(input: SedeInput): Promise<Sede> {
  return platformFetch<Sede>('/sedes', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function actualizarSede(
  id: string,
  input: Partial<SedeInput>,
): Promise<Sede> {
  return platformFetch<Sede>(`/sedes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function eliminarSede(id: string): Promise<{ ok: true }> {
  return platformFetch<{ ok: true }>(`/sedes/${id}`, {
    method: 'DELETE',
  });
}

/** Espejo de `ResumenGlobal` (backend, `platform-admin.service.ts`). */
export interface ResumenGlobal {
  totalSedes: number;
  totalAlumnosActivos: number;
  totalMaestrosActivos: number;
  totalAdministrativosActivos: number;
  alumnosPorSede: { sedeId: string; nombre: string; cantidad: number }[];
}

export function obtenerResumenGlobal(): Promise<ResumenGlobal> {
  return platformFetch<ResumenGlobal>('/platform-admin/resumen');
}
