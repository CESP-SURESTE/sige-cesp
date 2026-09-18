'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { completarReseteo } from '@/lib/api/auth';
import { createClient } from '@/lib/supabase/client';

/**
 * Página pública — el link de correo generado por
 * `PersonasService.resetearPassword` redirige aquí con `?token_hash=...&
 * type=recovery` (query params propios nuestros, no el `action_link` que
 * hostea Supabase en `/auth/v1/verify`).
 *
 * Agregada a `RUTAS_PUBLICAS` en `src/proxy.ts` — se renderiza sin importar
 * el estado de autenticación (la sesión de recuperación SÍ cuenta como
 * "autenticada" para los claims del JWT que lee el middleware).
 *
 * IMPORTANTE — por qué NO se usa `action_link` + detección automática por
 * `onAuthStateChange` (como en un primer intento de esta página, revertido):
 * `action_link` redirige con la sesión ya armada en el FRAGMENTO de la URL
 * (`#access_token=...&type=recovery`, flujo "implicit"), pero
 * `createClient()` (`lib/supabase/client.ts`, `createBrowserClient` de
 * `@supabase/ssr`) fuerza `flowType: 'pkce'` sin forma de overridearlo —
 * `createBrowserClient.js` pisa cualquier `flowType` recibido en options. El
 * cliente en modo PKCE rechaza internamente cualquier callback "implicit" en
 * silencio (solo loguea vía `_debug`, apagado por default): el evento
 * `PASSWORD_RECOVERY` nunca llega, sin importar cuánto se espere.
 *
 * `supabase.auth.verifyOtp({ token_hash, type: 'recovery' })` no depende de
 * `flowType` ni de parsear el fragmento — funciona igual con el cliente en
 * PKCE, y devuelve éxito/error directo (sin necesidad de un timeout
 * arbitrario ni de escuchar un evento que podría no llegar).
 *
 * Se sigue validando (hallazgo Important 1 de la revisión final de rama,
 * 2026-09-16) que la sesión activa sea REALMENTE de recuperación: NO basta
 * con `getSession()` — un usuario ya logueado con una sesión normal pasaría
 * ese check igual, pudiendo cambiar su contraseña sin dar la actual (lo que
 * `PATCH /auth/cambiar-password` sí exige). `verifyOtp` con `type:
 * 'recovery'` cumple el mismo rol que antes cumplía esperar el evento
 * `PASSWORD_RECOVERY`: solo resuelve con éxito si el token es válido y es de
 * tipo recovery.
 */
type Estado = 'verificando' | 'lista' | 'invalida' | 'enviando' | 'completa';

export default function RestablecerPasswordPage() {
  const [estado, setEstado] = useState<Estado>('verificando');
  const [password, setPassword] = useState('');
  const [confirmarPassword, setConfirmarPassword] = useState('');

  useEffect(() => {
    const supabase = createClient();
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get('token_hash');
    const type = params.get('type');

    if (!tokenHash || type !== 'recovery') {
      console.error(
        '[RestablecerPasswordPage] Falta token_hash o type=recovery en la URL — enlace inválido.',
      );
      // Mismo criterio ya aceptado en este proyecto para un `setState`
      // síncrono legítimo al montar (`RelojFechaHora` en `app/login/`) — acá
      // es la validación inicial de la URL antes de intentar `verifyOtp`.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEstado('invalida');
      return;
    }

    supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' }).then(({ error }) => {
      if (error) {
        console.error(
          '[RestablecerPasswordPage] verifyOtp falló — enlace inválido/expirado:',
          error,
        );
        setEstado('invalida');
        return;
      }
      setEstado('lista');
    });
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
