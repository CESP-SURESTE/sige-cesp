'use client';

import { useFieldArray } from 'react-hook-form';
import type {
  Control,
  FieldArrayPath,
  FieldErrors,
  FieldValues,
  Path,
  UseFormRegister,
} from 'react-hook-form';
import { FieldError } from './FieldError';
import { INPUT_CLASS, LABEL_CLASS } from './estilos';
import type { PerfilPrefix } from './DatosPersonalesFieldset';

/**
 * Contactos de emergencia (1-3) — extensión de `POST /personas`, espejo de
 * `ContactoDto`/`ContactoAlumnoDto` (backend, `crear-persona.dto.ts`).
 * Compartido por los 3 formularios de alta (mismo espíritu que
 * `DatosPersonalesFieldset`/`CuentaFieldset`) vía `useFieldArray` de
 * `react-hook-form` — no se reinventa el manejo de arrays a mano.
 *
 * `tipo` (`TUTOR`/`EMERGENCIA`) solo aplica a alumno (`mostrarTipo` prop) —
 * `ContactoAlumnoDto` es el único de los 3 con ese campo en el backend.
 *
 * `orden` NO se pide — se deriva de la posición en el array (backend,
 * `PersonasService`), igual que documenta el DTO.
 *
 * Los mismos casts de `Path<TInput>`/`FieldArrayPath<TInput>` desde `string`
 * que ya usa `DatosPersonalesFieldset` (necesarios porque el componente es
 * genérico sobre 3 shapes de formulario distintos; la validación real de
 * "el campo existe" la hace `zodResolver` en cada página, no TypeScript acá).
 */
export interface ContactoFormValues {
  nombre: string;
  telefono: string;
  correo?: string;
  parentesco: string;
  tipo?: 'TUTOR' | 'EMERGENCIA' | '';
}

interface PerfilConContactos {
  contactos: ContactoFormValues[];
}

const MIN_CONTACTOS = 1;
const MAX_CONTACTOS = 3;

interface ContactosFieldsetProps<
  TPrefix extends PerfilPrefix,
  TInput extends FieldValues & Record<TPrefix, PerfilConContactos>,
> {
  control: Control<TInput>;
  register: UseFormRegister<TInput>;
  errors: FieldErrors<TInput>;
  disabled: boolean;
  prefix: TPrefix;
  /** Alumno tiene un selector `tipo` adicional; maestro/administrativo no. */
  mostrarTipo?: boolean;
}

export function ContactosFieldset<
  TPrefix extends PerfilPrefix,
  TInput extends FieldValues & Record<TPrefix, PerfilConContactos>,
>({
  control,
  register,
  errors,
  disabled,
  prefix,
  mostrarTipo = false,
}: ContactosFieldsetProps<TPrefix, TInput>) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: `${prefix}.contactos` as FieldArrayPath<TInput>,
  });

  const contactosErrorEntry = (
    (errors as Record<string, unknown>)[prefix] as
      | { contactos?: unknown }
      | undefined
  )?.contactos;

  const contactosItemErrors = Array.isArray(contactosErrorEntry)
    ? (contactosErrorEntry as Array<
        Partial<Record<keyof ContactoFormValues, { message?: string }>>
      >)
    : undefined;

  const arrayErrorMessage =
    !Array.isArray(contactosErrorEntry) && contactosErrorEntry
      ? ((contactosErrorEntry as { message?: string }).message ?? undefined)
      : undefined;

  const path = (index: number, campo: keyof ContactoFormValues) =>
    `${prefix}.contactos.${index}.${campo}` as Path<TInput>;

  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-semibold text-ink">
        Contactos de emergencia
      </legend>
      <p className="text-xs text-ink/60">
        Al menos 1 contacto, máximo 3.
      </p>
      <FieldError message={arrayErrorMessage} />

      <div className="space-y-4">
        {fields.map((rawField, index) => {
          const field = rawField as unknown as ContactoFormValues & {
            id: string;
          };
          const fieldErrors = contactosItemErrors?.[index];

          return (
            <div key={field.id} className="rounded-lg border border-linea p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-ink/60">
                  Contacto {index + 1}
                </p>
                <button
                  type="button"
                  disabled={disabled || fields.length <= MIN_CONTACTOS}
                  onClick={() => remove(index)}
                  className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50 disabled:no-underline"
                >
                  Quitar
                </button>
              </div>

              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor={`${prefix}-contactos-${index}-nombre`}
                    className={LABEL_CLASS}
                  >
                    Nombre
                  </label>
                  <input
                    id={`${prefix}-contactos-${index}-nombre`}
                    type="text"
                    disabled={disabled}
                    className={INPUT_CLASS}
                    {...register(path(index, 'nombre'))}
                  />
                  <FieldError message={fieldErrors?.nombre?.message} />
                </div>
                <div>
                  <label
                    htmlFor={`${prefix}-contactos-${index}-telefono`}
                    className={LABEL_CLASS}
                  >
                    Teléfono
                  </label>
                  <input
                    id={`${prefix}-contactos-${index}-telefono`}
                    type="tel"
                    disabled={disabled}
                    className={INPUT_CLASS}
                    {...register(path(index, 'telefono'))}
                  />
                  <FieldError message={fieldErrors?.telefono?.message} />
                </div>
                <div>
                  <label
                    htmlFor={`${prefix}-contactos-${index}-correo`}
                    className={LABEL_CLASS}
                  >
                    Correo (opcional)
                  </label>
                  <input
                    id={`${prefix}-contactos-${index}-correo`}
                    type="email"
                    disabled={disabled}
                    className={INPUT_CLASS}
                    {...register(path(index, 'correo'))}
                  />
                  <FieldError message={fieldErrors?.correo?.message} />
                </div>
                <div>
                  <label
                    htmlFor={`${prefix}-contactos-${index}-parentesco`}
                    className={LABEL_CLASS}
                  >
                    Parentesco
                  </label>
                  <input
                    id={`${prefix}-contactos-${index}-parentesco`}
                    type="text"
                    disabled={disabled}
                    className={INPUT_CLASS}
                    {...register(path(index, 'parentesco'))}
                  />
                  <FieldError message={fieldErrors?.parentesco?.message} />
                </div>
                {mostrarTipo && (
                  <div>
                    <label
                      htmlFor={`${prefix}-contactos-${index}-tipo`}
                      className={LABEL_CLASS}
                    >
                      Tipo
                    </label>
                    <select
                      id={`${prefix}-contactos-${index}-tipo`}
                      disabled={disabled}
                      className={INPUT_CLASS}
                      {...register(path(index, 'tipo'))}
                    >
                      <option value="">Selecciona un tipo</option>
                      <option value="TUTOR">Tutor</option>
                      <option value="EMERGENCIA">Emergencia</option>
                    </select>
                    <FieldError message={fieldErrors?.tipo?.message} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        disabled={disabled || fields.length >= MAX_CONTACTOS}
        onClick={() =>
          append(
            (mostrarTipo
              ? { nombre: '', telefono: '', correo: '', parentesco: '', tipo: '' }
              : { nombre: '', telefono: '', correo: '', parentesco: '' }) as never,
          )
        }
        className="rounded-lg border border-linea px-3 py-1.5 text-xs font-medium text-ink/80 hover:bg-paper disabled:opacity-50"
      >
        Agregar contacto
      </button>
    </fieldset>
  );
}
