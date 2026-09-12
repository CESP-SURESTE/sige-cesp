'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { FundadorAltaResult } from '@/lib/api/sedes';

/**
 * Tarjeta de credenciales de UNA cuenta fundadora — versión recortada de
 * `components/admin/ui/persona-alta/ResultadoAltaPersona.tsx` (regla 11, no
 * se importa de ahí): esta pantalla muestra 2 cuentas a la vez (director +
 * administrativo) bajo una sola sede, así que las acciones de "otro alta" /
 * "volver" viven UNA vez a nivel de página (`page.tsx`), no repetidas por
 * tarjeta. Sin `matricula` (exclusivo de ALUMNO, no aplica acá).
 */
interface CredencialesCardProps {
  titulo: string;
  resultado: FundadorAltaResult;
}

export function CredencialesCard({ titulo, resultado }: CredencialesCardProps) {
  const [copiado, setCopiado] = useState(false);

  async function copiarPassword() {
    try {
      await navigator.clipboard.writeText(resultado.temporaryPassword);
      setCopiado(true);
      toast.success('Contraseña copiada al portapapeles');
    } catch (err) {
      console.error('[CredencialesCard] No se pudo copiar la contraseña temporal:', err);
    }
  }

  return (
    <div className="rounded-lg border border-success-border bg-success-bg p-4">
      <h3 className="text-sm font-semibold text-slate">{titulo}</h3>
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
  );
}
