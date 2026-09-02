import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';
import { AlcanceDestino, CategoriaEvento } from '@prisma/client';
import { ReglaRecurrenciaDto } from './regla-recurrencia.dto';

export class ActualizarEventoDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'titulo no puede quedar vacío' })
  titulo?: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, {
    message: 'fechaInicio debe tener formato YYYY-MM-DD',
  })
  fechaInicio?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'horaInicio debe tener formato HH:MM (24h)',
  })
  horaInicio?: string;

  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, {
    message: 'fechaFin debe tener formato YYYY-MM-DD',
  })
  fechaFin?: string;

  @IsOptional()
  @IsEnum(CategoriaEvento, { message: 'categoria inválida' })
  categoria?: CategoriaEvento;

  @IsOptional()
  @IsEnum(AlcanceDestino, { message: 'alcanceTipo inválido' })
  alcanceTipo?: AlcanceDestino;

  @IsOptional()
  @IsUUID('4', { message: 'alcanceId debe ser un UUID válido' })
  alcanceId?: string;

  /**
   * `@IsOptional()` deja pasar `null` sin validar (no solo `undefined`) —
   * el tipo lo refleja a propósito: `PATCH { recurrenciaRegla: null }` es
   * la forma real de "quitar la recurrencia" de un evento ya recurrente
   * (`CalendarioService.actualizar` lo mapea a `Prisma.DbNull`).
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => ReglaRecurrenciaDto)
  recurrenciaRegla?: ReglaRecurrenciaDto | null;

  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, {
    message: 'recurrenciaHasta debe tener formato YYYY-MM-DD',
  })
  recurrenciaHasta?: string;
}
