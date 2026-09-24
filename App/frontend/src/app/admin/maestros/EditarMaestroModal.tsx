'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { ContactosFieldset } from '@/components/admin/ui/persona-alta/ContactosFieldset';
import { DatosPersonalesFieldset } from '@/components/admin/ui/persona-alta/DatosPersonalesFieldset';
import { FieldError } from '@/components/admin/ui/persona-alta/FieldError';
import { INPUT_CLASS, LABEL_CLASS } from '@/components/admin/ui/persona-alta/estilos';
import { InfoMedicaFieldset } from '@/components/admin/ui/persona-alta/InfoMedicaFieldset';
import {
  MENSAJE_ERROR_GENERICO,
  resolverMensajeError,
} from '@/components/admin/ui/persona-alta/mensajes-error';
import { contactosSchema, infoMedicaSchema } from '@/components/admin/ui/persona-alta/schemas';
import { Select } from '@/components/admin/ui/persona-alta/Select';
import {
  editarPersona,
  obtenerPersonaParaEditar,
  type PersonaParaEditar,
} from '@/lib/api/personas';

/**
 * Modal de edición de datos de maestro — feature "Edición de datos de
 * persona" (2026-09-20, spec `docs/superpowers/specs/2026-09-20-edicion-datos-persona-design.md`).
 *
 * Disparado por el lápiz de `app/admin/maestros/page.tsx` (`TablaMaestros`).
 * Precarga vía `GET /personas/:id` (`obtenerPersonaParaEditar`), reusa el
 * mismo `perfilMaestroSchema`/fieldsets que `app/admin/maestros/nuevo/page.tsx`
 * (sin campo `estatus`/foto/password — esos tienen su propio flujo, fuera de
 * este modal, ver spec). Mismo patrón que `EditarAlumnoModal.tsx` (Task 4).
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

const maestroEditarSchema = z.object({
  // `codigoExterno` oculto a pedido del usuario (2026-09-23) — ver
  // `CuentaFieldset.tsx`. No borrar. Al omitirlo del payload de `PATCH`
  // (ver `onSubmit` más abajo), el backend lo deja intacto (Prisma ignora
  // claves `undefined` en `data`) en vez de borrarlo.
  // codigoExterno: z.string().optional(),
  perfilMaestro: perfilMaestroSchema,
});

type MaestroEditarFormInput = z.infer<typeof maestroEditarSchema>;

function valoresIniciales(persona: PersonaParaEditar): MaestroEditarFormInput {
  const perfil = persona.perfilMaestro!;
  return {
    // codigoExterno: persona.codigoExterno ?? '', — comentado junto con el campo, ver arriba.
    perfilMaestro: {
      nombres: perfil.nombres,
      apellidoPaterno: perfil.apellidoPaterno,
      apellidoMaterno: perfil.apellidoMaterno ?? '',
      curp: perfil.curp,
      cedulaProfesional: perfil.cedulaProfesional ?? '',
      correoPersonal: perfil.correoPersonal,
      telefono: perfil.telefono,
      fechaContratacion: perfil.fechaContratacion,
      tipoContratacion: (perfil.tipoContratacion ??
        'BASE') as MaestroEditarFormInput['perfilMaestro']['tipoContratacion'],
      diasTemporal: perfil.diasTemporal ? String(perfil.diasTemporal) : '',
      contratoFechaInicio: perfil.contratoFechaInicio ?? '',
      contratoFechaFin: perfil.contratoFechaFin ?? '',
      contactos:
        persona.contactos.length > 0
          ? persona.contactos.map((c) => ({
              nombre: c.nombre,
              telefono: c.telefono,
              correo: c.correo ?? '',
              parentesco: c.parentesco,
            }))
          : [{ nombre: '', telefono: '', correo: '', parentesco: '' }],
      infoMedica: {
        tieneCondicionMedica: persona.infoMedica.tieneCondicionMedica,
        tipoSangre: (persona.infoMedica.tipoSangre ??
          '') as MaestroEditarFormInput['perfilMaestro']['infoMedica']['tipoSangre'],
        padecimiento: persona.infoMedica.padecimiento ?? '',
        medicamentos: persona.infoMedica.medicamentos ?? '',
        alergias: persona.infoMedica.alergias ?? '',
        tratamientoAdicional: persona.infoMedica.tratamientoAdicional ?? '',
      },
    },
  };
}

export function EditarMaestroModal({
  usuarioId,
  onClose,
  onGuardadoConExito,
}: {
  usuarioId: string;
  onClose: () => void;
  onGuardadoConExito: () => void;
}) {
  const personaQuery = useQuery({
    queryKey: ['admin', 'personas', 'editar', usuarioId],
    queryFn: async () => {
      try {
        return await obtenerPersonaParaEditar(usuarioId);
      } catch (err) {
        console.error('[EditarMaestroModal] Error al obtener la persona:', err);
        throw err;
      }
    },
  });

  // Cierre con Escape — mismo criterio que el click en el overlay/botón ✕
  // (`onClose`), que este modal no bloquea mientras `mutation.isPending`.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="editar-maestro-titulo"
        className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white p-6 shadow-lg sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2
            id="editar-maestro-titulo"
            className="font-display text-lg font-semibold text-slate"
          >
            {personaQuery.data?.perfilMaestro
              ? `Editar a ${[
                  personaQuery.data.perfilMaestro.nombres,
                  personaQuery.data.perfilMaestro.apellidoPaterno,
                ]
                  .filter(Boolean)
                  .join(' ')}`
              : 'Editar maestro'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate/60 hover:text-slate"
          >
            ✕
          </button>
        </div>

        {personaQuery.isError ? (
          <p className="mt-6 rounded-lg border border-error-border bg-error-bg px-3 py-2 text-sm text-crimson">
            No se pudo cargar la información. Intenta de nuevo.
          </p>
        ) : personaQuery.isSuccess ? (
          <FormularioEdicion
            usuarioId={usuarioId}
            persona={personaQuery.data}
            onClose={onClose}
            onGuardadoConExito={onGuardadoConExito}
          />
        ) : (
          <p className="mt-6 text-sm text-slate/60">Cargando…</p>
        )}
      </div>
    </div>
  );
}

function FormularioEdicion({
  usuarioId,
  persona,
  onClose,
  onGuardadoConExito,
}: {
  usuarioId: string;
  persona: PersonaParaEditar;
  onClose: () => void;
  onGuardadoConExito: () => void;
}) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<MaestroEditarFormInput>({
    resolver: zodResolver(maestroEditarSchema),
    defaultValues: valoresIniciales(persona),
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
    mutationFn: (values: MaestroEditarFormInput) =>
      editarPersona(usuarioId, {
        // A diferencia de `crearMaestro` (alta, sin valor previo que
        // preservar), acá NO se coalesce string vacío a `undefined` en
        // `apellidoMaterno`/`cedulaProfesional`: `PATCH /personas/:id` hace
        // un `update` parcial de Prisma, donde `undefined` en `data`
        // significa "no tocar esta columna" — coalescer perdería
        // silenciosamente el borrado de un campo opcional que el admin
        // vació a propósito. Se manda `null` explícito para que el borrado
        // sí se persista. `contactos` sí se queda con el coalesce a
        // `undefined` de abajo — va por delete+recreate completo en el
        // backend, no por `update` parcial, así que ahí `undefined` es
        // correcto. `infoMedica` es un `upsert` (no delete+recreate), así
        // que igual que los campos de arriba necesita `null` explícito para
        // limpiar — ver el bloque de abajo.
        //
        // `codigoExterno` oculto (ver `CuentaFieldset.tsx`) — se omite del
        // payload a propósito, no se manda `null`, para que el `update`
        // parcial lo deje intacto en vez de borrarlo sin que el admin lo
        // haya tocado.
        // codigoExterno: values.codigoExterno || null,
        perfilMaestro: {
          ...values.perfilMaestro,
          apellidoMaterno: values.perfilMaestro.apellidoMaterno || null,
          cedulaProfesional: values.perfilMaestro.cedulaProfesional || null,
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
            tieneCondicionMedica: values.perfilMaestro.infoMedica.tieneCondicionMedica,
            padecimiento: values.perfilMaestro.infoMedica.tieneCondicionMedica
              ? values.perfilMaestro.infoMedica.padecimiento || null
              : null,
            medicamentos: values.perfilMaestro.infoMedica.tieneCondicionMedica
              ? values.perfilMaestro.infoMedica.medicamentos || null
              : null,
            alergias: values.perfilMaestro.infoMedica.tieneCondicionMedica
              ? values.perfilMaestro.infoMedica.alergias || null
              : null,
            tratamientoAdicional: values.perfilMaestro.infoMedica.tieneCondicionMedica
              ? values.perfilMaestro.infoMedica.tratamientoAdicional || null
              : null,
          },
        },
      }),
    onSuccess: () => {
      toast.success('Maestro actualizado.');
      // Fix de revisión final de rama (2026-09-20) — sin esto, reabrir el
      // modal del mismo maestro mostraba los datos viejos (caché de
      // `['admin', 'personas', 'editar', usuarioId]` servido antes de que
      // resuelva el refetch en background) y un segundo guardado revertía
      // silenciosamente la edición recién hecha.
      queryClient.invalidateQueries({ queryKey: ['admin', 'personas', 'editar', usuarioId] });
      onGuardadoConExito();
      onClose();
    },
    onError: (error) => {
      console.error('[EditarMaestroModal] Error al editar maestro:', error);
      toast.error(resolverMensajeError(error) ?? MENSAJE_ERROR_GENERICO);
    },
  });

  function onSubmit(values: MaestroEditarFormInput) {
    mutation.mutate(values);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-6" noValidate>
      <DatosPersonalesFieldset
        register={register}
        errors={errors}
        disabled={mutation.isPending}
        prefix="perfilMaestro"
        curpOpcional={false}
        telefonoOpcional={false}
      />

      <div className="grid gap-6 md:grid-cols-2">
        <fieldset className="space-y-4 rounded-lg border border-mist bg-bone/50 p-4">
          <legend className="text-sm font-semibold text-slate">Datos laborales</legend>
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
            <div className="grid gap-4 sm:grid-cols-2">
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
                <FieldError message={errors.perfilMaestro?.contratoFechaInicio?.message} />
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
                <FieldError message={errors.perfilMaestro?.contratoFechaFin?.message} />
              </div>
            </div>
          )}
          {/* `codigoExterno` oculto a pedido del usuario (2026-09-23) — ver
              `CuentaFieldset.tsx`. No borrar.
          <div>
            <label htmlFor="codigoExterno" className={LABEL_CLASS}>
              Código externo (opcional)
            </label>
            <input
              id="codigoExterno"
              type="text"
              disabled={mutation.isPending}
              className={INPUT_CLASS}
              {...register('codigoExterno')}
            />
            <FieldError message={errors.codigoExterno?.message} />
          </div>
          */}
        </fieldset>

        <InfoMedicaFieldset
          control={control}
          register={register}
          errors={errors}
          disabled={mutation.isPending}
          prefix="perfilMaestro"
          tieneCondicionMedica={Boolean(tieneCondicionMedica)}
        />
      </div>

      <ContactosFieldset
        control={control}
        register={register}
        errors={errors}
        disabled={mutation.isPending}
        prefix="perfilMaestro"
      />

      <div className="flex justify-end gap-3 border-t border-mist pt-5">
        <button
          type="button"
          onClick={onClose}
          disabled={mutation.isPending}
          className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30 disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
        >
          {mutation.isPending ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  );
}
