'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ApiError } from '@/lib/api/http';
import { getPlatformToken, clearPlatformToken } from '@/lib/api/platform-http';
import { obtenerResumenGlobal } from '@/lib/api/sedes';

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

  function cerrarSesion() {
    clearPlatformToken();
    router.push('/plataforma/login');
  }

  const data = resumenQuery.data;
  const maxAlumnosPorSede = data
    ? Math.max(...data.alumnosPorSede.map((f) => f.cantidad), 1)
    : 1;

  return (
    <main className="mx-auto max-w-4xl p-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-display text-sm font-semibold tracking-[0.14em] text-navy uppercase">
            SIGE · Plataforma
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-slate">Dashboard</h1>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/plataforma/sedes" className="text-sm text-navy hover:underline">
            Gestionar sedes
          </Link>
          <button
            onClick={cerrarSesion}
            className="text-sm text-slate/60 hover:text-navy"
          >
            Cerrar sesión
          </button>
        </div>
      </div>

      {resumenQuery.isLoading && (
        <p className="mt-8 text-center text-slate/60">Cargando…</p>
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
    </main>
  );
}
