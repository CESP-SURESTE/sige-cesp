import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CrearSedeDto {
  @IsString()
  @IsNotEmpty({ message: 'nombre es requerido' })
  nombre!: string;

  @IsString()
  @IsNotEmpty({ message: 'direccion es requerida' })
  direccion!: string;

  @IsString()
  @IsNotEmpty({ message: 'ubicacionReferencia es requerida' })
  ubicacionReferencia!: string;

  @IsString()
  @IsNotEmpty({ message: 'telefono es requerido' })
  telefono!: string;

  @IsOptional()
  @IsNumber({}, { message: 'costoRenta debe ser un número' })
  costoRenta?: number;
}
