'use client';

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { SkeletonLines } from '@/components/admin/ui/Skeleton';
import { ApiError } from '@/lib/api/http';
import {
  obtenerMallaCurricular,
  subirMallaCurricular,
  type Carrera,
} from '@/lib/api/carreras';

const CINCO_MB = 5 * 1024 * 1024;

export interface SubirMallaModalProps {
  carrera: Carrera;
  onClose: () => void;
  onSubidoConExito: () => void;
}

function formatearPeso(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A diferencia de `perfil/page.tsx` (que formatea fechas sin hora tipo
 * `fechaNacimiento`), acá NO se fija `timeZone: 'UTC'`: `subidaEn` es un
 * timestamp real (`now()`), no una fecha sin hora — pinearlo a UTC correría
 * el día para subidas después de las 18:00 hora de Yucatán. */
function formatearFecha(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return iso;
  return new Intl.DateTimeFormat('es-MX', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(fecha);
}

/**
 * Modal de subida de malla curricular — mejora de UX sobre el flujo
 * mecánico de Día 23 (botón + selector nativo, ya cerrado y probado).
 * Local a esta ruta, sin componente `Modal`/`Dialog` genérico — mismo
 * criterio que `app/plataforma/sedes/ConfirmarEliminarSedeModal.tsx`
 * (primer modal "real" de este árbol, no se justifica generalizar
 * todavía con un solo caso más).
 */
export function SubirMallaModal({
  carrera,
  onClose,
  onSubidoConExito,
}: SubirMallaModalProps) {
  const [arrastrando, setArrastrando] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [exito, setExito] = useState(false);
  const [errorSubida, setErrorSubida] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cierreTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mallaQuery = useQuery({
    queryKey: ['admin', 'carreras', carrera.id, 'malla'],
    queryFn: async () => {
      try {
        return await obtenerMallaCurricular(carrera.id);
      } catch (err) {
        console.error(
          '[SubirMallaModal] Error al obtener la malla vigente:',
          err,
        );
        throw err;
      }
    },
  });

  // El object URL de la preview se revoca al cambiar de archivo o al
  // desmontar — evita acumular blobs sin liberar en la sesión del navegador.
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
    if (file.type !== 'application/pdf') {
      toast.error('El archivo debe ser un PDF.');
      return;
    }
    if (file.size > CINCO_MB) {
      toast.error('El archivo no puede pesar más de 5MB.');
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

    subirMallaCurricular(carrera.id, archivo, setProgreso)
      .then(() => {
        setSubiendo(false);
        setExito(true);
        onSubidoConExito();
        cierreTimeoutRef.current = setTimeout(() => {
          onClose();
        }, 1500);
      })
      .catch((err: unknown) => {
        console.error(
          '[SubirMallaModal] Error al subir la malla curricular:',
          { carreraId: carrera.id, nombreArchivo: archivo.name, err },
        );
        setSubiendo(false);
        const mensaje =
          err instanceof ApiError
            ? err.message
            : 'No se pudo subir la malla curricular. Intenta de nuevo.';
        setErrorSubida(mensaje);
        toast.error(mensaje);
      });
  }

  function handleCerrar() {
    if (subiendo) return;
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
            Malla curricular — {carrera.nombre}
          </h2>
          <button
            type="button"
            onClick={handleCerrar}
            disabled={subiendo}
            className="text-slate/60 hover:text-slate disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {exito ? (
          <div className="mt-6 rounded-lg border border-success-border bg-success-bg p-4 text-center">
            <p className="text-sm font-medium text-success">
              Malla curricular actualizada
            </p>
          </div>
        ) : (
          <>
            {mallaQuery.isLoading && <SkeletonLines count={1} />}
            {mallaQuery.data && (
              <p className="mt-4 rounded-lg border border-mist bg-bone/60 px-3 py-2 text-xs text-slate/70">
                Subida por {mallaQuery.data.subidaPor.nombres}{' '}
                {mallaQuery.data.subidaPor.apellidoPaterno}
                {mallaQuery.data.subidaPor.apellidoMaterno
                  ? ` ${mallaQuery.data.subidaPor.apellidoMaterno}`
                  : ''}{' '}
                el {formatearFecha(mallaQuery.data.subidaEn)}
              </p>
            )}

            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (!subiendo) setArrastrando(true);
              }}
              onDragLeave={() => setArrastrando(false)}
              onDrop={handleDrop}
              onClick={() => !subiendo && inputRef.current?.click()}
              className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                arrastrando ? 'border-navy bg-navy/5' : 'border-mist'
              } ${subiendo ? 'pointer-events-none opacity-50' : ''}`}
            >
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={handleInputChange}
                disabled={subiendo}
              />
              {archivo && previewUrl ? (
                <div className="w-full space-y-2">
                  <p className="text-sm font-medium text-slate">{archivo.name}</p>
                  <p className="text-xs text-slate/60">{formatearPeso(archivo.size)}</p>
                  <embed
                    src={previewUrl}
                    type="application/pdf"
                    className="h-48 w-full rounded border border-mist"
                  />
                </div>
              ) : (
                <p className="text-sm text-slate/60">
                  Arrastra un PDF aquí, o haz click para seleccionarlo (máx. 5MB)
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

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={handleCerrar}
                disabled={subiendo}
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
          </>
        )}
      </div>
    </div>
  );
}
