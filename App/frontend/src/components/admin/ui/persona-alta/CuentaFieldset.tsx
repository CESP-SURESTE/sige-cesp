import type { FieldValues } from 'react-hook-form';
// `FieldErrors`/`Path`/`UseFormRegister`/`FieldError`/`INPUT_CLASS`/`LABEL_CLASS`
// — solo los usaba el campo `codigoExterno` comentado abajo. No borrar,
// listos para reactivar junto con el resto.
// import type { FieldErrors, Path, UseFormRegister } from 'react-hook-form';
// import { FieldError } from './FieldError';
// import { INPUT_CLASS, LABEL_CLASS } from './estilos';

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
 *
 * `codigoExterno` oculto a pedido del usuario (2026-09-23) — campo
 * reservado para una integración futura con un reloj checador biométrico
 * (`docs/modelo-datos.md`), nadie lo usa hoy. JSX comentado abajo en vez de
 * borrado — mismo criterio que la sección "Compañeros" de
 * `app/alumno/page.tsx` (2026-09-07): reversible con un solo "descomentar"
 * el día que CESP instale el reloj. El backend (`CrearPersonaDto.codigoExterno`,
 * `PATCH /personas/:id`) sigue intacto, sin tocar — esto es solo UI. Con el
 * único campo oculto, este fieldset ya no renderiza nada; los 3 formularios
 * de alta que lo importaban también tienen su llamada comentada (ver
 * `app/admin/{alumnos,maestros,administrativos}/nuevo/page.tsx`).
 */
export interface PersonaComunFormInput extends FieldValues {
  codigoExterno?: string;
}

// interface CuentaFieldsetProps<TInput extends PersonaComunFormInput> {
//   register: UseFormRegister<TInput>;
//   errors: FieldErrors<TInput>;
//   disabled: boolean;
// }

// export function CuentaFieldset<TInput extends PersonaComunFormInput>({
//   register,
//   errors,
//   disabled,
// }: CuentaFieldsetProps<TInput>) {
//   return (
//     <fieldset className="space-y-3 rounded-lg border border-mist bg-bone/50 p-4">
//       <legend className="text-sm font-semibold text-slate">Cuenta</legend>
//       <div>
//         <label htmlFor="codigoExterno" className={LABEL_CLASS}>
//           Código externo (opcional)
//         </label>
//         <input
//           id="codigoExterno"
//           type="text"
//           disabled={disabled}
//           className={INPUT_CLASS}
//           {...register('codigoExterno' as Path<TInput>)}
//         />
//         <FieldError message={errors.codigoExterno?.message as string | undefined} />
//       </div>
//     </fieldset>
//   );
// }
