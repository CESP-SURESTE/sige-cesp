import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CrearReporteBugDto {
  @IsString()
  @IsNotEmpty({ message: 'descripcion no puede estar vacía' })
  @MaxLength(2000, { message: 'descripcion no puede exceder 2000 caracteres' })
  descripcion!: string;
}
