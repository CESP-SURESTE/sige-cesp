import { randomInt } from 'node:crypto';

/**
 * Generador de contraseña temporal — Fase 4, Día 11.
 *
 * Usa `crypto.randomInt` (CSPRNG de Node), NUNCA `Math.random()` — este
 * valor se usa como contraseña real de la cuenta de Supabase Auth que crea
 * `PersonasService.altaPersona`, aunque el admin la vea una sola vez en la
 * respuesta del endpoint (Día 13 — emails — todavía no existe).
 *
 * 16 caracteres por default: sensiblemente más fuerte que el mínimo de 6
 * caracteres que exige Supabase Auth por default, mezclando mayúsculas,
 * minúsculas, dígitos y símbolos — se garantiza al menos uno de cada
 * categoría (no queda a la suerte de un muestreo uniforme sobre el charset
 * completo, que en teoría podría no incluir ninguno de un tipo).
 *
 * Excluye caracteres visualmente ambiguos (`0/O`, `1/l/I`) — el admin va a
 * tener que leer/transcribir esta contraseña al alumno/maestro/administrativo
 * recién dado de alta hasta que exista el envío de correo (Día 13).
 */
const MAYUSCULAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MINUSCULAS = 'abcdefghijkmnopqrstuvwxyz';
const DIGITOS = '23456789';
const SIMBOLOS = '!@#$%^&*-_=+?';
const TODOS = MAYUSCULAS + MINUSCULAS + DIGITOS + SIMBOLOS;

function elegir(charset: string): string {
  return charset[randomInt(0, charset.length)];
}

export function generateTemporaryPassword(length = 16): string {
  if (length < 8) {
    throw new Error(
      'generateTemporaryPassword: length debe ser >= 8 para mantener una complejidad mínima razonable',
    );
  }

  const caracteres: string[] = [
    elegir(MAYUSCULAS),
    elegir(MINUSCULAS),
    elegir(DIGITOS),
    elegir(SIMBOLOS),
  ];

  for (let i = caracteres.length; i < length; i += 1) {
    caracteres.push(elegir(TODOS));
  }

  // Fisher-Yates con `randomInt` (no `Math.random()`) — evita que las 4
  // categorías garantizadas queden siempre en las primeras 4 posiciones.
  for (let i = caracteres.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1);
    [caracteres[i], caracteres[j]] = [caracteres[j], caracteres[i]];
  }

  return caracteres.join('');
}
