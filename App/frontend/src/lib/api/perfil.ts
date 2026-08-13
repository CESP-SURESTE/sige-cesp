import { apiFetchAuth } from './http';

/**
 * `GET /perfil` — Fase 5, Día 16.
 *
 * El usuario autenticado (cualquier rol) consulta su propio perfil — no hay
 * `:id`/query param, el backend saca el `usuarioId` del JWT (`@ActorUsuarioId()`,
 * ver `App/backend/src/perfil/perfil.controller.ts`).
 *
 * Shape espejo exacto de `App/backend/src/perfil/perfil.service.ts`
 * (`PerfilService.obtenerPerfilPropio`) y confirmado contra
 * `App/backend/test/perfil.e2e-spec.ts` (JSON real de ejemplo) — mismo
 * criterio de "mantener en sync a mano" que `lib/api/carreras.ts` y
 * `lib/api/personas.ts`.
 *
 * Alcance de hoy (Día 16, solo lectura): el frontend de alumno solo consume
 * `alumno` — `maestro`/`administrativo` quedan tipados como `null` (shape ya
 * estable de cara a Día 17/18, reservado en el backend, no implementado
 * todavía) porque este agente cubre alumno/maestro pero el entregable de hoy
 * es explícitamente la vista de alumno.
 */

/** Espejo de `RolUsuario` (`schema.prisma`). */
export type RolUsuario = 'ALUMNO' | 'MAESTRO' | 'ADMINISTRATIVO';

/** Espejo de `EstatusAcademico` (`schema.prisma`). */
export type EstatusAcademico =
  | 'INSCRITO'
  | 'BAJA_TEMPORAL'
  | 'BAJA_DEFINITIVA'
  | 'EGRESADO';

/** Espejo de `NivelCarrera` (`schema.prisma`). */
export type NivelCarrera = 'TECNICO' | 'LICENCIATURA' | 'MAESTRIA' | 'DOCTORADO';

/** Espejo de `ModalidadCarrera` (`schema.prisma`). */
export type ModalidadCarrera = 'PRESENCIAL' | 'SEMIPRESENCIAL' | 'EN_LINEA';

/** Espejo de `EstatusCarrera` (`schema.prisma`). */
export type EstatusCarrera = 'ACTIVA' | 'INACTIVA';

export interface PerfilSede {
  id: string;
  nombre: string;
  direccion: string;
  ubicacionReferencia: string;
  telefono: string;
  // `costoRenta` no se expone en `GET /perfil` a propósito (dato financiero
  // interno) — no está en este tipo.
}

export interface PerfilCarrera {
  id: string;
  nombre: string;
  clave: string;
  duracion: number;
  nivel: NivelCarrera;
  modalidad: ModalidadCarrera;
  estatus: EstatusCarrera;
  rvoe: string;
  descripcion: string;
}

export interface PerfilAlumno {
  id: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  curp: string | null;
  /** ISO 8601 (`Date` de Prisma serializado por Express). */
  fechaNacimiento: string;
  matricula: string;
  correoPersonal: string;
  estatusAcademico: EstatusAcademico;
  periodoIngreso: string;
  semestreActual: number;
  telefono: string | null;
  carrera: PerfilCarrera;
}

export interface Perfil {
  id: string;
  email: string;
  rol: RolUsuario;
  sedeId: string;
  codigoExterno: string | null;
  primerIngreso: boolean;
  activo: boolean;
  /** ISO 8601 o `null` si nunca ha iniciado sesión. */
  ultimoAcceso: string | null;
  sede: PerfilSede;
  /** Lleno solo si `rol === 'ALUMNO'`; `null` para los otros 2 roles. */
  alumno: PerfilAlumno | null;
  /** Reservado — se llena en Día 17 (perfil de maestro). Siempre `null` hoy. */
  maestro: null;
  /** Reservado — se llena en Día 18 (perfil de administrativo). Siempre `null` hoy. */
  administrativo: null;
}

export function obtenerPerfil(): Promise<Perfil> {
  return apiFetchAuth<Perfil>('/perfil');
}
