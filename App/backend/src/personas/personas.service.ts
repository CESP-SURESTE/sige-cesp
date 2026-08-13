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
  EstatusEmpleado,
  NivelPermiso,
  Prisma,
  RolUsuario,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CrearPersonaDto, InfoMedicaDto } from './dto/crear-persona.dto';
import { generateTemporaryPassword } from './temporary-password';

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

  constructor(
    private readonly prisma: PrismaService,
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
    const emailEnUso = await this.prisma.usuario.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (emailEnUso) {
      throw new ConflictException({
        error: 'Ya existe un usuario con ese email',
        code: 'CONFLICT',
      });
    }

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

      const matriculaEnUso = await this.prisma.perfilAlumno.findUnique({
        where: { matricula: dto.perfilAlumno.matricula },
        select: { id: true },
      });
      if (matriculaEnUso) {
        throw new ConflictException({
          error: 'Ya existe un alumno con esa matrícula',
          code: 'CONFLICT',
        });
      }
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

    const temporaryPassword = generateTemporaryPassword();
    const client = await this.getClient();

    // `email_confirm: true` — ver encargo de Día 11: un alta hecha por un
    // admin debe dejar la cuenta lista para usarse de inmediato con la
    // contraseña temporal, sin forzar una confirmación de correo que el
    // usuario nunca pidió (mismo criterio que evitó el bug de Día 10,
    // `CORREO_NO_CONFIRMADO` en `AuthService.login`).
    const { data: authData, error: authError } =
      await client.auth.admin.createUser({
        email: dto.email,
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
            email: dto.email,
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
              matricula: dto.perfilAlumno.matricula,
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
            'Ya existe un registro con ese dato único (email, matrícula o código externo)',
          code: 'CONFLICT',
        });
      }

      throw new InternalServerErrorException({
        error: 'Error inesperado al dar de alta la persona',
        code: 'SERVER_ERROR',
      });
    }
  }
}
