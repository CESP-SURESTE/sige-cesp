'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { login } from '@/lib/api/auth';
import { ApiError } from '@/lib/api/http';
import { createClient } from '@/lib/supabase/client';

/**
 * UI de login — Fase 2, Día 10 (reemplaza el stub de Día 9).
 *
 * `app/login/` es infraestructura compartida sin dueño de dominio en
 * `AGENTS.md` (ver nota QA de Día 9 en `documentacion_de_agentes/ESTADO.md`)
 * — construido directo, igual que `src/proxy.ts`.
 *
 * Flujo: `POST /auth/login` al backend (contrato `{ data }`/`{ error, code }`,
 * incluye rate limiting y manejo de `CUENTA_BLOQUEADA` — no se llama a
 * Supabase directo desde el navegador para no saltarse esas dos capas) →
 * con los tokens que devuelve, `supabase.auth.setSession()` persiste la
 * sesión en cookies (mismo mecanismo que lee `src/proxy.ts`) → recarga
 * navegación a `/`, que `src/proxy.ts` redirige a la home del rol —
 * `router.push` + `router.refresh()`, no `window.location.assign` (ver
 * ESLint `@next/next/no-location-assign-relative-destination`): el proxy
 * corre igual en la navegación del cliente, y `refresh()` invalida
 * cualquier RSC cacheado de antes de tener sesión.
 */

const MENSAJES_ERROR: Record<string, string> = {
  UNAUTHORIZED: 'Correo o contraseña incorrectos.',
  CUENTA_BLOQUEADA: 'Esta cuenta está bloqueada. Contacta al administrador.',
  CORREO_NO_CONFIRMADO: 'Debes confirmar tu correo antes de iniciar sesión.',
  RATE_LIMIT_EXCEEDED: 'Demasiados intentos. Espera un minuto e intenta de nuevo.',
  VALIDATION_ERROR: 'Revisa que el correo y la contraseña sean válidos.',
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const result = await login(email, password);
      const supabase = createClient();
      const { error } = await supabase.auth.setSession({
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
      });
      if (error) {
        throw new Error(
          'La sesión se validó pero no se pudo guardar en el navegador. Intenta de nuevo.',
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
    mutation.reset();
    mutation.mutate();
  }

  const mensajeError = mutation.error
    ? mutation.error instanceof ApiError
      ? (MENSAJES_ERROR[mutation.error.code] ?? 'Ocurrió un error inesperado. Intenta de nuevo.')
      : mutation.error.message
    : null;

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold">SIGE · Iniciar sesión</h1>
        <p className="mt-1 text-sm text-gray-500">Sistema de Gestión Escolar — CESP</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              Correo
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={mutation.isPending}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none disabled:opacity-50"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
            {mutation.isPending ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </main>
  );
}
