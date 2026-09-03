import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Query de `GET /avisos` — Fase 16. Paginación estándar del contrato
 * (`page`/`limit`), mismo patrón que `ListarEventosListadoQueryDto` /
 * `ListarGruposQueryDto`: `@Type(() => Number)` para que el `ValidationPipe`
 * global (`transform: true`) coercione el query string a número. Los
 * defaults (1 / 20) viven en el controller, no acá.
 */
export class ListarAvisosQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page debe ser un entero' })
  @Min(1, { message: 'page debe ser al menos 1' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit debe ser un entero' })
  @Min(1, { message: 'limit debe ser al menos 1' })
  @Max(100, { message: 'limit no puede exceder 100' })
  limit?: number;
}
