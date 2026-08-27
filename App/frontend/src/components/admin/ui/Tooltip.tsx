'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * Tooltip propio (chip oscuro, tokens de marca) — reemplaza el `title` nativo
 * del navegador donde se quiere aparición rápida y estilo consistente.
 *
 * Sin dependencias: `@headlessui/react` v2 no tiene primitiva de tooltip y el
 * proyecto no agrega libs de positioning. El nodo se renderiza vía
 * `createPortal` a `document.body` con `position: fixed` medido desde el
 * trigger con `getBoundingClientRect()` — así el `overflow-x-auto` de las
 * tablas (que recortaría un tooltip posicionado con CSS dentro de la celda)
 * no lo afecta.
 *
 * Solo flip vertical: si no cabe arriba del trigger, se pinta abajo. Vive lo
 * que dura un hover/focus; no escucha `scroll`/`resize` — si el usuario hace
 * scroll con él abierto, el `mouseleave` lo cierra.
 *
 * Árbol admin (regla 11 de CLAUDE.md) — no compartir con el árbol alumno.
 */

interface TooltipProps {
  label: string;
  /** Trigger — un único elemento React (recibe ref via cloneElement no, ver nota). */
  children: ReactElement;
}

interface Coords {
  left: number;
  top: number;
  /** true = el tooltip está debajo del trigger (flechita apunta hacia arriba). */
  below: boolean;
}

const OPEN_DELAY_MS = 150;
const GAP_PX = 8;

export function Tooltip({ label, children }: TooltipProps) {
  const tooltipId = useId();
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [coords, setCoords] = useState<Coords | null>(null);

  const visible = coords !== null;

  const computeCoords = useCallback((): Coords | null => {
    const el = wrapperRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const below = rect.top < 48;
    return {
      left: rect.left + rect.width / 2,
      top: below ? rect.bottom + GAP_PX : rect.top - GAP_PX,
      below,
    };
  }, []);

  const open = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => {
      setCoords(computeCoords());
    }, OPEN_DELAY_MS);
  }, [computeCoords]);

  const close = useCallback(() => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    setCoords(null);
  }, []);

  useEffect(() => {
    return () => {
      if (openTimer.current) clearTimeout(openTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible, close]);

  return (
    <span
      ref={wrapperRef}
      className="inline-flex"
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
      aria-describedby={visible ? tooltipId : undefined}
    >
      {children}
      {visible &&
        coords &&
        createPortal(
          <span
            role="tooltip"
            id={tooltipId}
            style={{
              position: 'fixed',
              left: coords.left,
              top: coords.top,
              transform: coords.below
                ? 'translate(-50%, 0)'
                : 'translate(-50%, -100%)',
            }}
            className="pointer-events-none z-50 max-w-xs rounded-md bg-navy px-2.5 py-1.5 text-xs font-medium text-bone shadow-md"
          >
            {label}
            <span
              aria-hidden="true"
              className={`absolute left-1/2 size-1.5 -translate-x-1/2 rotate-45 bg-navy ${
                coords.below ? '-top-0.5' : '-bottom-0.5'
              }`}
            />
          </span>,
          document.body,
        )}
    </span>
  );
}
