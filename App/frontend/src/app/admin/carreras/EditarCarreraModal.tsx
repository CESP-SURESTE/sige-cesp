'use client';

import { useState, type FormEvent } from 'react';
import { LABEL_CLASS, INPUT_CLASS } from '@/components/admin/ui/persona-alta/estilos';
import { Select } from '@/components/admin/ui/persona-alta/Select';
import type {
  ActualizarCarreraInput,
  Carrera,
  EstatusCarrera,
  ModalidadCarrera,
  NivelCarrera,
} from '@/lib/api/carreras';

/**
 * Modal de edición de carrera — retrofit de swap-inline a modal (regla 13 de
 * `CLAUDE.md` raíz). Mismo estilo que
 * `app/plataforma/sedes/ConfirmarEliminarSedeModal.tsx` (overlay + panel),
 * pero `max-w-lg` en vez de `max-w-md` por tener más campos. Prellenado con
 * los valores reales de `carrera` (no arranca vacío) — `PATCH /carreras/:id`
 * sigue siendo parcial por diseño (en blanco = sin cambio), aunque acá en la
 * práctica todos los campos ya llegan llenos.
 */

const NIVEL_LABEL: Record<NivelCarrera, string> = {
  TECNICO: 'Técnico',
  LICENCIATURA: 'Licenciatura',
  MAESTRIA: 'Maestría',
  DOCTORADO: 'Doctorado',
};

const MODALIDAD_LABEL: Record<ModalidadCarrera, string> = {
  PRESENCIAL: 'Presencial',
  SEMIPRESENCIAL: 'Semipresencial',
  EN_LINEA: 'En línea',
};

const ESTATUS_LABEL: Record<EstatusCarrera, string> = {
  ACTIVA: 'Activa',
  INACTIVA: 'Inactiva',
};

interface FormEdicion {
  nombre: string;
  clave: string;
  duracion: string;
  nivel: NivelCarrera | '';
  modalidad: ModalidadCarrera | '';
  rvoe: string;
  descripcion: string;
  estatus: EstatusCarrera | '';
}

function formDesdeCarrera(carrera: Carrera): FormEdicion {
  return {
    nombre: carrera.nombre,
    clave: carrera.clave,
    duracion: String(carrera.duracion),
    nivel: carrera.nivel,
    modalidad: carrera.modalidad,
    rvoe: carrera.rvoe,
    descripcion: carrera.descripcion,
    estatus: carrera.estatus,
  };
}

/** Solo incluye en el `PATCH` los campos que el admin sí llenó — en blanco = sin cambio. */
function construirPayloadEdicion(form: FormEdicion): ActualizarCarreraInput {
  const payload: ActualizarCarreraInput = {};

  if (form.nombre.trim()) payload.nombre = form.nombre.trim();
  if (form.clave.trim()) payload.clave = form.clave.trim();
  if (form.duracion.trim()) {
    const duracion = Number.parseInt(form.duracion, 10);
    if (Number.isInteger(duracion) && duracion >= 1) payload.duracion = duracion;
  }
  if (form.nivel) payload.nivel = form.nivel;
  if (form.modalidad) payload.modalidad = form.modalidad;
  if (form.rvoe.trim()) payload.rvoe = form.rvoe.trim();
  if (form.descripcion.trim()) payload.descripcion = form.descripcion.trim();
  if (form.estatus) payload.estatus = form.estatus;

  return payload;
}

export interface EditarCarreraModalProps {
  carrera: Carrera;
  guardando: boolean;
  onGuardar: (payload: ActualizarCarreraInput) => void;
  onCancelar: () => void;
}

export function EditarCarreraModal({
  carrera,
  guardando,
  onGuardar,
  onCancelar,
}: EditarCarreraModalProps) {
  const [form, setForm] = useState<FormEdicion>(() => formDesdeCarrera(carrera));

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onGuardar(construirPayloadEdicion(form));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate/40 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-slate">Editar carrera</h2>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="nombre" className={LABEL_CLASS}>
                Nombre
              </label>
              <input
                id="nombre"
                type="text"
                disabled={guardando}
                className={INPUT_CLASS}
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="clave" className={LABEL_CLASS}>
                Clave
              </label>
              <input
                id="clave"
                type="text"
                disabled={guardando}
                className={INPUT_CLASS}
                value={form.clave}
                onChange={(e) => setForm((f) => ({ ...f, clave: e.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="duracion" className={LABEL_CLASS}>
                Duración (semestres)
              </label>
              <input
                id="duracion"
                type="number"
                min={1}
                step={1}
                disabled={guardando}
                className={INPUT_CLASS}
                value={form.duracion}
                onChange={(e) => setForm((f) => ({ ...f, duracion: e.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="rvoe" className={LABEL_CLASS}>
                RVOE
              </label>
              <input
                id="rvoe"
                type="text"
                disabled={guardando}
                className={INPUT_CLASS}
                value={form.rvoe}
                onChange={(e) => setForm((f) => ({ ...f, rvoe: e.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="nivel" className={LABEL_CLASS}>
                Nivel
              </label>
              <Select
                id="nivel"
                disabled={guardando}
                value={form.nivel}
                onChange={(value) =>
                  setForm((f) => ({ ...f, nivel: value as NivelCarrera | '' }))
                }
                options={[
                  { value: '', label: 'Sin cambio' },
                  ...(Object.entries(NIVEL_LABEL) as [NivelCarrera, string][]).map(
                    ([value, label]) => ({ value, label }),
                  ),
                ]}
                placeholder="Sin cambio"
              />
            </div>
            <div>
              <label htmlFor="modalidad" className={LABEL_CLASS}>
                Modalidad
              </label>
              <Select
                id="modalidad"
                disabled={guardando}
                value={form.modalidad}
                onChange={(value) =>
                  setForm((f) => ({ ...f, modalidad: value as ModalidadCarrera | '' }))
                }
                options={[
                  { value: '', label: 'Sin cambio' },
                  ...(Object.entries(MODALIDAD_LABEL) as [ModalidadCarrera, string][]).map(
                    ([value, label]) => ({ value, label }),
                  ),
                ]}
                placeholder="Sin cambio"
              />
            </div>
            <div>
              <label htmlFor="estatus" className={LABEL_CLASS}>
                Estatus
              </label>
              <Select
                id="estatus"
                disabled={guardando}
                value={form.estatus}
                onChange={(value) =>
                  setForm((f) => ({ ...f, estatus: value as EstatusCarrera | '' }))
                }
                options={[
                  { value: '', label: 'Sin cambio' },
                  ...(Object.entries(ESTATUS_LABEL) as [EstatusCarrera, string][]).map(
                    ([value, label]) => ({ value, label }),
                  ),
                ]}
                placeholder="Sin cambio"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="descripcion" className={LABEL_CLASS}>
                Descripción
              </label>
              <textarea
                id="descripcion"
                rows={3}
                disabled={guardando}
                className={INPUT_CLASS}
                value={form.descripcion}
                onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))}
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
