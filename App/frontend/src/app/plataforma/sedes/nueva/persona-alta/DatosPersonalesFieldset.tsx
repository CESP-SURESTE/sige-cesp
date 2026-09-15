// Duplicado deliberado de `components/admin/ui/persona-alta/DatosPersonalesFieldset.tsx`
// (regla 11 de CLAUDE.md raíz — app/plataforma/ no importa de app/admin/).
// Mantener en sync a mano si el original cambia.

import type { FieldErrors, FieldValues, Path, UseFormRegister } from 'react-hook-form';
import { FieldError } from './FieldError';
import { INPUT_CLASS, LABEL_CLASS } from './estilos';

/**
 * Nombre del sub-objeto de perfil según `rol`, espejo de `CrearPersonaDto`
 * (backend) — `'perfilAlumno' | 'perfilMaestro' | 'perfilAdministrativo'`.
 * Ganó `'director' | 'administrativo'` (Task 6, 2026-09-11): el formulario
 * de `sedes/nueva/page.tsx` no tiene un solo sub-perfil por rol, tiene 2
 * fundadores del MISMO rol (`ADMINISTRATIVO`, ambos vía `FundadorInput`,
 * `lib/api/sedes.ts`) distinguidos por su cargo (director/administrativo),
 * así que el prefijo de sección es ese cargo, no el nombre de rol de
 * `CrearPersonaDto`. Ajuste hecho en esta copia duplicada de
 * `app/plataforma/` únicamente (regla 11 — no se toca el original en
 * `components/admin/ui/persona-alta/`, que no lo necesita).
 */
export type PerfilPrefix =
  | 'perfilAlumno'
  | 'perfilMaestro'
  | 'perfilAdministrativo'
  | 'director'
  | 'administrativo';

/**
 * Campos de datos personales que los 3 sub-perfiles (`PerfilAlumnoDto`/
 * `PerfilMaestroDto`/`PerfilAdministrativoDto`, backend) tienen en común —
 * `nombres`, `apellidoPaterno`, `apellidoMaterno`, `curp`, `correoPersonal`,
 * `telefono`. La opcionalidad real de `curp`/`telefono` difiere por rol
 * (alumno: ambos opcionales; maestro/administrativo: ambos requeridos) —
 * eso se valida en el `zodSchema` de cada página, no aquí; este componente
 * solo ajusta el texto "(opcional)" del label vía `curpOpcional`/
 * `telefonoOpcional`.
 */
interface PerfilComunFields {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno?: string;
  curp?: string;
  correoPersonal: string;
  telefono?: string;
}

interface DatosPersonalesFieldsetProps<
  TPrefix extends PerfilPrefix,
  TInput extends FieldValues & Record<TPrefix, PerfilComunFields>,
> {
  register: UseFormRegister<TInput>;
  errors: FieldErrors<TInput>;
  disabled: boolean;
  prefix: TPrefix;
  curpOpcional?: boolean;
  telefonoOpcional?: boolean;
}

export function DatosPersonalesFieldset<
  TPrefix extends PerfilPrefix,
  TInput extends FieldValues & Record<TPrefix, PerfilComunFields>,
>({
  register,
  errors,
  disabled,
  prefix,
  curpOpcional = true,
  telefonoOpcional = true,
}: DatosPersonalesFieldsetProps<TPrefix, TInput>) {
  const perfilErrors = (errors as Record<string, unknown>)[prefix] as
    | Partial<Record<keyof PerfilComunFields, { message?: string }>>
    | undefined;

  const path = (campo: keyof PerfilComunFields) => `${prefix}.${campo}` as Path<TInput>;

  return (
    <fieldset className="space-y-3 rounded-lg border border-mist bg-bone/50 p-4">
      <legend className="text-sm font-semibold text-slate">Datos personales</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${prefix}-nombres`} className={LABEL_CLASS}>
            Nombres
          </label>
          <input
            id={`${prefix}-nombres`}
            type="text"
            disabled={disabled}
            className={INPUT_CLASS}
            {...register(path('nombres'))}
          />
          <FieldError message={perfilErrors?.nombres?.message} />
        </div>
        <div>
          <label htmlFor={`${prefix}-apellidoPaterno`} className={LABEL_CLASS}>
            Apellido paterno
          </label>
          <input
            id={`${prefix}-apellidoPaterno`}
            type="text"
            disabled={disabled}
            className={INPUT_CLASS}
            {...register(path('apellidoPaterno'))}
          />
          <FieldError message={perfilErrors?.apellidoPaterno?.message} />
        </div>
        <div>
          <label htmlFor={`${prefix}-apellidoMaterno`} className={LABEL_CLASS}>
            Apellido materno (opcional)
          </label>
          <input
            id={`${prefix}-apellidoMaterno`}
            type="text"
            disabled={disabled}
            className={INPUT_CLASS}
            {...register(path('apellidoMaterno'))}
          />
          <FieldError message={perfilErrors?.apellidoMaterno?.message} />
        </div>
        <div>
          <label htmlFor={`${prefix}-curp`} className={LABEL_CLASS}>
            CURP{curpOpcional ? ' (opcional)' : ''}
          </label>
          <input
            id={`${prefix}-curp`}
            type="text"
            disabled={disabled}
            className={INPUT_CLASS}
            {...register(path('curp'))}
          />
          <FieldError message={perfilErrors?.curp?.message} />
        </div>
        <div>
          <label htmlFor={`${prefix}-correoPersonal`} className={LABEL_CLASS}>
            Correo personal
          </label>
          <input
            id={`${prefix}-correoPersonal`}
            type="email"
            disabled={disabled}
            className={INPUT_CLASS}
            {...register(path('correoPersonal'))}
          />
          <FieldError message={perfilErrors?.correoPersonal?.message} />
        </div>
        <div>
          <label htmlFor={`${prefix}-telefono`} className={LABEL_CLASS}>
            Teléfono{telefonoOpcional ? ' (opcional)' : ''}
          </label>
          <input
            id={`${prefix}-telefono`}
            type="tel"
            disabled={disabled}
            className={INPUT_CLASS}
            {...register(path('telefono'))}
          />
          <FieldError message={perfilErrors?.telefono?.message} />
        </div>
      </div>
    </fieldset>
  );
}
