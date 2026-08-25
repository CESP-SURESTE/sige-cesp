'use client';

import { useState, type FormEvent } from 'react';
import type { Sede, SedeInput } from '@/lib/api/sedes';

/**
 * Modal de edición de sede — retrofit de swap-inline a modal (regla 13 de
 * `CLAUDE.md` raíz). Mismo estilo que `ConfirmarEliminarSedeModal.tsx`
 * (overlay + panel), `max-w-lg` por tener 4 campos. Prellenado con los
 * valores reales de `sede`.
 *
 * `costoRenta` NO se edita aquí (no está en el form actual tampoco) — se
 * omite del payload en vez de reenviar un valor potencialmente viejo;
 * `PATCH /sedes/:id` es parcial, así que no mandarlo deja el valor existente
 * intacto en la base de datos (mismo criterio "en blanco = sin cambio" que
 * Carreras/Salones, aplicado aquí a un campo que ni siquiera se muestra).
 */

interface FormEdicion {
  nombre: string;
  telefono: string;
  direccion: string;
  ubicacionReferencia: string;
}

function formDesdeSede(sede: Sede): FormEdicion {
  return {
    nombre: sede.nombre,
    telefono: sede.telefono,
    direccion: sede.direccion,
    ubicacionReferencia: sede.ubicacionReferencia,
  };
}

export interface EditarSedeModalProps {
  sede: Sede;
  guardando: boolean;
  onGuardar: (input: SedeInput) => void;
  onCancelar: () => void;
}

export function EditarSedeModal({
  sede,
  guardando,
  onGuardar,
  onCancelar,
}: EditarSedeModalProps) {
  const [form, setForm] = useState<FormEdicion>(() => formDesdeSede(sede));

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onGuardar(form);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate/40 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-slate">Editar sede</h2>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate/80">Nombre</label>
              <input
                required
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                disabled={guardando}
                className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate/80">Teléfono</label>
              <input
                required
                value={form.telefono}
                onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))}
                disabled={guardando}
                className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate/80">Dirección</label>
              <input
                required
                value={form.direccion}
                onChange={(e) => setForm((f) => ({ ...f, direccion: e.target.value }))}
                disabled={guardando}
                className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate/80">
                Referencia de ubicación
              </label>
              <input
                required
                value={form.ubicacionReferencia}
                onChange={(e) =>
                  setForm((f) => ({ ...f, ubicacionReferencia: e.target.value }))
                }
                disabled={guardando}
                className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none"
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
