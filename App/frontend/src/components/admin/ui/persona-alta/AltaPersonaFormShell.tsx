import type { FormEventHandler, ReactNode } from 'react';

/**
 * Cascarón visual compartido por los 3 formularios de alta de persona
 * (alumno/maestro/administrativo) — título, descripción, `<form>`, banner de
 * error y botón de submit. Los campos en sí (comunes o específicos del rol)
 * van en `children`, inyectados por cada página — ver
 * `CuentaFieldset`/`DatosPersonalesFieldset` para los campos comunes y cada
 * `app/admin/{alumnos,maestros,administrativos}/nuevo/page.tsx` para los
 * específicos del sub-perfil.
 */
interface AltaPersonaFormShellProps {
  titulo: string;
  descripcion: string;
  onSubmit: FormEventHandler<HTMLFormElement>;
  isPending: boolean;
  mensajeError: string | null;
  children: ReactNode;
  submitLabel?: string;
}

export function AltaPersonaFormShell({
  titulo,
  descripcion,
  onSubmit,
  isPending,
  mensajeError,
  children,
  submitLabel = 'Dar de alta',
}: AltaPersonaFormShellProps) {
  return (
    <div className="max-w-2xl rounded-lg border-l-4 border-maya bg-white px-6 py-6 shadow-sm">
      <h1 className="font-display text-xl font-semibold text-ink">{titulo}</h1>
      <p className="mt-1 text-sm text-ink/60">{descripcion}</p>

      <form onSubmit={onSubmit} className="mt-6 space-y-8" noValidate>
        {children}

        {mensajeError && (
          <p role="alert" className="text-sm text-red-600">
            {mensajeError}
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-maya px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-maya-deep disabled:opacity-50"
        >
          {isPending ? 'Guardando…' : submitLabel}
        </button>
      </form>
    </div>
  );
}
