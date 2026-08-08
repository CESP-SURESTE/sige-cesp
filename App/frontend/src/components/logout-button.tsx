'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Botón de logout — Fase 2, Día 10.
 *
 * Vive fuera de `components/{admin,alumno}/ui/` a propósito: es
 * infraestructura de sesión compartida (mismo criterio que
 * `src/proxy.ts`/`lib/supabase/*`, sin dueño de dominio en `AGENTS.md`), no
 * un componente de negocio de un rol — usarlo desde `app/admin/layout.tsx`,
 * `app/alumno/layout.tsx` y `app/maestro/layout.tsx` no viola la regla 11
 * de `CLAUDE.md` (esa regla prohíbe compartir UI de negocio entre árboles,
 * no infraestructura transversal como esta o como `createClient()`).
 *
 * `supabase.auth.signOut()` invalida la sesión local (y el refresh token en
 * Supabase Auth) y limpia las cookies que lee `src/lib/supabase/middleware.ts`.
 * `router.push` + `router.refresh()` (no `window.location.assign`, ver
 * ESLint `@next/next/no-location-assign-relative-destination`): `proxy.ts`
 * corre igual en la navegación del lado del cliente (App Router pasa por el
 * proxy en cada fetch de RSC, no solo en hard navigation) y `refresh()`
 * fuerza a invalidar cualquier RSC cacheado con la sesión vieja.
 */
export function LogoutButton() {
  const router = useRouter();
  const [cerrando, setCerrando] = useState(false);

  async function handleLogout() {
    setCerrando(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={cerrando}
      className="text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50"
    >
      {cerrando ? 'Cerrando sesión…' : 'Cerrar sesión'}
    </button>
  );
}
