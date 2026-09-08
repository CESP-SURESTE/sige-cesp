'use client';

import Link from 'next/link';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { SkeletonTableRows } from '@/components/admin/ui/Skeleton';
import { ApiError } from '@/lib/api/http';
import {
  cambiarEstatusPersona,
  listarMaestros,
  type EstatusEmpleado,
  type MotivoBaja,
  type PersonaListItemMaestro,
  type TipoContratacion,
  type TipoLicencia,
} from '@/lib/api/personas';
import { BuscadorFiltro } from '@/components/admin/ui/personas-listado/BuscadorFiltro';
import { Paginacion } from '@/components/admin/ui/personas-listado/Paginacion';
import { EstadoActivoBadge } from '@/components/admin/ui/personas-listado/EstadoActivoBadge';
import { EstatusEmpleadoBadge } from '@/components/admin/ui/personas-listado/EstatusEmpleadoBadge';
import { CambiarEstatusModal } from '@/components/admin/ui/personas-listado/CambiarEstatusModal';
import { useBuscarDebounced } from '@/components/admin/ui/personas-listado/useBuscarDebounced';
import { usePaginacionFiltrada } from '@/components/admin/ui/personas-listado/usePaginacionFiltrada';

/**
 * Listado de maestros — Fase 5, Día 19; acción "Cambiar estatus" agregada en
 * paridad con administrativos (2026-08-27).
 *
 * Mismo patrón que `app/admin/administrativos/page.tsx` — mismo
 * `BuscadorFiltro`/`Paginacion`/`useBuscarDebounced`/`usePaginacionFiltrada`,
 * misma estructura de tabla, mismo `EstatusEmpleadoBadge` y
 * `CambiarEstatusModal` (compartidos en `components/admin/ui/personas-listado/`).
 *
 * A diferencia de administrativos, acá NO hay lógica de jerarquía de
 * `nivelPermiso` (es exclusivo de `PerfilAdministrativo`; el backend de
 * `PATCH /personas/:id/estatus` no corre ese chequeo para target MAESTRO) ni
 * de "ocultar el botón en la fila del actor" (un `ADMINISTRATIVO` nunca es un
 * `MAESTRO`). Cualquier `ADMINISTRATIVO` puede cambiar el estatus de
 * cualquier maestro de su sede.
 */
export default function AdminMaestrosPage() {
  const queryClient = useQueryClient();
  const { inputValue, setInputValue, buscar } = useBuscarDebounced();
  const { estatus, setEstatus, page, setPage, limit } =
    usePaginacionFiltrada(buscar);
  const [maestroAEditar, setMaestroAEditar] =
    useState<PersonaListItemMaestro | null>(null);

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

  const cambiarEstatusMutation = useMutation({
    mutationFn: (vars: {
      usuarioId: string;
      estatus: EstatusEmpleado;
      tipoLicencia?: TipoLicencia;
      motivoBaja?: MotivoBaja;
    }) =>
      cambiarEstatusPersona(vars.usuarioId, vars.estatus, {
        tipoLicencia: vars.tipoLicencia,
        motivoBaja: vars.motivoBaja,
      }),
    onSuccess: () => {
      toast.success('Estatus actualizado');
      setMaestroAEditar(null);
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'personas', 'MAESTRO'],
      });
    },
    onError: (err) => {
      // Regla 12 de `CLAUDE.md` raíz.
      console.error('[AdminMaestrosPage] Error al cambiar el estatus:', err);
      const mensaje =
        err instanceof ApiError
          ? err.message
          : 'No se pudo cambiar el estatus. Intenta de nuevo más tarde.';
      toast.error(mensaje);
    },
  });

  return (
    <div className="rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
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
          <div className="overflow-x-auto rounded-lg border border-mist">
            <table className="min-w-full divide-y divide-mist text-sm">
              <thead className="bg-bone">
                <tr>
                  <Th>Nombre completo</Th>
                  <Th>Cédula profesional</Th>
                  <Th>Contratación</Th>
                  <Th>Estatus</Th>
                  <Th>Cuenta</Th>
                  <Th>Acciones</Th>
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
              : 'No se pudo cargar el listado de maestros. Intenta de nuevo más tarde.'}
          </p>
        ) : !resultado || resultado.data.length === 0 ? (
          <p className="text-sm text-slate/60">
            No se encontraron maestros con esos criterios.
          </p>
        ) : (
          <>
            <TablaMaestros
              maestros={resultado.data}
              onCambiarEstatus={setMaestroAEditar}
            />
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

      {maestroAEditar && (
        <CambiarEstatusModal
          persona={maestroAEditar}
          guardando={cambiarEstatusMutation.isPending}
          onGuardar={(estatusNuevo, extra) =>
            cambiarEstatusMutation.mutate({
              usuarioId: maestroAEditar.usuarioId,
              estatus: estatusNuevo,
              ...extra,
            })
          }
          onCancelar={() => setMaestroAEditar(null)}
        />
      )}
    </div>
  );
}

function TablaMaestros({
  maestros,
  onCambiarEstatus,
}: {
  maestros: PersonaListItemMaestro[];
  onCambiarEstatus: (maestro: PersonaListItemMaestro) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-mist">
      <table className="min-w-full divide-y divide-mist text-sm">
        <thead className="bg-bone">
          <tr>
            <Th>Nombre completo</Th>
            <Th>Cédula profesional</Th>
            <Th>Contratación</Th>
            <Th>Estatus</Th>
            <Th>Cuenta</Th>
            <Th>Acciones</Th>
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
              <Td>{formatearContratacion(maestro)}</Td>
              <Td>
                <EstatusEmpleadoBadge
                  estatus={maestro.estatus}
                  tipoLicencia={maestro.tipoLicencia}
                />
              </Td>
              <Td>
                <EstadoActivoBadge activo={maestro.activo} />
              </Td>
              <Td>
                <button
                  type="button"
                  onClick={() => onCambiarEstatus(maestro)}
                  className="text-navy hover:underline"
                >
                  Cambiar estatus
                </button>
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

const TIPO_CONTRATACION_LABEL: Record<TipoContratacion, string> = {
  BASE: 'Base',
  TEMPORAL: 'Temporal',
  CONTRATO: 'Por contrato',
};

/**
 * Texto de la columna "Contratación" del listado — resumen plano, sin
 * date-formatter (las fechas ISO `YYYY-MM-DD` del backend se muestran tal
 * cual). `null`/altas previas al 2026-09-07 → `'—'`.
 */
function formatearContratacion(m: PersonaListItemMaestro): string {
  if (!m.tipoContratacion) return '—';
  const label = TIPO_CONTRATACION_LABEL[m.tipoContratacion];
  if (m.tipoContratacion === 'TEMPORAL') {
    return m.diasTemporal == null ? label : `${label} · ${m.diasTemporal} días`;
  }
  if (m.tipoContratacion === 'CONTRATO') {
    return m.contratoFechaInicio && m.contratoFechaFin
      ? `${label} · ${m.contratoFechaInicio} – ${m.contratoFechaFin}`
      : label;
  }
  return label;
}

const ESTATUS_EMPLEADO_LABEL: Record<EstatusEmpleado, string> = {
  ACTIVO: 'Activo',
  BAJA: 'Baja',
  LICENCIA: 'Licencia',
};

const ESTATUS_EMPLEADO_OPTIONS = (
  Object.entries(ESTATUS_EMPLEADO_LABEL) as Array<[EstatusEmpleado, string]>
).map(([value, label]) => ({ value, label }));
