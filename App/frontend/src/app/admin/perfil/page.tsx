'use client';

import { useQuery } from '@tanstack/react-query';
import { SkeletonProfileCard } from '@/components/admin/ui/Skeleton';
import { ApiError } from '@/lib/api/http';
import {
  obtenerPerfil,
  type ContactoAdministrativo,
  type NivelPermiso,
  type Perfil,
  type PerfilAdministrativo,
  type PuestoAdministrativo,
} from '@/lib/api/perfil';

/**
 * Perfil de administrativo — Fase 5, Día 18.
 *
 * Solo lectura (sin formulario de edición — fuera de alcance del roadmap de
 * hoy): datos personales, sede, contactos y el indicador de nivel de
 * permiso, consumidos de `GET /perfil` (`App/backend/src/perfil/`) vía
 * `lib/api/perfil.ts`. Mismo patrón visual que `app/alumno/page.tsx` (Día
 * 16) y `app/maestro/page.tsx` (Día 17) — se ven como referencia de estilo
 * pero este archivo NO importa nada de ellos (regla 11 de `CLAUDE.md` raíz:
 * árboles independientes, sin componentes compartidos).
 *
 * A diferencia de alumno/maestro, `app/admin/page.tsx` es el
 * dashboard/menú del admin (links a los 3 formularios de alta), no una
 * página de perfil — por eso el perfil vive en su propia ruta
 * `/admin/perfil` en vez de reemplazar la raíz del árbol.
 *
 * `SedeGuard` (backend) ya obliga sesión válida antes de responder, y
 * `src/proxy.ts` (check optimista) ya garantiza que solo entra un JWT con
 * `rol: ADMINISTRATIVO` a este árbol de rutas — no se repite esa
 * verificación acá, mismo criterio que el resto de `app/admin/*`.
 */
export default function AdminPerfilPage() {
  const {
    data: perfil,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['admin', 'perfil'],
    queryFn: async () => {
      try {
        return await obtenerPerfil();
      } catch (err) {
        // Regla 12 de `CLAUDE.md` raíz — loguear antes de dejar que React
        // Query marque `isError` y la UI muestre el mensaje genérico.
        console.error('[AdminPerfilPage] Error al obtener el perfil:', err);
        throw err;
      }
    },
  });

  if (isLoading) {
    return (
      <div className="max-w-3xl rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-navy">Mi perfil</h1>
        <SkeletonProfileCard sections={3} fieldsPerSection={4} />
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
  // `administrativo` viene lleno para `rol === 'ADMINISTRATIVO'` (el único
  // caso que aplica en este árbol de rutas — ver nota de
  // `SedeGuard`/`proxy.ts` arriba). Se maneja el `null` de forma defensiva
  // de todos modos, sin asumir el shape por el rol esperado.
  if (!perfil.administrativo) {
    return (
      <div className="max-w-3xl rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-navy">Mi perfil</h1>
        <p className="mt-4 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-crimson">
          No se encontraron datos de perfil administrativo para tu cuenta.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
      <h1 className="font-display text-2xl font-semibold text-navy">Mi perfil</h1>

      <div className="mt-6 space-y-6">
        <SeccionNivelPermiso administrativo={perfil.administrativo} />
        <SeccionDatosPersonales administrativo={perfil.administrativo} email={perfil.email} />
        <SeccionSede sede={perfil.sede} />
        <SeccionContactos administrativo={perfil.administrativo} />
      </div>
    </div>
  );
}

/**
 * Indicador de nivel de permiso — el entregable central del roadmap de hoy
 * ("que refleje correctamente su permiso"). Se destaca visualmente al
 * inicio del contenido (antes de "Datos personales"), con los tokens de
 * marca `navy`/`gold` ya establecidos.
 *
 * `puedeDarAltaAdministrativos` (`false` para `AUXILIAR`) es información
 * neutral sobre el rol del usuario, NO un error del sistema — se evita
 * deliberadamente `crimson`/`error-*` para ese caso (a diferencia de los
 * bloques de `isError` de arriba, que sí son errores reales de carga).
 */
function SeccionNivelPermiso({ administrativo }: { administrativo: PerfilAdministrativo }) {
  const puede = administrativo.puedeDarAltaAdministrativos;

  return (
    <section className="rounded-lg border border-gold/50 bg-navy p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-bone/80">Nivel de permiso</h2>
        <span className="inline-flex items-center rounded-full bg-gold px-3 py-1 text-xs font-semibold tracking-wide text-navy uppercase">
          {NIVEL_PERMISO_LABEL[administrativo.nivelPermiso]}
        </span>
      </div>
      <p
        className={
          puede
            ? 'mt-3 rounded-lg border border-gold/40 bg-gold/10 px-4 py-3 text-sm font-medium text-bone'
            : 'mt-3 rounded-lg border border-bone/20 bg-white/5 px-4 py-3 text-sm text-bone/80'
        }
      >
        {puede
          ? 'Puede dar de alta personal administrativo.'
          : 'No puede dar de alta personal administrativo — solo Admin o Super admin pueden hacerlo.'}
      </p>
    </section>
  );
}

function SeccionDatosPersonales({
  administrativo,
  email,
}: {
  administrativo: PerfilAdministrativo;
  email: string;
}) {
  const nombreCompleto = [
    administrativo.nombres,
    administrativo.apellidoPaterno,
    administrativo.apellidoMaterno,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className="rounded-lg border border-mist p-5">
      <h2 className="text-sm font-semibold text-navy">Datos personales</h2>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        <Campo etiqueta="Nombre completo" valor={nombreCompleto} />
        <Campo etiqueta="CURP" valor={administrativo.curp} />
        <Campo etiqueta="Puesto" valor={PUESTO_LABEL[administrativo.puesto]} />
        <Campo etiqueta="Correo institucional" valor={email} />
        <Campo etiqueta="Correo personal" valor={administrativo.correoPersonal} />
        <Campo etiqueta="Teléfono" valor={administrativo.telefono} />
        <Campo
          etiqueta="Fecha de contratación"
          valor={formatearFecha(administrativo.fechaContratacion)}
        />
        <Campo
          etiqueta="Estatus laboral"
          valor={ESTATUS_EMPLEADO_LABEL[administrativo.estatus]}
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
 * Contactos del administrativo — mismo patrón que la sección de contactos
 * de `app/maestro/page.tsx` (Día 17), sin badge de tipo: `ContactoAdministrativo`
 * no distingue tutor/emergencia, son todos contactos genéricos.
 *
 * `administrativo.contactos` viene de `GET /perfil` ya ordenado por `orden`
 * ascendente (el backend ordena, no este componente) — se recorre tal cual,
 * SIN reordenar.
 */
function SeccionContactos({ administrativo }: { administrativo: PerfilAdministrativo }) {
  const contactos = administrativo.contactos;

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

function ContactoItem({ contacto }: { contacto: ContactoAdministrativo }) {
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
 * humana. Sin librería nueva (`Intl.DateTimeFormat` ya es nativo). Mismo
 * criterio exacto que `app/alumno/page.tsx`/`app/maestro/page.tsx`. */
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

const ESTATUS_EMPLEADO_LABEL: Record<PerfilAdministrativo['estatus'], string> = {
  ACTIVO: 'Activo',
  BAJA: 'Baja',
  LICENCIA: 'Licencia',
};

const PUESTO_LABEL: Record<PuestoAdministrativo, string> = {
  DIRECTOR: 'Director',
  COORDINADOR_ACADEMICO: 'Coordinador académico',
  COORDINADOR_ADMINISTRATIVO: 'Coordinador administrativo',
  AUXILIAR: 'Auxiliar',
  RECEPCION: 'Recepción',
  OTRO: 'Otro',
};

const NIVEL_PERMISO_LABEL: Record<NivelPermiso, string> = {
  SUPER_ADMIN: 'Super administrador',
  ADMIN: 'Administrador',
  AUXILIAR: 'Auxiliar',
};
