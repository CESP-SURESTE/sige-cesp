import { createClient } from '@/lib/supabase/server';
import { AdminShell } from '@/components/admin/ui/shell/AdminShell';

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
 * Rediseño de navegación (panel lateral colapsable) — pedido explícito del
 * usuario vía `/frontend-design`, 2026-08-14. Este archivo se queda
 * deliberadamente delgado: solo resuelve `email` en el servidor (Supabase
 * claims, no necesita ser interactivo) y se lo pasa a `<AdminShell>`
 * (client component, `components/admin/ui/shell/`) que arma el sidebar +
 * topbar + drawer mobile. Las funciones principales (Alumnos/Maestros/
 * Administrativos/Mi perfil) que antes vivían como links en el header ahora
 * viven en `Sidebar` — ver ese archivo para la lista y el criterio de cada
 * ruta.
 */
export default async function AdminLayout(props: LayoutProps<'/admin'>) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === 'string' ? data.claims.email : null;

  return <AdminShell email={email}>{props.children}</AdminShell>;
}
