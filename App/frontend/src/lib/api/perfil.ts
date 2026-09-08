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
 *
 * `maestro` (Día 17, 2026-08-13) — mismo patrón que `alumno`: campos propios
 * de `PerfilMaestro` + `contactos` (`ContactoMaestro`, ordenados por `orden`,
 * SIN `tipo` — a diferencia de `ContactoAlumno`, un maestro no distingue
 * tutor/emergencia). Sin `infoMedica` (mismo criterio de alcance). Sin
 * `esMenorDeEdad` — no aplica, `PerfilMaestro` no tiene `fechaNacimiento` en
 * el schema.
 *
 * `administrativo` (Día 18, 2026-08-13) — mismo patrón: campos propios de
 * `PerfilAdministrativo` + `contactos` (`ContactoAdministrativo`, sin
 * `tipo`, igual que maestro). Sin `infoMedica`. Sin `permisos`
 * (`PermisoAdministrativo[]`, la matriz completa por sección de un
 * `AUXILIAR`) — alcance deliberado, el roadmap de Día 18 pide el indicador
 * de nivel de permiso (singular), no la matriz completa (feature propia,
 * sin día asignado). `puedeDarAltaAdministrativos` es un `boolean`
 * derivado al vuelo por el backend desde `nivelPermiso` (regla 1) — replica
 * SOLO la primera compuerta de `PersonasService.verificarJerarquiaNivelPermiso`
 * (regla 7 de `CLAUDE.md` raíz): `true` si `ADMIN`/`SUPER_ADMIN`, `false` si
 * `AUXILIAR`. NO replica la segunda compuerta (un `ADMIN` no puede asignar
 * `SUPER_ADMIN` al dar de alta) — hallazgo de QA (`qa-backend`,
 * 2026-08-13), sin impacto real: este campo es solo informativo en el
 * perfil, `POST /personas` sigue validando la jerarquía completa por su
 * cuenta.
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

/** Espejo de `EstatusEmpleado` (`schema.prisma`) — usado por `maestro` y
 * `administrativo`. */
export type EstatusEmpleado = 'ACTIVO' | 'BAJA' | 'LICENCIA';

/** Espejo de `TipoContratacion` (`schema.prisma`) — solo `maestro`.
 * `null` para maestros dados de alta antes de 2026-09-07. */
export type TipoContratacion = 'BASE' | 'TEMPORAL' | 'CONTRATO';

/** Igual que `ContactoAlumno` pero sin `tipo` — `ContactoMaestro` no
 * distingue tutor/emergencia, es un contacto genérico. */
export interface ContactoMaestro {
  id: string;
  nombre: string;
  telefono: string;
  correo: string | null;
  parentesco: string;
  orden: number;
}

/** Espejo de `PuestoAdministrativo` (`schema.prisma`). */
export type PuestoAdministrativo =
  | 'DIRECTOR'
  | 'COORDINADOR_ACADEMICO'
  | 'COORDINADOR_ADMINISTRATIVO'
  | 'AUXILIAR'
  | 'RECEPCION'
  | 'OTRO';

/** Espejo de `NivelPermiso` (`schema.prisma`) — jerarquía `SUPER_ADMIN >
 * ADMIN > AUXILIAR` (regla 7 de `CLAUDE.md` raíz). */
export type NivelPermiso = 'SUPER_ADMIN' | 'ADMIN' | 'AUXILIAR';

/** Mismo shape que `ContactoMaestro` (sin `tipo`). */
export interface ContactoAdministrativo {
  id: string;
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
  /** Opcional desde 2026-09-07 (`Carrera.rvoe` pasó a `String?`) — no todas
   * las carreras tienen RVOE emitido. */
  rvoe: string | null;
  /** Nuevo 2026-09-07 — estado de procedencia del RVOE cuando fue emitido
   * en otro estado distinto a Yucatán (texto libre, sin catálogo cerrado). */
  procedenciaRvoe: string | null;
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
  cuatrimestreActual: number;
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

export interface PerfilMaestro {
  id: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  curp: string;
  cedulaProfesional: string | null;
  correoPersonal: string;
  telefono: string;
  /** ISO 8601 (`Date` de Prisma serializado por Express). */
  fechaContratacion: string;
  estatus: EstatusEmpleado;
  /** `null` para maestros dados de alta antes de 2026-09-07 (columna
   * nullable, sin backfill — mismo criterio que `tipoLicencia`/`motivoBaja`). */
  tipoContratacion: TipoContratacion | null;
  /** Solo relevante cuando `tipoContratacion === 'TEMPORAL'` — días del
   * contrato por tiempo determinado. `null` en cualquier otro caso. */
  diasTemporal: number | null;
  /** ISO 8601. Solo relevante cuando `tipoContratacion === 'CONTRATO'`. */
  contratoFechaInicio: string | null;
  /** ISO 8601. Solo relevante cuando `tipoContratacion === 'CONTRATO'`. */
  contratoFechaFin: string | null;
  /** Ordenados por `orden` ascendente. Sin rango 1-3 documentado a
   * propósito distinto al de alumno — el alta de maestro también exige
   * 1 a 3, pero no hay un tipo obligatorio como el tutor de un menor. */
  contactos: ContactoMaestro[];
}

export interface PerfilAdministrativo {
  id: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  curp: string;
  correoPersonal: string;
  telefono: string;
  /** ISO 8601 (`Date` de Prisma serializado por Express). */
  fechaContratacion: string;
  estatus: EstatusEmpleado;
  puesto: PuestoAdministrativo;
  nivelPermiso: NivelPermiso;
  contactos: ContactoAdministrativo[];
  /** Derivado al vuelo por el backend desde `nivelPermiso` — nunca
   * persistido (regla 1 de `CLAUDE.md` raíz). Replica SOLO la primera
   * compuerta de `PersonasService.verificarJerarquiaNivelPermiso` (regla
   * 7): un `AUXILIAR` nunca puede dar de alta personal `ADMINISTRATIVO`.
   * NO replica la segunda compuerta (tope de jerarquía sobre A QUIÉN se
   * puede asignar) — informativo únicamente, `POST /personas` sigue
   * validando eso por su cuenta. */
  puedeDarAltaAdministrativos: boolean;
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
  /** Lleno solo si `rol === 'MAESTRO'`; `null` para los otros 2 roles. */
  maestro: PerfilMaestro | null;
  /** Lleno solo si `rol === 'ADMINISTRATIVO'`; `null` para los otros 2 roles. */
  administrativo: PerfilAdministrativo | null;
}

export function obtenerPerfil(): Promise<Perfil> {
  return apiFetchAuth<Perfil>('/perfil');
}

/**
 * `GET /perfil/malla` — Fase 7, Día 24. Signed URL (5 min) de la malla
 * curricular de la carrera del propio alumno. `null` si su carrera
 * todavía no tiene malla subida — estado normal, no un error (ver
 * `SeccionCarrera` en `app/alumno/page.tsx`, que muestra un mensaje
 * tranquilizador en ese caso en vez de un `toast.error`).
 */
export function obtenerUrlDescargaMalla(): Promise<{
  url: string;
  nombreArchivo: string;
} | null> {
  return apiFetchAuth('/perfil/malla');
}

/**
 * `GET /perfil/grupo/companeros` — Fase 11, Día 32.
 *
 * Compañeros matriculados en el/los grupo(s) del propio alumno, agrupados
 * por grupo. Shape espejo exacto de `PerfilService.obtenerCompanerosDeGrupo`
 * (`App/backend/src/perfil/perfil.service.ts`) — mismo criterio de "mantener
 * en sync a mano" que el resto de este archivo. Excluye al propio alumno.
 * NO filtra por estatus/activo (consistente con Día 30). Array vacío si el
 * alumno no está en ningún grupo; un grupo puede venir con `companeros: []`
 * si es el único inscrito.
 */
export interface CompaneroItem {
  usuarioId: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  matricula: string;
  cuatrimestreActual: number;
}

export interface GrupoConCompaneros {
  grupoId: string;
  nombre: string;
  anioInicio: number;
  cicloActual: number;
  carrera: { id: string; nombre: string };
  salon: { id: string; nombre: string };
  companeros: CompaneroItem[];
}

export function obtenerCompaneros(): Promise<GrupoConCompaneros[]> {
  return apiFetchAuth<GrupoConCompaneros[]>('/perfil/grupo/companeros');
}

/**
 * `GET /perfil/asignaciones` — Fase 12, Día 34.
 *
 * Grupos y materias que el maestro autenticado tiene asignados, agrupados
 * por grupo. Shape espejo exacto de `PerfilService.obtenerAsignacionesPropias`
 * (`App/backend/src/perfil/perfil.service.ts`) — mismo criterio de "mantener
 * en sync a mano" que el resto de este archivo. Solo `MAESTRO`. Array vacío
 * si el maestro no tiene asignaciones.
 */
export interface MateriaAsignada {
  id: string;
  nombre: string;
  ciclo: number;
}

export interface GrupoConMaterias {
  grupoId: string;
  nombre: string;
  anioInicio: number;
  cicloActual: number;
  carrera: { id: string; nombre: string };
  salon: { id: string; nombre: string };
  materias: MateriaAsignada[];
}

export function obtenerMisAsignaciones(): Promise<GrupoConMaterias[]> {
  return apiFetchAuth<GrupoConMaterias[]>('/perfil/asignaciones');
}
