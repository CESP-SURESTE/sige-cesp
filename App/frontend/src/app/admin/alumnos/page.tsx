'use client';

import Link from 'next/link';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar } from '@/components/admin/ui/Avatar';
import { SkeletonTableRows } from '@/components/admin/ui/Skeleton';
import { ApiError } from '@/lib/api/http';
import { obtenerPerfil } from '@/lib/api/perfil';
import {
  cambiarEstatusPersona,
  listarAlumnos,
  resetearPasswordPersona,
  type EstatusAcademico,
  type PersonaListItemAlumno,
} from '@/lib/api/personas';
import { BuscadorFiltro } from '@/components/admin/ui/personas-listado/BuscadorFiltro';
import { Paginacion } from '@/components/admin/ui/personas-listado/Paginacion';
import { EstadoActivoBadge } from '@/components/admin/ui/personas-listado/EstadoActivoBadge';
import { EstatusAcademicoBadge } from '@/components/admin/ui/personas-listado/EstatusAcademicoBadge';
import { CambiarEstatusAlumnoModal } from '@/components/admin/ui/personas-listado/CambiarEstatusAlumnoModal';
import { ResetearPasswordModal } from '@/components/admin/ui/personas-listado/ResetearPasswordModal';
import { SubirFotoPersonaModal } from '@/components/admin/ui/personas-listado/SubirFotoPersonaModal';
import { useBuscarDebounced } from '@/components/admin/ui/personas-listado/useBuscarDebounced';
import { usePaginacionFiltrada } from '@/components/admin/ui/personas-listado/usePaginacionFiltrada';
import { useCooldownReseteo } from '@/components/admin/ui/personas-listado/useCooldownReseteo';
import { EditarAlumnoModal } from './EditarAlumnoModal';

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
  const [alumnoAResetear, setAlumnoAResetear] =
    useState<PersonaListItemAlumno | null>(null);
  const [alumnoAFotografiar, setAlumnoAFotografiar] =
    useState<PersonaListItemAlumno | null>(null);
  const [alumnoAEditarDatos, setAlumnoAEditarDatos] =
    useState<PersonaListItemAlumno | null>(null);
  const [alumnoACambiarEstatus, setAlumnoACambiarEstatus] =
    useState<PersonaListItemAlumno | null>(null);
  const queryClient = useQueryClient();

  const perfilActorQuery = useQuery({
    queryKey: ['admin', 'perfil'],
    queryFn: async () => {
      try {
        return await obtenerPerfil();
      } catch (err) {
        console.error(
          '[AdminAlumnosPage] Error al obtener el perfil del actor:',
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

  const { estaEnCooldown, minutosRestantes, iniciarCooldown } =
    useCooldownReseteo(perfilActorQuery.data?.id);

  const resetearMutation = useMutation({
    mutationFn: (usuarioId: string) => resetearPasswordPersona(usuarioId),
    onSuccess: (_data, usuarioId) => {
      toast.success('Enlace de restablecimiento enviado.');
      iniciarCooldown(usuarioId);
      setAlumnoAResetear(null);
    },
    onError: (err) => {
      // Regla 12 de `CLAUDE.md` raíz.
      console.error('[AdminAlumnosPage] Error al resetear contraseña:', err);
      const mensaje =
        err instanceof ApiError
          ? err.message
          : 'Ocurrió un error inesperado. Intenta de nuevo.';
      toast.error(mensaje);
    },
  });

  const cambiarEstatusMutation = useMutation({
    mutationFn: (vars: { usuarioId: string; estatus: EstatusAcademico }) =>
      cambiarEstatusPersona(vars.usuarioId, vars.estatus),
    onSuccess: () => {
      toast.success('Estatus actualizado');
      setAlumnoACambiarEstatus(null);
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'personas', 'ALUMNO'],
      });
    },
    onError: (err) => {
      // Regla 12 de `CLAUDE.md` raíz.
      console.error('[AdminAlumnosPage] Error al cambiar el estatus:', err);
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
                  <Th></Th>
                  <Th>Foto</Th>
                  <Th>Nombre completo</Th>
                  <Th>Matrícula</Th>
                  <Th>Carrera</Th>
                  <Th>Cuatrimestre</Th>
                  <Th>Estatus académico</Th>
                  <Th>Cuenta</Th>
                  <Th>Acciones</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mist">
                <SkeletonTableRows columns={9} />
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
            <TablaAlumnos
              alumnos={resultado.data}
              estaEnCooldown={estaEnCooldown}
              minutosRestantes={minutosRestantes}
              onResetearPassword={setAlumnoAResetear}
              onFotografiar={setAlumnoAFotografiar}
              onEditarDatos={setAlumnoAEditarDatos}
              onCambiarEstatus={setAlumnoACambiarEstatus}
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

      {alumnoAResetear && (
        <ResetearPasswordModal
          nombreCompleto={[
            alumnoAResetear.nombres,
            alumnoAResetear.apellidoPaterno,
            alumnoAResetear.apellidoMaterno,
          ]
            .filter(Boolean)
            .join(' ')}
          enviando={resetearMutation.isPending}
          onConfirmar={() =>
            resetearMutation.mutate(alumnoAResetear.usuarioId)
          }
          onCancelar={() => setAlumnoAResetear(null)}
        />
      )}

      {alumnoAFotografiar && (
        <SubirFotoPersonaModal
          usuarioId={alumnoAFotografiar.usuarioId}
          nombreCompleto={[
            alumnoAFotografiar.nombres,
            alumnoAFotografiar.apellidoPaterno,
            alumnoAFotografiar.apellidoMaterno,
          ]
            .filter(Boolean)
            .join(' ')}
          fotoUrlActual={alumnoAFotografiar.fotoUrl}
          onClose={() => setAlumnoAFotografiar(null)}
          onCambioConExito={() =>
            queryClient.invalidateQueries({
              queryKey: ['admin', 'personas', 'ALUMNO'],
            })
          }
        />
      )}

      {alumnoAEditarDatos && (
        <EditarAlumnoModal
          usuarioId={alumnoAEditarDatos.usuarioId}
          onClose={() => setAlumnoAEditarDatos(null)}
          onGuardadoConExito={() =>
            queryClient.invalidateQueries({
              queryKey: ['admin', 'personas', 'ALUMNO'],
            })
          }
        />
      )}

      {alumnoACambiarEstatus && (
        <CambiarEstatusAlumnoModal
          persona={{
            estatus: alumnoACambiarEstatus.estatusAcademico,
            nombres: alumnoACambiarEstatus.nombres,
            apellidoPaterno: alumnoACambiarEstatus.apellidoPaterno,
            apellidoMaterno: alumnoACambiarEstatus.apellidoMaterno,
          }}
          guardando={cambiarEstatusMutation.isPending}
          onGuardar={(estatusNuevo) =>
            cambiarEstatusMutation.mutate({
              usuarioId: alumnoACambiarEstatus.usuarioId,
              estatus: estatusNuevo,
            })
          }
          onCancelar={() => setAlumnoACambiarEstatus(null)}
        />
      )}
    </div>
  );
}

function TablaAlumnos({
  alumnos,
  estaEnCooldown,
  minutosRestantes,
  onResetearPassword,
  onFotografiar,
  onEditarDatos,
  onCambiarEstatus,
}: {
  alumnos: PersonaListItemAlumno[];
  /** Cooldown de reseteo de contraseña (`useCooldownReseteo`) — por fila. */
  estaEnCooldown: (usuarioId: string) => boolean;
  minutosRestantes: (usuarioId: string) => number;
  onResetearPassword: (alumno: PersonaListItemAlumno) => void;
  onFotografiar: (alumno: PersonaListItemAlumno) => void;
  onEditarDatos: (alumno: PersonaListItemAlumno) => void;
  onCambiarEstatus: (alumno: PersonaListItemAlumno) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-mist">
      <table className="min-w-full divide-y divide-mist text-sm">
        <thead className="bg-bone">
          <tr>
            <Th></Th>
            <Th>Foto</Th>
            <Th>Nombre completo</Th>
            <Th>Matrícula</Th>
            <Th>Carrera</Th>
            <Th>Cuatrimestre</Th>
            <Th>Estatus académico</Th>
            <Th>Cuenta</Th>
            <Th>Acciones</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-mist">
          {alumnos.map((alumno) => (
            <tr key={alumno.usuarioId}>
              <Td>
                <button
                  type="button"
                  onClick={() => onEditarDatos(alumno)}
                  aria-label={`Editar datos de ${alumno.nombres}`}
                  className="text-slate/60 hover:text-navy"
                >
                  <Pencil className="size-4" />
                </button>
              </Td>
              <Td>
                <button
                  type="button"
                  onClick={() => onFotografiar(alumno)}
                  aria-label={`Cambiar foto de ${alumno.nombres}`}
                >
                  <Avatar
                    fotoUrl={alumno.fotoUrl}
                    iniciales={`${alumno.nombres.charAt(0)}${alumno.apellidoPaterno.charAt(0)}`.toUpperCase()}
                    tamano="sm"
                  />
                </button>
              </Td>
              <Td>
                {[alumno.nombres, alumno.apellidoPaterno, alumno.apellidoMaterno]
                  .filter(Boolean)
                  .join(' ')}
              </Td>
              <Td>{alumno.matricula}</Td>
              <Td>{alumno.carrera.nombre}</Td>
              <Td>{alumno.cuatrimestreActual}</Td>
              <Td>
                <EstatusAcademicoBadge estatus={alumno.estatusAcademico} />
              </Td>
              <Td>
                <EstadoActivoBadge activo={alumno.activo} />
              </Td>
              <Td>
                <button
                  type="button"
                  onClick={() => onCambiarEstatus(alumno)}
                  className="text-navy hover:underline"
                >
                  Cambiar estatus
                </button>
                <button
                  type="button"
                  onClick={() => onResetearPassword(alumno)}
                  disabled={estaEnCooldown(alumno.usuarioId)}
                  className="ml-3 text-navy hover:underline disabled:cursor-not-allowed disabled:text-slate/40 disabled:no-underline"
                  title={
                    estaEnCooldown(alumno.usuarioId)
                      ? `Disponible en ${minutosRestantes(alumno.usuarioId)} min`
                      : undefined
                  }
                >
                  Restablecer contraseña
                </button>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
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
