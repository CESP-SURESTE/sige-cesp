import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
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
 * cuatrimestres): se asume CUATRIMESTRES. Consistente con
 * `PerfilAlumno.cuatrimestreActual` (el campo por el que un alumno avanza en
 * el sistema, mismo dominio de "duración académica").
 *
 * NOTA (2026-09-07, rename semestre→cuatrimestre): `duracion` sigue contando
 * exactamente lo mismo que contaba antes de este rename — una unidad de
 * avance académico —, solo cambió la ETIQUETA de esa unidad, por decisión
 * explícita del usuario, SIN recalcular ningún valor ya sembrado. El dato
 * real de `prisma/seed-helpers.ts` (`duracion: 8` para las 4 carreras
 * `LICENCIATURA`) se originó como "4 años x 2 semestres/año" y se dejó intacto: en
 * cuatrimestres reales, 4 años serían 12 (4 x 3), no 8. Esta inconsistencia
 * aritmética es conocida y aceptada — no se "corrige" inventando un
 * recálculo que nadie pidió.
 *
 * `rvoe`/`procedenciaRvoe` (2026-09-07) pasan a opcionales — `Carrera.rvoe`
 * ahora es `String?` en el schema (no toda carrera tiene RVOE al momento del
 * alta), `procedenciaRvoe` es texto libre siempre opcional (ej. "Yucatán",
 * "Campeche" — sin catálogo cerrado de estados, no se pidió).
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

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'rvoe no puede ser vacío si se envía' })
  rvoe?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'procedenciaRvoe no puede ser vacío si se envía' })
  procedenciaRvoe?: string;

  @IsString()
  @IsNotEmpty({ message: 'descripcion es requerida' })
  descripcion!: string;
}
