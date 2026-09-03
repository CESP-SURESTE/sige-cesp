import type { CategoriaEvento } from '@/lib/api/calendario';

/**
 * Etiqueta legible y color por categoría de evento — Fase 15 polish
 * (2026-09-02). Extraídos de `EventoModal.tsx` a este módulo sin JSX para
 * que la sección «Eventos de la sede» del dashboard (`app/admin/page.tsx`)
 * los reutilice sin importar desde un componente `'use client'` grande.
 *
 * Reuso DENTRO del árbol admin (`EventoModal.tsx`, `calendario/page.tsx`,
 * `page.tsx`) — la regla 11 de `CLAUDE.md` raíz prohíbe compartir entre los
 * árboles admin/alumno/maestro, no dentro de uno. Los árboles alumno/maestro
 * mantienen su propia copia local (ya la tenían).
 *
 * Tokens de `globals.css` (paleta institucional CESP + derivados semánticos).
 */
export const CATEGORIA_LABEL: Record<CategoriaEvento, string> = {
  EXAMEN: 'Examen',
  SOCIAL: 'Social',
  ADMINISTRATIVO: 'Administrativo',
  SUSPENSION_CLASES: 'Suspensión de clases',
  OTRO: 'Otro',
};

export const COLOR_POR_CATEGORIA: Record<CategoriaEvento, string> = {
  EXAMEN: 'bg-crimson/10 text-crimson',
  SOCIAL: 'bg-success/10 text-success',
  ADMINISTRATIVO: 'bg-navy/10 text-navy',
  SUSPENSION_CLASES: 'bg-warning/10 text-warning',
  OTRO: 'bg-slate/10 text-slate',
};
