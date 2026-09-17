'use client';

import { useCallback, useState } from 'react';

const DURACION_COOLDOWN_MS = 60 * 60 * 1000; // 1 hora — decisión explícita del usuario.

function claveCooldown(actorUsuarioId: string, targetUsuarioId: string): string {
  return `sige:reseteo-cooldown:${actorUsuarioId}:${targetUsuarioId}`;
}

/**
 * Cooldown de 1h por par (admin, persona) — SOLO en el frontend, sin
 * enforcement en el backend (decisión explícita del usuario: "es solo hacer
 * disabled en botón"). Dos admins distintos resetean a la misma persona sin
 * bloquearse entre sí; el mismo admin resetea a otra persona sin esperar.
 *
 * Persistido en `localStorage` (per-viewer, sobrevive un refresh dentro de
 * la hora) — nunca se sincroniza entre pestañas/dispositivos ni se lee de
 * vuelta por el backend, es puramente una conveniencia de UI.
 */
export function useCooldownReseteo(actorUsuarioId: string | undefined) {
  // Se re-lee en cada llamada a `estaEnCooldown`/`minutosRestantes` en vez de
  // cachear en un `useState` — el cooldown expira con el tiempo, no con un
  // evento de React; un `setState` disparado por un timer sería más
  // complejo sin aportar nada que un checkeo directo no dé ya.
  const [, forzarRerender] = useState(0);

  const leerExpiracion = useCallback(
    (targetUsuarioId: string): number | null => {
      if (!actorUsuarioId) return null;
      try {
        const valor = localStorage.getItem(
          claveCooldown(actorUsuarioId, targetUsuarioId),
        );
        return valor ? Number(valor) : null;
      } catch (err) {
        console.error('[useCooldownReseteo] Error leyendo localStorage:', err);
        return null;
      }
    },
    [actorUsuarioId],
  );

  const estaEnCooldown = useCallback(
    (targetUsuarioId: string): boolean => {
      const expiracion = leerExpiracion(targetUsuarioId);
      return expiracion !== null && expiracion > Date.now();
    },
    [leerExpiracion],
  );

  const minutosRestantes = useCallback(
    (targetUsuarioId: string): number => {
      const expiracion = leerExpiracion(targetUsuarioId);
      if (expiracion === null) return 0;
      return Math.max(0, Math.ceil((expiracion - Date.now()) / 60000));
    },
    [leerExpiracion],
  );

  const iniciarCooldown = useCallback(
    (targetUsuarioId: string) => {
      if (!actorUsuarioId) return;
      try {
        localStorage.setItem(
          claveCooldown(actorUsuarioId, targetUsuarioId),
          String(Date.now() + DURACION_COOLDOWN_MS),
        );
      } catch (err) {
        console.error('[useCooldownReseteo] Error escribiendo localStorage:', err);
      }
      forzarRerender((n) => n + 1);
    },
    [actorUsuarioId],
  );

  return { estaEnCooldown, minutosRestantes, iniciarCooldown };
}
