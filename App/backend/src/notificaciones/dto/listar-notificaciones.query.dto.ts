import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Query params de `GET /notificaciones` — Fase 14, Día 38. Mismo shape de
 * paginación que `ListarGruposQueryDto` (`page`/`limit` con
 * `@Type(() => Number)`; el `ValidationPipe` global con `transform: true`
 * coerciona el query param). Defaults (1 / 20) se aplican en el service.
 */
export class ListarNotificacionesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page debe ser un entero' })
  @Min(1, { message: 'page debe ser al menos 1' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit debe ser un entero' })
  @Min(1, { message: 'limit debe ser al menos 1' })
  @Max(100, { message: 'limit debe ser máximo 100' })
  limit?: number;
}
