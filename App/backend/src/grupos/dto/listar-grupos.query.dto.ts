import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/**
 * Query params de `GET /grupos` — Fase 9, Día 28. Todos los filtros son
 * opcionales — sin ninguno, devuelve todos los grupos de la sede,
 * paginados. Mismo shape de paginación que `ListarPersonasQueryDto` (Día
 * 19): `page`/`limit` con `@Type(() => Number)` (el `ValidationPipe`
 * global con `transform: true` ya coerciona tipos primitivos en query
 * params, `setup-app.ts`).
 */
export class ListarGruposQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'anioInicio debe ser un entero' })
  anioInicio?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'cicloActual debe ser un entero' })
  cicloActual?: number;

  @IsOptional()
  @IsUUID('4', { message: 'carreraId debe ser un UUID válido' })
  carreraId?: string;

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
