'use client';

import type { CategoriaEvento, OcurrenciaEvento } from '@/lib/api/calendario';

/**
 * Modal de SOLO LECTURA para el detalle de un evento — árbol ALUMNO,
 * Fase 15, Día 44 (Task 10). A diferencia de `EventoModal.tsx` en
 * admin/maestro (Tasks 8-9), este componente no tiene formulario ni
 * mutaciones: el alumno nunca crea/edita/elimina eventos
 * (`CalendarioService`, backend, ya lo restringe así — `POST/PATCH/DELETE
 * /eventos` exigen rol ADMINISTRATIVO/MAESTRO). Copia estructural mínima
 * del contenedor visual (`fixed inset-0 ... bg-slate/40`) de los otros 2
 * árboles, sin import cruzado (regla 11 de `CLAUDE.md` raíz).
 *
 * `CATEGORIA_LABEL`/`COLOR_POR_CATEGORIA` se duplican localmente (mismo
 * criterio que `EventoModal.tsx` de maestro) — son constantes chicas, no
 * justifican un archivo compartido nuevo entre árboles.
 */

const CATEGORIA_LABEL: Record<CategoriaEvento, string> = {
  EXAMEN: 'Examen',
  SOCIAL: 'Social',
  ADMINISTRATIVO: 'Administrativo',
  SUSPENSION_CLASES: 'Suspensión de clases',
  OTRO: 'Otro',
};

/** Misma paleta que `page.tsx` (chips del grid) — tokens de `globals.css`. */
export const COLOR_POR_CATEGORIA: Record<CategoriaEvento, string> = {
  EXAMEN: 'bg-crimson/10 text-crimson',
  SOCIAL: 'bg-success/10 text-success',
  ADMINISTRATIVO: 'bg-navy/10 text-navy',
  SUSPENSION_CLASES: 'bg-warning/10 text-warning',
  OTRO: 'bg-slate/10 text-slate',
};

const FECHA_FORMATTER = new Intl.DateTimeFormat('es-MX', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** `fecha`/`fechaFin` llegan como `YYYY-MM-DD` — se parsean como UTC medianoche
 * para que el formatter (también fijado a `timeZone: 'UTC'`) nunca corra el
 * día por el desfase de huso horario local del navegador. */
function formatearFecha(iso: string): string {
  const texto = FECHA_FORMATTER.format(new Date(`${iso}T00:00:00Z`));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export interface DetalleEventoModalProps {
  evento: OcurrenciaEvento;
  onCerrar: () => void;
}

export function DetalleEventoModal({ evento, onCerrar }: DetalleEventoModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-slate">{evento.titulo}</h2>
          <span
            className={[
              'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium',
              COLOR_POR_CATEGORIA[evento.categoria],
            ].join(' ')}
          >
            {CATEGORIA_LABEL[evento.categoria]}
          </span>
        </div>

        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="font-medium text-slate/60">Fecha</dt>
            <dd className="mt-0.5 text-slate">{formatearFecha(evento.fecha)}</dd>
          </div>

          <div>
            <dt className="font-medium text-slate/60">Hora</dt>
            <dd className="mt-0.5 text-slate">{evento.horaInicio ?? 'Todo el día'}</dd>
          </div>

          {evento.fechaFin && (
            <div>
              <dt className="font-medium text-slate/60">Hasta</dt>
              <dd className="mt-0.5 text-slate">{formatearFecha(evento.fechaFin)}</dd>
            </div>
          )}

          {evento.descripcion && (
            <div>
              <dt className="font-medium text-slate/60">Descripción</dt>
              <dd className="mt-0.5 whitespace-pre-wrap text-slate">{evento.descripcion}</dd>
            </div>
          )}
        </dl>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
