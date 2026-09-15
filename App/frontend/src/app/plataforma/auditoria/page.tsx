'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ACCIONES_AUDITORIA,
  ENTIDADES_AUDITABLES,
  listarAuditoria,
  type AccionAuditoria,
  type FiltrosAuditoria,
  type RegistroAuditoriaItem,
} from '@/lib/api/auditoria-plataforma';
import { ApiError } from '@/lib/api/http';
import { getPlatformToken } from '@/lib/api/platform-http';
import { listarSedes } from '@/lib/api/sedes';
import { PlataformaNav } from '../PlataformaNav';
import { SkeletonTableRows } from '../Skeleton';
import { DetalleAuditoriaModal } from './DetalleAuditoriaModal';

const FILTROS_INICIALES: FiltrosAuditoria = { page: 1, limit: 20 };

const ACCION_CLASE: Record<AccionAuditoria, string> = {
  ALTA: 'bg-green-100 text-green-800',
  EDICION: 'bg-navy/10 text-navy',
  CAMBIO_PERMISO: 'bg-navy/10 text-navy',
  CAMBIO_ESTATUS: 'bg-navy/10 text-navy',
  BAJA: 'bg-crimson/10 text-crimson',
  ELIMINACION: 'bg-crimson/10 text-crimson',
  CONSULTA_EMERGENCIA: 'bg-amber-100 text-amber-800',
};

export default function PlataformaAuditoriaPage() {
  const router = useRouter();
  const [filtros, setFiltros] = useState<FiltrosAuditoria>(FILTROS_INICIALES);
  const [detalle, setDetalle] = useState<RegistroAuditoriaItem | null>(null);
  const [actorNombre, setActorNombre] = useState<string | null>(null);

  useEffect(() => {
    if (!getPlatformToken()) router.replace('/plataforma/login');
  }, [router]);

  const sedesQuery = useQuery({
    queryKey: ['plataforma', 'sedes'],
    queryFn: async () => {
      try {
        return await listarSedes();
      } catch (err) {
        console.error('[PlataformaAuditoriaPage] Error al listar sedes:', err);
        throw err;
      }
    },
  });

  const auditoriaQuery = useQuery({
    queryKey: ['plataforma', 'auditoria', filtros],
    queryFn: async () => {
      try {
        return await listarAuditoria(filtros);
      } catch (err) {
        console.error('[PlataformaAuditoriaPage] Error al listar auditoría:', err);
        throw err;
      }
    },
  });

  function setFiltro<K extends keyof FiltrosAuditoria>(
    clave: K,
    valor: FiltrosAuditoria[K],
  ) {
    setFiltros((f) => ({ ...f, [clave]: valor || undefined, page: 1 }));
  }

  function limpiar() {
    setFiltros(FILTROS_INICIALES);
    setActorNombre(null);
  }

  const data = auditoriaQuery.data;
  const totalPaginas = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const page = filtros.page ?? 1;

  return (
    <main className="mx-auto max-w-4xl p-8">
      <PlataformaNav activo="auditoria" titulo="Auditoría" />

      {/* Barra de filtros */}
      <div className="mt-6 grid grid-cols-1 gap-3 rounded-lg border-l-4 border-navy bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">
          <span className="text-slate/60">Sede</span>
          <select
            value={filtros.sedeId ?? ''}
            onChange={(e) => setFiltro('sedeId', e.target.value)}
            className="mt-1 w-full rounded border border-mist px-2 py-1.5 text-sm"
          >
            <option value="">Todas las sedes</option>
            {sedesQuery.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="text-slate/60">Acción</span>
          <select
            value={filtros.accion ?? ''}
            onChange={(e) => setFiltro('accion', e.target.value as AccionAuditoria)}
            className="mt-1 w-full rounded border border-mist px-2 py-1.5 text-sm"
          >
            <option value="">Todas</option>
            {ACCIONES_AUDITORIA.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="text-slate/60">Entidad</span>
          <select
            value={filtros.entidad ?? ''}
            onChange={(e) => setFiltro('entidad', e.target.value)}
            className="mt-1 w-full rounded border border-mist px-2 py-1.5 text-sm"
          >
            <option value="">Todas</option>
            {ENTIDADES_AUDITABLES.map((en) => (
              <option key={en} value={en}>
                {en}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="text-slate/60">Desde</span>
          <input
            type="date"
            value={filtros.desde ?? ''}
            onChange={(e) => setFiltro('desde', e.target.value)}
            className="mt-1 w-full rounded border border-mist px-2 py-1.5 text-sm"
          />
        </label>

        <label className="text-sm">
          <span className="text-slate/60">Hasta</span>
          <input
            type="date"
            value={filtros.hasta ?? ''}
            onChange={(e) => setFiltro('hasta', e.target.value)}
            className="mt-1 w-full rounded border border-mist px-2 py-1.5 text-sm"
          />
        </label>

        <div className="flex items-end gap-2">
          {actorNombre && (
            <span className="inline-flex items-center gap-1 rounded-full bg-navy/10 px-3 py-1 text-xs text-navy">
              Actor: {actorNombre}
              <button
                type="button"
                onClick={() => {
                  setActorNombre(null);
                  setFiltro('actorId', undefined);
                }}
                aria-label="Quitar filtro de actor"
              >
                ✕
              </button>
            </span>
          )}
          <button
            type="button"
            onClick={limpiar}
            className="rounded-lg border border-mist px-3 py-1.5 text-sm text-slate hover:bg-mist/30"
          >
            Limpiar filtros
          </button>
        </div>
      </div>

      {/* Tabla */}
      <div className="mt-6 overflow-x-auto rounded-lg border-l-4 border-navy bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-mist text-left text-slate/60">
              <th className="px-4 py-3 font-medium">Fecha</th>
              <th className="px-4 py-3 font-medium">Actor</th>
              <th className="px-4 py-3 font-medium">Acción</th>
              <th className="px-4 py-3 font-medium">Entidad</th>
              <th className="px-4 py-3 font-medium">Sede</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {auditoriaQuery.isLoading && <SkeletonTableRows columns={6} />}
            {auditoriaQuery.isError && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-crimson">
                  {auditoriaQuery.error instanceof ApiError
                    ? auditoriaQuery.error.message
                    : 'No se pudo cargar la bitácora. Intenta de nuevo más tarde.'}
                </td>
              </tr>
            )}
            {!auditoriaQuery.isLoading &&
              !auditoriaQuery.isError &&
              data?.data.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate/60">
                    No hay registros que coincidan con los filtros.
                  </td>
                </tr>
              )}
            {data?.data.map((r) => (
              <tr key={r.id} className="border-b border-mist last:border-0">
                <td className="px-4 py-3 whitespace-nowrap text-slate/80">
                  {new Date(r.fecha).toLocaleString('es-MX')}
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => {
                      setActorNombre(r.actor.nombre);
                      setFiltros((f) => ({ ...f, actorId: r.actor.id, page: 1 }));
                    }}
                    className="text-navy hover:underline"
                  >
                    {r.actor.nombre}
                  </button>
                  <span className="ml-2 rounded bg-mist/60 px-1.5 py-0.5 text-[10px] tracking-wide text-slate/70 uppercase">
                    {r.actor.tipo}
                  </span>
                  {r.actor.rol && (
                    <span className="block text-[11px] text-slate/50">{r.actor.rol}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ACCION_CLASE[r.accion]}`}>
                    {r.accion}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate">
                  {r.entidad}
                  <span className="block text-[11px] text-slate/50">
                    {r.entidadId.slice(0, 8)}…
                  </span>
                </td>
                <td className="px-4 py-3 text-slate/80">{r.sede?.nombre ?? '—'}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => setDetalle(r)}
                    className="text-navy hover:underline"
                  >
                    Ver detalle
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      {data && data.total > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate/70">
          <span>
            Página {page} de {totalPaginas} · {data.total} registros
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setFiltros((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
              className="rounded border border-mist px-3 py-1 disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={page >= totalPaginas}
              onClick={() => setFiltros((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
              className="rounded border border-mist px-3 py-1 disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}

      {detalle && (
        <DetalleAuditoriaModal registro={detalle} onCerrar={() => setDetalle(null)} />
      )}
    </main>
  );
}
