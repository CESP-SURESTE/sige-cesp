'use client';

import { useCallback, useState } from 'react';

/**
 * `usePaginacionFiltrada` — Fase 5, Día 19.
 *
 * Estado de `estatus`/`page` compartido entre `app/admin/alumnos/page.tsx` y
 * `app/admin/maestros/page.tsx` — cualquier cambio en `buscar` (debounced,
 * ver `useBuscarDebounced`) o en `estatus` resetea `page` a 1 (evita quedar
 * "atrapado" en una página que ya no existe tras filtrar/buscar de nuevo).
 * `limit` fijo en 10 (bajado de 20 el 2026-08-18, a pedido explícito del
 * usuario — evitar downscroll innecesario dentro de la tarjeta; el backend
 * sigue defaulteando a 20 si no se manda `limit`, `ListarPersonasQueryDto`,
 * pero el frontend siempre lo manda explícito) — sin selector de tamaño de
 * página, fuera de alcance ("paginación simple").
 *
 * El reset de `page` por cambio de `buscar` se hace con el patrón "ajustar
 * estado durante el render" (React docs, "Adjusting some state when a prop
 * changes") en vez de un `useEffect` — evita el render en cascada que
 * `eslint-plugin-react-hooks` (`react-hooks/set-state-in-effect`) marca como
 * error al llamar `setState` síncrono dentro de un efecto.
 */
export function usePaginacionFiltrada(buscar: string, limit = 10) {
  const [estatus, setEstatusState] = useState('');
  const [page, setPage] = useState(1);
  const [prevBuscar, setPrevBuscar] = useState(buscar);

  if (buscar !== prevBuscar) {
    setPrevBuscar(buscar);
    setPage(1);
  }

  // Cambiar `estatus` también resetea `page` a 1 — acá sí es seguro hacerlo
  // en un manejador de evento (no un efecto), no dispara el mismo warning.
  const setEstatus = useCallback((valor: string) => {
    setEstatusState(valor);
    setPage(1);
  }, []);

  return { estatus, setEstatus, page, setPage, limit };
}
