import { IsUUID } from 'class-validator';

/**
 * Body de `POST /grupos/:id/alumnos` (Fase 10, Día 30). El alumno se
 * identifica por su `Usuario.id` (lo que devuelve `GET /personas?rol=ALUMNO`,
 * que alimenta el autocomplete del Día 31) — el service lo resuelve a
 * `PerfilAlumno.id`. Los `Usuario.id` vienen de Supabase Auth y son UUID.
 */
export class MatricularAlumnoDto {
  @IsUUID(undefined, { message: 'usuarioId debe ser un UUID válido' })
  usuarioId!: string;
}
