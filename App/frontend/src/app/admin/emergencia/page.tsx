'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  MENSAJE_ERROR_GENERICO,
  resolverMensajeError,
} from '@/components/admin/ui/persona-alta/mensajes-error';
import { SkeletonTableRows } from '@/components/admin/ui/Skeleton';
import { ApiError } from '@/lib/api/http';
import {
  actualizarTelefonoEmergencia,
  buscarEmergencia,
  crearTelefonoEmergencia,
  eliminarTelefonoEmergencia,
  listarTelefonosEmergencia,
  obtenerExpedienteEmergencia,
  type ActualizarTelefonoInput,
  type CrearTelefonoInput,
  type ResultadoBusquedaEmergencia,
  type TelefonoEmergencia,
} from '@/lib/api/emergencia';
import { ConfirmarEliminarTelefonoModal } from './ConfirmarEliminarTelefonoModal';
import { ExpedientePanel } from './ExpedientePanel';
import { humanizarReferencia, TIPO_ROL_LABEL } from './labels';
import { TelefonoModal } from './TelefonoModal';

/** Key del listado de teléfonos de emergencia de la sede — crear/editar/borrar
 * invalida esta query para refrescar la tabla. */
const TELEFONOS_QUERY_KEY = ['admin', 'emergencia', 'telefonos'] as const;

/** Estado del modal único de alta/edición — `telefono: null` es modo alta explícito. */
interface EstadoModalTelefono {
  abierto: boolean;
  telefono: TelefonoEmergencia | null;
}

const MODAL_CERRADO: EstadoModalTelefono = { abierto: false, telefono: null };

export default function AdminEmergenciaPage() {
  const queryClient = useQueryClient();
  const [texto, setTexto] = useState('');
  const [terminoBusqueda, setTerminoBusqueda] = useState('');
  const [seleccion, setSeleccion] = useState<ResultadoBusquedaEmergencia | null>(null);
  const [modalTelefono, setModalTelefono] = useState<EstadoModalTelefono>(MODAL_CERRADO);
  const [telefonoAEliminar, setTelefonoAEliminar] = useState<TelefonoEmergencia | null>(null);

  const termino = texto.trim();

  // Debounce ~300 ms (spec §Frontend/Zona 1): `terminoBusqueda` es lo único que
  // dispara `GET /emergencia/buscar`; `termino` (crudo) sólo alimenta el hint.
  useEffect(() => {
    const id = setTimeout(() => setTerminoBusqueda(termino), 300);
    return () => clearTimeout(id);
  }, [termino]);

  const busquedaQuery = useQuery({
    queryKey: ['admin', 'emergencia', 'buscar', terminoBusqueda],
    queryFn: async () => {
      try {
        return await buscarEmergencia(terminoBusqueda);
      } catch (err) {
        console.error('[AdminEmergenciaPage] Error al buscar:', err);
        throw err;
      }
    },
    enabled: terminoBusqueda.length >= 2,
  });

  const expedienteQuery = useQuery({
    queryKey: ['admin', 'emergencia', 'expediente', seleccion?.tipo, seleccion?.perfilId],
    queryFn: async () => {
      if (!seleccion) throw new Error('sin selección');
      try {
        return await obtenerExpedienteEmergencia(seleccion.tipo, seleccion.perfilId);
      } catch (err) {
        console.error('[AdminEmergenciaPage] Error al abrir expediente:', err);
        throw err;
      }
    },
    enabled: seleccion !== null,
    // `GET /emergencia/expediente/...` es el único GET del sistema que ESCRIBE
    // (una fila `RegistroAuditoria CONSULTA_EMERGENCIA` por llamada). Sin estas
    // 3 opciones, cada vuelta de foco a la pestaña duplicaría la auditoría.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const telefonosQuery = useQuery({
    queryKey: TELEFONOS_QUERY_KEY,
    queryFn: async () => {
      try {
        return await listarTelefonosEmergencia();
      } catch (err) {
        console.error('[AdminEmergenciaPage] Error al listar teléfonos:', err);
        throw err;
      }
    },
  });

  const crearTelefonoMutation = useMutation({
    mutationFn: (input: CrearTelefonoInput) => crearTelefonoEmergencia(input),
    onSuccess: () => {
      toast.success('Teléfono agregado');
      setModalTelefono(MODAL_CERRADO);
      void queryClient.invalidateQueries({ queryKey: TELEFONOS_QUERY_KEY });
    },
    onError: (err) => {
      console.error('[AdminEmergenciaPage] Error al crear teléfono:', err);
      toast.error(resolverMensajeError(err) ?? MENSAJE_ERROR_GENERICO);
    },
  });

  const actualizarTelefonoMutation = useMutation({
    mutationFn: (vars: { id: string; input: ActualizarTelefonoInput }) =>
      actualizarTelefonoEmergencia(vars.id, vars.input),
    onSuccess: () => {
      toast.success('Teléfono actualizado');
      setModalTelefono(MODAL_CERRADO);
      void queryClient.invalidateQueries({ queryKey: TELEFONOS_QUERY_KEY });
    },
    onError: (err) => {
      console.error('[AdminEmergenciaPage] Error al actualizar teléfono:', err);
      toast.error(resolverMensajeError(err) ?? MENSAJE_ERROR_GENERICO);
    },
  });

  const eliminarTelefonoMutation = useMutation({
    mutationFn: (id: string) => eliminarTelefonoEmergencia(id),
    onSuccess: (_data, id) => {
      toast.success('Teléfono eliminado');
      setTelefonoAEliminar(null);
      if (modalTelefono.telefono?.id === id) setModalTelefono(MODAL_CERRADO);
      void queryClient.invalidateQueries({ queryKey: TELEFONOS_QUERY_KEY });
    },
    onError: (err) => {
      console.error('[AdminEmergenciaPage] Error al eliminar teléfono:', err);
      toast.error(resolverMensajeError(err) ?? MENSAJE_ERROR_GENERICO);
      setTelefonoAEliminar(null);
    },
  });

  return (
    <div className="space-y-6">
      <div className="rounded-lg border-l-4 border-crimson bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-crimson">Emergencia</h1>
        <p className="mt-1 text-sm text-slate/60">
          Busca a cualquier integrante de tu sede y consulta sus datos médicos y
          contactos de emergencia. Abrir un expediente queda registrado.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
        {/* Buscador */}
        <div className="space-y-3">
          <input
            type="search"
            aria-label="Buscar integrante"
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              // Al cambiar la búsqueda, limpia la selección: el panel médico de
              // la persona anterior no debe quedar junto a resultados que ya no
              // la incluyen (seguridad de lectura).
              setSeleccion(null);
            }}
            placeholder="Nombre, apellido, matrícula o cédula…"
            className="w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none"
          />

          {termino.length > 0 && termino.length < 2 && (
            <p className="text-xs text-slate/50">Escribe al menos 2 letras.</p>
          )}

          <div className="space-y-1">
            {busquedaQuery.isLoading && (
              <p className="text-sm text-slate/60">Buscando…</p>
            )}
            {busquedaQuery.isError && (
              <p className="text-sm text-crimson">
                {busquedaQuery.error instanceof ApiError
                  ? busquedaQuery.error.message
                  : 'No se pudo completar la búsqueda.'}
              </p>
            )}
            {busquedaQuery.data?.length === 0 && (
              <p className="text-sm text-slate/60">Sin resultados.</p>
            )}
            {busquedaQuery.data?.map((r) => (
              <button
                key={`${r.tipo}-${r.perfilId}`}
                onClick={() => setSeleccion(r)}
                className={[
                  'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                  seleccion?.perfilId === r.perfilId && seleccion?.tipo === r.tipo
                    ? 'border-crimson bg-crimson/5'
                    : 'border-mist hover:bg-mist/30',
                ].join(' ')}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate">
                    {r.nombreCompleto}
                    {!r.activo && (
                      <span className="ml-2 text-xs font-normal text-slate/50">Inactivo</span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-slate/60">
                    {humanizarReferencia(r.tipo, r.referencia)}
                  </span>
                </span>
                <span className="ml-2 shrink-0 rounded-full bg-mist/60 px-2 py-0.5 text-xs text-slate/70">
                  {TIPO_ROL_LABEL[r.tipo]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Panel de expediente */}
        <div>
          {!seleccion && (
            <p className="rounded-lg border border-dashed border-mist p-6 text-sm text-slate/50">
              Selecciona una persona para ver su expediente de emergencia.
            </p>
          )}
          {seleccion && expedienteQuery.isLoading && (
            <p className="text-sm text-slate/60">Cargando expediente…</p>
          )}
          {seleccion && expedienteQuery.isError && (
            <p className="text-sm text-crimson">
              {expedienteQuery.error instanceof ApiError
                ? expedienteQuery.error.message
                : 'No se pudo abrir el expediente.'}
            </p>
          )}
          {expedienteQuery.data && <ExpedientePanel expediente={expedienteQuery.data} />}
        </div>
      </div>

      {/* Teléfonos de emergencia de la sede */}
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border-l-4 border-crimson bg-white p-6 shadow-sm">
          <div>
            <h2 className="font-display text-xl font-semibold text-crimson">
              Teléfonos de emergencia de la sede
            </h2>
            <p className="mt-1 text-sm text-slate/60">
              Números de contacto para emergencias en tu sede (911, Cruz Roja,
              bomberos, protección civil, hospital).
            </p>
          </div>
          <button
            onClick={() => setModalTelefono({ abierto: true, telefono: null })}
            className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
          >
            + Nuevo teléfono
          </button>
        </div>

        <div className="overflow-x-auto rounded-lg border-l-4 border-crimson bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-mist text-left text-slate/60">
                <th className="px-4 py-3 font-medium">Etiqueta</th>
                <th className="px-4 py-3 font-medium">Teléfono</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {telefonosQuery.isLoading && <SkeletonTableRows columns={3} />}
              {telefonosQuery.isError && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-crimson">
                    {telefonosQuery.error instanceof ApiError
                      ? telefonosQuery.error.message
                      : 'No se pudo cargar el listado de teléfonos. Intenta de nuevo más tarde.'}
                  </td>
                </tr>
              )}
              {!telefonosQuery.isLoading &&
                !telefonosQuery.isError &&
                telefonosQuery.data?.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-slate/60">
                      Todavía no hay teléfonos de emergencia registrados en tu sede.
                    </td>
                  </tr>
                )}
              {telefonosQuery.data?.map((telefono) => (
                <tr key={telefono.id} className="border-b border-mist last:border-0">
                  <td className="px-4 py-3 text-slate">{telefono.etiqueta}</td>
                  <td className="px-4 py-3 text-slate/80">
                    <a href={`tel:${telefono.telefono}`} className="hover:underline">
                      {telefono.telefono}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setModalTelefono({ abierto: true, telefono })}
                      className="text-navy hover:underline"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => setTelefonoAEliminar(telefono)}
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
      </div>

      {modalTelefono.abierto && (
        <TelefonoModal
          telefono={modalTelefono.telefono}
          guardando={
            crearTelefonoMutation.isPending || actualizarTelefonoMutation.isPending
          }
          onCrear={(payload) => crearTelefonoMutation.mutate(payload)}
          onEditar={(payload) => {
            const telefonoId = modalTelefono.telefono?.id;
            if (!telefonoId) return;
            actualizarTelefonoMutation.mutate({ id: telefonoId, input: payload });
          }}
          onCancelar={() => setModalTelefono(MODAL_CERRADO)}
        />
      )}

      {telefonoAEliminar && (
        <ConfirmarEliminarTelefonoModal
          telefono={telefonoAEliminar}
          eliminando={eliminarTelefonoMutation.isPending}
          onConfirmar={() => eliminarTelefonoMutation.mutate(telefonoAEliminar.id)}
          onCancelar={() => setTelefonoAEliminar(null)}
        />
      )}
    </div>
  );
}
