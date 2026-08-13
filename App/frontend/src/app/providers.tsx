'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Toaster } from 'sonner';

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
 *
 * `<Toaster />` (2026-08-13) vive acá y no en `layout.tsx` porque ya es un
 * Client Component — un solo montaje para toda la app (infra sin dueño de
 * dominio, regla 11 no aplica: no es un componente de admin ni de alumno,
 * es el mecanismo de notificación transversal).
 *
 * Theming vía `toastOptions.classNames` (Tailwind, con `!important` porque
 * sonner aplica su color base como `style` inline y una clase normal no le
 * gana especificidad) en vez de las variables CSS de tema de sonner
 * (`--success-bg`, etc.) — se intentó ese camino primero en `globals.css`
 * pero QA (2026-08-13, `qa-frontend`) encontró que rompía por 2 causas: (1)
 * los nombres de esas variables coinciden 1-a-1 con los tokens ya
 * declarados en `:root` (`--success-bg`, `--error-bg`...), así que
 * `--success-bg: var(--success-bg)` dentro de `[data-sonner-toaster]` es una
 * autorreferencia cíclica de CSS (inválida por spec, no un alias — no
 * hereda el valor del `:root`), y (2) sonner solo pinta esas variables por
 * tipo de toast cuando `richColors` está activo, que nunca se prendió. Las
 * clases de Tailwind evitan ambos problemas de raíz: reutilizan los mismos
 * tokens (`bg-success-bg`, `text-crimson`, etc.) ya usados en el resto de la
 * app, sin variables CSS nuevas que puedan chocar de nombre.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster
        position="top-right"
        toastOptions={{
          classNames: {
            toast: '!rounded-lg !border !bg-bone !text-slate !border-mist !shadow-sm',
            title: '!font-sans !text-sm',
            success: '!bg-success-bg !border-success-border !text-success',
            error: '!bg-error-bg !border-error-border !text-crimson',
            warning: '!bg-warning-bg !border-warning-border !text-warning',
          },
        }}
      />
    </QueryClientProvider>
  );
}
