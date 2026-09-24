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
// `/restablecer-password` (Task 4, reseteo de contraseña disparado por
// administrativo) aterriza aquí con la sesión de recuperación que Supabase
// establece sola al abrir el link de `generateLink({ type: 'recovery' })` —
// esa sesión SÍ cuenta como "autenticada" para los claims que lee este
// middleware, así que la ruta debe quedar pública para no redirigir a la
// persona a su home antes de que pueda elegir la contraseña nueva.
const RUTAS_PUBLICAS = ['/login', '/no-autorizado', '/restablecer-password'];

// Dia 12 - primer ingreso obligatorio. `/cambiar-password` NO es publica
// (necesita sesion real para saber a quien pertenece el cambio), pero queda
// exenta del forzado de abajo para no hacer loop consigo misma. Tambien
// sirve para cambio voluntario de password despues del primer ingreso (no
// solo el forzado), por eso no se retira el acceso una vez que
// `primer_ingreso` pasa a `false`.
const RUTA_CAMBIAR_PASSWORD = '/cambiar-password';

function esRolValido(valor: unknown): valor is Rol {
  return typeof valor === 'string' && (ROLES_VALIDOS as string[]).includes(valor);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { supabaseResponse, claims } = await updateSession(request);

  // Fase 6, Día 20 — `app/plataforma` es un sistema de identidad
  // COMPLETAMENTE APARTE (regla 11 de CLAUDE.md): su JWT propio de
  // `AdminPlataforma` vive en `localStorage`, no en la sesión de Supabase
  // que este middleware entiende. Sin esta exención, cualquier visitante
  // sin sesión de Supabase caía en el branch `!autenticado` de abajo y era
  // redirigido a `/login` — nadie podía llegar nunca a `/plataforma/login`
  // ni a `/plataforma/sedes`. La protección real de esta rama vive del
  // lado del cliente (ver el `useEffect` en `app/plataforma/sedes/page.tsx`
  // que redirige a `/plataforma/login` cuando `getPlatformToken()` es
  // falsy) — este middleware no tiene nada que checar para este árbol, así
  // que se sale antes de tocar la lógica de sesión de Supabase.
  if (pathname === '/plataforma' || pathname.startsWith('/plataforma/')) {
    return supabaseResponse;
  }

  const rol = esRolValido(claims?.rol) ? claims!.rol : null;
  // Sesión sin `rol` en el claim (usuario sin fila en `usuarios`, ver
  // Auth Hook) se trata como no autenticado para efectos de ruteo: no hay
  // ninguna sección de la app a la que darle acceso.
  const autenticado = rol !== null;
  // `=== true` a proposito, no truthy: el claim viene en `null`/`undefined`
  // para JWTs sin fila en `usuarios` o emitidos antes de este cambio (Dia
  // 12, backend) - fail-open es el criterio correcto aqui porque esto es un
  // check optimista de UX (forzar el flujo de cambio de password), no un
  // limite de seguridad; RLS/guards del backend no dependen de este claim.
  const primerIngreso = claims?.primer_ingreso === true;

  if (RUTAS_PUBLICAS.includes(pathname)) {
    if (autenticado && pathname === '/login') {
      const destino = primerIngreso ? RUTA_CAMBIAR_PASSWORD : HOME_POR_ROL[rol];
      return NextResponse.redirect(new URL(destino, request.url));
    }
    return supabaseResponse;
  }

  if (!autenticado) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (primerIngreso && pathname !== RUTA_CAMBIAR_PASSWORD) {
    return NextResponse.redirect(new URL(RUTA_CAMBIAR_PASSWORD, request.url));
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
