'use client';

import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import type { AltaPersonaResult } from '@/lib/api/personas';

/**
 * Panel de éxito compartido por los 3 formularios de alta de persona —
 * muestra el correo y la `temporaryPassword` devueltos por `POST /personas`
 * (Día 13, correo de bienvenida, sigue BLOQUEADO: sin envío automático, el
 * admin comunica esto manualmente) con botón de copiar al portapapeles y
 * botón para dar de alta a otra persona del mismo tipo.
 */
interface ResultadoAltaPersonaProps {
  resultado: AltaPersonaResult;
  titulo: string;
  botonOtroLabel: string;
  onReset: () => void;
}

export function ResultadoAltaPersona({
  resultado,
  titulo,
  botonOtroLabel,
  onReset,
}: ResultadoAltaPersonaProps) {
  const [copiado, setCopiado] = useState(false);

  async function copiarPassword() {
    try {
      await navigator.clipboard.writeText(resultado.temporaryPassword);
      setCopiado(true);
      toast.success('Contraseña copiada al portapapeles');
    } catch (err) {
      console.error('No se pudo copiar la contraseña temporal al portapapeles', err);
    }
  }

  return (
    <div className="max-w-lg rounded-lg border-l-4 border-navy bg-white px-6 py-6 shadow-sm">
      <h1 className="font-display text-xl font-semibold text-slate">{titulo}</h1>
      <div className="mt-4 rounded-lg border border-success-border bg-success-bg p-4">
        <p className="text-sm text-success">
          La cuenta se creó correctamente. Comunica estos datos de forma manual — el
          envío automático de correo (Día 13) sigue bloqueado.
        </p>
        <dl className="mt-3 space-y-3 text-sm">
          <div>
            <dt className="font-medium text-slate/70">Correo</dt>
            <dd className="text-slate">{resultado.usuario.email}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate/70">Contraseña temporal</dt>
            <dd className="mt-1 flex items-center gap-2">
              <code className="rounded-lg border border-gold bg-white px-2 py-1 text-slate">
                {resultado.temporaryPassword}
              </code>
              <button
                type="button"
                onClick={copiarPassword}
                className="rounded-lg border border-mist px-2 py-1 text-xs font-medium text-slate/80 hover:bg-bone"
              >
                {copiado ? 'Copiado' : 'Copiar'}
              </button>
            </dd>
          </div>
        </dl>
      </div>
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={onReset}
          className="rounded-lg bg-navy px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
        >
          {botonOtroLabel}
        </button>
        <Link
          href="/admin"
          className="rounded-lg border border-mist px-3 py-2 text-sm font-medium text-slate/80 hover:bg-bone"
        >
          Volver al panel
        </Link>
      </div>
    </div>
  );
}
