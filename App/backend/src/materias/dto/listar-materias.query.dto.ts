import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

/**
 * Query de `GET /materias` — Fase 12, Día 33. `carreraId` REQUERIDO (a
 * diferencia de los filtros opcionales de `GET /grupos`). `ciclo` filtro
 * opcional. `@Type(() => Number)` porque el `ValidationPipe` global
 * (`setup-app.ts`, `transform: true`) coerciona query params.
 */
export class ListarMateriasQueryDto {
  @IsUUID('4', { message: 'carreraId debe ser un UUID válido' })
  carreraId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'ciclo debe ser un entero' })
  @Min(1, { message: 'ciclo debe ser al menos 1' })
  ciclo?: number;
}
