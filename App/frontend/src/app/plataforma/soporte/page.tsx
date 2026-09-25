'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PlataformaNav } from '../PlataformaNav';
import {
  actualizarConfigSoportePlataforma,
  cambiarEstatusReporteBug,
  listarReportesBug,
  obtenerConfigSoportePlataforma,
} from '@/lib/api/soporte-plataforma';

const ESTATUS_LABEL: Record<string, string> = {
  NUEVO: 'Nuevo',
  EN_REVISION: 'En revisión',
  RESUELTO: 'Resuelto',
};

export default function SoportePlataformaPage() {
  const queryClient = useQueryClient();
  const [filtroEstatus, setFiltroEstatus] = useState<string>('');
  const [page, setPage] = useState(1);

  const configQuery = useQuery({
    queryKey: ['plataforma', 'soporte', 'config'],
    queryFn: obtenerConfigSoportePlataforma,
  });

  const toggleMutation = useMutation({
    mutationFn: (activo: boolean) => actualizarConfigSoportePlataforma(activo),
    onSuccess: (data) => {
      queryClient.setQueryData(['plataforma', 'soporte', 'config'], data);
    },
  });

  const reportesQuery = useQuery({
    queryKey: ['plataforma', 'soporte', 'reportes', filtroEstatus, page],
    queryFn: () =>
      listarReportesBug({
        estatus: filtroEstatus || undefined,
        page,
        limit: 20,
      }),
  });

  const estatusMutation = useMutation({
    mutationFn: ({ id, estatus }: { id: string; estatus: string }) =>
      cambiarEstatusReporteBug(id, estatus),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['plataforma', 'soporte', 'reportes'],
      });
    },
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PlataformaNav activo="soporte" titulo="Soporte" />

      <div className="mt-6 flex items-center justify-between rounded-xl border border-mist bg-white p-4">
        <div>
          <p className="text-sm font-medium text-slate">Bot de soporte</p>
          <p className="text-xs text-slate/60">
            Controla si el widget de ayuda/reporte de bugs aparece para administrativos y maestros.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={configQuery.data?.activo ?? false}
          disabled={configQuery.isLoading || toggleMutation.isPending}
          onClick={() => toggleMutation.mutate(!(configQuery.data?.activo ?? false))}
          className={`relative h-7 w-12 rounded-full transition-colors ${
            configQuery.data?.activo ? 'bg-navy' : 'bg-mist'
          }`}
        >
          <span
            className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              configQuery.data?.activo ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <label className="text-sm text-slate/70">Filtrar por estatus:</label>
        <select
          value={filtroEstatus}
          onChange={(e) => {
            setFiltroEstatus(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-mist px-3 py-1.5 text-sm"
        >
          <option value="">Todos</option>
          <option value="NUEVO">Nuevo</option>
          <option value="EN_REVISION">En revisión</option>
          <option value="RESUELTO">Resuelto</option>
        </select>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-mist bg-white">
        <table className="w-full text-sm">
          <thead className="bg-mist/30 text-left text-xs text-slate/60">
            <tr>
              <th className="px-4 py-2">Fecha</th>
              <th className="px-4 py-2">Sede</th>
              <th className="px-4 py-2">Reportó</th>
              <th className="px-4 py-2">Descripción</th>
              <th className="px-4 py-2">Captura</th>
              <th className="px-4 py-2">Estatus</th>
            </tr>
          </thead>
          <tbody>
            {reportesQuery.data?.data.map((r) => (
              <tr key={r.id} className="border-t border-mist">
                <td className="px-4 py-2 whitespace-nowrap text-slate/70">
                  {new Date(r.createdAt).toLocaleString('es-MX')}
                </td>
                <td className="px-4 py-2">{r.sede.nombre}</td>
                <td className="px-4 py-2">{r.reportante}</td>
                <td className="max-w-xs truncate px-4 py-2" title={r.descripcion}>
                  {r.descripcion}
                </td>
                <td className="px-4 py-2">
                  {r.capturaUrl ? (
                    <a
                      href={r.capturaUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-navy hover:underline"
                    >
                      Ver
                    </a>
                  ) : (
                    <span className="text-slate/40">—</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <select
                    value={r.estatus}
                    onChange={(e) =>
                      estatusMutation.mutate({ id: r.id, estatus: e.target.value })
                    }
                    className="rounded-lg border border-mist px-2 py-1 text-xs"
                  >
                    {Object.entries(ESTATUS_LABEL).map(([valor, label]) => (
                      <option key={valor} value={valor}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
            {reportesQuery.data?.data.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate/50">
                  Sin reportes{filtroEstatus ? ` con estatus "${ESTATUS_LABEL[filtroEstatus]}"` : ''}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {reportesQuery.data && reportesQuery.data.total > reportesQuery.data.limit && (
        <div className="mt-3 flex items-center justify-center gap-3 text-sm">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-lg border border-mist px-3 py-1 disabled:opacity-40"
          >
            Anterior
          </button>
          <span className="text-slate/60">Página {page}</span>
          <button
            disabled={page * reportesQuery.data.limit >= reportesQuery.data.total}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-mist px-3 py-1 disabled:opacity-40"
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}
