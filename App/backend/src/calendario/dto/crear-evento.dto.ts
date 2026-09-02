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

/**
 * `POST /eventos` — Fase 15, Día 41. `sedeId`/`autorUsuarioId` NUNCA van
 * acá (regla 2 — salen de `@SedeActual()`/`@ActorUsuarioId()`).
 * Validaciones cross-campo (alcance válido, `recurrenciaRegla` ⇒
 * `recurrenciaHasta` requerido) viven en `CalendarioService.crear`, no
 * acá — mismo criterio que `PersonasService`/`GruposService`.
 */
export class CrearEventoDto {
  @IsString()
  @IsNotEmpty({ message: 'titulo es requerido' })
  titulo!: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, {
    message: 'fechaInicio debe tener formato YYYY-MM-DD',
  })
  fechaInicio!: string;

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

  @IsEnum(CategoriaEvento, { message: 'categoria inválida' })
  categoria!: CategoriaEvento;

  @IsEnum(AlcanceDestino, { message: 'alcanceTipo inválido' })
  alcanceTipo!: AlcanceDestino;

  @IsOptional()
  @IsUUID('4', { message: 'alcanceId debe ser un UUID válido' })
  alcanceId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReglaRecurrenciaDto)
  recurrenciaRegla?: ReglaRecurrenciaDto;

  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, {
    message: 'recurrenciaHasta debe tener formato YYYY-MM-DD',
  })
  recurrenciaHasta?: string;
}
