import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

/**
 * `POST /salones` — Fase 9, día CRUD de Salón (extiende Día 29). Ambos
 * campos son requeridos; `sedeId` NUNCA va acá (regla 2 de CLAUDE.md raíz —
 * sale de `@SedeActual()` en el controller). Unicidad de `nombre` por sede
 * se valida en `SalonesService.crear`, no acá.
 */
export class CrearSalonDto {
  @IsString()
  @IsNotEmpty({ message: 'nombre es requerido' })
  nombre!: string;

  @IsInt({ message: 'capacidad debe ser un entero' })
  @Min(1, { message: 'capacidad debe ser al menos 1' })
  capacidad!: number;
}
