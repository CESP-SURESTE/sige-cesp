import { Type } from 'class-transformer';
import { IsDefined, ValidateNested } from 'class-validator';
import { PerfilAdministrativoDto } from '../../personas/dto/crear-persona.dto';
import { CrearSedeDto } from './crear-sede.dto';

/**
 * `POST /sedes` (2026-09-11) — la sede ya no se da de alta sola: el body
 * ahora exige también los datos de las 2 cuentas fundadoras (director +
 * administrativo). Reutiliza `PerfilAdministrativoDto` tal cual (mismas
 * reglas de contactos 1-3 + info médica con `tipoSangre` obligatorio que
 * cualquier alta de ADMINISTRATIVO) — su campo `nivelPermiso` se ignora
 * si viene, `SedesService.crearConFundadores` lo fuerza server-side
 * (SUPER_ADMIN para `director`, ADMIN para `administrativo`).
 *
 * Hallazgo Minor del review final (2026-09-11): el patrón establecido en
 * este proyecto para un campo que el cliente NUNCA debe mandar es
 * EXCLUIRLO del DTO (ver `email`/`perfilAlumno.matricula` en `POST
 * /personas`) para que `forbidNonWhitelisted` del `ValidationPipe` lo
 * rechace con 400 en vez de ignorarlo en silencio — lo correcto acá sería
 * `OmitType(PerfilAdministrativoDto, ['nivelPermiso'] as const)` de
 * `@nestjs/mapped-types`. NO se aplicó: ese paquete no está instalado en
 * este backend (no es dependencia directa ni transitiva — no está en
 * `package.json` ni en `node_modules/@nestjs/`), y CLAUDE.md raíz prohíbe
 * agregar dependencias nuevas si algo se resuelve con lo ya instalado; acá
 * NO hay alternativa sin el paquete que no sea reescribir el DTO a mano
 * campo por campo (frágil, se desincroniza de `PerfilAdministrativoDto` en
 * cada cambio futuro — peor que dejar el campo, ya inofensivo en runtime).
 * Queda como pendiente real: instalar `@nestjs/mapped-types` (decisión del
 * usuario) o aceptar el gap.
 */
export class CrearSedeConFundadoresDto {
  @IsDefined({ message: 'sede es requerido' })
  @ValidateNested()
  @Type(() => CrearSedeDto)
  sede!: CrearSedeDto;

  @IsDefined({ message: 'director es requerido' })
  @ValidateNested()
  @Type(() => PerfilAdministrativoDto)
  director!: PerfilAdministrativoDto;

  @IsDefined({ message: 'administrativo es requerido' })
  @ValidateNested()
  @Type(() => PerfilAdministrativoDto)
  administrativo!: PerfilAdministrativoDto;
}
