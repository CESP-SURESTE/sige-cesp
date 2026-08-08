import { createClient } from '@/lib/supabase/server';
import { LogoutButton } from '@/components/logout-button';

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
      <header className="border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">SIGE · Panel administrativo</span>
          <div className="flex items-center gap-4">
            {email && <span className="text-sm text-gray-500">{email}</span>}
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 p-6">{props.children}</main>
    </div>
  );
}
