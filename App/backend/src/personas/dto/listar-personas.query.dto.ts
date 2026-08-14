import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { RolUsuario } from '@prisma/client';

/**
 * Query params de `GET /personas` — Fase 5, Día 19.
 *
 * "Listados PARA administrativos" = listados que un ADMINISTRATIVO consulta,
 * de ALUMNO y MAESTRO — NO un listado de ADMINISTRATIVO mismos (fuera de
 * alcance de este día, ver encargo).
 *
 * `rol` es requerido y SOLO acepta `ALUMNO`/`MAESTRO` — `ADMINISTRATIVO` (o
 * cualquier otro valor, o ausente) cae en 400 `VALIDATION_ERROR` vía
 * `@IsIn(...)` (reutiliza el código fijo existente, no se inventó uno
 * nuevo). `@IsIn` sin `@IsOptional` valida incluso cuando el query param no
 * viene (queda `undefined`, que tampoco pertenece al array permitido).
 *
 * `estatus` se deja como `string` simple acá — su validación real depende de
 * `rol` (otro campo de este mismo DTO: `EstatusAcademico` si
 * `rol=ALUMNO`, `EstatusEmpleado` si `rol=MAESTRO`), algo que
 * `class-validator` no resuelve limpio con un decorador declarativo contra
 * un enum dinámico basado en un sibling field — se valida en
 * `PersonasService.listarPorSedeYRol`, mismo criterio que otras validaciones
 * cross-campo ya existentes en este dominio (ej.
 * `verificarJerarquiaNivelPermiso`, hecha en el service, no en el DTO).
 *
 * `page`/`limit` con `@Type(() => Number)` — mismo `ValidationPipe` global
 * (`transform: true`, `setup-app.ts`) que ya coerciona tipos primitivos en
 * los DTOs de body; acá se aplica igual a query params.
 */
export class ListarPersonasQueryDto {
  @IsIn([RolUsuario.ALUMNO, RolUsuario.MAESTRO], {
    message: 'rol es requerido y debe ser ALUMNO o MAESTRO',
  })
  rol!: RolUsuario;

  @IsOptional()
  @IsString()
  buscar?: string;

  @IsOptional()
  @IsString()
  estatus?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page debe ser un entero' })
  @Min(1, { message: 'page debe ser al menos 1' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit debe ser un entero' })
  @Min(1, { message: 'limit debe ser al menos 1' })
  @Max(100, { message: 'limit debe ser máximo 100' })
  limit?: number;
}
