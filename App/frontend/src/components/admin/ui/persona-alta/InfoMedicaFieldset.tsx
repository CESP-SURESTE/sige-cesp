import type { FieldErrors, FieldValues, Path, UseFormRegister } from 'react-hook-form';
import { FieldError } from './FieldError';
import { INPUT_CLASS, LABEL_CLASS } from './estilos';
import type { PerfilPrefix } from './DatosPersonalesFieldset';

/**
 * Datos de salud — extensión de `POST /personas`, espejo de `InfoMedicaDto`
 * (backend, `crear-persona.dto.ts`; idéntico para los 3 roles). Compartido
 * por los 3 formularios de alta, mismo espíritu que `DatosPersonalesFieldset`.
 *
 * Decisión de UX (documentada acá, no hay pedido explícito de una forma u
 * otra): los 4 campos opcionales (`padecimiento`/`medicamentos`/`alergias`/
 * `tratamientoAdicional`) solo se muestran si `tieneCondicionMedica` está
 * marcado — evita pedirle al admin datos sensibles sin sentido cuando la
 * persona no tiene ninguna condición médica. El valor de `tieneCondicionMedica`
 * lo calcula cada página con `useWatch(...)` (hook dedicado de react-hook-form;
 * `watch()` dispara el warning `react-hooks/incompatible-library` del React
 * Compiler) y se pasa como prop en vez de que este
 * componente haga su propio `watch` interno, para mantenerlo consistente con
 * `DatosPersonalesFieldset`/`ContactosFieldset` (reciben todo por props, no
 * tienen acceso directo al form más allá de `register`/`errors`).
 */
interface InfoMedicaFormValues {
  tieneCondicionMedica: boolean;
  padecimiento?: string;
  medicamentos?: string;
  alergias?: string;
  tratamientoAdicional?: string;
}

interface PerfilConInfoMedica {
  infoMedica: InfoMedicaFormValues;
}

interface InfoMedicaFieldsetProps<
  TPrefix extends PerfilPrefix,
  TInput extends FieldValues & Record<TPrefix, PerfilConInfoMedica>,
> {
  register: UseFormRegister<TInput>;
  errors: FieldErrors<TInput>;
  disabled: boolean;
  prefix: TPrefix;
  tieneCondicionMedica: boolean;
}

export function InfoMedicaFieldset<
  TPrefix extends PerfilPrefix,
  TInput extends FieldValues & Record<TPrefix, PerfilConInfoMedica>,
>({
  register,
  errors,
  disabled,
  prefix,
  tieneCondicionMedica,
}: InfoMedicaFieldsetProps<TPrefix, TInput>) {
  const infoMedicaErrors = (
    (errors as Record<string, unknown>)[prefix] as
      | { infoMedica?: Partial<Record<keyof InfoMedicaFormValues, { message?: string }>> }
      | undefined
  )?.infoMedica;

  const path = (campo: keyof InfoMedicaFormValues) =>
    `${prefix}.infoMedica.${campo}` as Path<TInput>;

  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-semibold text-ink">Datos de salud</legend>

      <div>
        <label
          htmlFor={`${prefix}-tieneCondicionMedica`}
          className="flex items-center gap-2 text-sm text-ink/80"
        >
          <input
            id={`${prefix}-tieneCondicionMedica`}
            type="checkbox"
            disabled={disabled}
            className="h-4 w-4 rounded border-linea text-maya focus:ring-maya/20"
            {...register(path('tieneCondicionMedica'))}
          />
          Tiene alguna condición médica relevante
        </label>
        <FieldError message={infoMedicaErrors?.tieneCondicionMedica?.message} />
      </div>

      {tieneCondicionMedica && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${prefix}-padecimiento`} className={LABEL_CLASS}>
              Padecimiento (opcional)
            </label>
            <input
              id={`${prefix}-padecimiento`}
              type="text"
              disabled={disabled}
              className={INPUT_CLASS}
              {...register(path('padecimiento'))}
            />
            <FieldError message={infoMedicaErrors?.padecimiento?.message} />
          </div>
          <div>
            <label htmlFor={`${prefix}-medicamentos`} className={LABEL_CLASS}>
              Medicamentos (opcional)
            </label>
            <input
              id={`${prefix}-medicamentos`}
              type="text"
              disabled={disabled}
              className={INPUT_CLASS}
              {...register(path('medicamentos'))}
            />
            <FieldError message={infoMedicaErrors?.medicamentos?.message} />
          </div>
          <div>
            <label htmlFor={`${prefix}-alergias`} className={LABEL_CLASS}>
              Alergias (opcional)
            </label>
            <input
              id={`${prefix}-alergias`}
              type="text"
              disabled={disabled}
              className={INPUT_CLASS}
              {...register(path('alergias'))}
            />
            <FieldError message={infoMedicaErrors?.alergias?.message} />
          </div>
          <div>
            <label htmlFor={`${prefix}-tratamientoAdicional`} className={LABEL_CLASS}>
              Tratamiento adicional (opcional)
            </label>
            <input
              id={`${prefix}-tratamientoAdicional`}
              type="text"
              disabled={disabled}
              className={INPUT_CLASS}
              {...register(path('tratamientoAdicional'))}
            />
            <FieldError message={infoMedicaErrors?.tratamientoAdicional?.message} />
          </div>
        </div>
      )}
    </fieldset>
  );
}
