import { createClient } from '@/lib/supabase/server';
import { Header } from '@/components/maestro/ui/shell/Header';
import { BotSoporte } from '@/components/maestro/ui/shell/BotSoporte';

/**
 * Shell del área MAESTRO. Cuando este layout se renderiza, `src/proxy.ts` ya
 * garantizó (check optimista, cookie verificada contra el JWKS) que hay
 * sesión con rol `MAESTRO` — no se repite esa verificación aquí. Ver nota de
 * "optimistic vs secure checks" en `src/proxy.ts`.
 *
 * La verificación SEGURA de negocio (permisos reales por endpoint) sigue
 * viviendo en el backend (SedeGuard + RolesGuard + RLS); este layout solo
 * arma el shell visual del rol.
 *
 * Regla 11 de CLAUDE.md raíz: separación total admin/alumno — este archivo
 * no comparte componentes con `app/admin/layout.tsx` ni con
 * `app/alumno/layout.tsx`, aunque el mismo agente mantenga ambos roles.
 *
 * Header rediseñado (2026-08-16, `components/maestro/ui/shell/Header.tsx`) —
 * mismo lenguaje visual que admin/alumno (badge de sede + dropdown de
 * perfil) pero sin sidebar propio.
 */
export default async function MaestroLayout(props: LayoutProps<'/maestro'>) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === 'string' ? data.claims.email : null;

  return (
    <div className="flex min-h-screen flex-col bg-bone text-slate">
      <Header email={email} />
      <main className="flex-1 p-6">{props.children}</main>
      <BotSoporte />
    </div>
  );
}
