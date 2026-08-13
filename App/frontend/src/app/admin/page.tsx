import Link from 'next/link';

// Placeholder — pantallas reales de negocio (sedes, etc.) llegan en fases
// siguientes. Día 14 agregó el primer link real (alta de alumno,
// `app/admin/alumnos/nuevo/`); Día 15 agrega los de maestro y
// administrativo (`app/admin/{maestros,administrativos}/nuevo/`) — sin
// construir un layout de navegación completo que no se pidió, solo links
// mínimos para poder llegar ahí sin escribir la URL a mano.
export default function AdminHomePage() {
  return (
    <div className="max-w-2xl rounded-lg border-l-4 border-navy bg-white px-6 py-6 shadow-sm">
      <h1 className="font-display text-xl font-semibold text-slate">Panel administrativo</h1>
      <p className="mt-2 text-sm text-slate/60">
        Bienvenido. Las pantallas de gestión se agregan en próximas fases.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          href="/admin/alumnos/nuevo"
          className="inline-block rounded-lg bg-navy px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
        >
          Dar de alta un alumno
        </Link>
        <Link
          href="/admin/maestros/nuevo"
          className="inline-block rounded-lg bg-navy px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
        >
          Dar de alta un maestro
        </Link>
        <Link
          href="/admin/administrativos/nuevo"
          className="inline-block rounded-lg bg-navy px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
        >
          Dar de alta un administrativo
        </Link>
      </div>
    </div>
  );
}
