import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

/**
 * Query de `GET /emergencia/buscar` — módulo de emergencia (2026-09-08).
 * `q` requerido, mínimo 2 caracteres tras `trim` (si no → 400, evita volcar
 * toda la sede). `limit` opcional (default 20 en el controller, máx 50).
 * `@Type(() => Number)` para que el `ValidationPipe` global (`transform: true`,
 * `setup-app.ts`) coercione el query string — mismo patrón que
 * `ListarGruposQueryDto`.
 */
export class BuscarEmergenciaQueryDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2, { message: 'q debe tener al menos 2 caracteres' })
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit debe ser un entero' })
  @Min(1, { message: 'limit debe ser al menos 1' })
  @Max(50, { message: 'limit no puede exceder 50' })
  limit?: number;
}
