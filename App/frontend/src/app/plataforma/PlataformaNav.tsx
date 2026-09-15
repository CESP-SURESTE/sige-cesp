'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { clearPlatformToken } from '@/lib/api/platform-http';

/**
 * Header + navegación compartida del árbol `app/plataforma/`. Extrae el
 * markup que estaba duplicado en `page.tsx` y `sedes/page.tsx`. Local a
 * este árbol — no cruza a `app/admin`/`app/alumno` (regla 11 de CLAUDE.md
 * raíz; mismo criterio que `../Skeleton.tsx` y los modales de `sedes/`).
 */
const LINKS: { id: 'dashboard' | 'sedes' | 'auditoria'; href: string; label: string }[] = [
  { id: 'dashboard', href: '/plataforma', label: 'Dashboard' },
  { id: 'sedes', href: '/plataforma/sedes', label: 'Sedes' },
  { id: 'auditoria', href: '/plataforma/auditoria', label: 'Auditoría' },
];

export function PlataformaNav({
  activo,
  titulo,
}: {
  activo: 'dashboard' | 'sedes' | 'auditoria';
  titulo: string;
}) {
  const router = useRouter();

  function cerrarSesion() {
    clearPlatformToken();
    router.push('/plataforma/login');
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div>
        <p className="font-display text-sm font-semibold tracking-[0.14em] text-navy uppercase">
          SIGE · Plataforma
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-slate">{titulo}</h1>
        <nav className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {LINKS.map((l) => (
            <Link
              key={l.id}
              href={l.href}
              className={
                l.id === activo
                  ? 'font-medium text-navy'
                  : 'text-slate/60 hover:text-navy'
              }
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
      <button
        onClick={cerrarSesion}
        className="text-sm text-slate/60 hover:text-navy"
      >
        Cerrar sesión
      </button>
    </div>
  );
}
