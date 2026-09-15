import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { EstatusCarrera, ModalidadCarrera, NivelCarrera } from '@prisma/client';

/**
 * `PATCH /carreras/:id` — Fase 6, Día 21. Mismos campos que
 * `CrearCarreraDto`, todos opcionales (un `PATCH` vacío `{}` es válido,
 * mismo criterio que `ActualizarSedeDto` de Día 20), más `estatus`
 * (`EstatusCarrera`) — única forma de cambiarlo, no existe `DELETE`
 * `/carreras/:id` hoy (fuera de alcance explícito, ver `docs/roadmap.md`).
 */
export class ActualizarCarreraDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'nombre no puede ser vacío' })
  nombre?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'clave no puede ser vacía' })
  clave?: string;

  @IsOptional()
  @IsInt({ message: 'duracion debe ser un entero' })
  @Min(1, { message: 'duracion debe ser al menos 1' })
  duracion?: number;

  @IsOptional()
  @IsEnum(NivelCarrera, {
    message: 'nivel debe ser TECNICO, LICENCIATURA, MAESTRIA o DOCTORADO',
  })
  nivel?: NivelCarrera;

  @IsOptional()
  @IsEnum(ModalidadCarrera, {
    message: 'modalidad debe ser PRESENCIAL, SEMIPRESENCIAL o EN_LINEA',
  })
  modalidad?: ModalidadCarrera;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'rvoe no puede ser vacío' })
  rvoe?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'procedenciaRvoe no puede ser vacío' })
  procedenciaRvoe?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'descripcion no puede ser vacía' })
  descripcion?: string;

  @IsOptional()
  @IsEnum(EstatusCarrera, { message: 'estatus debe ser ACTIVA o INACTIVA' })
  estatus?: EstatusCarrera;
}
