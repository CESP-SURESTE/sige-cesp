'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listarTelefonosEmergencia } from '@/lib/api/emergencia';
import { IconEmergencia } from './icons';

/**
 * Botón de pánico — módulo de emergencia (2026-09-08). Fijo en el topbar del
 * shell admin, visible en cualquier pantalla. Pasivo: solo muestra los
 * teléfonos de emergencia de la sede (911, Cruz Roja local, bomberos,
 * protección civil municipal, hospital). Sin efectos secundarios, sin
 * registro. Cada teléfono es un enlace `tel:` (tap-para-llamar en móvil).
 *
 * Local a `components/admin/ui/shell/` — no se comparte con otros árboles
 * (regla 11). El modal es un overlay propio, mismo patrón visual que
 * `app/admin/salones/ConfirmarEliminarSalonModal.tsx`; no usa diálogos
 * nativos del navegador (bloquean la extensión / la pestaña).
 */
export function PanicoButton() {
  const [abierto, setAbierto] = useState(false);

  // Cerrar con Escape mientras el modal está abierto (sin focus-trap — ningún
  // modal del repo lo tiene, es un gap transversal).
  useEffect(() => {
    if (!abierto) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setAbierto(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [abierto]);

  const telefonosQuery = useQuery({
    queryKey: ['admin', 'emergencia', 'telefonos'],
    queryFn: async () => {
      try {
        return await listarTelefonosEmergencia();
      } catch (err) {
        console.error(
          '[PanicoButton] Error al listar teléfonos de emergencia:',
          err,
        );
        throw err;
      }
    },
    enabled: abierto, // solo pega al backend cuando se abre
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label="Teléfonos de emergencia"
        className="flex items-center gap-1.5 rounded-lg bg-crimson px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-crimson/90 focus-visible:ring-2 focus-visible:ring-crimson focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <IconEmergencia className="size-4" />
        <span className="hidden sm:inline">Emergencia</span>
      </button>

      {abierto && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate/40 p-4 pt-16"
          role="dialog"
          aria-modal="true"
          aria-label="Teléfonos de emergencia de la sede"
          onClick={(e) => {
            // Cerrar al clickear el backdrop, no al clickear dentro del panel.
            if (e.target === e.currentTarget) setAbierto(false);
          }}
        >
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-crimson">
                Teléfonos de emergencia
              </h2>
              <button
                type="button"
                onClick={() => setAbierto(false)}
                aria-label="Cerrar"
                className="rounded-lg p-1 text-slate/60 hover:bg-mist/40"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {telefonosQuery.isLoading && (
                <p className="text-sm text-slate/60">Cargando…</p>
              )}
              {telefonosQuery.isError && (
                <p className="text-sm text-crimson">
                  No se pudieron cargar los teléfonos. Intenta de nuevo.
                </p>
              )}
              {telefonosQuery.data?.length === 0 && (
                <p className="text-sm text-slate/70">
                  No hay teléfonos de emergencia configurados. Agrégalos en la{' '}
                  <Link
                    href="/admin/emergencia"
                    onClick={() => setAbierto(false)}
                    className="text-navy underline hover:text-navy-deep"
                  >
                    sección Emergencia
                  </Link>
                  .
                </p>
              )}
              {telefonosQuery.data?.map((t) => (
                <a
                  key={t.id}
                  href={`tel:${t.telefono.replace(/\s+/g, '')}`}
                  className="flex items-center justify-between rounded-lg border border-mist px-4 py-3 transition-colors hover:bg-mist/30"
                >
                  <span className="text-sm font-medium text-slate">
                    {t.etiqueta}
                  </span>
                  <span className="font-display text-lg font-semibold text-navy">
                    {t.telefono}
                  </span>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
