'use client';

import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/http';
import {
  listarMaestros,
  type EstatusEmpleado,
  type PersonaListItemMaestro,
} from '@/lib/api/personas';
import { BuscadorFiltro } from '@/components/admin/ui/personas-listado/BuscadorFiltro';
import { Paginacion } from '@/components/admin/ui/personas-listado/Paginacion';
import { EstadoActivoBadge } from '@/components/admin/ui/personas-listado/EstadoActivoBadge';
import { useBuscarDebounced } from '@/components/admin/ui/personas-listado/useBuscarDebounced';
import { usePaginacionFiltrada } from '@/components/admin/ui/personas-listado/usePaginacionFiltrada';

/**
 * Listado de maestros — Fase 5, Día 19.
 *
 * Mismo patrón que `app/admin/alumnos/page.tsx` (ver comentario de cabecera
 * ahí para el criterio de "dos vistas separadas en vez de un selector de
 * rol") — consume `GET /personas?rol=MAESTRO&...` (`lib/api/personas.ts`,
 * `listarMaestros`). Columnas propias de maestro (cédula profesional en vez
 * de matrícula/carrera/semestre) y enum de estatus propio (`EstatusEmpleado`
 * en vez de `EstatusAcademico`).
 */
export default function AdminMaestrosPage() {
  const { inputValue, setInputValue, buscar } = useBuscarDebounced();
  const { estatus, setEstatus, page, setPage, limit } =
    usePaginacionFiltrada(buscar);

  const {
    data: resultado,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['admin', 'personas', 'MAESTRO', buscar, estatus, page, limit],
    queryFn: async () => {
      try {
        return await listarMaestros({
          buscar: buscar || undefined,
          estatus: estatus || undefined,
          page,
          limit,
        });
      } catch (err) {
        // Regla 12 de `CLAUDE.md` raíz — loguear antes de dejar que React
        // Query marque `isError` y la UI muestre el mensaje genérico.
        console.error('[AdminMaestrosPage] Error al listar maestros:', err);
        throw err;
      }
    },
    placeholderData: keepPreviousData,
  });

  return (
    <div className="max-w-5xl rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-navy">Maestros</h1>
        <Link
          href="/admin/maestros/nuevo"
          className="inline-block rounded-lg bg-navy px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
        >
          Dar de alta un maestro
        </Link>
      </div>

      <div className="mt-6">
        <BuscadorFiltro
          buscarInput={inputValue}
          onBuscarChange={setInputValue}
          buscarPlaceholder="Nombre, apellido o cédula profesional…"
          estatus={estatus}
          onEstatusChange={setEstatus}
          estatusOptions={ESTATUS_EMPLEADO_OPTIONS}
        />
      </div>

      <div className="mt-6">
        {isLoading ? (
          <p className="text-sm text-slate/60">Cargando…</p>
        ) : isError ? (
          <p className="rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-crimson">
            {error instanceof ApiError
              ? error.message
              : 'No se pudo cargar el listado de maestros. Intenta de nuevo más tarde.'}
          </p>
        ) : !resultado || resultado.data.length === 0 ? (
          <p className="text-sm text-slate/60">
            No se encontraron maestros con esos criterios.
          </p>
        ) : (
          <>
            <TablaMaestros maestros={resultado.data} />
            <div className="mt-4">
              <Paginacion
                page={resultado.page}
                limit={resultado.limit}
                total={resultado.total}
                onPageChange={setPage}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TablaMaestros({ maestros }: { maestros: PersonaListItemMaestro[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-mist">
      <table className="min-w-full divide-y divide-mist text-sm">
        <thead className="bg-bone">
          <tr>
            <Th>Nombre completo</Th>
            <Th>Cédula profesional</Th>
            <Th>Estatus</Th>
            <Th>Cuenta</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-mist">
          {maestros.map((maestro) => (
            <tr key={maestro.usuarioId}>
              <Td>
                {[maestro.nombres, maestro.apellidoPaterno, maestro.apellidoMaterno]
                  .filter(Boolean)
                  .join(' ')}
              </Td>
              <Td>{maestro.cedulaProfesional || '—'}</Td>
              <Td>{ESTATUS_EMPLEADO_LABEL[maestro.estatus]}</Td>
              <Td>
                <EstadoActivoBadge activo={maestro.activo} />
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2 text-left text-xs font-semibold tracking-wide text-slate/60 uppercase">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 text-slate">{children}</td>;
}

const ESTATUS_EMPLEADO_LABEL: Record<EstatusEmpleado, string> = {
  ACTIVO: 'Activo',
  BAJA: 'Baja',
  LICENCIA: 'Licencia',
};

const ESTATUS_EMPLEADO_OPTIONS = (
  Object.entries(ESTATUS_EMPLEADO_LABEL) as Array<[EstatusEmpleado, string]>
).map(([value, label]) => ({ value, label }));
