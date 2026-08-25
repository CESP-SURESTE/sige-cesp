'use client';

import { useState, type FormEvent } from 'react';
import { LABEL_CLASS, INPUT_CLASS } from '@/components/admin/ui/persona-alta/estilos';
import type { Salon, SalonInput } from '@/lib/api/salones';

/**
 * Modal de edición de salón — retrofit de swap-inline a modal (regla 13 de
 * `CLAUDE.md` raíz). Mismo estilo que `ConfirmarEliminarSalonModal.tsx`
 * (overlay + panel), `max-w-md` — solo 2 campos, no amerita `max-w-lg`.
 * Prellenado con los valores reales de `salon`. `PATCH /salones/:id` sigue
 * siendo parcial por diseño (en blanco = sin cambio).
 */

interface FormEdicion {
  nombre: string;
  capacidad: string;
}

function formDesdeSalon(salon: Salon): FormEdicion {
  return { nombre: salon.nombre, capacidad: String(salon.capacidad) };
}

/** Solo incluye en el `PATCH` los campos que el admin sí llenó — en blanco = sin cambio. */
function construirPayloadEdicion(form: FormEdicion): Partial<SalonInput> {
  const payload: Partial<SalonInput> = {};

  if (form.nombre.trim()) payload.nombre = form.nombre.trim();
  if (form.capacidad.trim()) {
    const capacidad = Number.parseInt(form.capacidad, 10);
    if (Number.isInteger(capacidad) && capacidad >= 1) payload.capacidad = capacidad;
  }

  return payload;
}

export interface EditarSalonModalProps {
  salon: Salon;
  guardando: boolean;
  onGuardar: (payload: Partial<SalonInput>) => void;
  onCancelar: () => void;
}

export function EditarSalonModal({
  salon,
  guardando,
  onGuardar,
  onCancelar,
}: EditarSalonModalProps) {
  const [form, setForm] = useState<FormEdicion>(() => formDesdeSalon(salon));

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onGuardar(construirPayloadEdicion(form));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-slate">Editar salón</h2>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="editar-nombre" className={LABEL_CLASS}>
                Nombre
              </label>
              <input
                id="editar-nombre"
                type="text"
                disabled={guardando}
                className={INPUT_CLASS}
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="editar-capacidad" className={LABEL_CLASS}>
                Capacidad
              </label>
              <input
                id="editar-capacidad"
                type="number"
                min={1}
                step={1}
                disabled={guardando}
                className={INPUT_CLASS}
                value={form.capacidad}
                onChange={(e) => setForm((f) => ({ ...f, capacidad: e.target.value }))}
              />
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
              {guardando ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
