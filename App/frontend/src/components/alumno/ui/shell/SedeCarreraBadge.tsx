'use client';

import { useQuery } from '@tanstack/react-query';
import { obtenerPerfil, obtenerCompaneros } from '@/lib/api/perfil';
import { IconCarrera, IconUbicacion, IconGrupo } from './icons';

/**
 * Badges de sede + carrera + grupo del navbar de alumno — rediseño
 * 2026-08-16, pedido explícito del usuario: "haz enfasis en su sede y su
 * carrera" en el navbar. A diferencia de admin (`SedeBadge` en
 * `components/admin/ui/shell/AdminShell.tsx`, solo sede), un alumno SÍ tiene
 * carrera propia — se muestran los 2 juntos.
 *
 * `GET /perfil` vía React Query, mismo `queryKey: ['alumno', 'perfil']` que
 * `app/alumno/page.tsx` (comparten caché — Fase 5 Día 16, ya usa este mismo
 * query en esa página). Sin loading state visible — dato secundario de
 * contexto, no vale un skeleton.
 *
 * Badge de grupo (2026-09-16, idea diferida desde 2026-09-02) — tercer
 * badge, mismo criterio de "sin loading state visible". `queryKey: ['alumno',
 * 'companeros']` a propósito: es el MISMO key que usa el bloque comentado
 * `SeccionCompaneros` de `app/alumno/page.tsx` (oculto desde 2026-09-07) —
 * si esa sección se reactiva, comparte caché sin duplicar el fetch. Se
 * muestra solo el primer grupo del array (ya viene ordenado `anioInicio
 * desc, cicloActual desc, nombre asc` desde el backend) — un alumno en 2+
 * grupos simultáneos es un caso raro, no se complica la UI por él. Si el
 * array viene vacío o la query falla, el badge no se renderiza.
 */
export function SedeCarreraBadge() {
  const { data: perfil } = useQuery({
    queryKey: ['alumno', 'perfil'],
    queryFn: async () => {
      try {
        return await obtenerPerfil();
      } catch (err) {
        // Regla 12 de `CLAUDE.md` raíz — loguear antes de dejar que React
        // Query marque `isError` y la UI muestre el mensaje genérico.
        console.error('[SedeCarreraBadge] Error al obtener el perfil:', err);
        throw err;
      }
    },
  });

  const { data: grupos } = useQuery({
    queryKey: ['alumno', 'companeros'],
    queryFn: async () => {
      try {
        return await obtenerCompaneros();
      } catch (err) {
        console.error('[SedeCarreraBadge] Error al obtener los grupos:', err);
        throw err;
      }
    },
  });

  const grupo = grupos?.[0];

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
      {grupo && (
        <span className="hidden items-center gap-1.5 rounded-full bg-mist/50 px-3 py-1.5 text-xs font-medium text-slate md:flex">
          <IconGrupo className="size-3.5 shrink-0 text-navy" />
          <span className="truncate">
            {grupo.nombre} · Cuatrimestre {grupo.cicloActual}
          </span>
        </span>
      )}
    </div>
  );
}
