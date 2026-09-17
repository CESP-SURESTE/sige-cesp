'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
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
 */
type Estado = 'verificando' | 'lista' | 'invalida' | 'enviando' | 'completa';

export default function RestablecerPasswordPage() {
  const router = useRouter();
  const [estado, setEstado] = useState<Estado>('verificando');
  const [password, setPassword] = useState('');
  const [confirmarPassword, setConfirmarPassword] = useState('');

  useEffect(() => {
    const supabase = createClient();
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error || !data.session) {
          console.error(
            '[RestablecerPasswordPage] Sin sesión de recuperación válida:',
            error,
          );
          setEstado('invalida');
          return;
        }
        setEstado('lista');
      })
      .catch((err: unknown) => {
        console.error(
          '[RestablecerPasswordPage] Error verificando la sesión de recuperación:',
          err,
        );
        setEstado('invalida');
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

    setEstado('completa');
    toast.success('Contraseña actualizada.');
    router.push('/');
    router.refresh();
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
