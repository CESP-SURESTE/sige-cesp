import { IsInt, IsNotEmpty, IsString, IsUUID, Min } from 'class-validator';

/**
 * `POST /grupos` — Fase 9, Día 28. Todos los campos son requeridos;
 * `sedeId` NUNCA va acá (regla 2 de CLAUDE.md raíz — sale de
 * `@SedeActual()` en el controller). Validaciones cross-campo (cicloActual
 * vs. duracion de la carrera, unicidad de nombre por sede+periodo,
 * pertenencia de carrera/salón a la sede) viven en `GruposService.crear`,
 * no acá — mismo criterio que `PersonasService`/`CarrerasService`.
 */
export class CrearGrupoDto {
  @IsUUID('4', { message: 'carreraId debe ser un UUID válido' })
  carreraId!: string;

  @IsUUID('4', { message: 'salonId debe ser un UUID válido' })
  salonId!: string;

  @IsString()
  @IsNotEmpty({ message: 'nombre es requerido' })
  nombre!: string;

  @IsInt({ message: 'anioInicio debe ser un entero' })
  @Min(1, { message: 'anioInicio debe ser al menos 1' })
  anioInicio!: number;

  @IsInt({ message: 'cicloActual debe ser un entero' })
  @Min(1, { message: 'cicloActual debe ser al menos 1' })
  cicloActual!: number;

  @IsInt({ message: 'capacidad debe ser un entero' })
  @Min(1, { message: 'capacidad debe ser al menos 1' })
  capacidad!: number;
}
