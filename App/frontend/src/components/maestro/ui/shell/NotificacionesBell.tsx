'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  conteoNoLeidas,
  listarNotificaciones,
  marcarLeida,
  type Notificacion,
} from '@/lib/api/notificaciones';
import { DetalleAvisoModal } from '@/app/maestro/avisos/DetalleAvisoModal';
import { IconCampana } from './icons';

/**
 * Campana de notificaciones del navbar MAESTRO — Fase 14, Día 39.
 *
 * Regla 11 de `CLAUDE.md` raíz: cada árbol (admin/alumno/maestro) tiene su
 * PROPIO componente de campana; este no se comparte con
 * `components/{admin,alumno}/ui/shell/NotificacionesBell.tsx` aunque sean
 * casi idénticos. El cliente de API (`lib/api/notificaciones.ts`) sí es
 * compartido.
 *
 * Polling: `useQuery` sobre el conteo con `refetchInterval` (60s) — sin
 * websockets (el volumen de un ERP escolar no lo justifica; estabilidad >
 * todo). La lista completa solo se pide al abrir el dropdown.
 *
 * Deep-link por `tipo`: un ítem `AVISO` abre el `DetalleAvisoModal` de este
 * árbol, renderizado con `createPortal` a `document.body` (mismo criterio
 * que la campana de admin, cuyo `<header>` con `backdrop-blur` recorta
 * `position: fixed`; acá se mantiene igual por uniformidad). El
 * `GET /avisos/:id` del modal ya marca la `Notificacion` como leída en el
 * backend. Los tipos `RECORDATORIO_EVENTO`/`EVENTO_NUEVO` solo se marcan
 * leídos al hacer click (no hay `GET /eventos/:id` para abrirlos).
 */
export function NotificacionesBell() {
  const queryClient = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [avisoAbierto, setAvisoAbierto] = useState<string | null>(null);
  const contenedorRef = useRef<HTMLDivElement>(null);

  const { data: conteo } = useQuery({
    queryKey: ['notificaciones', 'conteo'],
    queryFn: async () => {
      try {
        return await conteoNoLeidas();
      } catch (err) {
        console.error('[NotificacionesBell] Error al obtener el conteo:', err);
        throw err;
      }
    },
    refetchInterval: 60_000,
  });

  const { data: lista } = useQuery({
    queryKey: ['notificaciones', 'lista'],
    queryFn: async () => {
      try {
        return await listarNotificaciones(1, 10);
      } catch (err) {
        console.error('[NotificacionesBell] Error al obtener la lista:', err);
        throw err;
      }
    },
    enabled: abierto,
  });

  // Cerrar al hacer click fuera / con Escape (mismo criterio que
  // MobileDrawer en AdminShell — foco-lite sin librería nueva).
  useEffect(() => {
    if (!abierto) return;
    function onClickFuera(e: MouseEvent) {
      if (
        contenedorRef.current &&
        !contenedorRef.current.contains(e.target as Node)
      ) {
        setAbierto(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setAbierto(false);
    }
    window.addEventListener('mousedown', onClickFuera);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClickFuera);
      window.removeEventListener('keydown', onKey);
    };
  }, [abierto]);

  const noLeidas = conteo?.total ?? 0;

  async function onClickItem(n: Notificacion) {
    if (n.tipo === 'AVISO') {
      // El `GET /avisos/:id` del modal marca la `Notificacion` como leída en
      // el backend, así que no se llama `marcarLeida` aquí.
      setAvisoAbierto(n.referenciaId);
      setAbierto(false);
      return;
    }
    if (n.leidoEn) return;
    try {
      await marcarLeida(n.id);
      await queryClient.invalidateQueries({ queryKey: ['notificaciones'] });
    } catch (err) {
      console.error('[NotificacionesBell] Error al marcar leída:', err);
      toast.error('No se pudo marcar la notificación como leída');
    }
  }

  return (
    <div ref={contenedorRef} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-label={
          noLeidas > 0
            ? `Notificaciones (${noLeidas} sin leer)`
            : 'Notificaciones'
        }
        aria-haspopup="menu"
        aria-expanded={abierto}
        className="relative rounded-lg p-1.5 text-slate transition-colors hover:bg-mist/50 focus-visible:ring-2 focus-visible:ring-navy focus-visible:outline-none"
      >
        <IconCampana className="size-5" />
        {noLeidas > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-crimson px-1 text-[10px] font-semibold text-white">
            {noLeidas > 9 ? '9+' : noLeidas}
          </span>
        )}
      </button>

      {abierto && (
        <div className="absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-lg border border-mist bg-white shadow-lg">
          <div className="border-b border-mist px-4 py-2.5 text-xs font-semibold tracking-wide text-slate uppercase">
            Notificaciones
          </div>
          <ul role="menu" className="max-h-96 divide-y divide-mist overflow-y-auto">
            {(lista?.data.length ?? 0) === 0 && (
              <li className="px-4 py-6 text-center text-sm text-slate/60">
                No tienes notificaciones
              </li>
            )}
            {lista?.data.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => onClickItem(n)}
                  className={[
                    'block w-full px-4 py-3 text-left transition-colors hover:bg-bone',
                    n.leidoEn ? 'opacity-60' : '',
                  ].join(' ')}
                >
                  <p className="text-sm font-medium text-slate">{n.titulo}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-slate/70">
                    {n.cuerpoCorto}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {avisoAbierto !== null &&
        createPortal(
          <DetalleAvisoModal
            avisoId={avisoAbierto}
            onCerrar={() => {
              setAvisoAbierto(null);
              void queryClient.invalidateQueries({ queryKey: ['notificaciones'] });
            }}
          />,
          document.body,
        )}
    </div>
  );
}
