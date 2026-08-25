'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
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
import { SalonModal } from './SalonModal';

/**
 * Gestión de salones — Fase 9, CRUD completo de `Salon` (Task 2, frontend).
 * Backend cerrado en Task 1 (`POST`/`PATCH`/`DELETE /salones`, `GET
 * /salones` ya existía desde Día 29) — ver `CLAUDE.md` raíz para el
 * contrato exacto.
 *
 * Patrón visual/estructura calcado de `app/admin/carreras/page.tsx` (header
 * con botón "+ Nuevo salón" + tabla abajo, mismas clases Tailwind, mismos
 * estados isLoading/isError/vacío). El modal de confirmación de borrado
 * (`ConfirmarEliminarSalonModal`) es copia estructural de
 * `app/plataforma/sedes/ConfirmarEliminarSedeModal.tsx`, código propio, sin
 * import cruzado (árbol de identidad distinta).
 *
 * `resolverMensajeError` ya hace passthrough del mensaje real del backend
 * para `CONFLICT` (ver `mensajes-error.ts`) — el mensaje de
 * `DELETE /salones/:id` bloqueado ya viene armado con la cantidad de grupos
 * asociados, así que no hace falta reformularlo acá.
 *
 * ACTUALIZADO (2026-08-25): unificación de alta+edición en un solo modal
 * (`SalonModal`, Task 1 de la unificación de CRUD admin — regla 13 ampliada
 * de `CLAUDE.md` raíz), mismo criterio que `carreras/page.tsx`. El form
 * fijo de "Nuevo salón" desapareció — un botón "+ Nuevo salón" abre
 * `SalonModal` en modo alta (`salon: null`), el botón "Editar" de la tabla
 * lo abre en modo edición (`salon` prellenado).
 */

const MENSAJES_ERROR_SALON: Record<string, string> = {
  NOT_FOUND: 'Ese salón ya no existe o no pertenece a tu sede.',
};

/** Estado del modal único de alta/edición — `salon: null` es modo alta explícito. */
interface EstadoModalSalon {
  abierto: boolean;
  salon: Salon | null;
}

const MODAL_CERRADO: EstadoModalSalon = { abierto: false, salon: null };

export default function AdminSalonesPage() {
  const queryClient = useQueryClient();
  const [modalSalon, setModalSalon] = useState<EstadoModalSalon>(MODAL_CERRADO);
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
      setModalSalon(MODAL_CERRADO);
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
      setModalSalon(MODAL_CERRADO);
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
      if (modalSalon.salon?.id === id) setModalSalon(MODAL_CERRADO);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'salones'] });
    },
    onError: (err) => {
      console.error('[AdminSalonesPage] Error al eliminar salón:', err);
      toast.error(resolverMensajeError(err, MENSAJES_ERROR_SALON) ?? MENSAJE_ERROR_GENERICO);
      setSalonAEliminar(null);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <div>
          <h1 className="font-display text-2xl font-semibold text-navy">Salones</h1>
          <p className="mt-1 text-sm text-slate/60">
            Alta y edición de los salones de tu sede.
          </p>
        </div>
        <button
          onClick={() => setModalSalon({ abierto: true, salon: null })}
          className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
        >
          + Nuevo salón
        </button>
      </div>

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
                    onClick={() => setModalSalon({ abierto: true, salon })}
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

      {modalSalon.abierto && (
        <SalonModal
          salon={modalSalon.salon}
          guardando={crearMutation.isPending || actualizarMutation.isPending}
          onCrear={(payload) => crearMutation.mutate(payload)}
          onEditar={(payload) => {
            const salonId = modalSalon.salon?.id;
            if (!salonId) return;
            actualizarMutation.mutate({ id: salonId, input: payload });
          }}
          onCancelar={() => setModalSalon(MODAL_CERRADO)}
        />
      )}
    </div>
  );
}
