'use client';

import type { ExpedienteEmergencia, TipoExpediente } from '@/lib/api/emergencia';

const TIPO_SANGRE_LABEL: Record<string, string> = {
  A_POSITIVO: 'A+', A_NEGATIVO: 'A−',
  B_POSITIVO: 'B+', B_NEGATIVO: 'B−',
  AB_POSITIVO: 'AB+', AB_NEGATIVO: 'AB−',
  O_POSITIVO: 'O+', O_NEGATIVO: 'O−',
};

const TIPO_ROL_LABEL: Record<TipoExpediente, string> = {
  ALUMNO: 'Alumno',
  MAESTRO: 'Maestro',
  ADMINISTRATIVO: 'Administrativo',
  PERSONAL_SERVICIOS: 'Personal de servicios',
};

export function ExpedientePanel({ expediente }: { expediente: ExpedienteEmergencia }) {
  const { identidad, infoMedica, contactos } = expediente;

  return (
    <div className="space-y-5 rounded-lg border-l-4 border-crimson bg-white p-6 shadow-sm">
      <header>
        <div className="flex items-center gap-2">
          <h2 className="font-display text-xl font-semibold text-slate">
            {[identidad.nombres, identidad.apellidoPaterno, identidad.apellidoMaterno]
              .filter(Boolean)
              .join(' ')}
          </h2>
          {!identidad.activo && (
            <span className="rounded-full bg-mist px-2 py-0.5 text-xs font-medium text-slate/70">
              Inactivo
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-slate/70">
          {TIPO_ROL_LABEL[expediente.tipo]} · {identidad.referencia}
          {identidad.edad !== null && ` · ${identidad.edad} años`}
        </p>
        {identidad.telefono && (
          <p className="mt-1 text-sm text-slate/70">
            Tel. propio:{' '}
            <a href={`tel:${identidad.telefono.replace(/\s+/g, '')}`} className="text-navy hover:underline">
              {identidad.telefono}
            </a>
          </p>
        )}
      </header>

      {/* Tipo de sangre — bloque prominente */}
      <div className="flex items-center gap-4 rounded-lg bg-crimson/5 p-4">
        <span className="text-sm font-medium text-slate/70">Tipo de sangre</span>
        <span className="font-display text-3xl font-bold text-crimson">
          {infoMedica?.tipoSangre ? (TIPO_SANGRE_LABEL[infoMedica.tipoSangre] ?? infoMedica.tipoSangre) : '—'}
        </span>
      </div>

      {/* Info médica */}
      <section>
        <h3 className="font-display text-sm font-semibold tracking-wide text-slate/60 uppercase">
          Información médica
        </h3>
        {infoMedica === null ? (
          <p className="mt-2 text-sm text-slate/60">Sin expediente médico registrado.</p>
        ) : (
          <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            <Campo etiqueta="¿Condición médica?" valor={infoMedica.tieneCondicionMedica ? 'Sí' : 'No'} />
            <Campo etiqueta="Padecimiento" valor={infoMedica.padecimiento} />
            <Campo etiqueta="Medicamentos" valor={infoMedica.medicamentos} />
            <Campo etiqueta="Alergias" valor={infoMedica.alergias} />
            <Campo etiqueta="Tratamiento adicional" valor={infoMedica.tratamientoAdicional} />
          </dl>
        )}
      </section>

      {/* Contactos de emergencia */}
      <section>
        <h3 className="font-display text-sm font-semibold tracking-wide text-slate/60 uppercase">
          Contactos de emergencia
        </h3>
        {contactos.length === 0 ? (
          <p className="mt-2 text-sm text-slate/60">Sin contactos de emergencia registrados.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {contactos.map((c, i) => (
              <li key={i} className="rounded-lg border border-mist px-4 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate">
                    {c.nombre}
                    <span className="ml-2 font-normal text-slate/60">
                      {c.parentesco}{c.tipo ? ` · ${c.tipo === 'TUTOR' ? 'Tutor' : 'Emergencia'}` : ''}
                    </span>
                  </span>
                  <a href={`tel:${c.telefono.replace(/\s+/g, '')}`} className="font-display text-base font-semibold text-navy hover:underline">
                    {c.telefono}
                  </a>
                </div>
                {c.correo && <p className="mt-0.5 text-slate/60">{c.correo}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Campo({ etiqueta, valor }: { etiqueta: string; valor: string | null }) {
  return (
    <div>
      <dt className="text-slate/60">{etiqueta}</dt>
      <dd className="text-slate">{valor?.trim() ? valor : '—'}</dd>
    </div>
  );
}
