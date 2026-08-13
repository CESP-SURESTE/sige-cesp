import type { FieldErrors, FieldValues, Path, UseFormRegister } from 'react-hook-form';
import { FieldError } from './FieldError';
import { INPUT_CLASS, LABEL_CLASS } from './estilos';

/**
 * Campos 100% comunes a los 3 tipos de alta (alumno/maestro/administrativo):
 * `email` (cuenta de acceso, va a `usuarios`) y `codigoExterno` (opcional).
 * Todo formulario de alta debe tener estos dos campos en la raíz del body de
 * `POST /personas` — ver `CrearPersonaDto` (backend).
 */
export interface PersonaComunFormInput extends FieldValues {
  email: string;
  codigoExterno?: string;
}

interface CuentaFieldsetProps<TInput extends PersonaComunFormInput> {
  register: UseFormRegister<TInput>;
  errors: FieldErrors<TInput>;
  disabled: boolean;
}

export function CuentaFieldset<TInput extends PersonaComunFormInput>({
  register,
  errors,
  disabled,
}: CuentaFieldsetProps<TInput>) {
  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-semibold text-ink">Cuenta</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="email" className={LABEL_CLASS}>
            Correo (cuenta de acceso)
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            disabled={disabled}
            className={INPUT_CLASS}
            {...register('email' as Path<TInput>)}
          />
          <FieldError message={errors.email?.message as string | undefined} />
        </div>
        <div>
          <label htmlFor="codigoExterno" className={LABEL_CLASS}>
            Código externo (opcional)
          </label>
          <input
            id="codigoExterno"
            type="text"
            disabled={disabled}
            className={INPUT_CLASS}
            {...register('codigoExterno' as Path<TInput>)}
          />
          <FieldError message={errors.codigoExterno?.message as string | undefined} />
        </div>
      </div>
    </fieldset>
  );
}
