'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/http';
import {
  obtenerMisAsignaciones,
  obtenerPerfil,
  type ContactoMaestro,
  type GrupoConMaterias,
  type Perfil,
  type PerfilMaestro,
  type TipoContratacion,
} from '@/lib/api/perfil';
import { Avatar } from '@/components/maestro/ui/Avatar';
import {
  SkeletonLines,
  SkeletonProfileCard,
} from '@/components/maestro/ui/Skeleton';
import { SubirFotoModal } from './SubirFotoModal';

/**
 * Perfil de maestro — Fase 5, Día 17.
 *
 * Reemplaza el placeholder de Día 9. Solo lectura (sin formulario de
 * edición — fuera de alcance del roadmap de hoy): datos personales, sede,
 * contactos, consumidos de `GET /perfil` (`App/backend/src/perfil/`) vía
 * `lib/api/perfil.ts`.
 *
 * `SedeGuard` (backend) ya obliga sesión válida antes de responder, y
 * `src/proxy.ts` (check optimista) ya garantiza que solo entra un JWT con
 * `rol: MAESTRO` a este árbol de rutas — no se repite esa verificación acá,
 * mismo criterio que el resto de `app/maestro/*`.
 *
 * Regla 11 de CLAUDE.md raíz: árbol propio, sin componentes compartidos con
 * `app/admin/`/`app/alumno/`. Este archivo es autocontenido.
 *
 * Rediseño visual (2026-09-07, plan
 * `docs/superpowers/plans/2026-09-07-perfil-maestro-tiposangre-rvoe.md`):
 * el layout de una sola tarjeta con secciones apiladas se reemplazó por el
 * mismo patrón que `app/alumno/page.tsx` (2026-08-21) — encabezado
 * (`EncabezadoPerfil`, banner con arcos SVG + avatar circular + badges) y un
 * sidebar de navegación (`SidebarSecciones` + `PanelSeccion`) que muestra una
 * sección a la vez (Datos personales, Sede, Contactos, Asignaciones). El
 * patrón se duplica dentro de este árbol (`BannerArcos`, `Campo`, etc.) — no
 * se importa nada de `app/alumno/page.tsx` (regla 11). A diferencia del
 * alumno, no hay secciones "próximamente" (el maestro no tiene un backlog de
 * features futuras documentado como el alumno) ni badge de "menor de edad"
 * (`PerfilMaestro` no tiene `fechaNacimiento`). Los datos y el contrato con
 * el backend no cambiaron, solo cómo se presentan.
 */
export default function MaestroPerfilPage() {
  const {
    data: perfil,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['maestro', 'perfil'],
    queryFn: async () => {
      try {
        return await obtenerPerfil();
      } catch (err) {
        // Regla 12 de `CLAUDE.md` raíz — loguear antes de dejar que React
        // Query marque `isError` y la UI muestre el mensaje genérico.
        console.error('[MaestroPerfilPage] Error al obtener el perfil:', err);
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
  const [seccion, setSeccion] = useState<SeccionId>('datos');
  const queryClient = useQueryClient();
  const [modalFotoAbierto, setModalFotoAbierto] = useState(false);

  // `maestro` viene lleno para `rol === 'MAESTRO'` (el único caso que aplica
  // en este árbol de rutas — ver nota de `SedeGuard`/`proxy.ts` arriba). Se
  // maneja el `null` de forma defensiva de todos modos, sin asumir el shape
  // por el rol esperado.
  if (!perfil.maestro) {
    return (
      <div className="mx-auto max-w-6xl rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-navy">Mi perfil</h1>
        <p className="mt-4 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-crimson">
          No se encontraron datos de perfil de maestro para tu cuenta.
        </p>
      </div>
    );
  }

  const maestro = perfil.maestro;
  const iniciales = (
    maestro.nombres.charAt(0) + maestro.apellidoPaterno.charAt(0)
  ).toUpperCase();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <EncabezadoPerfil
        maestro={maestro}
        fotoUrl={perfil.fotoUrl}
        iniciales={iniciales}
        onCambiarFoto={() => setModalFotoAbierto(true)}
      />
      <div className="flex flex-col gap-4 rounded-lg border border-mist bg-white p-4 shadow-sm sm:flex-row sm:gap-6 sm:p-6">
        <SidebarSecciones activa={seccion} onCambiar={setSeccion} />
        <div className="min-w-0 flex-1">
          <PanelSeccion seccion={seccion} maestro={maestro} email={perfil.email} sede={perfil.sede} />
        </div>
      </div>

      {modalFotoAbierto && (
        <SubirFotoModal
          fotoUrlActual={perfil.fotoUrl}
          onClose={() => setModalFotoAbierto(false)}
          onCambioConExito={() =>
            queryClient.invalidateQueries({ queryKey: ['maestro', 'perfil'] })
          }
        />
      )}
    </div>
  );
}

/**
 * Patrón de arcos concéntricos del banner — mismo signature visual que
 * `app/alumno/page.tsx` (2026-08-21), duplicado acá a propósito (regla 11 —
 * árboles independientes, sin componentes compartidos entre `app/maestro/`
 * y `app/alumno/`). SVG inline, sin imagen cargada.
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
 * Encabezado del perfil — banner + avatar + nombre + badge de estatus. El
 * avatar (`Avatar`, feature "Foto de perfil" 2026-09-17) muestra la foto
 * real si `perfil.fotoUrl` existe, o las iniciales como respaldo — reemplaza
 * al ícono placeholder (`IconPerfil`) que se usaba antes de que existiera la
 * subida de foto. Es el disparador del modal de subida propia
 * (`SubirFotoModal`). El subtítulo usa la cédula profesional en vez de
 * matrícula/carrera (el maestro no tiene esos campos) — si no tiene cédula
 * capturada, se muestra solo el nombre. Sin badge de "menor de edad" (no
 * aplica a `PerfilMaestro`).
 */
function EncabezadoPerfil({
  maestro,
  fotoUrl,
  iniciales,
  onCambiarFoto,
}: {
  maestro: PerfilMaestro;
  fotoUrl: string | null;
  iniciales: string;
  onCambiarFoto: () => void;
}) {
  const nombreCompleto = nombreCompletoDe(maestro);

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
        {maestro.cedulaProfesional && (
          <p className="mt-1 text-sm text-slate/70">
            Cédula profesional {maestro.cedulaProfesional}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <span className="inline-flex items-center rounded-full bg-mist px-2.5 py-0.5 text-xs font-medium text-navy">
            {ESTATUS_EMPLEADO_LABEL[maestro.estatus]}
          </span>
        </div>
      </div>
    </div>
  );
}

type SeccionId = 'datos' | 'sede' | 'contactos' | 'asignaciones';

const SECCIONES_REALES: { id: SeccionId; etiqueta: string }[] = [
  { id: 'datos', etiqueta: 'Datos personales' },
  { id: 'sede', etiqueta: 'Sede' },
  { id: 'contactos', etiqueta: 'Contactos' },
  { id: 'asignaciones', etiqueta: 'Asignaciones' },
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
  maestro,
  email,
  sede,
}: {
  seccion: SeccionId;
  maestro: PerfilMaestro;
  email: string;
  sede: Perfil['sede'];
}) {
  switch (seccion) {
    case 'datos':
      return <SeccionDatosPersonales maestro={maestro} email={email} />;
    case 'sede':
      return <SeccionSede sede={sede} />;
    case 'contactos':
      return <SeccionContactos maestro={maestro} />;
    case 'asignaciones':
      return <SeccionAsignaciones />;
    default: {
      // Guard de exhaustividad — mismo criterio que `app/alumno/page.tsx`
      // (hallazgo de la revisión final del rediseño de alumno, 2026-08-21).
      const _exhaustivo: never = seccion;
      return _exhaustivo;
    }
  }
}

function SeccionDatosPersonales({
  maestro,
  email,
}: {
  maestro: PerfilMaestro;
  email: string;
}) {
  const nombreCompleto = nombreCompletoDe(maestro);

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
        <Campo
          etiqueta="Tipo de contratación"
          valor={
            maestro.tipoContratacion
              ? TIPO_CONTRATACION_LABEL[maestro.tipoContratacion]
              : undefined
          }
        />
        {maestro.tipoContratacion === 'TEMPORAL' && (
          <Campo
            etiqueta="Días de contrato temporal"
            valor={
              maestro.diasTemporal != null
                ? String(maestro.diasTemporal)
                : undefined
            }
          />
        )}
        {maestro.tipoContratacion === 'CONTRATO' && (
          <>
            <Campo
              etiqueta="Inicio del contrato"
              valor={
                maestro.contratoFechaInicio
                  ? formatearFecha(maestro.contratoFechaInicio)
                  : undefined
              }
            />
            <Campo
              etiqueta="Fin del contrato"
              valor={
                maestro.contratoFechaFin
                  ? formatearFecha(maestro.contratoFechaFin)
                  : undefined
              }
            />
          </>
        )}
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
 * `app/alumno/page.tsx`, sin el badge "Tutor responsable": un
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

/**
 * Mis grupos y materias asignadas — Fase 12, Día 34. Sección propia con su
 * `useQuery` contra `GET /perfil/asignaciones` (`lib/api/perfil.ts`). Solo
 * lectura, agrupada por grupo. Regla 11: árbol `app/maestro/` propio, sin
 * componentes de admin/alumno. Regla 12: `console.error` en el catch del
 * `queryFn`.
 */
function SeccionAsignaciones() {
  const {
    data: grupos,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['maestro', 'asignaciones'],
    queryFn: async () => {
      try {
        return await obtenerMisAsignaciones();
      } catch (err) {
        console.error(
          '[MaestroAsignaciones] Error al obtener asignaciones:',
          err,
        );
        throw err;
      }
    },
  });

  return (
    <section className="rounded-lg border border-mist p-5">
      <h2 className="text-sm font-semibold text-navy">Mis grupos y materias</h2>

      {isLoading && <SkeletonLines count={3} />}

      {isError && (
        <p className="mt-3 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-crimson">
          {error instanceof ApiError
            ? error.message
            : 'No se pudieron cargar tus asignaciones. Intenta de nuevo más tarde.'}
        </p>
      )}

      {!isLoading && !isError && grupos && grupos.length === 0 && (
        <p className="mt-3 text-sm text-slate/60">
          Aún no tienes materias asignadas.
        </p>
      )}

      {!isLoading && !isError && grupos && grupos.length > 0 && (
        <div className="mt-3 space-y-4">
          {grupos.map((grupo) => (
            <GrupoAsignado key={grupo.grupoId} grupo={grupo} />
          ))}
        </div>
      )}
    </section>
  );
}

function GrupoAsignado({ grupo }: { grupo: GrupoConMaterias }) {
  return (
    <div className="rounded-lg border border-mist bg-bone/60 p-4">
      <h3 className="text-sm font-semibold text-navy">{grupo.nombre}</h3>
      <p className="mt-0.5 text-xs text-slate/60">
        {grupo.carrera.nombre} · {grupo.anioInicio}-{grupo.cicloActual} · Salón{' '}
        {grupo.salon.nombre}
      </p>
      {grupo.materias.length === 0 ? (
        <p className="mt-3 text-sm text-slate/60">
          Sin materias asignadas en este grupo.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-mist">
          {grupo.materias.map((materia) => (
            <li key={materia.id} className="py-2 first:pt-0 last:pb-0">
              <p className="text-sm font-medium text-slate">{materia.nombre}</p>
              <p className="text-xs text-slate/50">Ciclo {materia.ciclo}</p>
            </li>
          ))}
        </ul>
      )}
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
 * Nombre completo del maestro, en formato "Nombres ApellidoPaterno
 * ApellidoMaterno" — mismo helper que `app/alumno/page.tsx`, duplicado acá
 * (regla 11).
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

const TIPO_CONTRATACION_LABEL: Record<TipoContratacion, string> = {
  BASE: 'Base',
  TEMPORAL: 'Temporal',
  CONTRATO: 'Por contrato',
};
