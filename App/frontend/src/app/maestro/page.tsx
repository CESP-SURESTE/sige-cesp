'use client';

import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/http';
import {
  obtenerPerfil,
  type ContactoMaestro,
  type Perfil,
  type PerfilMaestro,
} from '@/lib/api/perfil';

/**
 * Perfil de maestro — Fase 5, Día 17.
 *
 * Reemplaza el placeholder de Día 9. Solo lectura (sin formulario de
 * edición — fuera de alcance del roadmap de hoy): datos personales, sede,
 * contactos, consumidos de `GET /perfil` (`App/backend/src/perfil/`) vía
 * `lib/api/perfil.ts`. Mismo patrón que `app/alumno/page.tsx` (Día 16).
 *
 * `SedeGuard` (backend) ya obliga sesión válida antes de responder, y
 * `src/proxy.ts` (check optimista) ya garantiza que solo entra un JWT con
 * `rol: MAESTRO` a este árbol de rutas — no se repite esa verificación acá,
 * mismo criterio que el resto de `app/maestro/*`.
 *
 * Regla 11 de CLAUDE.md raíz: árbol propio, sin componentes compartidos con
 * `app/admin/`. Este archivo es autocontenido — no importa nada de
 * `app/alumno/page.tsx` (la sección "Sede" se duplica en vez de extraerse a
 * un helper compartido: es una sección de 4 campos, la duplicación es más
 * barata que acoplar dos páginas independientes por un componente trivial;
 * si crece en complejidad vale la pena revisar esta decisión).
 */
export default function MaestroPerfilPage() {
  const {
    data: perfil,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['maestro', 'perfil'],
    queryFn: obtenerPerfil,
  });

  if (isLoading) {
    return (
      <div className="max-w-3xl rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-navy">Mi perfil</h1>
        <p className="mt-4 text-sm text-slate/60">Cargando…</p>
      </div>
    );
  }

  if (isError) {
    const mensaje =
      error instanceof ApiError
        ? error.message
        : 'No se pudo cargar tu perfil. Intenta de nuevo más tarde.';

    return (
      <div className="max-w-3xl rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-navy">Mi perfil</h1>
        <p className="mt-4 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-crimson">
          {mensaje}
        </p>
      </div>
    );
  }

  if (!perfil) {
    // Defensivo — no debería pasar (React Query solo deja `data` en
    // `undefined` mientras `isLoading`/`isError`, ya manejados arriba).
    return null;
  }

  return <PerfilContenido perfil={perfil} />;
}

function PerfilContenido({ perfil }: { perfil: Perfil }) {
  // `maestro` viene lleno para `rol === 'MAESTRO'` (el único caso que aplica
  // en este árbol de rutas — ver nota de `SedeGuard`/`proxy.ts` arriba). Se
  // maneja el `null` de forma defensiva de todos modos, sin asumir el shape
  // por el rol esperado.
  if (!perfil.maestro) {
    return (
      <div className="max-w-3xl rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-navy">Mi perfil</h1>
        <p className="mt-4 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-crimson">
          No se encontraron datos de perfil de maestro para tu cuenta.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
      <h1 className="font-display text-2xl font-semibold text-navy">Mi perfil</h1>

      <div className="mt-6 space-y-6">
        <SeccionDatosPersonales maestro={perfil.maestro} email={perfil.email} />
        <SeccionSede sede={perfil.sede} />
        <SeccionContactos maestro={perfil.maestro} />
      </div>
    </div>
  );
}

function SeccionDatosPersonales({
  maestro,
  email,
}: {
  maestro: PerfilMaestro;
  email: string;
}) {
  const nombreCompleto = [
    maestro.nombres,
    maestro.apellidoPaterno,
    maestro.apellidoMaterno,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className="rounded-lg border border-mist p-5">
      <h2 className="text-sm font-semibold text-navy">Datos personales</h2>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        <Campo etiqueta="Nombre completo" valor={nombreCompleto} />
        <Campo etiqueta="CURP" valor={maestro.curp} />
        <Campo etiqueta="Cédula profesional" valor={maestro.cedulaProfesional} />
        <Campo etiqueta="Correo institucional" valor={email} />
        <Campo etiqueta="Correo personal" valor={maestro.correoPersonal} />
        <Campo etiqueta="Teléfono" valor={maestro.telefono} />
        <Campo
          etiqueta="Fecha de contratación"
          valor={formatearFecha(maestro.fechaContratacion)}
        />
        <Campo
          etiqueta="Estatus laboral"
          valor={ESTATUS_EMPLEADO_LABEL[maestro.estatus]}
        />
      </dl>
    </section>
  );
}

function SeccionSede({ sede }: { sede: Perfil['sede'] }) {
  return (
    <section className="rounded-lg border border-mist p-5">
      <h2 className="text-sm font-semibold text-navy">Sede</h2>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        <Campo etiqueta="Nombre" valor={sede.nombre} />
        <Campo etiqueta="Dirección" valor={sede.direccion} />
        <Campo etiqueta="Ubicación de referencia" valor={sede.ubicacionReferencia} />
        <Campo etiqueta="Teléfono" valor={sede.telefono} />
      </dl>
    </section>
  );
}

/**
 * Contactos del maestro — mismo patrón que la sección de contactos de
 * `app/alumno/page.tsx` (Día 16), sin el badge "Tutor responsable": un
 * `ContactoMaestro` no distingue tipo (`tipo` no existe en el shape), son
 * todos contactos genéricos.
 *
 * `maestro.contactos` viene de `GET /perfil` ya ordenado por `orden`
 * ascendente (el backend ordena, no este componente) — se recorre tal cual,
 * SIN reordenar.
 */
function SeccionContactos({ maestro }: { maestro: PerfilMaestro }) {
  const contactos = maestro.contactos;

  return (
    <section className="rounded-lg border border-mist p-5">
      <h2 className="text-sm font-semibold text-navy">Contactos</h2>
      {contactos.length === 0 ? (
        // Defensivo — el alta exige 1 a 3 contactos, esto no debería pasar
        // nunca en la práctica (ver CLAUDE.md raíz, regla del `POST
        // /personas` extendido). Estado vacío discreto, no un error.
        <p className="mt-3 text-sm text-slate/60">
          No hay contactos registrados.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {contactos.map((contacto) => (
            <ContactoItem key={contacto.id} contacto={contacto} />
          ))}
        </div>
      )}
    </section>
  );
}

function ContactoItem({ contacto }: { contacto: ContactoMaestro }) {
  return (
    <div className="rounded-lg border border-mist bg-bone/60 p-4">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        <Campo etiqueta="Nombre" valor={contacto.nombre} />
        <Campo etiqueta="Parentesco" valor={contacto.parentesco} />
        <Campo etiqueta="Teléfono" valor={contacto.telefono} />
        <Campo etiqueta="Correo" valor={contacto.correo} />
      </dl>
    </div>
  );
}

function Campo({
  etiqueta,
  valor,
}: {
  etiqueta: string;
  valor: string | null | undefined;
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate/50">{etiqueta}</dt>
      <dd className="mt-0.5 text-sm text-slate">{valor || '—'}</dd>
    </div>
  );
}

/** Fechas del backend vienen ISO 8601 completo (regla de `CLAUDE.md` raíz) —
 * se formatea solo la parte de fecha (`YYYY-MM-DD`), sin hora, para lectura
 * humana. Sin librería nueva (`Intl.DateTimeFormat` ya es nativo). */
function formatearFecha(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return iso;
  return new Intl.DateTimeFormat('es-MX', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(fecha);
}

const ESTATUS_EMPLEADO_LABEL: Record<PerfilMaestro['estatus'], string> = {
  ACTIVO: 'Activo',
  BAJA: 'Baja',
  LICENCIA: 'Licencia',
};
