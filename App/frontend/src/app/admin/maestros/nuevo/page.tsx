'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { AltaPersonaFormShell } from '@/components/admin/ui/persona-alta/AltaPersonaFormShell';
import { CuentaFieldset } from '@/components/admin/ui/persona-alta/CuentaFieldset';
import { DatosPersonalesFieldset } from '@/components/admin/ui/persona-alta/DatosPersonalesFieldset';
import { FieldError } from '@/components/admin/ui/persona-alta/FieldError';
import { INPUT_CLASS, LABEL_CLASS } from '@/components/admin/ui/persona-alta/estilos';
import { resolverMensajeError } from '@/components/admin/ui/persona-alta/mensajes-error';
import { ResultadoAltaPersona } from '@/components/admin/ui/persona-alta/ResultadoAltaPersona';
import { crearMaestro, type AltaPersonaResult } from '@/lib/api/personas';

/**
 * Formulario de alta de maestro — Fase 4, Día 15. Mismo patrón que
 * `app/admin/alumnos/nuevo/page.tsx` (Día 14, refactorizado en Día 15),
 * usando el componente de formulario base
 * (`components/admin/ui/persona-alta/`) — `CuentaFieldset` y
 * `DatosPersonalesFieldset` se reutilizan tal cual; el fieldset "Datos
 * laborales" (`cedulaProfesional`, `fechaContratacion`, `estatus`) es
 * específico de este rol.
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
 */

const ESTATUS_OPCIONES = ['ACTIVO', 'BAJA', 'LICENCIA'] as const;

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
    estatus: z.enum(ESTATUS_OPCIONES).optional().or(z.literal('')),
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
    estatus: '',
  },
};

export default function NuevoMaestroPage() {
  const [resultado, setResultado] = useState<AltaPersonaResult | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<MaestroFormValues>({
    resolver: zodResolver(maestroSchema),
    defaultValues: DEFAULT_VALUES,
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
          estatus: values.perfilMaestro.estatus || undefined,
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
        <legend className="text-sm font-semibold text-gray-900">Datos laborales</legend>
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
            <label htmlFor="estatus" className={LABEL_CLASS}>
              Estatus (opcional, por defecto ACTIVO)
            </label>
            <select
              id="estatus"
              disabled={mutation.isPending}
              className={INPUT_CLASS}
              {...register('perfilMaestro.estatus')}
            >
              <option value="">ACTIVO (por defecto)</option>
              {ESTATUS_OPCIONES.map((valor) => (
                <option key={valor} value={valor}>
                  {valor}
                </option>
              ))}
            </select>
            <FieldError message={errors.perfilMaestro?.estatus?.message} />
          </div>
        </div>
      </fieldset>
    </AltaPersonaFormShell>
  );
}
