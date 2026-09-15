// Duplicado deliberado de `components/admin/ui/persona-alta/CuentaFieldset.tsx`
// (regla 11 de CLAUDE.md raíz — app/plataforma/ no importa de app/admin/).
// Mantener en sync a mano si el original cambia.

import type { FieldErrors, FieldValues, Path, UseFormRegister } from 'react-hook-form';
import { FieldError } from './FieldError';
import { INPUT_CLASS, LABEL_CLASS } from './estilos';

/**
 * Campo(s) 100% comunes a los 3 tipos de alta (alumno/maestro/administrativo)
 * en la raíz del body de `POST /personas` — ver `CrearPersonaDto` (backend).
 *
 * `email` (cuenta de acceso) se quitó de este fieldset 2026-08-18: el
 * backend ahora GENERA el login (matrícula/cédula-como-usuario, según rol)
 * en vez de aceptarlo capturado por el cliente — mandarlo hace que
 * `POST /personas` responda `400 VALIDATION_ERROR`
 * (`forbidNonWhitelisted`). El correo generado se muestra después del alta
 * en `ResultadoAltaPersona` (`resultado.usuario.email`), no se captura acá.
 * Solo queda `codigoExterno` (opcional) — con un único campo ya no tiene
 * sentido el grid de 2 columnas que tenía antes.
 */
export interface PersonaComunFormInput extends FieldValues {
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
    <fieldset className="space-y-3 rounded-lg border border-mist bg-bone/50 p-4">
      <legend className="text-sm font-semibold text-slate">Cuenta</legend>
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
    </fieldset>
  );
}
