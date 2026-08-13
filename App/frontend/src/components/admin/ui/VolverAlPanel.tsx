'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Link "Volver al panel" — corrección de QA manual (sesión 2026-08-12):
 * ningún panel tenía forma de regresar sin enviar el formulario primero
 * (solo existía "Volver al panel" dentro del estado de éxito de las 3
 * pantallas de alta, ver `ResultadoAltaPersona.tsx`).
 *
 * Vive en `app/admin/layout.tsx` (se renderiza en TODAS las páginas del
 * árbol admin) y se oculta a sí mismo en `/admin` — la raíz, donde no hay a
 * dónde volver. `usePathname()` obliga a que sea client component (regla
 * 11: componente de negocio de admin, no infraestructura compartida como
 * `LogoutButton` — por eso vive en `components/admin/ui/`, no en
 * `components/`).
 */
export function VolverAlPanel() {
  const pathname = usePathname();

  if (pathname === '/admin') {
    return null;
  }

  return (
    <Link
      href="/admin"
      className="text-sm font-medium text-ink/60 hover:text-maya"
    >
      ← Volver al panel
    </Link>
  );
}
