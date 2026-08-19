'use client';

import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/http';
import { obtenerResumenAdmin, type ResumenAdmin } from '@/lib/api/dashboard';

/**
 * Dashboard de admin — reemplaza el placeholder de 3 botones "dar de alta"
 * (esa navegación ya vive de forma permanente en el sidebar, mantenerla acá
 * también era redundante — decisión ya tomada, ver historial de este
 * archivo). Consume `GET /personas/resumen` (`lib/api/dashboard.ts`).
 *
 * Mismo patrón `isLoading`/`isError`/estado vacío que `app/admin/alumnos/page.tsx`
 * y `app/admin/maestros/page.tsx` — sin librería de gráficas, las barras de
 * "Alumnos por carrera" son un `<div>` con `width` proporcional al máximo del
 * set (CSS puro).
 */
export default function AdminHomePage() {
  const {
    data: resumen,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['admin', 'resumen'],
    queryFn: async () => {
      try {
        return await obtenerResumenAdmin();
      } catch (err) {
        // Regla 12 de `CLAUDE.md` raíz — loguear antes de dejar que React
        // Query marque `isError` y la UI muestre el mensaje genérico.
        console.error('[AdminHomePage] Error al obtener el resumen:', err);
        throw err;
      }
    },
  });

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-semibold text-navy">
        Panel administrativo
      </h1>

      {isLoading ? (
        <p className="text-sm text-slate/60">Cargando…</p>
      ) : isError ? (
        <p className="rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-crimson">
          {error instanceof ApiError
            ? error.message
            : 'No se pudo cargar el resumen. Intenta de nuevo más tarde.'}
        </p>
      ) : !resumen ? null : (
        <ResumenDashboard resumen={resumen} />
      )}
    </div>
  );
}

function ResumenDashboard({ resumen }: { resumen: ResumenAdmin }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <TarjetaKpi valor={resumen.totalAlumnosActivos} etiqueta="Alumnos activos" />
        <TarjetaKpi valor={resumen.totalMaestrosActivos} etiqueta="Maestros activos" />
        <TarjetaKpi
          valor={resumen.totalAdministrativosActivos}
          etiqueta="Administrativos activos"
        />
        <TarjetaKpi valor={resumen.totalCarreras} etiqueta="Carreras activas" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border-l-4 border-navy bg-white p-4 shadow-sm">
          <h2 className="font-display text-lg font-semibold text-navy">
            Alumnos por carrera
          </h2>
          <div className="mt-4">
            {resumen.alumnosPorCarrera.length === 0 ? (
              <p className="text-sm text-slate/60">Sin datos todavía.</p>
            ) : (
              <AlumnosPorCarreraLista items={resumen.alumnosPorCarrera} />
            )}
          </div>
        </div>

        <div className="rounded-lg border-l-4 border-navy bg-white p-4 shadow-sm">
          <h2 className="font-display text-lg font-semibold text-navy">
            Altas recientes
          </h2>
          <div className="mt-4">
            {resumen.altasRecientes.length === 0 ? (
              <p className="text-sm text-slate/60">Sin datos todavía.</p>
            ) : (
              <AltasRecientesLista items={resumen.altasRecientes} />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function TarjetaKpi({ valor, etiqueta }: { valor: number; etiqueta: string }) {
  return (
    <div className="rounded-lg border-l-4 border-navy bg-white p-4 shadow-sm">
      <p className="font-display text-3xl font-semibold text-navy">{valor}</p>
      <p className="mt-1 text-xs uppercase tracking-wide text-slate/60">
        {etiqueta}
      </p>
    </div>
  );
}

function AlumnosPorCarreraLista({
  items,
}: {
  items: ResumenAdmin['alumnosPorCarrera'];
}) {
  const max = Math.max(...items.map((item) => item.cantidad));

  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.carreraId}>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate">{item.nombre}</span>
            <span className="font-medium text-navy">{item.cantidad}</span>
          </div>
          <div className="mt-1 h-2 w-full rounded-full bg-mist">
            <div
              className="h-2 rounded-full bg-navy"
              style={{ width: `${(item.cantidad / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

const ROL_LABEL: Record<ResumenAdmin['altasRecientes'][number]['rol'], string> = {
  ALUMNO: 'Alumno',
  MAESTRO: 'Maestro',
  ADMINISTRATIVO: 'Administrativo',
};

function AltasRecientesLista({
  items,
}: {
  items: ResumenAdmin['altasRecientes'];
}) {
  return (
    <ul className="divide-y divide-mist">
      {items.map((item) => (
        <li
          key={item.usuarioId}
          className="flex items-center justify-between gap-3 py-2 text-sm"
        >
          <span className="text-slate">{item.nombreCompleto}</span>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-bone px-2 py-0.5 text-xs font-medium text-navy">
              {ROL_LABEL[item.rol]}
            </span>
            <span className="text-xs text-slate/60">
              {new Date(item.fecha).toLocaleDateString('es-MX')}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
