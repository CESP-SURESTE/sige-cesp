import { apiFetchAuth } from './http';

/**
 * `POST /personas` — Fase 4, Día 14 (alta de alumno) + Día 15 (alta de
 * maestro y administrativo, mismo endpoint, discriminado por `rol`).
 *
 * Shape espejo de `App/backend/src/personas/dto/crear-persona.dto.ts`
 * (`CrearPersonaDto` + `PerfilAlumnoDto`/`PerfilMaestroDto`/
 * `PerfilAdministrativoDto`) y `App/backend/src/personas/personas.service.ts`
 * (`AltaPersonaResult` / `UsuarioAltaResult`) — mantener en sync a mano,
 * mismo criterio que `lib/api/auth.ts` con `LoginResult`. Cada
 * `crear<Rol>()` fija su propio `rol`, no se expone como campo editable en
 * ningún formulario.
 *
 * `PerfilMaestroInput`/`PerfilAdministrativoInput` NO tienen `estatus`
 * (corrección de QA manual, sesión 2026-08-12) — el backend lo fuerza
 * siempre a `ACTIVO` en la creación, no tiene sentido dar de alta a alguien
 * ya en `BAJA`/`LICENCIA`. Ver nota espejo en `crear-persona.dto.ts`.
 *
 * `contactos`/`infoMedica` (extensión 2026-08-12, decisión del usuario:
 * misma transacción que el alta) — espejo de `ContactoDto`/
 * `ContactoAlumnoDto`/`InfoMedicaDto` (`crear-persona.dto.ts`). `orden` NO se
 * manda (regla 1 de `CLAUDE.md` raíz): se deriva de la posición del contacto
 * en el array, el backend lo asigna.
 */
export interface ContactoInput {
  nombre: string;
  telefono: string;
  correo?: string;
  parentesco: string;
}

/** Espejo de `TipoContacto` (`schema.prisma`) — exclusivo de `ContactoAlumnoInput`. */
export type TipoContacto = 'TUTOR' | 'EMERGENCIA';

export interface ContactoAlumnoInput extends ContactoInput {
  tipo: TipoContacto;
}

/**
 * Idéntico para los 3 roles (espejo de `InfoMedicaAlumno`/`InfoMedicaMaestro`/
 * `InfoMedicaAdministrativo`, `schema.prisma`, y de `InfoMedicaDto`,
 * backend). Los 4 campos opcionales típicamente solo tienen sentido si
 * `tieneCondicionMedica` es `true` (criterio de UX en cada `page.tsx`).
 */
export interface InfoMedicaInput {
  tieneCondicionMedica: boolean;
  padecimiento?: string;
  medicamentos?: string;
  alergias?: string;
  tratamientoAdicional?: string;
}

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
  /** 1-3 elementos — `ContactoAlumnoDto` (con `tipo`), exclusivo de alumno. */
  contactos: ContactoAlumnoInput[];
  infoMedica: InfoMedicaInput;
}

export interface CrearAlumnoInput {
  email: string;
  codigoExterno?: string;
  perfilAlumno: PerfilAlumnoInput;
}

/** Espejo de `PuestoAdministrativo` (`schema.prisma`). */
export type PuestoAdministrativo =
  | 'DIRECTOR'
  | 'COORDINADOR_ACADEMICO'
  | 'COORDINADOR_ADMINISTRATIVO'
  | 'AUXILIAR'
  | 'RECEPCION'
  | 'OTRO';

/** Espejo de `NivelPermiso` (`schema.prisma`). */
export type NivelPermiso = 'SUPER_ADMIN' | 'ADMIN' | 'AUXILIAR';

export interface PerfilMaestroInput {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno?: string;
  curp: string;
  cedulaProfesional?: string;
  correoPersonal: string;
  telefono: string;
  /** ISO date (`YYYY-MM-DD`). */
  fechaContratacion: string;
  /** 1-3 elementos — `ContactoDto` (sin `tipo`). */
  contactos: ContactoInput[];
  infoMedica: InfoMedicaInput;
}

export interface CrearMaestroInput {
  email: string;
  codigoExterno?: string;
  perfilMaestro: PerfilMaestroInput;
}

export interface PerfilAdministrativoInput {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno?: string;
  curp: string;
  correoPersonal: string;
  telefono: string;
  /** ISO date (`YYYY-MM-DD`). */
  fechaContratacion: string;
  puesto: PuestoAdministrativo;
  /**
   * Default `AUXILIAR` (mínimo privilegio) en el backend si no viene.
   * Restringido por jerarquía (regla 7 de `CLAUDE.md` raíz) —
   * `POST /personas` responde 403 `NIVEL_PERMISO_INSUFICIENTE` si el actor
   * no tiene permiso para asignar el nivel pedido.
   */
  nivelPermiso?: NivelPermiso;
  /** 1-3 elementos — `ContactoDto` (sin `tipo`). */
  contactos: ContactoInput[];
  infoMedica: InfoMedicaInput;
}

export interface CrearAdministrativoInput {
  email: string;
  codigoExterno?: string;
  perfilAdministrativo: PerfilAdministrativoInput;
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

export function crearMaestro(
  input: CrearMaestroInput,
): Promise<AltaPersonaResult> {
  return apiFetchAuth<AltaPersonaResult>('/personas', {
    method: 'POST',
    body: JSON.stringify({ ...input, rol: 'MAESTRO' }),
  });
}

export function crearAdministrativo(
  input: CrearAdministrativoInput,
): Promise<AltaPersonaResult> {
  return apiFetchAuth<AltaPersonaResult>('/personas', {
    method: 'POST',
    body: JSON.stringify({ ...input, rol: 'ADMINISTRATIVO' }),
  });
}
