'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';

const STORAGE_KEY = 'sige-admin-sidebar-colapsado';

// Store externo minúsculo sobre `localStorage` — leído vía
// `useSyncExternalStore` (hook nativo de React, sin librería nueva) en vez
// de "leer en un efecto + setState" (ese patrón dispara
// `react-hooks/set-state-in-effect` del linter del proyecto, además de ser
// el hack clásico contra mismatch de hidratación que React ya resuelve
// mejor con este hook: `getServerSnapshot` devuelve el valor por default
// durante SSR, el cliente sincroniza solo, sin efecto ni parpadeo).
const listeners = new Set<() => void>();

function leerPersistido(): boolean {
  return window.localStorage.getItem(STORAGE_KEY) === '1';
}

function snapshotServidor(): boolean {
  return false; // SSR no tiene `localStorage` — arranca expandido, igual que antes.
}

function suscribir(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function guardarPersistido(valor: boolean) {
  window.localStorage.setItem(STORAGE_KEY, valor ? '1' : '0');
  listeners.forEach((callback) => callback());
}

/**
 * Estado del sidebar admin — rediseño de navegación, 2026-08-14.
 *
 * Dos estados independientes a propósito, no un solo booleano "abierto":
 * - `colapsado` (desktop, ≥1024px vía CSS/Tailwind `lg:`, ver `AdminShell`):
 *   riel de íconos vs. sidebar completo. Persiste en `localStorage` — es una
 *   preferencia de trabajo del usuario (igual que colapsar un sidebar en
 *   cualquier IDE), no algo que deba resetearse cada navegación.
 * - `abiertoMobile`: el drawer off-canvas en pantallas angostas. NUNCA se
 *   persiste — cada carga/navegación en mobile arranca cerrado, es
 *   transitorio por diseño (abrir el drawer es una acción de "ahora", no una
 *   preferencia).
 *
 * `abiertoMobile` se cierra solo al cambiar de ruta (`usePathname`), con el
 * patrón de "ajustar estado durante el render" que ya usa el resto del
 * proyecto (en vez de un efecto que llama `setState`, ver nota de QA/lint
 * del Día 19) — comparar contra el pathname anterior guardado en estado y
 * corregir en el mismo render, sin pasar por un ciclo de efecto extra.
 */
export function useSidebarState() {
  const pathname = usePathname();
  const colapsado = useSyncExternalStore(suscribir, leerPersistido, snapshotServidor);
  const [abiertoMobile, setAbiertoMobile] = useState(false);
  const [pathnamePrevio, setPathnamePrevio] = useState(pathname);

  if (pathname !== pathnamePrevio) {
    setPathnamePrevio(pathname);
    setAbiertoMobile(false);
  }

  // Bloquea el scroll del body mientras el drawer mobile está abierto — si
  // no, el contenido detrás del backdrop se desplaza junto con el drawer,
  // una fricción común en overlays mal hechos. Esto sí es un efecto legítimo
  // (sincroniza con el DOM fuera de React, no "espeja" un valor hacia
  // estado), no lo alcanza la regla de arriba.
  useEffect(() => {
    if (!abiertoMobile) return;
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previo;
    };
  }, [abiertoMobile]);

  const setColapsado = useCallback((valor: boolean) => {
    guardarPersistido(valor);
  }, []);

  return { colapsado, setColapsado, abiertoMobile, setAbiertoMobile };
}
