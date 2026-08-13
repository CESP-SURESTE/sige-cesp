'use client';

import {
  calcularFortaleza,
  evaluarRequisitos,
  LONGITUD_MINIMA,
  type NivelFortaleza,
} from '@/lib/password-policy';

/**
 * Medidor de fortaleza de contraseña en tiempo real — pedido por el usuario
 * 2026-08-13. Vive en `components/` a nivel raíz (no en `components/admin/`
 * ni `components/alumno/`) porque es infra transversal sin dueño de
 * dominio, mismo criterio ya usado por `components/logout-button.tsx`
 * (regla 11 de `CLAUDE.md` raíz no aplica a este nivel).
 *
 * Solo se usa cuando `POLITICA_PASSWORD_HABILITADA` está en `true`
 * (`lib/password-policy.ts`) — el caller decide si renderizarlo, este
 * componente no lee el flag, solo pinta lo que le pasan.
 */

const COLOR_POR_NIVEL: Record<NivelFortaleza, string> = {
  'muy-debil': 'bg-crimson',
  debil: 'bg-crimson',
  media: 'bg-warning',
  fuerte: 'bg-success',
  'muy-fuerte': 'bg-success',
};

const TEXTO_POR_NIVEL: Record<NivelFortaleza, string> = {
  'muy-debil': 'text-crimson',
  debil: 'text-crimson',
  media: 'text-warning',
  fuerte: 'text-success',
  'muy-fuerte': 'text-success',
};

export function PasswordStrengthMeter({ password }: { password: string }) {
  const fortaleza = calcularFortaleza(password);
  const requisitos = evaluarRequisitos(password);
  const segmentos = 5;

  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex gap-1" role="presentation">
        {Array.from({ length: segmentos }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i < fortaleza.puntaje ? COLOR_POR_NIVEL[fortaleza.nivel] : 'bg-mist'
            }`}
          />
        ))}
      </div>

      <p className={`mt-1.5 text-xs font-medium ${TEXTO_POR_NIVEL[fortaleza.nivel]}`}>
        {fortaleza.etiqueta}
      </p>

      <ul className="mt-1.5 grid grid-cols-1 gap-0.5 text-xs text-slate/60 sm:grid-cols-2">
        <RequisitoItem cumplido={requisitos.longitud}>
          Más de {LONGITUD_MINIMA} caracteres
        </RequisitoItem>
        <RequisitoItem cumplido={requisitos.mayuscula}>Una mayúscula</RequisitoItem>
        <RequisitoItem cumplido={requisitos.simbolo}>Un símbolo</RequisitoItem>
        <RequisitoItem cumplido={requisitos.sinPatrones}>
          Sin secuencias obvias
        </RequisitoItem>
      </ul>
    </div>
  );
}

function RequisitoItem({
  cumplido,
  children,
}: {
  cumplido: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className={cumplido ? 'text-success' : 'text-slate/50'}>
      {cumplido ? '✓' : '·'} {children}
    </li>
  );
}
