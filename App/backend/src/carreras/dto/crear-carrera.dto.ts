import { IsEnum, IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import { ModalidadCarrera, NivelCarrera } from '@prisma/client';

/**
 * `POST /carreras` — Fase 6, Día 21. Todos los campos son requeridos;
 * `sedeId` NUNCA va acá (regla 2 de CLAUDE.md raíz — sale de `@SedeActual()`
 * en el controller) y `estatus` tampoco (default `ACTIVA` del schema, no una
 * decisión del admin al dar de alta la carrera — igual criterio que
 * `PerfilMaestroDto`/`PerfilAdministrativoDto` de `POST /personas`, que
 * fuerzan `estatus: ACTIVO` en vez de aceptarlo en el body).
 *
 * `duracion` — SUPUESTO documentado (el roadmap no aclara meses vs.
 * semestres): se asume SEMESTRES. Consistente con `PerfilAlumno.semestreActual`
 * (el campo por el que un alumno avanza en el sistema, mismo dominio de
 * "duración académica") y con el dato real ya sembrado en `prisma/seed.ts`
 * (`duracion: 8` para las 4 carreras `LICENCIATURA` del seed — 4 años x 2
 * semestres/año, la duración estándar de una licenciatura mexicana; en
 * meses habría sido 48, un valor que no aparece en ningún lado del sistema).
 */
export class CrearCarreraDto {
  @IsString()
  @IsNotEmpty({ message: 'nombre es requerido' })
  nombre!: string;

  @IsString()
  @IsNotEmpty({ message: 'clave es requerida' })
  clave!: string;

  @IsInt({ message: 'duracion debe ser un entero' })
  @Min(1, { message: 'duracion debe ser al menos 1' })
  duracion!: number;

  @IsEnum(NivelCarrera, {
    message: 'nivel debe ser TECNICO, LICENCIATURA, MAESTRIA o DOCTORADO',
  })
  nivel!: NivelCarrera;

  @IsEnum(ModalidadCarrera, {
    message: 'modalidad debe ser PRESENCIAL, SEMIPRESENCIAL o EN_LINEA',
  })
  modalidad!: ModalidadCarrera;

  @IsString()
  @IsNotEmpty({ message: 'rvoe es requerido' })
  rvoe!: string;

  @IsString()
  @IsNotEmpty({ message: 'descripcion es requerida' })
  descripcion!: string;
}
