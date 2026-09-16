'use client';

import type { CategoriaEvento, OcurrenciaEvento } from '@/lib/api/calendario';
import { COLOR_POR_CATEGORIA } from './EventoModal';

/**
 * Modal de SOLO LECTURA para un evento que el maestro NO puede editar
 * (`puedeEditar: false` — evento de sede/carrera ajeno, o de otro maestro).
 * Pendiente no bloqueante del fix wave de Fase 15 (2026-09-02,
 * `documentacion_de_agentes/ESTADO.md`): antes de esto el chip de esos
 * eventos era un `<div>` inerte con solo `title` en hover — sin acceso al
 * detalle real (descripción/fecha fin/alcance) y sin foco de teclado pese a
 * parecer accionable visualmente. Ahora ese chip es un `<button>` real que
 * abre este modal.
 *
 * Copia estructural de `app/alumno/calendario/DetalleEventoModal.tsx`
 * (mismo propósito: sin formulario ni mutaciones) — sin import cruzado entre
 * árboles (regla 11 de `CLAUDE.md` raíz), pero SÍ reusa `COLOR_POR_CATEGORIA`
 * de `./EventoModal.tsx` (mismo árbol) en vez de duplicarlo, ya que aquí
 * ambos archivos conviven en `app/maestro/calendario/`.
 */

const CATEGORIA_LABEL: Record<CategoriaEvento, string> = {
  EXAMEN: 'Examen',
  SOCIAL: 'Social',
  ADMINISTRATIVO: 'Administrativo',
  SUSPENSION_CLASES: 'Suspensión de clases',
  OTRO: 'Otro',
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

        <p className="mt-4 text-xs text-slate/50">
          Solo el autor del evento o un administrativo pueden editarlo o eliminarlo.
        </p>

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
