import { platformFetch } from './platform-http';

/** Espejo de `model Sede` (`schema.prisma`) tal como lo devuelve el backend. */
export interface Sede {
  id: string;
  nombre: string;
  direccion: string;
  ubicacionReferencia: string;
  telefono: string;
  costoRenta: string | null; // Prisma Decimal serializa como string en JSON
  activa: boolean;
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

/**
 * @deprecated Reemplazada por `crearSedeConFundadores` desde 2026-09-11 —
 * `POST /sedes` ya no acepta el body plano. Se conserva sin borrar por si
 * algo más la referencia; confirma antes de borrar de verdad.
 */
export function crearSede(input: SedeInput): Promise<Sede> {
  return platformFetch<Sede>('/sedes', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * `activa` no es parte de `SedeInput` (ese tipo son los campos capturables
 * al crear/editar una sede) — es un flag de estado separado, editable desde
 * `SedeModal` para reactivar una sede sin pasar por el flujo de
 * alumnos/personal de `DELETE /sedes/:id`.
 */
export function actualizarSede(
  id: string,
  input: Partial<SedeInput> & { activa?: boolean },
): Promise<Sede> {
  return platformFetch<Sede>(`/sedes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/**
 * `eliminacionReal` (2026-09-11, `DELETE /sedes/:id` deja de bloquear con
 * 409 cuando la sede tiene datos asociados) distingue el borrado real
 * (`true`, sin datos asociados) de la baja lógica (`false`, `Sede.activa`
 * pasó a `false` en vez de borrarse la fila).
 */
export function eliminarSede(id: string): Promise<{ ok: true; eliminacionReal: boolean }> {
  return platformFetch<{ ok: true; eliminacionReal: boolean }>(`/sedes/${id}`, {
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
