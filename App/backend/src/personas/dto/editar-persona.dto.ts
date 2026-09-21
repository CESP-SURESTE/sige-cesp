import { Type } from 'class-transformer';
import { IsOptional, IsString, ValidateNested } from 'class-validator';
import {
  PerfilAdministrativoDto,
  PerfilAlumnoDto,
  PerfilMaestroDto,
} from './crear-persona.dto';

/**
 * Body de `PATCH /personas/:id` — feature "Edición de datos de persona"
 * (2026-09-20, spec `docs/superpowers/specs/2026-09-20-edicion-datos-persona-design.md`).
 *
 * Reusa TAL CUAL `PerfilAlumnoDto`/`PerfilMaestroDto`/`PerfilAdministrativoDto`
 * de `crear-persona.dto.ts` (incluidos sus `contactos`/`infoMedica`
 * anidados) — el alcance de "editable" es idéntico al de "capturable en el
 * alta" para los 3 roles (ver spec, sección "Alcance"), así que no hace
 * falta declarar campos nuevos ni relajar requeridos/opcionales: son
 * exactamente los mismos.
 *
 * A diferencia de `CrearPersonaDto`, esta clase NO tiene un campo `rol`
 * discriminador — el `rol` real de la persona sale de la DB (`:id` +
 * `sedeId`), no lo manda el cliente. Por eso los 3 sub-perfiles son
 * simplemente `@IsOptional()` (sin `@ValidateIf` condicionado a un sibling):
 * el que corresponde al `rol` real se exige presente en
 * `PersonasService.editarPersona` (chequeo defensivo, mismo criterio que
 * `altaPersona`), no acá.
 */
export class EditarPersonaDto {
  @IsOptional()
  @IsString()
  codigoExterno?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PerfilAlumnoDto)
  perfilAlumno?: PerfilAlumnoDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PerfilMaestroDto)
  perfilMaestro?: PerfilMaestroDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PerfilAdministrativoDto)
  perfilAdministrativo?: PerfilAdministrativoDto;
}
