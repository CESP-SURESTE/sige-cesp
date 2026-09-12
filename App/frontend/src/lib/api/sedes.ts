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

/** Espejo de `ContactoDto` (backend, sin `tipo` — exclusivo de alumno). */
export interface ContactoInput {
  nombre: string;
  telefono: string;
  correo?: string;
  parentesco: string;
}

/** Espejo de `InfoMedicaDto` (backend) — `tipoSangre` requerido desde 2026-09-07. */
export interface InfoMedicaInput {
  tieneCondicionMedica: boolean;
  tipoSangre: string;
  padecimiento?: string;
  medicamentos?: string;
  alergias?: string;
  tratamientoAdicional?: string;
}

/**
 * Espejo de `PerfilAdministrativoDto` (backend) SIN `nivelPermiso` — el
 * backend lo fuerza server-side (SUPER_ADMIN para director, ADMIN para
 * administrativo, ver `SedesService.crearConFundadores`), el cliente nunca
 * lo manda para este flujo.
 */
export interface FundadorInput {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno?: string;
  curp: string;
  correoPersonal: string;
  telefono: string;
  /** ISO date (`YYYY-MM-DD`). */
  fechaContratacion: string;
  puesto: string;
  contactos: ContactoInput[];
  infoMedica: InfoMedicaInput;
}

export interface CrearSedeConFundadoresInput {
  sede: SedeInput;
  director: FundadorInput;
  administrativo: FundadorInput;
}

/** Espejo de `UsuarioAltaResult`/`AltaPersonaResult` (backend, `personas.service.ts`). */
export interface FundadorAltaResult {
  usuario: { id: string; email: string; rol: string; sedeId: string };
  temporaryPassword: string;
}

export interface CrearSedeConFundadoresResult {
  sede: Sede;
  director: FundadorAltaResult;
  /** `null` si el alta del administrativo falló (best-effort, ver `advertenciaAdministrativo`). */
  administrativo: FundadorAltaResult | null;
  advertenciaAdministrativo?: string;
}

export function crearSedeConFundadores(
  input: CrearSedeConFundadoresInput,
): Promise<CrearSedeConFundadoresResult> {
  return platformFetch<CrearSedeConFundadoresResult>('/sedes', {
    method: 'POST',
    body: JSON.stringify(input),
  });
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
