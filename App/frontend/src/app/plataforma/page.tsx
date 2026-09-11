'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { listarAuditoria } from '@/lib/api/auditoria-plataforma';
import { ApiError } from '@/lib/api/http';
import { getPlatformToken } from '@/lib/api/platform-http';
import { obtenerResumenGlobal } from '@/lib/api/sedes';
import { PlataformaNav } from './PlataformaNav';
import { SkeletonLines, SkeletonStatTiles } from './Skeleton';

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
  const maxAlumnosPorSede = data
    ? Math.max(...data.alumnosPorSede.map((f) => f.cantidad), 1)
    : 1;

  return (
    <main className="mx-auto max-w-4xl p-8">
      <PlataformaNav activo="dashboard" titulo="Dashboard" />

      {resumenQuery.isLoading && (
        <div className="mt-6 space-y-6">
          <SkeletonStatTiles count={4} />
          <div className="rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
            <SkeletonLines count={4} />
          </div>
        </div>
      )}

      {resumenQuery.isError && (
        <p className="mt-8 text-center text-crimson">
          {resumenQuery.error instanceof ApiError
            ? resumenQuery.error.message
            : 'Error al cargar el resumen global'}
        </p>
      )}

      {data && (
        <>
          <div className="mt-6 grid grid-cols-4 gap-4">
            <div className="rounded-lg border-l-4 border-navy bg-white p-4 shadow-sm">
              <p className="font-display text-3xl font-semibold text-navy">{data.totalSedes}</p>
              <p className="mt-1 text-xs tracking-wide text-slate/60 uppercase">Sedes</p>
            </div>
            <div className="rounded-lg border-l-4 border-navy bg-white p-4 shadow-sm">
              <p className="font-display text-3xl font-semibold text-navy">
                {data.totalAlumnosActivos}
              </p>
              <p className="mt-1 text-xs tracking-wide text-slate/60 uppercase">
                Alumnos activos
              </p>
            </div>
            <div className="rounded-lg border-l-4 border-navy bg-white p-4 shadow-sm">
              <p className="font-display text-3xl font-semibold text-navy">
                {data.totalMaestrosActivos}
              </p>
              <p className="mt-1 text-xs tracking-wide text-slate/60 uppercase">
                Maestros activos
              </p>
            </div>
            <div className="rounded-lg border-l-4 border-navy bg-white p-4 shadow-sm">
              <p className="font-display text-3xl font-semibold text-navy">
                {data.totalAdministrativosActivos}
              </p>
              <p className="mt-1 text-xs tracking-wide text-slate/60 uppercase">
                Administrativos activos
              </p>
            </div>
          </div>

          <div className="mt-8 rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
            <h2 className="font-display text-lg font-semibold text-slate">Alumnos por sede</h2>

            {data.alumnosPorSede.length === 0 ? (
              <p className="mt-4 text-sm text-slate/60">
                Todavía no hay alumnos activos en ninguna sede.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {data.alumnosPorSede.map((fila) => (
                  <div key={fila.sedeId}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate">{fila.nombre}</span>
                      <span className="text-slate/60">{fila.cantidad}</span>
                    </div>
                    <div className="mt-1 h-2 w-full rounded-full bg-mist">
                      <div
                        className="h-2 rounded-full bg-navy"
                        style={{ width: `${(fila.cantidad / maxAlumnosPorSede) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <div className="mt-8 rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-slate">
            Actividad reciente
          </h2>
          <Link
            href="/plataforma/auditoria"
            className="text-sm text-navy hover:underline"
          >
            Ver todo →
          </Link>
        </div>

        {actividadQuery.isLoading && (
          <div className="mt-3">
            <SkeletonLines count={5} />
          </div>
        )}
        {actividadQuery.isError && (
          <p className="mt-3 text-sm text-slate/60">
            No se pudo cargar la actividad reciente.
          </p>
        )}
        {actividadQuery.data && actividadQuery.data.data.length === 0 && (
          <p className="mt-3 text-sm text-slate/60">
            Sin actividad registrada todavía.
          </p>
        )}
        {actividadQuery.data && actividadQuery.data.data.length > 0 && (
          <ul className="mt-3 space-y-2 text-sm">
            {actividadQuery.data.data.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-x-2 text-slate/80">
                <span className="text-slate/50">
                  {new Date(r.fecha).toLocaleDateString('es-MX')}
                </span>
                <span className="font-medium text-slate">{r.actor.nombre}</span>
                <span>· {r.accion}</span>
                <span>· {r.entidad}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
