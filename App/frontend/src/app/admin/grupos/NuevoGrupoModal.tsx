'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { INPUT_CLASS, LABEL_CLASS } from '@/components/admin/ui/persona-alta/estilos';
import { Select } from '@/components/admin/ui/persona-alta/Select';
import { ApiError } from '@/lib/api/http';
import type { Carrera } from '@/lib/api/carreras';
import type { Salon } from '@/lib/api/salones';
import type { CrearGrupoInput } from '@/lib/api/grupos';

/**
 * Modal de alta de grupo (Task 3 de la unificación de CRUD admin, 2026-08-25
 * — regla 13 ampliada de `CLAUDE.md` raíz). SOLO alta — a diferencia de
 * `CarreraModal`/`SalonModal` (Tasks 1-2), no existe `PATCH /grupos/:id`
 * (decisión deliberada desde Día 28), así que este modal no tiene rama de
 * edición ni prop `grupo`.
 *
 * `carrerasQuery`/`salonesQuery` se reciben ya resueltos desde `page.tsx`
 * (mismas queries que alimentan los filtros del listado, `queryKey: ['admin',
 * 'carreras']`/`['admin', 'salones']`) — este modal NO dispara sus propias
 * llamadas a `listarCarreras()`/`listarSalones()`, solo consume el resultado.
 *
 * Lógica de `cicloActual` acotado por `carrera.duracion` + passthrough del
 * mensaje real de `VALIDATION_ERROR` cuando el backend igual lo rechaza
 * (fix wave de Día 29) se movió aquí tal cual — antes vivía en `page.tsx`
 * junto al form fijo.
 */

interface FormNuevoGrupo {
  nombre: string;
  carreraId: string;
  salonId: string;
  anioInicio: string;
  cicloActual: string;
  capacidad: string;
}

const FORM_VACIO: FormNuevoGrupo = {
  nombre: '',
  carreraId: '',
  salonId: '',
  anioInicio: '',
  cicloActual: '',
  capacidad: '',
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
  form: FormNuevoGrupo,
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

export interface NuevoGrupoModalProps {
  carrerasQuery: UseQueryResult<Carrera[], Error>;
  salonesQuery: UseQueryResult<Salon[], Error>;
  guardando: boolean;
  onCrear: (payload: CrearGrupoInput) => void;
  onCancelar: () => void;
}

export function NuevoGrupoModal({
  carrerasQuery,
  salonesQuery,
  guardando,
  onCrear,
  onCancelar,
}: NuevoGrupoModalProps) {
  const [form, setForm] = useState<FormNuevoGrupo>(FORM_VACIO);

  const carreraSeleccionada = (carrerasQuery.data ?? []).find(
    (carrera) => carrera.id === form.carreraId,
  );

  const opcionesCarreras = (carrerasQuery.data ?? []).map((carrera) => ({
    value: carrera.id,
    label: carrera.nombre,
  }));
  const opcionesSalones = (salonesQuery.data ?? []).map((salon) => ({
    value: salon.id,
    label: salon.nombre,
  }));

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const payload = construirPayloadAlta(form, carreraSeleccionada?.duracion);
    if (!payload) {
      const cicloActualNum = Number.parseInt(form.cicloActual, 10);
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
    onCrear(payload);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-slate">Nuevo grupo</h2>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="grupo-modal-nombre" className={LABEL_CLASS}>
                Nombre
              </label>
              <input
                id="grupo-modal-nombre"
                type="text"
                required
                disabled={guardando}
                className={INPUT_CLASS}
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="grupo-modal-carreraId" className={LABEL_CLASS}>
                Carrera
              </label>
              <Select
                id="grupo-modal-carreraId"
                disabled={guardando || carrerasQuery.isError}
                value={form.carreraId}
                onChange={(value) => setForm((f) => ({ ...f, carreraId: value }))}
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
              {!carrerasQuery.isLoading &&
                !carrerasQuery.isError &&
                opcionesCarreras.length === 0 && (
                  <p className="mt-1 text-xs text-slate/60">
                    No hay carreras registradas en tu sede.
                  </p>
                )}
            </div>
            <div>
              <label htmlFor="grupo-modal-salonId" className={LABEL_CLASS}>
                Salón
              </label>
              <Select
                id="grupo-modal-salonId"
                disabled={guardando || salonesQuery.isError}
                value={form.salonId}
                onChange={(value) => setForm((f) => ({ ...f, salonId: value }))}
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
              {!salonesQuery.isLoading &&
                !salonesQuery.isError &&
                opcionesSalones.length === 0 && (
                  <p className="mt-1 text-xs text-slate/60">
                    No hay salones registrados en tu sede.{' '}
                    <Link href="/admin/salones" className="text-navy hover:underline">
                      Crea uno aquí
                    </Link>
                    .
                  </p>
                )}
            </div>
            <div>
              <label htmlFor="grupo-modal-capacidad" className={LABEL_CLASS}>
                Capacidad
              </label>
              <input
                id="grupo-modal-capacidad"
                type="number"
                min={1}
                step={1}
                required
                disabled={guardando}
                className={INPUT_CLASS}
                value={form.capacidad}
                onChange={(e) => setForm((f) => ({ ...f, capacidad: e.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="grupo-modal-anioInicio" className={LABEL_CLASS}>
                Año de inicio
              </label>
              <input
                id="grupo-modal-anioInicio"
                type="number"
                min={1}
                step={1}
                required
                disabled={guardando}
                className={INPUT_CLASS}
                value={form.anioInicio}
                onChange={(e) => setForm((f) => ({ ...f, anioInicio: e.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="grupo-modal-cicloActual" className={LABEL_CLASS}>
                Ciclo actual (cuatrimestre)
              </label>
              <input
                id="grupo-modal-cicloActual"
                type="number"
                min={1}
                max={carreraSeleccionada?.duracion}
                step={1}
                required
                disabled={guardando}
                className={INPUT_CLASS}
                value={form.cicloActual}
                onChange={(e) => setForm((f) => ({ ...f, cicloActual: e.target.value }))}
              />
              {carreraSeleccionada && (
                <p className="mt-1 text-xs text-slate/60">
                  Esta carrera tiene {carreraSeleccionada.duracion} cuatrimestre
                  {carreraSeleccionada.duracion === 1 ? '' : 's'}.
                </p>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onCancelar}
              disabled={guardando}
              className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
            >
              {guardando ? 'Guardando…' : 'Crear grupo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
