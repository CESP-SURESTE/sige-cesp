'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { AltaPersonaFormShell } from '@/components/admin/ui/persona-alta/AltaPersonaFormShell';
import { ContactosFieldset } from '@/components/admin/ui/persona-alta/ContactosFieldset';
import { CuentaFieldset } from '@/components/admin/ui/persona-alta/CuentaFieldset';
import { DatosPersonalesFieldset } from '@/components/admin/ui/persona-alta/DatosPersonalesFieldset';
import { FieldError } from '@/components/admin/ui/persona-alta/FieldError';
import { INPUT_CLASS, LABEL_CLASS } from '@/components/admin/ui/persona-alta/estilos';
import { InfoMedicaFieldset } from '@/components/admin/ui/persona-alta/InfoMedicaFieldset';
import { resolverMensajeError } from '@/components/admin/ui/persona-alta/mensajes-error';
import { ResultadoAltaPersona } from '@/components/admin/ui/persona-alta/ResultadoAltaPersona';
import { contactosSchema, infoMedicaSchema } from '@/components/admin/ui/persona-alta/schemas';
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
 */

const maestroSchema = z.object({
  email: z
    .string()
    .min(1, 'El correo es requerido')
    .email('Formato de correo inválido'),
  codigoExterno: z.string().optional(),
  perfilMaestro: z.object({
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
    contactos: contactosSchema,
    infoMedica: infoMedicaSchema,
  }),
});

type MaestroFormValues = z.infer<typeof maestroSchema>;

const DEFAULT_VALUES: MaestroFormValues = {
  email: '',
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
    contactos: [{ nombre: '', telefono: '', correo: '', parentesco: '' }],
    infoMedica: {
      tieneCondicionMedica: false,
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

  const mutation = useMutation({
    mutationFn: (values: MaestroFormValues) =>
      crearMaestro({
        email: values.email,
        codigoExterno: values.codigoExterno || undefined,
        perfilMaestro: {
          ...values.perfilMaestro,
          apellidoMaterno: values.perfilMaestro.apellidoMaterno || undefined,
          cedulaProfesional: values.perfilMaestro.cedulaProfesional || undefined,
          contactos: values.perfilMaestro.contactos.map((contacto) => ({
            ...contacto,
            correo: contacto.correo || undefined,
          })),
          infoMedica: values.perfilMaestro.infoMedica.tieneCondicionMedica
            ? {
                tieneCondicionMedica: true,
                padecimiento: values.perfilMaestro.infoMedica.padecimiento || undefined,
                medicamentos: values.perfilMaestro.infoMedica.medicamentos || undefined,
                alergias: values.perfilMaestro.infoMedica.alergias || undefined,
                tratamientoAdicional:
                  values.perfilMaestro.infoMedica.tratamientoAdicional || undefined,
              }
            : { tieneCondicionMedica: false },
        },
      }),
    onSuccess: (data) => {
      setResultado(data);
      reset(DEFAULT_VALUES);
    },
  });

  function onSubmit(values: MaestroFormValues) {
    mutation.mutate(values);
  }

  const mensajeError = resolverMensajeError(mutation.error);

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
      descripcion="Crea la cuenta y el perfil del maestro. La contraseña temporal se muestra al terminar — Día 13 (correo de bienvenida) sigue bloqueado, comunícala tú mismo."
      onSubmit={handleSubmit(onSubmit)}
      isPending={mutation.isPending}
      mensajeError={mensajeError}
    >
      <CuentaFieldset register={register} errors={errors} disabled={mutation.isPending} />

      <DatosPersonalesFieldset
        register={register}
        errors={errors}
        disabled={mutation.isPending}
        prefix="perfilMaestro"
        curpOpcional={false}
        telefonoOpcional={false}
      />

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-ink">Datos laborales</legend>
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
        </div>
      </fieldset>

      <ContactosFieldset
        control={control}
        register={register}
        errors={errors}
        disabled={mutation.isPending}
        prefix="perfilMaestro"
      />

      <InfoMedicaFieldset
        register={register}
        errors={errors}
        disabled={mutation.isPending}
        prefix="perfilMaestro"
        tieneCondicionMedica={Boolean(tieneCondicionMedica)}
      />
    </AltaPersonaFormShell>
  );
}
