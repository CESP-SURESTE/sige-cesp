'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { getPlatformToken } from '@/lib/api/platform-http';
import {
  crearSedeConFundadores,
  type CrearSedeConFundadoresResult,
} from '@/lib/api/sedes';
import { PlataformaNav } from '../../PlataformaNav';
import { AltaPersonaFormShell } from './persona-alta/AltaPersonaFormShell';
import { ContactosFieldset } from './persona-alta/ContactosFieldset';
import { CredencialesCard } from './CredencialesCard';
import { DatosPersonalesFieldset } from './persona-alta/DatosPersonalesFieldset';
import { FieldError } from './persona-alta/FieldError';
import { INPUT_CLASS, LABEL_CLASS } from './persona-alta/estilos';
import { InfoMedicaFieldset } from './persona-alta/InfoMedicaFieldset';
import {
  MENSAJE_ERROR_GENERICO,
  resolverMensajeError,
} from './persona-alta/mensajes-error';
import { contactosSchema, infoMedicaSchema } from './persona-alta/schemas';
import { Select } from './persona-alta/Select';

/**
 * `POST /sedes` con fundadores (2026-09-11) — ver
 * `docs/superpowers/specs/2026-09-11-sede-fundadores-obligatorios-design.md`.
 * Reemplaza el modo "alta" de `SedeModal` (que sigue existiendo solo para
 * edición, ver Task 7) — 2 altas completas de ADMINISTRATIVO no caben en un
 * modal (mismo motivo por el que `app/admin/administrativos/nuevo/` ya es
 * página completa, no modal, regla 13 de CLAUDE.md raíz).
 */

const PUESTO_OPCIONES = [
  'DIRECTOR',
  'COORDINADOR_ACADEMICO',
  'COORDINADOR_ADMINISTRATIVO',
  'AUXILIAR',
  'RECEPCION',
  'OTRO',
] as const;

const fundadorSchema = z.object({
  nombres: z.string().min(1, 'Los nombres son requeridos'),
  apellidoPaterno: z.string().min(1, 'El apellido paterno es requerido'),
  apellidoMaterno: z.string().optional(),
  curp: z.string().min(1, 'El CURP es requerido'),
  correoPersonal: z
    .string()
    .min(1, 'El correo personal es requerido')
    .email('Formato de correo inválido'),
  telefono: z.string().min(1, 'El teléfono es requerido'),
  fechaContratacion: z.string().min(1, 'La fecha de contratación es requerida'),
  puesto: z.enum(PUESTO_OPCIONES, { message: 'Selecciona un puesto' }),
  contactos: contactosSchema,
  infoMedica: infoMedicaSchema,
});

const formSchema = z.object({
  sede: z.object({
    nombre: z.string().min(1, 'El nombre es requerido'),
    direccion: z.string().min(1, 'La dirección es requerida'),
    ubicacionReferencia: z.string().min(1, 'La referencia de ubicación es requerida'),
    telefono: z.string().min(1, 'El teléfono es requerido'),
  }),
  director: fundadorSchema,
  administrativo: fundadorSchema,
});

type FormValues = z.infer<typeof formSchema>;

function fundadorVacio(): FormValues['director'] {
  return {
    nombres: '',
    apellidoPaterno: '',
    apellidoMaterno: '',
    curp: '',
    correoPersonal: '',
    telefono: '',
    fechaContratacion: '',
    puesto: '' as FormValues['director']['puesto'],
    contactos: [{ nombre: '', telefono: '', correo: '', parentesco: '' }],
    infoMedica: {
      tieneCondicionMedica: false,
      tipoSangre: '' as FormValues['director']['infoMedica']['tipoSangre'],
      padecimiento: '',
      medicamentos: '',
      alergias: '',
      tratamientoAdicional: '',
    },
  };
}

const DEFAULT_VALUES: FormValues = {
  sede: { nombre: '', direccion: '', ubicacionReferencia: '', telefono: '' },
  director: fundadorVacio(),
  administrativo: fundadorVacio(),
};

/** Arma el sub-objeto `FundadorInput` (backend) desde los valores del form de una sección. */
function construirFundador(valores: FormValues['director']) {
  return {
    ...valores,
    apellidoMaterno: valores.apellidoMaterno || undefined,
    contactos: valores.contactos.map((c) => ({ ...c, correo: c.correo || undefined })),
    infoMedica: {
      tipoSangre: valores.infoMedica.tipoSangre,
      ...(valores.infoMedica.tieneCondicionMedica
        ? {
            tieneCondicionMedica: true,
            padecimiento: valores.infoMedica.padecimiento || undefined,
            medicamentos: valores.infoMedica.medicamentos || undefined,
            alergias: valores.infoMedica.alergias || undefined,
            tratamientoAdicional: valores.infoMedica.tratamientoAdicional || undefined,
          }
        : { tieneCondicionMedica: false }),
    },
  };
}

/** Fieldset de una persona fundadora (director o administrativo) — reusado 2 veces. */
function SeccionFundador({
  titulo,
  prefix,
  register,
  errors,
  control,
  disabled,
}: {
  titulo: string;
  prefix: 'director' | 'administrativo';
  register: ReturnType<typeof useForm<FormValues>>['register'];
  errors: ReturnType<typeof useForm<FormValues>>['formState']['errors'];
  control: ReturnType<typeof useForm<FormValues>>['control'];
  disabled: boolean;
}) {
  const tieneCondicionMedica = useWatch({
    control,
    name: `${prefix}.infoMedica.tieneCondicionMedica`,
  });

  return (
    <fieldset className="space-y-5 rounded-lg border border-mist bg-bone/50 p-4">
      <legend className="px-1 font-display text-base font-semibold text-slate">
        {titulo}
      </legend>

      <div className="grid gap-5 xl:grid-cols-2">
        <DatosPersonalesFieldset
          register={register}
          errors={errors}
          disabled={disabled}
          prefix={prefix}
          curpOpcional={false}
          telefonoOpcional={false}
        />

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${prefix}-fechaContratacion`} className={LABEL_CLASS}>
                Fecha de contratación
              </label>
              <input
                id={`${prefix}-fechaContratacion`}
                type="date"
                disabled={disabled}
                className={INPUT_CLASS}
                {...register(`${prefix}.fechaContratacion`)}
              />
              <FieldError message={errors[prefix]?.fechaContratacion?.message} />
            </div>
            <div>
              <label htmlFor={`${prefix}-puesto`} className={LABEL_CLASS}>
                Puesto
              </label>
              <Controller
                control={control}
                name={`${prefix}.puesto`}
                render={({ field }) => (
                  <Select
                    id={`${prefix}-puesto`}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    disabled={disabled}
                    placeholder="Selecciona un puesto"
                    options={PUESTO_OPCIONES.map((v) => ({ value: v, label: v }))}
                  />
                )}
              />
              <FieldError message={errors[prefix]?.puesto?.message} />
            </div>
          </div>

          <InfoMedicaFieldset
            control={control}
            register={register}
            errors={errors}
            disabled={disabled}
            prefix={prefix}
            tieneCondicionMedica={Boolean(tieneCondicionMedica)}
          />
        </div>
      </div>

      <ContactosFieldset
        control={control}
        register={register}
        errors={errors}
        disabled={disabled}
        prefix={prefix}
      />
    </fieldset>
  );
}

export default function NuevaSedePage() {
  const router = useRouter();
  const [resultado, setResultado] = useState<CrearSedeConFundadoresResult | null>(null);

  useEffect(() => {
    if (!getPlatformToken()) {
      router.replace('/plataforma/login');
    }
  }, [router]);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: DEFAULT_VALUES,
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      crearSedeConFundadores({
        sede: values.sede,
        director: construirFundador(values.director),
        administrativo: construirFundador(values.administrativo),
      }),
    onSuccess: (data) => {
      setResultado(data);
      if (data.advertenciaAdministrativo) {
        toast.warning(data.advertenciaAdministrativo);
      } else {
        toast.success('Sede y cuentas fundadoras creadas');
      }
    },
    onError: (error) => {
      console.error('[PlataformaNuevaSedePage] Error al crear sede con fundadores:', error);
      toast.error(resolverMensajeError(error, {}) ?? MENSAJE_ERROR_GENERICO);
    },
  });

  if (resultado) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <PlataformaNav activo="sedes" titulo="Sedes" />
        <div className="mt-6 rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
          <h1 className="font-display text-xl font-semibold text-slate">
            {resultado.sede.nombre} — sede creada
          </h1>
          {resultado.advertenciaAdministrativo && (
            <p className="mt-3 rounded-lg border border-gold bg-gold/10 p-3 text-sm text-slate">
              {resultado.advertenciaAdministrativo}
            </p>
          )}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {/* `director` nunca es null — su alta es atómica con la sede
                (si falla, la sede entera se borra, ver
                `SedesService.crearConFundadores`). `administrativo` es
                best-effort: puede venir `null` si su alta falló, ver
                `advertenciaAdministrativo` arriba. */}
            <CredencialesCard titulo="Director" resultado={resultado.director} />
            {resultado.administrativo && (
              <CredencialesCard titulo="Administrativo" resultado={resultado.administrativo} />
            )}
          </div>
          <div className="mt-6">
            <Link
              href="/plataforma/sedes"
              className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
            >
              Volver a sedes
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl p-8">
      <PlataformaNav activo="sedes" titulo="Sedes" />

      <AltaPersonaFormShell
        titulo="Nueva sede"
        descripcion="Crea la sede junto con sus 2 cuentas administrativas fundadoras — un director (SUPER_ADMIN) y un administrativo (ADMIN). Ambas cuentas quedan listas de inmediato, con contraseña temporal."
        onSubmit={handleSubmit((values) => mutation.mutate(values))}
        isPending={mutation.isPending}
        submitLabel="Crear sede y cuentas"
      >
        <fieldset className="space-y-4 rounded-lg border border-mist bg-bone/50 p-4">
          <legend className="px-1 font-display text-base font-semibold text-slate">
            Datos de la sede
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="sede-nombre" className={LABEL_CLASS}>
                Nombre
              </label>
              <input
                id="sede-nombre"
                disabled={mutation.isPending}
                className={INPUT_CLASS}
                {...register('sede.nombre')}
              />
              <FieldError message={errors.sede?.nombre?.message} />
            </div>
            <div>
              <label htmlFor="sede-telefono" className={LABEL_CLASS}>
                Teléfono
              </label>
              <input
                id="sede-telefono"
                disabled={mutation.isPending}
                className={INPUT_CLASS}
                {...register('sede.telefono')}
              />
              <FieldError message={errors.sede?.telefono?.message} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="sede-direccion" className={LABEL_CLASS}>
                Dirección
              </label>
              <input
                id="sede-direccion"
                disabled={mutation.isPending}
                className={INPUT_CLASS}
                {...register('sede.direccion')}
              />
              <FieldError message={errors.sede?.direccion?.message} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="sede-ubicacionReferencia" className={LABEL_CLASS}>
                Referencia de ubicación
              </label>
              <input
                id="sede-ubicacionReferencia"
                disabled={mutation.isPending}
                className={INPUT_CLASS}
                {...register('sede.ubicacionReferencia')}
              />
              <FieldError message={errors.sede?.ubicacionReferencia?.message} />
            </div>
          </div>
        </fieldset>

        <SeccionFundador
          titulo="Director (SUPER_ADMIN)"
          prefix="director"
          register={register}
          errors={errors}
          control={control}
          disabled={mutation.isPending}
        />

        <SeccionFundador
          titulo="Administrativo (ADMIN)"
          prefix="administrativo"
          register={register}
          errors={errors}
          control={control}
          disabled={mutation.isPending}
        />
      </AltaPersonaFormShell>
    </main>
  );
}
