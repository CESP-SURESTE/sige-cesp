// Duplicado deliberado de `components/admin/ui/persona-alta/estilos.ts`
// (regla 11 de CLAUDE.md raíz — app/plataforma/ no importa de app/admin/).
// Mantener en sync a mano si el original cambia.

/**
 * Constantes de estilo compartidas entre los 3 formularios de alta de
 * persona (alumno/maestro/administrativo, Días 14-15) — extraídas del
 * formulario de alumno original (Día 14) al refactorizar hacia el
 * componente base pedido por el roadmap del Día 15 ("Componente de
 * formulario base reutilizado entre los 3 tipos").
 */
export const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none disabled:opacity-50';
export const LABEL_CLASS = 'block text-sm font-medium text-slate/80';
