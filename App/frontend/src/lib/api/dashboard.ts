import { apiFetchAuth } from './http';

/**
 * `GET /personas/resumen` — dashboard de admin por sede.
 *
 * Shape espejo de `App/backend/src/personas/personas.service.ts`
 * (`ResumenPorSedeResult`/`AlumnosPorCarreraItem`/`AltaRecienteItem`) —
 * mantener en sync a mano, mismo criterio que el resto de `lib/api/*.ts`.
 *
 * `sedeId` NO es un parámetro acá — el backend lo saca del JWT
 * (`@SedeActual()`, regla 2 de `CLAUDE.md` raíz), nunca de query. Mismos
 * guards que `GET /personas` (`SedeGuard` + `RolesGuard`,
 * `@Roles(ADMINISTRATIVO)`).
 */
export interface ResumenAdmin {
  totalAlumnosActivos: number;
  totalMaestrosActivos: number;
  totalAdministrativosActivos: number;
  totalCarreras: number;
  alumnosPorCarrera: { carreraId: string; nombre: string; cantidad: number }[];
  altasRecientes: {
    usuarioId: string;
    nombreCompleto: string;
    rol: 'ALUMNO' | 'MAESTRO' | 'ADMINISTRATIVO';
    fecha: string;
  }[];
}

export function obtenerResumenAdmin(): Promise<ResumenAdmin> {
  return apiFetchAuth<ResumenAdmin>('/personas/resumen');
}
