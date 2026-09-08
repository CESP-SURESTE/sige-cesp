'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { AltaPersonaFormShell } from '@/components/admin/ui/persona-alta/AltaPersonaFormShell';
import { ContactosFieldset } from '@/components/admin/ui/persona-alta/ContactosFieldset';
import { CuentaFieldset } from '@/components/admin/ui/persona-alta/CuentaFieldset';
import { DatosPersonalesFieldset } from '@/components/admin/ui/persona-alta/DatosPersonalesFieldset';
import { FieldError } from '@/components/admin/ui/persona-alta/FieldError';
import { INPUT_CLASS, LABEL_CLASS } from '@/components/admin/ui/persona-alta/estilos';
import { InfoMedicaFieldset } from '@/components/admin/ui/persona-alta/InfoMedicaFieldset';
import {
  MENSAJE_ERROR_GENERICO,
  resolverMensajeError,
} from '@/components/admin/ui/persona-alta/mensajes-error';
import { ResultadoAltaPersona } from '@/components/admin/ui/persona-alta/ResultadoAltaPersona';
import { contactosSchema, infoMedicaSchema } from '@/components/admin/ui/persona-alta/schemas';
import { Select } from '@/components/admin/ui/persona-alta/Select';
import { crearMaestro, type AltaPersonaResult } from '@/lib/api/personas';

/**
 * Formulario de alta de maestro — Fase 4, Día 15. Mismo patrón que
 * `app/admin/alumnos/nuevo/page.tsx` (Día 14, refactorizado en Día 15),
 * usando el componente de formulario base
 * (`components/admin/ui/persona-alta/`) — `CuentaFieldset` y
 * `DatosPersonalesFieldset` se reutilizan tal cual; el fieldset "Datos
 * laborales" (`cedulaProfesional`, `fechaContratacion`) es específico de
 * este rol. Sin campo `estatus` — el backend fuerza siempre `ACTIVO` en la
 * creación (corrección de QA manual, 2026-08-12, ver nota en
 * `crear-persona.dto.ts`); cambiar el estatus después es un flujo aparte.
 *
 * Schema de validación en cliente (`maestroSchema`) es espejo de
 * `CrearPersonaDto` + `PerfilMaestroDto`
 * (`App/backend/src/personas/dto/crear-persona.dto.ts`) — a diferencia de
 * alumno, aquí `curp` y `telefono` son REQUERIDOS (no opcionales), reflejado
 * con `curpOpcional={false}`/`telefonoOpcional={false}` en
 * `DatosPersonalesFieldset` (solo afecta el texto del label; la validación
 * real vive en este `maestroSchema` y, en el backend, en
 * `PerfilMaestroDto`).
 *
 * Sin dropdown de `carreraId` (no aplica a maestro) — por eso no hay
 * `useQuery` aquí, a diferencia del formulario de alumno.
 *
 * Día 13 (emails de bienvenida) sigue BLOQUEADO — la `temporaryPassword` se
 * muestra en pantalla tras el alta, igual que en alumno/administrativo.
 *
 * `contactos`/`infoMedica` (extensión 2026-08-12, misma transacción que el
 * alta, decisión del usuario) — `ContactosFieldset` (sin `mostrarTipo`, ese
 * campo es exclusivo de alumno) e `InfoMedicaFieldset`, ver esos componentes
 * en `components/admin/ui/persona-alta/`.
 *
 * `email` (raíz) YA NO se captura en este formulario (2026-08-18) — el
 * backend genera el login y rechaza `POST /personas` con
 * `400 VALIDATION_ERROR` si se manda. Se muestra después del alta,
 * generado, en `ResultadoAltaPersona` (`resultado.usuario.email`).
 */

/**
 * `tipoContratacion` + campos condicionales (2026-09-07) — espejo de
 * `PerfilMaestroDto` (backend). `diasTemporal` se captura como string (input
 * numérico sin `valueAsNumber`) y se valida como entero ≥ 1 en el
 * `superRefine`; se convierte a `number` recién en el payload. Las 2 fechas
 * de contrato se comparan como string ISO (`YYYY-MM-DD` es lexicográficamente
 * ordenable) — mismo espíritu que el `400 VALIDATION_ERROR` del backend
 * cuando `contratoFechaFin <= contratoFechaInicio` (validación de UX, no
 * reemplaza la real).
 */
const perfilMaestroSchema = z
  .object({
    nombres: z.string().min(1, 'Los nombres son requeridos'),
    apellidoPaterno: z.string().min(1, 'El apellido paterno es requerido'),
    apellidoMaterno: z.string().optional(),
    curp: z.string().min(1, 'El CURP es requerido'),
    cedulaProfesional: z.string().optional(),
    correoPersonal: z
      .string()
      .min(1, 'El correo personal es requerido')
      .email('Formato de correo inválido'),
    telefono: z.string().min(1, 'El teléfono es requerido'),
    fechaContratacion: z
      .string()
      .min(1, 'La fecha de contratación es requerida'),
    tipoContratacion: z.enum(['BASE', 'TEMPORAL', 'CONTRATO'], {
      message: 'Selecciona el tipo de contratación',
    }),
    diasTemporal: z.string().optional(),
    contratoFechaInicio: z.string().optional(),
    contratoFechaFin: z.string().optional(),
    contactos: contactosSchema,
    infoMedica: infoMedicaSchema,
  })
  .superRefine((data, ctx) => {
    if (data.tipoContratacion === 'TEMPORAL') {
      const dias = Number(data.diasTemporal);
      if (
        !data.diasTemporal ||
        !Number.isInteger(dias) ||
        dias < 1
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['diasTemporal'],
          message: 'Ingresa un número de días válido (entero ≥ 1)',
        });
      }
    }
    if (data.tipoContratacion === 'CONTRATO') {
      if (!data.contratoFechaInicio) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['contratoFechaInicio'],
          message: 'La fecha de inicio es requerida',
        });
      }
      if (!data.contratoFechaFin) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['contratoFechaFin'],
          message: 'La fecha de fin es requerida',
        });
      }
      if (
        data.contratoFechaInicio &&
        data.contratoFechaFin &&
        data.contratoFechaFin <= data.contratoFechaInicio
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['contratoFechaFin'],
          message: 'La fecha de fin debe ser posterior a la de inicio',
        });
      }
    }
  });

const maestroSchema = z.object({
  codigoExterno: z.string().optional(),
  perfilMaestro: perfilMaestroSchema,
});

type MaestroFormValues = z.infer<typeof maestroSchema>;

const DEFAULT_VALUES: MaestroFormValues = {
  codigoExterno: '',
  perfilMaestro: {
    nombres: '',
    apellidoPaterno: '',
    apellidoMaterno: '',
    curp: '',
    cedulaProfesional: '',
    correoPersonal: '',
    telefono: '',
    fechaContratacion: '',
    tipoContratacion:
      '' as MaestroFormValues['perfilMaestro']['tipoContratacion'],
    diasTemporal: '',
    contratoFechaInicio: '',
    contratoFechaFin: '',
    contactos: [{ nombre: '', telefono: '', correo: '', parentesco: '' }],
    infoMedica: {
      tieneCondicionMedica: false,
      tipoSangre: '' as MaestroFormValues['perfilMaestro']['infoMedica']['tipoSangre'],
      padecimiento: '',
      medicamentos: '',
      alergias: '',
      tratamientoAdicional: '',
    },
  },
};

export default function NuevoMaestroPage() {
  const [resultado, setResultado] = useState<AltaPersonaResult | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<MaestroFormValues>({
    resolver: zodResolver(maestroSchema),
    defaultValues: DEFAULT_VALUES,
  });

  const tieneCondicionMedica = useWatch({
    control,
    name: 'perfilMaestro.infoMedica.tieneCondicionMedica',
  });

  const tipoContratacion = useWatch({
    control,
    name: 'perfilMaestro.tipoContratacion',
  });

  const mutation = useMutation({
    mutationFn: (values: MaestroFormValues) =>
      crearMaestro({
        codigoExterno: values.codigoExterno || undefined,
        perfilMaestro: {
          ...values.perfilMaestro,
          apellidoMaterno: values.perfilMaestro.apellidoMaterno || undefined,
          cedulaProfesional: values.perfilMaestro.cedulaProfesional || undefined,
          diasTemporal:
            values.perfilMaestro.tipoContratacion === 'TEMPORAL'
              ? Number(values.perfilMaestro.diasTemporal)
              : undefined,
          contratoFechaInicio:
            values.perfilMaestro.tipoContratacion === 'CONTRATO'
              ? values.perfilMaestro.contratoFechaInicio
              : undefined,
          contratoFechaFin:
            values.perfilMaestro.tipoContratacion === 'CONTRATO'
              ? values.perfilMaestro.contratoFechaFin
              : undefined,
          contactos: values.perfilMaestro.contactos.map((contacto) => ({
            ...contacto,
            correo: contacto.correo || undefined,
          })),
          infoMedica: {
            tipoSangre: values.perfilMaestro.infoMedica.tipoSangre,
            ...(values.perfilMaestro.infoMedica.tieneCondicionMedica
              ? {
                  tieneCondicionMedica: true,
                  padecimiento: values.perfilMaestro.infoMedica.padecimiento || undefined,
                  medicamentos: values.perfilMaestro.infoMedica.medicamentos || undefined,
                  alergias: values.perfilMaestro.infoMedica.alergias || undefined,
                  tratamientoAdicional:
                    values.perfilMaestro.infoMedica.tratamientoAdicional || undefined,
                }
              : { tieneCondicionMedica: false }),
          },
        },
      }),
    onSuccess: (data) => {
      setResultado(data);
      reset(DEFAULT_VALUES);
    },
    onError: (error) => {
      console.error('[AdminMaestrosNuevoPage] Error al dar de alta maestro:', error);
      toast.error(resolverMensajeError(error) ?? MENSAJE_ERROR_GENERICO);
    },
  });

  function onSubmit(values: MaestroFormValues) {
    mutation.mutate(values);
  }

  if (resultado) {
    return (
      <ResultadoAltaPersona
        resultado={resultado}
        titulo="Maestro dado de alta"
        botonOtroLabel="Dar de alta otro maestro"
        onReset={() => setResultado(null)}
      />
    );
  }

  return (
    <AltaPersonaFormShell
      titulo="Alta de maestro"
      descripcion="Crea la cuenta y el perfil del maestro. La contraseña temporal se muestra al terminar — la entrega del correo de bienvenida no está garantizada (dominio en modo de prueba), comunícala tú mismo como respaldo."
      onSubmit={handleSubmit(onSubmit)}
      isPending={mutation.isPending}
    >
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="flex flex-col gap-5">
          <CuentaFieldset register={register} errors={errors} disabled={mutation.isPending} />

          <InfoMedicaFieldset
            control={control}
            register={register}
            errors={errors}
            disabled={mutation.isPending}
            prefix="perfilMaestro"
            tieneCondicionMedica={Boolean(tieneCondicionMedica)}
          />
        </div>

        <DatosPersonalesFieldset
          register={register}
          errors={errors}
          disabled={mutation.isPending}
          prefix="perfilMaestro"
          curpOpcional={false}
          telefonoOpcional={false}
        />

        <fieldset className="space-y-3 rounded-lg border border-mist bg-bone/50 p-4">
          <legend className="text-sm font-semibold text-slate">Datos laborales</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="cedulaProfesional" className={LABEL_CLASS}>
                Cédula profesional (opcional)
              </label>
              <input
                id="cedulaProfesional"
                type="text"
                disabled={mutation.isPending}
                className={INPUT_CLASS}
                {...register('perfilMaestro.cedulaProfesional')}
              />
              <FieldError message={errors.perfilMaestro?.cedulaProfesional?.message} />
            </div>
            <div>
              <label htmlFor="fechaContratacion" className={LABEL_CLASS}>
                Fecha de contratación
              </label>
              <input
                id="fechaContratacion"
                type="date"
                disabled={mutation.isPending}
                className={INPUT_CLASS}
                {...register('perfilMaestro.fechaContratacion')}
              />
              <FieldError message={errors.perfilMaestro?.fechaContratacion?.message} />
            </div>
            <div>
              <label htmlFor="tipoContratacion" className={LABEL_CLASS}>
                Tipo de contratación
              </label>
              <Controller
                control={control}
                name="perfilMaestro.tipoContratacion"
                render={({ field }) => (
                  <Select
                    id="tipoContratacion"
                    value={(field.value as string | undefined) ?? ''}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    disabled={mutation.isPending}
                    placeholder="Selecciona el tipo de contratación"
                    options={[
                      { value: 'BASE', label: 'Base (planta)' },
                      { value: 'TEMPORAL', label: 'Temporal' },
                      { value: 'CONTRATO', label: 'Por contrato' },
                    ]}
                  />
                )}
              />
              <FieldError message={errors.perfilMaestro?.tipoContratacion?.message} />
            </div>
            {tipoContratacion === 'TEMPORAL' && (
              <div>
                <label htmlFor="diasTemporal" className={LABEL_CLASS}>
                  Días
                </label>
                <input
                  id="diasTemporal"
                  type="number"
                  min={1}
                  step={1}
                  disabled={mutation.isPending}
                  className={INPUT_CLASS}
                  {...register('perfilMaestro.diasTemporal')}
                />
                <FieldError message={errors.perfilMaestro?.diasTemporal?.message} />
              </div>
            )}
            {tipoContratacion === 'CONTRATO' && (
              <>
                <div>
                  <label htmlFor="contratoFechaInicio" className={LABEL_CLASS}>
                    Fecha de inicio
                  </label>
                  <input
                    id="contratoFechaInicio"
                    type="date"
                    disabled={mutation.isPending}
                    className={INPUT_CLASS}
                    {...register('perfilMaestro.contratoFechaInicio')}
                  />
                  <FieldError
                    message={errors.perfilMaestro?.contratoFechaInicio?.message}
                  />
                </div>
                <div>
                  <label htmlFor="contratoFechaFin" className={LABEL_CLASS}>
                    Fecha de fin
                  </label>
                  <input
                    id="contratoFechaFin"
                    type="date"
                    disabled={mutation.isPending}
                    className={INPUT_CLASS}
                    {...register('perfilMaestro.contratoFechaFin')}
                  />
                  <FieldError
                    message={errors.perfilMaestro?.contratoFechaFin?.message}
                  />
                </div>
              </>
            )}
          </div>
        </fieldset>
      </div>

      <ContactosFieldset
        control={control}
        register={register}
        errors={errors}
        disabled={mutation.isPending}
        prefix="perfilMaestro"
      />
    </AltaPersonaFormShell>
  );
}
