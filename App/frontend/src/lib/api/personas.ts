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
  semestreActual: number;
  /** `Usuario.activo` (regla 3 de `CLAUDE.md` raíz — baja lógica, nunca se
   * oculta la fila, se muestra distinguida). */
  activo: boolean;
}

export interface PersonaListItemMaestro {
  usuarioId: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  cedulaProfesional: string | null;
  estatus: EstatusEmpleado;
  activo: boolean;
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
