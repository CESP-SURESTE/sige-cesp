'use client';

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api/http';
import { eliminarFotoPersona, subirFotoPersona } from '@/lib/api/foto-perfil';

const TRES_MB = 3 * 1024 * 1024;
const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];

export interface SubirFotoPersonaModalProps {
  usuarioId: string;
  nombreCompleto: string;
  fotoUrlActual: string | null;
  onClose: () => void;
  onCambioConExito: () => void;
}

function formatearPeso(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Modal compartido DENTRO del árbol admin (regla 11 sigue aplicando entre
 * árboles, no dentro de uno) — mismo patrón que `ResetearPasswordModal.tsx`/
 * `CambiarEstatusModal.tsx`: un admin dispara esto desde la fila de
 * cualquiera de los 3 listados (alumnos/maestros/administrativos).
 */
export function SubirFotoPersonaModal({
  usuarioId,
  nombreCompleto,
  fotoUrlActual,
  onClose,
  onCambioConExito,
}: SubirFotoPersonaModalProps) {
  const [arrastrando, setArrastrando] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [exito, setExito] = useState(false);
  const [errorSubida, setErrorSubida] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cierreTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!archivo) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(archivo);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [archivo]);

  useEffect(() => {
    return () => {
      if (cierreTimeoutRef.current) clearTimeout(cierreTimeoutRef.current);
    };
  }, []);

  function seleccionarArchivo(file: File) {
    setErrorSubida(null);
    if (!TIPOS_PERMITIDOS.includes(file.type)) {
      toast.error('La foto debe ser JPG, PNG o WEBP.');
      return;
    }
    if (file.size > TRES_MB) {
      toast.error('La foto no puede pesar más de 3MB.');
      return;
    }
    setArchivo(file);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setArrastrando(false);
    if (subiendo) return;
    const file = e.dataTransfer.files?.[0];
    if (file) seleccionarArchivo(file);
  }

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) seleccionarArchivo(file);
  }

  function handleSubir() {
    if (!archivo) return;
    setSubiendo(true);
    setProgreso(0);
    setErrorSubida(null);

    subirFotoPersona(usuarioId, archivo, setProgreso)
      .then(() => {
        setSubiendo(false);
        setExito(true);
        onCambioConExito();
        cierreTimeoutRef.current = setTimeout(() => onClose(), 1500);
      })
      .catch((err: unknown) => {
        console.error('[SubirFotoPersonaModal] Error al subir la foto:', {
          usuarioId,
          nombreArchivo: archivo.name,
          err,
        });
        setSubiendo(false);
        const mensaje =
          err instanceof ApiError
            ? err.message
            : 'No se pudo subir la foto. Intenta de nuevo.';
        setErrorSubida(mensaje);
        toast.error(mensaje);
      });
  }

  function handleEliminar() {
    setEliminando(true);
    eliminarFotoPersona(usuarioId)
      .then(() => {
        setEliminando(false);
        toast.success('Foto eliminada.');
        onCambioConExito();
        onClose();
      })
      .catch((err: unknown) => {
        console.error('[SubirFotoPersonaModal] Error al eliminar la foto:', {
          usuarioId,
          err,
        });
        setEliminando(false);
        toast.error('No se pudo eliminar la foto. Intenta de nuevo.');
      });
  }

  function handleCerrar() {
    if (subiendo || eliminando) return;
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate/40 p-4"
      onClick={handleCerrar}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-slate">
            Foto de {nombreCompleto}
          </h2>
          <button
            type="button"
            onClick={handleCerrar}
            disabled={subiendo || eliminando}
            aria-label="Cerrar"
            className="text-slate/60 hover:text-slate disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {exito ? (
          <div className="mt-6 rounded-lg border border-success-border bg-success-bg p-4 text-center">
            <p className="text-sm font-medium text-success">Foto actualizada</p>
          </div>
        ) : (
          <>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (!subiendo) setArrastrando(true);
              }}
              onDragLeave={() => setArrastrando(false)}
              onDrop={handleDrop}
              onClick={() => !subiendo && inputRef.current?.click()}
              role="button"
              tabIndex={0}
              aria-label="Seleccionar foto de perfil"
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && !subiendo) {
                  e.preventDefault();
                  inputRef.current?.click();
                }
              }}
              className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                arrastrando ? 'border-navy bg-navy/5' : 'border-mist'
              } ${subiendo ? 'pointer-events-none opacity-50' : ''}`}
            >
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleInputChange}
                disabled={subiendo}
              />
              {previewUrl ? (
                <div className="w-full space-y-2">
                  <p className="text-sm font-medium text-slate">{archivo?.name}</p>
                  {archivo && (
                    <p className="text-xs text-slate/60">{formatearPeso(archivo.size)}</p>
                  )}
                  {/* eslint-disable-next-line @next/next/no-img-element -- object URL local (blob:) */}
                  <img
                    src={previewUrl}
                    alt="Previsualización"
                    className="mx-auto h-32 w-32 rounded-full border border-mist object-cover"
                  />
                </div>
              ) : fotoUrlActual ? (
                <div className="space-y-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Supabase Storage */}
                  <img
                    src={fotoUrlActual}
                    alt="Foto actual"
                    className="mx-auto h-32 w-32 rounded-full border border-mist object-cover"
                  />
                  <p className="text-sm text-slate/60">
                    Arrastra una foto aquí, o haz click para reemplazarla (JPG/PNG/WEBP, máx. 3MB)
                  </p>
                </div>
              ) : (
                <p className="text-sm text-slate/60">
                  Arrastra una foto aquí, o haz click para seleccionarla (JPG/PNG/WEBP, máx. 3MB)
                </p>
              )}
            </div>

            {errorSubida && (
              <p className="mt-3 rounded-lg border border-error-border bg-error-bg px-3 py-2 text-sm text-crimson">
                {errorSubida}
              </p>
            )}

            {subiendo && (
              <div className="mt-4">
                <div className="h-2 w-full rounded-full bg-mist">
                  <div
                    className="h-2 rounded-full bg-navy transition-all"
                    style={{ width: `${progreso}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-slate/60">{progreso}%</p>
              </div>
            )}

            <div className="mt-6 flex items-center justify-between gap-3">
              {fotoUrlActual && !archivo && (
                <button
                  type="button"
                  onClick={handleEliminar}
                  disabled={subiendo || eliminando}
                  className="text-sm font-medium text-crimson hover:underline disabled:opacity-50"
                >
                  {eliminando ? 'Quitando…' : 'Quitar foto'}
                </button>
              )}
              <div className="ml-auto flex gap-3">
                <button
                  type="button"
                  onClick={handleCerrar}
                  disabled={subiendo || eliminando}
                  className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSubir}
                  disabled={!archivo || subiendo}
                  className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
                >
                  {subiendo ? 'Subiendo…' : 'Subir'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
