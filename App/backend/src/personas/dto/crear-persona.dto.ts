import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  NivelPermiso,
  PuestoAdministrativo,
  RolUsuario,
  TipoContacto,
} from '@prisma/client';

/**
 * Contactos de emergencia + datos de salud — extensión de `POST /personas`
 * (decisión explícita del usuario, 2026-08-12: "que sea en la misma
 * transacción ya que todo se debe cargar a la vez"). El modelo ya existía en
 * `schema.prisma` desde el día 1 (regla 4 de CLAUDE.md raíz), este es el
 * primer código que lo toca.
 *
 * `ContactoDto` (base, sin `tipo`) sirve para `PerfilMaestroDto`/
 * `PerfilAdministrativoDto` — `ContactoMaestro`/`ContactoAdministrativo` no
 * tienen ese campo en el schema. `ContactoAlumnoDto` extiende con `tipo`
 * (`TUTOR`/`EMERGENCIA`), único campo distinto de `ContactoAlumno`.
 *
 * `orden` NO se pide al cliente — regla 1 de CLAUDE.md raíz (nunca persistir
 * algo calculable): es secuencial y se deriva de la posición del contacto en
 * el array (`PersonasService` lo asigna como `índice + 1` al insertar), no un
 * campo que el frontend tenga que enviar ni validar por rango.
 */
export class ContactoDto {
  @IsString()
  @IsNotEmpty({ message: 'nombre del contacto es requerido' })
  nombre!: string;

  @IsString()
  @IsNotEmpty({ message: 'telefono del contacto es requerido' })
  telefono!: string;

  @IsOptional()
  @IsEmail({}, { message: 'correo del contacto tiene un formato inválido' })
  correo?: string;

  @IsString()
  @IsNotEmpty({ message: 'parentesco del contacto es requerido' })
  parentesco!: string;
}

export class ContactoAlumnoDto extends ContactoDto {
  @IsEnum(TipoContacto, {
    message: 'tipo de contacto debe ser TUTOR o EMERGENCIA',
  })
  tipo!: TipoContacto;
}

/**
 * `InfoMedicaAlumno`/`InfoMedicaMaestro`/`InfoMedicaAdministrativo` son
 * idénticos entre sí en `schema.prisma` — un solo DTO reutilizado los 3
 * roles (1-a-1 con el perfil, mismo espíritu que `MallaCurricular` es
 * 1-a-1 con `Carrera`, aunque acá es `create` directo dentro de la
 * transacción de alta, no un `upsert` posterior).
 */
export class InfoMedicaDto {
  @IsBoolean({ message: 'tieneCondicionMedica debe ser booleano' })
  tieneCondicionMedica!: boolean;

  @IsOptional()
  @IsString()
  padecimiento?: string;

  @IsOptional()
  @IsString()
  medicamentos?: string;

  @IsOptional()
  @IsString()
  alergias?: string;

  @IsOptional()
  @IsString()
  tratamientoAdicional?: string;
}

/**
 * DTOs de `POST /personas` — Fase 4, Día 11.
 *
 * Decisión de diseño (documentada acá, ver también el encargo de la tarea):
 * un solo DTO (`CrearPersonaDto`) con un discriminador `rol` y TRES campos de
 * perfil opcionales (`perfilAlumno` / `perfilMaestro` / `perfilAdministrativo`),
 * cada uno validado condicionalmente con `@ValidateIf` según el valor de
 * `rol` — en vez de 3 DTOs completamente separados a nivel de endpoint (que
 * hubiera obligado a un discriminador manual en el controller/pipe) o un solo
 * DTO plano con todos los campos posibles de los 3 perfiles mezclados (que
 * hubiera hecho imposible saber qué campos son requeridos para cada rol solo
 * leyendo la clase). Este approach:
 *   - Mantiene un único shape de body/response, más simple para el frontend.
 *   - Usa `@ValidateNested()` + `@Type(() => ...)` (class-transformer) para
 *     que cada sub-perfil tenga sus propias reglas de campos requeridos/
 *     opcionales — `validationExceptionFactory` (`common/pipes/`) ya sabe
 *     recorrer `error.children` para DTOs anidados.
 *   - `@IsDefined()` antes de `@ValidateNested()` en cada perfil: si `rol`
 *     coincide pero el perfil correspondiente no vino en el body, falla
 *     explícito en vez de que `PersonasService` reciba `undefined` sin razón
 *     clara.
 *
 * Nota: los otros 2 campos de perfil (los que NO coinciden con `rol`) siguen
 * teniendo decorador de validación (para que `whitelist` no los descarte en
 * silencio si vienen por error en el body), pero `@ValidateIf` nunca corre su
 * validación y `PersonasService` los ignora — no se valida activamente que
 * NO vengan, solo que se ignoran si vienen.
 *
 * `PerfilMaestroDto`/`PerfilAdministrativoDto` NO tienen campo `estatus`
 * (corrección de QA manual, sesión 2026-08-12): no tiene sentido dar de alta
 * a alguien ya en `BAJA`/`LICENCIA` — `PersonasService.altaPersona` fuerza
 * `estatus: ACTIVO` siempre en la creación. Cambiar el estatus después de la
 * alta es un flujo distinto (regla 3 de `CLAUDE.md` raíz — baja lógica vía
 * `PATCH /:id/estatus`), que todavía no existe para `PerfilMaestro`/
 * `PerfilAdministrativo` — fuera de alcance de esta corrección.
 *
 * `PerfilAlumnoDto` NO tiene campo `matricula` (feature 2026-08-18): dejó de
 * ser texto libre capturado por el admin — `PersonasService.altaPersona` la
 * genera automáticamente dentro de la misma transacción, vía el contador
 * atómico `ContadorMatricula` (`schema.prisma`). Formato `A` + año real del
 * servidor (4 dígitos) + secuencial de 5 dígitos con ceros a la izquierda
 * (`A202600001`), secuencia global (todas las sedes) y continua durante el
 * año (se reinicia a 1 cada año nuevo). La matrícula generada se devuelve al
 * cliente en la respuesta de `POST /personas` (`matricula` a nivel raíz,
 * junto a `temporaryPassword`), no en el sub-objeto `usuario`/`perfilAlumno`.
 */
export class PerfilAlumnoDto {
  @IsString()
  @IsNotEmpty({ message: 'nombres es requerido' })
  nombres!: string;

  @IsString()
  @IsNotEmpty({ message: 'apellidoPaterno es requerido' })
  apellidoPaterno!: string;

  @IsOptional()
  @IsString()
  apellidoMaterno?: string;

  @IsOptional()
  @IsString()
  curp?: string;

  @IsDateString(
    {},
    { message: 'fechaNacimiento debe ser una fecha ISO 8601 válida' },
  )
  fechaNacimiento!: string;

  @IsEmail({}, { message: 'correoPersonal tiene un formato inválido' })
  correoPersonal!: string;

  @IsUUID('4', { message: 'carreraId debe ser un UUID válido' })
  carreraId!: string;

  @IsString()
  @IsNotEmpty({ message: 'periodoIngreso es requerido' })
  periodoIngreso!: string;

  @IsInt({ message: 'semestreActual debe ser un entero' })
  @Min(1, { message: 'semestreActual debe ser al menos 1' })
  semestreActual!: number;

  @IsOptional()
  @IsString()
  telefono?: string;

  @ArrayMinSize(1, { message: 'contactos debe tener al menos 1 elemento' })
  @ArrayMaxSize(3, { message: 'contactos debe tener máximo 3 elementos' })
  @ValidateNested({ each: true })
  @Type(() => ContactoAlumnoDto)
  contactos!: ContactoAlumnoDto[];

  @IsDefined({ message: 'infoMedica es requerido' })
  @ValidateNested()
  @Type(() => InfoMedicaDto)
  infoMedica!: InfoMedicaDto;
}

export class PerfilMaestroDto {
  @IsString()
  @IsNotEmpty({ message: 'nombres es requerido' })
  nombres!: string;

  @IsString()
  @IsNotEmpty({ message: 'apellidoPaterno es requerido' })
  apellidoPaterno!: string;

  @IsOptional()
  @IsString()
  apellidoMaterno?: string;

  @IsString()
  @IsNotEmpty({ message: 'curp es requerido' })
  curp!: string;

  @IsOptional()
  @IsString()
  cedulaProfesional?: string;

  @IsEmail({}, { message: 'correoPersonal tiene un formato inválido' })
  correoPersonal!: string;

  @IsString()
  @IsNotEmpty({ message: 'telefono es requerido' })
  telefono!: string;

  @IsDateString(
    {},
    { message: 'fechaContratacion debe ser una fecha ISO 8601 válida' },
  )
  fechaContratacion!: string;

  @ArrayMinSize(1, { message: 'contactos debe tener al menos 1 elemento' })
  @ArrayMaxSize(3, { message: 'contactos debe tener máximo 3 elementos' })
  @ValidateNested({ each: true })
  @Type(() => ContactoDto)
  contactos!: ContactoDto[];

  @IsDefined({ message: 'infoMedica es requerido' })
  @ValidateNested()
  @Type(() => InfoMedicaDto)
  infoMedica!: InfoMedicaDto;
}

export class PerfilAdministrativoDto {
  @IsString()
  @IsNotEmpty({ message: 'nombres es requerido' })
  nombres!: string;

  @IsString()
  @IsNotEmpty({ message: 'apellidoPaterno es requerido' })
  apellidoPaterno!: string;

  @IsOptional()
  @IsString()
  apellidoMaterno?: string;

  @IsString()
  @IsNotEmpty({ message: 'curp es requerido' })
  curp!: string;

  @IsEmail({}, { message: 'correoPersonal tiene un formato inválido' })
  correoPersonal!: string;

  @IsString()
  @IsNotEmpty({ message: 'telefono es requerido' })
  telefono!: string;

  @IsDateString(
    {},
    { message: 'fechaContratacion debe ser una fecha ISO 8601 válida' },
  )
  fechaContratacion!: string;

  @IsEnum(PuestoAdministrativo)
  puesto!: PuestoAdministrativo;

  /**
   * Default `AUXILIAR` (mínimo privilegio) en `PersonasService` si no viene.
   * Restringido por jerarquía (regla 7 de CLAUDE.md raíz, corregido tras
   * observación A de QA — Día 11): `PersonasService.verificarJerarquiaNivelPermiso`
   * rechaza con 403 `NIVEL_PERMISO_INSUFICIENTE` si el actor no tiene nivel
   * suficiente para asignar el nivel pedido — ver `PersonasController`.
   */
  @IsOptional()
  @IsEnum(NivelPermiso)
  nivelPermiso?: NivelPermiso;

  @ArrayMinSize(1, { message: 'contactos debe tener al menos 1 elemento' })
  @ArrayMaxSize(3, { message: 'contactos debe tener máximo 3 elementos' })
  @ValidateNested({ each: true })
  @Type(() => ContactoDto)
  contactos!: ContactoDto[];

  @IsDefined({ message: 'infoMedica es requerido' })
  @ValidateNested()
  @Type(() => InfoMedicaDto)
  infoMedica!: InfoMedicaDto;
}

export class CrearPersonaDto {
  // `email` (login) YA NO lo captura el cliente (feature 2026-08-18, mismo
  // criterio que `matricula` en `PerfilAlumnoDto`) — `PersonasService.altaPersona`
  // lo genera internamente para LOS 3 ROLES antes de tocar Supabase Auth (ver
  // `generarLoginAlumno`/`generarLoginPersonal`). Si el cliente lo manda de
  // todos modos, `ValidationPipe` (`whitelist: true, forbidNonWhitelisted:
  // true`, `setup-app.ts`) lo rechaza con 400 VALIDATION_ERROR — no se
  // descarta en silencio (confirmado con test e2e dedicado).

  @IsEnum(RolUsuario, {
    message: 'rol debe ser ALUMNO, MAESTRO o ADMINISTRATIVO',
  })
  rol!: RolUsuario;

  @IsOptional()
  @IsString()
  codigoExterno?: string;

  @ValidateIf((dto: CrearPersonaDto) => dto.rol === RolUsuario.ALUMNO)
  @IsDefined({ message: 'perfilAlumno es requerido cuando rol es ALUMNO' })
  @ValidateNested()
  @Type(() => PerfilAlumnoDto)
  perfilAlumno?: PerfilAlumnoDto;

  @ValidateIf((dto: CrearPersonaDto) => dto.rol === RolUsuario.MAESTRO)
  @IsDefined({ message: 'perfilMaestro es requerido cuando rol es MAESTRO' })
  @ValidateNested()
  @Type(() => PerfilMaestroDto)
  perfilMaestro?: PerfilMaestroDto;

  @ValidateIf((dto: CrearPersonaDto) => dto.rol === RolUsuario.ADMINISTRATIVO)
  @IsDefined({
    message: 'perfilAdministrativo es requerido cuando rol es ADMINISTRATIVO',
  })
  @ValidateNested()
  @Type(() => PerfilAdministrativoDto)
  perfilAdministrativo?: PerfilAdministrativoDto;
}
