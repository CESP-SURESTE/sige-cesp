import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { AlcanceDestino } from '@prisma/client';

/**
 * `POST /avisos` — Fase 16, Día 46. `sedeId` NUNCA va acá (regla 2 — sale
 * de `@SedeActual()`). La coherencia `alcanceTipo` ↔ `alcanceId` (SEDE sin
 * id, CARRERA/GRUPO con id) la valida `validarAlcancePublicacion` en el
 * service — acá solo el shape de cada campo.
 */
export class CrearAvisoDto {
  @IsString()
  @IsNotEmpty({ message: 'titulo es requerido' })
  @MaxLength(160, { message: 'titulo no puede exceder 160 caracteres' })
  titulo!: string;

  @IsString()
  @IsNotEmpty({ message: 'cuerpo es requerido' })
  @MaxLength(5000, { message: 'cuerpo no puede exceder 5000 caracteres' })
  cuerpo!: string;

  @IsEnum(AlcanceDestino, {
    message: 'alcanceTipo debe ser SEDE, CARRERA o GRUPO',
  })
  alcanceTipo!: AlcanceDestino;

  @IsOptional()
  @IsUUID('4', { message: 'alcanceId debe ser un UUID válido' })
  alcanceId?: string;
}
