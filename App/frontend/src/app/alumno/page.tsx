'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api/http';
import {
  obtenerPerfil,
  obtenerUrlDescargaMalla,
  type ContactoAlumno,
  type Perfil,
  type PerfilAlumno,
} from '@/lib/api/perfil';
import { IconCandado, IconPerfil } from '@/components/alumno/ui/shell/icons';

/**
 * Perfil de alumno — Fase 5, Día 16.
 *
 * Reemplaza el placeholder de Día 9. Solo lectura (sin formulario de
 * edición — fuera de alcance del roadmap de hoy): datos personales, sede,
 * carrera/plan de estudios, consumidos de `GET /perfil`
 * (`App/backend/src/perfil/`) vía `lib/api/perfil.ts`.
 *
 * `SedeGuard` (backend) ya obliga sesión válida antes de responder, y
 * `src/proxy.ts` (check optimista) ya garantiza que solo entra un JWT con
 * `rol: ALUMNO` a este árbol de rutas — no se repite esa verificación acá,
 * mismo criterio que el resto de `app/alumno/*`.
 *
 * Regla 11 de CLAUDE.md raíz: árbol propio, sin componentes compartidos con
 * `app/admin/` — este archivo no reutiliza nada de
 * `components/admin/ui/persona-alta/`.
 */
export default function AlumnoPerfilPage() {
  const {
    data: perfil,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['alumno', 'perfil'],
    queryFn: async () => {
      try {
        return await obtenerPerfil();
      } catch (err) {
        // Regla 12 de `CLAUDE.md` raíz — loguear antes de dejar que React
        // Query marque `isError` y la UI muestre el mensaje genérico.
        console.error('[AlumnoPerfilPage] Error al obtener el perfil:', err);
        throw err;
      }
    },
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
  const [seccion, setSeccion] = useState<SeccionId>('datos');

  // `alumno` viene lleno para `rol === 'ALUMNO'` (el único caso que aplica en
  // este árbol de rutas — ver nota de `SedeGuard`/`proxy.ts` arriba). Se
  // maneja el `null` de forma defensiva de todos modos, sin asumir el shape
  // por el rol esperado.
  if (!perfil.alumno) {
    return (
      <div className="max-w-4xl rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-navy">Mi perfil</h1>
        <p className="mt-4 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-crimson">
          No se encontraron datos de perfil de alumno para tu cuenta.
        </p>
      </div>
    );
  }

  const alumno = perfil.alumno;

  return (
    <div className="max-w-4xl space-y-6">
      <EncabezadoPerfil alumno={alumno} />
      <div className="flex flex-col gap-4 rounded-lg border border-mist bg-white p-4 shadow-sm sm:flex-row sm:gap-6 sm:p-6">
        <SidebarSecciones activa={seccion} onCambiar={setSeccion} />
        <div className="min-w-0 flex-1">
          <PanelSeccion seccion={seccion} alumno={alumno} email={perfil.email} sede={perfil.sede} />
        </div>
      </div>
    </div>
  );
}

/**
 * Patrón de arcos concéntricos del banner — signature visual del rediseño
 * (2026-08-21, ver `docs/superpowers/specs/2026-08-21-rediseno-perfil-
 * alumno-design.md`). SVG inline, sin imagen cargada — el sistema no tiene
 * fotos reales de alumnos. Colores: tokens `gold` ya existentes en
 * `globals.css`, sobre el degradado `navy` del contenedor padre.
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
 * Encabezado del perfil — banner + avatar + nombre + badges de estatus.
 * Reemplaza el `<h1>Mi perfil</h1>` suelto que había antes. El avatar es un
 * ícono placeholder (`IconPerfil`, no una foto real ni iniciales — no
 * existe feature de subida de foto todavía). `estatusAcademico` y
 * `esMenorDeEdad` ya se mostraban como campo/badge dentro de "Datos
 * personales"; acá se repiten como badges destacados del encabezado, el
 * dato es el mismo, solo se muestra también en un lugar más prominente.
 */
function EncabezadoPerfil({ alumno }: { alumno: PerfilAlumno }) {
  const nombreCompleto = [
    alumno.nombres,
    alumno.apellidoPaterno,
    alumno.apellidoMaterno,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="overflow-hidden rounded-lg border border-mist bg-white shadow-sm">
      <div className="relative h-32 overflow-hidden bg-gradient-to-br from-navy via-navy-deep to-navy sm:h-56">
        <BannerArcos />
      </div>
      <div className="flex flex-col items-center px-6 pb-6">
        <div className="-mt-12 flex h-24 w-24 items-center justify-center rounded-full border-4 border-white bg-mist text-navy shadow-sm sm:-mt-16 sm:h-32 sm:w-32">
          <IconPerfil className="h-12 w-12 sm:h-16 sm:w-16" />
        </div>
        <h1 className="mt-4 text-center font-display text-2xl font-semibold text-navy">
          {nombreCompleto}
        </h1>
        <p className="mt-1 text-sm text-slate/70">
          {alumno.matricula} · {alumno.carrera.nombre}
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <span className="inline-flex items-center rounded-full bg-mist px-2.5 py-0.5 text-xs font-medium text-navy">
            {ESTATUS_ACADEMICO_LABEL[alumno.estatusAcademico]}
          </span>
          {alumno.esMenorDeEdad && (
            <span className="inline-flex items-center rounded-full bg-gold/20 px-2.5 py-0.5 text-xs font-medium text-gold-deep">
              Menor de edad
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

type SeccionId = 'datos' | 'sede' | 'carrera' | 'contactos';

const SECCIONES_REALES: { id: SeccionId; etiqueta: string }[] = [
  { id: 'datos', etiqueta: 'Datos personales' },
  { id: 'sede', etiqueta: 'Sede' },
  { id: 'carrera', etiqueta: 'Carrera' },
  { id: 'contactos', etiqueta: 'Contactos' },
];

/**
 * Secciones sin backend ni dato real detrás todavía — decisión explícita
 * del usuario de mostrarlas igual en el sidebar, deshabilitadas, con la
 * leyenda "Próximamente en futuras versiones" (ver spec de esta feature).
 */
const SECCIONES_PROXIMAMENTE = ['Calificaciones', 'Horario', 'Documentos', 'Pagos'];

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
      <div className="mx-1 hidden shrink-0 border-t border-mist sm:my-2 sm:block" />
      {SECCIONES_PROXIMAMENTE.map((etiqueta) => (
        <button
          key={etiqueta}
          type="button"
          disabled
          title="Próximamente en futuras versiones"
          className="flex shrink-0 cursor-not-allowed items-center gap-1.5 rounded-full px-4 py-2 text-left text-sm text-slate/40 sm:rounded-none sm:border-l-4 sm:border-transparent sm:pl-3"
        >
          <IconCandado className="h-3.5 w-3.5 shrink-0" />
          {etiqueta}
        </button>
      ))}
    </nav>
  );
}

function PanelSeccion({
  seccion,
  alumno,
  email,
  sede,
}: {
  seccion: SeccionId;
  alumno: PerfilAlumno;
  email: string;
  sede: Perfil['sede'];
}) {
  switch (seccion) {
    case 'datos':
      return <SeccionDatosPersonales alumno={alumno} email={email} />;
    case 'sede':
      return <SeccionSede sede={sede} />;
    case 'carrera':
      return <SeccionCarrera alumno={alumno} />;
    case 'contactos':
      return <SeccionContactos alumno={alumno} />;
  }
}

function SeccionDatosPersonales({
  alumno,
  email,
}: {
  alumno: PerfilAlumno;
  email: string;
}) {
  const nombreCompleto = [
    alumno.nombres,
    alumno.apellidoPaterno,
    alumno.apellidoMaterno,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className="rounded-lg border border-mist p-5">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-navy">Datos personales</h2>
        {alumno.esMenorDeEdad && (
          <span className="inline-flex items-center rounded-full bg-mist px-2.5 py-0.5 text-xs font-medium text-navy">
            Menor de edad
          </span>
        )}
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        <Campo etiqueta="Nombre completo" valor={nombreCompleto} />
        <Campo etiqueta="Matrícula" valor={alumno.matricula} />
        <Campo etiqueta="CURP" valor={alumno.curp} />
        <Campo
          etiqueta="Fecha de nacimiento"
          valor={formatearFecha(alumno.fechaNacimiento)}
        />
        <Campo etiqueta="Correo institucional" valor={email} />
        <Campo etiqueta="Correo personal" valor={alumno.correoPersonal} />
        <Campo etiqueta="Teléfono" valor={alumno.telefono} />
        <Campo
          etiqueta="Estatus académico"
          valor={ESTATUS_ACADEMICO_LABEL[alumno.estatusAcademico]}
        />
        <Campo etiqueta="Periodo de ingreso" valor={alumno.periodoIngreso} />
        <Campo etiqueta="Semestre actual" valor={String(alumno.semestreActual)} />
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

function SeccionCarrera({ alumno }: { alumno: PerfilAlumno }) {
  const carrera = alumno.carrera;
  const [descargando, setDescargando] = useState(false);

  async function handleDescargar() {
    setDescargando(true);
    try {
      const resultado = await obtenerUrlDescargaMalla();
      if (!resultado) {
        toast.info(
          'Tu malla curricular aún no ha sido cargada por la escuela. Estará disponible pronto.',
        );
        return;
      }
      const ventana = window.open(resultado.url, '_blank', 'noopener');
      if (!ventana) {
        toast.error(
          'Tu navegador bloqueó la ventana emergente. Permite las ventanas emergentes para este sitio e intenta de nuevo.',
        );
      }
    } catch (err) {
      console.error('[SeccionCarrera] Error al descargar malla curricular:', err);
      toast.error(
        err instanceof ApiError
          ? err.message
          : 'No se pudo descargar la malla curricular. Intenta de nuevo.',
      );
    } finally {
      setDescargando(false);
    }
  }

  return (
    <section className="rounded-lg border border-mist p-5">
      <h2 className="text-sm font-semibold text-navy">
        Carrera / plan de estudios
      </h2>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        <Campo etiqueta="Carrera" valor={carrera.nombre} />
        <Campo etiqueta="Clave" valor={carrera.clave} />
        <Campo etiqueta="RVOE" valor={carrera.rvoe} />
        <Campo
          etiqueta="Duración"
          valor={`${carrera.duracion} ${carrera.duracion === 1 ? 'semestre' : 'semestres'}`}
        />
        <Campo etiqueta="Nivel" valor={NIVEL_CARRERA_LABEL[carrera.nivel]} />
        <Campo
          etiqueta="Modalidad"
          valor={MODALIDAD_CARRERA_LABEL[carrera.modalidad]}
        />
        {carrera.descripcion && (
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium text-slate/50">Descripción</dt>
            <dd className="mt-0.5 text-sm text-slate">{carrera.descripcion}</dd>
          </div>
        )}
      </dl>
      <button
        onClick={handleDescargar}
        disabled={descargando}
        className="mt-4 rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
      >
        {descargando ? 'Generando enlace…' : 'Descargar malla curricular'}
      </button>
    </section>
  );
}

/**
 * Contacto de emergencia y tutor — gap real reportado por el usuario
 * probando la app (2026-08-13): estos datos ya se capturaban en el alta
 * (`ContactoAlumno`, `App/backend/src/perfil/perfil.service.ts`) pero no se
 * renderizaban en ningún lado del perfil.
 *
 * `alumno.contactos` viene de `GET /perfil` ya ordenado por `orden`
 * ascendente (el backend ordena, no este componente) — se recorre tal cual,
 * SIN reordenar, aunque el tutor se destaque visualmente con badge/color
 * distinto al de "Contacto de emergencia".
 */
function SeccionContactos({ alumno }: { alumno: PerfilAlumno }) {
  const contactos = alumno.contactos;

  return (
    <section className="rounded-lg border border-mist p-5">
      <h2 className="text-sm font-semibold text-navy">
        Contacto de emergencia y tutor
      </h2>
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

function ContactoItem({ contacto }: { contacto: ContactoAlumno }) {
  const esTutor = contacto.tipo === 'TUTOR';

  return (
    <div
      className={
        esTutor
          ? 'rounded-lg border border-gold/50 bg-gold/10 p-4'
          : 'rounded-lg border border-mist bg-bone/60 p-4'
      }
    >
      <span
        className={
          esTutor
            ? 'inline-flex items-center rounded-full bg-gold-deep px-2.5 py-0.5 text-xs font-medium text-bone'
            : 'inline-flex items-center rounded-full bg-mist px-2.5 py-0.5 text-xs font-medium text-navy'
        }
      >
        {esTutor ? 'Tutor responsable' : 'Contacto de emergencia'}
      </span>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
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

const ESTATUS_ACADEMICO_LABEL: Record<PerfilAlumno['estatusAcademico'], string> = {
  INSCRITO: 'Inscrito',
  BAJA_TEMPORAL: 'Baja temporal',
  BAJA_DEFINITIVA: 'Baja definitiva',
  EGRESADO: 'Egresado',
};

const NIVEL_CARRERA_LABEL: Record<PerfilAlumno['carrera']['nivel'], string> = {
  TECNICO: 'Técnico',
  LICENCIATURA: 'Licenciatura',
  MAESTRIA: 'Maestría',
  DOCTORADO: 'Doctorado',
};

const MODALIDAD_CARRERA_LABEL: Record<
  PerfilAlumno['carrera']['modalidad'],
  string
> = {
  PRESENCIAL: 'Presencial',
  SEMIPRESENCIAL: 'Semipresencial',
  EN_LINEA: 'En línea',
};
