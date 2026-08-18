'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
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
import {
  contactosAlumnoSchema,
  infoMedicaSchema,
} from '@/components/admin/ui/persona-alta/schemas';
import { listarCarreras } from '@/lib/api/carreras';
import { crearAlumno, type AltaPersonaResult } from '@/lib/api/personas';

/**
 * Formulario de alta de alumno — Fase 4, Día 14; refactorizado en Día 15
 * para usar el componente de formulario base
 * (`components/admin/ui/persona-alta/`, ver ese directorio) reutilizado
 * también por `app/admin/maestros/nuevo/` y
 * `app/admin/administrativos/nuevo/` — mismo contrato con `POST /personas`,
 * mismos mensajes de error, mismo manejo de `temporaryPassword` en pantalla
 * que la versión de Día 14 (sin cambios de comportamiento, solo extracción
 * de componentes compartidos).
 *
 * Único cambio visual respecto a Día 14: `correoPersonal` y `telefono` se
 * renderizan ahora en el fieldset "Datos personales" (antes "Datos
 * académicos") porque son campos comunes a los 3 sub-perfiles y viven en
 * `DatosPersonalesFieldset` — no afecta el body enviado a `POST /personas`
 * (mismo shape, mismos nombres de campo).
 *
 * Schema de validación en cliente (`alumnoSchema`) es espejo de
 * `CrearPersonaDto` + `PerfilAlumnoDto`
 * (`App/backend/src/personas/dto/crear-persona.dto.ts`) — solo UX, la
 * validación real de negocio sigue viviendo en el backend.
 *
 * Día 13 (emails de bienvenida) está BLOQUEADO (pendiente de que el cliente
 * resuelva dominio/servicio de correo) — no se envía ningún correo
 * automático, así que tras el alta exitosa se muestra la `temporaryPassword`
 * en pantalla para que el admin la comunique manualmente.
 *
 * Dropdown de `carreraId`: alimentado por `GET /carreras`
 * (`lib/api/carreras.ts`, Día 14) — si devuelve error, el formulario sigue
 * siendo usable (solo el `<select>` queda sin opciones y se muestra un
 * aviso), no rompe el resto.
 *
 * `contactos`/`infoMedica` (extensión 2026-08-12, misma transacción que el
 * alta, decisión del usuario) — `ContactosFieldset` (con `mostrarTipo`,
 * exclusivo de alumno) e `InfoMedicaFieldset`, ver esos componentes en
 * `components/admin/ui/persona-alta/`. Los campos opcionales de
 * `infoMedica` (`padecimiento`/`medicamentos`/`alergias`/
 * `tratamientoAdicional`) solo se muestran (y se envían) si
 * `tieneCondicionMedica` está marcado — criterio de UX documentado en
 * `InfoMedicaFieldset`.
 *
 * `email` (raíz) y `perfilAlumno.matricula` (2026-08-18) YA NO se capturan
 * en este formulario — el backend los genera y rechaza `POST /personas` con
 * `400 VALIDATION_ERROR` si se mandan. Ambos se muestran después del alta,
 * generados, en `ResultadoAltaPersona` (`resultado.usuario.email` /
 * `resultado.matricula`).
 */

const alumnoSchema = z.object({
  codigoExterno: z.string().optional(),
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
    semestreActual: z.coerce
      .number()
      .int('El semestre debe ser un número entero')
      .min(1, 'El semestre debe ser al menos 1'),
    telefono: z.string().optional(),
    contactos: contactosAlumnoSchema,
    infoMedica: infoMedicaSchema,
  }),
});

/**
 * `z.coerce.number()` (campo `semestreActual`) hace que el tipo de ENTRADA
 * del schema (antes de que el resolver transforme/coerza) difiera del tipo
 * de SALIDA (`number`, después del coerce) — friction conocida de
 * zod v4 + `@hookform/resolvers`. `useForm` necesita el tipo de entrada
 * (`AlumnoFormInput`, lo que RHF guarda mientras el usuario escribe) como su
 * genérico principal, y el tipo de salida (`AlumnoFormOutput`) como tercer
 * genérico (`TTransformedValues`) — así `handleSubmit(onSubmit)` recibe ya
 * `semestreActual: number`, no el valor crudo del input.
 */
type AlumnoFormInput = z.input<typeof alumnoSchema>;
type AlumnoFormOutput = z.output<typeof alumnoSchema>;

const DEFAULT_VALUES: AlumnoFormInput = {
  codigoExterno: '',
  perfilAlumno: {
    nombres: '',
    apellidoPaterno: '',
    apellidoMaterno: '',
    curp: '',
    fechaNacimiento: '',
    correoPersonal: '',
    carreraId: '',
    periodoIngreso: '',
    semestreActual: 1,
    telefono: '',
    contactos: [
      {
        nombre: '',
        telefono: '',
        correo: '',
        parentesco: '',
        // Cast necesario porque `tipo` es requerido (sin `.optional()` en el
        // schema) — mismo patrón que `puesto` en la página de administrativo
        // para un `<select>` que arranca sin selección.
        tipo: '' as AlumnoFormInput['perfilAlumno']['contactos'][number]['tipo'],
      },
    ],
    infoMedica: {
      tieneCondicionMedica: false,
      padecimiento: '',
      medicamentos: '',
      alergias: '',
      tratamientoAdicional: '',
    },
  },
};

const MENSAJES_ERROR_ALUMNO: Record<string, string> = {
  NOT_FOUND: 'La carrera seleccionada no existe o no pertenece a tu sede.',
};

export default function NuevoAlumnoPage() {
  const [resultado, setResultado] = useState<AltaPersonaResult | null>(null);

  const carrerasQuery = useQuery({
    queryKey: ['carreras'],
    queryFn: listarCarreras,
  });

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<AlumnoFormInput, unknown, AlumnoFormOutput>({
    resolver: zodResolver(alumnoSchema),
    defaultValues: DEFAULT_VALUES,
  });

  const tieneCondicionMedica = useWatch({
    control,
    name: 'perfilAlumno.infoMedica.tieneCondicionMedica',
  });

  const mutation = useMutation({
    mutationFn: (values: AlumnoFormOutput) =>
      crearAlumno({
        codigoExterno: values.codigoExterno || undefined,
        perfilAlumno: {
          ...values.perfilAlumno,
          apellidoMaterno: values.perfilAlumno.apellidoMaterno || undefined,
          curp: values.perfilAlumno.curp || undefined,
          telefono: values.perfilAlumno.telefono || undefined,
          contactos: values.perfilAlumno.contactos.map((contacto) => ({
            ...contacto,
            correo: contacto.correo || undefined,
          })),
          infoMedica: values.perfilAlumno.infoMedica.tieneCondicionMedica
            ? {
                tieneCondicionMedica: true,
                padecimiento: values.perfilAlumno.infoMedica.padecimiento || undefined,
                medicamentos: values.perfilAlumno.infoMedica.medicamentos || undefined,
                alergias: values.perfilAlumno.infoMedica.alergias || undefined,
                tratamientoAdicional:
                  values.perfilAlumno.infoMedica.tratamientoAdicional || undefined,
              }
            : { tieneCondicionMedica: false },
        },
      }),
    onSuccess: (data) => {
      setResultado(data);
      reset(DEFAULT_VALUES);
    },
    onError: (error) => {
      toast.error(resolverMensajeError(error, MENSAJES_ERROR_ALUMNO) ?? MENSAJE_ERROR_GENERICO);
    },
  });

  function onSubmit(values: AlumnoFormOutput) {
    mutation.mutate(values);
  }

  if (resultado) {
    return (
      <ResultadoAltaPersona
        resultado={resultado}
        titulo="Alumno dado de alta"
        botonOtroLabel="Dar de alta otro alumno"
        onReset={() => setResultado(null)}
      />
    );
  }

  return (
    <AltaPersonaFormShell
      titulo="Alta de alumno"
      descripcion="Crea la cuenta y el perfil del alumno. La contraseña temporal se muestra al terminar — la entrega del correo de bienvenida no está garantizada (dominio en modo de prueba), comunícala tú mismo como respaldo."
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
            prefix="perfilAlumno"
            tieneCondicionMedica={Boolean(tieneCondicionMedica)}
          />
        </div>

        <DatosPersonalesFieldset
          register={register}
          errors={errors}
          disabled={mutation.isPending}
          prefix="perfilAlumno"
        />

        <fieldset className="space-y-3 rounded-lg border border-mist bg-bone/50 p-4">
          <legend className="text-sm font-semibold text-slate">Datos académicos</legend>
          <div className="grid gap-4 sm:grid-cols-2">
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
              <select
                id="carreraId"
                disabled={mutation.isPending || carrerasQuery.isLoading}
                className={INPUT_CLASS}
                {...register('perfilAlumno.carreraId')}
              >
                <option value="">
                  {carrerasQuery.isLoading ? 'Cargando carreras…' : 'Selecciona una carrera'}
                </option>
                {carrerasQuery.data?.map((carrera) => (
                  <option key={carrera.id} value={carrera.id}>
                    {carrera.clave} — {carrera.nombre}
                  </option>
                ))}
              </select>
              {carrerasQuery.isError && (
                <p className="mt-1 text-xs text-crimson">
                  No se pudieron cargar las carreras. Intenta de nuevo más tarde.
                </p>
              )}
              <FieldError message={errors.perfilAlumno?.carreraId?.message} />
            </div>
            <div>
              <label htmlFor="periodoIngreso" className={LABEL_CLASS}>
                Periodo de ingreso
              </label>
              <input
                id="periodoIngreso"
                type="text"
                placeholder="ej. 2026-2"
                disabled={mutation.isPending}
                className={INPUT_CLASS}
                {...register('perfilAlumno.periodoIngreso')}
              />
              <FieldError message={errors.perfilAlumno?.periodoIngreso?.message} />
            </div>
            <div>
              <label htmlFor="semestreActual" className={LABEL_CLASS}>
                Semestre actual
              </label>
              <input
                id="semestreActual"
                type="number"
                min={1}
                step={1}
                disabled={mutation.isPending}
                className={INPUT_CLASS}
                {...register('perfilAlumno.semestreActual')}
              />
              <FieldError message={errors.perfilAlumno?.semestreActual?.message} />
            </div>
          </div>
        </fieldset>
      </div>

      <ContactosFieldset
        control={control}
        register={register}
        errors={errors}
        disabled={mutation.isPending}
        prefix="perfilAlumno"
        mostrarTipo
      />
    </AltaPersonaFormShell>
  );
}
