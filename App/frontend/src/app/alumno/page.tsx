'use client';

import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/http';
import { obtenerPerfil, type Perfil, type PerfilAlumno } from '@/lib/api/perfil';

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
    queryFn: obtenerPerfil,
  });

  if (isLoading) {
    return (
      <div className="max-w-3xl rounded-lg border-l-4 border-maya bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-ink">Mi perfil</h1>
        <p className="mt-4 text-sm text-ink/60">Cargando…</p>
      </div>
    );
  }

  if (isError) {
    const mensaje =
      error instanceof ApiError
        ? error.message
        : 'No se pudo cargar tu perfil. Intenta de nuevo más tarde.';

    return (
      <div className="max-w-3xl rounded-lg border-l-4 border-maya bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-ink">Mi perfil</h1>
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
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
      <div className="max-w-3xl rounded-lg border-l-4 border-maya bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-ink">Mi perfil</h1>
        <p className="mt-4 rounded-lg border border-terracota/30 bg-terracota/10 px-4 py-3 text-sm text-terracota">
          No se encontraron datos de perfil de alumno para tu cuenta.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl rounded-lg border-l-4 border-maya bg-white p-6 shadow-sm">
      <h1 className="font-display text-2xl font-semibold text-ink">Mi perfil</h1>

      <div className="mt-6 space-y-6">
        <SeccionDatosPersonales alumno={perfil.alumno} email={perfil.email} />
        <SeccionSede sede={perfil.sede} />
        <SeccionCarrera alumno={perfil.alumno} />
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
    <section className="rounded-lg border border-linea p-5">
      <h2 className="text-sm font-semibold text-ink/70">Datos personales</h2>
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
    <section className="rounded-lg border border-linea p-5">
      <h2 className="text-sm font-semibold text-ink/70">Sede</h2>
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

  return (
    <section className="rounded-lg border border-linea p-5">
      <h2 className="text-sm font-semibold text-ink/70">
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
            <dt className="text-xs font-medium text-ink/50">Descripción</dt>
            <dd className="mt-0.5 text-sm text-ink">{carrera.descripcion}</dd>
          </div>
        )}
      </dl>
    </section>
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
      <dt className="text-xs font-medium text-ink/50">{etiqueta}</dt>
      <dd className="mt-0.5 text-sm text-ink">{valor || '—'}</dd>
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
