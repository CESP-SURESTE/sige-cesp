import { createBrowserClient } from '@supabase/ssr';

/**
 * Cliente de Supabase para Client Components — Fase 2, Día 10.
 *
 * Usado por `app/login/page.tsx` (para `setSession()` con los tokens que
 * devuelve `POST /auth/login` del backend) y por `components/logout-button.tsx`
 * (para `signOut()`). `@supabase/ssr` maneja la persistencia en cookies del
 * navegador con el mismo formato que lee `src/lib/supabase/middleware.ts`
 * (`updateSession`) y `src/lib/supabase/server.ts` — un solo mecanismo de
 * sesión compartido entre servidor y cliente.
 *
 * No usar `supabase.auth.signInWithPassword()` directo desde aquí: el login
 * real pasa por el backend (`POST /auth/login`) para respetar el rate
 * limiting (`LoginThrottlerGuard`) y el manejo de `CUENTA_BLOQUEADA` que ya
 * viven ahí — este cliente solo persiste la sesión que el backend valida.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
