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
  // `alumno` viene lleno para `rol === 'ALUMNO'` (el único caso que aplica en
  // este árbol de rutas — ver nota de `SedeGuard`/`proxy.ts` arriba). Se
  // maneja el `null` de forma defensiva de todos modos, sin asumir el shape
  // por el rol esperado.
  if (!perfil.alumno) {
    return (
      <div className="max-w-3xl rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-navy">Mi perfil</h1>
        <p className="mt-4 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-crimson">
          No se encontraron datos de perfil de alumno para tu cuenta.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
      <h1 className="font-display text-2xl font-semibold text-navy">Mi perfil</h1>

      <div className="mt-6 space-y-6">
        <SeccionDatosPersonales alumno={perfil.alumno} email={perfil.email} />
        <SeccionSede sede={perfil.sede} />
        <SeccionCarrera alumno={perfil.alumno} />
        <SeccionContactos alumno={perfil.alumno} />
      </div>
    </div>
  );
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
