import { createClient } from '@/lib/supabase/server';
import { LogoutButton } from '@/components/logout-button';

/**
 * Shell del área ALUMNO. Cuando este layout se renderiza, `src/proxy.ts` ya
 * garantizó (check optimista, cookie verificada contra el JWKS) que hay
 * sesión con rol `ALUMNO` — no se repite esa verificación aquí. Ver nota de
 * "optimistic vs secure checks" en `src/proxy.ts`.
 *
 * La verificación SEGURA de negocio (permisos reales por endpoint) sigue
 * viviendo en el backend (SedeGuard + RolesGuard + RLS); este layout solo
 * arma el shell visual del rol.
 *
 * Regla 11 de CLAUDE.md raíz: separación total admin/alumno — este archivo
 * no comparte componentes con `app/admin/layout.tsx` ni con
 * `app/maestro/layout.tsx`, aunque el mismo agente mantenga ambos roles.
 */
export default async function AlumnoLayout(props: LayoutProps<'/alumno'>) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === 'string' ? data.claims.email : null;

  return (
    <div className="flex min-h-screen flex-col bg-bone text-slate">
      <header className="border-b border-mist px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-xs font-semibold tracking-[0.14em] text-navy uppercase">
              SIGE
            </span>
            <span className="text-sm font-medium text-slate">Panel del alumno</span>
          </div>
          <div className="flex items-center gap-4">
            {email && <span className="text-sm text-slate/60">{email}</span>}
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 p-6">{props.children}</main>
    </div>
  );
}
