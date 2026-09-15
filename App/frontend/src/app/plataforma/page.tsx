'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import {
  listarAuditoria,
  type AccionAuditoria,
} from '@/lib/api/auditoria-plataforma';
import { ApiError } from '@/lib/api/http';
import { getPlatformToken } from '@/lib/api/platform-http';
import { obtenerResumenGlobal } from '@/lib/api/sedes';
import { PlataformaNav } from './PlataformaNav';
import { SkeletonHeroStats, SkeletonLines } from './Skeleton';

/**
 * REDISEÑO ESTÉTICO (2026-09-11, pedido explícito del usuario — "la
 * estética del dash de admin plataforma no me termina de convencer"). Sin
 * cambios de lógica/datos: mismas 2 queries (`resumen`/`auditoria reciente`),
 * mismos estados de carga/error/vacío. Se abandona el kit de tarjetas
 * blancas con sombra idéntico en cada bloque (mismo patrón repetido en
 * `sedes/`/`auditoria/`, deliberado ahí) a favor de un layout tipo reporte
 * institucional — un solo número protagonista + reglas finas — que sí usa
 * el dorado de la paleta de CESP (sin uso en este archivo hasta hoy) como
 * acento puntual: la regla bajo el número hero, la sede #1 del ranking y el
 * punto más reciente de la bitácora. `max-w-6xl` (antes `4xl`) + grid
 * responsive para aprovechar pantallas anchas y colapsar a una columna en
 * móvil.
 */

const ACCION_LABEL: Record<AccionAuditoria, string> = {
  ALTA: 'Alta',
  BAJA: 'Baja',
  EDICION: 'Edición',
  CAMBIO_PERMISO: 'Cambio de permiso',
  CAMBIO_ESTATUS: 'Cambio de estatus',
  ELIMINACION: 'Eliminación',
  CONSULTA_EMERGENCIA: 'Consulta de emergencia',
};

// Mismos colores que `auditoria/page.tsx` (`ACCION_CLASE`) — duplicado a
// propósito, mismo criterio que `Skeleton.tsx`: este widget compacto vive
// en un archivo aparte, sin componente/lib compartido dentro del árbol.
const ACCION_CLASE: Record<AccionAuditoria, string> = {
  ALTA: 'bg-green-100 text-green-800',
  EDICION: 'bg-navy/10 text-navy',
  CAMBIO_PERMISO: 'bg-navy/10 text-navy',
  CAMBIO_ESTATUS: 'bg-navy/10 text-navy',
  BAJA: 'bg-crimson/10 text-crimson',
  ELIMINACION: 'bg-crimson/10 text-crimson',
  CONSULTA_EMERGENCIA: 'bg-amber-100 text-amber-800',
};

export default function PlataformaDashboardPage() {
  const router = useRouter();

  // Protección de ruta del lado del cliente — app/plataforma está
  // explícitamente exento de la lógica de sesión de src/proxy.ts (regla 11,
  // sistema de identidad aparte, ver la exención al inicio de ese archivo),
  // así que este check en el cliente es el único gate real.
  useEffect(() => {
    if (!getPlatformToken()) {
      router.replace('/plataforma/login');
    }
  }, [router]);

  const resumenQuery = useQuery({
    queryKey: ['plataforma', 'resumen'],
    queryFn: async () => {
      try {
        return await obtenerResumenGlobal();
      } catch (err) {
        console.error('[PlataformaDashboardPage] Error al obtener el resumen global:', err);
        throw err;
      }
    },
  });

  const actividadQuery = useQuery({
    queryKey: ['plataforma', 'auditoria', 'reciente'],
    queryFn: async () => {
      try {
        return await listarAuditoria({ limit: 5 });
      } catch (err) {
        console.error(
          '[PlataformaDashboardPage] Error al obtener actividad reciente:',
          err,
        );
        throw err;
      }
    },
  });

  const data = resumenQuery.data;
  const sedesOrdenadas = data
    ? [...data.alumnosPorSede].sort((a, b) => b.cantidad - a.cantidad)
    : [];
  const maxAlumnosPorSede = Math.max(...sedesOrdenadas.map((f) => f.cantidad), 1);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <PlataformaNav activo="dashboard" titulo="Dashboard" />

      {/* Hero: alumnos activos en la red + 3 cifras de apoyo */}
      {resumenQuery.isLoading && (
        <div className="mt-10">
          <SkeletonHeroStats />
        </div>
      )}

      {resumenQuery.isError && (
        <p className="mt-10 text-sm text-crimson">
          {resumenQuery.error instanceof ApiError
            ? resumenQuery.error.message
            : 'Error al cargar el resumen global'}
        </p>
      )}

      {data && (
        <section className="mt-10 grid grid-cols-1 gap-8 border-b border-mist pb-8 lg:grid-cols-[1.7fr_1fr]">
          <div>
            <p className="text-sm text-slate/60">Alumnos activos en la red</p>
            <p className="mt-2 font-display text-6xl font-semibold tabular-nums text-navy sm:text-7xl">
              {data.totalAlumnosActivos.toLocaleString('es-MX')}
            </p>
            <div className="mt-5 h-1 w-14 rounded-full bg-gold" />
          </div>

          <div className="grid grid-cols-3 border-t border-mist pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-10">
            <StatMini valor={data.totalSedes} etiqueta="Sedes" />
            <StatMini valor={data.totalMaestrosActivos} etiqueta="Maestros" />
            <StatMini valor={data.totalAdministrativosActivos} etiqueta="Administrativos" />
          </div>
        </section>
      )}

      {/* Alumnos por sede + Actividad reciente, lado a lado en escritorio */}
      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-2">
        <section>
          <h2 className="font-display text-lg font-semibold text-slate">Alumnos por sede</h2>

          {resumenQuery.isLoading && (
            <div className="mt-5">
              <SkeletonLines count={3} />
            </div>
          )}
          {resumenQuery.isError && (
            <p className="mt-4 text-sm text-slate/60">
              No se pudo cargar la información de sedes.
            </p>
          )}
          {data && sedesOrdenadas.length === 0 && (
            <p className="mt-4 text-sm text-slate/60">
              Todavía no hay alumnos activos en ninguna sede.
            </p>
          )}
          {data && sedesOrdenadas.length > 0 && (
            <div className="mt-5">
              {sedesOrdenadas.map((fila, i) => {
                const esTop = i === 0;
                return (
                  <div
                    key={fila.sedeId}
                    className="border-b border-mist py-3 first:pt-0 last:border-0"
                  >
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className={esTop ? 'font-medium text-navy' : 'text-slate'}>
                        {fila.nombre}
                      </span>
                      <span
                        className={`font-display tabular-nums ${
                          esTop ? 'font-medium text-navy' : 'text-slate/70'
                        }`}
                      >
                        {fila.cantidad}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 w-full rounded-full bg-mist">
                      <div
                        className={`h-1.5 rounded-full ${esTop ? 'bg-gold' : 'bg-navy/70'}`}
                        style={{ width: `${(fila.cantidad / maxAlumnosPorSede) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-lg font-semibold text-slate">Actividad reciente</h2>
            <Link href="/plataforma/auditoria" className="text-sm text-navy hover:underline">
              Ver toda la actividad
            </Link>
          </div>

          {actividadQuery.isLoading && (
            <div className="mt-5">
              <SkeletonLines count={4} />
            </div>
          )}
          {actividadQuery.isError && (
            <p className="mt-4 text-sm text-slate/60">
              No se pudo cargar la actividad reciente.
            </p>
          )}
          {actividadQuery.data && actividadQuery.data.data.length === 0 && (
            <p className="mt-4 text-sm text-slate/60">Sin actividad registrada todavía.</p>
          )}
          {actividadQuery.data && actividadQuery.data.data.length > 0 && (
            <ol className="mt-6 space-y-5 border-l border-mist pl-5">
              {actividadQuery.data.data.map((r, i) => (
                <li key={r.id} className="relative">
                  <span
                    className={`absolute -left-[23px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-bone ${
                      i === 0 ? 'bg-gold' : 'bg-navy'
                    }`}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${ACCION_CLASE[r.accion]}`}
                    >
                      {ACCION_LABEL[r.accion]}
                    </span>
                    <span className="text-sm text-slate">{r.entidad}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate/60">
                    {r.actor.nombre} · {new Date(r.fecha).toLocaleDateString('es-MX')}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </main>
  );
}

function StatMini({ valor, etiqueta }: { valor: number; etiqueta: string }) {
  return (
    <div className="border-l border-mist pl-4 first:border-l-0 first:pl-0">
      <p className="font-display text-2xl font-semibold tabular-nums text-navy sm:text-3xl">
        {valor.toLocaleString('es-MX')}
      </p>
      <p className="mt-1 text-xs text-slate/60 sm:text-sm">{etiqueta}</p>
    </div>
  );
}
