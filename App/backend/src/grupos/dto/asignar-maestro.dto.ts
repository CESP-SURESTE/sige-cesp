import { IsUUID } from 'class-validator';

/**
 * Body de `POST /grupos/:id/asignaciones` (Fase 12, Día 33). El maestro se
 * identifica por su `Usuario.id` (mismo criterio que `MatricularAlumnoDto`);
 * el service lo resuelve a `PerfilMaestro.id`. `materiaId` es un
 * `Materia.id`.
 */
export class AsignarMaestroDto {
  @IsUUID('4', { message: 'materiaId debe ser un UUID válido' })
  materiaId!: string;

  @IsUUID('4', { message: 'usuarioId debe ser un UUID válido' })
  usuarioId!: string;
}
