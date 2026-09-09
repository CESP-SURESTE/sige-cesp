'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { INPUT_CLASS, LABEL_CLASS } from '@/components/admin/ui/persona-alta/estilos';
import {
  MENSAJE_ERROR_GENERICO,
  resolverMensajeError,
} from '@/components/admin/ui/persona-alta/mensajes-error';
import { publicarAviso, type AlcanceTipoAviso } from '@/lib/api/avisos';
import { listarCarreras } from '@/lib/api/carreras';
import { listarGrupos } from '@/lib/api/grupos';

interface NuevoAvisoModalProps {
  onCerrar: () => void;
  /** El padre invalida la query de publicados + cierra. */
  onPublicado: () => void;
}

const ALCANCE_OPCIONES: { value: AlcanceTipoAviso; label: string }[] = [
  { value: 'SEDE', label: 'Toda la sede' },
  { value: 'CARRERA', label: 'Una carrera' },
  { value: 'GRUPO', label: 'Un grupo' },
];

/**
 * Alta de aviso — local a `app/admin/avisos/` (regla 11 de `CLAUDE.md`
 * raíz). Un solo modo (alta): no hay `PATCH /avisos/:id`. El modal se
 * desmonta al cerrar (el padre lo renderiza condicionalmente), así que el
 * estado local se recrea vacío en la siguiente apertura — cumple regla 13
 * sin limpieza explícita.
 */
export function NuevoAvisoModal({ onCerrar, onPublicado }: NuevoAvisoModalProps) {
  const [titulo, setTitulo] = useState('');
  const [cuerpo, setCuerpo] = useState('');
  const [alcanceTipo, setAlcanceTipo] = useState<AlcanceTipoAviso>('SEDE');
  const [alcanceId, setAlcanceId] = useState('');

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCerrar();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCerrar]);

  const carrerasQuery = useQuery({
    // Misma key que `app/admin/carreras/` — caché compartida.
    queryKey: ['admin', 'carreras'],
    queryFn: async () => {
      try {
        return await listarCarreras();
      } catch (err) {
        console.error('[NuevoAvisoModal] carreras:', err);
        throw err;
      }
    },
    enabled: alcanceTipo === 'CARRERA',
  });

  const gruposQuery = useQuery({
    queryKey: ['admin', 'avisos', 'grupos-opciones'],
    queryFn: async () => {
      try {
        // Nota: si hay >100 grupos en la sede el `<select>` no los trae
        // todos — aceptable para v1 (mismo criterio que el dropdown de
        // grupos en `app/admin/grupos/`).
        return await listarGrupos({ limit: 100 });
      } catch (err) {
        console.error('[NuevoAvisoModal] grupos:', err);
        throw err;
      }
    },
    enabled: alcanceTipo === 'GRUPO',
  });

  const mutation = useMutation({
    mutationFn: () =>
      publicarAviso({
        titulo: titulo.trim(),
        cuerpo: cuerpo.trim(),
        alcanceTipo,
        alcanceId: alcanceTipo === 'SEDE' ? undefined : alcanceId,
      }),
    onSuccess: () => {
      toast.success('Aviso publicado');
      onPublicado();
    },
    onError: (err) => {
      console.error('[NuevoAvisoModal] publicar:', err);
      toast.error(resolverMensajeError(err) ?? MENSAJE_ERROR_GENERICO);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!titulo.trim() || !cuerpo.trim()) {
      toast.error('Completa los campos requeridos');
      return;
    }
    if (alcanceTipo !== 'SEDE' && !alcanceId) {
      toast.error('Completa los campos requeridos');
      return;
    }
    mutation.mutate();
  }

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
            <label htmlFor="nuevo-aviso-alcance" className={LABEL_CLASS}>
              Destinatarios
            </label>
            <select
              id="nuevo-aviso-alcance"
              disabled={mutation.isPending}
              className={INPUT_CLASS}
              value={alcanceTipo}
              onChange={(e) => {
                setAlcanceTipo(e.target.value as AlcanceTipoAviso);
                setAlcanceId('');
              }}
            >
              {ALCANCE_OPCIONES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {alcanceTipo === 'CARRERA' && (
            <div>
              <label htmlFor="nuevo-aviso-carrera" className={LABEL_CLASS}>
                Carrera
              </label>
              <select
                id="nuevo-aviso-carrera"
                disabled={mutation.isPending || carrerasQuery.isLoading}
                className={INPUT_CLASS}
                value={alcanceId}
                onChange={(e) => setAlcanceId(e.target.value)}
              >
                <option value="" disabled>
                  Selecciona una carrera
                </option>
                {(carrerasQuery.data ?? []).map((carrera) => (
                  <option key={carrera.id} value={carrera.id}>
                    {carrera.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}

          {alcanceTipo === 'GRUPO' && (
            <div>
              <label htmlFor="nuevo-aviso-grupo" className={LABEL_CLASS}>
                Grupo
              </label>
              <select
                id="nuevo-aviso-grupo"
                disabled={mutation.isPending || gruposQuery.isLoading}
                className={INPUT_CLASS}
                value={alcanceId}
                onChange={(e) => setAlcanceId(e.target.value)}
              >
                <option value="" disabled>
                  Selecciona un grupo
                </option>
                {(gruposQuery.data?.data ?? []).map((grupo) => (
                  <option key={grupo.id} value={grupo.id}>
                    {grupo.nombre} · {grupo.carrera.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}

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
              disabled={mutation.isPending}
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
