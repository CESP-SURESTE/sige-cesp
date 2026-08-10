import { Type } from 'class-transformer';
import {
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
  EstatusEmpleado,
  NivelPermiso,
  PuestoAdministrativo,
  RolUsuario,
} from '@prisma/client';

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

  @IsString()
  @IsNotEmpty({ message: 'matricula es requerida' })
  matricula!: string;

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

  /** Default `ACTIVO` en `PersonasService` si no viene. */
  @IsOptional()
  @IsEnum(EstatusEmpleado)
  estatus?: EstatusEmpleado;
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

  /** Default `ACTIVO` en `PersonasService` si no viene. */
  @IsOptional()
  @IsEnum(EstatusEmpleado)
  estatus?: EstatusEmpleado;

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
}

export class CrearPersonaDto {
  @IsEmail({}, { message: 'El email tiene un formato inválido' })
  email!: string;

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
