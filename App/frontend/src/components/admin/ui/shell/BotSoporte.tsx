'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { crearReporteBug, obtenerConfigSoporte } from '@/lib/api/soporte';
import { ApiError } from '@/lib/api/http';
import { CATEGORIAS_FAQ_SOPORTE, type CategoriaFaq } from './faqSoporte';

type Vista =
  | { tipo: 'menu' }
  | { tipo: 'categoria'; categoria: CategoriaFaq }
  | { tipo: 'reporte' }
  | { tipo: 'reporte-enviado' };

/**
 * `BotSoporte` — feature "Bot de soporte" (2026-09-24). Duplicado en
 * `components/maestro/ui/shell/` (regla 11, cero imports cruzados).
 *
 * Montado como SIBLING del `<header>` en `AdminShell` — NUNCA dentro de un
 * contenedor con `backdrop-blur-sm`/`sticky` (crea containing block para
 * `position: fixed` y recorta el overlay flotante, bug ya vivido con el
 * botón de pánico de Emergencia).
 */
export function BotSoporte() {
  const [abierto, setAbierto] = useState(false);
  const [vista, setVista] = useState<Vista>({ tipo: 'menu' });

  const { data: config } = useQuery({
    queryKey: ['soporte', 'config'],
    queryFn: async () => {
      try {
        return await obtenerConfigSoporte();
      } catch (err) {
        console.error('[BotSoporte] Error al obtener configuración:', err);
        throw err;
      }
    },
    staleTime: 5 * 60 * 1000,
  });

  function cerrarYReset() {
    setAbierto(false);
    setVista({ tipo: 'menu' });
  }

  if (!config?.activo) {
    return null;
  }

  return (
    <div className="fixed right-4 bottom-4 z-50 sm:right-6 sm:bottom-6">
      {abierto && (
        <div className="mb-3 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-mist bg-bone shadow-xl">
          <div className="flex items-center justify-between border-b border-mist bg-navy px-4 py-3">
            <span className="font-display text-sm font-semibold text-bone">Soporte SIGE</span>
            <button
              onClick={cerrarYReset}
              className="text-bone/70 hover:text-bone"
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto p-4">
            {vista.tipo === 'menu' && (
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setVista({ tipo: 'categoria', categoria: CATEGORIAS_FAQ_SOPORTE[0] })}
                  className="rounded-lg border border-mist px-4 py-3 text-left text-sm hover:bg-mist/40"
                >
                  💬 Necesito ayuda
                </button>
                <button
                  onClick={() => setVista({ tipo: 'reporte' })}
                  className="rounded-lg border border-mist px-4 py-3 text-left text-sm hover:bg-mist/40"
                >
                  🐛 Tengo un problema
                </button>
              </div>
            )}

            {vista.tipo === 'categoria' && (
              <VistaFaq
                onVolverMenu={() => setVista({ tipo: 'menu' })}
              />
            )}

            {vista.tipo === 'reporte' && (
              <VistaReporte
                onVolverMenu={() => setVista({ tipo: 'menu' })}
                onEnviado={() => setVista({ tipo: 'reporte-enviado' })}
              />
            )}

            {vista.tipo === 'reporte-enviado' && (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <p className="text-sm text-slate">
                  Tu reporte fue enviado. Gracias por avisarnos.
                </p>
                <button
                  onClick={cerrarYReset}
                  className="text-sm font-medium text-navy hover:underline"
                >
                  Cerrar
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <button
        onClick={() => setAbierto((v) => !v)}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-navy text-2xl text-bone shadow-lg hover:bg-navy/90"
        aria-label={abierto ? 'Cerrar soporte' : 'Abrir soporte'}
      >
        {abierto ? '✕' : '💬'}
      </button>
    </div>
  );
}

function VistaFaq({
  onVolverMenu,
}: {
  onVolverMenu: () => void;
}) {
  const [categoria, setCategoria] = useState<CategoriaFaq | null>(null);

  if (!categoria) {
    return (
      <div className="flex flex-col gap-2">
        <button onClick={onVolverMenu} className="mb-1 text-left text-xs text-slate/60 hover:underline">
          ← Atrás
        </button>
        {CATEGORIAS_FAQ_SOPORTE.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategoria(c)}
            className="rounded-lg border border-mist px-3 py-2 text-left text-sm hover:bg-mist/40"
          >
            {c.titulo}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={() => setCategoria(null)}
        className="text-left text-xs text-slate/60 hover:underline"
      >
        ← Atrás
      </button>
      {categoria.preguntas.map((p) => (
        <div key={p.pregunta} className="rounded-lg bg-mist/30 p-3">
          <p className="text-sm font-medium text-slate">{p.pregunta}</p>
          <p className="mt-1 text-sm text-slate/80">{p.respuesta}</p>
        </div>
      ))}
    </div>
  );
}

const TIPOS_ACEPTADOS = ['image/jpeg', 'image/png', 'image/webp'];
const TRES_MB = 3 * 1024 * 1024;

function VistaReporte({
  onVolverMenu,
  onEnviado,
}: {
  onVolverMenu: () => void;
  onEnviado: () => void;
}) {
  const [descripcion, setDescripcion] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  function seleccionarArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setArchivo(null);
      return;
    }
    if (!TIPOS_ACEPTADOS.includes(file.type)) {
      setError('La captura debe ser JPG, PNG o WEBP.');
      setArchivo(null);
      return;
    }
    if (file.size > TRES_MB) {
      setError('La captura no puede pesar más de 3MB.');
      setArchivo(null);
      return;
    }
    setError(null);
    setArchivo(file);
  }

  async function enviar() {
    if (!descripcion.trim()) {
      setError('Describe qué pasó.');
      return;
    }
    setError(null);
    setEnviando(true);
    try {
      await crearReporteBug(descripcion.trim(), archivo ?? undefined);
      onEnviado();
    } catch (err) {
      console.error('[BotSoporte] Error al enviar reporte:', err);
      setError(
        err instanceof ApiError
          ? err.message
          : 'No se pudo enviar el reporte. Intenta de nuevo.',
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button onClick={onVolverMenu} className="text-left text-xs text-slate/60 hover:underline">
        ← Atrás
      </button>
      <label className="text-sm font-medium text-slate">¿Qué pasó?</label>
      <textarea
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
        rows={4}
        maxLength={2000}
        className="rounded-lg border border-mist px-3 py-2 text-sm"
        placeholder="Describe el problema con el mayor detalle posible..."
      />
      <label className="text-sm font-medium text-slate">Captura de pantalla (opcional)</label>
      <input type="file" accept={TIPOS_ACEPTADOS.join(',')} onChange={seleccionarArchivo} className="text-sm" />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        onClick={enviar}
        disabled={enviando}
        className="mt-1 rounded-lg bg-navy px-4 py-2 text-sm font-medium text-bone hover:bg-navy/90 disabled:opacity-60"
      >
        {enviando ? 'Enviando...' : 'Enviar reporte'}
      </button>
    </div>
  );
}
