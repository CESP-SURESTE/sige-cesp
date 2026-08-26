'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { INPUT_CLASS, LABEL_CLASS } from '@/components/admin/ui/persona-alta/estilos';
import {
  MENSAJE_ERROR_GENERICO,
  resolverMensajeError,
} from '@/components/admin/ui/persona-alta/mensajes-error';
import { Select } from '@/components/admin/ui/persona-alta/Select';
import { Paginacion } from '@/components/admin/ui/personas-listado/Paginacion';
import { NuevoGrupoModal } from './NuevoGrupoModal';
import { ApiError } from '@/lib/api/http';
import { listarCarreras } from '@/lib/api/carreras';
import { listarSalones } from '@/lib/api/salones';
import {
  crearGrupo,
  listarGrupos,
  type CrearGrupoInput,
  type GrupoListItem,
} from '@/lib/api/grupos';

/**
 * Gestión de grupos — Fase 9, Día 29 (frontend). Backend cerrado en Día 28
 * (`POST`/`GET /grupos`) + Día 29 (`GET /salones`, gap de backend
 * descubierto al planear esta pantalla) — ver `CLAUDE.md` raíz, sección
 * "Contrato de API", para el shape exacto.
 *
 * Patrón visual/estructura calcado de `app/admin/carreras/page.tsx` (card de
 * form arriba + tabla abajo, mismo `useQuery`/`useMutation` de React Query,
 * mismas clases Tailwind) + paginación numerada reutilizando `Paginacion`
 * (`components/admin/ui/personas-listado/`, ya compartida entre
 * `app/admin/alumnos/page.tsx` y `app/admin/maestros/page.tsx` desde Día 19
 * — ambos dentro del mismo árbol admin, regla 11 de `CLAUDE.md` raíz solo
 * prohíbe cruzar con alumno/maestro DE NEGOCIO, no con otras pantallas de
 * este mismo árbol).
 *
 * `carreraId`/`salonId` salen de `listarCarreras()`/`listarSalones()` —
 * catálogos chicos de la sede, sin paginar (mismo criterio que el resto del
 * árbol admin). `limit` fijo en 10 para el listado de grupos, mismo valor
 * que `usePaginacionFiltrada` (Día 19) usa para alumnos/maestros.
 *
 * ACTUALIZADO (2026-08-25): alta vía botón + modal (`NuevoGrupoModal`, Task 3
 * de la unificación de CRUD admin — regla 13 ampliada de `CLAUDE.md` raíz).
 * El form fijo de "Nuevo grupo" desapareció — un botón "+ Nuevo grupo" abre
 * el modal, `crearMutation.onSuccess` lo cierra. SOLO alta: a diferencia de
 * Carreras/Salones (Tasks 1-2), no existe `PATCH /grupos/:id` (Día 28), así
 * que no hay modo edición. Los filtros y la tabla paginada de abajo no se
 * tocaron.
 */

const LIMIT = 10;

const MENSAJES_ERROR_GRUPO: Record<string, string> = {
  CONFLICT: 'Ya existe un grupo con ese nombre en ese periodo.',
  NOT_FOUND: 'La carrera o el salón seleccionado ya no existe en tu sede.',
};

function formatearPeriodo(anioInicio: number, cicloActual: number): string {
  return `${anioInicio} · Semestre ${cicloActual}`;
}

export default function AdminGruposPage() {
  const queryClient = useQueryClient();
  const [modalAbierto, setModalAbierto] = useState(false);

  // Filtros del listado — todos opcionales, cambiarlos resetea `page` a 1
  // (mismo criterio que `usePaginacionFiltrada`, Día 19: nunca quedar
  // "atrapado" en una página que ya no existe tras filtrar de nuevo).
  const [filtroAnioInicio, setFiltroAnioInicioState] = useState('');
  const [filtroCicloActual, setFiltroCicloActualState] = useState('');
  const [filtroCarreraId, setFiltroCarreraIdState] = useState('');
  const [filtroSalonId, setFiltroSalonIdState] = useState('');
  const [page, setPage] = useState(1);

  function setFiltroAnioInicio(valor: string) {
    setFiltroAnioInicioState(valor);
    setPage(1);
  }
  function setFiltroCicloActual(valor: string) {
    setFiltroCicloActualState(valor);
    setPage(1);
  }
  function setFiltroCarreraId(valor: string) {
    setFiltroCarreraIdState(valor);
    setPage(1);
  }
  function setFiltroSalonId(valor: string) {
    setFiltroSalonIdState(valor);
    setPage(1);
  }

  const carrerasQuery = useQuery({
    queryKey: ['admin', 'carreras'],
    queryFn: async () => {
      try {
        return await listarCarreras();
      } catch (err) {
        // Regla 12 de `CLAUDE.md` raíz.
        console.error('[AdminGruposPage] Error al listar carreras:', err);
        throw err;
      }
    },
  });

  const salonesQuery = useQuery({
    queryKey: ['admin', 'salones'],
    queryFn: async () => {
      try {
        return await listarSalones();
      } catch (err) {
        console.error('[AdminGruposPage] Error al listar salones:', err);
        throw err;
      }
    },
  });

  const anioInicioFiltroNum = filtroAnioInicio.trim()
    ? Number.parseInt(filtroAnioInicio, 10)
    : undefined;
  const cicloActualFiltroNum = filtroCicloActual.trim()
    ? Number.parseInt(filtroCicloActual, 10)
    : undefined;

  const gruposQuery = useQuery({
    queryKey: [
      'admin',
      'grupos',
      anioInicioFiltroNum,
      cicloActualFiltroNum,
      filtroCarreraId,
      filtroSalonId,
      page,
      LIMIT,
    ],
    queryFn: async () => {
      try {
        return await listarGrupos({
          anioInicio: anioInicioFiltroNum,
          cicloActual: cicloActualFiltroNum,
          carreraId: filtroCarreraId || undefined,
          salonId: filtroSalonId || undefined,
          page,
          limit: LIMIT,
        });
      } catch (err) {
        console.error('[AdminGruposPage] Error al listar grupos:', err);
        throw err;
      }
    },
    placeholderData: keepPreviousData,
  });

  const crearMutation = useMutation({
    mutationFn: (input: CrearGrupoInput) => crearGrupo(input),
    onSuccess: () => {
      toast.success('Grupo creado');
      setModalAbierto(false);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'grupos'] });
    },
    onError: (err) => {
      console.error('[AdminGruposPage] Error al crear grupo:', err);
      // `VALIDATION_ERROR` de este endpoint (`GruposService.crear`) trae
      // mensajes precisos por campo (ej. "cicloActual debe estar entre 1 y N
      // para esta carrera") — el genérico de `MENSAJES_ERROR_COMUNES` sería
      // engañoso acá (los campos SÍ están completos/bien formados), mismo
      // criterio de passthrough que ya usa `resolverMensajeError` para
      // `CONFLICT`.
      if (err instanceof ApiError && err.code === 'VALIDATION_ERROR') {
        toast.error(err.message);
        return;
      }
      toast.error(resolverMensajeError(err, MENSAJES_ERROR_GRUPO) ?? MENSAJE_ERROR_GENERICO);
    },
  });

  const opcionesCarreras = (carrerasQuery.data ?? []).map((carrera) => ({
    value: carrera.id,
    label: carrera.nombre,
  }));
  const opcionesSalones = (salonesQuery.data ?? []).map((salon) => ({
    value: salon.id,
    label: salon.nombre,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <div>
          <h1 className="font-display text-2xl font-semibold text-navy">Grupos</h1>
          <p className="mt-1 text-sm text-slate/60">Alta y consulta de los grupos de tu sede.</p>
        </div>
        <button
          onClick={() => setModalAbierto(true)}
          className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
        >
          + Nuevo grupo
        </button>
      </div>

      {modalAbierto && (
        <NuevoGrupoModal
          carrerasQuery={carrerasQuery}
          salonesQuery={salonesQuery}
          guardando={crearMutation.isPending}
          onCrear={(payload) => crearMutation.mutate(payload)}
          onCancelar={() => setModalAbierto(false)}
        />
      )}

      <div className="rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <h2 className="font-display text-lg font-semibold text-slate">Filtros</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="filtroAnioInicio" className={LABEL_CLASS}>
              Año de inicio
            </label>
            <input
              id="filtroAnioInicio"
              type="number"
              min={1}
              step={1}
              className={INPUT_CLASS}
              value={filtroAnioInicio}
              onChange={(e) => setFiltroAnioInicio(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="filtroCicloActual" className={LABEL_CLASS}>
              Ciclo actual (semestre)
            </label>
            <input
              id="filtroCicloActual"
              type="number"
              min={1}
              step={1}
              className={INPUT_CLASS}
              value={filtroCicloActual}
              onChange={(e) => setFiltroCicloActual(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="filtroCarreraId" className={LABEL_CLASS}>
              Carrera
            </label>
            <Select
              id="filtroCarreraId"
              value={filtroCarreraId}
              onChange={setFiltroCarreraId}
              options={[{ value: '', label: 'Todas las carreras' }, ...opcionesCarreras]}
              placeholder="Todas las carreras"
            />
          </div>
          <div>
            <label htmlFor="filtroSalonId" className={LABEL_CLASS}>
              Salón
            </label>
            <Select
              id="filtroSalonId"
              disabled={salonesQuery.isError}
              value={filtroSalonId}
              onChange={setFiltroSalonId}
              options={[{ value: '', label: 'Todos los salones' }, ...opcionesSalones]}
              placeholder="Todos los salones"
            />
            {salonesQuery.isError && (
              <p className="mt-1 text-xs text-crimson">
                {salonesQuery.error instanceof ApiError
                  ? salonesQuery.error.message
                  : 'No se pudo cargar el catálogo de salones. Intenta de nuevo más tarde.'}
              </p>
            )}
            {!salonesQuery.isLoading && !salonesQuery.isError && opcionesSalones.length === 0 && (
              <p className="mt-1 text-xs text-slate/60">
                No hay salones registrados en tu sede.{' '}
                <Link href="/admin/salones" className="text-navy hover:underline">
                  Crea uno aquí
                </Link>
                .
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border-l-4 border-navy bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-mist text-left text-slate/60">
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium">Carrera</th>
                <th className="px-4 py-3 font-medium">Salón</th>
                <th className="px-4 py-3 font-medium">Periodo</th>
                <th className="px-4 py-3 font-medium">Capacidad</th>
              </tr>
            </thead>
            <tbody>
              {gruposQuery.isLoading && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate/60">
                    Cargando…
                  </td>
                </tr>
              )}
              {gruposQuery.isError && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-crimson">
                    {gruposQuery.error instanceof ApiError
                      ? gruposQuery.error.message
                      : 'No se pudo cargar el listado de grupos. Intenta de nuevo más tarde.'}
                  </td>
                </tr>
              )}
              {!gruposQuery.isLoading &&
                !gruposQuery.isError &&
                gruposQuery.data?.data.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate/60">
                      Todavía no hay grupos registrados con esos criterios.
                    </td>
                  </tr>
                )}
              {gruposQuery.data?.data.map((grupo: GrupoListItem) => (
                <tr key={grupo.id} className="border-b border-mist last:border-0">
                  <td className="px-4 py-3 text-slate">{grupo.nombre}</td>
                  <td className="px-4 py-3 text-slate/80">{grupo.carrera.nombre}</td>
                  <td className="px-4 py-3 text-slate/80">{grupo.salon.nombre}</td>
                  <td className="px-4 py-3 text-slate/80">
                    {formatearPeriodo(grupo.anioInicio, grupo.cicloActual)}
                  </td>
                  <td className="px-4 py-3 text-slate/80">{grupo.capacidad}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {gruposQuery.data && gruposQuery.data.total > 0 && (
          <div className="px-4 py-3">
            <Paginacion
              page={gruposQuery.data.page}
              limit={gruposQuery.data.limit}
              total={gruposQuery.data.total}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>
    </div>
  );
}
