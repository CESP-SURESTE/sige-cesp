'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
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
    onError: (err) => {
      // Regla 12 de `CLAUDE.md` raíz — nunca loguear `password`, solo el
      // email intentado (útil para debug: "¿a qué cuenta se le negó el
      // acceso?" sin exponer la credencial). Mismo patrón que
      // `app/plataforma/login/page.tsx`.
      console.error('[LoginPage] Error al iniciar sesión:', { email, err });
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
    mutation.mutate();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm rounded-lg border-l-4 border-navy bg-white px-6 py-8 shadow-sm">
        {process.env.NEXT_PUBLIC_ENV_LABEL && (
          <div className="mb-4 rounded-md bg-amber-100 px-3 py-2 text-center text-xs font-bold tracking-wide text-amber-800 uppercase">
            Ambiente de {process.env.NEXT_PUBLIC_ENV_LABEL} — solo pruebas internas
          </div>
        )}
        <p className="font-display text-sm font-semibold tracking-[0.14em] text-navy uppercase">
          SIGE
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-slate">Iniciar sesión</h1>
        <p className="mt-1 text-sm text-slate/60">Sistema de Gestión Escolar — CESP</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate/80">
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
              className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none disabled:opacity-50"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate/80">
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
              className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none disabled:opacity-50"
            />
          </div>

          <button
            type="submit"
            disabled={mutation.isPending}
            className="w-full rounded-lg bg-navy px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
          >
            {mutation.isPending ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </main>
  );
}
