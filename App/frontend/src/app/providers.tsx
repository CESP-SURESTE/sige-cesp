'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

/**
 * Provider de React Query — Fase 2, Día 10 (`CLAUDE.md`: "React Query, no
 * fetch nativo suelto"). Client Component obligatorio porque `QueryClient`
 * no es serializable entre servidor y cliente en el App Router.
 *
 * `useState(() => new QueryClient())` en vez de una instancia a nivel de
 * módulo: evita compartir el mismo `QueryClient` (y su caché) entre
 * requests distintos en el servidor durante SSR — cada árbol de React
 * necesita el suyo. Patrón recomendado por la propia documentación de
 * TanStack Query para App Router.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
