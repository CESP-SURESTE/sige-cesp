'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  MENSAJE_ERROR_GENERICO,
  resolverMensajeError,
} from '@/components/admin/ui/persona-alta/mensajes-error';
import { ApiError } from '@/lib/api/http';
import {
  desmatricularAlumno,
  listarAlumnosDeGrupo,
  obtenerGrupo,
  type GrupoAlumnoListItem,
} from '@/lib/api/grupos';
import type { EstatusAcademico } from '@/lib/api/personas';
import { ConfirmarQuitarAlumnoModal } from './ConfirmarQuitarAlumnoModal';

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

      {/* PLACEHOLDER Task 3: aquí se monta el autocomplete de "Agregar alumno".
          Recibe: grupo (para carreraId + capacidad), alumnos (para el filtro de
          no-ya-matriculado), lleno (para deshabilitar), y una mutation de
          matricular que invalida ['admin','grupos','detalle',id] y
          ['admin','grupos','detalle',id,'alumnos']. */}

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
