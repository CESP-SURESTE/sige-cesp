'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { login } from '@/lib/api/auth';
import { cambiarPassword } from '@/lib/api/cambiar-password';
import { ApiError } from '@/lib/api/http';
import { createClient } from '@/lib/supabase/client';

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
 */

const MENSAJES_ERROR: Record<string, string> = {
  UNAUTHORIZED: 'La contraseña actual es incorrecta.',
  VALIDATION_ERROR: 'La nueva contraseña debe tener al menos 8 caracteres.',
};

export default function CambiarPasswordPage() {
  const router = useRouter();
  const [passwordActual, setPasswordActual] = useState('');
  const [passwordNueva, setPasswordNueva] = useState('');
  const [passwordConfirmar, setPasswordConfirmar] = useState('');
  const [errorLocal, setErrorLocal] = useState<string | null>(null);

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
      router.push('/');
      router.refresh();
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorLocal(null);
    mutation.reset();

    if (passwordNueva.length < 8) {
      setErrorLocal('La nueva contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (passwordNueva !== passwordConfirmar) {
      setErrorLocal('Las contraseñas nuevas no coinciden.');
      return;
    }

    mutation.mutate();
  }

  const mensajeError =
    errorLocal ??
    (mutation.error
      ? mutation.error instanceof ApiError
        ? (MENSAJES_ERROR[mutation.error.code] ?? 'Ocurrió un error inesperado. Intenta de nuevo.')
        : mutation.error.message
      : null);

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold">SIGE · Cambiar contraseña</h1>
        <p className="mt-1 text-sm text-gray-500">
          Si es tu primer ingreso, debes completar este paso antes de continuar.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
          <div>
            <label htmlFor="passwordActual" className="block text-sm font-medium text-gray-700">
              Contraseña actual
            </label>
            <input
              id="passwordActual"
              type="password"
              autoComplete="current-password"
              required
              value={passwordActual}
              onChange={(e) => setPasswordActual(e.target.value)}
              disabled={mutation.isPending}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none disabled:opacity-50"
            />
          </div>

          <div>
            <label htmlFor="passwordNueva" className="block text-sm font-medium text-gray-700">
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
              disabled={mutation.isPending}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none disabled:opacity-50"
            />
          </div>

          <div>
            <label htmlFor="passwordConfirmar" className="block text-sm font-medium text-gray-700">
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
              disabled={mutation.isPending}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none disabled:opacity-50"
            />
          </div>

          {mensajeError && (
            <p role="alert" className="text-sm text-red-600">
              {mensajeError}
            </p>
          )}

          <button
            type="submit"
            disabled={mutation.isPending}
            className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {mutation.isPending ? 'Guardando…' : 'Cambiar contraseña'}
          </button>
        </form>
      </div>
    </main>
  );
}
