'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  MENSAJE_ERROR_GENERICO,
  resolverMensajeError,
} from '@/components/admin/ui/persona-alta/mensajes-error';
import { Paginacion } from '@/components/admin/ui/personas-listado/Paginacion';
import { SkeletonTableRows } from '@/components/admin/ui/Skeleton';
import { ApiError } from '@/lib/api/http';
import {
  eliminarAviso,
  listarAvisosPublicados,
  obtenerFeedAvisos,
  type AlcanceTipoAviso,
  type AvisoPublicadoItem,
} from '@/lib/api/avisos';
import { ConfirmarEliminarAvisoModal } from './ConfirmarEliminarAvisoModal';
import { DetalleAvisoModal } from './DetalleAvisoModal';
import { NuevoAvisoModal } from './NuevoAvisoModal';
import { RecibosModal } from './RecibosModal';

/**
 * Gestión de avisos — Fase 16, Días 47-48 (frontend). Backend cerrado en
 * Días 45-46 (`POST`/`GET /avisos`, `GET /avisos/:id`,
 * `GET /avisos/:id/recibos`, `DELETE /avisos/:id`) + `GET /avisos/publicados`
 * (Día 47) — ver `CLAUDE.md` raíz, "Contrato de API", para los shapes.
 *
 * Dos tabs: "Publicados" (los que el actor mandó, con recibos de lectura) y
 * "Recibidos" (el feed de avisos que le llegaron). Patrón de tabla +
 * paginación + botón "+ Nuevo aviso" que abre modal, calcado de
 * `app/admin/grupos/page.tsx` (regla 13 de `CLAUDE.md` raíz). Modales
 * locales a esta ruta, sin componente compartido (regla 11).
 */

const LIMIT = 20;

const PREFIJO_ALCANCE: Record<AlcanceTipoAviso, string> = {
  SEDE: '',
  CARRERA: 'Carrera: ',
  GRUPO: 'Grupo: ',
};

function formatearFechaHora(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return iso;
  return fecha.toLocaleString('es-MX');
}

export default function AdminAvisosPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'publicados' | 'recibidos'>('publicados');
  const [pagePub, setPagePub] = useState(1);
  const [pageRec, setPageRec] = useState(1);
  const [modalNuevo, setModalNuevo] = useState(false);
  const [recibosDe, setRecibosDe] = useState<AvisoPublicadoItem | null>(null);
  const [avisoAEliminar, setAvisoAEliminar] = useState<AvisoPublicadoItem | null>(null);
  const [detalleId, setDetalleId] = useState<string | null>(null);

  const publicadosQuery = useQuery({
    queryKey: ['admin', 'avisos', 'publicados', pagePub],
    queryFn: async () => {
      try {
        return await listarAvisosPublicados({ page: pagePub, limit: LIMIT });
      } catch (err) {
        console.error('[AdminAvisos] publicados:', err);
        throw err;
      }
    },
    placeholderData: keepPreviousData,
  });

  const recibidosQuery = useQuery({
    queryKey: ['admin', 'avisos', 'feed', pageRec],
    queryFn: async () => {
      try {
        return await obtenerFeedAvisos({ page: pageRec, limit: LIMIT });
      } catch (err) {
        console.error('[AdminAvisos] feed:', err);
        throw err;
      }
    },
    placeholderData: keepPreviousData,
  });

  const eliminarMutation = useMutation({
    mutationFn: (id: string) => eliminarAviso(id),
    onSuccess: () => {
      toast.success('Aviso eliminado');
      setAvisoAEliminar(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'avisos', 'publicados'] });
    },
    onError: (err) => {
      console.error('[AdminAvisos] eliminar:', err);
      toast.error(resolverMensajeError(err) ?? MENSAJE_ERROR_GENERICO);
      setAvisoAEliminar(null);
    },
  });

  return (
    <div className="space-y-6">
      <div className="rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-navy">Avisos</h1>
        <p className="mt-1 text-sm text-slate/60">
          Publica avisos para tu sede, una carrera o un grupo, y revisa quién
          los ha leído.
        </p>
      </div>

      <div className="flex gap-6 border-b border-mist">
        <button
          type="button"
          onClick={() => setTab('publicados')}
          className={[
            'pb-2 text-sm font-medium transition-colors',
            tab === 'publicados'
              ? 'border-b-2 border-navy text-navy'
              : 'text-slate/60 hover:text-slate',
          ].join(' ')}
        >
          Publicados
        </button>
        <button
          type="button"
          onClick={() => setTab('recibidos')}
          className={[
            'pb-2 text-sm font-medium transition-colors',
            tab === 'recibidos'
              ? 'border-b-2 border-navy text-navy'
              : 'text-slate/60 hover:text-slate',
          ].join(' ')}
        >
          Recibidos
        </button>
      </div>

      {tab === 'publicados' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setModalNuevo(true)}
              className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
            >
              + Nuevo aviso
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border-l-4 border-navy bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-mist text-left text-slate/60">
                  <th className="px-4 py-3 font-medium">Título</th>
                  <th className="px-4 py-3 font-medium">Alcance</th>
                  <th className="px-4 py-3 font-medium">Fecha</th>
                  <th className="px-4 py-3 font-medium">Leídos</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {publicadosQuery.isLoading && <SkeletonTableRows columns={5} />}
                {publicadosQuery.isError && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-crimson">
                      {publicadosQuery.error instanceof ApiError
                        ? publicadosQuery.error.message
                        : 'No se pudo cargar el listado de avisos. Intenta de nuevo más tarde.'}
                    </td>
                  </tr>
                )}
                {!publicadosQuery.isLoading &&
                  !publicadosQuery.isError &&
                  publicadosQuery.data?.data.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-slate/60">
                        Todavía no has publicado avisos.
                      </td>
                    </tr>
                  )}
                {publicadosQuery.data?.data.map((row) => (
                  <tr key={row.id} className="border-b border-mist last:border-0">
                    <td className="px-4 py-3 text-slate">{row.titulo}</td>
                    <td className="px-4 py-3 text-slate/80">
                      {PREFIJO_ALCANCE[row.alcanceTipo]}
                      {row.alcanceNombre ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate/80">
                      {formatearFechaHora(row.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-slate/80">
                      {row.leidos} / {row.totalDestinatarios}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setRecibosDe(row)}
                        className="text-navy hover:underline"
                      >
                        Ver recibos
                      </button>
                      <button
                        type="button"
                        onClick={() => setAvisoAEliminar(row)}
                        className="ml-4 text-crimson hover:underline"
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {publicadosQuery.data && publicadosQuery.data.total > 0 && (
              <div className="px-4 py-3">
                <Paginacion
                  page={publicadosQuery.data.page}
                  limit={publicadosQuery.data.limit}
                  total={publicadosQuery.data.total}
                  onPageChange={setPagePub}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'recibidos' && (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-lg border-l-4 border-navy bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-mist text-left text-slate/60">
                  <th className="px-4 py-3 font-medium">Título</th>
                  <th className="px-4 py-3 font-medium">Autor</th>
                  <th className="px-4 py-3 font-medium">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {recibidosQuery.isLoading && <SkeletonTableRows columns={3} />}
                {recibidosQuery.isError && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-crimson">
                      {recibidosQuery.error instanceof ApiError
                        ? recibidosQuery.error.message
                        : 'No se pudo cargar el feed de avisos. Intenta de nuevo más tarde.'}
                    </td>
                  </tr>
                )}
                {!recibidosQuery.isLoading &&
                  !recibidosQuery.isError &&
                  recibidosQuery.data?.data.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-slate/60">
                        No has recibido avisos.
                      </td>
                    </tr>
                  )}
                {recibidosQuery.data?.data.map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-b border-mist last:border-0 hover:bg-mist/30"
                    onClick={() => setDetalleId(row.id)}
                  >
                    <td className="px-4 py-3 text-slate">
                      {row.titulo}
                      {row.leidoEn === null && (
                        <span className="ml-2 inline-block size-2 rounded-full bg-navy" />
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate/80">
                      {row.autor.nombres} {row.autor.apellidoPaterno}
                    </td>
                    <td className="px-4 py-3 text-slate/80">
                      {formatearFechaHora(row.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {recibidosQuery.data && recibidosQuery.data.total > 0 && (
              <div className="px-4 py-3">
                <Paginacion
                  page={recibidosQuery.data.page}
                  limit={recibidosQuery.data.limit}
                  total={recibidosQuery.data.total}
                  onPageChange={setPageRec}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {modalNuevo && (
        <NuevoAvisoModal
          onCerrar={() => setModalNuevo(false)}
          onPublicado={() => {
            setModalNuevo(false);
            void queryClient.invalidateQueries({
              queryKey: ['admin', 'avisos', 'publicados'],
            });
          }}
        />
      )}

      {recibosDe && (
        <RecibosModal
          avisoId={recibosDe.id}
          tituloAviso={recibosDe.titulo}
          onCerrar={() => setRecibosDe(null)}
        />
      )}

      {avisoAEliminar && (
        <ConfirmarEliminarAvisoModal
          titulo={avisoAEliminar.titulo}
          eliminando={eliminarMutation.isPending}
          onConfirmar={() => eliminarMutation.mutate(avisoAEliminar.id)}
          onCancelar={() => setAvisoAEliminar(null)}
        />
      )}

      {detalleId && (
        <DetalleAvisoModal
          avisoId={detalleId}
          onCerrar={() => {
            setDetalleId(null);
            void queryClient.invalidateQueries({ queryKey: ['admin', 'avisos', 'feed'] });
          }}
        />
      )}
    </div>
  );
}
