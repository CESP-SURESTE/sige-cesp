'use client';

import {
  Combobox,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
} from '@headlessui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useBuscarDebounced } from '@/components/admin/ui/personas-listado/useBuscarDebounced';
import {
  MENSAJE_ERROR_GENERICO,
  resolverMensajeError,
} from '@/components/admin/ui/persona-alta/mensajes-error';
import {
  INPUT_CLASS,
  LABEL_CLASS,
} from '@/components/admin/ui/persona-alta/estilos';
import { ApiError } from '@/lib/api/http';
import {
  desmatricularAlumno,
  listarAlumnosDeGrupo,
  matricularAlumno,
  obtenerGrupo,
  type GrupoAlumnoListItem,
} from '@/lib/api/grupos';
import {
  listarAlumnos,
  type EstatusAcademico,
  type PersonaListItemAlumno,
} from '@/lib/api/personas';
import { ConfirmarMatricularAlumnoModal } from './ConfirmarMatricularAlumnoModal';
import { ConfirmarQuitarAlumnoModal } from './ConfirmarQuitarAlumnoModal';
import { SeccionAsignaciones } from './SeccionAsignaciones';

/**
 * Detalle de un grupo — Fase 10, Día 31. Primera ruta dinámica del proyecto
 * (`app/admin/grupos/[id]/`). `id` sale de `useParams()` de `next/navigation`
 * (hook client-safe, la vía correcta en Next 16 para leer params de ruta
 * dinámica desde un Client Component — ver `node_modules/next/dist/docs/
 * 01-app/03-api-reference/04-functions/use-params.md`).
 *
 * Patrón visual calcado de `app/admin/grupos/page.tsx` (cards
 * `rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm`, `useQuery`/
 * `useMutation`, `toast`, `console.error` en cada catch — regla 12).
 */

const ESTATUS_ACADEMICO_LABEL: Record<EstatusAcademico, string> = {
  INSCRITO: 'Inscrito',
  BAJA_TEMPORAL: 'Baja temporal',
  BAJA_DEFINITIVA: 'Baja definitiva',
  EGRESADO: 'Egresado',
};

function nombreAlumno(a: GrupoAlumnoListItem): string {
  return (
    [a.apellidoPaterno, a.apellidoMaterno].filter(Boolean).join(' ') +
    `, ${a.nombres}`
  );
}

export default function AdminGrupoDetallePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();
  const [alumnoAQuitar, setAlumnoAQuitar] = useState<GrupoAlumnoListItem | null>(
    null,
  );
  const [alumnoAConfirmar, setAlumnoAConfirmar] =
    useState<PersonaListItemAlumno | null>(null);

  const grupoQuery = useQuery({
    queryKey: ['admin', 'grupos', 'detalle', id],
    queryFn: async () => {
      try {
        return await obtenerGrupo(id);
      } catch (err) {
        console.error('[AdminGrupoDetallePage] Error al obtener el grupo:', err);
        throw err;
      }
    },
  });

  const alumnosQuery = useQuery({
    queryKey: ['admin', 'grupos', 'detalle', id, 'alumnos'],
    queryFn: async () => {
      try {
        return await listarAlumnosDeGrupo(id);
      } catch (err) {
        console.error(
          '[AdminGrupoDetallePage] Error al listar alumnos del grupo:',
          err,
        );
        throw err;
      }
    },
  });

  const desmatricularMutation = useMutation({
    mutationFn: (usuarioId: string) => desmatricularAlumno(id, usuarioId),
    onSuccess: () => {
      toast.success('Alumno quitado del grupo');
      setAlumnoAQuitar(null);
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'grupos', 'detalle', id],
      });
    },
    onError: (err) => {
      console.error('[AdminGrupoDetallePage] Error al quitar alumno:', err);
      toast.error(resolverMensajeError(err) ?? MENSAJE_ERROR_GENERICO);
      setAlumnoAQuitar(null);
    },
  });

  const grupo = grupoQuery.data;
  const alumnos = alumnosQuery.data ?? [];
  const inscritos = alumnos.length;
  const lleno = grupo ? inscritos >= grupo.capacidad : false;

  const { inputValue, setInputValue, buscar } = useBuscarDebounced();

  const buscarQuery = useQuery({
    queryKey: ['admin', 'personas', 'ALUMNO', 'buscar-grupo', buscar],
    queryFn: async () => {
      try {
        return await listarAlumnos({ buscar, limit: 20 });
      } catch (err) {
        console.error('[AdminGrupoDetallePage] Error al buscar alumnos:', err);
        throw err;
      }
    },
    enabled: buscar.length >= 2,
  });

  const idsMatriculados = useMemo(
    () => new Set(alumnos.map((a) => a.usuarioId)),
    [alumnos],
  );

  const candidatos = useMemo(() => {
    if (!grupo) return [] as PersonaListItemAlumno[];
    return (buscarQuery.data?.data ?? []).filter(
      (p) =>
        p.carrera.id === grupo.carrera.id && !idsMatriculados.has(p.usuarioId),
    );
  }, [buscarQuery.data, grupo, idsMatriculados]);

  const matricularMutation = useMutation({
    mutationFn: (usuarioId: string) => matricularAlumno(id, usuarioId),
    onSuccess: () => {
      toast.success('Alumno matriculado');
      setInputValue('');
      setAlumnoAConfirmar(null);
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'grupos', 'detalle', id],
      });
    },
    onError: (err) => {
      console.error('[AdminGrupoDetallePage] Error al matricular alumno:', err);
      if (
        err instanceof ApiError &&
        [
          'VALIDATION_ERROR',
          'CAPACIDAD_EXCEDIDA',
          'CONFLICT',
          'NOT_FOUND',
        ].includes(err.code)
      ) {
        toast.error(err.message);
        return;
      }
      toast.error(MENSAJE_ERROR_GENERICO);
    },
  });

  if (grupoQuery.isError) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border-l-4 border-crimson bg-white p-6 shadow-sm">
          <p className="text-sm text-crimson">
            {grupoQuery.error instanceof ApiError &&
            grupoQuery.error.status === 404
              ? 'Grupo no encontrado en tu sede.'
              : 'No se pudo cargar el grupo. Intenta de nuevo más tarde.'}
          </p>
          <Link
            href="/admin/grupos"
            className="mt-3 inline-block text-sm text-navy hover:underline"
          >
            ← Volver a grupos
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <Link
          href="/admin/grupos"
          className="text-sm text-navy hover:underline"
        >
          ← Volver a grupos
        </Link>
        {grupoQuery.isLoading || !grupo ? (
          <p className="mt-2 text-sm text-slate/60">Cargando…</p>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <h1 className="font-display text-2xl font-semibold text-navy">
                {grupo.nombre}
              </h1>
              <span
                className={`rounded-full px-3 py-1 text-sm font-medium ${
                  lleno
                    ? 'border border-warning-border bg-warning-bg text-warning'
                    : 'border border-mist bg-bone text-slate'
                }`}
              >
                {inscritos} / {grupo.capacidad}
                {lleno ? ' · Lleno' : ''}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate/60">
              {grupo.carrera.nombre} · {grupo.salon.nombre} · {grupo.anioInicio}{' '}
              · Semestre {grupo.cicloActual}
            </p>
          </>
        )}
      </div>

      {/* Agregar alumno — autocomplete (Fase 10, Día 31) */}
      <div className="rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <label htmlFor="buscar-alumno" className={LABEL_CLASS}>
          Agregar alumno
        </label>
        {lleno ? (
          <p className="mt-2 rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning">
            Grupo lleno ({grupo?.capacidad} / {grupo?.capacidad}) — quita un
            alumno para agregar otro.
          </p>
        ) : (
          <Combobox
            immediate
            onChange={(usuarioId: string | null) => {
              if (!usuarioId) return;
              setAlumnoAConfirmar(
                candidatos.find((p) => p.usuarioId === usuarioId) ?? null,
              );
            }}
            disabled={matricularMutation.isPending}
          >
            <div className="relative mt-1">
              <ComboboxInput
                id="buscar-alumno"
                className={INPUT_CLASS}
                placeholder="Busca por nombre o matrícula…"
                autoComplete="off"
                value={inputValue}
                displayValue={() => inputValue}
                onChange={(e) => setInputValue(e.target.value)}
              />
              <ComboboxOptions className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-mist bg-white py-1 text-sm shadow-lg focus:outline-none">
                {buscar.length < 2 ? (
                  <p className="px-3 py-2 text-xs text-slate/60">
                    Escribe al menos 2 caracteres para buscar.
                  </p>
                ) : buscarQuery.isLoading ? (
                  <p className="px-3 py-2 text-xs text-slate/60">Buscando…</p>
                ) : buscarQuery.isError ? (
                  <p className="px-3 py-2 text-xs text-crimson">
                    No se pudo buscar. Intenta de nuevo.
                  </p>
                ) : candidatos.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-slate/60">
                    Sin alumnos de esta carrera para agregar.
                  </p>
                ) : (
                  candidatos.map((p) => (
                    <ComboboxOption
                      key={p.usuarioId}
                      value={p.usuarioId}
                      className={({ focus }) =>
                        `cursor-pointer px-3 py-2 text-slate ${
                          focus ? 'bg-mist/40' : ''
                        }`
                      }
                    >
                      {[p.apellidoPaterno, p.apellidoMaterno]
                        .filter(Boolean)
                        .join(' ')}
                      , {p.nombres} — {p.matricula}
                    </ComboboxOption>
                  ))
                )}
              </ComboboxOptions>
            </div>
          </Combobox>
        )}
        <p className="mt-2 text-xs text-slate/50">
          Solo aparecen alumnos de la carrera del grupo que aún no están
          matriculados.
        </p>
      </div>

      {/* Tabla de matriculados */}
      <div className="rounded-lg border-l-4 border-navy bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-mist text-left text-slate/60">
                <th className="px-4 py-3 font-medium">Alumno</th>
                <th className="px-4 py-3 font-medium">Matrícula</th>
                <th className="px-4 py-3 font-medium">Semestre</th>
                <th className="px-4 py-3 font-medium">Estatus</th>
                <th className="px-4 py-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {alumnosQuery.isLoading && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-6 text-center text-slate/60"
                  >
                    Cargando…
                  </td>
                </tr>
              )}
              {alumnosQuery.isError && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-6 text-center text-crimson"
                  >
                    No se pudo cargar la lista de alumnos. Intenta de nuevo más
                    tarde.
                  </td>
                </tr>
              )}
              {!alumnosQuery.isLoading &&
                !alumnosQuery.isError &&
                alumnos.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-6 text-center text-slate/60"
                    >
                      Este grupo todavía no tiene alumnos matriculados.
                    </td>
                  </tr>
                )}
              {alumnos.map((a) => (
                <tr
                  key={a.usuarioId}
                  className="border-b border-mist last:border-0"
                >
                  <td className="px-4 py-3 text-slate">{nombreAlumno(a)}</td>
                  <td className="px-4 py-3 text-slate/80">{a.matricula}</td>
                  <td className="px-4 py-3 text-slate/80">
                    {a.semestreActual}
                  </td>
                  <td className="px-4 py-3 text-slate/80">
                    {ESTATUS_ACADEMICO_LABEL[a.estatusAcademico]}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setAlumnoAQuitar(a)}
                      className="text-crimson hover:underline"
                    >
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {grupo && <SeccionAsignaciones grupo={grupo} />}

      {alumnoAConfirmar && grupo && (
        <ConfirmarMatricularAlumnoModal
          alumno={alumnoAConfirmar}
          grupoNombre={grupo.nombre}
          matriculando={matricularMutation.isPending}
          onConfirmar={() =>
            matricularMutation.mutate(alumnoAConfirmar.usuarioId)
          }
          onCancelar={() => setAlumnoAConfirmar(null)}
        />
      )}

      {alumnoAQuitar && grupo && (
        <ConfirmarQuitarAlumnoModal
          alumno={alumnoAQuitar}
          grupoNombre={grupo.nombre}
          quitando={desmatricularMutation.isPending}
          onConfirmar={() =>
            desmatricularMutation.mutate(alumnoAQuitar.usuarioId)
          }
          onCancelar={() => setAlumnoAQuitar(null)}
        />
      )}
    </div>
  );
}
