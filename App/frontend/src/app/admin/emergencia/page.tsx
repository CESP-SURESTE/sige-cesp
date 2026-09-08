'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '@/lib/api/http';
import {
  buscarEmergencia,
  obtenerExpedienteEmergencia,
  type ResultadoBusquedaEmergencia,
} from '@/lib/api/emergencia';
import { ExpedientePanel } from './ExpedientePanel';

const TIPO_CHIP: Record<string, string> = {
  ALUMNO: 'Alumno',
  MAESTRO: 'Maestro',
  ADMINISTRATIVO: 'Administrativo',
  PERSONAL_SERVICIOS: 'Personal de servicios',
};

export default function AdminEmergenciaPage() {
  const [texto, setTexto] = useState('');
  const [seleccion, setSeleccion] = useState<ResultadoBusquedaEmergencia | null>(null);

  const termino = texto.trim();

  const busquedaQuery = useQuery({
    queryKey: ['admin', 'emergencia', 'buscar', termino],
    queryFn: async () => {
      try {
        return await buscarEmergencia(termino);
      } catch (err) {
        console.error('[AdminEmergenciaPage] Error al buscar:', err);
        throw err;
      }
    },
    enabled: termino.length >= 2,
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
  });

  return (
    <div className="space-y-6">
      <div className="rounded-lg border-l-4 border-crimson bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-crimson">Emergencia</h1>
        <p className="mt-1 text-sm text-slate/60">
          Busca a cualquier integrante de tu sede y consulta sus datos médicos y
          contactos de emergencia. Cada consulta queda registrada.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
        {/* Buscador */}
        <div className="space-y-3">
          <input
            type="search"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
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
                  <span className="block truncate text-xs text-slate/60">{r.referencia}</span>
                </span>
                <span className="ml-2 shrink-0 rounded-full bg-mist/60 px-2 py-0.5 text-xs text-slate/70">
                  {TIPO_CHIP[r.tipo]}
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
    </div>
  );
}
