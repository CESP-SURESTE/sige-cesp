// `/` siempre pasa por `src/proxy.ts` antes de renderizar (redirige a la
// home del rol si hay sesión, a `/login` si no) — este contenido es solo el
// fallback mínimo para el instante entre la respuesta del servidor y esa
// redirección (o si JS está deshabilitado en el cliente).
export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <p className="font-display text-sm font-semibold tracking-[0.14em] text-navy uppercase">
        SIGE
      </p>
    </main>
  );
}
