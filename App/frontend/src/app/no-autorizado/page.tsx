// Destino de src/proxy.ts cuando el rol del JWT no coincide con la sección
// solicitada (ej. un ALUMNO entrando a /admin). Accesible con o sin sesión.
export default function NoAutorizadoPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm rounded-lg border-l-4 border-terracota bg-white px-6 py-8 text-center shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-ink">No autorizado</h1>
        <p className="mt-2 text-sm text-ink/60">Tu cuenta no tiene acceso a esta sección.</p>
      </div>
    </main>
  );
}
