'use client';

import type { EstatusAcademico, PersonaListItemAlumno } from '@/lib/api/personas';

/**
 * Modal de confirmación al matricular un alumno — local a
 * `app/admin/grupos/[id]/` (regla 11, sin import cruzado). Estructura calcada
 * de `./ConfirmarQuitarAlumnoModal.tsx`, pero: (1) botón principal `bg-navy`
 * (es un alta, no un borrado); (2) muestra una lista de solo lectura con los
 * datos que el autocomplete ya trae en `PersonaListItemAlumno` — sin fetch
 * extra. El objetivo es que el admin verifique que seleccionó al alumno
 * correcto antes de agregarlo al grupo.
 *
 * `ESTATUS_ACADEMICO_LABEL` se duplica acá (también existe en `page.tsx`) —
 * mismo criterio que `ESTATUS_EMPLEADO_LABEL`/`TIPO_LICENCIA_LABEL`, ya
 * duplicados entre archivos del árbol admin para un mapa chico sin tercer
 * consumidor.
 */

const ESTATUS_ACADEMICO_LABEL: Record<EstatusAcademico, string> = {
  INSCRITO: 'Inscrito',
  BAJA_TEMPORAL: 'Baja temporal',
  BAJA_DEFINITIVA: 'Baja definitiva',
  EGRESADO: 'Egresado',
};

interface ConfirmarMatricularAlumnoModalProps {
  alumno: PersonaListItemAlumno;
  grupoNombre: string;
  matriculando: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}

export function ConfirmarMatricularAlumnoModal({
  alumno,
  grupoNombre,
  matriculando,
  onConfirmar,
  onCancelar,
}: ConfirmarMatricularAlumnoModalProps) {
  const nombreCompleto = [
    alumno.apellidoPaterno,
    alumno.apellidoMaterno,
    alumno.nombres,
  ]
    .filter(Boolean)
    .join(' ');

  const filas: Array<{ etiqueta: string; valor: string; alerta?: boolean }> = [
    { etiqueta: 'Nombre', valor: nombreCompleto },
    { etiqueta: 'Matrícula', valor: alumno.matricula },
    { etiqueta: 'Carrera', valor: alumno.carrera.nombre },
    { etiqueta: 'Cuatrimestre actual', valor: String(alumno.cuatrimestreActual) },
    {
      etiqueta: 'Estatus académico',
      valor: ESTATUS_ACADEMICO_LABEL[alumno.estatusAcademico],
    },
    {
      etiqueta: 'Cuenta',
      valor: alumno.activo ? 'Activa' : 'Inactiva',
      alerta: !alumno.activo,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-slate">
          ¿Matricular a este alumno?
        </h2>
        <p className="mt-2 text-sm text-slate/80">
          Verifica que sea el alumno correcto antes de agregarlo al grupo{' '}
          <strong>{grupoNombre}</strong>.
        </p>

        <dl className="mt-4 divide-y divide-mist rounded-lg border border-mist text-sm">
          {filas.map((f) => (
            <div key={f.etiqueta} className="flex justify-between gap-4 px-3 py-2">
              <dt className="text-slate/60">{f.etiqueta}</dt>
              <dd
                className={`text-right font-medium ${
                  f.alerta ? 'text-warning' : 'text-slate'
                }`}
              >
                {f.valor}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancelar}
            disabled={matriculando}
            className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={matriculando}
            className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
          >
            {matriculando ? 'Matriculando…' : 'Matricular'}
          </button>
        </div>
      </div>
    </div>
  );
}
