'use client';

import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import {
  INPUT_CLASS,
  LABEL_CLASS,
} from '@/components/admin/ui/persona-alta/estilos';

interface AgregarMateriaModalProps {
  carreraNombre: string;
  ciclo: number;
  guardando: boolean;
  /** Error de la última mutación fallida (ej. nombre duplicado). `null` si no hay. */
  errorMensaje: string | null;
  onCrear: (nombre: string) => void;
  onCancelar: () => void;
}

/**
 * Modal "+ Nueva materia" local a `app/admin/grupos/[id]/` (regla 11). Solo
 * campo `nombre` — `ciclo` es fijo (= `grupo.cicloActual`) y la carrera sale
 * del grupo; ambos se muestran como texto. `POST /materias` lo dispara el
 * padre (`SeccionAsignaciones`).
 */
export function AgregarMateriaModal({
  carreraNombre,
  ciclo,
  guardando,
  errorMensaje,
  onCrear,
  onCancelar,
}: AgregarMateriaModalProps) {
  const [nombre, setNombre] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) {
      toast.error('El nombre de la materia es requerido.');
      return;
    }
    onCrear(nombre.trim());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-slate">
          Nueva materia
        </h2>
        <p className="mt-1 text-xs text-slate/60">
          Materia de ciclo {ciclo} · {carreraNombre}
        </p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="materia-modal-nombre" className={LABEL_CLASS}>
              Nombre
            </label>
            <input
              id="materia-modal-nombre"
              type="text"
              required
              disabled={guardando}
              className={INPUT_CLASS}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
            {errorMensaje && (
              <p className="mt-1 text-xs text-crimson">{errorMensaje}</p>
            )}
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
              {guardando ? 'Creando…' : 'Crear materia'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
