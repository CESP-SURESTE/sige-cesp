import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

/**
 * `PATCH /salones/:id` — Fase 9, día CRUD de Salón. Mismos campos que
 * `CrearSalonDto`, ambos opcionales (un `PATCH` vacío `{}` es válido, mismo
 * criterio que `ActualizarSedeDto`/`ActualizarCarreraDto`).
 */
export class ActualizarSalonDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'nombre no puede ser vacío' })
  nombre?: string;

  @IsOptional()
  @IsInt({ message: 'capacidad debe ser un entero' })
  @Min(1, { message: 'capacidad debe ser al menos 1' })
  capacidad?: number;
}
