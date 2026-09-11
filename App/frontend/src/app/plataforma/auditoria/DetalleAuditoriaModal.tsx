'use client';

import type { RegistroAuditoriaItem } from '@/lib/api/auditoria-plataforma';

/**
 * Modal de detalle de un registro de auditoría — local a
 * `app/plataforma/auditoria/`. Mismo patrón de overlay que
 * `../sedes/ConfirmarEliminarSedeModal.tsx` (regla 11 / 13: cada árbol tiene
 * sus modales, sin componente `Modal` genérico compartido).
 */
export function DetalleAuditoriaModal({
  registro,
  onCerrar,
}: {
  registro: RegistroAuditoriaItem;
  onCerrar: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate/40 p-4"
      onClick={onCerrar}
    >
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="font-display text-lg font-semibold text-slate">
            Detalle del registro
          </h2>
          <button
            type="button"
            onClick={onCerrar}
            className="text-sm text-slate/60 hover:text-navy"
          >
            Cerrar
          </button>
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Campo etiqueta="Fecha" valor={new Date(registro.fecha).toLocaleString('es-MX')} />
          <Campo etiqueta="Acción" valor={registro.accion} />
          <Campo etiqueta="Entidad" valor={registro.entidad} />
          <Campo etiqueta="Entidad ID" valor={registro.entidadId} />
          <Campo
            etiqueta="Actor"
            valor={`${registro.actor.nombre} (${registro.actor.tipo}${
              registro.actor.rol ? ` · ${registro.actor.rol}` : ''
            })`}
          />
          <Campo etiqueta="Actor ID" valor={registro.actor.id} />
          <Campo etiqueta="Sede" valor={registro.sede ? registro.sede.nombre : '—'} />
          <Campo etiqueta="Registro ID" valor={registro.id} />
        </dl>

        <h3 className="mt-5 text-sm font-semibold text-slate">Detalle</h3>
        {registro.detalle == null ? (
          <p className="mt-2 text-sm text-slate/60">Sin detalle registrado.</p>
        ) : (
          <pre className="mt-2 overflow-x-auto rounded bg-mist/40 p-3 text-xs text-slate">
            {JSON.stringify(registro.detalle, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function Campo({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate/50">{etiqueta}</dt>
      <dd className="mt-0.5 break-all text-slate">{valor}</dd>
    </div>
  );
}
