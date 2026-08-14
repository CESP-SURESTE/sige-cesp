'use client';

import { useEffect, useState } from 'react';

/**
 * `useBuscarDebounced` — Fase 5, Día 19.
 *
 * Debounce razonable (400ms) para el input de `buscar` de
 * `app/admin/alumnos/page.tsx`/`app/admin/maestros/page.tsx` — evita
 * disparar `GET /personas` en cada tecla. Devuelve tanto el valor "en vivo"
 * del input (`inputValue`, controla el `<input>` sin lag visual) como el
 * valor debounced (`buscar`, el que realmente entra al `queryKey`/params de
 * `useQuery`).
 */
export function useBuscarDebounced(delayMs = 400) {
  const [inputValue, setInputValue] = useState('');
  const [buscar, setBuscar] = useState('');

  useEffect(() => {
    const timeout = setTimeout(() => {
      setBuscar(inputValue.trim());
    }, delayMs);
    return () => clearTimeout(timeout);
  }, [inputValue, delayMs]);

  return { inputValue, setInputValue, buscar };
}
