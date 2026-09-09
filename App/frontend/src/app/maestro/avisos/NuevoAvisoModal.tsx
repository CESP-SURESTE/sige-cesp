'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api/http';
import { publicarAviso } from '@/lib/api/avisos';
import { obtenerMisAsignaciones } from '@/lib/api/perfil';

interface NuevoAvisoModalProps {
  onCerrar: () => void;
  /** El padre invalida la query de publicados + cierra. */
  onPublicado: () => void;
}

/**
 * Alta de aviso — local a `app/maestro/avisos/` (regla 11 de `CLAUDE.md`
 * raíz — no se importa de `app/admin/` ni `components/admin/`). Copia
 * estructural del homónimo de `app/admin/avisos/` con una diferencia de
 * negocio: un maestro solo publica a un GRUPO donde imparte clase — no hay
 * selector de alcance, `alcanceTipo: 'GRUPO'` va fijo y la lista de grupos
 * sale de `GET /perfil/asignaciones`.
 *
 * Un solo modo (alta): no hay `PATCH /avisos/:id`. El modal se desmonta al
 * cerrar (el padre lo renderiza condicionalmente), así que el estado local
 * se recrea vacío en la siguiente apertura — cumple regla 13 sin limpieza
 * explícita.
 */

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none disabled:opacity-50';
const LABEL_CLASS = 'block text-sm font-medium text-slate/80';
const MENSAJE_ERROR_GENERICO = 'No se pudo completar la acción. Intenta de nuevo.';

export function NuevoAvisoModal({ onCerrar, onPublicado }: NuevoAvisoModalProps) {
  const [titulo, setTitulo] = useState('');
  const [cuerpo, setCuerpo] = useState('');
  const [alcanceId, setAlcanceId] = useState('');

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCerrar();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCerrar]);

  const gruposQuery = useQuery({
    queryKey: ['maestro', 'avisos', 'grupos-opciones'],
    queryFn: async () => {
      try {
        return await obtenerMisAsignaciones();
      } catch (err) {
        console.error('[NuevoAvisoModal maestro] asignaciones:', err);
        throw err;
      }
    },
  });

  const grupos = gruposQuery.data ?? [];
  const sinGrupos = !gruposQuery.isLoading && !gruposQuery.isError && grupos.length === 0;

  const mutation = useMutation({
    mutationFn: () =>
      publicarAviso({
        titulo: titulo.trim(),
        cuerpo: cuerpo.trim(),
        alcanceTipo: 'GRUPO',
        alcanceId,
      }),
    onSuccess: () => {
      toast.success('Aviso publicado');
      onPublicado();
    },
    onError: (err) => {
      console.error('[NuevoAvisoModal maestro] publicar:', err);
      toast.error(err instanceof ApiError ? err.message : MENSAJE_ERROR_GENERICO);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!titulo.trim() || !cuerpo.trim() || !alcanceId) {
      toast.error('Completa los campos requeridos');
      return;
    }
    mutation.mutate();
  }

  const publicarDeshabilitado =
    mutation.isPending || gruposQuery.isLoading || gruposQuery.isError || sinGrupos;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate/40 p-4 pt-16"
      onClick={onCerrar}
    >
      <div
        className="w-full max-w-lg rounded-lg bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="font-display text-lg font-semibold text-slate">Nuevo aviso</h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="text-slate/50 hover:text-slate"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="nuevo-aviso-titulo" className={LABEL_CLASS}>
              Título
            </label>
            <input
              id="nuevo-aviso-titulo"
              type="text"
              maxLength={160}
              disabled={mutation.isPending}
              className={INPUT_CLASS}
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="nuevo-aviso-cuerpo" className={LABEL_CLASS}>
              Mensaje
            </label>
            <textarea
              id="nuevo-aviso-cuerpo"
              maxLength={5000}
              rows={5}
              disabled={mutation.isPending}
              className={INPUT_CLASS}
              value={cuerpo}
              onChange={(e) => setCuerpo(e.target.value)}
            />
          </div>

          <div>
            <p className="text-sm text-slate/60">Alcance: un grupo donde impartes clase</p>
            <label htmlFor="nuevo-aviso-grupo" className={`${LABEL_CLASS} mt-3`}>
              Grupo
            </label>
            <select
              id="nuevo-aviso-grupo"
              disabled={mutation.isPending || gruposQuery.isLoading || sinGrupos}
              className={INPUT_CLASS}
              value={alcanceId}
              onChange={(e) => setAlcanceId(e.target.value)}
            >
              {sinGrupos ? (
                <option value="" disabled>
                  No tienes grupos asignados
                </option>
              ) : (
                <>
                  <option value="" disabled>
                    Selecciona un grupo
                  </option>
                  {grupos.map((g) => (
                    <option key={g.grupoId} value={g.grupoId}>
                      {g.nombre} · {g.carrera.nombre}
                    </option>
                  ))}
                </>
              )}
            </select>
            {gruposQuery.isError && (
              <p className="mt-1 text-sm text-crimson">
                No se pudieron cargar tus grupos. Cierra y vuelve a intentar.
              </p>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onCerrar}
              disabled={mutation.isPending}
              className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={publicarDeshabilitado}
              className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
            >
              {mutation.isPending ? 'Publicando…' : 'Publicar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
