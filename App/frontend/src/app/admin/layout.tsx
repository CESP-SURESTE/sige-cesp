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
 */
export default async function AdminLayout(props: LayoutProps<'/admin'>) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === 'string' ? data.claims.email : null;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-linea bg-paper px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="font-display text-sm font-semibold tracking-[0.14em] text-maya uppercase">
              SIGE
            </span>
            <span className="text-sm font-medium text-ink/80">Panel administrativo</span>
            <VolverAlPanel />
          </div>
          <div className="flex items-center gap-4">
            {email && <span className="text-sm text-ink/60">{email}</span>}
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 p-6">{props.children}</main>
    </div>
  );
}
