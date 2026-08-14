import Link from 'next/link';

// Placeholder — pantallas reales de negocio (sedes, etc.) llegan en fases
// siguientes. Día 14 agregó el primer link real (alta de alumno,
// `app/admin/alumnos/nuevo/`); Día 15 agrega los de maestro y
// administrativo (`app/admin/{maestros,administrativos}/nuevo/`).
//
// Rediseño de navegación (2026-08-14, `/frontend-design`): "Ver alumnos"/
// "Ver maestros" se quitaron de acá — esa navegación ahora vive de forma
// permanente en el sidebar (`components/admin/ui/shell/Sidebar.tsx`),
// mantenerla duplicada en el dashboard hubiera sido dos formas distintas de
// llegar al mismo lado sin motivo. Este card se queda solo con las 3
// ACCIONES (dar de alta), que son intenciones puntuales, no navegación —
// distinción real: el sidebar es "a dónde ir", este card es "qué hacer
// ahora".
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
