'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { INPUT_CLASS, LABEL_CLASS } from '@/components/admin/ui/persona-alta/estilos';
import {
  MENSAJE_ERROR_GENERICO,
  resolverMensajeError,
} from '@/components/admin/ui/persona-alta/mensajes-error';
import { Select } from '@/components/admin/ui/persona-alta/Select';
import { Paginacion } from '@/components/admin/ui/personas-listado/Paginacion';
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
 */

const LIMIT = 10;

interface FormNuevo {
  nombre: string;
  carreraId: string;
  salonId: string;
  anioInicio: string;
  cicloActual: string;
  capacidad: string;
}

const FORM_NUEVO_VACIO: FormNuevo = {
  nombre: '',
  carreraId: '',
  salonId: '',
  anioInicio: '',
  cicloActual: '',
  capacidad: '',
};

const MENSAJES_ERROR_GRUPO: Record<string, string> = {
  CONFLICT: 'Ya existe un grupo con ese nombre en ese periodo.',
  NOT_FOUND: 'La carrera o el salón seleccionado ya no existe en tu sede.',
};

/**
 * `duracionCarreraSeleccionada` (Hallazgo 2 del review final, fix wave
 * 2026-08-25) — cota superior de `cicloActual` según la carrera elegida en
 * el form (`carrera.duracion`, `GET /carreras`). Opcional: si la carrera
 * seleccionada todavía no resolvió (o el catálogo falló, Hallazgo 3), no se
 * valida acá y el backend sigue siendo la fuente de verdad final
 * (`GruposService.crear`) — este bound es solo para adelantar el error
 * común al cliente, no reemplaza la validación real del servidor.
 */
function construirPayloadAlta(
  form: FormNuevo,
  duracionCarreraSeleccionada?: number,
): CrearGrupoInput | null {
  if (
    !form.nombre.trim() ||
    !form.carreraId ||
    !form.salonId ||
    !form.anioInicio.trim() ||
    !form.cicloActual.trim() ||
    !form.capacidad.trim()
  ) {
    return null;
  }

  const anioInicio = Number.parseInt(form.anioInicio, 10);
  const cicloActual = Number.parseInt(form.cicloActual, 10);
  const capacidad = Number.parseInt(form.capacidad, 10);

  if (!Number.isInteger(anioInicio) || anioInicio < 1) return null;
  if (!Number.isInteger(cicloActual) || cicloActual < 1) return null;
  if (!Number.isInteger(capacidad) || capacidad < 1) return null;
  if (duracionCarreraSeleccionada != null && cicloActual > duracionCarreraSeleccionada) {
    return null;
  }

  return {
    nombre: form.nombre.trim(),
    carreraId: form.carreraId,
    salonId: form.salonId,
    anioInicio,
    cicloActual,
    capacidad,
  };
}

function formatearPeriodo(anioInicio: number, cicloActual: number): string {
  return `${anioInicio} · Semestre ${cicloActual}`;
}

export default function AdminGruposPage() {
  const queryClient = useQueryClient();
  const [formNuevo, setFormNuevo] = useState<FormNuevo>(FORM_NUEVO_VACIO);

  // Filtros del listado — todos opcionales, cambiarlos resetea `page` a 1
  // (mismo criterio que `usePaginacionFiltrada`, Día 19: nunca quedar
  // "atrapado" en una página que ya no existe tras filtrar de nuevo).
  const [filtroAnioInicio, setFiltroAnioInicioState] = useState('');
  const [filtroCicloActual, setFiltroCicloActualState] = useState('');
  const [filtroCarreraId, setFiltroCarreraIdState] = useState('');
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
      page,
      LIMIT,
    ],
    queryFn: async () => {
      try {
        return await listarGrupos({
          anioInicio: anioInicioFiltroNum,
          cicloActual: cicloActualFiltroNum,
          carreraId: filtroCarreraId || undefined,
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
      setFormNuevo(FORM_NUEVO_VACIO);
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

  const carreraSeleccionada = (carrerasQuery.data ?? []).find(
    (carrera) => carrera.id === formNuevo.carreraId,
  );

  function handleSubmitNuevo(e: FormEvent) {
    e.preventDefault();
    const payload = construirPayloadAlta(formNuevo, carreraSeleccionada?.duracion);
    if (!payload) {
      const cicloActualNum = Number.parseInt(formNuevo.cicloActual, 10);
      if (
        carreraSeleccionada &&
        Number.isInteger(cicloActualNum) &&
        cicloActualNum > carreraSeleccionada.duracion
      ) {
        toast.error(
          `El ciclo actual debe estar entre 1 y ${carreraSeleccionada.duracion} para esta carrera.`,
        );
        return;
      }
      toast.error('Revisa que todos los campos estén completos y con formato correcto.');
      return;
    }
    crearMutation.mutate(payload);
  }

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
      <div className="rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-navy">Grupos</h1>
        <p className="mt-1 text-sm text-slate/60">Alta y consulta de los grupos de tu sede.</p>
      </div>

      <form
        onSubmit={handleSubmitNuevo}
        className="space-y-4 rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm"
      >
        <h2 className="font-display text-lg font-semibold text-slate">Nuevo grupo</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="nombre" className={LABEL_CLASS}>
              Nombre
            </label>
            <input
              id="nombre"
              type="text"
              required
              disabled={crearMutation.isPending}
              className={INPUT_CLASS}
              value={formNuevo.nombre}
              onChange={(e) => setFormNuevo((f) => ({ ...f, nombre: e.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="carreraId" className={LABEL_CLASS}>
              Carrera
            </label>
            <Select
              id="carreraId"
              disabled={crearMutation.isPending || carrerasQuery.isError}
              value={formNuevo.carreraId}
              onChange={(value) => setFormNuevo((f) => ({ ...f, carreraId: value }))}
              options={opcionesCarreras}
              placeholder="Selecciona una carrera"
            />
            {carrerasQuery.isError && (
              <p className="mt-1 text-xs text-crimson">
                {carrerasQuery.error instanceof ApiError
                  ? carrerasQuery.error.message
                  : 'No se pudo cargar el catálogo de carreras. Intenta de nuevo más tarde.'}
              </p>
            )}
            {!carrerasQuery.isLoading && !carrerasQuery.isError && opcionesCarreras.length === 0 && (
              <p className="mt-1 text-xs text-slate/60">
                No hay carreras registradas en tu sede.
              </p>
            )}
          </div>
          <div>
            <label htmlFor="salonId" className={LABEL_CLASS}>
              Salón
            </label>
            <Select
              id="salonId"
              disabled={crearMutation.isPending || salonesQuery.isError}
              value={formNuevo.salonId}
              onChange={(value) => setFormNuevo((f) => ({ ...f, salonId: value }))}
              options={opcionesSalones}
              placeholder="Selecciona un salón"
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
                No hay salones registrados en tu sede.
              </p>
            )}
          </div>
          <div>
            <label htmlFor="capacidad" className={LABEL_CLASS}>
              Capacidad
            </label>
            <input
              id="capacidad"
              type="number"
              min={1}
              step={1}
              required
              disabled={crearMutation.isPending}
              className={INPUT_CLASS}
              value={formNuevo.capacidad}
              onChange={(e) => setFormNuevo((f) => ({ ...f, capacidad: e.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="anioInicio" className={LABEL_CLASS}>
              Año de inicio
            </label>
            <input
              id="anioInicio"
              type="number"
              min={1}
              step={1}
              required
              disabled={crearMutation.isPending}
              className={INPUT_CLASS}
              value={formNuevo.anioInicio}
              onChange={(e) => setFormNuevo((f) => ({ ...f, anioInicio: e.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="cicloActual" className={LABEL_CLASS}>
              Ciclo actual (semestre)
            </label>
            <input
              id="cicloActual"
              type="number"
              min={1}
              max={carreraSeleccionada?.duracion}
              step={1}
              required
              disabled={crearMutation.isPending}
              className={INPUT_CLASS}
              value={formNuevo.cicloActual}
              onChange={(e) => setFormNuevo((f) => ({ ...f, cicloActual: e.target.value }))}
            />
            {carreraSeleccionada && (
              <p className="mt-1 text-xs text-slate/60">
                Esta carrera tiene {carreraSeleccionada.duracion} semestre
                {carreraSeleccionada.duracion === 1 ? '' : 's'}.
              </p>
            )}
          </div>
        </div>

        <button
          type="submit"
          disabled={crearMutation.isPending}
          className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
        >
          {crearMutation.isPending ? 'Guardando…' : 'Crear grupo'}
        </button>
      </form>

      <div className="rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <h2 className="font-display text-lg font-semibold text-slate">Filtros</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
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
