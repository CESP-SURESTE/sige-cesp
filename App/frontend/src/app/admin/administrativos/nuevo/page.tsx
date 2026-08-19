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
import { crearAdministrativo, type AltaPersonaResult } from '@/lib/api/personas';

/**
 * Formulario de alta de administrativo — Fase 4, Día 15. Mismo patrón que
 * `app/admin/{alumnos,maestros}/nuevo/page.tsx`, usando el componente de
 * formulario base (`components/admin/ui/persona-alta/`). El fieldset "Datos
 * laborales" agrega, sobre el de maestro, `puesto` (requerido) y
 * `nivelPermiso` (opcional, default `AUXILIAR` en el backend).
 *
 * Schema de validación en cliente (`administrativoSchema`) es espejo de
 * `CrearPersonaDto` + `PerfilAdministrativoDto`
 * (`App/backend/src/personas/dto/crear-persona.dto.ts`) — `curp`/`telefono`
 * requeridos, igual que maestro (`curpOpcional={false}`/
 * `telefonoOpcional={false}`).
 *
 * **`NIVEL_PERMISO_INSUFICIENTE`** (403, documentado en `CLAUDE.md` raíz,
 * regla 7 — jerarquía `SUPER_ADMIN > ADMIN > AUXILIAR`): el backend lo
 * devuelve si el actor no tiene permiso para asignar el `nivelPermiso`
 * pedido (o para dar de alta a un `ADMINISTRATIVO` en general, si el actor
 * es `AUXILIAR`). Se mapea aquí, junto a los códigos comunes
 * (`CONFLICT`/`VALIDATION_ERROR`/`ROL_NO_AUTORIZADO`) ya cubiertos por
 * `resolverMensajeError`.
 *
 * `email` (raíz) YA NO se captura en este formulario (2026-08-18) — el
 * backend lo genera (nombre+inicial+contador@acceso.cesp.edu.mx) y rechaza
 * `POST /personas` con `400 VALIDATION_ERROR` si se manda. Se muestra
 * después del alta, generado, en `ResultadoAltaPersona`
 * (`resultado.usuario.email`) — igual que en alumno/maestro. El correo de
 * bienvenida (Día 13, desbloqueado) va a `correoPersonal`, no a este login
 * sintético.
 *
 * Sin campo `estatus` — el backend fuerza siempre `ACTIVO` en la creación
 * (corrección de QA manual, 2026-08-12, ver nota en `crear-persona.dto.ts`);
 * cambiar el estatus después es un flujo aparte.
 *
 * `contactos`/`infoMedica` (extensión 2026-08-12, misma transacción que el
 * alta, decisión del usuario) — `ContactosFieldset` (sin `mostrarTipo`, ese
 * campo es exclusivo de alumno) e `InfoMedicaFieldset`, ver esos componentes
 * en `components/admin/ui/persona-alta/`.
 */

const PUESTO_OPCIONES = [
  'DIRECTOR',
  'COORDINADOR_ACADEMICO',
  'COORDINADOR_ADMINISTRATIVO',
  'AUXILIAR',
  'RECEPCION',
  'OTRO',
] as const;

const NIVEL_PERMISO_OPCIONES = ['SUPER_ADMIN', 'ADMIN', 'AUXILIAR'] as const;

const MENSAJES_ERROR_ADMINISTRATIVO: Record<string, string> = {
  NIVEL_PERMISO_INSUFICIENTE:
    'No tienes permiso suficiente para dar de alta a este administrativo con el puesto/nivel de permiso indicado.',
};

const administrativoSchema = z.object({
  codigoExterno: z.string().optional(),
  perfilAdministrativo: z.object({
    nombres: z.string().min(1, 'Los nombres son requeridos'),
    apellidoPaterno: z.string().min(1, 'El apellido paterno es requerido'),
    apellidoMaterno: z.string().optional(),
    curp: z.string().min(1, 'El CURP es requerido'),
    correoPersonal: z
      .string()
      .min(1, 'El correo personal es requerido')
      .email('Formato de correo inválido'),
    telefono: z.string().min(1, 'El teléfono es requerido'),
    fechaContratacion: z
      .string()
      .min(1, 'La fecha de contratación es requerida'),
    puesto: z.enum(PUESTO_OPCIONES, {
      message: 'Selecciona un puesto',
    }),
    nivelPermiso: z.enum(NIVEL_PERMISO_OPCIONES).optional().or(z.literal('')),
    contactos: contactosSchema,
    infoMedica: infoMedicaSchema,
  }),
});

type AdministrativoFormValues = z.infer<typeof administrativoSchema>;

const DEFAULT_VALUES: AdministrativoFormValues = {
  codigoExterno: '',
  perfilAdministrativo: {
    nombres: '',
    apellidoPaterno: '',
    apellidoMaterno: '',
    curp: '',
    correoPersonal: '',
    telefono: '',
    fechaContratacion: '',
    puesto: '' as AdministrativoFormValues['perfilAdministrativo']['puesto'],
    nivelPermiso: '',
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

export default function NuevoAdministrativoPage() {
  const [resultado, setResultado] = useState<AltaPersonaResult | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<AdministrativoFormValues>({
    resolver: zodResolver(administrativoSchema),
    defaultValues: DEFAULT_VALUES,
  });

  const tieneCondicionMedica = useWatch({
    control,
    name: 'perfilAdministrativo.infoMedica.tieneCondicionMedica',
  });

  const mutation = useMutation({
    mutationFn: (values: AdministrativoFormValues) =>
      crearAdministrativo({
        codigoExterno: values.codigoExterno || undefined,
        perfilAdministrativo: {
          ...values.perfilAdministrativo,
          apellidoMaterno: values.perfilAdministrativo.apellidoMaterno || undefined,
          nivelPermiso: values.perfilAdministrativo.nivelPermiso || undefined,
          contactos: values.perfilAdministrativo.contactos.map((contacto) => ({
            ...contacto,
            correo: contacto.correo || undefined,
          })),
          infoMedica: values.perfilAdministrativo.infoMedica.tieneCondicionMedica
            ? {
                tieneCondicionMedica: true,
                padecimiento:
                  values.perfilAdministrativo.infoMedica.padecimiento || undefined,
                medicamentos:
                  values.perfilAdministrativo.infoMedica.medicamentos || undefined,
                alergias: values.perfilAdministrativo.infoMedica.alergias || undefined,
                tratamientoAdicional:
                  values.perfilAdministrativo.infoMedica.tratamientoAdicional || undefined,
              }
            : { tieneCondicionMedica: false },
        },
      }),
    onSuccess: (data) => {
      setResultado(data);
      reset(DEFAULT_VALUES);
    },
    onError: (error) => {
      toast.error(
        resolverMensajeError(error, MENSAJES_ERROR_ADMINISTRATIVO) ?? MENSAJE_ERROR_GENERICO,
      );
    },
  });

  function onSubmit(values: AdministrativoFormValues) {
    mutation.mutate(values);
  }

  if (resultado) {
    return (
      <ResultadoAltaPersona
        resultado={resultado}
        titulo="Administrativo dado de alta"
        botonOtroLabel="Dar de alta otro administrativo"
        onReset={() => setResultado(null)}
      />
    );
  }

  return (
    <AltaPersonaFormShell
      titulo="Alta de administrativo"
      descripcion="Crea la cuenta y el perfil del administrativo. La contraseña temporal se muestra al terminar — la entrega del correo de bienvenida no está garantizada (dominio en modo de prueba), comunícala tú mismo como respaldo."
      onSubmit={handleSubmit(onSubmit)}
      isPending={mutation.isPending}
    >
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="flex flex-col gap-5">
          <CuentaFieldset register={register} errors={errors} disabled={mutation.isPending} />

          <InfoMedicaFieldset
            register={register}
            errors={errors}
            disabled={mutation.isPending}
            prefix="perfilAdministrativo"
            tieneCondicionMedica={Boolean(tieneCondicionMedica)}
          />
        </div>

        <DatosPersonalesFieldset
          register={register}
          errors={errors}
          disabled={mutation.isPending}
          prefix="perfilAdministrativo"
          curpOpcional={false}
          telefonoOpcional={false}
        />

        <fieldset className="space-y-3 rounded-lg border border-mist bg-bone/50 p-4">
          <legend className="text-sm font-semibold text-slate">Datos laborales</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="fechaContratacion" className={LABEL_CLASS}>
                Fecha de contratación
              </label>
              <input
                id="fechaContratacion"
                type="date"
                disabled={mutation.isPending}
                className={INPUT_CLASS}
                {...register('perfilAdministrativo.fechaContratacion')}
              />
              <FieldError message={errors.perfilAdministrativo?.fechaContratacion?.message} />
            </div>
            <div>
              <label htmlFor="puesto" className={LABEL_CLASS}>
                Puesto
              </label>
              <Controller
                control={control}
                name="perfilAdministrativo.puesto"
                render={({ field }) => (
                  <Select
                    id="puesto"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    disabled={mutation.isPending}
                    placeholder="Selecciona un puesto"
                    options={PUESTO_OPCIONES.map((valor) => ({ value: valor, label: valor }))}
                  />
                )}
              />
              <FieldError message={errors.perfilAdministrativo?.puesto?.message} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="nivelPermiso" className={LABEL_CLASS}>
                Nivel de permiso (opcional, por defecto AUXILIAR)
              </label>
              <Controller
                control={control}
                name="perfilAdministrativo.nivelPermiso"
                render={({ field }) => (
                  <Select
                    id="nivelPermiso"
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    disabled={mutation.isPending}
                    placeholder="AUXILIAR (por defecto)"
                    options={NIVEL_PERMISO_OPCIONES.map((valor) => ({
                      value: valor,
                      label: valor,
                    }))}
                  />
                )}
              />
              <p className="mt-1 text-xs text-slate/60">
                Solo puedes asignar un nivel igual o menor al tuyo — el backend rechaza la
                solicitud con <code>NIVEL_PERMISO_INSUFICIENTE</code> si intentas asignar más.
              </p>
              <FieldError message={errors.perfilAdministrativo?.nivelPermiso?.message} />
            </div>
          </div>
        </fieldset>
      </div>

      <ContactosFieldset
        control={control}
        register={register}
        errors={errors}
        disabled={mutation.isPending}
        prefix="perfilAdministrativo"
      />
    </AltaPersonaFormShell>
  );
}
