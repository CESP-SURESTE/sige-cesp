import type { FormEventHandler, ReactNode } from 'react';

/**
 * Cascarón visual compartido por los 3 formularios de alta de persona
 * (alumno/maestro/administrativo) — título, descripción, `<form>` y botón de
 * submit. Los campos en sí (comunes o específicos del rol) van en
 * `children`, inyectados por cada página — ver
 * `CuentaFieldset`/`DatosPersonalesFieldset` para los campos comunes y cada
 * `app/admin/{alumnos,maestros,administrativos}/nuevo/page.tsx` para los
 * específicos del sub-perfil.
 *
 * El error de envío (`mensajeError`, resuelto vía `resolverMensajeError`) ya
 * no se renderiza como banner inline aquí — cada página lo dispara como
 * `toast.error(...)` (sonner) desde el `onError` de su mutación, deuda
 * técnica cerrada 2026-08-13 ("Sistema de alertas/notificaciones
 * estandarizado"). Los errores de campo específico siguen inline vía
 * `FieldError` (eso sí se queda visible junto al campo, no solo en el toast
 * — el usuario necesita saber CUÁL campo está mal, no solo que algo falló).
 *
 * Aviso de "verifica antes de guardar" (2026-09-20, pedido directo del
 * usuario, mientras se decide si se construye edición real de campos
 * post-alta — regla 3 de `CLAUDE.md` raíz: hoy NO existe ningún `PATCH` que
 * corrija nombres/apellidos/CURP/etc. una vez creada la persona). Mitigación
 * mínima: un recordatorio visual justo antes del botón de guardar, mismo
 * patrón visual (`warning-bg`/`warning-border`) que `CambiarEstatusModal`/
 * `SeccionAsignaciones`.
 */
interface AltaPersonaFormShellProps {
  titulo: string;
  descripcion: string;
  onSubmit: FormEventHandler<HTMLFormElement>;
  isPending: boolean;
  children: ReactNode;
  submitLabel?: string;
}

export function AltaPersonaFormShell({
  titulo,
  descripcion,
  onSubmit,
  isPending,
  children,
  submitLabel = 'Dar de alta',
}: AltaPersonaFormShellProps) {
  return (
    <div className="w-full rounded-lg border-l-4 border-navy bg-white px-6 py-6 shadow-sm sm:px-8 sm:py-6">
      <h1 className="font-display text-xl font-semibold text-slate">{titulo}</h1>
      <p className="mt-1 text-sm text-slate/60">{descripcion}</p>

      <form onSubmit={onSubmit} className="mt-5 space-y-5" noValidate>
        {children}

        <p className="rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning">
          Verifica bien los datos antes de guardar. La matrícula y el usuario de acceso se
          generan automáticamente y no se pueden modificar; el resto de los datos se
          pueden corregir después desde el listado, con el ícono de lápiz.
        </p>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
        >
          {isPending ? 'Guardando…' : submitLabel}
        </button>
      </form>
    </div>
  );
}
