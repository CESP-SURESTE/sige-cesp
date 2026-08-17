'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { VolverAlPanel } from '@/components/admin/ui/VolverAlPanel';
import { obtenerPerfil } from '@/lib/api/perfil';
import { Sidebar } from './Sidebar';
import { ProfileDropdown } from './ProfileDropdown';
import { useSidebarState } from './useSidebarState';
import { IconChevronDoble, IconCerrar, IconMenu, IconUbicacion } from './icons';

/**
 * Shell del área admin — rediseño de navegación (panel lateral), pedido
 * explícito del usuario vía `/frontend-design`, 2026-08-14. Reemplaza el
 * header plano de `app/admin/layout.tsx` (Días 18-19): las funciones
 * principales (Alumnos/Maestros/Administrativos/Mi perfil) que antes vivían
 * como links sueltos en el header ahora viven en `<Sidebar>`.
 *
 * Client component separado del `layout.tsx` (server component) — necesita
 * `localStorage`/estado de interacción (`useSidebarState`), pero el fetch de
 * `email` sigue en el servidor (Supabase claims), pasado acá como prop. Este
 * componente es puro shell/chrome: no toca datos de negocio.
 *
 * Dos instancias de `<Sidebar>` en el DOM (una para el drawer mobile, una
 * para el riel fijo de desktop), alternadas por breakpoint con clases
 * responsive de Tailwind (`lg:hidden` / `hidden lg:flex`) en vez de
 * detectar el breakpoint con JS (`matchMedia`) — más simple, sin listeners,
 * sin librería nueva. La de desktop respeta `colapsado` (riel de solo
 * íconos); la de mobile siempre se ve expandida (un drawer angosto en modo
 * riel no tendría sentido — es pantalla completa, hay espacio de sobra).
 */
export function AdminShell({
  email,
  children,
}: {
  email: string | null;
  children: React.ReactNode;
}) {
  const { colapsado, setColapsado, abiertoMobile, setAbiertoMobile } =
    useSidebarState();

  return (
    <div className="flex min-h-screen bg-bone">
      <MobileDrawer abierto={abiertoMobile} onCerrar={() => setAbiertoMobile(false)} />

      {/* Desktop: sidebar fijo, parte del flujo flex — el ancho anima entre
          riel y expandido, `motion-reduce` desactiva la transición si el SO
          pide menos movimiento. */}
      <aside
        className={[
          'hidden shrink-0 flex-col bg-navy transition-[width] duration-200 motion-reduce:transition-none lg:flex',
          colapsado ? 'w-[72px]' : 'w-60',
        ].join(' ')}
      >
        <SidebarHeader
          colapsado={colapsado}
          onToggleColapsado={() => setColapsado(!colapsado)}
        />
        <Sidebar colapsado={colapsado} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar email={email} onAbrirMobile={() => setAbiertoMobile(true)} />
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

/**
 * Cabecera del sidebar — el toggle de colapsar/expandir (`IconChevronDoble`)
 * se movió acá desde el fondo del riel (rediseño 2026-08-16, pedido
 * explícito del usuario: "mueve el ocultar panel arriba"). Mismo botón,
 * mismo `aria-label` dinámico, ahora vive junto al logo en vez de después
 * de la lista de links.
 */
function SidebarHeader({
  colapsado,
  onToggleColapsado,
}: {
  colapsado: boolean;
  onToggleColapsado: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-4">
      <Link
        href="/admin"
        className="flex min-w-0 items-center gap-2 rounded-lg focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
      >
        <span className="font-display text-lg font-semibold tracking-[0.1em] text-gold">
          S
        </span>
        {!colapsado && (
          <span className="flex min-w-0 flex-col">
            <span className="font-display text-sm font-semibold tracking-[0.14em] text-bone uppercase">
              SIGE
            </span>
            <span className="truncate text-xs text-bone/50">Panel administrativo</span>
          </span>
        )}
      </Link>
      <button
        type="button"
        onClick={onToggleColapsado}
        aria-label={colapsado ? 'Expandir panel lateral' : 'Colapsar panel lateral'}
        className="flex shrink-0 items-center justify-center rounded-lg p-1.5 text-bone/50 transition-colors hover:bg-white/5 hover:text-bone focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
      >
        <IconChevronDoble
          className={['size-4 transition-transform', colapsado ? 'rotate-180' : ''].join(' ')}
        />
      </button>
    </div>
  );
}

/**
 * Badge de sede — rediseño de navbar (2026-08-16, pedido explícito del
 * usuario: "haz enfasis en su sede y su carrera" en el navbar). Un
 * administrativo no tiene carrera propia (eso es de `alumno`), así que acá
 * solo se muestra `sede.nombre`.
 *
 * `GET /perfil` vía React Query, mismo `queryKey: ['admin', 'perfil']` que
 * `app/admin/perfil/page.tsx` — comparten caché, no se pide 2 veces si el
 * usuario visita ambas pantallas en la misma sesión. Sin loading state
 * visible (el badge simplemente no aparece hasta que resuelve) — dato
 * secundario de contexto, no vale la pena un skeleton para esto.
 */
function SedeBadge() {
  const { data: perfil } = useQuery({
    queryKey: ['admin', 'perfil'],
    queryFn: obtenerPerfil,
  });

  if (!perfil) return null;

  return (
    <div className="hidden items-center gap-1.5 rounded-full bg-mist/50 px-3 py-1.5 text-xs font-medium text-slate sm:flex">
      <IconUbicacion className="size-3.5 shrink-0 text-navy" />
      <span className="truncate">{perfil.sede.nombre}</span>
    </div>
  );
}

function Topbar({
  email,
  onAbrirMobile,
}: {
  email: string | null;
  onAbrirMobile: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-mist bg-bone/95 px-4 py-3 backdrop-blur-sm sm:px-6">
      <div className="flex min-w-0 items-center gap-3 justify-self-start">
        <button
          type="button"
          onClick={onAbrirMobile}
          aria-label="Abrir menú de navegación"
          className="-ml-1 rounded-lg p-1.5 text-slate hover:bg-mist/50 focus-visible:ring-2 focus-visible:ring-navy focus-visible:outline-none lg:hidden"
        >
          <IconMenu className="size-5" />
        </button>
        <VolverAlPanel />
      </div>
      <div className="justify-self-center">
        <SedeBadge />
      </div>
      <div className="flex shrink-0 items-center justify-self-end">
        <ProfileDropdown email={email} />
      </div>
    </header>
  );
}

function MobileDrawer({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const cerrarBtnRef = useRef<HTMLButtonElement>(null);

  // Foco-lite (sin librería de focus-trap nueva): al abrir, el foco salta al
  // botón de cerrar del drawer — sin esto, el foco del teclado se queda
  // "atrás" del backdrop, invisible, un problema real de accesibilidad en
  // cualquier overlay. Cerrar con Escape es el otro extremo esperado del
  // mismo flujo.
  useEffect(() => {
    if (!abierto) return;
    cerrarBtnRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCerrar();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [abierto, onCerrar]);

  return (
    <div className={abierto ? '' : 'pointer-events-none'}>
      <div
        aria-hidden="true"
        onClick={onCerrar}
        className={[
          'fixed inset-0 z-30 bg-navy-deep/50 transition-opacity duration-200 motion-reduce:transition-none lg:hidden',
          abierto ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Navegación principal"
        className={[
          'fixed inset-y-0 left-0 z-40 flex w-72 flex-col bg-navy transition-transform duration-200 motion-reduce:transition-none lg:hidden',
          abierto ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
          <span className="font-display text-sm font-semibold tracking-[0.14em] text-bone uppercase">
            SIGE
          </span>
          <button
            ref={cerrarBtnRef}
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar menú de navegación"
            className="rounded-lg p-1.5 text-bone/60 hover:bg-white/5 hover:text-bone focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
          >
            <IconCerrar className="size-5" />
          </button>
        </div>
        <Sidebar colapsado={false} onNavegar={onCerrar} />
      </aside>
    </div>
  );
}
