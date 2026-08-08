import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Cliente de Supabase para Server Components, Server Actions y Route
 * Handlers — lee/escribe la sesión desde las cookies de Next.js
 * (`next/headers`). Crear uno nuevo por request, nunca compartirlo entre
 * requests (recomendación oficial de `@supabase/ssr`).
 *
 * Para leer la sesión de forma segura (verificada contra el JWKS del
 * proyecto, no solo decodificada), usar `supabase.auth.getClaims()` — mismo
 * mecanismo que `SedeGuard`/`RolesGuard` en el backend (NestJS), que
 * verifican el JWT contra `SUPABASE_JWKS_URL` en vez de confiar en el
 * payload sin firma.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // `setAll` puede fallar si se llama desde un Server Component
            // (no puede escribir cookies fuera de Server Actions/Route
            // Handlers). Es seguro ignorarlo mientras `proxy.ts` refresque
            // la sesión en cada request — ver src/lib/supabase/middleware.ts.
          }
        },
      },
    },
  );
}
