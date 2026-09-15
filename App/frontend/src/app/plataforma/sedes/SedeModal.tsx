'use client';

import { useState, type FormEvent } from 'react';
import type { Sede, SedeInput } from '@/lib/api/sedes';

/**
 * Modal de EDICIÓN de sede (recortado a solo-edición 2026-09-11, Task 7 del
 * plan "Sede con fundadores obligatorios" — antes, 2026-08-25, era un modal
 * único de alta+edición). La creación de sede vive ahora en
 * `app/plataforma/sedes/nueva/page.tsx` como página completa (exige alta de
 * director + administrativo fundadores, no encaja en un modal chico).
 * `sede: Sede` siempre viene prellenada — no hay modo alta. Mismo patrón
 * estructural que `app/admin/carreras/CarreraModal.tsx` pero código 100%
 * propio de `app/plataforma/` (regla 11 — árboles de admin/alumno y
 * plataforma no comparten componentes; `app/plataforma/` además es una
 * identidad aparte, JWT propio, sin `proxy.ts`).
 *
 * Campos en blanco = sin cambio (`PATCH /sedes/:id` es parcial) — la página
 * es dueña de `actualizarMutation`; este modal solo arma el payload y llama
 * `onEditar`.
 *
 * `costoRenta` NO se edita aquí (no estaba en el form fijo anterior ni en el
 * modal de edición) — se omite del payload; `PATCH /sedes/:id` es parcial,
 * así que no mandarlo deja el valor existente intacto en la base de datos
 * (mismo criterio "en blanco = sin cambio" que el resto de campos, aplicado
 * aquí a uno que ni siquiera se muestra).
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
  activa: boolean;
}

function formDesdeSede(sede: Sede): FormSede {
  return {
    nombre: sede.nombre,
    telefono: sede.telefono,
    direccion: sede.direccion,
    ubicacionReferencia: sede.ubicacionReferencia,
    activa: sede.activa,
  };
}

/**
 * Solo incluye en el `PATCH` los campos que el admin sí llenó; en blanco =
 * sin cambio. `activa` es un boolean, no un string — el criterio "en blanco"
 * no aplica, se compara contra el valor original de `sede` (pasado aparte,
 * no vive en `FormSede` fuera de este chequeo) y solo se manda si cambió.
 */
function construirPayloadEdicion(
  form: FormSede,
  sede: Sede,
): Partial<SedeInput> & { activa?: boolean } {
  const payload: Partial<SedeInput> & { activa?: boolean } = {};

  if (form.nombre.trim()) payload.nombre = form.nombre.trim();
  if (form.telefono.trim()) payload.telefono = form.telefono.trim();
  if (form.direccion.trim()) payload.direccion = form.direccion.trim();
  if (form.ubicacionReferencia.trim()) {
    payload.ubicacionReferencia = form.ubicacionReferencia.trim();
  }
  if (form.activa !== sede.activa) payload.activa = form.activa;

  return payload;
}

export interface SedeModalProps {
  sede: Sede;
  guardando: boolean;
  onEditar: (payload: Partial<SedeInput> & { activa?: boolean }) => void;
  onCancelar: () => void;
}

export function SedeModal({
  sede,
  guardando,
  onEditar,
  onCancelar,
}: SedeModalProps) {
  const [form, setForm] = useState<FormSede>(() => formDesdeSede(sede));

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onEditar(construirPayloadEdicion(form, sede));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-slate">Editar sede</h2>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate/80">Nombre</label>
              <input
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                disabled={guardando}
                className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate/80">Teléfono</label>
              <input
                value={form.telefono}
                onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))}
                disabled={guardando}
                className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate/80">Dirección</label>
              <input
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
                value={form.ubicacionReferencia}
                onChange={(e) =>
                  setForm((f) => ({ ...f, ubicacionReferencia: e.target.value }))
                }
                disabled={guardando}
                className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none"
              />
            </div>
            <div className="col-span-2">
              <label className="flex items-center gap-2 text-sm font-medium text-slate/80">
                <input
                  type="checkbox"
                  checked={form.activa}
                  onChange={(e) => setForm((f) => ({ ...f, activa: e.target.checked }))}
                  disabled={guardando}
                  className="h-4 w-4 rounded border-mist text-navy focus:ring-2 focus:ring-navy/20"
                />
                Activa
              </label>
              <p className="mt-1 text-xs text-slate/60">
                Desmarcar da de baja lógica a la sede (mismo efecto que &quot;Eliminar&quot;
                cuando tiene datos asociados). Marcar reactiva una sede dada de baja.
              </p>
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
