'use client';

import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { LABEL_CLASS, INPUT_CLASS } from '@/components/admin/ui/persona-alta/estilos';
import { Select } from '@/components/admin/ui/persona-alta/Select';
import type {
  ActualizarCarreraInput,
  Carrera,
  CrearCarreraInput,
  EstatusCarrera,
  ModalidadCarrera,
  NivelCarrera,
} from '@/lib/api/carreras';

/**
 * Modal único de alta+edición de carrera (Task 1 de la unificación de CRUD
 * admin, 2026-08-25 — regla 13 ampliada de `CLAUDE.md` raíz). Antes de hoy
 * había un form fijo de "Nueva carrera" en `page.tsx` + este archivo
 * (`EditarCarreraModal.tsx`, renombrado a `CarreraModal.tsx`) solo para
 * editar — ahora ambos flujos comparten el mismo modal.
 *
 * `carrera: Carrera | null` decide el modo: `null` → alta (campos vacíos,
 * todos `required`, botón "Crear carrera", `onCrear`); objeto real → edición
 * (prellenado, campos opcionales — en blanco = sin cambio, botón "Guardar
 * cambios", `onEditar`). La página sigue siendo dueña de las 2 mutations
 * (`crearMutation`/`actualizarMutation`); este modal solo arma el payload
 * correcto y decide cuál de los 2 callbacks invocar según su propio modo.
 *
 * Mismo estilo que `app/plataforma/sedes/ConfirmarEliminarSedeModal.tsx`
 * (overlay + panel), `max-w-lg` por tener varios campos, `max-h-[90vh]
 * overflow-y-auto` (fix de scroll ya aplicado en el retrofit anterior — no
 * reintroducir el bug). Ids con prefijo `carrera-modal-` (antes `editar-`,
 * que ya no tiene sentido semántico ahora que el modal también sirve para
 * alta) — sin colisión posible, la página ya no tiene un form fijo con estos
 * mismos ids.
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

interface FormCarrera {
  nombre: string;
  clave: string;
  duracion: string;
  nivel: NivelCarrera | '';
  modalidad: ModalidadCarrera | '';
  rvoe: string;
  procedenciaRvoe: string;
  descripcion: string;
  estatus: EstatusCarrera | '';
}

const FORM_VACIO: FormCarrera = {
  nombre: '',
  clave: '',
  duracion: '',
  nivel: '',
  modalidad: '',
  rvoe: '',
  procedenciaRvoe: '',
  descripcion: '',
  estatus: '',
};

function formDesdeCarrera(carrera: Carrera): FormCarrera {
  return {
    nombre: carrera.nombre,
    clave: carrera.clave,
    duracion: String(carrera.duracion),
    nivel: carrera.nivel,
    modalidad: carrera.modalidad,
    rvoe: carrera.rvoe ?? '',
    procedenciaRvoe: carrera.procedenciaRvoe ?? '',
    descripcion: carrera.descripcion,
    estatus: carrera.estatus,
  };
}

/**
 * Modo alta — `rvoe`/`procedenciaRvoe` son opcionales desde 2026-09-07 (antes
 * `rvoe` era obligatorio); el resto de campos sigue siendo requerido para
 * armar el payload completo de `POST /carreras`.
 */
function construirPayloadAlta(form: FormCarrera): CrearCarreraInput | null {
  if (
    !form.nombre.trim() ||
    !form.clave.trim() ||
    !form.duracion.trim() ||
    !form.nivel ||
    !form.modalidad ||
    !form.descripcion.trim()
  ) {
    return null;
  }
  const duracion = Number.parseInt(form.duracion, 10);
  if (!Number.isInteger(duracion) || duracion < 1) return null;

  return {
    nombre: form.nombre.trim(),
    clave: form.clave.trim(),
    duracion,
    nivel: form.nivel,
    modalidad: form.modalidad,
    rvoe: form.rvoe.trim() || undefined,
    procedenciaRvoe: form.procedenciaRvoe.trim() || undefined,
    descripcion: form.descripcion.trim(),
  };
}

/**
 * Modo edición — solo incluye en el `PATCH` los campos que el admin sí
 * llenó; en blanco = sin cambio (mismo criterio que el resto de campos
 * opcionales de edición). `procedenciaRvoe` sigue el mismo patrón, aunque acá
 * "en blanco" es ambiguo — un admin que ya tenía procedencia capturada y
 * quiere borrarla no puede hacerlo desde este modal (gap conocido, sin
 * pedido explícito de resolverlo, YAGNI — ver nota del plan
 * `2026-09-07-perfil-maestro-tiposangre-rvoe.md`, Task 2).
 */
function construirPayloadEdicion(form: FormCarrera): ActualizarCarreraInput {
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
  if (form.procedenciaRvoe.trim()) payload.procedenciaRvoe = form.procedenciaRvoe.trim();
  if (form.descripcion.trim()) payload.descripcion = form.descripcion.trim();
  if (form.estatus) payload.estatus = form.estatus;

  return payload;
}

export interface CarreraModalProps {
  /** `null` = modo alta. Objeto real = modo edición, prellena el formulario. */
  carrera: Carrera | null;
  guardando: boolean;
  onCrear: (payload: CrearCarreraInput) => void;
  onEditar: (payload: ActualizarCarreraInput) => void;
  onCancelar: () => void;
}

export function CarreraModal({
  carrera,
  guardando,
  onCrear,
  onEditar,
  onCancelar,
}: CarreraModalProps) {
  const esAlta = carrera === null;
  const [form, setForm] = useState<FormCarrera>(() =>
    carrera ? formDesdeCarrera(carrera) : FORM_VACIO,
  );

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
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-slate">
          {esAlta ? 'Nueva carrera' : 'Editar carrera'}
        </h2>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="carrera-modal-nombre" className={LABEL_CLASS}>
                Nombre
              </label>
              <input
                id="carrera-modal-nombre"
                type="text"
                required={esAlta}
                disabled={guardando}
                className={INPUT_CLASS}
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="carrera-modal-clave" className={LABEL_CLASS}>
                Clave
              </label>
              <input
                id="carrera-modal-clave"
                type="text"
                required={esAlta}
                disabled={guardando}
                className={INPUT_CLASS}
                value={form.clave}
                onChange={(e) => setForm((f) => ({ ...f, clave: e.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="carrera-modal-duracion" className={LABEL_CLASS}>
                Duración (cuatrimestres)
              </label>
              <input
                id="carrera-modal-duracion"
                type="number"
                min={1}
                step={1}
                required={esAlta}
                disabled={guardando}
                className={INPUT_CLASS}
                value={form.duracion}
                onChange={(e) => setForm((f) => ({ ...f, duracion: e.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="carrera-modal-rvoe" className={LABEL_CLASS}>
                RVOE (opcional)
              </label>
              <input
                id="carrera-modal-rvoe"
                type="text"
                disabled={guardando}
                className={INPUT_CLASS}
                value={form.rvoe}
                onChange={(e) => setForm((f) => ({ ...f, rvoe: e.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="carrera-modal-procedenciaRvoe" className={LABEL_CLASS}>
                Procedencia del RVOE (opcional)
              </label>
              <input
                id="carrera-modal-procedenciaRvoe"
                type="text"
                disabled={guardando}
                className={INPUT_CLASS}
                value={form.procedenciaRvoe}
                onChange={(e) => setForm((f) => ({ ...f, procedenciaRvoe: e.target.value }))}
              />
              <p className="mt-1 text-xs text-slate/60">
                Solo si el RVOE fue emitido en otro estado.
              </p>
            </div>
            <div>
              <label htmlFor="carrera-modal-nivel" className={LABEL_CLASS}>
                Nivel
              </label>
              <Select
                id="carrera-modal-nivel"
                disabled={guardando}
                value={form.nivel}
                onChange={(value) =>
                  setForm((f) => ({ ...f, nivel: value as NivelCarrera | '' }))
                }
                options={[
                  { value: '', label: esAlta ? 'Selecciona un nivel' : 'Sin cambio' },
                  ...(Object.entries(NIVEL_LABEL) as [NivelCarrera, string][]).map(
                    ([value, label]) => ({ value, label }),
                  ),
                ]}
                placeholder={esAlta ? 'Selecciona un nivel' : 'Sin cambio'}
              />
            </div>
            <div>
              <label htmlFor="carrera-modal-modalidad" className={LABEL_CLASS}>
                Modalidad
              </label>
              <Select
                id="carrera-modal-modalidad"
                disabled={guardando}
                value={form.modalidad}
                onChange={(value) =>
                  setForm((f) => ({ ...f, modalidad: value as ModalidadCarrera | '' }))
                }
                options={[
                  { value: '', label: esAlta ? 'Selecciona una modalidad' : 'Sin cambio' },
                  ...(Object.entries(MODALIDAD_LABEL) as [ModalidadCarrera, string][]).map(
                    ([value, label]) => ({ value, label }),
                  ),
                ]}
                placeholder={esAlta ? 'Selecciona una modalidad' : 'Sin cambio'}
              />
            </div>
            {!esAlta && (
              <div>
                <label htmlFor="carrera-modal-estatus" className={LABEL_CLASS}>
                  Estatus
                </label>
                <Select
                  id="carrera-modal-estatus"
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
            )}
            <div className="sm:col-span-2">
              <label htmlFor="carrera-modal-descripcion" className={LABEL_CLASS}>
                Descripción
              </label>
              <textarea
                id="carrera-modal-descripcion"
                rows={3}
                required={esAlta}
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
              {guardando ? 'Guardando…' : esAlta ? 'Crear carrera' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
