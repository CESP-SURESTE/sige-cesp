import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Body de `PATCH /personas/:id/estatus` — Fase 10 (unificación CRUD admin).
 *
 * Primer código real del patrón "baja lógica" que la regla 3 de CLAUDE.md
 * raíz ya mencionaba como aspiracional (`PATCH /:id/estatus`) desde el
 * diseño original — hasta hoy ningún rol lo tenía implementado.
 *
 * `estatus` se deja como `string` simple acá (mismo criterio que
 * `ListarPersonasQueryDto.estatus`) — su validación real depende del `rol`
 * del `Usuario` objetivo (`EstatusAcademico` si `ALUMNO`, `EstatusEmpleado`
 * si `MAESTRO`/`ADMINISTRATIVO`), algo que `class-validator` no resuelve
 * limpio con un decorador declarativo contra un enum dinámico que depende de
 * datos en DB (no de un sibling field del propio body). Se valida en
 * `PersonasService.cambiarEstatus`.
 */
export class CambiarEstatusDto {
  @IsString()
  @IsNotEmpty({ message: 'estatus es requerido' })
  estatus!: string;
}
