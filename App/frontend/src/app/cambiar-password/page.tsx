'use client';

import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { login } from '@/lib/api/auth';
import { cambiarPassword } from '@/lib/api/cambiar-password';
import { ApiError } from '@/lib/api/http';
import { createClient } from '@/lib/supabase/client';
import { PasswordStrengthMeter } from '@/components/PasswordStrengthMeter';
import {
  POLITICA_PASSWORD_HABILITADA,
  primerRequisitoFaltante,
} from '@/lib/password-policy';

/**
 * UI de cambio de contraseña — Fase 4, Día 12.
 *
 * `app/cambiar-password/` es infraestructura compartida sin dueño de
 * dominio en `AGENTS.md` (mismo criterio que `app/login/`, ver su propio
 * comentario) — construida directo, no por `admin-coder`/`alumno-coder`.
 *
 * Doble uso: (1) forzado por `src/proxy.ts` cuando el JWT trae
 * `primer_ingreso: true` (alta reciente con password temporal), y (2)
 * cambio voluntario en cualquier momento — el backend
 * (`PATCH /auth/cambiar-password`) no distingue los dos casos, solo exige
 * conocer la contraseña actual.
 *
 * Tras un cambio exitoso, `primer_ingreso` pasa a `false` en la DB pero el
 * JWT ya emitido no se entera solo. La corrección de esto NO es
 * `supabase.auth.refreshSession()` (se probó y falla siempre con 400
 * `refresh_token_not_found`): Supabase Auth revoca el `refresh_token` de la
 * sesión activa como efecto colateral de `admin.updateUserById()` (lo que
 * llama el backend para cambiar la contraseña) — confirmado reproduciendo
 * el flujo completo contra la API real de Supabase, no es intermitente, es
 * determinístico. La sesión vieja queda literalmente sin refresh_token
 * válido apenas cambia la contraseña.
 * Por eso se pide una sesión NUEVA (`login()` con la contraseña ya
 * cambiada → `setSession()`), el mismo mecanismo que ya usa
 * `app/login/page.tsx` — no una llamada directa a Supabase.
 *
 * BUGS corregidos (QA manual, sesión 2026-08-12) — "cambia la contraseña
 * pero no redirige al perfil", 2 causas distintas encontradas:
 *
 * 1) Los 3 `<input>` de contraseña usaban `disabled={mutation.isPending}`.
 *    Deshabilitar un input de contraseña es justo la señal que gestores de
 *    contraseñas con overlay inline (ej. Bitwarden) usan para
 *    reposicionar/retirar su ícono inyectado en el DOM — esa mutación
 *    ocurre exactamente cuando la mutación de React Query entra en estado
 *    pending (mismo instante del submit). Fix: no deshabilitar los inputs
 *    durante el envío, solo el botón de submit (que de cualquier forma ya
 *    bloquea reenvíos).
 * 2) Con (1) ya corregido (confirmado sin la excepción de la extensión en
 *    consola), la navegación SEGUÍA sin ocurrir — `router.push('/')` +
 *    `router.refresh()` no producían ningún cambio visible, aunque el
 *    backend sí completaba el cambio (`primerIngreso: false` confirmado en
 *    DB cada vez) y navegar a mano (`window.location`/botón "atrás") sí
 *    aterrizaba en `/alumno` sin problema — descartando también una
 *    condición de carrera con la cookie de sesión (se probó esperar
 *    explícitamente el evento `onAuthStateChange` antes de navegar y el
 *    síntoma persistió idéntico). Reproducido 2 veces en limpio, sin
 *    ediciones de código de por medio, para descartar ruido de Fast
 *    Refresh. Conclusión: `router.push()` de Next.js no está completando
 *    la navegación en este flujo. Fix: navegación dura
 *    (`window.location.href`) en vez de `router.push` — fuerza un ciclo de
 *    red nuevo completo, verificado funcionando de forma consistente.
 *
 * Medidor de fortaleza + política robusta (2026-08-13, pedido del usuario,
 * "no ahora, o si puedes habilitado después") — gateado por
 * `POLITICA_PASSWORD_HABILITADA` (`lib/password-policy.ts`, default
 * `false`). Con el flag apagado esto es cosmético cero: no se renderiza el
 * medidor y el único piso sigue siendo el `minLength(8)` de siempre. Prender
 * el flag en local es la forma fácil de probarlo ahora sin afectarle nada a
 * nadie más — recordar prender también el espejo del backend
 * (`App/backend/src/auth/password-policy.ts`) antes de la entrega, son 2
 * flags independientes que hay que sincronizar a mano.
 */

const MENSAJES_ERROR: Record<string, string> = {
  UNAUTHORIZED: 'La contraseña actual es incorrecta.',
  VALIDATION_ERROR: 'La nueva contraseña debe tener al menos 8 caracteres.',
};

export default function CambiarPasswordPage() {
  const [passwordActual, setPasswordActual] = useState('');
  const [passwordNueva, setPasswordNueva] = useState('');
  const [passwordConfirmar, setPasswordConfirmar] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      // Email leído ANTES del cambio (el access_token actual sigue siendo
      // válido en ese momento — es el refresh_token el que Supabase revoca,
      // no el JWT ya emitido, que vive hasta su exp).
      const { data: sessionData } = await supabase.auth.getSession();
      const email = sessionData.session?.user.email;
      if (!email) {
        throw new Error('No hay una sesión activa. Vuelve a iniciar sesión.');
      }

      await cambiarPassword(passwordActual, passwordNueva);

      // Sesión nueva con la contraseña ya cambiada — NO refreshSession()
      // (ver comentario del componente: el refresh_token viejo queda
      // revocado por Supabase apenas cambia la contraseña).
      const loginResult = await login(email, passwordNueva);
      const { error } = await supabase.auth.setSession({
        access_token: loginResult.accessToken,
        refresh_token: loginResult.refreshToken,
      });
      if (error) {
        throw new Error(
          'La contraseña se cambió pero no se pudo iniciar la nueva sesión. Vuelve a iniciar sesión manualmente.',
        );
      }
    },
    onSuccess: () => {
      // Navegación DURA — ver comentario de cabecera del componente (bug 2).
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- justificado arriba: `router.push` no completaba la navegación en este flujo (verificado repetidamente), `window.location.href` sí.
      window.location.href = '/';
    },
    onError: (err) => {
      // Regla 12 de `CLAUDE.md` raíz — loguear el error antes de responder.
      // A diferencia de `LoginPage`, acá NO hay ninguna variable segura que
      // agregar de contexto: las 3 únicas variables de este componente son
      // las 3 contraseñas (`passwordActual`/`passwordNueva`/`passwordConfirmar`),
      // ninguna debe llegar jamás a la consola. Se loguea solo `err`.
      console.error('[CambiarPasswordPage] Error al cambiar contraseña:', err);
      const mensaje =
        err instanceof ApiError
          ? (MENSAJES_ERROR[err.code] ?? 'Ocurrió un error inesperado. Intenta de nuevo.')
          : err.message;
      toast.error(mensaje);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.reset();

    if (passwordNueva.length < 8) {
      toast.error('La nueva contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (POLITICA_PASSWORD_HABILITADA) {
      const faltante = primerRequisitoFaltante(passwordNueva);
      if (faltante) {
        toast.error(faltante);
        return;
      }
    }
    if (passwordNueva !== passwordConfirmar) {
      toast.error('Las contraseñas nuevas no coinciden.');
      return;
    }

    mutation.mutate();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm rounded-lg border-l-4 border-navy bg-white px-6 py-8 shadow-sm">
        <p className="font-display text-sm font-semibold tracking-[0.14em] text-navy uppercase">
          SIGE
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-slate">Cambiar contraseña</h1>
        <p className="mt-1 text-sm text-slate/60">
          Si es tu primer ingreso, debes completar este paso antes de continuar.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
          <div>
            <label htmlFor="passwordActual" className="block text-sm font-medium text-slate/80">
              Contraseña actual
            </label>
            <input
              id="passwordActual"
              type="password"
              autoComplete="current-password"
              required
              value={passwordActual}
              onChange={(e) => setPasswordActual(e.target.value)}
              className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="passwordNueva" className="block text-sm font-medium text-slate/80">
              Contraseña nueva
            </label>
            <input
              id="passwordNueva"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={passwordNueva}
              onChange={(e) => setPasswordNueva(e.target.value)}
              className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none"
            />
            {POLITICA_PASSWORD_HABILITADA && (
              <PasswordStrengthMeter password={passwordNueva} />
            )}
          </div>

          <div>
            <label htmlFor="passwordConfirmar" className="block text-sm font-medium text-slate/80">
              Confirmar contraseña nueva
            </label>
            <input
              id="passwordConfirmar"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={passwordConfirmar}
              onChange={(e) => setPasswordConfirmar(e.target.value)}
              className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={mutation.isPending}
            className="w-full rounded-lg bg-navy px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
          >
            {mutation.isPending ? 'Guardando…' : 'Cambiar contraseña'}
          </button>
        </form>
      </div>
    </main>
  );
}
