import { IsNotEmpty, IsString } from 'class-validator';

/**
 * `POST /emergencia/telefonos` — módulo de emergencia (2026-09-08). Ambos
 * campos requeridos; `sedeId` NUNCA va acá (regla 2 — sale de `@SedeActual()`
 * en el controller). `orden` lo asigna el service (`max+1` de la sede), el
 * cliente nunca lo manda (regla 1, mismo criterio que `Contacto*.orden`).
 * `telefono` es texto libre — sin validación de formato (admite "911",
 * extensiones, fijos con espacios).
 */
export class CrearTelefonoDto {
  @IsString()
  @IsNotEmpty({ message: 'etiqueta es requerida' })
  etiqueta!: string;

  @IsString()
  @IsNotEmpty({ message: 'telefono es requerido' })
  telefono!: string;
}
