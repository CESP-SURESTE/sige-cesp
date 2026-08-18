'use client';

import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import type { AltaPersonaResult } from '@/lib/api/personas';

/**
 * Panel de éxito compartido por los 3 formularios de alta de persona —
 * muestra el correo (login generado por el backend, ver nota 2026-08-18 más
 * abajo) y la `temporaryPassword` devueltos por `POST /personas`, con botón
 * de copiar al portapapeles y botón para dar de alta a otra persona del
 * mismo tipo.
 *
 * Día 13 (correo de bienvenida) ya está construido y activo (Mailgun,
 * desbloqueado 2026-08-17) — el backend SIEMPRE intenta el envío como
 * efecto best-effort tras el alta, pero la entrega real no está
 * garantizada todavía (cuenta en modo sandbox: Mailgun solo entrega a
 * destinatarios autorizados manualmente en su dashboard) y el backend no
 * devuelve si el envío tuvo éxito (fire-and-forget silencioso, ver
 * `PersonasService.altaPersona`). Por eso este panel sigue mostrando la
 * contraseña temporal en pantalla como respaldo manual — no es un
 * indicador de que el correo automático siga bloqueado.
 *
 * `resultado.usuario.email` (2026-08-18) ya NO es lo que el admin tecleó —
 * el backend ahora GENERA el login, el campo "Correo" de este panel solo
 * muestra ese valor generado. `resultado.matricula` (solo presente si
 * `rol === ALUMNO`) es la matrícula generada, se muestra con el mismo
 * patrón de copiar-al-portapapeles que `temporaryPassword` (mismo
 * comportamiento, solo replicado para este campo nuevo).
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
  const [matriculaCopiada, setMatriculaCopiada] = useState(false);

  async function copiarPassword() {
    try {
      await navigator.clipboard.writeText(resultado.temporaryPassword);
      setCopiado(true);
      toast.success('Contraseña copiada al portapapeles');
    } catch (err) {
      console.error('No se pudo copiar la contraseña temporal al portapapeles', err);
    }
  }

  async function copiarMatricula() {
    if (!resultado.matricula) {
      return;
    }
    try {
      await navigator.clipboard.writeText(resultado.matricula);
      setMatriculaCopiada(true);
      toast.success('Matrícula copiada al portapapeles');
    } catch (err) {
      console.error('No se pudo copiar la matrícula al portapapeles', err);
    }
  }

  return (
    <div className="max-w-lg rounded-lg border-l-4 border-navy bg-white px-6 py-6 shadow-sm">
      <h1 className="font-display text-xl font-semibold text-slate">{titulo}</h1>
      <div className="mt-4 rounded-lg border border-success-border bg-success-bg p-4">
        <p className="text-sm text-success">
          La cuenta se creó correctamente. Se intentó enviar estos datos por correo, pero
          la entrega no está garantizada mientras el dominio siga en modo de prueba —
          comunícalos también de forma manual como respaldo.
        </p>
        <dl className="mt-3 space-y-3 text-sm">
          <div>
            <dt className="font-medium text-slate/70">Correo</dt>
            <dd className="text-slate">{resultado.usuario.email}</dd>
          </div>
          {resultado.matricula && (
            <div>
              <dt className="font-medium text-slate/70">Matrícula</dt>
              <dd className="mt-1 flex items-center gap-2">
                <code className="rounded-lg border border-gold bg-white px-2 py-1 text-slate">
                  {resultado.matricula}
                </code>
                <button
                  type="button"
                  onClick={copiarMatricula}
                  className="rounded-lg border border-mist px-2 py-1 text-xs font-medium text-slate/80 hover:bg-bone"
                >
                  {matriculaCopiada ? 'Copiado' : 'Copiar'}
                </button>
              </dd>
            </div>
          )}
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
