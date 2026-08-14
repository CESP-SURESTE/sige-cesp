import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { LogoutButton } from '@/components/logout-button';
import { VolverAlPanel } from '@/components/admin/ui/VolverAlPanel';

/**
 * Shell del área ADMINISTRATIVO. Cuando este layout se renderiza, `src/proxy.ts`
 * ya garantizó (check optimista, cookie verificada contra el JWKS) que hay
 * sesión con rol `ADMINISTRATIVO` — no se repite esa verificación aquí. Ver
 * nota de "optimistic vs secure checks" en `src/proxy.ts`.
 *
 * La verificación SEGURA de negocio (permisos reales por endpoint) sigue
 * viviendo en el backend (SedeGuard + RolesGuard + RLS); este layout solo
 * arma el shell visual del rol.
 *
 * Link "Mi perfil" (Día 18, Fase 5) — vive en el header en vez del
 * dashboard (`app/admin/page.tsx`): mismo criterio que `VolverAlPanel`,
 * debe estar accesible desde CUALQUIER página del árbol admin (ej. a mitad
 * de un formulario de alta), no solo desde la raíz. `app/admin/page.tsx`
 * sigue siendo el dashboard/menú de altas, no se convierte en perfil (a
 * diferencia de `app/alumno/page.tsx`/`app/maestro/page.tsx`).
 */
export default async function AdminLayout(props: LayoutProps<'/admin'>) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === 'string' ? data.claims.email : null;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-mist bg-bone px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="font-display text-sm font-semibold tracking-[0.14em] text-navy uppercase">
              SIGE
            </span>
            <span className="text-sm font-medium text-slate/80">Panel administrativo</span>
            <VolverAlPanel />
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/admin/perfil"
              className="text-sm font-medium text-slate/60 hover:text-navy"
            >
              Mi perfil
            </Link>
            {email && <span className="text-sm text-slate/60">{email}</span>}
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 p-6">{props.children}</main>
    </div>
  );
}
