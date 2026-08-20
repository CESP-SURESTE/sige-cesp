'use client';

import { useQuery } from '@tanstack/react-query';
import { obtenerPerfil } from '@/lib/api/perfil';
import { IconUbicacion } from './icons';

/**
 * Badge de sede del navbar de maestro — rediseño 2026-08-16, pedido
 * explícito del usuario: "haz enfasis en su sede" en el navbar. A
 * diferencia de alumno (`SedeCarreraBadge`), un maestro no tiene carrera
 * propia en el schema — solo sede.
 *
 * `GET /perfil` vía React Query, mismo `queryKey: ['maestro', 'perfil']` que
 * `app/maestro/page.tsx` (comparten caché). Sin loading state visible —
 * dato secundario de contexto, no vale un skeleton.
 */
export function SedeBadge() {
  const { data: perfil } = useQuery({
    queryKey: ['maestro', 'perfil'],
    queryFn: async () => {
      try {
        return await obtenerPerfil();
      } catch (err) {
        // Regla 12 de `CLAUDE.md` raíz — loguear antes de dejar que React
        // Query marque `isError` y la UI muestre el mensaje genérico.
        console.error('[SedeBadge] Error al obtener el perfil:', err);
        throw err;
      }
    },
  });

  if (!perfil) return null;

  return (
    <span className="hidden items-center gap-1.5 rounded-full bg-mist/50 px-3 py-1.5 text-xs font-medium text-slate sm:flex">
      <IconUbicacion className="size-3.5 shrink-0 text-navy" />
      <span className="truncate">{perfil.sede.nombre}</span>
    </span>
  );
}
