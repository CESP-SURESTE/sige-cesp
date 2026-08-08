import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

/**
 * Fase 2, Día 9 — proteccion de rutas por rol.
 *
 * OJO nomenclatura: este archivo es el "middleware" del roadmap, pero en
 * Next.js 16 el file convention se renombró de `middleware.ts` a
 * `proxy.ts` (export `proxy`, no `middleware`) — ver
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`.
 * Mismo mecanismo (corre en Node.js runtime antes de renderizar), solo
 * cambia el nombre del archivo/función.
 *
 * Esto es un check OPTIMISTA (lee la sesión de la cookie, verificada contra
 * el JWKS pero sin volver a pegarle a la DB) — sirve para redirigir antes
 * de renderizar. La verificación SEGURA de negocio (sede, permisos reales)
 * sigue viviendo en el backend (SedeGuard + RolesGuard + RLS). Ver guía de
 * autenticación de Next.js, sección "Optimistic checks with Proxy".
 */

type Rol = 'ALUMNO' | 'MAESTRO' | 'ADMINISTRATIVO';

const ROLES_VALIDOS: readonly Rol[] = ['ALUMNO', 'MAESTRO', 'ADMINISTRATIVO'];

const HOME_POR_ROL: Record<Rol, string> = {
  ALUMNO: '/alumno',
  MAESTRO: '/maestro',
  ADMINISTRATIVO: '/admin',
};

const ROL_POR_PREFIJO: { prefijo: string; rol: Rol }[] = [
  { prefijo: '/admin', rol: 'ADMINISTRATIVO' },
  { prefijo: '/maestro', rol: 'MAESTRO' },
  { prefijo: '/alumno', rol: 'ALUMNO' },
];

// `app/login/` es solo del usuario (regla 11 de CLAUDE.md) — no vive bajo
// admin/alumno. `/no-autorizado` tiene que quedar accesible para cualquier
// sesión (o ninguna), si no, redirigir ahí terminaría en loop.
const RUTAS_PUBLICAS = ['/login', '/no-autorizado'];

function esRolValido(valor: unknown): valor is Rol {
  return typeof valor === 'string' && (ROLES_VALIDOS as string[]).includes(valor);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { supabaseResponse, claims } = await updateSession(request);

  const rol = esRolValido(claims?.rol) ? claims!.rol : null;
  // Sesión sin `rol` en el claim (usuario sin fila en `usuarios`, ver
  // Auth Hook) se trata como no autenticado para efectos de ruteo: no hay
  // ninguna sección de la app a la que darle acceso.
  const autenticado = rol !== null;

  if (RUTAS_PUBLICAS.includes(pathname)) {
    if (autenticado && pathname === '/login') {
      return NextResponse.redirect(new URL(HOME_POR_ROL[rol], request.url));
    }
    return supabaseResponse;
  }

  if (!autenticado) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (pathname === '/') {
    return NextResponse.redirect(new URL(HOME_POR_ROL[rol], request.url));
  }

  const seccion = ROL_POR_PREFIJO.find(
    ({ prefijo }) => pathname === prefijo || pathname.startsWith(`${prefijo}/`),
  );

  if (seccion && seccion.rol !== rol) {
    return NextResponse.redirect(new URL('/no-autorizado', request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Todo excepto assets estáticos, optimización de imágenes y archivos
    // con extensión (favicon, etc.) — patrón recomendado por la doc de
    // Next.js para Proxy.
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
