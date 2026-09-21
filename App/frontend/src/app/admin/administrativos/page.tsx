'use client';

import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar } from '@/components/admin/ui/Avatar';
import { SkeletonTableRows } from '@/components/admin/ui/Skeleton';
import { ApiError } from '@/lib/api/http';
import { obtenerPerfil } from '@/lib/api/perfil';
import {
  cambiarEstatusPersona,
  listarAdministrativos,
  resetearPasswordPersona,
  type EstatusEmpleado,
  type MotivoBaja,
  type NivelPermiso,
  type PersonaListItemAdministrativo,
  type PuestoAdministrativo,
  type TipoLicencia,
} from '@/lib/api/personas';
import { BuscadorFiltro } from '@/components/admin/ui/personas-listado/BuscadorFiltro';
import { Paginacion } from '@/components/admin/ui/personas-listado/Paginacion';
import { EstadoActivoBadge } from '@/components/admin/ui/personas-listado/EstadoActivoBadge';
import { EstatusEmpleadoBadge } from '@/components/admin/ui/personas-listado/EstatusEmpleadoBadge';
import { CambiarEstatusModal } from '@/components/admin/ui/personas-listado/CambiarEstatusModal';
import { ResetearPasswordModal } from '@/components/admin/ui/personas-listado/ResetearPasswordModal';
import { SubirFotoPersonaModal } from '@/components/admin/ui/personas-listado/SubirFotoPersonaModal';
import { useBuscarDebounced } from '@/components/admin/ui/personas-listado/useBuscarDebounced';
import { usePaginacionFiltrada } from '@/components/admin/ui/personas-listado/usePaginacionFiltrada';
import { useCooldownReseteo } from '@/components/admin/ui/personas-listado/useCooldownReseteo';
import { EditarAdministrativoModal } from './EditarAdministrativoModal';

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
 *
 * TAMBIÉN se oculta si el actor no tiene jerarquía suficiente sobre el
 * `nivelPermiso` del target (hallazgo Important del review final del plan
 * de unificación CRUD, 2026-08-25 — el backend YA bloquea esto con `403
 * NIVEL_PERMISO_INSUFICIENTE`, pero antes de este fix el botón se mostraba
 * en TODAS las filas de todas formas, así que un `AUXILIAR` lo veía en
 * cada fila y un `ADMIN` en las de `SUPER_ADMIN`, sabiendo de antemano que
 * siempre iba a fallar). Mismo criterio de jerarquía que
 * `PersonasService.JERARQUIA_NIVEL_PERMISO` en el backend — replicado acá
 * SOLO para UX (ocultar de antemano lo que va a fallar), el backend sigue
 * siendo la fuente de verdad real, este chequeo del cliente nunca
 * reemplaza al `403` del servidor.
 *
 * El lápiz de "Editar datos" (Task 6, `EditarAdministrativoModal.tsx`) usa
 * un gate DISTINTO (`puedeEditarDatos`, calculado junto a
 * `puedeGestionarAdministrativo` en `TablaAdministrativos`): SOLO la
 * jerarquía de `nivelPermiso`, SIN la exclusión de la fila del propio actor
 * — a diferencia de "Cambiar estatus"/"Restablecer contraseña", editar los
 * propios datos (corregir un typo propio) sí tiene sentido.
 */
const JERARQUIA_NIVEL_PERMISO: Record<NivelPermiso, number> = {
  AUXILIAR: 0,
  ADMIN: 1,
  SUPER_ADMIN: 2,
};
export default function AdminAdministrativosPage() {
  const queryClient = useQueryClient();
  const { inputValue, setInputValue, buscar } = useBuscarDebounced();
  const { estatus, setEstatus, page, setPage, limit } =
    usePaginacionFiltrada(buscar);
  const [administrativoAEditar, setAdministrativoAEditar] =
    useState<PersonaListItemAdministrativo | null>(null);
  const [administrativoAResetear, setAdministrativoAResetear] =
    useState<PersonaListItemAdministrativo | null>(null);
  const [administrativoAFotografiar, setAdministrativoAFotografiar] =
    useState<PersonaListItemAdministrativo | null>(null);
  const [administrativoAEditarDatos, setAdministrativoAEditarDatos] =
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

  const { estaEnCooldown, minutosRestantes, iniciarCooldown } =
    useCooldownReseteo(perfilActorQuery.data?.id);

  const resetearMutation = useMutation({
    mutationFn: (usuarioId: string) => resetearPasswordPersona(usuarioId),
    onSuccess: (_data, usuarioId) => {
      toast.success('Enlace de restablecimiento enviado.');
      iniciarCooldown(usuarioId);
      setAdministrativoAResetear(null);
    },
    onError: (err) => {
      // Regla 12 de `CLAUDE.md` raíz.
      console.error(
        '[AdminAdministrativosPage] Error al resetear contraseña:',
        err,
      );
      const mensaje =
        err instanceof ApiError
          ? err.message
          : 'Ocurrió un error inesperado. Intenta de nuevo.';
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
          <div className="overflow-x-auto rounded-lg border border-mist">
            <table className="min-w-full divide-y divide-mist text-sm">
              <thead className="bg-bone">
                <tr>
                  <Th></Th>
                  <Th>Foto</Th>
                  <Th>Nombre completo</Th>
                  <Th>Puesto</Th>
                  <Th>Nivel de permiso</Th>
                  <Th>Estatus</Th>
                  <Th>Cuenta</Th>
                  <Th>Acciones</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mist">
                <SkeletonTableRows columns={8} />
              </tbody>
            </table>
          </div>
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
              nivelPermisoActor={
                perfilActorQuery.data?.administrativo?.nivelPermiso
              }
              onCambiarEstatus={setAdministrativoAEditar}
              estaEnCooldown={estaEnCooldown}
              minutosRestantes={minutosRestantes}
              onResetearPassword={setAdministrativoAResetear}
              onFotografiar={setAdministrativoAFotografiar}
              onEditarDatos={setAdministrativoAEditarDatos}
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
          persona={administrativoAEditar}
          guardando={cambiarEstatusMutation.isPending}
          onGuardar={(estatusNuevo, extra) =>
            cambiarEstatusMutation.mutate({
              usuarioId: administrativoAEditar.usuarioId,
              estatus: estatusNuevo,
              ...extra,
            })
          }
          onCancelar={() => setAdministrativoAEditar(null)}
        />
      )}

      {administrativoAResetear && (
        <ResetearPasswordModal
          nombreCompleto={[
            administrativoAResetear.nombres,
            administrativoAResetear.apellidoPaterno,
            administrativoAResetear.apellidoMaterno,
          ]
            .filter(Boolean)
            .join(' ')}
          enviando={resetearMutation.isPending}
          onConfirmar={() =>
            resetearMutation.mutate(administrativoAResetear.usuarioId)
          }
          onCancelar={() => setAdministrativoAResetear(null)}
        />
      )}

      {administrativoAFotografiar && (
        <SubirFotoPersonaModal
          usuarioId={administrativoAFotografiar.usuarioId}
          nombreCompleto={[
            administrativoAFotografiar.nombres,
            administrativoAFotografiar.apellidoPaterno,
            administrativoAFotografiar.apellidoMaterno,
          ]
            .filter(Boolean)
            .join(' ')}
          fotoUrlActual={administrativoAFotografiar.fotoUrl}
          onClose={() => setAdministrativoAFotografiar(null)}
          onCambioConExito={() =>
            queryClient.invalidateQueries({
              queryKey: ['admin', 'personas', 'ADMINISTRATIVO'],
            })
          }
        />
      )}

      {administrativoAEditarDatos && (
        <EditarAdministrativoModal
          usuarioId={administrativoAEditarDatos.usuarioId}
          nivelPermisoActor={perfilActorQuery.data?.administrativo?.nivelPermiso}
          onClose={() => setAdministrativoAEditarDatos(null)}
          onGuardadoConExito={() =>
            queryClient.invalidateQueries({
              queryKey: ['admin', 'personas', 'ADMINISTRATIVO'],
            })
          }
        />
      )}
    </div>
  );
}

function TablaAdministrativos({
  administrativos,
  usuarioIdActor,
  nivelPermisoActor,
  onCambiarEstatus,
  estaEnCooldown,
  minutosRestantes,
  onResetearPassword,
  onFotografiar,
  onEditarDatos,
}: {
  administrativos: PersonaListItemAdministrativo[];
  /** `id` del actor logueado (`GET /perfil`) — `undefined` mientras esa
   * query sigue cargando; en ese caso el botón se muestra igual (no hay
   * forma de saber todavía si hay que ocultarlo) y se oculta en cuanto
   * resuelve, si corresponde. */
  usuarioIdActor: string | undefined;
  /** `nivelPermiso` del actor (`GET /perfil`, sub-objeto `administrativo`)
   * — mismo `undefined`-mientras-carga que `usuarioIdActor` de arriba. */
  nivelPermisoActor: NivelPermiso | undefined;
  onCambiarEstatus: (administrativo: PersonaListItemAdministrativo) => void;
  /** Cooldown de reseteo de contraseña (`useCooldownReseteo`) — por fila. */
  estaEnCooldown: (usuarioId: string) => boolean;
  minutosRestantes: (usuarioId: string) => number;
  onResetearPassword: (administrativo: PersonaListItemAdministrativo) => void;
  onFotografiar: (administrativo: PersonaListItemAdministrativo) => void;
  onEditarDatos: (administrativo: PersonaListItemAdministrativo) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-mist">
      <table className="min-w-full divide-y divide-mist text-sm">
        <thead className="bg-bone">
          <tr>
            <Th></Th>
            <Th>Foto</Th>
            <Th>Nombre completo</Th>
            <Th>Puesto</Th>
            <Th>Nivel de permiso</Th>
            <Th>Estatus</Th>
            <Th>Cuenta</Th>
            <Th>Acciones</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-mist">
          {administrativos.map((administrativo) => {
            // Minor de la revisión final de rama (2026-09-16) — condición
            // única reusada para AMBAS acciones: el backend aplica la MISMA
            // jerarquía de `nivelPermiso` (regla 7) a `PATCH
            // /personas/:id/estatus` y a `POST /personas/:id/resetear-password`
            // cuando el target es ADMINISTRATIVO, así que mostrar
            // "Restablecer contraseña" sin este gate garantizaba un 403 en
            // la UI para el mismo conjunto de filas que ya ocultan "Cambiar
            // estatus".
            const puedeGestionarAdministrativo =
              administrativo.usuarioId !== usuarioIdActor &&
              (nivelPermisoActor === undefined ||
                JERARQUIA_NIVEL_PERMISO[nivelPermisoActor] >=
                  JERARQUIA_NIVEL_PERMISO[administrativo.nivelPermiso]);

            // Task 6 — gate DISTINTO al de arriba: solo la jerarquía de
            // `nivelPermiso`, SIN la exclusión de la fila del propio actor.
            // Editar los propios datos (corregir un typo propio) sí tiene
            // sentido, a diferencia de "Cambiar estatus"/"Restablecer
            // contraseña" sobre uno mismo.
            const puedeEditarDatos =
              nivelPermisoActor === undefined ||
              JERARQUIA_NIVEL_PERMISO[nivelPermisoActor] >=
                JERARQUIA_NIVEL_PERMISO[administrativo.nivelPermiso];

            return (
              <tr key={administrativo.usuarioId}>
                <Td>
                  {puedeEditarDatos && (
                    <button
                      type="button"
                      onClick={() => onEditarDatos(administrativo)}
                      aria-label={`Editar datos de ${administrativo.nombres}`}
                      className="text-slate/60 hover:text-navy"
                    >
                      <Pencil className="size-4" />
                    </button>
                  )}
                </Td>
                <Td>
                  <button
                    type="button"
                    onClick={() => onFotografiar(administrativo)}
                    aria-label={`Cambiar foto de ${administrativo.nombres}`}
                  >
                    <Avatar
                      fotoUrl={administrativo.fotoUrl}
                      iniciales={`${administrativo.nombres.charAt(0)}${administrativo.apellidoPaterno.charAt(0)}`.toUpperCase()}
                      tamano="sm"
                    />
                  </button>
                </Td>
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
                <Td>
                  <EstatusEmpleadoBadge
                    estatus={administrativo.estatus}
                    tipoLicencia={administrativo.tipoLicencia}
                  />
                </Td>
                <Td>
                  <EstadoActivoBadge activo={administrativo.activo} />
                </Td>
                <Td>
                  {puedeGestionarAdministrativo && (
                    <button
                      type="button"
                      onClick={() => onCambiarEstatus(administrativo)}
                      className="text-navy hover:underline"
                    >
                      Cambiar estatus
                    </button>
                  )}
                  {puedeGestionarAdministrativo && (
                    <button
                      type="button"
                      onClick={() => onResetearPassword(administrativo)}
                      disabled={estaEnCooldown(administrativo.usuarioId)}
                      className="ml-3 text-navy hover:underline disabled:cursor-not-allowed disabled:text-slate/40 disabled:no-underline"
                      title={
                        estaEnCooldown(administrativo.usuarioId)
                          ? `Disponible en ${minutosRestantes(administrativo.usuarioId)} min`
                          : undefined
                      }
                    >
                      Restablecer contraseña
                    </button>
                  )}
                </Td>
              </tr>
            );
          })}
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
