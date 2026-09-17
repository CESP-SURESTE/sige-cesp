'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { completarReseteo } from '@/lib/api/auth';
import { createClient } from '@/lib/supabase/client';

/**
 * Página pública — el link de correo generado por
 * `PersonasService.resetearPassword` (`client.auth.admin.generateLink`,
 * `type: 'recovery'`) redirige aquí. Supabase establece la sesión de
 * recuperación automáticamente en la URL (el cliente de
 * `lib/supabase/client.ts` usa `createBrowserClient`, que detecta la sesión
 * en la URL por defecto) — esta página solo espera a que esa sesión quede
 * lista, pide la contraseña nueva, y llama `supabase.auth.updateUser()`
 * DIRECTO desde el navegador (sin backend de por medio para el cambio real).
 *
 * Agregada a `RUTAS_PUBLICAS` en `src/proxy.ts` — se renderiza sin importar
 * el estado de autenticación (la sesión de recuperación SÍ cuenta como
 * "autenticada" para los claims del JWT que lee el middleware).
 *
 * IMPORTANTE (hallazgo Important 1 de la revisión final de rama, 2026-09-16):
 * NO basta con `getSession()` para decidir si mostrar el form — cualquier
 * usuario YA logueado (sesión normal, no de recovery) tiene una sesión
 * válida y pasaría ese check igual, pudiendo cambiar su propia contraseña
 * sin dar la actual (exactamente lo que `PATCH /auth/cambiar-password` sí
 * exige). La única señal confiable de que el navegador acaba de establecer
 * una sesión de RECOVERY (no una sesión normal ya existente) es el evento
 * `PASSWORD_RECOVERY` de `onAuthStateChange`, que Supabase emite una sola
 * vez al procesar el link — de ahí el timeout corto: si ese evento nunca
 * llega (porque no hay sesión, porque es una sesión normal, o porque el link
 * ya se usó/expiró), el estado cae a `invalida` en vez de quedarse esperando
 * para siempre.
 */
type Estado = 'verificando' | 'lista' | 'invalida' | 'enviando' | 'completa';

const TIMEOUT_VERIFICACION_MS = 8000;

export default function RestablecerPasswordPage() {
  const [estado, setEstado] = useState<Estado>('verificando');
  const [password, setPassword] = useState('');
  const [confirmarPassword, setConfirmarPassword] = useState('');

  useEffect(() => {
    const supabase = createClient();
    let resuelto = false;

    const timeout = setTimeout(() => {
      if (resuelto) return;
      resuelto = true;
      console.error(
        '[RestablecerPasswordPage] Nunca llegó el evento PASSWORD_RECOVERY antes del timeout — enlace inválido/expirado o sesión no es de recuperación.',
      );
      setEstado('invalida');
    }, TIMEOUT_VERIFICACION_MS);

    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (resuelto) return;
      if (event === 'PASSWORD_RECOVERY') {
        resuelto = true;
        clearTimeout(timeout);
        setEstado('lista');
      }
    });

    return () => {
      clearTimeout(timeout);
      subscription.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (password.length < 8) {
      toast.error('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== confirmarPassword) {
      toast.error('Las contraseñas no coinciden.');
      return;
    }

    setEstado('enviando');
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      console.error(
        '[RestablecerPasswordPage] Error al actualizar la contraseña:',
        error,
      );
      toast.error('No se pudo actualizar la contraseña. Intenta de nuevo.');
      setEstado('lista');
      return;
    }

    try {
      await completarReseteo();
    } catch (err) {
      // Best-effort — la contraseña ya quedó bien puesta en Supabase Auth,
      // no se bloquea al usuario por esto (regla 12, loguear igual).
      console.error(
        '[RestablecerPasswordPage] La contraseña se actualizó pero falló completar-reseteo:',
        err,
      );
    }

    // Important 3 (revisión final de rama, 2026-09-16): `updateUser()` NO
    // emite un access token nuevo — el claim `primer_ingreso` de la cookie
    // sigue reflejando el valor de cuando se abrió el link de recovery. El
    // backend ya limpió la columna real en `completarReseteo()`, pero sin
    // forzar un refresh el proxy sigue viendo el JWT viejo y puede rebotar a
    // la persona a `/cambiar-password` justo después de terminar el reseteo.
    // `refreshSession()` fuerza al Auth Hook a releer la DB y emitir un JWT
    // con `primer_ingreso` actualizado. Se llama pase lo que pase con
    // `completarReseteo()` (best-effort, no bloquea la navegación).
    try {
      await supabase.auth.refreshSession();
    } catch (err) {
      console.error(
        '[RestablecerPasswordPage] Falló refreshSession tras el reseteo:',
        err,
      );
    }

    setEstado('completa');
    toast.success('Contraseña actualizada.');
    // `window.location.href` (no `router.push`+`router.refresh()`) — fuerza
    // una navegación completa que relee la cookie de sesión ya refrescada
    // desde cero, en vez de depender del cache del router de Next.js.
    window.location.href = '/';
  }

  if (estado === 'verificando') {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <p className="text-sm text-slate/60">Verificando enlace…</p>
      </main>
    );
  }

  if (estado === 'invalida') {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
          <h1 className="font-display text-xl font-semibold text-slate">
            Enlace inválido o expirado
          </h1>
          <p className="mt-2 text-sm text-slate/70">
            Pide a un administrativo que genere un nuevo enlace de
            restablecimiento.
          </p>
        </div>
      </main>
    );
  }

  // Minor de la revisión final de rama, 2026-09-16 — rama de render propia
  // en vez de dejar el form re-habilitado visible durante la navegación a
  // `window.location.href = '/'` (que no es instantánea).
  if (estado === 'completa') {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
          <h1 className="font-display text-xl font-semibold text-slate">
            Contraseña actualizada
          </h1>
          <p className="mt-2 text-sm text-slate/70">Redirigiendo…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg">
        <h1 className="font-display text-xl font-semibold text-slate">
          Elige tu nueva contraseña
        </h1>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate/80">
              Contraseña nueva
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={estado === 'enviando'}
              className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none disabled:opacity-50"
            />
          </div>
          <div>
            <label htmlFor="confirmar" className="block text-sm font-medium text-slate/80">
              Confirmar contraseña
            </label>
            <input
              id="confirmar"
              type="password"
              autoComplete="new-password"
              required
              value={confirmarPassword}
              onChange={(e) => setConfirmarPassword(e.target.value)}
              disabled={estado === 'enviando'}
              className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none disabled:opacity-50"
            />
          </div>
          <button
            type="submit"
            disabled={estado === 'enviando'}
            className="w-full rounded-lg bg-navy px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
          >
            {estado === 'enviando' ? 'Guardando…' : 'Guardar contraseña'}
          </button>
        </form>
      </div>
    </main>
  );
}
