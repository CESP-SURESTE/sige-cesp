// Destino de src/proxy.ts cuando el rol del JWT no coincide con la sección
// solicitada (ej. un ALUMNO entrando a /admin). Accesible con o sin sesión.
export default function NoAutorizadoPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="text-center">
        <h1 className="text-xl font-semibold">No autorizado</h1>
        <p className="mt-2 text-sm text-gray-500">
          Tu cuenta no tiene acceso a esta sección.
        </p>
      </div>
    </main>
  );
}
