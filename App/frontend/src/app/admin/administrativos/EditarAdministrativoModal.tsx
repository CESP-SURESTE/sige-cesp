'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
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
  type NivelPermiso,
  type PersonaParaEditar,
} from '@/lib/api/personas';

/**
 * Modal de edición de datos de administrativo — feature "Edición de datos de
 * persona" (2026-09-20, spec `docs/superpowers/specs/2026-09-20-edicion-datos-persona-design.md`).
 *
 * Disparado por el lápiz de `app/admin/administrativos/page.tsx`
 * (`TablaAdministrativos`). Precarga vía `GET /personas/:id`
 * (`obtenerPersonaParaEditar`), reusa el mismo `administrativoSchema`/
 * fieldsets que `app/admin/administrativos/nuevo/page.tsx` (sin campo
 * `estatus`/foto/password — esos tienen su propio flujo, fuera de este
 * modal, ver spec). Mismo patrón que `EditarAlumnoModal.tsx`/
 * `EditarMaestroModal.tsx` (Tasks 4/5).
 *
 * Diferencia sobre esos dos: `nivelPermiso` SIEMPRE tiene un valor real acá
 * (a diferencia del alta, donde es opcional-con-default `AUXILIAR` en el
 * backend) y está sujeto a la jerarquía `SUPER_ADMIN > ADMIN > AUXILIAR`
 * (regla 7 de `CLAUDE.md` raíz) — el `<select>` de este modal filtra sus
 * opciones según `nivelPermisoActor` (UX preventiva; el backend sigue siendo
 * la fuente de verdad real, responde `403 NIVEL_PERMISO_INSUFICIENTE` si de
 * todos modos se intenta asignar más de lo permitido).
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

const JERARQUIA_NIVEL_PERMISO: Record<string, number> = {
  AUXILIAR: 0,
  ADMIN: 1,
  SUPER_ADMIN: 2,
};

/**
 * Filtra `NIVEL_PERMISO_OPCIONES` a las que `nivelPermisoActor` sí puede
 * asignar (rango igual o menor al propio). El `Select` de este árbol
 * (`components/admin/ui/persona-alta/Select.tsx`) no soporta deshabilitar
 * opciones individuales, así que se filtra la lista de opciones en vez de
 * modificarlo. `nivelPermisoActor` puede llegar `undefined` mientras
 * `GET /perfil` sigue cargando — en ese caso se muestran todas (no hay forma
 * de saber todavía qué ocultar; el backend sigue validando igual).
 */
function opcionesNivelPermisoDisponibles(
  nivelPermisoActor: string | undefined,
): readonly ('SUPER_ADMIN' | 'ADMIN' | 'AUXILIAR')[] {
  if (nivelPermisoActor === undefined) return NIVEL_PERMISO_OPCIONES;
  const rangoActor = JERARQUIA_NIVEL_PERMISO[nivelPermisoActor];
  return NIVEL_PERMISO_OPCIONES.filter(
    (nivel) => JERARQUIA_NIVEL_PERMISO[nivel] <= rangoActor,
  );
}

const administrativoEditarSchema = z.object({
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
    nivelPermiso: z.enum(NIVEL_PERMISO_OPCIONES, {
      message: 'Selecciona un nivel de permiso',
    }),
    contactos: contactosSchema,
    infoMedica: infoMedicaSchema,
  }),
});

type AdministrativoEditarFormInput = z.infer<typeof administrativoEditarSchema>;

function valoresIniciales(persona: PersonaParaEditar): AdministrativoEditarFormInput {
  const perfil = persona.perfilAdministrativo!;
  return {
    codigoExterno: persona.codigoExterno ?? '',
    perfilAdministrativo: {
      nombres: perfil.nombres,
      apellidoPaterno: perfil.apellidoPaterno,
      apellidoMaterno: perfil.apellidoMaterno ?? '',
      curp: perfil.curp,
      correoPersonal: perfil.correoPersonal,
      telefono: perfil.telefono,
      fechaContratacion: perfil.fechaContratacion,
      puesto: perfil.puesto,
      nivelPermiso: perfil.nivelPermiso,
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
          '') as AdministrativoEditarFormInput['perfilAdministrativo']['infoMedica']['tipoSangre'],
        padecimiento: persona.infoMedica.padecimiento ?? '',
        medicamentos: persona.infoMedica.medicamentos ?? '',
        alergias: persona.infoMedica.alergias ?? '',
        tratamientoAdicional: persona.infoMedica.tratamientoAdicional ?? '',
      },
    },
  };
}

const MENSAJES_ERROR_ADMINISTRATIVO: Record<string, string> = {
  NIVEL_PERMISO_INSUFICIENTE:
    'No tienes permiso suficiente para editar a este administrativo con ese nivel de permiso.',
};

export function EditarAdministrativoModal({
  usuarioId,
  nivelPermisoActor,
  onClose,
  onGuardadoConExito,
}: {
  usuarioId: string;
  /** `nivelPermiso` del actor (`GET /perfil`, sub-objeto `administrativo`) —
   * `undefined` mientras esa query sigue cargando. Solo se usa para filtrar
   * las opciones del `<select>` de `nivelPermiso` (UX preventiva). */
  nivelPermisoActor: NivelPermiso | undefined;
  onClose: () => void;
  onGuardadoConExito: () => void;
}) {
  const personaQuery = useQuery({
    queryKey: ['admin', 'personas', 'editar', usuarioId],
    queryFn: async () => {
      try {
        return await obtenerPersonaParaEditar(usuarioId);
      } catch (err) {
        console.error('[EditarAdministrativoModal] Error al obtener la persona:', err);
        throw err;
      }
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-slate">
            Editar administrativo
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
            nivelPermisoActor={nivelPermisoActor}
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
  nivelPermisoActor,
  onClose,
  onGuardadoConExito,
}: {
  usuarioId: string;
  persona: PersonaParaEditar;
  nivelPermisoActor: NivelPermiso | undefined;
  onClose: () => void;
  onGuardadoConExito: () => void;
}) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<AdministrativoEditarFormInput>({
    resolver: zodResolver(administrativoEditarSchema),
    defaultValues: valoresIniciales(persona),
  });

  const tieneCondicionMedica = useWatch({
    control,
    name: 'perfilAdministrativo.infoMedica.tieneCondicionMedica',
  });

  const mutation = useMutation({
    mutationFn: (values: AdministrativoEditarFormInput) =>
      editarPersona(usuarioId, {
        // A diferencia de `crearAdministrativo` (alta, sin valor previo que
        // preservar), acá NO se coalesce string vacío a `undefined` en
        // `codigoExterno`/`apellidoMaterno`: `PATCH /personas/:id` hace un
        // `update` parcial de Prisma, donde `undefined` en `data` significa
        // "no tocar esta columna" — coalescer perdería silenciosamente el
        // borrado de un campo opcional que el admin vació a propósito.
        // `contactos`/`infoMedica` sí se quedan con el coalesce de abajo:
        // esos van por delete+recreate completo en el backend, no por
        // `update` parcial. `nivelPermiso` siempre tiene un valor real
        // seleccionado acá (a diferencia del alta), no hace falta el
        // fallback a `undefined`.
        codigoExterno: values.codigoExterno,
        perfilAdministrativo: {
          ...values.perfilAdministrativo,
          apellidoMaterno: values.perfilAdministrativo.apellidoMaterno,
          contactos: values.perfilAdministrativo.contactos.map((contacto) => ({
            ...contacto,
            correo: contacto.correo || undefined,
          })),
          infoMedica: {
            tipoSangre: values.perfilAdministrativo.infoMedica.tipoSangre,
            ...(values.perfilAdministrativo.infoMedica.tieneCondicionMedica
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
              : { tieneCondicionMedica: false }),
          },
        },
      }),
    onSuccess: () => {
      toast.success('Administrativo actualizado.');
      onGuardadoConExito();
      onClose();
    },
    onError: (error) => {
      console.error('[EditarAdministrativoModal] Error al editar administrativo:', error);
      toast.error(
        resolverMensajeError(error, MENSAJES_ERROR_ADMINISTRATIVO) ?? MENSAJE_ERROR_GENERICO,
      );
    },
  });

  function onSubmit(values: AdministrativoEditarFormInput) {
    mutation.mutate(values);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mt-5 space-y-5" noValidate>
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="flex flex-col gap-5">
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

          <InfoMedicaFieldset
            control={control}
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
                Nivel de permiso
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
                    placeholder="Selecciona un nivel de permiso"
                    options={opcionesNivelPermisoDisponibles(nivelPermisoActor).map(
                      (valor) => ({
                        value: valor,
                        label: valor,
                      }),
                    )}
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

      <div className="flex justify-end gap-3">
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
