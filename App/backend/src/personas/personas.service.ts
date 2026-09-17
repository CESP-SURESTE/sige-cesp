import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  AccionAuditoria,
  EstatusAcademico,
  EstatusEmpleado,
  MotivoBaja,
  NivelPermiso,
  Prisma,
  RolUsuario,
  TipoContratacion,
  TipoLicencia,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  CrearPersonaDto,
  InfoMedicaDto,
  PerfilMaestroDto,
} from './dto/crear-persona.dto';
import { ListarPersonasQueryDto } from './dto/listar-personas.query.dto';
import { generateTemporaryPassword } from './temporary-password';
import { obtenerCorreosPersonales } from '../common/publicacion/correos-destinatarios.util';

export interface PersonaListItemAlumno {
  usuarioId: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  matricula: string;
  carrera: { id: string; nombre: string };
  estatusAcademico: EstatusAcademico;
  cuatrimestreActual: number;
  activo: boolean;
}

export interface PersonaListItemMaestro {
  usuarioId: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  cedulaProfesional: string | null;
  estatus: EstatusEmpleado;
  /** Solo tiene valor si `estatus === 'LICENCIA'` (feature estética,
   * 2026-08-27 — tooltip del badge de estatus en el listado de maestros,
   * paridad con `PersonaListItemAdministrativo`). `null` en cualquier otro
   * estatus, incluyendo el rastro histórico de una licencia pasada (no se
   * limpia al reactivar, ver Contrato de API de `PATCH /personas/:id/estatus`)
   * — el frontend solo lo muestra cuando el estatus actual es LICENCIA. */
  tipoLicencia: TipoLicencia | null;
  /** Tipo de contratación y sus campos condicionales (2026-09-07 — paridad
   * con `GET /perfil` y `POST /personas`, ahora también en el listado del
   * admin). `null` para maestros de altas anteriores al 2026-09-07 (columnas
   * nullable, sin backfill). `diasTemporal` solo tiene valor si
   * `tipoContratacion === 'TEMPORAL'`; `contratoFechaInicio`/`contratoFechaFin`
   * solo si `=== 'CONTRATO'` (fechas ISO `YYYY-MM-DD`). */
  tipoContratacion: TipoContratacion | null;
  diasTemporal: number | null;
  contratoFechaInicio: string | null;
  contratoFechaFin: string | null;
  activo: boolean;
}

/**
 * `GET /personas?rol=ADMINISTRATIVO` (Fase 10, unificación CRUD admin) —
 * mismo shape resumen que `PersonaListItemMaestro`, sin un identificador
 * externo equivalente a `cedulaProfesional`/`matricula` (`PerfilAdministrativo`
 * no tiene uno en el schema, no se inventa acá).
 */
export interface PersonaListItemAdministrativo {
  usuarioId: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  puesto: string;
  nivelPermiso: NivelPermiso;
  estatus: EstatusEmpleado;
  /** Solo tiene valor si `estatus === 'LICENCIA'` (feature estética,
   * 2026-08-26 — tooltip del badge de estatus en el listado). `null` en
   * cualquier otro estatus, incluyendo el rastro histórico de una licencia
   * pasada (no se limpia al reactivar, ver Contrato de API de
   * `PATCH /personas/:id/estatus`) — el frontend solo lo muestra cuando el
   * estatus actual es LICENCIA. */
  tipoLicencia: TipoLicencia | null;
  activo: boolean;
}

export interface ListarPersonasResult {
  data:
    | PersonaListItemAlumno[]
    | PersonaListItemMaestro[]
    | PersonaListItemAdministrativo[];
  page: number;
  limit: number;
  total: number;
}

/** `GET /personas/resumen` — dashboard de admin por sede. */
export interface AlumnosPorCarreraItem {
  carreraId: string;
  nombre: string;
  cantidad: number;
}

/** `GET /personas/resumen` — dashboard de admin por sede. */
export interface AltaRecienteItem {
  usuarioId: string;
  nombreCompleto: string;
  rol: RolUsuario;
  fecha: string;
}

/** `GET /personas/resumen` — dashboard de admin por sede. */
export interface ResumenPorSedeResult {
  totalAlumnosActivos: number;
  totalMaestrosActivos: number;
  totalAdministrativosActivos: number;
  totalCarreras: number;
  alumnosPorCarrera: AlumnosPorCarreraItem[];
  altasRecientes: AltaRecienteItem[];
}

/**
 * `@supabase/server` (y `jose`, del que depende) son paquetes ESM-only —
 * mismo motivo/solución que `src/common/guards/sede.guard.ts` y
 * `src/auth/auth.service.ts` (leer el comentario completo en cualquiera de
 * los dos): `import()` dinámico + caché a nivel de módulo.
 *
 * Se duplica acá el mismo patrón de caché en vez de extraerlo a un helper
 * compartido — es exactamente lo que ya hacen `sede.guard.ts` y
 * `auth.service.ts` entre sí (dos copias casi idénticas, no una sola
 * extraída), mismo criterio de esta base de código: cada archivo que
 * necesita `createAdminClient()` cachea su propia referencia. Ver el
 * encargo de Día 11: "reutilízalo, no inventes un mecanismo nuevo" — el
 * mecanismo (import() dinámico + caché) es el mismo, solo vive en dos
 * archivos como ya era el caso antes de este cambio.
 */
type CreateAdminClientFn =
  typeof import('@supabase/server/core').createAdminClient;
type SupabaseAdminClient = ReturnType<CreateAdminClientFn>;

let createAdminClientFn: CreateAdminClientFn | undefined;

async function getCreateAdminClient(): Promise<CreateAdminClientFn> {
  if (!createAdminClientFn) {
    const core = await import('@supabase/server/core');
    createAdminClientFn =
      core.createAdminClient as unknown as CreateAdminClientFn;
  }
  return createAdminClientFn;
}

/**
 * Token de inyección para overridear, en tests, el cliente de Supabase que
 * usa `PersonasService` — mismo patrón que `AUTH_SUPABASE_CLIENT_OVERRIDE`
 * (`auth.service.ts`). `undefined` por default (producción): el service cae
 * a `createAdminClient()` real.
 */
export const PERSONAS_SUPABASE_CLIENT_OVERRIDE =
  'PERSONAS_SUPABASE_CLIENT_OVERRIDE';

export interface UsuarioAltaResult {
  id: string;
  email: string;
  rol: RolUsuario;
  sedeId: string;
  codigoExterno: string | null;
  primerIngreso: boolean;
  activo: boolean;
}

export interface AltaPersonaResult {
  usuario: UsuarioAltaResult;
  temporaryPassword: string;
  /**
   * Matrícula generada automáticamente (feature 2026-08-18) — SOLO presente
   * cuando `rol === ALUMNO`; `undefined` para MAESTRO/ADMINISTRATIVO. Ver
   * `PersonasService.generarLoginAlumno`.
   */
  matricula?: string;
  /**
   * Login generado automáticamente (feature 2026-08-18, extensión del mismo
   * día) — SIEMPRE presente, para los 3 roles. Mismo valor que
   * `usuario.email` (duplicado a propósito a nivel raíz de `data`, junto a
   * `matricula`/`temporaryPassword` — mismo nivel que esos 2 campos, para
   * que el frontend no tenga que ir a buscarlo dentro de `usuario` para el
   * panel de "resultado del alta" que ya muestra esos otros 2 campos).
   */
  email: string;
}

/**
 * `PersonasService` — Fase 4, Día 11.
 *
 * Alta transaccional de personas (regla 9 de CLAUDE.md raíz): Supabase Auth
 * (Admin API) → `Usuario` → perfil correspondiente al `rol`, con rollback si
 * falla cualquier paso.
 *
 * Postgres (vía `PrismaService.$transaction`) y Supabase Auth son dos
 * sistemas distintos — no hay transacción distribuida real entre ambos. Si
 * falla el insert de Postgres DESPUÉS de haber creado el usuario en Supabase
 * Auth, se compensa borrando ese usuario de Auth a mano
 * (`client.auth.admin.deleteUser`). Si falla la creación en Supabase Auth,
 * no hay nada que limpiar en Postgres (no se llegó a insertar).
 */
@Injectable()
export class PersonasService {
  /**
   * Jerarquía de `PerfilAdministrativo.nivelPermiso` (regla 7 de CLAUDE.md
   * raíz) — cuanto más alto el número, más privilegio. Usada únicamente para
   * el alta de personas con `rol: ADMINISTRATIVO` (ver
   * `verificarJerarquiaNivelPermiso` abajo); NO reemplaza al futuro guard de
   * `NivelPermiso` que aplicaría esta misma jerarquía a otras rutas
   * (ej. PATCH de `PermisoAdministrativo`) — ese sigue fuera de alcance acá.
   */
  private static readonly JERARQUIA_NIVEL_PERMISO: Record<
    NivelPermiso,
    number
  > = {
    [NivelPermiso.AUXILIAR]: 0,
    [NivelPermiso.ADMIN]: 1,
    [NivelPermiso.SUPER_ADMIN]: 2,
  };

  /**
   * `MOTIVO_BAJA_REVOCA` — motivos de `BAJA` que extinguen la relación laboral
   * (arts. 47 y 53 LFT) y por tanto revocan el acceso (`Usuario.activo = false`):
   * - RENUNCIA / DESPIDO — terminación por voluntad del trabajador / rescisión (art. 47)
   * - FALLECIMIENTO — art. 53 fr. II
   * - TERMINACION_INCAPACIDAD_PERMANENTE — art. 53 fr. IV
   *
   * `BAJA_TEMPORAL_SALUD` (suspensión, art. 42) y `OTRO` (sin clasificar) NO
   * revocan: la baja es cosmética hasta que se elija un motivo de terminación
   * explícito. Fail-safe: cortar acceso es una acción deliberada del admin.
   *
   * Es un `Record<MotivoBaja, boolean>` (no un `Set`) a propósito: TS obliga a
   * clasificar explícitamente cualquier valor nuevo del enum antes de compilar.
   */
  private static readonly MOTIVO_BAJA_REVOCA: Record<MotivoBaja, boolean> = {
    // Terminación de la relación laboral (arts. 47 y 53 LFT) — revocan acceso:
    [MotivoBaja.RENUNCIA]: true, // terminación por voluntad del trabajador
    [MotivoBaja.DESPIDO]: true, // rescisión sin responsabilidad para el patrón (art. 47)
    [MotivoBaja.FALLECIMIENTO]: true, // art. 53 fr. II
    [MotivoBaja.TERMINACION_INCAPACIDAD_PERMANENTE]: true, // art. 53 fr. IV
    // Suspensión (art. 42) / sin clasificar — NO revocan (fail-safe):
    [MotivoBaja.BAJA_TEMPORAL_SALUD]: false,
    [MotivoBaja.OTRO]: false,
  };

  /**
   * Dominio placeholder del login sintético (feature 2026-08-18) — UN SOLO
   * dominio fijo para los 3 roles (pedido explícito: "no hace falta uno
   * distinto por rol ni por sede"). No es un buzón real — nadie recibe
   * correo ahí, es solo el identificador de acceso (`Usuario.email`), así
   * que el dominio no necesita ser deliverable de verdad. Elegido
   * `acceso.cesp.edu.mx` (subdominio ficticio de CESP, sin conflicto con el
   * dominio real que Mailgun use más adelante para el correo de
   * bienvenida — ver `MailService`) — documentado acá como la decisión
   * final, no hace falta configurarlo por env var (no es un dato sensible
   * ni cambia por entorno).
   */
  private static readonly DOMINIO_LOGIN = 'acceso.cesp.edu.mx';

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    @Optional()
    @Inject(PERSONAS_SUPABASE_CLIENT_OVERRIDE)
    private readonly clientOverride?: SupabaseAdminClient,
  ) {}

  private async getClient(): Promise<SupabaseAdminClient> {
    if (this.clientOverride) {
      return this.clientOverride;
    }
    const createAdminClient = await getCreateAdminClient();
    return createAdminClient();
  }

  /**
   * Contactos de emergencia + datos de salud — extensión del alta transaccional
   * (decisión explícita del usuario, 2026-08-12: "que sea en la misma
   * transacción ya que todo se debe cargar a la vez"). Regla 4 de CLAUDE.md
   * raíz: lógica compartida en un service, no duplicada 3 veces por rol.
   *
   * Prisma no permite pasar el nombre de un modelo como variable sin perder
   * el tipado (`tx[nombreModelo]` no compila con seguridad de tipos, y un
   * callback genérico `(data: TData) => tx.contactoX.create({ data })`
   * tampoco infiere bien el `XOR<...CreateInput, ...UncheckedCreateInput>`
   * que genera Prisma por modelo — se intentó y `tsc` lo rechaza). El
   * approach que sí queda limpio y sigue evitando la triplicación: un solo
   * helper (`conOrdenSecuencial`) centraliza la única lógica realmente
   * compartida — asignar `orden` secuencial a partir de la posición en el
   * array (regla 1, nunca lo manda el cliente) — y cada caller solo hace el
   * `for` + el `create` con el delegate real de su propio modelo.
   */
  private conOrdenSecuencial<T>(items: T[]): Array<T & { orden: number }> {
    return items.map((item, i) => ({ ...item, orden: i + 1 }));
  }

  /**
   * `InfoMedicaAlumno`/`InfoMedicaMaestro`/`InfoMedicaAdministrativo` son
   * idénticos entre sí en `schema.prisma` — un solo helper que arma los
   * campos comunes; cada caller le agrega solo la FK (`alumnoId`/
   * `maestroId`/`administrativoId`) que sí difiere entre modelos.
   */
  private datosInfoMedica(infoMedica: InfoMedicaDto) {
    return {
      tieneCondicionMedica: infoMedica.tieneCondicionMedica,
      padecimiento: infoMedica.padecimiento,
      medicamentos: infoMedica.medicamentos,
      alergias: infoMedica.alergias,
      tratamientoAdicional: infoMedica.tratamientoAdicional,
      tipoSangre: infoMedica.tipoSangre,
    };
  }

  /**
   * Tipo de contratación del maestro (2026-09-07) — `tipoContratacion` es
   * siempre requerido; los 3 campos condicionales solo traen valor según el
   * tipo (`diasTemporal` si TEMPORAL, `contratoFecha*` si CONTRATO), en
   * cualquier otro caso quedan `null`. El DTO ya validó forma/tipo
   * (`@ValidateIf`) y `PersonasService.altaPersona` la regla cruzada de
   * fechas antes de llegar acá. `contratoFecha*` son `string` ISO en el DTO
   * y `DateTime?` en el schema — se convierten con `new Date(...)`.
   */
  private datosContratacionMaestro(perfil: PerfilMaestroDto) {
    const esTemporal = perfil.tipoContratacion === TipoContratacion.TEMPORAL;
    const esContrato = perfil.tipoContratacion === TipoContratacion.CONTRATO;
    return {
      tipoContratacion: perfil.tipoContratacion,
      diasTemporal: esTemporal ? (perfil.diasTemporal ?? null) : null,
      contratoFechaInicio:
        esContrato && perfil.contratoFechaInicio
          ? new Date(perfil.contratoFechaInicio)
          : null,
      contratoFechaFin:
        esContrato && perfil.contratoFechaFin
          ? new Date(perfil.contratoFechaFin)
          : null,
    };
  }

  /**
   * Generación automática de `matricula` (feature 2026-08-18) —
   * `PerfilAlumno.matricula` dejó de ser texto libre capturado por el admin
   * (`docs/modelo-datos.md` ya lo documentaba así desde el diseño original:
   * "generada por el sistema al dar de alta", la implementación real no lo
   * hacía hasta hoy).
   *
   * Formato: `A` + año REAL del servidor (`new Date().getFullYear()`, 4
   * dígitos — NO `dto.perfilAlumno.periodoIngreso`, que es texto libre sin
   * validar capturado por el admin) + 5 dígitos secuenciales con ceros a la
   * izquierda (`A202600001` .. `A202699999`).
   *
   * Secuencia GLOBAL (todas las sedes comparten la misma, no hay una por
   * sede/carrera) y CONTINUA durante el año (nunca se reinicia dentro del
   * mismo año, solo al cambiar de año). `ContadorMatricula` (`schema.prisma`)
   * es una tabla contador dedicada con 1 fila por año (`anio` = PK).
   *
   * Atomicidad: `this.prisma.contadorMatricula.upsert(...)` con
   * `update: { ultimoNumero: { increment: 1 } }`. Prisma compila un `upsert`
   * contra una PK/unique de una sola columna en Postgres a un `INSERT ...
   * ON CONFLICT DO UPDATE ... RETURNING` nativo (atómico desde Prisma 4.6+
   * para Postgres/CockroachDB) — es una sola sentencia SQL, atómica por sí
   * misma sin necesitar un `$transaction` explícito que la envuelva; el lock
   * de fila que toma esa sentencia durante la resolución del conflicto es lo
   * que hace que dos altas concurrentes en el mismo año nunca obtengan el
   * mismo secuencial, incluso bajo el nivel de aislamiento default de
   * Postgres (READ COMMITTED). Por eso se evita a propósito el patrón "leer
   * la última matrícula y sumarle 1" (`findFirst` + `+1`) — ese patrón SÍ
   * tiene condición de carrera real bajo altas simultáneas.
   *
   * Se llama ANTES de la transacción principal de `altaPersona` (extensión
   * 2026-08-18, revisión del diseño original de la matrícula) — a
   * diferencia de la primera versión de esta feature, que la generaba
   * DENTRO del `$transaction` que crea `Usuario`/`PerfilAlumno`. El cambio
   * es necesario porque ahora el login (`Usuario.email`) del alumno se
   * DERIVA de la matrícula (`generarLoginAlumno` abajo) y Supabase Auth
   * necesita ese login ANTES de que exista la fila de `Usuario` en
   * Postgres — la llamada a Supabase Auth ocurre antes del `$transaction`,
   * así que la matrícula (y el login que depende de ella) también. Esto NO
   * compromete la atomicidad del contador (sigue siendo una sola sentencia
   * atómica); lo único que cambia es que, si la transacción principal falla
   * después y hace rollback, el número ya incrementado queda "saltado" (un
   * hueco en la secuencia) en vez de revertirse — aceptable, igual que un
   * `SERIAL` de Postgres: la unicidad importa, no la ausencia total de
   * huecos.
   */
  private async generarMatricula(): Promise<string> {
    const anio = new Date().getFullYear();

    const contador = await this.prisma.contadorMatricula.upsert({
      where: { anio },
      create: { anio, ultimoNumero: 1 },
      update: { ultimoNumero: { increment: 1 } },
    });

    const secuencial = contador.ultimoNumero.toString().padStart(5, '0');
    return `A${anio}${secuencial}`;
  }

  /**
   * Login del alumno (feature 2026-08-18, extensión de la matrícula) —
   * reutiliza la matrícula ya generada: `{matricula en minúsculas}@{dominio}`
   * (ej. `a202600001@acceso.cesp.edu.mx`). Como la matrícula ya es única por
   * construcción (`generarMatricula`), el login derivado de ella también lo
   * es — sin necesidad de una consulta de colisión adicional (a diferencia
   * de `generarLoginPersonal`, para MAESTRO/ADMINISTRATIVO, que sí necesita
   * checar colisiones porque no parte de un identificador ya único).
   */
  private generarLoginAlumno(matricula: string): string {
    return `${matricula.toLowerCase()}@${PersonasService.DOMINIO_LOGIN}`;
  }

  /**
   * Normaliza texto para usarlo como parte de un login (feature 2026-08-18)
   * — minúsculas, sin diacríticos (acentos/diéresis, vía `normalize('NFD')`
   * + strip de marcas combinantes) y solo `[a-z]` (sin espacios, sin
   * números, sin ningún otro caracter no-ASCII). "José" -> "jose",
   * "Bustamante-Ríos" -> "bustamanterios".
   */
  private normalizarParaLogin(texto: string): string {
    return texto
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z]/g, '');
  }

  /**
   * Login de MAESTRO/ADMINISTRATIVO (feature 2026-08-18) — mismo algoritmo
   * para ambos roles (pedido explícito): `{primernombre}{primera_letra del
   * apellidoPaterno}{contador}@{dominio}`. Ej. "Arturo Bustamante" ->
   * `arturob1@acceso.cesp.edu.mx`; un segundo "Arturo Bustamante" ->
   * `arturob2@acceso.cesp.edu.mx`.
   *
   * `primernombre`: SOLO la primera palabra de `nombres` (si es compuesto,
   * ej. "José Luis", usa solo "jose").
   *
   * El contador SIEMPRE está presente desde el primer registro (nunca
   * `arturob@...` sin número, aunque hoy sea único) — a propósito: si el
   * número solo apareciera al haber colisión, el día que llegue un segundo
   * "Arturo Bustamante" habría que renombrar el login del primero (rompe una
   * cuenta ya en uso). Con número desde el día uno, nunca hay que tocar una
   * cuenta existente.
   *
   * Implementación: se buscan en `Usuario.email` todos los logins que
   * empiezan con `base` y terminan en `@{dominio}` (`startsWith`/`endsWith`
   * de Postgres, sin regex en la query — Prisma/`pg` no necesitan eso para
   * un prefijo/sufijo simple), y en JS se filtran con una regex exacta
   * (`^{base}\d+@{dominio}$`) para descartar falsos positivos por prefijo
   * (ej. `base` "arturob" NO debe hacer match con un login real
   * "arturobalb1@..." de una persona distinta cuyo nombre normalizado
   * también empieza con esas letras — la regex exige que después de `base`
   * solo haya dígitos). El siguiente número es `máximo encontrado + 1`.
   *
   * Nota de robustez (no atómico como `generarMatricula`, a propósito no se
   * le puso una tabla contador dedicada): existe una ventana de carrera
   * angosta si dos altas con el MISMO nombre+inicial llegan casi al mismo
   * tiempo — ambas podrían calcular el mismo candidato. El backstop real es
   * la unicidad de `Usuario.email` (real, `@unique` en Postgres) + la
   * unicidad de email de Supabase Auth: si dos requests concurrentes
   * intentan crear el mismo login, Supabase Auth solo deja pasar la primera
   * (`email_exists`, ya manejado como 409 CONFLICT más abajo) — la segunda
   * falla con un error claro, no con datos corruptos ni un login duplicado
   * silencioso. Caso extremadamente improbable en la práctica (alta de
   * personal por un admin, no un flujo de registro masivo concurrente) —
   * mismo criterio de prioridad que la Observación 1 de QA — Día 21
   * (`Carrera.nombre` duplicado): documentado, no bloqueante.
   */
  private async generarLoginPersonal(
    nombres: string,
    apellidoPaterno: string,
  ): Promise<string> {
    const primerNombre = this.normalizarParaLogin(
      nombres.trim().split(/\s+/)[0] ?? '',
    );
    const inicialApellido = this.normalizarParaLogin(apellidoPaterno).charAt(0);
    const base = `${primerNombre}${inicialApellido}`;

    const candidatos = await this.prisma.usuario.findMany({
      where: {
        email: {
          startsWith: base,
          endsWith: `@${PersonasService.DOMINIO_LOGIN}`,
        },
      },
      select: { email: true },
    });

    const patron = new RegExp(
      `^${base}(\\d+)@${PersonasService.DOMINIO_LOGIN.replace(/\./g, '\\.')}$`,
    );
    let maxNumero = 0;
    for (const { email } of candidatos) {
      const match = patron.exec(email);
      if (match) {
        const numero = Number(match[1]);
        if (numero > maxNumero) {
          maxNumero = numero;
        }
      }
    }

    return `${base}${maxNumero + 1}@${PersonasService.DOMINIO_LOGIN}`;
  }

  /**
   * Sub-objeto de perfil correspondiente a `dto.rol` — helper compartido por
   * `nombreCompletoPara`/`correoPersonalPara` (feature 2026-08-18) para no
   * duplicar el mismo condicional 2 veces. Los 3 DTOs de perfil comparten
   * `nombres`/`apellidoPaterno`/`apellidoMaterno`/`correoPersonal`
   * estructuralmente (aunque son clases distintas), por eso TS deja acceder
   * a esos campos directo sobre el tipo unión sin necesitar un discriminador
   * adicional.
   */
  private perfilPara(dto: CrearPersonaDto) {
    return dto.rol === RolUsuario.ALUMNO
      ? dto.perfilAlumno
      : dto.rol === RolUsuario.MAESTRO
        ? dto.perfilMaestro
        : dto.perfilAdministrativo;
  }

  /**
   * Nombre completo para el saludo del correo de bienvenida (Día 13) — sale
   * del sub-objeto de perfil correspondiente a `dto.rol`. `apellidoMaterno`
   * es opcional en los 3 perfiles. El fallback (`perfil` ausente) es
   * puramente defensivo — el DTO + los pre-checks de `altaPersona` ya
   * garantizan que el perfil correspondiente al `rol` viene siempre; no
   * puede usar `dto.email` como antes (feature 2026-08-18: ya no existe ese
   * campo en el DTO).
   */
  private nombreCompletoPara(dto: CrearPersonaDto): string {
    const perfil = this.perfilPara(dto);

    if (!perfil) {
      return 'Usuario SIGE';
    }

    return [perfil.nombres, perfil.apellidoPaterno, perfil.apellidoMaterno]
      .filter(Boolean)
      .join(' ');
  }

  /**
   * Destino REAL del correo de bienvenida (feature 2026-08-18, cambio de
   * comportamiento) — `correoPersonal` del perfil correspondiente al `rol`,
   * para LOS 3 ROLES por igual, sin excepción ni lógica condicional por rol.
   * Antes se mandaba al login (`dto.email` / el login generado) — ya no
   * tiene sentido: el login ahora es sintético para los 3 roles (no es un
   * buzón real), así que `correoPersonal` es el único correo legible por un
   * humano. El fallback (`perfil` ausente) es igual de defensivo que
   * `nombreCompletoPara` — no debería ocurrir nunca en la práctica.
   */
  private correoPersonalPara(dto: CrearPersonaDto): string | undefined {
    return this.perfilPara(dto)?.correoPersonal;
  }

  /**
   * Regla 7 de CLAUDE.md raíz, extendida al alta (observación A de QA — Día
   * 11): un admin solo puede dar de alta personal `ADMINISTRATIVO` con un
   * `nivelPermiso` igual o por debajo del suyo propio.
   *
   * El JWT solo trae `rol` (ALUMNO/MAESTRO/ADMINISTRATIVO) — `nivelPermiso`
   * vive en `PerfilAdministrativo`, hay que consultarlo en DB con el
   * `usuarioId` del actor. Si el actor no tiene fila en `PerfilAdministrativo`
   * (caso raro: un `ADMINISTRATIVO` sin perfil), se trata como el nivel más
   * bajo (`AUXILIAR`) por seguridad — nunca se asume sin restricción.
   *
   * Un `AUXILIAR` no puede dar de alta a NINGÚN `ADMINISTRATIVO` (ni siquiera
   * otro `AUXILIAR`) — mismo espíritu de "un AUXILIAR no se escala a sí
   * mismo" de la regla 7, extendido a que tampoco escala a nadie más.
   */
  private async verificarJerarquiaNivelPermiso(
    actorUsuarioId: string,
    nivelPermisoNuevo: NivelPermiso,
  ): Promise<void> {
    const perfilActor = await this.prisma.perfilAdministrativo.findUnique({
      where: { usuarioId: actorUsuarioId },
      select: { nivelPermiso: true },
    });
    const nivelActor = perfilActor?.nivelPermiso ?? NivelPermiso.AUXILIAR;

    if (nivelActor === NivelPermiso.AUXILIAR) {
      throw new ForbiddenException({
        error:
          'Un usuario con nivel AUXILIAR no puede dar de alta personal administrativo',
        code: 'NIVEL_PERMISO_INSUFICIENTE',
      });
    }

    const rangoActor = PersonasService.JERARQUIA_NIVEL_PERMISO[nivelActor];
    const rangoNuevo =
      PersonasService.JERARQUIA_NIVEL_PERMISO[nivelPermisoNuevo];

    if (rangoActor < rangoNuevo) {
      throw new ForbiddenException({
        error: 'No tienes nivel de permiso suficiente para asignar ese nivel',
        code: 'NIVEL_PERMISO_INSUFICIENTE',
      });
    }
  }

  async altaPersona(
    dto: CrearPersonaDto,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<AltaPersonaResult> {
    // --- Pre-checks que NO tocan Supabase Auth: fallan rápido sin dejar
    // cuentas huérfanas cuando el problema es detectable de antemano contra
    // la propia DB. No eliminan la necesidad de la compensación de abajo
    // (hay condiciones de carrera y constraints que solo Postgres detecta
    // en el momento del insert), pero cubren el caso común.
    //
    // Ya NO hay pre-check de `email` duplicado acá (feature 2026-08-18): el
    // cliente ya no manda `email` — el login se GENERA para los 3 roles
    // (`generarLoginAlumno`/`generarLoginPersonal`, más abajo, antes de
    // tocar Supabase Auth), único por construcción (mismo criterio que se
    // aplicó a `matricula` en la primera mitad de este mismo día).

    // Observación B de QA — Día 11: `codigoExterno` también es `@unique` en
    // `Usuario` (nullable) y sí es parte del flujo (`CrearPersonaDto.codigoExterno`,
    // opcional) — mismo pre-check que email, para no caer al catch genérico
    // con un mensaje impreciso si colisiona.
    if (dto.codigoExterno) {
      const codigoExternoEnUso = await this.prisma.usuario.findUnique({
        where: { codigoExterno: dto.codigoExterno },
        select: { id: true },
      });
      if (codigoExternoEnUso) {
        throw new ConflictException({
          error: 'Ya existe un usuario con ese código externo',
          code: 'CONFLICT',
        });
      }
    }

    if (dto.rol === RolUsuario.ALUMNO) {
      // El propio DTO (`@IsDefined()` + `@ValidateNested()` condicionado a
      // `rol === ALUMNO`) ya garantiza que `perfilAlumno` viene si `rol` es
      // ALUMNO — este chequeo es defensivo (por si `PersonasService` se
      // invoca alguna vez fuera del `ValidationPipe` HTTP).
      if (!dto.perfilAlumno) {
        throw new BadRequestException({
          error: 'perfilAlumno es requerido para rol ALUMNO',
          code: 'VALIDATION_ERROR',
        });
      }

      // Regla 2 de CLAUDE.md (aislamiento por sede): la carrera del alumno
      // debe pertenecer a la MISMA sede del admin que da de alta (extraída
      // del JWT, nunca del body) — un admin de Mérida no puede inscribir un
      // alumno en una carrera de Valladolid. 404 en vez de un código de
      // cross-sede explícito: desde la perspectiva de este admin, esa
      // carrera simplemente no existe (no se filtra que exista en otra sede).
      const carrera = await this.prisma.carrera.findFirst({
        where: { id: dto.perfilAlumno.carreraId, sedeId },
        select: { id: true },
      });
      if (!carrera) {
        throw new NotFoundException({
          error: 'Carrera no encontrada en tu sede',
          code: 'NOT_FOUND',
        });
      }

      // Ya NO hay pre-check de matrícula duplicada acá (feature 2026-08-18):
      // la matrícula ya no la manda el cliente, la genera `generarMatricula`
      // (ver más abajo, antes de tocar Supabase Auth) vía el contador
      // atómico `ContadorMatricula` — única por construcción (secuencial,
      // nunca se repite). El `@unique` de Postgres en
      // `PerfilAlumno.matricula` queda como defensa mínima contra un bug
      // futuro en el generador, no como camino esperado (ver catch de
      // `P2002` más abajo).
    } else if (dto.rol === RolUsuario.MAESTRO) {
      if (!dto.perfilMaestro) {
        throw new BadRequestException({
          error: 'perfilMaestro es requerido para rol MAESTRO',
          code: 'VALIDATION_ERROR',
        });
      }

      // Regla cruzada de `tipoContratacion === CONTRATO` (2026-09-07) — el
      // DTO (`@ValidateIf` + `@IsDateString`) ya garantiza que ambas fechas
      // vienen y tienen formato ISO válido cuando el tipo es CONTRATO; acá
      // se valida solo la relación ENTRE ellas, mismo criterio que
      // Calendario valida `fechaFin`/`recurrenciaHasta` contra `fechaInicio`
      // en el service (no en el DTO). Reutiliza `VALIDATION_ERROR`, sin
      // código nuevo.
      if (
        dto.perfilMaestro.tipoContratacion === TipoContratacion.CONTRATO &&
        dto.perfilMaestro.contratoFechaInicio &&
        dto.perfilMaestro.contratoFechaFin &&
        new Date(dto.perfilMaestro.contratoFechaFin).getTime() <=
          new Date(dto.perfilMaestro.contratoFechaInicio).getTime()
      ) {
        throw new BadRequestException({
          error:
            'contratoFechaFin no puede ser anterior o igual a contratoFechaInicio',
          code: 'VALIDATION_ERROR',
        });
      }
    } else if (dto.rol === RolUsuario.ADMINISTRATIVO) {
      // El propio DTO ya garantiza que `perfilAdministrativo` viene si `rol`
      // es ADMINISTRATIVO — este chequeo es defensivo, mismo criterio que el
      // de `perfilAlumno` arriba.
      if (!dto.perfilAdministrativo) {
        throw new BadRequestException({
          error: 'perfilAdministrativo es requerido para rol ADMINISTRATIVO',
          code: 'VALIDATION_ERROR',
        });
      }

      // Observación A de QA — Día 11 (regla 7 de CLAUDE.md raíz): verificar
      // ANTES de tocar Supabase Auth (falla rápido, no crea nada si el actor
      // no tiene permiso). El default AUXILIAR acá coincide con el default
      // que aplica `PersonasService` más abajo al insertar el perfil.
      await this.verificarJerarquiaNivelPermiso(
        actorUsuarioId,
        dto.perfilAdministrativo.nivelPermiso ?? NivelPermiso.AUXILIAR,
      );
    }

    return this.ejecutarAltaPersona(dto, sedeId, { usuarioId: actorUsuarioId });
  }

  /**
   * Solo lo llama `SedesService.crearConFundadores` — sin controller/ruta
   * propia. Crea un ADMINISTRATIVO fundador de una sede recién creada, SIN
   * `verificarJerarquiaNivelPermiso` (no hay jerarquía previa que consultar:
   * 0 administrativos en la sede todavía; el actor real es `AdminPlataforma`,
   * por diseño ya por encima de esa jerarquía — mismo criterio del spec de
   * Día 20, `docs/superpowers/specs/2026-08-14-crud-sedes-admin-plataforma-design.md`).
   * `dto.perfilAdministrativo.nivelPermiso` debe venir ya resuelto por el
   * caller — `SedesService` lo fuerza a SUPER_ADMIN/ADMIN server-side, nunca
   * lo decide el cliente (regla 1 de CLAUDE.md raíz).
   *
   * DESVIACIÓN respecto al brief/spec original (2026-09-11): la firma acá
   * gana un tercer parámetro `actorAdminPlataformaId`, que NI el brief de
   * esta task NI el spec de diseño mencionaban. Motivo: el bloque de
   * `ejecutarAltaPersona` extraído "verbatim" de `altaPersona` (líneas
   * 733-1107 originales) escribe un `RegistroAuditoria` usando
   * `actorUsuarioId` — un parámetro que ninguno de los dos documentos
   * declaraba para `ejecutarAltaPersona`/`altaAdministrativoFundador`. Sin
   * un actor real, ese insert queda con `usuario_id`/`admin_plataforma_id`
   * ambos NULL, lo que viola el CHECK `registro_auditoria_actor_check`
   * (migración `20260814220151_admin_plataforma`, regla "un actor XOR el
   * otro, nunca ninguno") — un error real de Postgres en cada llamada a
   * `crearConFundadores`, no solo un problema de tipos. Ver el reporte de
   * esta task para el detalle completo; queda documentado también acá por
   * si `SedesService` (Task 2) se implementa sin releer el reporte.
   */
  async altaAdministrativoFundador(
    dto: CrearPersonaDto,
    sedeId: string,
    actorAdminPlataformaId: string,
  ): Promise<AltaPersonaResult> {
    // Defensivo/inalcanzable con el caller actual: `SedesService.crearConFundadores`
    // nunca manda `codigoExterno` en el DTO que arma (director/administrativo
    // fundadores no lo capturan). Se conserva por simetría con `altaPersona`
    // (mismo pre-check) por si `SedesService` cambia en el futuro para aceptarlo.
    if (dto.codigoExterno) {
      const codigoExternoEnUso = await this.prisma.usuario.findUnique({
        where: { codigoExterno: dto.codigoExterno },
        select: { id: true },
      });
      if (codigoExternoEnUso) {
        throw new ConflictException({
          error: 'Ya existe un usuario con ese código externo',
          code: 'CONFLICT',
        });
      }
    }

    if (!dto.perfilAdministrativo) {
      throw new BadRequestException({
        error: 'perfilAdministrativo es requerido',
        code: 'VALIDATION_ERROR',
      });
    }

    return this.ejecutarAltaPersona(dto, sedeId, {
      adminPlataformaId: actorAdminPlataformaId,
    });
  }

  /**
   * `actor` identifica a quién auditar como responsable del `RegistroAuditoria`
   * `ALTA` que se crea dentro de la transacción de abajo — exactamente uno de
   * `usuarioId`/`adminPlataformaId` (nunca ambos, nunca ninguno), por el CHECK
   * `registro_auditoria_actor_check`. `altaPersona` pasa `{ usuarioId }` (el
   * admin real que hace la request); `altaAdministrativoFundador` pasa
   * `{ adminPlataformaId }` (no hay `Usuario` actor en ese camino — ver el
   * comentario de `altaAdministrativoFundador` arriba).
   */
  private async ejecutarAltaPersona(
    dto: CrearPersonaDto,
    sedeId: string,
    actor: { usuarioId: string } | { adminPlataformaId: string },
  ): Promise<AltaPersonaResult> {
    // --- Generación del login (feature 2026-08-18) — DEBE ocurrir antes de
    // llamar a Supabase Auth (unas líneas abajo), porque el Admin API
    // necesita el email de la cuenta ANTES de que exista la fila de
    // `Usuario` en Postgres. Por eso, a diferencia del resto del alta
    // (Usuario -> perfil -> contactos -> auditoría, todo dentro de un mismo
    // `$transaction`), esto pasa afuera de esa transacción — ver el
    // comentario largo de `generarMatricula` para el porqué no compromete
    // la atomicidad.
    //
    // `matricula` queda `undefined` para MAESTRO/ADMINISTRATIVO (solo
    // aplica a ALUMNO) — se propaga tal cual hasta la respuesta final.
    let matricula: string | undefined;
    let email: string;

    if (dto.rol === RolUsuario.ALUMNO && dto.perfilAlumno) {
      matricula = await this.generarMatricula();
      email = this.generarLoginAlumno(matricula);
    } else if (dto.rol === RolUsuario.MAESTRO && dto.perfilMaestro) {
      email = await this.generarLoginPersonal(
        dto.perfilMaestro.nombres,
        dto.perfilMaestro.apellidoPaterno,
      );
    } else if (
      dto.rol === RolUsuario.ADMINISTRATIVO &&
      dto.perfilAdministrativo
    ) {
      email = await this.generarLoginPersonal(
        dto.perfilAdministrativo.nombres,
        dto.perfilAdministrativo.apellidoPaterno,
      );
    } else {
      // Defensivo — nunca debería llegar acá: los pre-checks de arriba ya
      // garantizan que el perfil correspondiente al `rol` viene siempre
      // (mismo criterio que el resto de los chequeos defensivos de este
      // método).
      throw new BadRequestException({
        error: 'No fue posible determinar el perfil para generar el login',
        code: 'VALIDATION_ERROR',
      });
    }

    const temporaryPassword = generateTemporaryPassword();
    const client = await this.getClient();

    // `email_confirm: true` — ver encargo de Día 11: un alta hecha por un
    // admin debe dejar la cuenta lista para usarse de inmediato con la
    // contraseña temporal, sin forzar una confirmación de correo que el
    // usuario nunca pidió (mismo criterio que evitó el bug de Día 10,
    // `CORREO_NO_CONFIRMADO` en `AuthService.login`).
    const { data: authData, error: authError } =
      await client.auth.admin.createUser({
        email,
        password: temporaryPassword,
        email_confirm: true,
      });

    if (authError || !authData?.user) {
      // Regla 12 de CLAUDE.md raíz — loguear el error completo server-side
      // antes de responder, aunque el cliente no reciba el detalle.
      console.error(
        '[PersonasService.altaPersona] Error creando usuario en Supabase Auth:',
        {
          code: authError?.code,
          status: authError?.status,
          message: authError?.message,
        },
      );

      // `email_exists` — código real de `@supabase/auth-js` (confirmado en
      // `error-codes.d.ts` de la versión instalada). Condición de carrera
      // frente al pre-check de arriba (alguien más creó la cuenta entre el
      // pre-check y esta llamada) o una cuenta de Auth huérfana sin fila en
      // `usuarios` — cualquiera de los dos casos es un conflicto real.
      if (authError?.code === 'email_exists') {
        throw new ConflictException({
          error: 'Ya existe una cuenta con ese email',
          code: 'CONFLICT',
        });
      }

      throw new InternalServerErrorException({
        error: 'Error inesperado al crear la cuenta',
        code: 'SERVER_ERROR',
      });
    }

    const usuarioId = authData.user.id;

    try {
      const usuario = await this.prisma.$transaction(async (tx) => {
        const usuarioCreado = await tx.usuario.create({
          data: {
            id: usuarioId,
            email,
            rol: dto.rol,
            sedeId,
            codigoExterno: dto.codigoExterno,
          },
        });

        if (dto.rol === RolUsuario.ALUMNO && dto.perfilAlumno) {
          const perfilAlumno = await tx.perfilAlumno.create({
            data: {
              usuarioId,
              nombres: dto.perfilAlumno.nombres,
              apellidoPaterno: dto.perfilAlumno.apellidoPaterno,
              apellidoMaterno: dto.perfilAlumno.apellidoMaterno,
              curp: dto.perfilAlumno.curp,
              fechaNacimiento: new Date(dto.perfilAlumno.fechaNacimiento),
              // `matricula` ya se generó arriba (antes de Supabase Auth) —
              // non-null assertion segura: este branch solo corre cuando
              // `dto.rol === ALUMNO`, que es exactamente la condición bajo
              // la cual se generó `matricula` unas líneas arriba.
              matricula: matricula!,
              correoPersonal: dto.perfilAlumno.correoPersonal,
              carreraId: dto.perfilAlumno.carreraId,
              // Una alta nueva siempre arranca INSCRITO — no es un campo
              // que el admin decida al dar de alta (los otros valores del
              // enum, ej. BAJA_TEMPORAL/EGRESADO, son transiciones
              // posteriores del ciclo de vida del alumno, fuera de alcance
              // de esta operación de alta).
              estatusAcademico: 'INSCRITO',
              periodoIngreso: dto.perfilAlumno.periodoIngreso,
              cuatrimestreActual: dto.perfilAlumno.cuatrimestreActual,
              telefono: dto.perfilAlumno.telefono,
            },
          });

          for (const contacto of this.conOrdenSecuencial(
            dto.perfilAlumno.contactos,
          )) {
            await tx.contactoAlumno.create({
              data: {
                alumnoId: perfilAlumno.id,
                tipo: contacto.tipo,
                nombre: contacto.nombre,
                telefono: contacto.telefono,
                correo: contacto.correo,
                parentesco: contacto.parentesco,
                orden: contacto.orden,
              },
            });
          }

          await tx.infoMedicaAlumno.create({
            data: {
              alumnoId: perfilAlumno.id,
              ...this.datosInfoMedica(dto.perfilAlumno.infoMedica),
            },
          });
        } else if (dto.rol === RolUsuario.MAESTRO && dto.perfilMaestro) {
          const perfilMaestro = await tx.perfilMaestro.create({
            data: {
              usuarioId,
              nombres: dto.perfilMaestro.nombres,
              apellidoPaterno: dto.perfilMaestro.apellidoPaterno,
              apellidoMaterno: dto.perfilMaestro.apellidoMaterno,
              curp: dto.perfilMaestro.curp,
              cedulaProfesional: dto.perfilMaestro.cedulaProfesional,
              correoPersonal: dto.perfilMaestro.correoPersonal,
              telefono: dto.perfilMaestro.telefono,
              fechaContratacion: new Date(dto.perfilMaestro.fechaContratacion),
              // Forzado siempre a ACTIVO — no tiene sentido dar de alta a
              // alguien ya en BAJA/LICENCIA (corrección QA manual,
              // 2026-08-12). El DTO ya no acepta `estatus` en la creación.
              estatus: EstatusEmpleado.ACTIVO,
              // Tipo de contratación (2026-09-07) — ver
              // `datosContratacionMaestro`. `tipoContratacion` siempre
              // presente (requerido en el DTO); los condicionales quedan
              // `null` salvo el caso que aplique.
              ...this.datosContratacionMaestro(dto.perfilMaestro),
            },
          });

          for (const contacto of this.conOrdenSecuencial(
            dto.perfilMaestro.contactos,
          )) {
            await tx.contactoMaestro.create({
              data: {
                maestroId: perfilMaestro.id,
                nombre: contacto.nombre,
                telefono: contacto.telefono,
                correo: contacto.correo,
                parentesco: contacto.parentesco,
                orden: contacto.orden,
              },
            });
          }

          await tx.infoMedicaMaestro.create({
            data: {
              maestroId: perfilMaestro.id,
              ...this.datosInfoMedica(dto.perfilMaestro.infoMedica),
            },
          });
        } else if (
          dto.rol === RolUsuario.ADMINISTRATIVO &&
          dto.perfilAdministrativo
        ) {
          const perfilAdministrativo = await tx.perfilAdministrativo.create({
            data: {
              usuarioId,
              nombres: dto.perfilAdministrativo.nombres,
              apellidoPaterno: dto.perfilAdministrativo.apellidoPaterno,
              apellidoMaterno: dto.perfilAdministrativo.apellidoMaterno,
              curp: dto.perfilAdministrativo.curp,
              correoPersonal: dto.perfilAdministrativo.correoPersonal,
              telefono: dto.perfilAdministrativo.telefono,
              fechaContratacion: new Date(
                dto.perfilAdministrativo.fechaContratacion,
              ),
              // Forzado siempre a ACTIVO, mismo criterio que perfilMaestro
              // arriba — el DTO ya no acepta `estatus` en la creación.
              estatus: EstatusEmpleado.ACTIVO,
              puesto: dto.perfilAdministrativo.puesto,
              nivelPermiso:
                dto.perfilAdministrativo.nivelPermiso ?? NivelPermiso.AUXILIAR,
            },
          });

          for (const contacto of this.conOrdenSecuencial(
            dto.perfilAdministrativo.contactos,
          )) {
            await tx.contactoAdministrativo.create({
              data: {
                administrativoId: perfilAdministrativo.id,
                nombre: contacto.nombre,
                telefono: contacto.telefono,
                correo: contacto.correo,
                parentesco: contacto.parentesco,
                orden: contacto.orden,
              },
            });
          }

          await tx.infoMedicaAdministrativo.create({
            data: {
              administrativoId: perfilAdministrativo.id,
              ...this.datosInfoMedica(dto.perfilAdministrativo.infoMedica),
            },
          });
        }

        // Regla 5 de CLAUDE.md raíz — RegistroAuditoria solo se crea acá,
        // automáticamente, nunca vía un endpoint de escritura directa.
        // El actor (quién hace la request) va en `usuarioId` O
        // `adminPlataformaId` según `actor` (ver JSDoc de este método) —
        // nunca ambos, nunca ninguno (CHECK `registro_auditoria_actor_check`).
        // La persona recién creada NO es el actor, va en `entidadId`.
        await tx.registroAuditoria.create({
          data: {
            usuarioId: 'usuarioId' in actor ? actor.usuarioId : null,
            adminPlataformaId:
              'adminPlataformaId' in actor ? actor.adminPlataformaId : null,
            sedeId,
            accion: AccionAuditoria.ALTA,
            entidad: 'Usuario',
            entidadId: usuarioId,
            detalle: { rol: dto.rol },
          },
        });

        return usuarioCreado;
      });

      // Correo de bienvenida (Día 13, desbloqueado 2026-08-17) — best-effort,
      // DESPUÉS de que la transacción de Postgres ya confirmó (Supabase Auth
      // + Usuario + perfil ya existen). Envuelto en su propio try/catch: si
      // Mailgun falla (esperable casi siempre mientras el dominio sea
      // sandbox — solo entrega a destinatarios autorizados a mano) NUNCA
      // debe impedir que la persona quede dada de alta ni afectar la
      // respuesta HTTP. `temporaryPassword` sigue siendo el fallback real
      // que ya muestra el frontend en pantalla (Días 14/15).
      //
      // Cambio de destino (feature 2026-08-18): el correo se manda a
      // `correoPersonalPara(dto)` (`correoPersonal` del perfil), NO a
      // `email` (el login sintético, generado, sin buzón real) — para LOS 3
      // ROLES por igual, sin excepción. `email` se sigue mandando al
      // `MailService` (parámetro `email` de `EnviarCorreoBienvenidaParams`)
      // porque el CUERPO del correo necesita mostrar el login real con el
      // que la persona debe iniciar sesión — solo el DESTINO (`to:` real de
      // Mailgun) cambia a `correoDestino`.
      try {
        await this.mailService.enviarCorreoBienvenida({
          nombreCompleto: this.nombreCompletoPara(dto),
          email,
          // Non-null assertion segura: los pre-checks de arriba ya
          // garantizan que el perfil correspondiente al `rol` (y por lo
          // tanto su `correoPersonal`, requerido en los 3 DTOs de perfil)
          // viene siempre.
          correoDestino: this.correoPersonalPara(dto)!,
          temporaryPassword,
        });
      } catch (mailErr) {
        // Regla 12 de CLAUDE.md raíz — loguear el error completo server-side
        // antes de continuar; la respuesta HTTP no se ve afectada.
        console.error(
          '[PersonasService.altaPersona] Error enviando correo de bienvenida:',
          mailErr,
        );
      }

      return {
        usuario: {
          id: usuario.id,
          email: usuario.email,
          rol: usuario.rol,
          sedeId: usuario.sedeId,
          codigoExterno: usuario.codigoExterno,
          primerIngreso: usuario.primerIngreso,
          activo: usuario.activo,
        },
        temporaryPassword,
        // Presente SOLO si rol === ALUMNO (`matricula` queda `undefined`
        // para MAESTRO/ADMINISTRATIVO) — mismo contrato ya consumido por el
        // frontend (formulario de alta de alumno).
        matricula,
        // Login generado — SIEMPRE presente, para los 3 roles (feature
        // 2026-08-18). Mismo valor que `usuario.email`, duplicado a nivel
        // raíz por claridad (ver doc de `AltaPersonaResult.email`).
        email,
      };
    } catch (err) {
      // Regla 9 de CLAUDE.md raíz: Postgres y Supabase Auth son dos
      // sistemas distintos, no hay transacción distribuida real entre
      // ambos. La transacción de Postgres ya se revirtió sola (falló dentro
      // de `$transaction`), pero el usuario de Supabase Auth SÍ quedó creado
      // — hay que compensar borrándolo a mano.
      console.error(
        '[PersonasService.altaPersona] Falló la transacción de Postgres tras crear el usuario en Supabase Auth — compensando (borrando usuario de Auth):',
        err,
      );

      // Observación C de QA — Día 11: la propia llamada de compensación
      // puede fallar de dos formas distintas — resolviendo con `{ error }`
      // (caso ya cubierto) o RECHAZANDO la promesa (ej. falla de red/timeout
      // contra el Admin API). Envuelta en su propio try/catch para que
      // cualquiera de las dos formas dispare el mismo log CRÍTICO (regla 12).
      try {
        const { error: deleteError } =
          await client.auth.admin.deleteUser(usuarioId);
        if (deleteError) {
          // Caso crítico: no se pudo compensar — queda un usuario huérfano en
          // Supabase Auth sin fila en `usuarios`. Se loguea con el máximo
          // detalle posible (regla 12) para que se pueda limpiar a mano; no
          // hay forma de reintentar automáticamente desde acá sin arriesgar
          // un loop infinito.
          console.error(
            '[PersonasService.altaPersona] CRÍTICO: no se pudo compensar el usuario de Supabase Auth tras el fallo en Postgres — queda huérfano, requiere limpieza manual:',
            { usuarioId, deleteError },
          );
        }
      } catch (compensationErr: unknown) {
        // Mismo caso crítico que arriba, pero la promesa rechazó en vez de
        // resolver con `{ error }` — sin este catch, este camino no
        // disparaba ningún log (bug real encontrado por QA — Día 11).
        console.error(
          '[PersonasService.altaPersona] CRÍTICO: la compensación (deleteUser) lanzó una excepción en vez de resolver — usuario de Supabase Auth queda huérfano, requiere limpieza manual:',
          { usuarioId, compensationErr },
        );
      }

      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          error:
            'Ya existe un registro con ese dato único (login generado, matrícula generada o código externo)',
          code: 'CONFLICT',
        });
      }

      throw new InternalServerErrorException({
        error: 'Error inesperado al dar de alta la persona',
        code: 'SERVER_ERROR',
      });
    }
  }

  /**
   * `GET /personas?rol=ALUMNO|MAESTRO|ADMINISTRATIVO&...` — Fase 5, Día 19,
   * extendido a ADMINISTRATIVO (Fase 10, unificación CRUD admin).
   *
   * "Listados PARA administrativos" = listados que un ADMINISTRATIVO
   * consulta, de ALUMNO, MAESTRO y (desde hoy) ADMINISTRATIVO mismos — el
   * alcance que Día 19 dejaba fuera explícitamente se cierra en esta
   * extensión.
   *
   * `sedeId` SIEMPRE viene de `@SedeActual()` (JWT, regla 2 de CLAUDE.md
   * raíz) — el controller nunca lo toma de query. El filtro de sede se
   * aplica vía la relación `usuario.sedeId` (ni `PerfilAlumno` ni
   * `PerfilMaestro` tienen `sedeId` propio en el schema, viven en `Usuario`).
   *
   * `estatus` se valida acá (no en el DTO, ver comentario de
   * `ListarPersonasQueryDto`) contra el enum que corresponde al `rol`
   * pedido — reutiliza `VALIDATION_ERROR`, sin código nuevo.
   *
   * Campos mínimos para tabla (mismo criterio que
   * `CarrerasService.listarPorSede`) — sin `contactos`/`infoMedica`, eso es
   * `GET /perfil` (perfil completo del propio usuario, Días 16-18), no este
   * listado resumen.
   */
  async listarPorSedeYRol(
    sedeId: string,
    query: ListarPersonasQueryDto,
  ): Promise<ListarPersonasResult> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    if (query.rol === RolUsuario.ALUMNO) {
      if (
        query.estatus &&
        !Object.values(EstatusAcademico).includes(
          query.estatus as EstatusAcademico,
        )
      ) {
        throw new BadRequestException({
          error: 'estatus inválido para rol ALUMNO',
          code: 'VALIDATION_ERROR',
        });
      }

      const where: Prisma.PerfilAlumnoWhereInput = {
        usuario: { sedeId },
        ...(query.estatus
          ? { estatusAcademico: query.estatus as EstatusAcademico }
          : {}),
        ...(query.buscar
          ? {
              OR: [
                { nombres: { contains: query.buscar, mode: 'insensitive' } },
                {
                  apellidoPaterno: {
                    contains: query.buscar,
                    mode: 'insensitive',
                  },
                },
                {
                  apellidoMaterno: {
                    contains: query.buscar,
                    mode: 'insensitive',
                  },
                },
                {
                  matricula: { contains: query.buscar, mode: 'insensitive' },
                },
              ],
            }
          : {}),
      };

      const [total, alumnos] = await this.prisma.$transaction([
        this.prisma.perfilAlumno.count({ where }),
        this.prisma.perfilAlumno.findMany({
          where,
          select: {
            usuarioId: true,
            nombres: true,
            apellidoPaterno: true,
            apellidoMaterno: true,
            matricula: true,
            estatusAcademico: true,
            cuatrimestreActual: true,
            carrera: { select: { id: true, nombre: true } },
            usuario: { select: { activo: true } },
          },
          orderBy: [
            { apellidoPaterno: 'asc' },
            { apellidoMaterno: 'asc' },
            { nombres: 'asc' },
          ],
          skip,
          take: limit,
        }),
      ]);

      return {
        data: alumnos.map((alumno) => ({
          usuarioId: alumno.usuarioId,
          nombres: alumno.nombres,
          apellidoPaterno: alumno.apellidoPaterno,
          apellidoMaterno: alumno.apellidoMaterno,
          matricula: alumno.matricula,
          carrera: alumno.carrera,
          estatusAcademico: alumno.estatusAcademico,
          cuatrimestreActual: alumno.cuatrimestreActual,
          activo: alumno.usuario.activo,
        })),
        page,
        limit,
        total,
      };
    }

    if (query.rol === RolUsuario.ADMINISTRATIVO) {
      return this.listarAdministrativos(sedeId, query, page, limit, skip);
    }

    // query.rol === RolUsuario.MAESTRO — el DTO (`@IsIn`) ya descarta
    // cualquier otro valor con 400 VALIDATION_ERROR antes de llegar acá
    // (ALUMNO se resuelve arriba, ADMINISTRATIVO justo arriba).
    if (
      query.estatus &&
      !Object.values(EstatusEmpleado).includes(query.estatus as EstatusEmpleado)
    ) {
      throw new BadRequestException({
        error: 'estatus inválido para rol MAESTRO',
        code: 'VALIDATION_ERROR',
      });
    }

    const where: Prisma.PerfilMaestroWhereInput = {
      usuario: { sedeId },
      ...(query.estatus ? { estatus: query.estatus as EstatusEmpleado } : {}),
      ...(query.buscar
        ? {
            OR: [
              { nombres: { contains: query.buscar, mode: 'insensitive' } },
              {
                apellidoPaterno: {
                  contains: query.buscar,
                  mode: 'insensitive',
                },
              },
              {
                apellidoMaterno: {
                  contains: query.buscar,
                  mode: 'insensitive',
                },
              },
              {
                cedulaProfesional: {
                  contains: query.buscar,
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };

    const [total, maestros] = await this.prisma.$transaction([
      this.prisma.perfilMaestro.count({ where }),
      this.prisma.perfilMaestro.findMany({
        where,
        select: {
          usuarioId: true,
          nombres: true,
          apellidoPaterno: true,
          apellidoMaterno: true,
          cedulaProfesional: true,
          estatus: true,
          tipoLicencia: true,
          tipoContratacion: true,
          diasTemporal: true,
          contratoFechaInicio: true,
          contratoFechaFin: true,
          usuario: { select: { activo: true } },
        },
        orderBy: [
          { apellidoPaterno: 'asc' },
          { apellidoMaterno: 'asc' },
          { nombres: 'asc' },
        ],
        skip,
        take: limit,
      }),
    ]);

    return {
      data: maestros.map((maestro) => ({
        usuarioId: maestro.usuarioId,
        nombres: maestro.nombres,
        apellidoPaterno: maestro.apellidoPaterno,
        apellidoMaterno: maestro.apellidoMaterno,
        cedulaProfesional: maestro.cedulaProfesional,
        estatus: maestro.estatus,
        tipoLicencia: maestro.tipoLicencia,
        tipoContratacion: maestro.tipoContratacion,
        diasTemporal: maestro.diasTemporal,
        contratoFechaInicio: maestro.contratoFechaInicio
          ? maestro.contratoFechaInicio.toISOString().slice(0, 10)
          : null,
        contratoFechaFin: maestro.contratoFechaFin
          ? maestro.contratoFechaFin.toISOString().slice(0, 10)
          : null,
        activo: maestro.usuario.activo,
      })),
      page,
      limit,
      total,
    };
  }

  /**
   * Rama `rol=ADMINISTRATIVO` de `GET /personas` (Fase 10, unificación CRUD
   * admin) — extraída a método privado (a diferencia de las ramas
   * ALUMNO/MAESTRO, que quedan inline en `listarPorSedeYRol`) porque
   * `listarPorSedeYRol` ya es un método largo y esta rama se agrega después,
   * sin querer reordenar las 2 ramas existentes. MISMO patrón exacto que la
   * rama MAESTRO: valida `estatus` contra `EstatusEmpleado` (mismo enum que
   * maestro — `PerfilAdministrativo.estatus` es el mismo tipo), `buscar`
   * hace `contains` case-insensitive contra `nombres`/`apellidoPaterno`/
   * `apellidoMaterno` — SIN un campo tipo `cedulaProfesional`/`matricula`
   * (`PerfilAdministrativo` no tiene un identificador externo equivalente,
   * no se inventa uno).
   */
  private async listarAdministrativos(
    sedeId: string,
    query: ListarPersonasQueryDto,
    page: number,
    limit: number,
    skip: number,
  ): Promise<ListarPersonasResult> {
    if (
      query.estatus &&
      !Object.values(EstatusEmpleado).includes(query.estatus as EstatusEmpleado)
    ) {
      throw new BadRequestException({
        error: 'estatus inválido para rol ADMINISTRATIVO',
        code: 'VALIDATION_ERROR',
      });
    }

    const where: Prisma.PerfilAdministrativoWhereInput = {
      usuario: { sedeId },
      ...(query.estatus ? { estatus: query.estatus as EstatusEmpleado } : {}),
      ...(query.buscar
        ? {
            OR: [
              { nombres: { contains: query.buscar, mode: 'insensitive' } },
              {
                apellidoPaterno: {
                  contains: query.buscar,
                  mode: 'insensitive',
                },
              },
              {
                apellidoMaterno: {
                  contains: query.buscar,
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };

    const [total, administrativos] = await this.prisma.$transaction([
      this.prisma.perfilAdministrativo.count({ where }),
      this.prisma.perfilAdministrativo.findMany({
        where,
        select: {
          usuarioId: true,
          nombres: true,
          apellidoPaterno: true,
          apellidoMaterno: true,
          puesto: true,
          nivelPermiso: true,
          estatus: true,
          tipoLicencia: true,
          usuario: { select: { activo: true } },
        },
        orderBy: [
          { apellidoPaterno: 'asc' },
          { apellidoMaterno: 'asc' },
          { nombres: 'asc' },
        ],
        skip,
        take: limit,
      }),
    ]);

    return {
      data: administrativos.map((administrativo) => ({
        usuarioId: administrativo.usuarioId,
        nombres: administrativo.nombres,
        apellidoPaterno: administrativo.apellidoPaterno,
        apellidoMaterno: administrativo.apellidoMaterno,
        puesto: administrativo.puesto,
        nivelPermiso: administrativo.nivelPermiso,
        estatus: administrativo.estatus,
        tipoLicencia: administrativo.tipoLicencia,
        activo: administrativo.usuario.activo,
      })),
      page,
      limit,
      total,
    };
  }

  /**
   * `GET /personas/resumen` — dashboard de admin por sede.
   *
   * Solo lecturas relativas a `sedeId` (`@SedeActual()`, regla 2 de
   * CLAUDE.md raíz) — sin `$transaction`, no hay escritura que proteger.
   *
   * `alumnosPorCarrera` — `groupBy` sobre `PerfilAlumno` (que no tiene
   * `sedeId` propio, vive en `Usuario`, mismo criterio que
   * `listarPorSedeYRol`) no trae el nombre de la carrera, así que se hace
   * una segunda query a `Carrera` solo con los ids que trajo el `groupBy` y
   * se combinan ambos resultados en JS.
   *
   * `altasRecientes` — un solo `usuario.findMany` con los 3 `include` de
   * perfil (a lo sumo uno de los 3 viene no-nulo por fila, según `rol`).
   * `nombreCompletoPara` (usado en el correo de bienvenida, más arriba en
   * este archivo) NO se reutiliza acá: opera sobre `CrearPersonaDto` (el
   * body de la request de alta), no sobre el resultado de una query de
   * `Usuario` con sus perfiles incluidos — shape distinto, no hay forma de
   * compartir el helper sin forzar un adapter que complica más de lo que
   * ahorra para una sola línea de `.filter(Boolean).join(' ')`.
   */
  async resumenPorSede(sedeId: string): Promise<ResumenPorSedeResult> {
    const [
      totalAlumnosActivos,
      totalMaestrosActivos,
      totalAdministrativosActivos,
      totalCarreras,
      alumnosPorCarreraGroupBy,
      usuariosRecientes,
    ] = await Promise.all([
      this.prisma.usuario.count({
        where: { sedeId, rol: RolUsuario.ALUMNO, activo: true },
      }),
      this.prisma.usuario.count({
        where: { sedeId, rol: RolUsuario.MAESTRO, activo: true },
      }),
      this.prisma.usuario.count({
        where: { sedeId, rol: RolUsuario.ADMINISTRATIVO, activo: true },
      }),
      this.prisma.carrera.count({ where: { sedeId, estatus: 'ACTIVA' } }),
      this.prisma.perfilAlumno.groupBy({
        by: ['carreraId'],
        where: { usuario: { sedeId, activo: true } },
        _count: { carreraId: true },
        orderBy: { _count: { carreraId: 'desc' } },
        take: 5,
      }),
      this.prisma.usuario.findMany({
        where: { sedeId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          perfilAlumno: {
            select: {
              nombres: true,
              apellidoPaterno: true,
              apellidoMaterno: true,
            },
          },
          perfilMaestro: {
            select: {
              nombres: true,
              apellidoPaterno: true,
              apellidoMaterno: true,
            },
          },
          perfilAdministrativo: {
            select: {
              nombres: true,
              apellidoPaterno: true,
              apellidoMaterno: true,
            },
          },
        },
      }),
    ]);

    let alumnosPorCarrera: AlumnosPorCarreraItem[] = [];
    if (alumnosPorCarreraGroupBy.length > 0) {
      const carreras = await this.prisma.carrera.findMany({
        where: {
          id: { in: alumnosPorCarreraGroupBy.map((item) => item.carreraId) },
        },
        select: { id: true, nombre: true },
      });
      const nombrePorCarreraId = new Map(
        carreras.map((carrera) => [carrera.id, carrera.nombre]),
      );

      alumnosPorCarrera = alumnosPorCarreraGroupBy.map((item) => ({
        carreraId: item.carreraId,
        nombre: nombrePorCarreraId.get(item.carreraId) ?? '',
        cantidad: item._count.carreraId,
      }));
    }

    const altasRecientes: AltaRecienteItem[] = usuariosRecientes.map(
      (usuario) => {
        const perfil =
          usuario.perfilAlumno ??
          usuario.perfilMaestro ??
          usuario.perfilAdministrativo;

        return {
          usuarioId: usuario.id,
          nombreCompleto: perfil
            ? [perfil.nombres, perfil.apellidoPaterno, perfil.apellidoMaterno]
                .filter(Boolean)
                .join(' ')
            : 'Usuario SIGE',
          rol: usuario.rol,
          fecha: usuario.createdAt.toISOString(),
        };
      },
    );

    return {
      totalAlumnosActivos,
      totalMaestrosActivos,
      totalAdministrativosActivos,
      totalCarreras,
      alumnosPorCarrera,
      altasRecientes,
    };
  }

  /**
   * Cálculo de `Usuario.activo` a partir del `estatus` nuevo (estatus
   * avanzado, 2026-08-26) — SOLO se llama para `MAESTRO`/`ADMINISTRATIVO`
   * (ver `cambiarEstatus`), nunca para `ALUMNO`. `ACTIVO` y `LICENCIA`
   * siempre reactivan el acceso (una licencia no revoca la cuenta, solo
   * documenta una ausencia temporal). `BAJA` revoca el acceso SOLO si
   * `motivoBaja` es uno de los motivos de terminación de la relación laboral
   * (`MOTIVO_BAJA_REVOCA`: `RENUNCIA`, `DESPIDO`, `FALLECIMIENTO`,
   * `TERMINACION_INCAPACIDAD_PERMANENTE` — arts. 47 y 53 LFT) — una
   * `BAJA_TEMPORAL_SALUD`/`OTRO` no revoca, la persona sigue de baja
   * "cosmética" con acceso intacto (mismo criterio que la baja de alumno,
   * pero acá sí puede activarse la revocación real cuando el motivo lo
   * amerita).
   */
  private calcularActivoPorEstatus(
    estatus: string,
    motivoBaja: string | undefined,
  ): boolean {
    if (estatus !== EstatusEmpleado.BAJA) return true; // ACTIVO y LICENCIA siempre reactivan
    const revoca =
      PersonasService.MOTIVO_BAJA_REVOCA[motivoBaja as MotivoBaja] ?? false;
    return !revoca;
  }

  /**
   * `PATCH /personas/:id/estatus` (Fase 10, unificación CRUD admin) — primer
   * código real del patrón "baja lógica" (regla 3 de CLAUDE.md raíz) que
   * hasta hoy ningún rol tenía implementado. Genérico para los 3 roles
   * (ALUMNO/MAESTRO/ADMINISTRATIVO) aunque el frontend de hoy solo lo use
   * para ADMINISTRATIVO — la validación por rol es gratis acá, no le cierra
   * la puerta a los otros 2 a futuro.
   *
   * `sedeId` (scoping, regla 2) y `actorUsuarioId` (regla 5, auditoría)
   * SIEMPRE vienen del JWT vía `@SedeActual()`/`@ActorUsuarioId()` en el
   * controller — nunca del body/param, más allá del `id` objetivo.
   *
   * Jerarquía de `NivelPermiso` (regla 7, MISMA tabla/lógica que
   * `verificarJerarquiaNivelPermiso` de `altaPersona`) — SOLO aplica si el
   * `Usuario` objetivo es `ADMINISTRATIVO`: un actor `AUXILIAR` no puede
   * cambiar el estatus de NINGÚN administrativo, y un actor no puede tocar a
   * un administrativo con `nivelPermiso` mayor al suyo propio. No aplica a
   * ALUMNO/MAESTRO — `nivelPermiso` es exclusivo de `PerfilAdministrativo`.
   *
   * `RegistroAuditoria.accion` usa `AccionAuditoria.CAMBIO_ESTATUS` — a
   * diferencia de `AuthService.cambiarPassword` (que reutiliza `EDICION`
   * porque el enum NO tiene un valor dedicado a "cambio de contraseña"), acá
   * sí existe un valor semánticamente exacto en el enum (`prisma/schema.prisma`,
   * `AccionAuditoria`) — se usa ese, no `EDICION`.
   *
   * Estatus avanzado (2026-08-26) — extensión para `MAESTRO`/`ADMINISTRATIVO`:
   * `estatus: LICENCIA` requiere `opciones.tipoLicencia` (válido, del enum
   * `TipoLicencia`); `estatus: BAJA` requiere `opciones.motivoBaja` (válido,
   * del enum `MotivoBaja`). `Usuario.activo` se recalcula al vuelo
   * (`calcularActivoPorEstatus`, regla 1 de CLAUDE.md raíz no aplica acá
   * porque SÍ se persiste — es la bandera real de acceso, no un derivado
   * puramente de lectura) SOLO para `MAESTRO`/`ADMINISTRATIVO`, nunca para
   * `ALUMNO` (la baja lógica de alumno sigue siendo cosmética, sin revocar
   * acceso).
   */
  async cambiarEstatus(
    id: string,
    estatus: string,
    sedeId: string,
    actorUsuarioId: string,
    opciones: { tipoLicencia?: string; motivoBaja?: string } = {},
  ): Promise<{ ok: true }> {
    try {
      const usuario = await this.prisma.usuario.findFirst({
        where: { id, sedeId },
        select: {
          id: true,
          rol: true,
          perfilAlumno: { select: { estatusAcademico: true } },
          perfilMaestro: { select: { estatus: true } },
          perfilAdministrativo: {
            select: { estatus: true, nivelPermiso: true },
          },
        },
      });

      if (!usuario) {
        throw new NotFoundException({
          error: 'Persona no encontrada en tu sede',
          code: 'NOT_FOUND',
        });
      }

      if (usuario.rol === RolUsuario.ALUMNO) {
        if (
          !usuario.perfilAlumno ||
          !Object.values(EstatusAcademico).includes(estatus as EstatusAcademico)
        ) {
          throw new BadRequestException({
            error: 'estatus inválido para rol ALUMNO',
            code: 'VALIDATION_ERROR',
          });
        }
      } else {
        // MAESTRO/ADMINISTRATIVO comparten el mismo enum (`EstatusEmpleado`).
        const perfilEmpleado =
          usuario.rol === RolUsuario.MAESTRO
            ? usuario.perfilMaestro
            : usuario.perfilAdministrativo;

        if (
          !perfilEmpleado ||
          !Object.values(EstatusEmpleado).includes(estatus as EstatusEmpleado)
        ) {
          throw new BadRequestException({
            error: `estatus inválido para rol ${usuario.rol}`,
            code: 'VALIDATION_ERROR',
          });
        }

        // `tipoLicencia`, si viene en el body, SIEMPRE debe ser un valor
        // válido de `TipoLicencia` — sin importar `estatus`. Corrección de
        // review: la primera versión solo validaba el enum cuando
        // `estatus === LICENCIA`, dejando pasar un valor basura (ej.
        // `estatus: 'ACTIVO', tipoLicencia: 'GARBAGE'`) sin validar; ese
        // valor llegaba tal cual (vía el cast `as TipoLicencia` de la
        // transacción de abajo) al `update` de Prisma, que lo rechazaba en
        // runtime con un `PrismaClientValidationError` no capturado por el
        // catch de abajo (`NotFoundException`/`BadRequestException`/
        // `ForbiddenException`) — surgía como `500 SERVER_ERROR` en vez de
        // `400 VALIDATION_ERROR`.
        if (
          opciones.tipoLicencia !== undefined &&
          !Object.values(TipoLicencia).includes(
            opciones.tipoLicencia as TipoLicencia,
          )
        ) {
          throw new BadRequestException({
            error: 'tipoLicencia inválido',
            code: 'VALIDATION_ERROR',
          });
        }

        if (estatus === EstatusEmpleado.LICENCIA && !opciones.tipoLicencia) {
          throw new BadRequestException({
            error: 'tipoLicencia es requerido cuando el estatus es LICENCIA',
            code: 'VALIDATION_ERROR',
          });
        }

        // Mismo criterio que `tipoLicencia` arriba — validación
        // incondicional del enum si el campo viene, independiente de si
        // `estatus` lo requiere.
        if (
          opciones.motivoBaja !== undefined &&
          !Object.values(MotivoBaja).includes(
            opciones.motivoBaja as MotivoBaja,
          )
        ) {
          throw new BadRequestException({
            error: 'motivoBaja inválido',
            code: 'VALIDATION_ERROR',
          });
        }

        if (estatus === EstatusEmpleado.BAJA && !opciones.motivoBaja) {
          throw new BadRequestException({
            error: 'motivoBaja es requerido cuando el estatus es BAJA',
            code: 'VALIDATION_ERROR',
          });
        }

        if (
          usuario.rol === RolUsuario.ADMINISTRATIVO &&
          usuario.perfilAdministrativo
        ) {
          const perfilActor = await this.prisma.perfilAdministrativo.findUnique(
            {
              where: { usuarioId: actorUsuarioId },
              select: { nivelPermiso: true },
            },
          );
          const nivelActor = perfilActor?.nivelPermiso ?? NivelPermiso.AUXILIAR;

          if (nivelActor === NivelPermiso.AUXILIAR) {
            throw new ForbiddenException({
              error:
                'Un usuario con nivel AUXILIAR no puede cambiar el estatus de personal administrativo',
              code: 'NIVEL_PERMISO_INSUFICIENTE',
            });
          }

          const rangoActor =
            PersonasService.JERARQUIA_NIVEL_PERMISO[nivelActor];
          const rangoObjetivo =
            PersonasService.JERARQUIA_NIVEL_PERMISO[
              usuario.perfilAdministrativo.nivelPermiso
            ];

          if (rangoActor < rangoObjetivo) {
            throw new ForbiddenException({
              error:
                'No tienes nivel de permiso suficiente para cambiar el estatus de este administrativo',
              code: 'NIVEL_PERMISO_INSUFICIENTE',
            });
          }
        }
      }

      await this.prisma.$transaction(async (tx) => {
        if (usuario.rol === RolUsuario.ALUMNO) {
          await tx.perfilAlumno.update({
            where: { usuarioId: id },
            data: { estatusAcademico: estatus as EstatusAcademico },
          });
        } else if (usuario.rol === RolUsuario.MAESTRO) {
          await tx.perfilMaestro.update({
            where: { usuarioId: id },
            data: {
              estatus: estatus as EstatusEmpleado,
              tipoLicencia: (opciones.tipoLicencia as TipoLicencia) ?? undefined,
              motivoBaja: (opciones.motivoBaja as MotivoBaja) ?? undefined,
            },
          });
        } else {
          await tx.perfilAdministrativo.update({
            where: { usuarioId: id },
            data: {
              estatus: estatus as EstatusEmpleado,
              tipoLicencia: (opciones.tipoLicencia as TipoLicencia) ?? undefined,
              motivoBaja: (opciones.motivoBaja as MotivoBaja) ?? undefined,
            },
          });
        }

        // `Usuario.activo` (estatus avanzado, 2026-08-26) — solo se toca
        // para MAESTRO/ADMINISTRATIVO, NUNCA para ALUMNO (regla 3, baja
        // lógica de alumno sigue cosmética, sin revocar acceso).
        let activoNuevo: boolean | undefined;
        if (
          usuario.rol === RolUsuario.MAESTRO ||
          usuario.rol === RolUsuario.ADMINISTRATIVO
        ) {
          activoNuevo = this.calcularActivoPorEstatus(
            estatus,
            opciones.motivoBaja,
          );
          await tx.usuario.update({
            where: { id },
            data: { activo: activoNuevo },
          });
        }

        // Regla 5 de CLAUDE.md raíz — RegistroAuditoria solo se crea acá,
        // automáticamente, dentro de la misma transacción del cambio.
        await tx.registroAuditoria.create({
          data: {
            usuarioId: actorUsuarioId,
            sedeId,
            accion: AccionAuditoria.CAMBIO_ESTATUS,
            entidad: 'Usuario',
            entidadId: id,
            detalle: {
              rol: usuario.rol,
              estatusNuevo: estatus,
              tipoLicencia: opciones.tipoLicencia,
              motivoBaja: opciones.motivoBaja,
              cuentaRevocada: activoNuevo === false,
            },
          },
        });
      });

      return { ok: true };
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof BadRequestException ||
        err instanceof ForbiddenException
      ) {
        throw err;
      }

      // Regla 12 de CLAUDE.md raíz — loguear el error completo server-side
      // antes de responder, aunque el cliente no reciba el detalle.
      console.error(
        '[PersonasService.cambiarEstatus] Error inesperado cambiando estatus:',
        err,
      );
      throw new InternalServerErrorException({
        error: 'Error inesperado al cambiar el estatus',
        code: 'SERVER_ERROR',
      });
    }
  }

  /**
   * `POST /personas/:id/resetear-password` — disparado por un ADMINISTRATIVO
   * desde el CRUD (sin autoservicio, decisión explícita del usuario). Genera
   * un link de recuperación NATIVO de Supabase Auth (`generateLink`, tipo
   * `recovery`) y lo envía por Mailgun al `correoPersonal` de la persona — el
   * cambio de contraseña real ocurre después, 100% client-side, cuando la
   * persona abre ese link (`supabase.auth.updateUser()`, ver
   * `app/restablecer-password/page.tsx`).
   *
   * A diferencia de `cambiarEstatus`, el correo NO es best-effort: si Mailgun
   * falla, este método propaga el error como `500 SERVER_ERROR` (ver
   * `MailService.enviarCorreoReseteoPassword`).
   */
  async resetearPassword(
    id: string,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<{ ok: true }> {
    try {
      const usuario = await this.prisma.usuario.findFirst({
        where: { id, sedeId },
        select: {
          id: true,
          email: true,
          rol: true,
          perfilAlumno: {
            select: { nombres: true, apellidoPaterno: true, apellidoMaterno: true },
          },
          perfilMaestro: {
            select: { nombres: true, apellidoPaterno: true, apellidoMaterno: true },
          },
          perfilAdministrativo: {
            select: {
              nombres: true,
              apellidoPaterno: true,
              apellidoMaterno: true,
              nivelPermiso: true,
            },
          },
        },
      });

      if (!usuario) {
        throw new NotFoundException({
          error: 'Persona no encontrada en tu sede',
          code: 'NOT_FOUND',
        });
      }

      if (usuario.rol === RolUsuario.ADMINISTRATIVO && usuario.perfilAdministrativo) {
        const perfilActor = await this.prisma.perfilAdministrativo.findUnique({
          where: { usuarioId: actorUsuarioId },
          select: { nivelPermiso: true },
        });
        const nivelActor = perfilActor?.nivelPermiso ?? NivelPermiso.AUXILIAR;

        if (nivelActor === NivelPermiso.AUXILIAR) {
          throw new ForbiddenException({
            error:
              'Un usuario con nivel AUXILIAR no puede resetear la contraseña de personal administrativo',
            code: 'NIVEL_PERMISO_INSUFICIENTE',
          });
        }

        const rangoActor = PersonasService.JERARQUIA_NIVEL_PERMISO[nivelActor];
        const rangoObjetivo =
          PersonasService.JERARQUIA_NIVEL_PERMISO[
            usuario.perfilAdministrativo.nivelPermiso
          ];

        if (rangoActor < rangoObjetivo) {
          throw new ForbiddenException({
            error:
              'No tienes nivel de permiso suficiente para resetear la contraseña de este administrativo',
            code: 'NIVEL_PERMISO_INSUFICIENTE',
          });
        }
      }

      const perfil =
        usuario.perfilAlumno ?? usuario.perfilMaestro ?? usuario.perfilAdministrativo;
      const nombreCompleto = perfil
        ? [perfil.nombres, perfil.apellidoPaterno, perfil.apellidoMaterno]
            .filter(Boolean)
            .join(' ')
        : usuario.email;

      const correos = await obtenerCorreosPersonales(this.prisma, [id]);
      const correoPersonal = correos[0]?.correoPersonal;

      if (!correoPersonal) {
        console.error(
          '[PersonasService.resetearPassword] La persona no tiene correoPersonal registrado:',
          { id },
        );
        throw new InternalServerErrorException({
          error: 'Error inesperado al resetear la contraseña',
          code: 'SERVER_ERROR',
        });
      }

      const client = await this.getClient();
      const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
      const { data, error } = await client.auth.admin.generateLink({
        type: 'recovery',
        email: usuario.email,
        options: { redirectTo: `${frontendUrl}/restablecer-password` },
      });

      if (error || !data?.properties?.action_link) {
        console.error(
          '[PersonasService.resetearPassword] Error generando el link de recuperación en Supabase Auth:',
          error,
        );
        throw new InternalServerErrorException({
          error: 'Error inesperado al resetear la contraseña',
          code: 'SERVER_ERROR',
        });
      }

      // El correo NO es best-effort acá (ver comentario del método) — si
      // lanza, cae al catch de abajo y se mapea a 500 SERVER_ERROR.
      await this.mailService.enviarCorreoReseteoPassword({
        nombreCompleto,
        correoDestino: correoPersonal,
        linkReseteo: data.properties.action_link,
      });

      try {
        await this.prisma.registroAuditoria.create({
          data: {
            usuarioId: actorUsuarioId,
            sedeId,
            accion: AccionAuditoria.RESETEO_PASSWORD,
            entidad: 'Usuario',
            entidadId: id,
            detalle: { rol: usuario.rol },
          },
        });
      } catch (err) {
        // El link ya se generó y el correo ya se envió — no hay nada que
        // compensar si solo falla la auditoría (regla 12, mismo criterio que
        // el fallback de `AuthService.cambiarPassword`).
        console.error(
          '[PersonasService.resetearPassword] El correo se envió pero falló el RegistroAuditoria:',
          err,
        );
      }

      return { ok: true };
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof ForbiddenException ||
        err instanceof InternalServerErrorException
      ) {
        throw err;
      }

      console.error(
        '[PersonasService.resetearPassword] Error inesperado reseteando contraseña:',
        err,
      );
      throw new InternalServerErrorException({
        error: 'Error inesperado al resetear la contraseña',
        code: 'SERVER_ERROR',
      });
    }
  }
}
