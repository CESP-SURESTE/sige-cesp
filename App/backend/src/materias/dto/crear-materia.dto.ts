import { IsInt, IsNotEmpty, IsString, IsUUID, Min } from 'class-validator';

/**
 * `POST /materias` — Fase 12, Día 33. `sedeId` NUNCA va acá (regla 2 — sale
 * de `@SedeActual()`). El rango real de `ciclo` (1..carrera.duracion) se
 * valida en el service porque depende de la carrera; acá solo el piso.
 */
export class CrearMateriaDto {
  @IsString()
  @IsNotEmpty({ message: 'nombre es requerido' })
  nombre!: string;

  @IsUUID('4', { message: 'carreraId debe ser un UUID válido' })
  carreraId!: string;

  @IsInt({ message: 'ciclo debe ser un entero' })
  @Min(1, { message: 'ciclo debe ser al menos 1' })
  ciclo!: number;
}
