'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { listarCarreras } from '@/lib/api/carreras';
import { ApiError } from '@/lib/api/http';
import { crearAlumno, type AltaPersonaResult } from '@/lib/api/personas';

/**
 * Formulario de alta de alumno — Fase 4, Día 14.
 *
 * Único consumidor real de `POST /personas` (Día 11) desde la UI — hasta
 * ahora solo se había probado por script/Postman (ver `documentacion_de_agentes/ESTADO.md`,
 * cierre de Día 11). `rol` va fijo a `'ALUMNO'` (no se expone como campo
 * editable, ver `lib/api/personas.ts`).
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
 * (`lib/api/carreras.ts`), construido en paralelo por otro agente para este
 * mismo día — si devuelve error, el formulario sigue siendo usable (solo el
 * `<select>` queda sin opciones y se muestra un aviso), no rompe el resto.
 */

const alumnoSchema = z.object({
  email: z
    .string()
    .min(1, 'El correo es requerido')
    .email('Formato de correo inválido'),
  codigoExterno: z.string().optional(),
  perfilAlumno: z.object({
    nombres: z.string().min(1, 'Los nombres son requeridos'),
    apellidoPaterno: z.string().min(1, 'El apellido paterno es requerido'),
    apellidoMaterno: z.string().optional(),
    curp: z.string().optional(),
    fechaNacimiento: z.string().min(1, 'La fecha de nacimiento es requerida'),
    matricula: z.string().min(1, 'La matrícula es requerida'),
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
  email: '',
  codigoExterno: '',
  perfilAlumno: {
    nombres: '',
    apellidoPaterno: '',
    apellidoMaterno: '',
    curp: '',
    fechaNacimiento: '',
    matricula: '',
    correoPersonal: '',
    carreraId: '',
    periodoIngreso: '',
    semestreActual: 1,
    telefono: '',
  },
};

const MENSAJES_ERROR: Record<string, string> = {
  CONFLICT: 'El correo, la matrícula o el código externo ya están en uso.',
  NOT_FOUND: 'La carrera seleccionada no existe o no pertenece a tu sede.',
  VALIDATION_ERROR:
    'Revisa que todos los campos requeridos estén completos y con el formato correcto.',
  ROL_NO_AUTORIZADO: 'No tienes permisos para dar de alta personas.',
};

const INPUT_CLASS =
  'mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none disabled:opacity-50';
const LABEL_CLASS = 'block text-sm font-medium text-gray-700';

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-red-600">{message}</p>;
}

export default function NuevoAlumnoPage() {
  const [resultado, setResultado] = useState<AltaPersonaResult | null>(null);
  const [copiado, setCopiado] = useState(false);

  const carrerasQuery = useQuery({
    queryKey: ['carreras'],
    queryFn: listarCarreras,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AlumnoFormInput, unknown, AlumnoFormOutput>({
    resolver: zodResolver(alumnoSchema),
    defaultValues: DEFAULT_VALUES,
  });

  const mutation = useMutation({
    mutationFn: (values: AlumnoFormOutput) =>
      crearAlumno({
        email: values.email,
        codigoExterno: values.codigoExterno || undefined,
        perfilAlumno: {
          ...values.perfilAlumno,
          apellidoMaterno: values.perfilAlumno.apellidoMaterno || undefined,
          curp: values.perfilAlumno.curp || undefined,
          telefono: values.perfilAlumno.telefono || undefined,
        },
      }),
    onSuccess: (data) => {
      setResultado(data);
      setCopiado(false);
      reset(DEFAULT_VALUES);
    },
  });

  function onSubmit(values: AlumnoFormOutput) {
    mutation.mutate(values);
  }

  const mensajeError = mutation.error
    ? mutation.error instanceof ApiError
      ? (MENSAJES_ERROR[mutation.error.code] ??
        'Ocurrió un error inesperado. Intenta de nuevo.')
      : mutation.error.message
    : null;

  async function copiarPassword() {
    if (!resultado) return;
    try {
      await navigator.clipboard.writeText(resultado.temporaryPassword);
      setCopiado(true);
    } catch (err) {
      console.error('No se pudo copiar la contraseña temporal al portapapeles', err);
    }
  }

  if (resultado) {
    return (
      <div className="max-w-lg">
        <h1 className="text-xl font-semibold">Alumno dado de alta</h1>
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 p-4">
          <p className="text-sm text-green-800">
            La cuenta se creó correctamente. Comunica estos datos al alumno de forma
            manual — el envío automático de correo (Día 13) sigue bloqueado.
          </p>
          <dl className="mt-3 space-y-3 text-sm">
            <div>
              <dt className="font-medium text-gray-700">Correo</dt>
              <dd className="text-gray-900">{resultado.usuario.email}</dd>
            </div>
            <div>
              <dt className="font-medium text-gray-700">Contraseña temporal</dt>
              <dd className="mt-1 flex items-center gap-2">
                <code className="rounded border border-gray-200 bg-white px-2 py-1 text-gray-900">
                  {resultado.temporaryPassword}
                </code>
                <button
                  type="button"
                  onClick={copiarPassword}
                  className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                >
                  {copiado ? 'Copiado' : 'Copiar'}
                </button>
              </dd>
            </div>
          </dl>
        </div>
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={() => setResultado(null)}
            className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Dar de alta otro alumno
          </button>
          <Link
            href="/admin"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Volver al panel
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold">Alta de alumno</h1>
      <p className="mt-1 text-sm text-gray-500">
        Crea la cuenta y el perfil del alumno. La contraseña temporal se muestra al
        terminar — Día 13 (correo de bienvenida) sigue bloqueado, comunícala tú mismo.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-8" noValidate>
        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold text-gray-900">Cuenta</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="email" className={LABEL_CLASS}>
                Correo (cuenta de acceso)
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                disabled={mutation.isPending}
                className={INPUT_CLASS}
                {...register('email')}
              />
              <FieldError message={errors.email?.message} />
            </div>
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
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold text-gray-900">Datos personales</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="nombres" className={LABEL_CLASS}>
                Nombres
              </label>
              <input
                id="nombres"
                type="text"
                disabled={mutation.isPending}
                className={INPUT_CLASS}
                {...register('perfilAlumno.nombres')}
              />
              <FieldError message={errors.perfilAlumno?.nombres?.message} />
            </div>
            <div>
              <label htmlFor="apellidoPaterno" className={LABEL_CLASS}>
                Apellido paterno
              </label>
              <input
                id="apellidoPaterno"
                type="text"
                disabled={mutation.isPending}
                className={INPUT_CLASS}
                {...register('perfilAlumno.apellidoPaterno')}
              />
              <FieldError message={errors.perfilAlumno?.apellidoPaterno?.message} />
            </div>
            <div>
              <label htmlFor="apellidoMaterno" className={LABEL_CLASS}>
                Apellido materno (opcional)
              </label>
              <input
                id="apellidoMaterno"
                type="text"
                disabled={mutation.isPending}
                className={INPUT_CLASS}
                {...register('perfilAlumno.apellidoMaterno')}
              />
              <FieldError message={errors.perfilAlumno?.apellidoMaterno?.message} />
            </div>
            <div>
              <label htmlFor="curp" className={LABEL_CLASS}>
                CURP (opcional)
              </label>
              <input
                id="curp"
                type="text"
                disabled={mutation.isPending}
                className={INPUT_CLASS}
                {...register('perfilAlumno.curp')}
              />
              <FieldError message={errors.perfilAlumno?.curp?.message} />
            </div>
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
              <label htmlFor="telefono" className={LABEL_CLASS}>
                Teléfono (opcional)
              </label>
              <input
                id="telefono"
                type="tel"
                disabled={mutation.isPending}
                className={INPUT_CLASS}
                {...register('perfilAlumno.telefono')}
              />
              <FieldError message={errors.perfilAlumno?.telefono?.message} />
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold text-gray-900">Datos académicos</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="matricula" className={LABEL_CLASS}>
                Matrícula
              </label>
              <input
                id="matricula"
                type="text"
                disabled={mutation.isPending}
                className={INPUT_CLASS}
                {...register('perfilAlumno.matricula')}
              />
              <FieldError message={errors.perfilAlumno?.matricula?.message} />
            </div>
            <div>
              <label htmlFor="correoPersonal" className={LABEL_CLASS}>
                Correo personal
              </label>
              <input
                id="correoPersonal"
                type="email"
                disabled={mutation.isPending}
                className={INPUT_CLASS}
                {...register('perfilAlumno.correoPersonal')}
              />
              <FieldError message={errors.perfilAlumno?.correoPersonal?.message} />
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
                <p className="mt-1 text-xs text-amber-600">
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

        {mensajeError && (
          <p role="alert" className="text-sm text-red-600">
            {mensajeError}
          </p>
        )}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {mutation.isPending ? 'Guardando…' : 'Dar de alta'}
        </button>
      </form>
    </div>
  );
}
