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
  NivelPermiso,
  Prisma,
  RolUsuario,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { CrearPersonaDto, InfoMedicaDto } from './dto/crear-persona.dto';
import { ListarPersonasQueryDto } from './dto/listar-personas.query.dto';
import { generateTemporaryPassword } from './temporary-password';

export interface PersonaListItemAlumno {
  usuarioId: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  matricula: string;
  carrera: { id: string; nombre: string };
  estatusAcademico: EstatusAcademico;
  semestreActual: number;
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

export interface ListarPersonasResult {
  data: PersonaListItemAlumno[] | PersonaListItemMaestro[];
  page: number;
  limit: number;
  total: number;
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
    } else if (dto.rol === RolUsuario.MAESTRO && !dto.perfilMaestro) {
      throw new BadRequestException({
        error: 'perfilMaestro es requerido para rol MAESTRO',
        code: 'VALIDATION_ERROR',
      });
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
              semestreActual: dto.perfilAlumno.semestreActual,
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
        // `usuarioId` es el ACTOR (el admin que hace la request, sacado del
        // JWT — `actorUsuarioId`), no la persona recién creada; esa va en
        // `entidadId`.
        await tx.registroAuditoria.create({
          data: {
            usuarioId: actorUsuarioId,
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
   * `GET /personas?rol=ALUMNO|MAESTRO&...` — Fase 5, Día 19.
   *
   * "Listados PARA administrativos" = listados que un ADMINISTRATIVO
   * consulta, de ALUMNO y MAESTRO — NO un listado de ADMINISTRATIVO mismos
   * (fuera de alcance, ver encargo del día).
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
            semestreActual: true,
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
          semestreActual: alumno.semestreActual,
          activo: alumno.usuario.activo,
        })),
        page,
        limit,
        total,
      };
    }

    // query.rol === RolUsuario.MAESTRO — el DTO (`@IsIn`) ya descarta
    // cualquier otro valor (incluido ADMINISTRATIVO) con 400 VALIDATION_ERROR
    // antes de llegar acá.
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
        activo: maestro.usuario.activo,
      })),
      page,
      limit,
      total,
    };
  }
}
