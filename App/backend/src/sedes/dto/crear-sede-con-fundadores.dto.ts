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
