'use client';

import Link from 'next/link';
import { useState } from 'react';
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
    } catch (err) {
      console.error('No se pudo copiar la contraseña temporal al portapapeles', err);
    }
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-xl font-semibold">{titulo}</h1>
      <div className="mt-4 rounded-md border border-green-200 bg-green-50 p-4">
        <p className="text-sm text-green-800">
          La cuenta se creó correctamente. Comunica estos datos de forma manual — el
          envío automático de correo (Día 13) sigue bloqueado.
        </p>
        <dl className="mt-3 space-y-3 text-sm">
          <div>
            <dt className="font-medium text-gray-700">Correo</dt>
            <dd className="text-gray-900">{resultado.usuario.email}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-700">Contraseña temporal</dt>
            <dd className="mt-1 flex items-center gap-2">
              <code className="rounded border border-gray-200 bg-white px-2 py-1 text-gray-900">
                {resultado.temporaryPassword}
              </code>
              <button
                type="button"
                onClick={copiarPassword}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
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
          className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          {botonOtroLabel}
        </button>
        <Link
          href="/admin"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          Volver al panel
        </Link>
      </div>
    </div>
  );
}
