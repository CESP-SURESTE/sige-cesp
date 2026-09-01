import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Nested DTO de `recurrenciaRegla` — Fase 15, Día 41. Mismo shape que
 * `ReglaRecurrencia` de `recurrencia.util.ts` (Task 2) — mantener en sync
 * a mano si uno cambia.
 */
export class ReglaRecurrenciaDto {
  @IsIn(['DIARIA', 'SEMANAL', 'MENSUAL'], {
    message: 'frecuencia debe ser DIARIA, SEMANAL o MENSUAL',
  })
  frecuencia!: 'DIARIA' | 'SEMANAL' | 'MENSUAL';

  @IsInt({ message: 'intervalo debe ser un entero' })
  @Min(1, { message: 'intervalo debe ser al menos 1' })
  intervalo!: number;

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true, message: 'diasSemana debe ser un arreglo de enteros' })
  @Min(0, { each: true, message: 'diasSemana: cada valor debe ser 0-6' })
  @Max(6, { each: true, message: 'diasSemana: cada valor debe ser 0-6' })
  diasSemana?: number[];

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'diaMes debe ser un entero' })
  @Min(-1, { message: 'diaMes debe ser -1 (último día) o 1-31' })
  @Max(31, { message: 'diaMes debe ser -1 (último día) o 1-31' })
  diaMes?: number;
}
