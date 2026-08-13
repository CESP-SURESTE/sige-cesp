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
 *
 * `alumno.esMenorDeEdad` (2026-08-13, gap de Día 16 extendido cerrado) —
 * espejo del campo derivado que ya devuelve `PerfilService.obtenerPerfilPropio`
 * (`App/backend/src/perfil/perfil.service.ts`, regla 1: calculado al vuelo
 * desde `fechaNacimiento`, nunca persistido). El tipo estaba desactualizado
 * desde que el backend lo agregó — el backend nunca dejó de mandarlo, solo
 * no estaba declarado acá.
 *
 * `alumno.contactos` (2026-08-13, gap real reportado por el usuario probando
 * la app — el tutor/contacto de emergencia capturado en el alta no se veía
 * en ningún lado después). Array de 1 a 3 `ContactoAlumno`, ordenado por
 * `orden` ascendente (el `orden: 1` es el contacto principal). Alcance
 * deliberado: SOLO contactos, sin `infoMedica` (más sensible — no hay
 * pedido explícito de mostrar datos de salud en el perfil todavía).
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

/** Espejo de `TipoContacto` (`schema.prisma`). */
export type TipoContacto = 'TUTOR' | 'EMERGENCIA';

export interface ContactoAlumno {
  id: string;
  tipo: TipoContacto;
  nombre: string;
  telefono: string;
  correo: string | null;
  parentesco: string;
  orden: number;
}

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
  /** Derivado al vuelo por el backend desde `fechaNacimiento` — nunca
   * persistido (regla 1 de `CLAUDE.md` raíz). */
  esMenorDeEdad: boolean;
  /** 1 a 3 elementos, ordenados por `orden` ascendente. Cuando
   * `esMenorDeEdad` es `true` siempre incluye al menos un contacto
   * `tipo: 'TUTOR'` (obligatorio en el alta para menores). */
  contactos: ContactoAlumno[];
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
