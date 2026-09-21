import { apiFetchAuth, apiFetchAuthPaginado, type ApiListaPaginada } from './http';

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
 *
 * `email` (raíz de `CrearAlumnoInput`/`CrearMaestroInput`/
 * `CrearAdministrativoInput`) y `perfilAlumno.matricula` (2026-08-18) YA NO
 * los captura el cliente — el backend los genera y responde `400
 * VALIDATION_ERROR` (`forbidNonWhitelisted`) si se mandan. El login generado
 * viaja de vuelta en `AltaPersonaResult.usuario.email`; la matrícula
 * generada (solo alumno) en `AltaPersonaResult.matricula`.
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
 * Espejo del enum `TipoSangre` (`schema.prisma`, 2026-09-07) — Prisma no
 * permite `+`/`-` en nombres de enum, el label legible vive solo en
 * `InfoMedicaFieldset.tsx`.
 */
export type TipoSangre =
  | 'A_POSITIVO'
  | 'A_NEGATIVO'
  | 'B_POSITIVO'
  | 'B_NEGATIVO'
  | 'AB_POSITIVO'
  | 'AB_NEGATIVO'
  | 'O_POSITIVO'
  | 'O_NEGATIVO';

/**
 * Idéntico para los 3 roles (espejo de `InfoMedicaAlumno`/`InfoMedicaMaestro`/
 * `InfoMedicaAdministrativo`, `schema.prisma`, y de `InfoMedicaDto`,
 * backend). Los 4 campos opcionales típicamente solo tienen sentido si
 * `tieneCondicionMedica` es `true` (criterio de UX en cada `page.tsx`).
 * `tipoSangre` (2026-09-07) es REQUERIDO — `InfoMedicaDto.tipoSangre` no
 * tiene `@IsOptional` en el backend, independiente de `tieneCondicionMedica`.
 */
export interface InfoMedicaInput {
  tieneCondicionMedica: boolean;
  tipoSangre: TipoSangre;
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
  correoPersonal: string;
  carreraId: string;
  periodoIngreso: string;
  cuatrimestreActual: number;
  telefono?: string;
  /** 1-3 elementos — `ContactoAlumnoDto` (con `tipo`), exclusivo de alumno. */
  contactos: ContactoAlumnoInput[];
  infoMedica: InfoMedicaInput;
}

export interface CrearAlumnoInput {
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

/**
 * Espejo de `TipoContratacion` (`schema.prisma`, 2026-09-07) — tipo de
 * contratación del maestro. El backend (`PerfilMaestroDto`) exige campos
 * condicionales según el valor: `TEMPORAL` → `diasTemporal`; `CONTRATO` →
 * `contratoFechaInicio` + `contratoFechaFin` (rechaza con `400
 * VALIDATION_ERROR` si `contratoFechaFin <= contratoFechaInicio`); `BASE` →
 * ninguno.
 */
export type TipoContratacion = 'BASE' | 'TEMPORAL' | 'CONTRATO';

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
  tipoContratacion: TipoContratacion;
  /** Requerido solo si `tipoContratacion === 'TEMPORAL'` — entero ≥ 1. */
  diasTemporal?: number;
  /** Requerido solo si `tipoContratacion === 'CONTRATO'` — ISO date (`YYYY-MM-DD`). */
  contratoFechaInicio?: string;
  /** Requerido solo si `tipoContratacion === 'CONTRATO'` — ISO date (`YYYY-MM-DD`). */
  contratoFechaFin?: string;
  /** 1-3 elementos — `ContactoDto` (sin `tipo`). */
  contactos: ContactoInput[];
  infoMedica: InfoMedicaInput;
}

export interface CrearMaestroInput {
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
  /** Solo presente si `rol === 'ALUMNO'` — matrícula generada por el backend. */
  matricula?: string;
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

/**
 * `GET /personas?rol=ALUMNO|MAESTRO&...` — Fase 5, Día 19.
 *
 * "Listados PARA administrativos" (que un `ADMINISTRATIVO` consulta, de
 * `ALUMNO`/`MAESTRO` — NO un listado de `ADMINISTRATIVO` mismos, fuera de
 * alcance de este día). Shape espejo de
 * `App/backend/src/personas/personas.service.ts`
 * (`PersonaListItemAlumno`/`PersonaListItemMaestro`/`ListarPersonasResult`) —
 * mantener en sync a mano, mismo criterio que el resto de este archivo.
 *
 * Mismo patrón que `crearAlumno`/`crearMaestro`/`crearAdministrativo` arriba:
 * cada `listar<Rol>()` fija su propio `rol`, no se expone como parámetro
 * editable — evita que el caller arme un `rol=ADMINISTRATIVO` inválido
 * (el backend lo rechazaría con 400 `VALIDATION_ERROR`, pero mejor no dejar
 * ni la posibilidad en el tipo).
 *
 * `sedeId` NO es un parámetro acá — igual que `listarCarreras`
 * (`lib/api/carreras.ts`), el backend lo saca del JWT (`@SedeActual()`,
 * regla 2 de `CLAUDE.md` raíz), nunca de query.
 *
 * Sin `contactos`/`infoMedica` — listado resumen para tabla, no el perfil
 * completo (eso es `GET /perfil`, `lib/api/perfil.ts`).
 */
export interface ListarPersonasParams {
  buscar?: string;
  /** Valor del enum correspondiente al rol (`EstatusAcademico` para
   * `listarAlumnos`, `EstatusEmpleado` para `listarMaestros`) — se manda tal
   * cual como `string`, el backend valida contra el enum real. */
  estatus?: string;
  /** Default backend: 1. */
  page?: number;
  /** Default backend: 20, máximo 100. */
  limit?: number;
}

/** Espejo de `EstatusAcademico` (`schema.prisma`) — duplicado a propósito de
 * `lib/api/perfil.ts` (mismo criterio que `PuestoAdministrativo`/
 * `NivelPermiso` ya duplicados en este archivo: cada `lib/api/*.ts` mantiene
 * su propia copia en vez de cruzar imports entre módulos de API). */
export type EstatusAcademico =
  | 'INSCRITO'
  | 'BAJA_TEMPORAL'
  | 'BAJA_DEFINITIVA'
  | 'EGRESADO';

/** Espejo de `EstatusEmpleado` (`schema.prisma`) — usado por `listarMaestros`. */
export type EstatusEmpleado = 'ACTIVO' | 'BAJA' | 'LICENCIA';

export interface PersonaListItemAlumno {
  usuarioId: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  matricula: string;
  carrera: { id: string; nombre: string };
  estatusAcademico: EstatusAcademico;
  cuatrimestreActual: number;
  /** `Usuario.activo` (regla 3 de `CLAUDE.md` raíz — baja lógica, nunca se
   * oculta la fila, se muestra distinguida). */
  activo: boolean;
  /** URL firmada de Supabase Storage, o `null` si no tiene foto subida
   * (feature "Foto de perfil", 2026-09-17). */
  fotoUrl: string | null;
}

export interface PersonaListItemMaestro {
  usuarioId: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  cedulaProfesional: string | null;
  estatus: EstatusEmpleado;
  /** Solo tiene valor si `estatus === 'LICENCIA'` (tooltip del badge de
   * estatus, feature estética 2026-08-27) — `null` en cualquier otro
   * estatus. */
  tipoLicencia: TipoLicencia | null;
  /** Tipo de contratación del maestro (2026-09-07) — `null` para maestros
   * de altas previas al 2026-09-07 (espejo del backend). */
  tipoContratacion: TipoContratacion | null;
  /** Días de la contratación temporal — solo con `tipoContratacion ===
   * 'TEMPORAL'`; `null` en otro caso o en altas previas al 2026-09-07. */
  diasTemporal: number | null;
  /** ISO date (`YYYY-MM-DD`) — solo con `tipoContratacion === 'CONTRATO'`;
   * `null` en otro caso o en altas previas al 2026-09-07. */
  contratoFechaInicio: string | null;
  /** ISO date (`YYYY-MM-DD`) — solo con `tipoContratacion === 'CONTRATO'`;
   * `null` en otro caso o en altas previas al 2026-09-07. */
  contratoFechaFin: string | null;
  activo: boolean;
  /** URL firmada de Supabase Storage, o `null` si no tiene foto subida
   * (feature "Foto de perfil", 2026-09-17). */
  fotoUrl: string | null;
}

/**
 * `GET /personas?rol=ADMINISTRATIVO&...` (Fase 10, unificación CRUD admin) —
 * espejo de `PersonaListItemAdministrativo`
 * (`App/backend/src/personas/personas.service.ts`). Mismo shape resumen que
 * `PersonaListItemMaestro`, sin un identificador externo equivalente a
 * `cedulaProfesional`/`matricula` (`PerfilAdministrativo` no tiene uno en el
 * schema, no se inventa acá).
 */
export interface PersonaListItemAdministrativo {
  usuarioId: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  puesto: PuestoAdministrativo;
  nivelPermiso: NivelPermiso;
  estatus: EstatusEmpleado;
  /** Solo tiene valor si `estatus === 'LICENCIA'` (tooltip del badge de
   * estatus, feature estética 2026-08-26) — `null` en cualquier otro
   * estatus. */
  tipoLicencia: TipoLicencia | null;
  activo: boolean;
  /** URL firmada de Supabase Storage, o `null` si no tiene foto subida
   * (feature "Foto de perfil", 2026-09-17). */
  fotoUrl: string | null;
}

function construirQueryString(
  params: Record<string, string | number | undefined>,
): string {
  const sp = new URLSearchParams();
  for (const [clave, valor] of Object.entries(params)) {
    if (valor !== undefined && valor !== '') {
      sp.set(clave, String(valor));
    }
  }
  const query = sp.toString();
  return query ? `?${query}` : '';
}

export function listarAlumnos(
  params: ListarPersonasParams,
): Promise<ApiListaPaginada<PersonaListItemAlumno>> {
  const query = construirQueryString({ rol: 'ALUMNO', ...params });
  return apiFetchAuthPaginado<PersonaListItemAlumno>(`/personas${query}`);
}

export function listarMaestros(
  params: ListarPersonasParams,
): Promise<ApiListaPaginada<PersonaListItemMaestro>> {
  const query = construirQueryString({ rol: 'MAESTRO', ...params });
  return apiFetchAuthPaginado<PersonaListItemMaestro>(`/personas${query}`);
}

/**
 * `listarAdministrativos` — Fase 10 (unificación CRUD admin). Mismo patrón
 * que `listarMaestros`: fija `rol: 'ADMINISTRATIVO'`, no se expone como
 * parámetro editable.
 */
export function listarAdministrativos(
  params: ListarPersonasParams,
): Promise<ApiListaPaginada<PersonaListItemAdministrativo>> {
  const query = construirQueryString({ rol: 'ADMINISTRATIVO', ...params });
  return apiFetchAuthPaginado<PersonaListItemAdministrativo>(
    `/personas${query}`,
  );
}

/** Espejo de `TipoLicencia` (`schema.prisma`) — solo aplica cuando
 * `estatus: 'LICENCIA'` en `PATCH /personas/:id/estatus`. */
export type TipoLicencia =
  | 'VACACIONES'
  | 'INCAPACIDAD_ENFERMEDAD_GENERAL'
  | 'INCAPACIDAD_RIESGO_TRABAJO'
  | 'MATERNIDAD'
  | 'PATERNIDAD'
  | 'ADOPCION'
  | 'PERMISO_CON_GOCE_SUELDO'
  | 'PERMISO_SIN_GOCE_SUELDO'
  | 'OTRO';

/** Espejo de `MotivoBaja` (`schema.prisma`) — solo aplica cuando
 * `estatus: 'BAJA'` en `PATCH /personas/:id/estatus`. */
export type MotivoBaja =
  | 'RENUNCIA'
  | 'DESPIDO'
  | 'BAJA_TEMPORAL_SALUD'
  | 'FALLECIMIENTO'
  | 'TERMINACION_INCAPACIDAD_PERMANENTE'
  | 'OTRO';

/**
 * `PATCH /personas/:id/estatus` (Fase 10, unificación CRUD admin; extendido
 * en el plan "estatus avanzado y borrado de grupos", 2026-08-26) — cambio
 * de estatus genérico (regla 3 de `CLAUDE.md` raíz, baja lógica). `id` es el
 * `Usuario` objetivo — `sedeId`/`actorUsuarioId` los resuelve el backend del
 * JWT, nunca acá. `estatus` viaja tal cual como `string` (el valor real del
 * enum correspondiente al rol del objetivo — `EstatusEmpleado` para el único
 * consumidor de hoy, `app/admin/administrativos/page.tsx`); el backend
 * valida contra el enum correcto según el `rol` del `Usuario` objetivo.
 * `extra.tipoLicencia`/`extra.motivoBaja` son opcionales — el backend los
 * valida contra `TipoLicencia`/`MotivoBaja` siempre que vengan presentes, y
 * revoca `Usuario.activo` automáticamente solo cuando `estatus: 'BAJA'` y
 * `motivoBaja` es `'RENUNCIA'` o `'DESPIDO'`.
 */
export function cambiarEstatusPersona(
  usuarioId: string,
  estatus: string,
  extra?: { tipoLicencia?: string; motivoBaja?: string },
): Promise<{ ok: true }> {
  return apiFetchAuth<{ ok: true }>(`/personas/${usuarioId}/estatus`, {
    method: 'PATCH',
    body: JSON.stringify({ estatus, ...extra }),
  });
}

/**
 * `POST /personas/:id/resetear-password` — dispara el envío de un enlace de
 * restablecimiento al correo personal de la persona (`usuarioId`). Sin
 * body — el backend resuelve todo desde `:id` + el JWT del actor. Sin
 * cooldown en esta capa — lo maneja `useCooldownReseteo` en el componente.
 */
export function resetearPasswordPersona(usuarioId: string): Promise<{ ok: true }> {
  return apiFetchAuth<{ ok: true }>(`/personas/${usuarioId}/resetear-password`, {
    method: 'POST',
  });
}

/**
 * `GET/PATCH /personas/:id` — feature "Edición de datos de persona"
 * (2026-09-20). Shape espejo de `PersonaParaEditar`/`PersonaEditableAlumno`/
 * `PersonaEditableMaestro`/`PersonaEditableAdministrativo`/
 * `PersonaEditableContacto`/`PersonaEditableInfoMedica`
 * (`App/backend/src/personas/personas.service.ts`) para el `GET`, y de
 * `EditarPersonaDto` (que reusa `PerfilAlumnoDto`/`PerfilMaestroDto`/
 * `PerfilAdministrativoDto` de `crear-persona.dto.ts`, backend) para el
 * `PATCH` — mismo shape que `CrearAlumnoInput`/`CrearMaestroInput`/
 * `CrearAdministrativoInput` de este mismo archivo, SIN `matricula`/`email`
 * (inmutables, ver spec) y sin `nivelPermiso` opcional-con-default (acá si
 * cambia se audita `CAMBIO_PERMISO`, ver backend).
 */
export interface PersonaEditableContacto {
  nombre: string;
  telefono: string;
  correo: string | null;
  parentesco: string;
  tipo?: TipoContacto;
}

export interface PersonaEditableInfoMedica {
  tieneCondicionMedica: boolean;
  tipoSangre: TipoSangre | null;
  padecimiento: string | null;
  medicamentos: string | null;
  alergias: string | null;
  tratamientoAdicional: string | null;
}

export interface PersonaEditableAlumno {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  curp: string | null;
  /** ISO date (`YYYY-MM-DD`). */
  fechaNacimiento: string;
  correoPersonal: string;
  carreraId: string;
  periodoIngreso: string;
  cuatrimestreActual: number;
  telefono: string | null;
}

export interface PersonaEditableMaestro {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  curp: string;
  cedulaProfesional: string | null;
  correoPersonal: string;
  telefono: string;
  fechaContratacion: string;
  tipoContratacion: TipoContratacion | null;
  diasTemporal: number | null;
  contratoFechaInicio: string | null;
  contratoFechaFin: string | null;
}

export interface PersonaEditableAdministrativo {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  curp: string;
  correoPersonal: string;
  telefono: string;
  fechaContratacion: string;
  puesto: PuestoAdministrativo;
  nivelPermiso: NivelPermiso;
}

export interface PersonaParaEditar {
  rol: 'ALUMNO' | 'MAESTRO' | 'ADMINISTRATIVO';
  codigoExterno: string | null;
  perfilAlumno?: PersonaEditableAlumno;
  perfilMaestro?: PersonaEditableMaestro;
  perfilAdministrativo?: PersonaEditableAdministrativo;
  contactos: PersonaEditableContacto[];
  infoMedica: PersonaEditableInfoMedica;
}

export function obtenerPersonaParaEditar(
  usuarioId: string,
): Promise<PersonaParaEditar> {
  return apiFetchAuth<PersonaParaEditar>(`/personas/${usuarioId}`);
}

export interface EditarPersonaInput {
  codigoExterno?: string;
  perfilAlumno?: PerfilAlumnoInput;
  perfilMaestro?: PerfilMaestroInput;
  perfilAdministrativo?: PerfilAdministrativoInput;
}

export function editarPersona(
  usuarioId: string,
  input: EditarPersonaInput,
): Promise<{ ok: true }> {
  return apiFetchAuth<{ ok: true }>(`/personas/${usuarioId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
