'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { loginPlatformAdmin } from '@/lib/api/platform-admin';
import { ApiError } from '@/lib/api/http';
import { savePlatformToken } from '@/lib/api/platform-http';

const MENSAJES_ERROR: Record<string, string> = {
  UNAUTHORIZED: 'Correo o contraseña incorrectos.',
  RATE_LIMIT_EXCEEDED: 'Demasiados intentos. Espera un minuto e intenta de nuevo.',
  VALIDATION_ERROR: 'Revisa que el correo y la contraseña sean válidos.',
};

export default function PlataformaLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { token } = await loginPlatformAdmin(email, password);
      savePlatformToken(token);
    },
    onSuccess: () => {
      router.push('/plataforma');
    },
    onError: (err) => {
      // Regla 12 de `CLAUDE.md` raíz — nunca loguear `password`, solo el
      // email intentado (útil para debug: "¿a qué cuenta se le negó el
      // acceso?" sin exponer la credencial).
      console.error('[PlataformaLoginPage] Error al iniciar sesión:', { email, err });
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
        <p className="font-display text-sm font-semibold tracking-[0.14em] text-navy uppercase">
          SIGE · Plataforma
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-slate">Iniciar sesión</h1>
        <p className="mt-1 text-sm text-slate/60">Panel de administración de plataforma</p>

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
