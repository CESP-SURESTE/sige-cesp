import { AccionAuditoria } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

/**
 * Query de `GET /platform-admin/auditoria` — bitácora cross-sede paginada.
 *
 * Todos los filtros son opcionales. El `ValidationPipe` global
 * (`setup-app.ts`, `whitelist` + `forbidNonWhitelisted`) mapea cualquier
 * error de class-validator al contrato `{ error, code: 'VALIDATION_ERROR' }`,
 * así que no hace falta lógica extra acá para los 400 de formato/rango.
 *
 * La regla cruzada `hasta < desde` NO se puede expresar con un decorador
 * simple — se valida en `PlatformAdminService.listarAuditoria` (mismo
 * criterio que las fechas de Calendario).
 */
export class ListarAuditoriaQueryDto {
  @IsOptional()
  @IsUUID()
  sedeId?: string;

  @IsOptional()
  @IsEnum(AccionAuditoria)
  accion?: AccionAuditoria;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  entidad?: string;

  @IsOptional()
  @IsUUID()
  actorId?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'desde debe ser YYYY-MM-DD' })
  desde?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'hasta debe ser YYYY-MM-DD' })
  hasta?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
