import Link from 'next/link';

// Placeholder — pantallas reales de negocio (maestros, sedes, etc.) llegan
// en fases siguientes. Día 14 agrega el primer link real (alta de alumno,
// `app/admin/alumnos/nuevo/`) sin construir un layout de navegación completo
// que no se pidió — solo un link mínimo para poder llegar ahí sin escribir
// la URL a mano.
export default function AdminHomePage() {
  return (
    <div>
      <h1 className="text-xl font-semibold">Panel administrativo</h1>
      <p className="mt-2 text-sm text-gray-500">
        Bienvenido. Las pantallas de gestión se agregan en próximas fases.
      </p>
      <Link
        href="/admin/alumnos/nuevo"
        className="mt-4 inline-block rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
      >
        Dar de alta un alumno
      </Link>
    </div>
  );
}
