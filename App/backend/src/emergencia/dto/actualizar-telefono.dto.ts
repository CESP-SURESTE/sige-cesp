import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * `PATCH /emergencia/telefonos/:id` — mismos campos que `CrearTelefonoDto`,
 * ambos opcionales (un `PATCH` vacío `{}` es válido, mismo criterio que
 * `ActualizarSalonDto`). Un campo presente no puede ser vacío.
 */
export class ActualizarTelefonoDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'etiqueta no puede ser vacía' })
  etiqueta?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'telefono no puede ser vacío' })
  telefono?: string;
}
