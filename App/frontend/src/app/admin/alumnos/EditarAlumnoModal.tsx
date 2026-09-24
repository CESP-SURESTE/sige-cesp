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
import {
  contactosAlumnoSchema,
  infoMedicaSchema,
} from '@/components/admin/ui/persona-alta/schemas';
import { Select } from '@/components/admin/ui/persona-alta/Select';
import { listarCarreras } from '@/lib/api/carreras';
import {
  editarPersona,
  obtenerPersonaParaEditar,
  type PersonaParaEditar,
} from '@/lib/api/personas';

/**
 * Modal de edición de datos de alumno — feature "Edición de datos de
 * persona" (2026-09-20, spec `docs/superpowers/specs/2026-09-20-edicion-datos-persona-design.md`).
 *
 * Disparado por el lápiz de `app/admin/alumnos/page.tsx` (`TablaAlumnos`).
 * Precarga vía `GET /personas/:id` (`obtenerPersonaParaEditar`), reusa el
 * mismo `alumnoSchema`/fieldsets que `app/admin/alumnos/nuevo/page.tsx`
 * (sin campo `estatus`/foto/password — esos tienen su propio flujo, fuera
 * de este modal, ver spec).
 */
const alumnoEditarSchema = z.object({
  // `codigoExterno` oculto a pedido del usuario (2026-09-23) — ver
  // `CuentaFieldset.tsx`. No borrar. Al omitirlo del payload de `PATCH`
  // (ver `onSubmit` más abajo), el backend lo deja intacto (Prisma ignora
  // claves `undefined` en `data`) en vez de borrarlo.
  // codigoExterno: z.string().optional(),
  perfilAlumno: z.object({
    nombres: z.string().min(1, 'Los nombres son requeridos'),
    apellidoPaterno: z.string().min(1, 'El apellido paterno es requerido'),
    apellidoMaterno: z.string().optional(),
    curp: z.string().optional(),
    fechaNacimiento: z.string().min(1, 'La fecha de nacimiento es requerida'),
    correoPersonal: z
      .string()
      .min(1, 'El correo personal es requerido')
      .email('Formato de correo inválido'),
    carreraId: z.string().min(1, 'Selecciona una carrera'),
    periodoIngreso: z.string().min(1, 'El periodo de ingreso es requerido'),
    cuatrimestreActual: z.coerce
      .number()
      .int('El cuatrimestre debe ser un número entero')
      .min(1, 'El cuatrimestre debe ser al menos 1'),
    telefono: z.string().optional(),
    contactos: contactosAlumnoSchema,
    infoMedica: infoMedicaSchema,
  }),
});

type AlumnoEditarFormInput = z.input<typeof alumnoEditarSchema>;
type AlumnoEditarFormOutput = z.output<typeof alumnoEditarSchema>;

function valoresIniciales(persona: PersonaParaEditar): AlumnoEditarFormInput {
  const perfil = persona.perfilAlumno!;
  return {
    // codigoExterno: persona.codigoExterno ?? '', — comentado junto con el campo, ver arriba.
    perfilAlumno: {
      nombres: perfil.nombres,
      apellidoPaterno: perfil.apellidoPaterno,
      apellidoMaterno: perfil.apellidoMaterno ?? '',
      curp: perfil.curp ?? '',
      fechaNacimiento: perfil.fechaNacimiento,
      correoPersonal: perfil.correoPersonal,
      carreraId: perfil.carreraId,
      periodoIngreso: perfil.periodoIngreso,
      cuatrimestreActual: perfil.cuatrimestreActual,
      telefono: perfil.telefono ?? '',
      contactos:
        persona.contactos.length > 0
          ? persona.contactos.map((c) => ({
              nombre: c.nombre,
              telefono: c.telefono,
              correo: c.correo ?? '',
              parentesco: c.parentesco,
              tipo: (c.tipo ?? '') as AlumnoEditarFormInput['perfilAlumno']['contactos'][number]['tipo'],
            }))
          : [{ nombre: '', telefono: '', correo: '', parentesco: '', tipo: '' as never }],
      infoMedica: {
        tieneCondicionMedica: persona.infoMedica.tieneCondicionMedica,
        tipoSangre: (persona.infoMedica.tipoSangre ??
          '') as AlumnoEditarFormInput['perfilAlumno']['infoMedica']['tipoSangre'],
        padecimiento: persona.infoMedica.padecimiento ?? '',
        medicamentos: persona.infoMedica.medicamentos ?? '',
        alergias: persona.infoMedica.alergias ?? '',
        tratamientoAdicional: persona.infoMedica.tratamientoAdicional ?? '',
      },
    },
  };
}

const MENSAJES_ERROR_ALUMNO: Record<string, string> = {
  NOT_FOUND: 'La carrera seleccionada no existe o no pertenece a tu sede.',
};

export function EditarAlumnoModal({
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
        console.error('[EditarAlumnoModal] Error al obtener la persona:', err);
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
        aria-labelledby="editar-alumno-titulo"
        className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white p-6 shadow-lg sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2
            id="editar-alumno-titulo"
            className="font-display text-lg font-semibold text-slate"
          >
            {personaQuery.data?.perfilAlumno
              ? `Editar a ${[
                  personaQuery.data.perfilAlumno.nombres,
                  personaQuery.data.perfilAlumno.apellidoPaterno,
                ]
                  .filter(Boolean)
                  .join(' ')}`
              : 'Editar alumno'}
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

  const carrerasQuery = useQuery({
    queryKey: ['carreras'],
    queryFn: async () => {
      try {
        return await listarCarreras();
      } catch (err) {
        console.error('[EditarAlumnoModal] Error al listar carreras:', err);
        throw err;
      }
    },
  });

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<AlumnoEditarFormInput, unknown, AlumnoEditarFormOutput>({
    resolver: zodResolver(alumnoEditarSchema),
    defaultValues: valoresIniciales(persona),
  });

  const tieneCondicionMedica = useWatch({
    control,
    name: 'perfilAlumno.infoMedica.tieneCondicionMedica',
  });

  const mutation = useMutation({
    mutationFn: (values: AlumnoEditarFormOutput) =>
      editarPersona(usuarioId, {
        // A diferencia de `crearAlumno` (alta, sin valor previo que
        // preservar), acá NO se coalesce string vacío a `undefined` en estos
        // campos: `PATCH /personas/:id` hace un `update` parcial de Prisma,
        // donde `undefined` en `data` significa "no tocar esta columna" —
        // coalescer perdería silenciosamente el borrado de un campo
        // opcional que el admin vació a propósito. Se manda `null` explícito
        // para que el borrado sí se persista. `contactos` sí se queda con el
        // coalesce a `undefined` de abajo — va por delete+recreate completo
        // en el backend, no por `update` parcial, así que ahí `undefined` es
        // correcto. `infoMedica` es un `upsert` (no delete+recreate), así
        // que igual que los campos de arriba necesita `null` explícito para
        // limpiar — ver el bloque de abajo.
        // `codigoExterno` oculto (ver `CuentaFieldset.tsx`) — se omite del
        // payload a propósito, no se manda `null`, para que el `update`
        // parcial de Prisma lo deje intacto en vez de borrarlo sin que el
        // admin lo haya tocado.
        // codigoExterno: values.codigoExterno || null,
        perfilAlumno: {
          ...values.perfilAlumno,
          apellidoMaterno: values.perfilAlumno.apellidoMaterno || null,
          curp: values.perfilAlumno.curp || null,
          telefono: values.perfilAlumno.telefono || null,
          contactos: values.perfilAlumno.contactos.map((contacto) => ({
            ...contacto,
            correo: contacto.correo || undefined,
          })),
          infoMedica: {
            tipoSangre: values.perfilAlumno.infoMedica.tipoSangre,
            tieneCondicionMedica: values.perfilAlumno.infoMedica.tieneCondicionMedica,
            padecimiento: values.perfilAlumno.infoMedica.tieneCondicionMedica
              ? values.perfilAlumno.infoMedica.padecimiento || null
              : null,
            medicamentos: values.perfilAlumno.infoMedica.tieneCondicionMedica
              ? values.perfilAlumno.infoMedica.medicamentos || null
              : null,
            alergias: values.perfilAlumno.infoMedica.tieneCondicionMedica
              ? values.perfilAlumno.infoMedica.alergias || null
              : null,
            tratamientoAdicional: values.perfilAlumno.infoMedica.tieneCondicionMedica
              ? values.perfilAlumno.infoMedica.tratamientoAdicional || null
              : null,
          },
        },
      }),
    onSuccess: () => {
      toast.success('Alumno actualizado.');
      // Fix de revisión final de rama (2026-09-20) — sin esto, reabrir el
      // modal del mismo alumno mostraba los datos viejos (caché de
      // `['admin', 'personas', 'editar', usuarioId]` servido antes de que
      // resuelva el refetch en background) y un segundo guardado revertía
      // silenciosamente la edición recién hecha.
      queryClient.invalidateQueries({ queryKey: ['admin', 'personas', 'editar', usuarioId] });
      onGuardadoConExito();
      onClose();
    },
    onError: (error) => {
      console.error('[EditarAlumnoModal] Error al editar alumno:', error);
      toast.error(resolverMensajeError(error, MENSAJES_ERROR_ALUMNO) ?? MENSAJE_ERROR_GENERICO);
    },
  });

  function onSubmit(values: AlumnoEditarFormOutput) {
    mutation.mutate(values);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-6" noValidate>
      <DatosPersonalesFieldset
        register={register}
        errors={errors}
        disabled={mutation.isPending}
        prefix="perfilAlumno"
      />

      <div className="grid gap-6 md:grid-cols-2">
        <fieldset className="space-y-4 rounded-lg border border-mist bg-bone/50 p-4">
          <legend className="text-sm font-semibold text-slate">Datos académicos</legend>
          <div>
            <label htmlFor="fechaNacimiento" className={LABEL_CLASS}>
              Fecha de nacimiento
            </label>
            <input
              id="fechaNacimiento"
              type="date"
              disabled={mutation.isPending}
              className={INPUT_CLASS}
              {...register('perfilAlumno.fechaNacimiento')}
            />
            <FieldError message={errors.perfilAlumno?.fechaNacimiento?.message} />
          </div>
          <div>
            <label htmlFor="carreraId" className={LABEL_CLASS}>
              Carrera
            </label>
            <Controller
              control={control}
              name="perfilAlumno.carreraId"
              render={({ field }) => (
                <Select
                  id="carreraId"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  disabled={mutation.isPending || carrerasQuery.isLoading}
                  placeholder={
                    carrerasQuery.isLoading ? 'Cargando carreras…' : 'Selecciona una carrera'
                  }
                  options={(carrerasQuery.data ?? []).map((c) => ({
                    value: c.id,
                    label: `${c.clave} — ${c.nombre}`,
                  }))}
                />
              )}
            />
            <FieldError message={errors.perfilAlumno?.carreraId?.message} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="periodoIngreso" className={LABEL_CLASS}>
                Periodo de ingreso
              </label>
              <input
                id="periodoIngreso"
                type="text"
                disabled={mutation.isPending}
                className={INPUT_CLASS}
                {...register('perfilAlumno.periodoIngreso')}
              />
              <FieldError message={errors.perfilAlumno?.periodoIngreso?.message} />
            </div>
            <div>
              <label htmlFor="cuatrimestreActual" className={LABEL_CLASS}>
                Cuatrimestre actual
              </label>
              <input
                id="cuatrimestreActual"
                type="number"
                min={1}
                step={1}
                disabled={mutation.isPending}
                className={INPUT_CLASS}
                {...register('perfilAlumno.cuatrimestreActual')}
              />
              <FieldError message={errors.perfilAlumno?.cuatrimestreActual?.message} />
            </div>
          </div>
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
          prefix="perfilAlumno"
          tieneCondicionMedica={Boolean(tieneCondicionMedica)}
        />
      </div>

      <ContactosFieldset
        control={control}
        register={register}
        errors={errors}
        disabled={mutation.isPending}
        prefix="perfilAlumno"
        mostrarTipo
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
