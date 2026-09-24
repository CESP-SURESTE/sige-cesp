'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/http';
import {
  obtenerPerfil,
  type ContactoAdministrativo,
  type NivelPermiso,
  type Perfil,
  type PerfilAdministrativo,
  type PuestoAdministrativo,
} from '@/lib/api/perfil';
import { Avatar } from '@/components/admin/ui/Avatar';
import { SkeletonProfileCard } from '@/components/admin/ui/Skeleton';
import { SubirFotoModal } from './SubirFotoModal';

/**
 * Perfil de administrativo — Fase 5, Día 18.
 *
 * Solo lectura (sin formulario de edición — fuera de alcance del roadmap de
 * hoy): datos personales, sede, contactos y el indicador de nivel de
 * permiso, consumidos de `GET /perfil` (`App/backend/src/perfil/`) vía
 * `lib/api/perfil.ts`.
 *
 * `SedeGuard` (backend) ya obliga sesión válida antes de responder, y
 * `src/proxy.ts` (check optimista) ya garantiza que solo entra un JWT con
 * `rol: ADMINISTRATIVO` a este árbol de rutas — no se repite esa
 * verificación acá, mismo criterio que el resto de `app/admin/*`.
 *
 * A diferencia de alumno/maestro, `app/admin/page.tsx` es el
 * dashboard/menú del admin (links a los 3 formularios de alta), no una
 * página de perfil — por eso el perfil vive en su propia ruta
 * `/admin/perfil` en vez de reemplazar la raíz del árbol.
 *
 * Rediseño visual (2026-09-10, plan
 * `.superpowers/sdd/2026-09-10-rediseno-perfil-admin/`): el layout de una
 * sola tarjeta con secciones apiladas se reemplazó por el mismo patrón que
 * `app/maestro/page.tsx` (2026-09-07) y `app/alumno/page.tsx` (2026-08-21) —
 * encabezado (`EncabezadoPerfil`, banner con arcos SVG + avatar circular +
 * badges) y un sidebar de navegación (`SidebarSecciones` + `PanelSeccion`)
 * que muestra una sección a la vez (Nivel de permiso, Datos personales,
 * Sede, Contactos). El patrón se duplica dentro de este árbol (`BannerArcos`,
 * `Campo`, etc.) — no se importa nada de `app/maestro/page.tsx`/
 * `app/alumno/page.tsx` (regla 11 de `CLAUDE.md` raíz: árboles
 * independientes, sin componentes compartidos). A diferencia de maestro, la
 * primera sección es "Nivel de permiso" (exclusiva de administrativo) y no
 * hay sección "Asignaciones" ni badge de "menor de edad" (`PerfilAdministrativo`
 * no tiene `fechaNacimiento`). Los datos y el contrato con el backend no
 * cambiaron, solo cómo se presentan.
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
      <div className="mx-auto max-w-6xl rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-navy">Mi perfil</h1>
        <SkeletonProfileCard sections={1} fieldsPerSection={6} />
      </div>
    );
  }

  if (isError) {
    const mensaje =
      error instanceof ApiError
        ? error.message
        : 'No se pudo cargar tu perfil. Intenta de nuevo más tarde.';

    return (
      <div className="mx-auto max-w-6xl rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
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
  const [seccion, setSeccion] = useState<SeccionId>('permiso');
  const queryClient = useQueryClient();
  const [modalFotoAbierto, setModalFotoAbierto] = useState(false);

  // `administrativo` viene lleno para `rol === 'ADMINISTRATIVO'` (el único
  // caso que aplica en este árbol de rutas — ver nota de
  // `SedeGuard`/`proxy.ts` arriba). Se maneja el `null` de forma defensiva
  // de todos modos, sin asumir el shape por el rol esperado.
  if (!perfil.administrativo) {
    return (
      <div className="mx-auto max-w-6xl rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-navy">Mi perfil</h1>
        <p className="mt-4 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-crimson">
          No se encontraron datos de perfil administrativo para tu cuenta.
        </p>
      </div>
    );
  }

  const administrativo = perfil.administrativo;
  const iniciales = (
    administrativo.nombres.charAt(0) + administrativo.apellidoPaterno.charAt(0)
  ).toUpperCase();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <EncabezadoPerfil
        administrativo={administrativo}
        fotoUrl={perfil.fotoUrl}
        iniciales={iniciales}
        onCambiarFoto={() => setModalFotoAbierto(true)}
      />
      <div className="flex flex-col gap-4 rounded-lg border border-mist bg-white p-4 shadow-sm sm:flex-row sm:gap-6 sm:p-6">
        <SidebarSecciones activa={seccion} onCambiar={setSeccion} />
        <div className="min-w-0 flex-1">
          <PanelSeccion
            seccion={seccion}
            administrativo={administrativo}
            email={perfil.email}
            sede={perfil.sede}
          />
        </div>
      </div>

      {modalFotoAbierto && (
        <SubirFotoModal
          fotoUrlActual={perfil.fotoUrl}
          onClose={() => setModalFotoAbierto(false)}
          onCambioConExito={() =>
            queryClient.invalidateQueries({ queryKey: ['admin', 'perfil'] })
          }
        />
      )}
    </div>
  );
}

/**
 * Patrón de arcos concéntricos del banner — mismo signature visual que
 * `app/alumno/page.tsx` (2026-08-21) y `app/maestro/page.tsx` (2026-09-07),
 * duplicado acá a propósito (regla 11 — árboles independientes, sin
 * componentes compartidos entre `app/admin/`, `app/maestro/` y
 * `app/alumno/`). SVG inline, sin imagen cargada.
 */
function BannerArcos() {
  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 400 160"
      preserveAspectRatio="xMidYMid slice"
    >
      <g className="stroke-gold/20" fill="none" strokeWidth="1.5">
        <circle cx="360" cy="170" r="40" />
        <circle cx="360" cy="170" r="80" />
        <circle cx="360" cy="170" r="120" />
        <circle cx="360" cy="170" r="160" />
        <circle cx="360" cy="170" r="200" />
      </g>
    </svg>
  );
}

/**
 * Encabezado del perfil — banner + avatar + nombre + badges de puesto y
 * estatus. El avatar (`Avatar`, feature "Foto de perfil" 2026-09-17) muestra
 * la foto real si `perfil.fotoUrl` existe, o las iniciales (nombre +
 * apellido paterno) como respaldo — a diferencia de maestro/alumno, no hay
 * un dato externo corto (cédula/matrícula) que sirva de subtítulo natural,
 * así que las iniciales aportan más identidad visual cuando no hay foto. Es
 * el disparador del modal de subida propia (`SubirFotoModal`). Sin badge de
 * "menor de edad" (no aplica — `PerfilAdministrativo` no tiene
 * `fechaNacimiento`).
 */
function EncabezadoPerfil({
  administrativo,
  fotoUrl,
  iniciales,
  onCambiarFoto,
}: {
  administrativo: PerfilAdministrativo;
  fotoUrl: string | null;
  iniciales: string;
  onCambiarFoto: () => void;
}) {
  const nombreCompleto = nombreCompletoDe(administrativo);

  return (
    <div className="overflow-hidden rounded-lg border border-mist bg-white shadow-sm">
      <div className="relative h-32 overflow-hidden bg-gradient-to-br from-navy via-navy-deep to-navy sm:h-56">
        <BannerArcos />
      </div>
      <div className="flex flex-col items-center px-6 pb-6">
        <button
          type="button"
          onClick={onCambiarFoto}
          aria-label="Cambiar foto de perfil"
          className="group relative -mt-12 sm:-mt-16"
        >
          <Avatar
            fotoUrl={fotoUrl}
            iniciales={iniciales}
            tamano="xl"
            className="border-4 border-white shadow-sm"
          />
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-slate/0 text-xs font-medium text-transparent transition-colors group-hover:bg-slate/40 group-hover:text-white">
            Cambiar
          </span>
        </button>
        <h1 className="mt-4 text-center font-display text-2xl font-semibold text-navy">
          {nombreCompleto}
        </h1>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <span className="inline-flex items-center rounded-full bg-mist px-2.5 py-0.5 text-xs font-medium text-navy">
            {PUESTO_LABEL[administrativo.puesto]}
          </span>
          <span className="inline-flex items-center rounded-full bg-mist px-2.5 py-0.5 text-xs font-medium text-navy">
            {ESTATUS_EMPLEADO_LABEL[administrativo.estatus]}
          </span>
        </div>
      </div>
    </div>
  );
}

type SeccionId = 'permiso' | 'datos' | 'sede' | 'contactos';

const SECCIONES_REALES: { id: SeccionId; etiqueta: string }[] = [
  { id: 'permiso', etiqueta: 'Nivel de permiso' },
  { id: 'datos', etiqueta: 'Datos personales' },
  { id: 'sede', etiqueta: 'Sede' },
  { id: 'contactos', etiqueta: 'Contactos' },
];

function SidebarSecciones({
  activa,
  onCambiar,
}: {
  activa: SeccionId;
  onCambiar: (id: SeccionId) => void;
}) {
  return (
    <nav className="flex gap-1 overflow-x-auto pb-1 sm:w-48 sm:shrink-0 sm:flex-col sm:overflow-visible sm:border-r sm:border-mist sm:pr-4 sm:pb-0">
      {SECCIONES_REALES.map((item) => {
        const esActiva = item.id === activa;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onCambiar(item.id)}
            aria-current={esActiva ? 'page' : undefined}
            className={
              esActiva
                ? 'shrink-0 rounded-full bg-mist px-4 py-2 text-left text-sm font-medium text-navy sm:rounded-none sm:border-l-4 sm:border-navy sm:bg-transparent sm:pl-3'
                : 'shrink-0 rounded-full px-4 py-2 text-left text-sm font-medium text-slate/70 hover:text-navy sm:rounded-none sm:border-l-4 sm:border-transparent sm:pl-3'
            }
          >
            {item.etiqueta}
          </button>
        );
      })}
    </nav>
  );
}

function PanelSeccion({
  seccion,
  administrativo,
  email,
  sede,
}: {
  seccion: SeccionId;
  administrativo: PerfilAdministrativo;
  email: string;
  sede: Perfil['sede'];
}) {
  switch (seccion) {
    case 'permiso':
      return <SeccionNivelPermiso administrativo={administrativo} />;
    case 'datos':
      return <SeccionDatosPersonales administrativo={administrativo} email={email} />;
    case 'sede':
      return <SeccionSede sede={sede} />;
    case 'contactos':
      return <SeccionContactos administrativo={administrativo} />;
    default: {
      // Guard de exhaustividad — mismo criterio que `app/alumno/page.tsx`/
      // `app/maestro/page.tsx` (hallazgo de la revisión final del rediseño
      // de alumno, 2026-08-21).
      const _exhaustivo: never = seccion;
      return _exhaustivo;
    }
  }
}

/**
 * Indicador de nivel de permiso — el entregable central del roadmap de Día
 * 18 ("que refleje correctamente su permiso"). Primera sección del sidebar,
 * con los tokens de marca `navy`/`gold` ya establecidos.
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
  const nombreCompleto = nombreCompletoDe(administrativo);

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
 * de `app/maestro/page.tsx`, sin badge de tipo: `ContactoAdministrativo`
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

/**
 * Nombre completo del administrativo, en formato "Nombres ApellidoPaterno
 * ApellidoMaterno" — mismo helper que `app/alumno/page.tsx`/
 * `app/maestro/page.tsx`, duplicado acá (regla 11).
 */
function nombreCompletoDe(persona: {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
}): string {
  return [persona.nombres, persona.apellidoPaterno, persona.apellidoMaterno]
    .filter(Boolean)
    .join(' ');
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
