'use client';

import { useQuery } from '@tanstack/react-query';
import { obtenerPerfil } from '@/lib/api/perfil';
import { IconCarrera, IconUbicacion } from './icons';

/**
 * Badges de sede + carrera del navbar de alumno — rediseño 2026-08-16,
 * pedido explícito del usuario: "haz enfasis en su sede y su carrera" en el
 * navbar. A diferencia de admin (`SedeBadge` en
 * `components/admin/ui/shell/AdminShell.tsx`, solo sede), un alumno SÍ tiene
 * carrera propia — se muestran los 2 juntos.
 *
 * `GET /perfil` vía React Query, mismo `queryKey: ['perfil']` que
 * `app/alumno/page.tsx` (comparten caché — Fase 5 Día 16, ya usa este mismo
 * query en esa página). Sin loading state visible — dato secundario de
 * contexto, no vale un skeleton.
 */
export function SedeCarreraBadge() {
  const { data: perfil } = useQuery({
    queryKey: ['perfil'],
    queryFn: obtenerPerfil,
  });

  if (!perfil) return null;

  return (
    <div className="hidden items-center gap-2 sm:flex">
      <span className="flex items-center gap-1.5 rounded-full bg-mist/50 px-3 py-1.5 text-xs font-medium text-slate">
        <IconUbicacion className="size-3.5 shrink-0 text-navy" />
        <span className="truncate">{perfil.sede.nombre}</span>
      </span>
      {perfil.alumno && (
        <span className="hidden items-center gap-1.5 rounded-full bg-mist/50 px-3 py-1.5 text-xs font-medium text-slate md:flex">
          <IconCarrera className="size-3.5 shrink-0 text-navy" />
          <span className="truncate">{perfil.alumno.carrera.nombre}</span>
        </span>
      )}
    </div>
  );
}
