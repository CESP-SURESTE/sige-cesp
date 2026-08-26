'use client';

import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api/http';
import { obtenerPerfil } from '@/lib/api/perfil';
import {
  cambiarEstatusPersona,
  listarAdministrativos,
  type EstatusEmpleado,
  type NivelPermiso,
  type PersonaListItemAdministrativo,
  type PuestoAdministrativo,
} from '@/lib/api/personas';
import { BuscadorFiltro } from '@/components/admin/ui/personas-listado/BuscadorFiltro';
import { Paginacion } from '@/components/admin/ui/personas-listado/Paginacion';
import { EstadoActivoBadge } from '@/components/admin/ui/personas-listado/EstadoActivoBadge';
import { useBuscarDebounced } from '@/components/admin/ui/personas-listado/useBuscarDebounced';
import { usePaginacionFiltrada } from '@/components/admin/ui/personas-listado/usePaginacionFiltrada';
import { CambiarEstatusModal } from './CambiarEstatusModal';

/**
 * Listado de administrativos — Fase 10 (unificación CRUD admin, Task 5).
 *
 * Mismo patrón exacto que `app/admin/maestros/page.tsx` (Día 19): mismo
 * `BuscadorFiltro`/`Paginacion`/`useBuscarDebounced`/`usePaginacionFiltrada`,
 * misma estructura de tabla — consume `GET /personas?rol=ADMINISTRATIVO&...`
 * (`lib/api/personas.ts`, `listarAdministrativos`, cerrado en Task 4).
 * Columnas propias de administrativo (puesto + nivel de permiso, en vez de
 * cédula profesional) y mismo enum de estatus que maestro (`EstatusEmpleado`
 * — `PerfilAdministrativo.estatus` es el mismo tipo).
 *
 * A diferencia de alumnos/maestros (solo lectura hoy, fuera de alcance
 * cambiarles el estatus desde su listado — nadie lo pidió), este listado SÍ
 * agrega la acción "Cambiar estatus" por fila (`PATCH /personas/:id/estatus`,
 * también cerrado en Task 4) — primer consumidor real del patrón "baja
 * lógica" (regla 3 de `CLAUDE.md` raíz) en el frontend.
 *
 * El botón "Cambiar estatus" se OCULTA en la fila que corresponde al actor
 * logueado (decisión del review de Task 4: el backend no bloquea que un
 * admin cambie su propio estatus, podría auto-desactivarse por accidente) —
 * se compara `perfilActor.id` (`GET /perfil`, `lib/api/perfil.ts`, mismo
 * `queryKey: ['admin', 'perfil']` que `app/admin/perfil/page.tsx`, así que
 * React Query reutiliza el caché entre ambas páginas sin duplicar el
 * request) contra `administrativo.usuarioId`.
 */
export default function AdminAdministrativosPage() {
  const queryClient = useQueryClient();
  const { inputValue, setInputValue, buscar } = useBuscarDebounced();
  const { estatus, setEstatus, page, setPage, limit } =
    usePaginacionFiltrada(buscar);
  const [administrativoAEditar, setAdministrativoAEditar] =
    useState<PersonaListItemAdministrativo | null>(null);

  const perfilActorQuery = useQuery({
    queryKey: ['admin', 'perfil'],
    queryFn: async () => {
      try {
        return await obtenerPerfil();
      } catch (err) {
        console.error(
          '[AdminAdministrativosPage] Error al obtener el perfil del actor:',
          err,
        );
        throw err;
      }
    },
  });

  const {
    data: resultado,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: [
      'admin',
      'personas',
      'ADMINISTRATIVO',
      buscar,
      estatus,
      page,
      limit,
    ],
    queryFn: async () => {
      try {
        return await listarAdministrativos({
          buscar: buscar || undefined,
          estatus: estatus || undefined,
          page,
          limit,
        });
      } catch (err) {
        // Regla 12 de `CLAUDE.md` raíz — loguear antes de dejar que React
        // Query marque `isError` y la UI muestre el mensaje genérico.
        console.error(
          '[AdminAdministrativosPage] Error al listar administrativos:',
          err,
        );
        throw err;
      }
    },
    placeholderData: keepPreviousData,
  });

  const cambiarEstatusMutation = useMutation({
    mutationFn: (vars: { usuarioId: string; estatus: EstatusEmpleado }) =>
      cambiarEstatusPersona(vars.usuarioId, vars.estatus),
    onSuccess: () => {
      toast.success('Estatus actualizado');
      setAdministrativoAEditar(null);
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'personas', 'ADMINISTRATIVO'],
      });
    },
    onError: (err) => {
      // Regla 12 de `CLAUDE.md` raíz.
      console.error(
        '[AdminAdministrativosPage] Error al cambiar el estatus:',
        err,
      );
      const mensaje =
        err instanceof ApiError && err.code === 'NIVEL_PERMISO_INSUFICIENTE'
          ? 'No tienes permiso suficiente para cambiar el estatus de este administrativo.'
          : err instanceof ApiError
            ? err.message
            : 'No se pudo cambiar el estatus. Intenta de nuevo más tarde.';
      toast.error(mensaje);
    },
  });

  return (
    <div className="rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-navy">
          Administrativos
        </h1>
        <Link
          href="/admin/administrativos/nuevo"
          className="inline-block rounded-lg bg-navy px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
        >
          Dar de alta un administrativo
        </Link>
      </div>

      <div className="mt-6">
        <BuscadorFiltro
          buscarInput={inputValue}
          onBuscarChange={setInputValue}
          buscarPlaceholder="Nombre o apellido…"
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
              : 'No se pudo cargar el listado de administrativos. Intenta de nuevo más tarde.'}
          </p>
        ) : !resultado || resultado.data.length === 0 ? (
          <p className="text-sm text-slate/60">
            No se encontraron administrativos con esos criterios.
          </p>
        ) : (
          <>
            <TablaAdministrativos
              administrativos={resultado.data}
              usuarioIdActor={perfilActorQuery.data?.id}
              onCambiarEstatus={setAdministrativoAEditar}
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

      {administrativoAEditar && (
        <CambiarEstatusModal
          administrativo={administrativoAEditar}
          guardando={cambiarEstatusMutation.isPending}
          onGuardar={(estatusNuevo) =>
            cambiarEstatusMutation.mutate({
              usuarioId: administrativoAEditar.usuarioId,
              estatus: estatusNuevo,
            })
          }
          onCancelar={() => setAdministrativoAEditar(null)}
        />
      )}
    </div>
  );
}

function TablaAdministrativos({
  administrativos,
  usuarioIdActor,
  onCambiarEstatus,
}: {
  administrativos: PersonaListItemAdministrativo[];
  /** `id` del actor logueado (`GET /perfil`) — `undefined` mientras esa
   * query sigue cargando; en ese caso el botón se muestra igual (no hay
   * forma de saber todavía si hay que ocultarlo) y se oculta en cuanto
   * resuelve, si corresponde. */
  usuarioIdActor: string | undefined;
  onCambiarEstatus: (administrativo: PersonaListItemAdministrativo) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-mist">
      <table className="min-w-full divide-y divide-mist text-sm">
        <thead className="bg-bone">
          <tr>
            <Th>Nombre completo</Th>
            <Th>Puesto</Th>
            <Th>Nivel de permiso</Th>
            <Th>Estatus</Th>
            <Th>Cuenta</Th>
            <Th>Acciones</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-mist">
          {administrativos.map((administrativo) => (
            <tr key={administrativo.usuarioId}>
              <Td>
                {[
                  administrativo.nombres,
                  administrativo.apellidoPaterno,
                  administrativo.apellidoMaterno,
                ]
                  .filter(Boolean)
                  .join(' ')}
              </Td>
              <Td>{PUESTO_LABEL[administrativo.puesto]}</Td>
              <Td>{NIVEL_PERMISO_LABEL[administrativo.nivelPermiso]}</Td>
              <Td>{ESTATUS_EMPLEADO_LABEL[administrativo.estatus]}</Td>
              <Td>
                <EstadoActivoBadge activo={administrativo.activo} />
              </Td>
              <Td>
                {administrativo.usuarioId !== usuarioIdActor && (
                  <button
                    type="button"
                    onClick={() => onCambiarEstatus(administrativo)}
                    className="text-navy hover:underline"
                  >
                    Cambiar estatus
                  </button>
                )}
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

const PUESTO_LABEL: Record<PuestoAdministrativo, string> = {
  DIRECTOR: 'Director',
  COORDINADOR_ACADEMICO: 'Coordinador académico',
  COORDINADOR_ADMINISTRATIVO: 'Coordinador administrativo',
  AUXILIAR: 'Auxiliar',
  RECEPCION: 'Recepción',
  OTRO: 'Otro',
};

const NIVEL_PERMISO_LABEL: Record<NivelPermiso, string> = {
  SUPER_ADMIN: 'Super administrador',
  ADMIN: 'Administrador',
  AUXILIAR: 'Auxiliar',
};
