/**
 * `EstadoActivoBadge` — Fase 5, Día 19.
 *
 * Baja lógica (regla 3 de `CLAUDE.md` raíz): `Usuario.activo` NUNCA se
 * oculta en el listado, se distingue visualmente. `success`/`warning` en vez
 * de `success`/`crimson` — "inactivo" es un estado del ciclo de vida de la
 * persona (baja lógica), no un error del sistema, mismo criterio ya usado en
 * `app/admin/perfil/page.tsx` para no mezclar "neutral/informativo" con el
 * rojo semántico reservado a errores reales.
 */
export function EstadoActivoBadge({ activo }: { activo: boolean }) {
  if (activo) {
    return (
      <span className="inline-flex items-center rounded-full border border-success-border bg-success-bg px-2.5 py-0.5 text-xs font-medium text-success">
        Activo
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-full border border-warning-border bg-warning-bg px-2.5 py-0.5 text-xs font-medium text-warning">
      Inactivo
    </span>
  );
}
