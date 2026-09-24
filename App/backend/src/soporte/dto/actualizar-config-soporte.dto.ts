import { IsBoolean } from 'class-validator';

export class ActualizarConfigSoporteDto {
  @IsBoolean({ message: 'activo debe ser booleano' })
  activo!: boolean;
}
