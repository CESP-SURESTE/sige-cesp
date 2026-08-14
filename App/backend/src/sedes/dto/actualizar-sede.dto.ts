import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class ActualizarSedeDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'nombre no puede ser vacío' })
  nombre?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'direccion no puede ser vacía' })
  direccion?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'ubicacionReferencia no puede ser vacía' })
  ubicacionReferencia?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'telefono no puede ser vacío' })
  telefono?: string;

  @IsOptional()
  @IsNumber({}, { message: 'costoRenta debe ser un número' })
  costoRenta?: number;
}
