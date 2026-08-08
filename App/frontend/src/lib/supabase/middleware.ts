import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Claims custom del JWT relevantes para este proyecto — agregados por el
 * Auth Hook `custom_access_token_hook` en Supabase (backend, Fase 1 Día 5 /
 * Fase 2 Día 8: `prisma/migrations/*_rls_multisede` y
 * `*_auth_hook_rol_claim`). `rol` coincide 1:1 con el enum `RolUsuario` de
 * Prisma (`ALUMNO | MAESTRO | ADMINISTRATIVO`) — OJO: no confundir con
 * `PerfilAdministrativo.nivelPermiso` (`SUPER_ADMIN | ADMIN | AUXILIAR`,
 * todavía no sincronizado al JWT, ver Fase 4).
 */
export type SigeJwtClaims = {
  sub: string;
  rol?: string;
  sede_id?: string;
  [key: string]: unknown;
};

/**
 * Refresca la sesión de Supabase (cookie-based, SSR-safe) y devuelve los
 * claims del JWT ya verificados contra el JWKS del proyecto.
 *
 * Se usa dentro de `src/proxy.ts` (Next.js 16 renombró `middleware.ts` a
 * `proxy.ts` — ver `node_modules/next/dist/docs/.../proxy.md`). Aislado en
 * su propio módulo (en vez de vivir directo en `proxy.ts`) porque
 * `proxy.ts` sólo debe tener la política de rutas/redirecciones (crece en
 * Día 12 con el flujo de `primer_ingreso`); esto es infraestructura pura
 * de Supabase.
 *
 * `getClaims()` — no `getSession()` ni decodificar el JWT a mano — porque
 * verifica la firma contra el JWKS (asimétrico) del proyecto, igual que
 * `verifyCredentials` en `SedeGuard`/`RolesGuard` del backend. Esto es el
 * check "optimista" que recomienda la guía de autenticación de Next.js para
 * Proxy (activo/inactivo con sesión, según rol) — la verificación "segura"
 * de negocio sigue viviendo en el backend (NestJS + RLS).
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value),
          );
        },
      },
    },
  );

  const { data, error } = await supabase.auth.getClaims();

  return {
    supabaseResponse,
    claims: (data?.claims ?? null) as SigeJwtClaims | null,
    error,
  };
}
