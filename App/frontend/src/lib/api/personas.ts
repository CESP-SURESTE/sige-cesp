import { apiFetchAuth } from './http';

/**
 * `POST /personas` — Fase 4, Día 14 (consumido por
 * `app/admin/alumnos/nuevo/page.tsx`).
 *
 * Shape espejo de `App/backend/src/personas/dto/crear-persona.dto.ts`
 * (`CrearPersonaDto` + `PerfilAlumnoDto`) y
 * `App/backend/src/personas/personas.service.ts` (`AltaPersonaResult` /
 * `UsuarioAltaResult`) — mantener en sync a mano, mismo criterio que
 * `lib/api/auth.ts` con `LoginResult`. Solo se modela el sub-perfil
 * `perfilAlumno` (este formulario es específicamente de alta de alumno, no
 * de maestro/administrativo — `rol` va fijo a `'ALUMNO'`, no se expone como
 * campo editable).
 */
export interface PerfilAlumnoInput {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno?: string;
  curp?: string;
  /** ISO date (`YYYY-MM-DD`). */
  fechaNacimiento: string;
  matricula: string;
  correoPersonal: string;
  carreraId: string;
  periodoIngreso: string;
  semestreActual: number;
  telefono?: string;
}

export interface CrearAlumnoInput {
  email: string;
  codigoExterno?: string;
  perfilAlumno: PerfilAlumnoInput;
}

export interface UsuarioAltaResult {
  id: string;
  email: string;
  rol: string;
  sedeId: string;
  codigoExterno: string | null;
  primerIngreso: boolean;
  activo: boolean;
}

export interface AltaPersonaResult {
  usuario: UsuarioAltaResult;
  temporaryPassword: string;
}

export function crearAlumno(
  input: CrearAlumnoInput,
): Promise<AltaPersonaResult> {
  return apiFetchAuth<AltaPersonaResult>('/personas', {
    method: 'POST',
    body: JSON.stringify({ ...input, rol: 'ALUMNO' }),
  });
}
