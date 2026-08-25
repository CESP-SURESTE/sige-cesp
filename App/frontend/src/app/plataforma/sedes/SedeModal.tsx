'use client';

import { useState, type FormEvent } from 'react';
import type { Sede, SedeInput } from '@/lib/api/sedes';

/**
 * Modal único de alta+edición de sede (Task 2 de la unificación de CRUD
 * admin, 2026-08-25 — regla 13 ampliada de `CLAUDE.md` raíz). Antes de hoy
 * había un form fijo de "Nueva sede" en `page.tsx` + este archivo
 * (`EditarSedeModal.tsx`, renombrado a `SedeModal.tsx`) solo para editar —
 * ahora ambos flujos comparten el mismo modal. Mismo patrón estructural que
 * `app/admin/carreras/CarreraModal.tsx` (Task 1) pero código 100% propio de
 * `app/plataforma/` (regla 11 — árboles de admin/alumno y plataforma no
 * comparten componentes; `app/plataforma/` además es una identidad aparte,
 * JWT propio, sin `proxy.ts`).
 *
 * `sede: Sede | null` decide el modo: `null` → alta (campos vacíos, todos
 * `required`, botón "Crear sede", `onCrear`); objeto real → edición
 * (prellenado, campos opcionales — en blanco = sin cambio, botón "Guardar
 * cambios", `onEditar`). La página sigue siendo dueña de las 2 mutations
 * (`crearMutation`/`actualizarMutation`); este modal solo arma el payload
 * correcto y decide cuál de los 2 callbacks invocar según su propio modo.
 *
 * `costoRenta` NO se edita aquí (no estaba en el form fijo anterior ni en el
 * modal de edición) — se omite del payload en ambos modos; en edición,
 * `PATCH /sedes/:id` es parcial, así que no mandarlo deja el valor existente
 * intacto en la base de datos (mismo criterio "en blanco = sin cambio" que
 * el resto de campos, aplicado aquí a uno que ni siquiera se muestra).
 *
 * Mismo estilo que el archivo original — `<label>` SIN `htmlFor`/`id` (a
 * diferencia de `CarreraModal.tsx`), sin ids nuevos en los `<input>`, clases
 * Tailwind inline en vez de `LABEL_CLASS`/`INPUT_CLASS` (esos viven en
 * `components/admin/ui/`, fuera de alcance para este árbol por regla 11).
 */

interface FormSede {
  nombre: string;
  telefono: string;
  direccion: string;
  ubicacionReferencia: string;
}

const FORM_VACIO: FormSede = {
  nombre: '',
  telefono: '',
  direccion: '',
  ubicacionReferencia: '',
};

function formDesdeSede(sede: Sede): FormSede {
  return {
    nombre: sede.nombre,
    telefono: sede.telefono,
    direccion: sede.direccion,
    ubicacionReferencia: sede.ubicacionReferencia,
  };
}

/** Modo alta — todos los campos son obligatorios, arma el payload completo de `POST /sedes`. */
function construirPayloadAlta(form: FormSede): SedeInput | null {
  if (
    !form.nombre.trim() ||
    !form.telefono.trim() ||
    !form.direccion.trim() ||
    !form.ubicacionReferencia.trim()
  ) {
    return null;
  }

  return {
    nombre: form.nombre.trim(),
    telefono: form.telefono.trim(),
    direccion: form.direccion.trim(),
    ubicacionReferencia: form.ubicacionReferencia.trim(),
  };
}

/** Modo edición — solo incluye en el `PATCH` los campos que el admin sí llenó; en blanco = sin cambio. */
function construirPayloadEdicion(form: FormSede): Partial<SedeInput> {
  const payload: Partial<SedeInput> = {};

  if (form.nombre.trim()) payload.nombre = form.nombre.trim();
  if (form.telefono.trim()) payload.telefono = form.telefono.trim();
  if (form.direccion.trim()) payload.direccion = form.direccion.trim();
  if (form.ubicacionReferencia.trim()) {
    payload.ubicacionReferencia = form.ubicacionReferencia.trim();
  }

  return payload;
}

export interface SedeModalProps {
  /** `null` = modo alta. Objeto real = modo edición, prellena el formulario. */
  sede: Sede | null;
  guardando: boolean;
  onCrear: (payload: SedeInput) => void;
  onEditar: (payload: Partial<SedeInput>) => void;
  onCancelar: () => void;
}

export function SedeModal({
  sede,
  guardando,
  onCrear,
  onEditar,
  onCancelar,
}: SedeModalProps) {
  const esAlta = sede === null;
  const [form, setForm] = useState<FormSede>(() =>
    sede ? formDesdeSede(sede) : FORM_VACIO,
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (esAlta) {
      const payload = construirPayloadAlta(form);
      if (!payload) return;
      onCrear(payload);
      return;
    }
    onEditar(construirPayloadEdicion(form));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-slate">
          {esAlta ? 'Nueva sede' : 'Editar sede'}
        </h2>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate/80">Nombre</label>
              <input
                required={esAlta}
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                disabled={guardando}
                className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate/80">Teléfono</label>
              <input
                required={esAlta}
                value={form.telefono}
                onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))}
                disabled={guardando}
                className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate/80">Dirección</label>
              <input
                required={esAlta}
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
                required={esAlta}
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
              {guardando ? 'Guardando…' : esAlta ? 'Crear sede' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
