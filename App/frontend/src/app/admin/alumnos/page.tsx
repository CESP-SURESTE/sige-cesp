'use client';

import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { SkeletonTableRows } from '@/components/admin/ui/Skeleton';
import { ApiError } from '@/lib/api/http';
import {
  listarAlumnos,
  type EstatusAcademico,
  type PersonaListItemAlumno,
} from '@/lib/api/personas';
import { BuscadorFiltro } from '@/components/admin/ui/personas-listado/BuscadorFiltro';
import { Paginacion } from '@/components/admin/ui/personas-listado/Paginacion';
import { EstadoActivoBadge } from '@/components/admin/ui/personas-listado/EstadoActivoBadge';
import { useBuscarDebounced } from '@/components/admin/ui/personas-listado/useBuscarDebounced';
import { usePaginacionFiltrada } from '@/components/admin/ui/personas-listado/usePaginacionFiltrada';

/**
 * Listado de alumnos — Fase 5, Día 19.
 *
 * "Admin ve el listado de alumnos/maestros de su propia sede, y solo de su
 * sede" (roadmap) — consume `GET /personas?rol=ALUMNO&...`
 * (`lib/api/personas.ts`, `listarAlumnos`). `sedeId` nunca sale de acá: el
 * backend lo saca del JWT (`@SedeActual()`, regla 2 de `CLAUDE.md` raíz).
 *
 * Decisión de arquitectura (documentada, ver encargo): dos vistas separadas
 * (`/admin/alumnos` y `/admin/maestros`) en vez de una vista con selector de
 * rol — mismo criterio ya usado por el resto del árbol admin (`alumnos/nuevo`
 * vs `maestros/nuevo` vs `administrativos/nuevo`, cada rol su propia ruta),
 * más simple de tipar (columnas/enum de estatus distintos por rol) que un
 * componente genérico parametrizado.
 *
 * `keepPreviousData` (React Query v5) — al cambiar de página/filtro no se
 * muestra un parpadeo de loading completo, se mantienen los datos previos
 * mientras llega la nueva página (UX estándar de tablas paginadas).
 */
export default function AdminAlumnosPage() {
  const { inputValue, setInputValue, buscar } = useBuscarDebounced();
  const { estatus, setEstatus, page, setPage, limit } =
    usePaginacionFiltrada(buscar);

  const {
    data: resultado,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['admin', 'personas', 'ALUMNO', buscar, estatus, page, limit],
    queryFn: async () => {
      try {
        return await listarAlumnos({
          buscar: buscar || undefined,
          estatus: estatus || undefined,
          page,
          limit,
        });
      } catch (err) {
        // Regla 12 de `CLAUDE.md` raíz — loguear antes de dejar que React
        // Query marque `isError` y la UI muestre el mensaje genérico.
        console.error('[AdminAlumnosPage] Error al listar alumnos:', err);
        throw err;
      }
    },
    placeholderData: keepPreviousData,
  });

  return (
    <div className="rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-navy">Alumnos</h1>
        <Link
          href="/admin/alumnos/nuevo"
          className="inline-block rounded-lg bg-navy px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
        >
          Dar de alta un alumno
        </Link>
      </div>

      <div className="mt-6">
        <BuscadorFiltro
          buscarInput={inputValue}
          onBuscarChange={setInputValue}
          buscarPlaceholder="Nombre, apellido o matrícula…"
          estatus={estatus}
          onEstatusChange={setEstatus}
          estatusOptions={ESTATUS_ACADEMICO_OPTIONS}
        />
      </div>

      <div className="mt-6">
        {isLoading ? (
          <div className="overflow-x-auto rounded-lg border border-mist">
            <table className="min-w-full divide-y divide-mist text-sm">
              <thead className="bg-bone">
                <tr>
                  <Th>Nombre completo</Th>
                  <Th>Matrícula</Th>
                  <Th>Carrera</Th>
                  <Th>Cuatrimestre</Th>
                  <Th>Estatus académico</Th>
                  <Th>Cuenta</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mist">
                <SkeletonTableRows columns={6} />
              </tbody>
            </table>
          </div>
        ) : isError ? (
          <p className="rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-crimson">
            {error instanceof ApiError
              ? error.message
              : 'No se pudo cargar el listado de alumnos. Intenta de nuevo más tarde.'}
          </p>
        ) : !resultado || resultado.data.length === 0 ? (
          <p className="text-sm text-slate/60">
            No se encontraron alumnos con esos criterios.
          </p>
        ) : (
          <>
            <TablaAlumnos alumnos={resultado.data} />
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

function TablaAlumnos({ alumnos }: { alumnos: PersonaListItemAlumno[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-mist">
      <table className="min-w-full divide-y divide-mist text-sm">
        <thead className="bg-bone">
          <tr>
            <Th>Nombre completo</Th>
            <Th>Matrícula</Th>
            <Th>Carrera</Th>
            <Th>Cuatrimestre</Th>
            <Th>Estatus académico</Th>
            <Th>Cuenta</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-mist">
          {alumnos.map((alumno) => (
            <tr key={alumno.usuarioId}>
              <Td>
                {[alumno.nombres, alumno.apellidoPaterno, alumno.apellidoMaterno]
                  .filter(Boolean)
                  .join(' ')}
              </Td>
              <Td>{alumno.matricula}</Td>
              <Td>{alumno.carrera.nombre}</Td>
              <Td>{alumno.cuatrimestreActual}</Td>
              <Td>{ESTATUS_ACADEMICO_LABEL[alumno.estatusAcademico]}</Td>
              <Td>
                <EstadoActivoBadge activo={alumno.activo} />
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

const ESTATUS_ACADEMICO_LABEL: Record<EstatusAcademico, string> = {
  INSCRITO: 'Inscrito',
  BAJA_TEMPORAL: 'Baja temporal',
  BAJA_DEFINITIVA: 'Baja definitiva',
  EGRESADO: 'Egresado',
};

const ESTATUS_ACADEMICO_OPTIONS = (
  Object.entries(ESTATUS_ACADEMICO_LABEL) as Array<[EstatusAcademico, string]>
).map(([value, label]) => ({ value, label }));
