'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api/http';
import { getPlatformToken } from '@/lib/api/platform-http';
import { listarSedes, actualizarSede, eliminarSede, type Sede, type SedeInput } from '@/lib/api/sedes';
import { PlataformaNav } from '../PlataformaNav';
import { SkeletonTableRows } from '../Skeleton';
import { ConfirmarEliminarSedeModal } from './ConfirmarEliminarSedeModal';
import { SedeModal } from './SedeModal';

/**
 * ACTUALIZADO (2026-09-11): la creación de sede se movió a
 * `app/plataforma/sedes/nueva/page.tsx` (exige alta de director +
 * administrativo fundadores, Task 6 del plan "Sede con fundadores
 * obligatorios") — "+ Nueva sede" ahora navega ahí en vez de abrir un modal.
 * `SedeModal` se recortó a solo edición (Task 7); `sedeAEditar: null`
 * significa modal cerrado. `PATCH /sedes/:id` sigue siendo parcial por
 * diseño (campos vacíos = sin cambio no se envían).
 */

export default function PlataformaSedesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [sedeAEditar, setSedeAEditar] = useState<Sede | null>(null);
  const [sedeAEliminar, setSedeAEliminar] = useState<Sede | null>(null);

  // Protección de ruta del lado del cliente — app/plataforma está
  // explícitamente exento de la lógica de sesión de src/proxy.ts (regla 11,
  // sistema de identidad aparte, ver la exención al inicio de ese archivo),
  // así que este check en el cliente es el único gate real.
  useEffect(() => {
    if (!getPlatformToken()) {
      router.replace('/plataforma/login');
    }
  }, [router]);

  const sedesQuery = useQuery({
    queryKey: ['plataforma', 'sedes'],
    queryFn: async () => {
      try {
        return await listarSedes();
      } catch (err) {
        console.error('[PlataformaSedesPage] Error al listar sedes:', err);
        throw err;
      }
    },
  });

  const actualizarMutation = useMutation({
    mutationFn: (vars: { id: string; input: Partial<SedeInput> }) =>
      actualizarSede(vars.id, vars.input),
    onSuccess: () => {
      toast.success('Sede actualizada');
      setSedeAEditar(null);
      void queryClient.invalidateQueries({ queryKey: ['plataforma', 'sedes'] });
    },
    onError: (err, vars) => {
      console.error('[PlataformaSedesPage] Error al actualizar sede:', {
        id: vars.id,
        input: vars.input,
        err,
      });
      toast.error(err instanceof ApiError ? err.message : 'Error al actualizar la sede');
    },
  });

  const eliminarMutation = useMutation({
    mutationFn: (id: string) => eliminarSede(id),
    onSuccess: (_data, id) => {
      toast.success('Sede eliminada');
      setSedeAEliminar(null);
      if (sedeAEditar?.id === id) {
        setSedeAEditar(null);
      }
    },
    onError: (err, vars) => {
      console.error('[PlataformaSedesPage] Error al eliminar sede:', { id: vars, err });
      toast.error(err instanceof ApiError ? err.message : 'Error al eliminar la sede');
      setSedeAEliminar(null);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['plataforma', 'sedes'] });
    },
  });

  return (
    <main className="mx-auto max-w-4xl p-8">
      <PlataformaNav activo="sedes" titulo="Sedes" />

      <div className="mt-6 flex items-center justify-between rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate">Sedes registradas</h2>
          <p className="mt-1 text-sm text-slate/60">Alta y edición de las sedes de la plataforma.</p>
        </div>
        <button
          onClick={() => router.push('/plataforma/sedes/nueva')}
          className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
        >
          + Nueva sede
        </button>
      </div>

      <div className="mt-8 overflow-x-auto rounded-lg border-l-4 border-navy bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-mist text-left text-slate/60">
              <th className="px-4 py-3 font-medium">Nombre</th>
              <th className="px-4 py-3 font-medium">Dirección</th>
              <th className="px-4 py-3 font-medium">Teléfono</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {sedesQuery.isLoading && <SkeletonTableRows columns={4} />}
            {sedesQuery.isError && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-crimson">
                  {sedesQuery.error instanceof ApiError
                    ? sedesQuery.error.message
                    : 'No se pudo cargar el listado de sedes. Intenta de nuevo más tarde.'}
                </td>
              </tr>
            )}
            {!sedesQuery.isLoading &&
              !sedesQuery.isError &&
              sedesQuery.data?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate/60">
                    Todavía no hay sedes registradas.
                  </td>
                </tr>
              )}
            {sedesQuery.data?.map((sede) => (
              <tr key={sede.id} className="border-b border-mist last:border-0">
                <td className="px-4 py-3 text-slate">{sede.nombre}</td>
                <td className="px-4 py-3 text-slate/80">{sede.direccion}</td>
                <td className="px-4 py-3 text-slate/80">{sede.telefono}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => setSedeAEditar(sede)}
                    className="text-navy hover:underline"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => setSedeAEliminar(sede)}
                    className="ml-4 text-crimson hover:underline"
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sedeAEliminar && (
        <ConfirmarEliminarSedeModal
          sede={sedeAEliminar}
          eliminando={eliminarMutation.isPending}
          onConfirmar={() => eliminarMutation.mutate(sedeAEliminar.id)}
          onCancelar={() => setSedeAEliminar(null)}
        />
      )}

      {sedeAEditar && (
        <SedeModal
          sede={sedeAEditar}
          guardando={actualizarMutation.isPending}
          onEditar={(payload) => {
            actualizarMutation.mutate({ id: sedeAEditar.id, input: payload });
          }}
          onCancelar={() => setSedeAEditar(null)}
        />
      )}
    </main>
  );
}
