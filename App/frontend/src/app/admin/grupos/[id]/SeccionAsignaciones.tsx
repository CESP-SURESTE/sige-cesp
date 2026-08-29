'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  MENSAJE_ERROR_GENERICO,
  resolverMensajeError,
} from '@/components/admin/ui/persona-alta/mensajes-error';
import { ApiError } from '@/lib/api/http';
import {
  asignarMaestro,
  eliminarAsignacion,
  listarAsignaciones,
  type AsignacionListItem,
  type GrupoListItem,
} from '@/lib/api/grupos';
import { crearMateria, listarMaterias } from '@/lib/api/materias';
import { listarMaestros, type PersonaListItemMaestro } from '@/lib/api/personas';
import { AgregarMateriaModal } from './AgregarMateriaModal';
import { ConfirmarQuitarAsignacionModal } from './ConfirmarQuitarAsignacionModal';

/**
 * Sección "Materias y maestros" del detalle de grupo — Fase 12, Día 34.
 * Una fila por materia del grupo (carrera + ciclo del grupo). Cada fila:
 * los maestros ya asignados como chips con "×" (confirmación por modal) + un
 * `<select>` de los maestros aún NO asignados a esa materia + "Agregar".
 * Botón "+ Nueva materia" en el encabezado. Co-docencia permitida (backend
 * Día 33) — varios maestros por materia.
 *
 * Regla 11: todo en `app/admin/grupos/[id]/`, modales locales, sin
 * componentes compartidos con `app/maestro/`/`app/alumno/`.
 * Regla 12: `console.error` en cada catch (queries y mutaciones).
 */
export function SeccionAsignaciones({ grupo }: { grupo: GrupoListItem }) {
  const queryClient = useQueryClient();
  const [asignacionAQuitar, setAsignacionAQuitar] =
    useState<AsignacionListItem | null>(null);
  const [modalMateriaAbierto, setModalMateriaAbierto] = useState(false);
  const [errorNuevaMateria, setErrorNuevaMateria] = useState<string | null>(
    null,
  );
  // materiaId cuyo <select> tiene una selección pendiente de "Agregar".
  const [seleccionPorMateria, setSeleccionPorMateria] = useState<
    Record<string, string>
  >({});

  const materiasQuery = useQuery({
    queryKey: ['admin', 'grupos', 'detalle', grupo.id, 'materias'],
    queryFn: async () => {
      try {
        return await listarMaterias(grupo.carrera.id, grupo.cicloActual);
      } catch (err) {
        console.error('[SeccionAsignaciones] Error al listar materias:', err);
        throw err;
      }
    },
  });

  const asignacionesQuery = useQuery({
    queryKey: ['admin', 'grupos', 'detalle', grupo.id, 'asignaciones'],
    queryFn: async () => {
      try {
        return await listarAsignaciones(grupo.id);
      } catch (err) {
        console.error(
          '[SeccionAsignaciones] Error al listar asignaciones:',
          err,
        );
        throw err;
      }
    },
  });

  const maestrosQuery = useQuery({
    queryKey: ['admin', 'maestros', 'para-asignar'],
    queryFn: async () => {
      try {
        return await listarMaestros({ limit: 100 });
      } catch (err) {
        console.error('[SeccionAsignaciones] Error al listar maestros:', err);
        throw err;
      }
    },
  });

  const maestros: PersonaListItemMaestro[] = maestrosQuery.data?.data ?? [];
  const asignaciones = asignacionesQuery.data ?? [];
  const materias = materiasQuery.data ?? [];

  const invalidarAsignaciones = () =>
    void queryClient.invalidateQueries({
      queryKey: ['admin', 'grupos', 'detalle', grupo.id, 'asignaciones'],
    });

  const asignarMutation = useMutation({
    mutationFn: (input: { materiaId: string; usuarioId: string }) =>
      asignarMaestro(grupo.id, input),
    onSuccess: (_data, input) => {
      toast.success('Maestro asignado');
      setSeleccionPorMateria((prev) => {
        const next = { ...prev };
        delete next[input.materiaId];
        return next;
      });
      invalidarAsignaciones();
    },
    onError: (err) => {
      console.error('[SeccionAsignaciones] Error al asignar maestro:', err);
      if (
        err instanceof ApiError &&
        ['VALIDATION_ERROR', 'CONFLICT', 'NOT_FOUND'].includes(err.code)
      ) {
        toast.error(err.message);
        return;
      }
      toast.error(MENSAJE_ERROR_GENERICO);
    },
  });

  const quitarMutation = useMutation({
    mutationFn: (asignacionId: string) =>
      eliminarAsignacion(grupo.id, asignacionId),
    onSuccess: () => {
      toast.success('Maestro quitado de la materia');
      setAsignacionAQuitar(null);
      invalidarAsignaciones();
    },
    onError: (err) => {
      console.error('[SeccionAsignaciones] Error al quitar asignación:', err);
      toast.error(resolverMensajeError(err) ?? MENSAJE_ERROR_GENERICO);
      setAsignacionAQuitar(null);
    },
  });

  const crearMateriaMutation = useMutation({
    mutationFn: (nombre: string) =>
      crearMateria({
        nombre,
        carreraId: grupo.carrera.id,
        ciclo: grupo.cicloActual,
      }),
    onSuccess: () => {
      toast.success('Materia creada');
      setModalMateriaAbierto(false);
      setErrorNuevaMateria(null);
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'grupos', 'detalle', grupo.id, 'materias'],
      });
    },
    onError: (err) => {
      console.error('[SeccionAsignaciones] Error al crear materia:', err);
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        setErrorNuevaMateria(err.message);
        return;
      }
      setErrorNuevaMateria(
        err instanceof ApiError ? err.message : MENSAJE_ERROR_GENERICO,
      );
    },
  });

  // asignaciones por materiaId, para no recomputar en cada fila.
  const asignacionesPorMateria = useMemo(() => {
    const map = new Map<string, AsignacionListItem[]>();
    for (const a of asignaciones) {
      const arr = map.get(a.materia.id) ?? [];
      arr.push(a);
      map.set(a.materia.id, arr);
    }
    return map;
  }, [asignaciones]);

  const nombreMaestro = (m: {
    apellidoPaterno: string;
    apellidoMaterno: string | null;
    nombres: string;
  }) =>
    [m.apellidoPaterno, m.apellidoMaterno].filter(Boolean).join(' ') +
    `, ${m.nombres}`;

  return (
    <div className="rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-navy">
          Materias y maestros
        </h2>
        <button
          type="button"
          onClick={() => {
            setErrorNuevaMateria(null);
            setModalMateriaAbierto(true);
          }}
          className="rounded-lg border border-navy px-3 py-1.5 text-sm font-medium text-navy hover:bg-navy/5"
        >
          + Nueva materia
        </button>
      </div>

      {(materiasQuery.isLoading ||
        asignacionesQuery.isLoading ||
        maestrosQuery.isLoading) && (
        <p className="mt-4 text-sm text-slate/60">Cargando…</p>
      )}

      {(materiasQuery.isError ||
        asignacionesQuery.isError ||
        maestrosQuery.isError) && (
        <p className="mt-4 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-crimson">
          No se pudo cargar la información de materias y maestros. Intenta de
          nuevo más tarde.
        </p>
      )}

      {!materiasQuery.isLoading &&
        !materiasQuery.isError &&
        materias.length === 0 && (
          <div className="mt-4 rounded-lg border border-mist bg-bone/60 p-4 text-sm text-slate/70">
            Este grupo no tiene materias registradas para el ciclo{' '}
            {grupo.cicloActual} de {grupo.carrera.nombre}. Usa{' '}
            <strong>+ Nueva materia</strong> para crear la primera.
          </div>
        )}

      {!materiasQuery.isLoading &&
        !materiasQuery.isError &&
        !asignacionesQuery.isError &&
        !maestrosQuery.isError &&
        materias.length > 0 && (
          <ul className="mt-4 divide-y divide-mist">
            {materias.map((materia) => {
              const asignadas = asignacionesPorMateria.get(materia.id) ?? [];
              const idsAsignados = new Set(
                asignadas.map((a) => a.maestro.usuarioId),
              );
              const disponibles = maestros.filter(
                (m) => !idsAsignados.has(m.usuarioId),
              );
              const seleccion = seleccionPorMateria[materia.id] ?? '';
              const filaOcupada =
                asignarMutation.isPending &&
                asignarMutation.variables?.materiaId === materia.id;

              return (
                <li key={materia.id} className="py-4">
                  <p className="text-sm font-medium text-slate">
                    {materia.nombre}
                  </p>
                  <p className="text-xs text-slate/50">Ciclo {materia.ciclo}</p>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {asignadas.length === 0 ? (
                      <span className="text-xs text-slate/50">
                        Sin maestro asignado.
                      </span>
                    ) : (
                      asignadas.map((a) => (
                        <span
                          key={a.id}
                          className="inline-flex items-center gap-1.5 rounded-full bg-mist px-2.5 py-1 text-xs text-navy"
                        >
                          {nombreMaestro(a.maestro)}
                          <button
                            type="button"
                            aria-label={`Quitar a ${nombreMaestro(a.maestro)}`}
                            onClick={() => setAsignacionAQuitar(a)}
                            className="text-crimson hover:text-crimson/70"
                          >
                            ×
                          </button>
                        </span>
                      ))
                    )}
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    {disponibles.length === 0 ? (
                      <span className="text-xs text-slate/50">
                        Todos los maestros ya están asignados a esta materia.
                      </span>
                    ) : (
                      <>
                        <select
                          value={seleccion}
                          disabled={filaOcupada || maestrosQuery.isError}
                          onChange={(e) =>
                            setSeleccionPorMateria((prev) => ({
                              ...prev,
                              [materia.id]: e.target.value,
                            }))
                          }
                          className="rounded-lg border border-mist px-2 py-1 text-sm text-slate disabled:opacity-50"
                        >
                          <option value="">Agregar maestro…</option>
                          {disponibles.map((m) => (
                            <option key={m.usuarioId} value={m.usuarioId}>
                              {nombreMaestro(m)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={!seleccion || filaOcupada}
                          onClick={() =>
                            asignarMutation.mutate({
                              materiaId: materia.id,
                              usuarioId: seleccion,
                            })
                          }
                          className="rounded-lg bg-navy px-3 py-1 text-sm font-medium text-white hover:bg-navy-deep disabled:opacity-50"
                        >
                          {filaOcupada ? 'Agregando…' : 'Agregar'}
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

      {modalMateriaAbierto && (
        <AgregarMateriaModal
          carreraNombre={grupo.carrera.nombre}
          ciclo={grupo.cicloActual}
          guardando={crearMateriaMutation.isPending}
          errorMensaje={errorNuevaMateria}
          onCrear={(nombre) => crearMateriaMutation.mutate(nombre)}
          onCancelar={() => {
            setModalMateriaAbierto(false);
            setErrorNuevaMateria(null);
          }}
        />
      )}

      {asignacionAQuitar && (
        <ConfirmarQuitarAsignacionModal
          asignacion={asignacionAQuitar}
          quitando={quitarMutation.isPending}
          onConfirmar={() => quitarMutation.mutate(asignacionAQuitar.id)}
          onCancelar={() => setAsignacionAQuitar(null)}
        />
      )}
    </div>
  );
}
