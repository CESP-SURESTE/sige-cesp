'use client';

import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { LABEL_CLASS, INPUT_CLASS } from '@/components/admin/ui/persona-alta/estilos';
import type { Salon, SalonInput } from '@/lib/api/salones';

/**
 * Modal único de alta+edición de salón (Task 1 de la unificación de CRUD
 * admin, 2026-08-25 — regla 13 ampliada de `CLAUDE.md` raíz). Antes de hoy
 * había un form fijo de "Nuevo salón" en `page.tsx` + este archivo
 * (`EditarSalonModal.tsx`, renombrado a `SalonModal.tsx`) solo para editar —
 * ahora ambos flujos comparten el mismo modal. Mismo criterio que
 * `app/admin/carreras/CarreraModal.tsx`.
 *
 * `salon: Salon | null` decide el modo: `null` → alta (campos vacíos, ambos
 * `required`, botón "Crear salón", `onCrear`); objeto real → edición
 * (prellenado, campos opcionales — en blanco = sin cambio, botón "Guardar
 * cambios", `onEditar`). La página sigue siendo dueña de las 2 mutations.
 *
 * Mismo estilo que `ConfirmarEliminarSalonModal.tsx` (overlay + panel),
 * `max-w-md` — solo 2 campos, no amerita `max-w-lg`. Ids con prefijo
 * `salon-modal-` (antes `editar-`) — sin colisión posible, la página ya no
 * tiene un form fijo con estos mismos ids.
 */

interface FormSalon {
  nombre: string;
  capacidad: string;
}

const FORM_VACIO: FormSalon = { nombre: '', capacidad: '' };

function formDesdeSalon(salon: Salon): FormSalon {
  return { nombre: salon.nombre, capacidad: String(salon.capacidad) };
}

/** Modo alta — ambos campos son obligatorios, arma el payload completo de `POST /salones`. */
function construirPayloadAlta(form: FormSalon): SalonInput | null {
  if (!form.nombre.trim() || !form.capacidad.trim()) return null;

  const capacidad = Number.parseInt(form.capacidad, 10);
  if (!Number.isInteger(capacidad) || capacidad < 1) return null;

  return { nombre: form.nombre.trim(), capacidad };
}

/** Modo edición — solo incluye en el `PATCH` los campos que el admin sí llenó; en blanco = sin cambio. */
function construirPayloadEdicion(form: FormSalon): Partial<SalonInput> {
  const payload: Partial<SalonInput> = {};

  if (form.nombre.trim()) payload.nombre = form.nombre.trim();
  if (form.capacidad.trim()) {
    const capacidad = Number.parseInt(form.capacidad, 10);
    if (Number.isInteger(capacidad) && capacidad >= 1) payload.capacidad = capacidad;
  }

  return payload;
}

export interface SalonModalProps {
  /** `null` = modo alta. Objeto real = modo edición, prellena el formulario. */
  salon: Salon | null;
  guardando: boolean;
  onCrear: (payload: SalonInput) => void;
  onEditar: (payload: Partial<SalonInput>) => void;
  onCancelar: () => void;
}

export function SalonModal({ salon, guardando, onCrear, onEditar, onCancelar }: SalonModalProps) {
  const esAlta = salon === null;
  const [form, setForm] = useState<FormSalon>(() => (salon ? formDesdeSalon(salon) : FORM_VACIO));

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (esAlta) {
      const payload = construirPayloadAlta(form);
      if (!payload) {
        toast.error('Revisa que todos los campos estén completos y con formato correcto.');
        return;
      }
      onCrear(payload);
      return;
    }
    onEditar(construirPayloadEdicion(form));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-slate">
          {esAlta ? 'Nuevo salón' : 'Editar salón'}
        </h2>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="salon-modal-nombre" className={LABEL_CLASS}>
                Nombre
              </label>
              <input
                id="salon-modal-nombre"
                type="text"
                required={esAlta}
                disabled={guardando}
                className={INPUT_CLASS}
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="salon-modal-capacidad" className={LABEL_CLASS}>
                Capacidad
              </label>
              <input
                id="salon-modal-capacidad"
                type="number"
                min={1}
                step={1}
                required={esAlta}
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
              {guardando ? 'Guardando…' : esAlta ? 'Crear salón' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
