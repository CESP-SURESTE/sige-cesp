'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  MENSAJE_ERROR_GENERICO,
  resolverMensajeError,
} from '@/components/admin/ui/persona-alta/mensajes-error';
import { SubirMallaModal } from './SubirMallaModal';
import { CarreraModal } from './CarreraModal';
import { ApiError } from '@/lib/api/http';
import {
  actualizarCarrera,
  crearCarrera,
  listarCarreras,
  type ActualizarCarreraInput,
  type Carrera,
  type CrearCarreraInput,
} from '@/lib/api/carreras';

/**
 * Gestión de carreras — Fase 6, Día 21 (frontend). Backend ya cerrado por
 * QA (`qa-backend`, sin hallazgos bloqueantes) — ver la entrada "Día 21
 * (backend)" en `documentacion_de_agentes/ESTADO.md` para el contrato
 * exacto de `POST`/`GET`/`PATCH /carreras`.
 *
 * Patrón visual/estructura inspirado en `app/plataforma/sedes/page.tsx`
 * (tabla + form fijo de alta) — código propio, NO import desde
 * `app/plataforma/` (árbol completamente aislado, regla 11 de `CLAUDE.md`
 * raíz solo prohíbe compartir con alumno/maestro, pero por prudencia
 * tampoco se comparte con plataforma, que es una identidad distinta). Los
 * únicos imports desde fuera de esta página son utilidades genéricas ya
 * existentes en `components/admin/ui/persona-alta/` (`resolverMensajeError`,
 * etc.) — no son específicas de alta de persona, son helpers reutilizables
 * dentro del mismo árbol admin (regla 11 solo prohíbe cruzar con
 * alumno/maestro).
 *
 * ACTUALIZADO (2026-08-25): unificación de alta+edición en un solo modal
 * (`CarreraModal`, Task 1 de la unificación de CRUD admin — regla 13
 * ampliada de `CLAUDE.md` raíz). El form fijo de "Nueva carrera" desapareció
 * — un botón "+ Nueva carrera" abre `CarreraModal` en modo alta (`carrera:
 * null`), el botón "Editar" de la tabla lo abre en modo edición (`carrera`
 * prellenado). `PATCH /carreras/:id` sigue siendo parcial por diseño
 * (campos vacíos = sin cambio no se envían).
 */

const MENSAJES_ERROR_CARRERA: Record<string, string> = {
  NOT_FOUND: 'Esa carrera ya no existe o no pertenece a tu sede.',
};

/** Estado del modal único de alta/edición — `carrera: null` es modo alta explícito. */
interface EstadoModalCarrera {
  abierto: boolean;
  carrera: Carrera | null;
}

const MODAL_CERRADO: EstadoModalCarrera = { abierto: false, carrera: null };

export default function AdminCarrerasPage() {
  const queryClient = useQueryClient();
  const [modalCarrera, setModalCarrera] = useState<EstadoModalCarrera>(MODAL_CERRADO);
  const [carreraParaMalla, setCarreraParaMalla] = useState<Carrera | null>(null);

  const carrerasQuery = useQuery({
    queryKey: ['admin', 'carreras'],
    queryFn: async () => {
      try {
        return await listarCarreras();
      } catch (err) {
        // Regla 12 de `CLAUDE.md` raíz — loguear antes de dejar que React
        // Query marque `isError`.
        console.error('[AdminCarrerasPage] Error al listar carreras:', err);
        throw err;
      }
    },
  });

  const crearMutation = useMutation({
    mutationFn: (input: CrearCarreraInput) => crearCarrera(input),
    onSuccess: () => {
      toast.success('Carrera creada');
      setModalCarrera(MODAL_CERRADO);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'carreras'] });
      // También invalida la caché del dropdown de `carreraId` que usa
      // `app/admin/alumnos/nuevo/page.tsx` (`queryKey: ['carreras']`,
      // `lib/api/carreras.ts#listarCarreras`) — misma función, distinto
      // `queryKey` en cada consumidor, así que hay que invalidar ambas
      // explícitamente para que la carrera recién creada aparezca ahí sin
      // recargar la página.
      void queryClient.invalidateQueries({ queryKey: ['carreras'] });
    },
    onError: (err) => {
      console.error('[AdminCarrerasPage] Error al crear carrera:', err);
      toast.error(resolverMensajeError(err, MENSAJES_ERROR_CARRERA) ?? MENSAJE_ERROR_GENERICO);
    },
  });

  const actualizarMutation = useMutation({
    mutationFn: (vars: { id: string; input: ActualizarCarreraInput }) =>
      actualizarCarrera(vars.id, vars.input),
    onSuccess: () => {
      toast.success('Carrera actualizada');
      setModalCarrera(MODAL_CERRADO);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'carreras'] });
      void queryClient.invalidateQueries({ queryKey: ['carreras'] });
    },
    onError: (err) => {
      console.error('[AdminCarrerasPage] Error al actualizar carrera:', err);
      toast.error(resolverMensajeError(err, MENSAJES_ERROR_CARRERA) ?? MENSAJE_ERROR_GENERICO);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <div>
          <h1 className="font-display text-2xl font-semibold text-navy">Carreras</h1>
          <p className="mt-1 text-sm text-slate/60">
            Alta y edición de las carreras de tu sede.
          </p>
        </div>
        <button
          onClick={() => setModalCarrera({ abierto: true, carrera: null })}
          className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
        >
          + Nueva carrera
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border-l-4 border-navy bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-mist text-left text-slate/60">
              <th className="px-4 py-3 font-medium">Nombre</th>
              <th className="px-4 py-3 font-medium">Clave</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {carrerasQuery.isLoading && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-slate/60">
                  Cargando…
                </td>
              </tr>
            )}
            {carrerasQuery.isError && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-crimson">
                  {carrerasQuery.error instanceof ApiError
                    ? carrerasQuery.error.message
                    : 'No se pudo cargar el listado de carreras. Intenta de nuevo más tarde.'}
                </td>
              </tr>
            )}
            {!carrerasQuery.isLoading &&
              !carrerasQuery.isError &&
              carrerasQuery.data?.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-slate/60">
                    Todavía no hay carreras registradas en tu sede.
                  </td>
                </tr>
              )}
            {carrerasQuery.data?.map((carrera) => (
              <tr key={carrera.id} className="border-b border-mist last:border-0">
                <td className="px-4 py-3 text-slate">{carrera.nombre}</td>
                <td className="px-4 py-3 text-slate/80">{carrera.clave}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => setCarreraParaMalla(carrera)}
                    className="mr-4 text-navy hover:underline"
                  >
                    {carrera.tieneMalla && (
                      <span className="mr-1 text-success">✓</span>
                    )}
                    Subir malla
                  </button>
                  <button
                    onClick={() => setModalCarrera({ abierto: true, carrera })}
                    className="text-navy hover:underline"
                  >
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {carreraParaMalla && (
        <SubirMallaModal
          carrera={carreraParaMalla}
          onClose={() => setCarreraParaMalla(null)}
          onSubidoConExito={() => {
            toast.success('Malla curricular actualizada');
            void queryClient.invalidateQueries({ queryKey: ['admin', 'carreras'] });
          }}
        />
      )}

      {modalCarrera.abierto && (
        <CarreraModal
          carrera={modalCarrera.carrera}
          guardando={crearMutation.isPending || actualizarMutation.isPending}
          onCrear={(payload) => crearMutation.mutate(payload)}
          onEditar={(payload) => {
            const carreraId = modalCarrera.carrera?.id;
            if (!carreraId) return;
            actualizarMutation.mutate({ id: carreraId, input: payload });
          }}
          onCancelar={() => setModalCarrera(MODAL_CERRADO)}
        />
      )}
    </div>
  );
}
