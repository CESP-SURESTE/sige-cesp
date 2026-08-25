'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { INPUT_CLASS, LABEL_CLASS } from '@/components/admin/ui/persona-alta/estilos';
import {
  MENSAJE_ERROR_GENERICO,
  resolverMensajeError,
} from '@/components/admin/ui/persona-alta/mensajes-error';
import { ApiError } from '@/lib/api/http';
import {
  actualizarSalon,
  crearSalon,
  eliminarSalon,
  listarSalones,
  type Salon,
  type SalonInput,
} from '@/lib/api/salones';
import { ConfirmarEliminarSalonModal } from './ConfirmarEliminarSalonModal';

/**
 * Gestión de salones — Fase 9, CRUD completo de `Salon` (Task 2, frontend).
 * Backend cerrado en Task 1 (`POST`/`PATCH`/`DELETE /salones`, `GET
 * /salones` ya existía desde Día 29) — ver `CLAUDE.md` raíz para el
 * contrato exacto.
 *
 * Patrón visual/estructura calcado de `app/admin/carreras/page.tsx` (card de
 * form arriba + tabla abajo, un solo `useState` de formulario que alterna
 * "nuevo"/"editar" según `editandoId`, mismas clases Tailwind, mismos
 * estados isLoading/isError/vacío). El modal de confirmación de borrado
 * (`ConfirmarEliminarSalonModal`) es copia estructural de
 * `app/plataforma/sedes/ConfirmarEliminarSedeModal.tsx`, código propio, sin
 * import cruzado (árbol de identidad distinta).
 *
 * `resolverMensajeError` ya hace passthrough del mensaje real del backend
 * para `CONFLICT` (ver `mensajes-error.ts`) — el mensaje de
 * `DELETE /salones/:id` bloqueado ya viene armado con la cantidad de grupos
 * asociados, así que no hace falta reformularlo acá.
 */

const MENSAJES_ERROR_SALON: Record<string, string> = {
  NOT_FOUND: 'Ese salón ya no existe o no pertenece a tu sede.',
};

interface FormSalon {
  nombre: string;
  capacidad: string;
}

const FORM_VACIO: FormSalon = { nombre: '', capacidad: '' };

function construirPayloadAlta(form: FormSalon): SalonInput | null {
  if (!form.nombre.trim() || !form.capacidad.trim()) return null;

  const capacidad = Number.parseInt(form.capacidad, 10);
  if (!Number.isInteger(capacidad) || capacidad < 1) return null;

  return { nombre: form.nombre.trim(), capacidad };
}

/** Solo incluye en el `PATCH` los campos que el admin sí llenó — en blanco = sin cambio. */
function construirPayloadEdicion(form: FormSalon): Partial<SalonInput> {
  const payload: Partial<SalonInput> = {};

  if (form.nombre.trim()) payload.nombre = form.nombre.trim();
  if (form.capacidad.trim()) {
    const capacidad = Number.parseInt(form.capacidad, 10);
    if (Number.isInteger(capacidad) && capacidad >= 1) payload.capacidad = capacidad;
  }

  return payload;
}

export default function AdminSalonesPage() {
  const queryClient = useQueryClient();
  const [formNuevo, setFormNuevo] = useState<FormSalon>(FORM_VACIO);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [formEdicion, setFormEdicion] = useState<FormSalon>(FORM_VACIO);
  const [salonAEliminar, setSalonAEliminar] = useState<Salon | null>(null);

  const salonesQuery = useQuery({
    queryKey: ['admin', 'salones'],
    queryFn: async () => {
      try {
        return await listarSalones();
      } catch (err) {
        // Regla 12 de `CLAUDE.md` raíz — loguear antes de dejar que React
        // Query marque `isError`.
        console.error('[AdminSalonesPage] Error al listar salones:', err);
        throw err;
      }
    },
  });

  const crearMutation = useMutation({
    mutationFn: (input: SalonInput) => crearSalon(input),
    onSuccess: () => {
      toast.success('Salón creado');
      setFormNuevo(FORM_VACIO);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'salones'] });
    },
    onError: (err) => {
      console.error('[AdminSalonesPage] Error al crear salón:', err);
      toast.error(resolverMensajeError(err, MENSAJES_ERROR_SALON) ?? MENSAJE_ERROR_GENERICO);
    },
  });

  const actualizarMutation = useMutation({
    mutationFn: (vars: { id: string; input: Partial<SalonInput> }) =>
      actualizarSalon(vars.id, vars.input),
    onSuccess: () => {
      toast.success('Salón actualizado');
      setEditandoId(null);
      setFormEdicion(FORM_VACIO);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'salones'] });
    },
    onError: (err) => {
      console.error('[AdminSalonesPage] Error al actualizar salón:', err);
      toast.error(resolverMensajeError(err, MENSAJES_ERROR_SALON) ?? MENSAJE_ERROR_GENERICO);
    },
  });

  const eliminarMutation = useMutation({
    mutationFn: (id: string) => eliminarSalon(id),
    onSuccess: (_data, id) => {
      toast.success('Salón eliminado');
      setSalonAEliminar(null);
      if (editandoId === id) {
        setEditandoId(null);
        setFormEdicion(FORM_VACIO);
      }
      void queryClient.invalidateQueries({ queryKey: ['admin', 'salones'] });
    },
    onError: (err) => {
      console.error('[AdminSalonesPage] Error al eliminar salón:', err);
      toast.error(resolverMensajeError(err, MENSAJES_ERROR_SALON) ?? MENSAJE_ERROR_GENERICO);
      setSalonAEliminar(null);
    },
  });

  function handleSubmitNuevo(e: FormEvent) {
    e.preventDefault();
    const payload = construirPayloadAlta(formNuevo);
    if (!payload) {
      toast.error('Revisa que todos los campos estén completos y con formato correcto.');
      return;
    }
    crearMutation.mutate(payload);
  }

  function handleSubmitEdicion(e: FormEvent) {
    e.preventDefault();
    if (!editandoId) return;
    const payload = construirPayloadEdicion(formEdicion);
    actualizarMutation.mutate({ id: editandoId, input: payload });
  }

  function iniciarEdicion(salon: Salon) {
    setEditandoId(salon.id);
    setFormEdicion({ nombre: salon.nombre, capacidad: String(salon.capacidad) });
  }

  function cancelarEdicion() {
    setEditandoId(null);
    setFormEdicion(FORM_VACIO);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-navy">Salones</h1>
        <p className="mt-1 text-sm text-slate/60">
          Alta y edición de los salones de tu sede.
        </p>
      </div>

      {editandoId ? (
        <form
          onSubmit={handleSubmitEdicion}
          className="space-y-4 rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm"
        >
          <h2 className="font-display text-lg font-semibold text-slate">Editar salón</h2>

          <CamposSalon
            form={formEdicion}
            onChange={(cambios) => setFormEdicion((f) => ({ ...f, ...cambios }))}
            disabled={actualizarMutation.isPending}
            requerido={false}
          />

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={actualizarMutation.isPending}
              className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
            >
              {actualizarMutation.isPending ? 'Guardando…' : 'Guardar cambios'}
            </button>
            <button
              type="button"
              onClick={cancelarEdicion}
              disabled={actualizarMutation.isPending}
              className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30 disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <form
          onSubmit={handleSubmitNuevo}
          className="space-y-4 rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm"
        >
          <h2 className="font-display text-lg font-semibold text-slate">Nuevo salón</h2>

          <CamposSalon
            form={formNuevo}
            onChange={(cambios) => setFormNuevo((f) => ({ ...f, ...cambios }))}
            disabled={crearMutation.isPending}
            requerido
          />

          <button
            type="submit"
            disabled={crearMutation.isPending}
            className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
          >
            {crearMutation.isPending ? 'Guardando…' : 'Crear salón'}
          </button>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border-l-4 border-navy bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-mist text-left text-slate/60">
              <th className="px-4 py-3 font-medium">Nombre</th>
              <th className="px-4 py-3 font-medium">Capacidad</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {salonesQuery.isLoading && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-slate/60">
                  Cargando…
                </td>
              </tr>
            )}
            {salonesQuery.isError && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-crimson">
                  {salonesQuery.error instanceof ApiError
                    ? salonesQuery.error.message
                    : 'No se pudo cargar el listado de salones. Intenta de nuevo más tarde.'}
                </td>
              </tr>
            )}
            {!salonesQuery.isLoading &&
              !salonesQuery.isError &&
              salonesQuery.data?.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-slate/60">
                    Todavía no hay salones registrados en tu sede.
                  </td>
                </tr>
              )}
            {salonesQuery.data?.map((salon) => (
              <tr key={salon.id} className="border-b border-mist last:border-0">
                <td className="px-4 py-3 text-slate">{salon.nombre}</td>
                <td className="px-4 py-3 text-slate/80">{salon.capacidad}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => iniciarEdicion(salon)}
                    className="text-navy hover:underline"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => setSalonAEliminar(salon)}
                    className="ml-4 text-crimson hover:underline"
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {salonAEliminar && (
        <ConfirmarEliminarSalonModal
          salon={salonAEliminar}
          eliminando={eliminarMutation.isPending}
          onConfirmar={() => eliminarMutation.mutate(salonAEliminar.id)}
          onCancelar={() => setSalonAEliminar(null)}
        />
      )}
    </div>
  );
}

/**
 * Campos comunes entre "Nuevo salón" y "Editar salón" — `requerido`
 * controla si se marcan como `required` (alta) o no (edición, en blanco =
 * sin cambio, mismo criterio que `CamposCarrera` en `carreras/page.tsx`).
 */
function CamposSalon({
  form,
  onChange,
  disabled,
  requerido,
}: {
  form: FormSalon;
  onChange: (cambios: Partial<FormSalon>) => void;
  disabled: boolean;
  requerido: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor="nombre" className={LABEL_CLASS}>
          Nombre
        </label>
        <input
          id="nombre"
          type="text"
          required={requerido}
          disabled={disabled}
          className={INPUT_CLASS}
          value={form.nombre}
          onChange={(e) => onChange({ nombre: e.target.value })}
        />
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
          required={requerido}
          disabled={disabled}
          className={INPUT_CLASS}
          value={form.capacidad}
          onChange={(e) => onChange({ capacidad: e.target.value })}
        />
      </div>
    </div>
  );
}
