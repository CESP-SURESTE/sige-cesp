"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { login } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/http";
import { createClient } from "@/lib/supabase/client";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import { Eye, EyeOff } from "lucide-react";
/**
 * UI de login — Fase 2, Día 10 (reemplaza el stub de Día 9). Rediseño visual
 * 2026-09-05 (pedido explícito del usuario, "login más vivo" —
 * `sige-frontend-polish-pendiente`): tarjeta única centrada (antes era un
 * split de 2 columnas con un carrusel de ilustraciones SVG, descartado —
 * "no me gustaron"), sobre un fondo de pantalla completa con fotos reales
 * de eventos de CESP (`FondoEventos`, mismas imágenes que ya usa
 * `cesp-landing`). Responsive en los 3 breakpoints de Tailwind que ya usa
 * el resto del proyecto (`sm`/`md`/`lg`).
 *
 * `app/login/` es infraestructura compartida sin dueño de dominio en
 * `AGENTS.md` (ver nota QA de Día 9 en `documentacion_de_agentes/ESTADO.md`)
 * — construido directo, igual que `src/proxy.ts`.
 *
 * Flujo: `POST /auth/login` al backend (contrato `{ data }`/`{ error, code }`,
 * incluye rate limiting y manejo de `CUENTA_BLOQUEADA` — no se llama a
 * Supabase directo desde el navegador para no saltarse esas dos capas) →
 * con los tokens que devuelve, `supabase.auth.setSession()` persiste la
 * sesión en cookies (mismo mecanismo que lee `src/proxy.ts`) → recarga
 * navegación a `/`, que `src/proxy.ts` redirige a la home del rol —
 * `router.push` + `router.refresh()`, no `window.location.assign` (ver
 * ESLint `@next/next/no-location-assign-relative-destination`): el proxy
 * corre igual en la navegación del cliente, y `refresh()` invalida
 * cualquier RSC cacheado de antes de tener sesión.
 */

const MENSAJES_ERROR: Record<string, string> = {
  UNAUTHORIZED: "Correo o contraseña incorrectos.",
  CUENTA_BLOQUEADA: "Esta cuenta está bloqueada. Contacta al administrador.",
  CORREO_NO_CONFIRMADO: "Debes confirmar tu correo antes de iniciar sesión.",
  RATE_LIMIT_EXCEEDED:
    "Demasiados intentos. Espera un minuto e intenta de nuevo.",
  VALIDATION_ERROR: "Revisa que el correo y la contraseña sean válidos.",
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mostrarPassword, setMostrarPassword] = useState(false);
  // `mutation.isPending` pasa a `false` en cuanto `setSession` resuelve, pero
  // `router.push`/`router.refresh()` no son awaited (no devuelven una promesa
  // que resuelva cuando termina la navegación) — sin este estado propio, el
  // botón se re-habilitaba durante el hueco entre "login exitoso" y "la
  // navegación realmente ocurrió", permitiendo doble click/doble submit.
  // Nunca se vuelve a `false`: en éxito la página está por navegar fuera de
  // aquí de todos modos.
  const [redirigiendo, setRedirigiendo] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      const result = await login(email, password);
      const supabase = createClient();
      const { error } = await supabase.auth.setSession({
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
      });
      if (error) {
        throw new Error(
          "La sesión se validó pero no se pudo guardar en el navegador. Intenta de nuevo.",
        );
      }
    },
    onSuccess: () => {
      setRedirigiendo(true);
      router.push("/");
      router.refresh();
    },
    onError: (err) => {
      // Regla 12 de `CLAUDE.md` raíz — nunca loguear `password`, solo el
      // email intentado (útil para debug: "¿a qué cuenta se le negó el
      // acceso?" sin exponer la credencial). Mismo patrón que
      // `app/plataforma/login/page.tsx`.
      console.error("[LoginPage] Error al iniciar sesión:", { email, err });
      const mensaje =
        err instanceof ApiError
          ? (MENSAJES_ERROR[err.code] ??
            "Ocurrió un error inesperado. Intenta de nuevo.")
          : err.message;
      toast.error(mensaje);
    },
  });

  // Único punto de verdad para "el form debe estar bloqueado" — cubre tanto
  // la request en curso (`mutation.isPending`) como el hueco posterior a un
  // login exitoso mientras se navega fuera de esta pantalla (`redirigiendo`).
  const cargando = mutation.isPending || redirigiendo;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.reset();
    mutation.mutate();
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-4 sm:p-8">
      <FondoEventos />

      <div className="relative grid w-full max-w-5xl grid-cols-1 shadow-2xl md:grid-cols-[35fr_65fr] md:h-[500px]">
        <div className="flex flex-col items-center justify-center rounded-3xl bg-white px-6 py-10 sm:px-12 sm:py-14 md:rounded-none md:rounded-tl-3xl">
          {process.env.NEXT_PUBLIC_ENV_LABEL && (
            <div className="mb-4 w-full rounded-md bg-amber-100 px-3 py-2 text-center text-xs font-bold tracking-wide text-amber-800 uppercase">
              Ambiente de {process.env.NEXT_PUBLIC_ENV_LABEL} — solo pruebas
              internas
            </div>
          )}

          <p className="font-display text-sm font-semibold tracking-[0.14em] text-navy uppercase">
            SIGE
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-slate sm:text-3xl">
            Bienvenido
          </h1>
          <h2 className="mt-1 font-display text-2xl font-semibold text-slate sm:text-3xl">
            Inicia sesión
          </h2>
          <p className="mt-1 text-sm text-slate/60">
            Sistema de Gestión Escolar — CESP
          </p>

          <form
            onSubmit={handleSubmit}
            className="mt-6 w-full space-y-4"
            noValidate
          >
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-slate/80"
              >
                Correo
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={cargando}
                className="mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none disabled:opacity-50"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-slate/80"
              >
                Contraseña
              </label>
              <div className="relative mt-1">
                <input
                  id="password"
                  type={mostrarPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={cargando}
                  className="w-full rounded-lg border border-mist px-3 py-2 pr-10 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setMostrarPassword((v) => !v)}
                  disabled={cargando}
                  tabIndex={-1}
                  aria-label={
                    mostrarPassword ? "Ocultar contraseña" : "Mostrar contraseña"
                  }
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-slate/50 transition-colors hover:text-slate disabled:opacity-50"
                >
                  {mostrarPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={cargando}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-navy px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
            >
              {cargando && <SpinnerCarga />}
              {cargando ? "Entrando…" : "Entrar"}
            </button>
          </form>
        </div>

        {/* Panel derecho — logo + reloj (2026-09-07). Antes tenía el
            carrusel de ilustraciones SVG de unDraw, descartado a pedido
            explícito del usuario ("no me gustaron"); luego quedó como
            placeholder navy vacío hasta decidir qué iba aquí. Oculto en
            mobile (`hidden md:block`) porque un panel vacío apilado debajo
            del formulario no aporta en pantallas chicas; se muestra en md+
            junto al formulario. */}
        <div className="hidden bg-navy px-6 py-8 md:block md:rounded-br-3xl">
          <div className="flex h-full w-full flex-col items-center justify-center gap-4 rounded-br-3xl bg-white md:rounded-br-3xl">
            <Image
              src="/images/logo.jpg"
              alt="CESP — Centro de Estudios Superiores Peninsular"
              width={650}
              height={800}
              className="w-14 h-14 object-contain px-6 sm:w-[550px] sm:h-[350px]"
            />
            <RelojFechaHora />
          </div>
        </div>
      </div>
    </main>
  );
}

/**
 * Spinner del botón de "Entrar" — pedido explícito del usuario 2026-09-05
 * (anotado desde antes en `sige-frontend-polish-pendiente`), adaptado de un
 * ejemplo de Motion que compartió: mismo mecanismo (`animate={{ rotate: 360
 * }}`, `repeat: Infinity`, `ease: 'linear'`), pero con clases de Tailwind en
 * vez de un `<style>` inyectado con variables CSS que no existen en este
 * proyecto (`--divider`/`--hue-1` eran del ejemplo, no de `globals.css`) —
 * tamaño chico para vivir dentro del botón, no como loader de página
 * completa.
 */
function SpinnerCarga() {
  return (
    <motion.span
      aria-hidden="true"
      className="inline-block size-4 rounded-full border-2 border-white/30 border-t-white"
      animate={{ rotate: 360 }}
      transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
    />
  );
}

/**
 * Fecha y hora en vivo debajo del logo del panel derecho (2026-09-07, pedido
 * explícito del usuario). Empieza en `null` y recién se llena dentro de
 * `useEffect` (nunca en el `useState` inicial) — si se inicializara con
 * `new Date()` directo, el HTML renderizado en el servidor y el primer
 * render del cliente mostrarían una hora distinta y React tronaría un
 * warning de hidratación; con `null` no se pinta nada hasta que el efecto
 * corre en el navegador. Se actualiza cada segundo (mismo espíritu "vivo"
 * que el resto del rediseño de este login — Ken Burns del fondo, spinner
 * del botón).
 */
function RelojFechaHora() {
  const [ahora, setAhora] = useState<Date | null>(null);

  useEffect(() => {
    // Se llena en el primer efecto (no en el `useState` inicial, ver el
    // comentario del componente) — mismo criterio ya aceptado en este
    // proyecto para un `setState` síncrono legítimo al montar
    // (`SubirMallaModal.tsx`).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAhora(new Date());
    const id = setInterval(() => setAhora(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!ahora) return null;

  const fecha = new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(ahora);

  const hora = new Intl.DateTimeFormat("es-MX", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(ahora);

  return (
    <div className="text-center">
      <p className="text-sm font-medium text-slate/70 capitalize">{fecha}</p>
      <p className="font-display text-xl font-semibold tracking-wide text-navy">
        {hora}
      </p>
    </div>
  );
}

const EVENTOS = [
  "/images/eventos/evento-1.jpg",
  "/images/eventos/evento-2.jpg",
  "/images/eventos/evento-3.jpg",
  "/images/eventos/evento-4.jpg",
  "/images/eventos/evento-5.jpg",
  "/images/eventos/evento-6.jpg",
  "/images/eventos/evento-7.jpg",
];

/**
 * Fondo de pantalla completa del login (2026-09-05) — fotos reales de
 * eventos de CESP (mismas que ya usa `cesp-landing`, copiadas a
 * `public/images/eventos/`), rotando cada 6s con crossfade + Ken Burns
 * (zoom lento de 1 a 1.08) vía Motion. Vive detrás de todo el contenido de
 * `<main>` (`absolute inset-0 -z-10`, `<main>` es `relative overflow-hidden`).
 *
 * Sin tinte de color (2026-09-07, pedido explícito del usuario — "quítale el
 * tinte azul", antes había un degradado navy encima): la legibilidad de la
 * tarjeta de login no depende de este overlay, las 2 mitades de la tarjeta
 * (`bg-white`/`bg-navy`) ya son opacas — el fondo solo se ve en el margen
 * alrededor de la tarjeta. En su lugar, la foto lleva `blur-md` (desenfoque
 * vía `filter`, no `backdrop-filter` — no hay nada detrás que blurrear) +
 * `scale-110` fijo en el propio `<img>` (independiente del `scale` de Ken
 * Burns que anima el `motion.div` padre) para que el desenfoque tenga
 * "sobrante" fuera del recorte (`overflow-hidden` del contenedor) y no se
 * note un borde más nítido en el límite de la imagen.
 */
function FondoEventos() {
  const [indice, setIndice] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIndice((i) => (i + 1) % EVENTOS.length);
    }, 6000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="absolute inset-0 -z-10 overflow-hidden bg-navy">
      <AnimatePresence>
        <motion.div
          key={EVENTOS[indice]}
          initial={{ opacity: 0, scale: 1 }}
          animate={{ opacity: 1, scale: 1.08 }}
          exit={{ opacity: 0 }}
          transition={{
            opacity: { duration: 1.2, ease: "easeInOut" },
            scale: { duration: 6.8, ease: "linear" },
          }}
          className="absolute inset-0"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- fondo decorativo rotativo, next/image no aporta aca */}
          <img
            src={EVENTOS[indice]}
            alt=""
            aria-hidden="true"
            className="h-full w-full scale-110 object-cover blur-xs"
          />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
