'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api/http';
import { getPlatformToken, clearPlatformToken } from '@/lib/api/platform-http';
import { listarSedes, crearSede, actualizarSede, eliminarSede, type Sede, type SedeInput } from '@/lib/api/sedes';
import { ConfirmarEliminarSedeModal } from './ConfirmarEliminarSedeModal';

const FORM_VACIO: SedeInput = {
  nombre: '',
  direccion: '',
  ubicacionReferencia: '',
  telefono: '',
};

export default function PlataformaSedesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SedeInput>(FORM_VACIO);
  const [editandoId, setEditandoId] = useState<string | null>(null);
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

  const crearMutation = useMutation({
    mutationFn: (input: SedeInput) => crearSede(input),
    onSuccess: () => {
      toast.success('Sede creada');
      setForm(FORM_VACIO);
      void queryClient.invalidateQueries({ queryKey: ['plataforma', 'sedes'] });
    },
    onError: (err, vars) => {
      console.error('[PlataformaSedesPage] Error al crear sede:', { input: vars, err });
      toast.error(err instanceof ApiError ? err.message : 'Error al crear la sede');
    },
  });

  const actualizarMutation = useMutation({
    mutationFn: (vars: { id: string; input: SedeInput }) =>
      actualizarSede(vars.id, vars.input),
    onSuccess: () => {
      toast.success('Sede actualizada');
      setForm(FORM_VACIO);
      setEditandoId(null);
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
      if (editandoId === id) {
        setEditandoId(null);
        setForm(FORM_VACIO);
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

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (editandoId) {
      actualizarMutation.mutate({ id: editandoId, input: form });
    } else {
      crearMutation.mutate(form);
    }
  }

  function iniciarEdicion(sede: Sede) {
    setEditandoId(sede.id);
    setForm({
      nombre: sede.nombre,
      direccion: sede.direccion,
      ubicacionReferencia: sede.ubicacionReferencia,
      telefono: sede.telefono,
      costoRenta: sede.costoRenta ? Number(sede.costoRenta) : undefined,
    });
  }

  function cerrarSesion() {
    clearPlatformToken();
    router.push('/plataforma/login');
  }

  const guardando = crearMutation.isPending || actualizarMutation.isPending;

  return (
    <main className="mx-auto max-w-4xl p-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-display text-sm font-semibold tracking-[0.14em] text-navy uppercase">
            SIGE · Plataforma
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-slate">Sedes</h1>
        </div>
        <button
          onClick={cerrarSesion}
          className="text-sm text-slate/60 hover:text-navy"
        >
          Cerrar sesión
        </button>
      </div>

      <form
        onSubmit={handleSubmit}
        className="mt-6 space-y-4 rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm"
      >
        <h2 className="font-display text-lg font-semibold text-slate">
          {editandoId ? 'Editar sede' : 'Nueva sede'}
        </h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate/80">Nombre</label>
            <input
              required
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              disabled={guardando}
              className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate/80">Teléfono</label>
            <input
              required
              value={form.telefono}
              onChange={(e) => setForm({ ...form, telefono: e.target.value })}
              disabled={guardando}
              className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate/80">Dirección</label>
            <input
              required
              value={form.direccion}
              onChange={(e) => setForm({ ...form, direccion: e.target.value })}
              disabled={guardando}
              className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate/80">
              Referencia de ubicación
            </label>
            <input
              required
              value={form.ubicacionReferencia}
              onChange={(e) => setForm({ ...form, ubicacionReferencia: e.target.value })}
              disabled={guardando}
              className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={guardando}
            className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : editandoId ? 'Guardar cambios' : 'Crear sede'}
          </button>
          {editandoId && (
            <button
              type="button"
              onClick={() => {
                setEditandoId(null);
                setForm(FORM_VACIO);
              }}
              className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30"
            >
              Cancelar
            </button>
          )}
        </div>
      </form>

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
            {sedesQuery.isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate/60">
                  Cargando…
                </td>
              </tr>
            )}
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
                    onClick={() => iniciarEdicion(sede)}
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
    </main>
  );
}
