import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { AlcanceDestino, CategoriaEvento } from '@prisma/client';

const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Query params de `GET /eventos/listado` — Fase 15 polish (2026-09-02).
 * Todos opcionales: sin ninguno, lista todos los eventos BASE de la sede,
 * paginados. `desde`/`hasta` filtran por `EventoCalendario.fechaInicio` del
 * evento base (este endpoint NO expande ocurrencias, a diferencia de
 * `GET /eventos`) y NO tienen tope de rango.
 *
 * `@Matches(YYYY-MM-DD)` en vez de `@IsDateString()` — mismo criterio que
 * `ListarEventosQueryDto`: `isISO8601` también acepta datetimes completos,
 * que rompen las asunciones de fecha-sola de `aFechaUTC` en el service.
 *
 * `page`/`limit` con `@Type(() => Number)` — mismo patrón que
 * `ListarGruposQueryDto` / `ListarPersonasQueryDto` (el `ValidationPipe`
 * global con `transform: true` coerciona el query string a número); los
 * defaults (1 / 20) viven en el service, no acá.
 */
export class ListarEventosListadoQueryDto {
  @IsOptional()
  @Matches(FECHA, { message: 'desde debe tener formato YYYY-MM-DD' })
  desde?: string;

  @IsOptional()
  @Matches(FECHA, { message: 'hasta debe tener formato YYYY-MM-DD' })
  hasta?: string;

  @IsOptional()
  @IsEnum(AlcanceDestino, { message: 'alcanceTipo inválido' })
  alcanceTipo?: AlcanceDestino;

  @IsOptional()
  @IsEnum(CategoriaEvento, { message: 'categoria inválida' })
  categoria?: CategoriaEvento;

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
