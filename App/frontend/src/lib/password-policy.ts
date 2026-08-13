/**
 * Política de contraseña robusta — pedida por el usuario 2026-08-13, para
 * habilitarse recién cerca de la entrega al cliente (CESP). Por eso el flag
 * queda APAGADO por defecto: es la forma fácil de tenerla lista para
 * probarla ahora (prender el flag en local) sin afectar a nadie más
 * mientras no se decida usarla en serio.
 *
 * Espejo manual del mismo módulo en el backend
 * (`App/backend/src/auth/password-policy.ts`) — no existe forma de
 * compartir código entre los 2 proyectos sin un monorepo/paquete
 * compartido (sobredimensionado para esto, ver prioridad de arquitectura
 * de `CLAUDE.md` raíz: "no sobredimensionar"). Mismo criterio de
 * "mantener en sync a mano" que ya usa este archivo con el backend para
 * `esMenorDeEdad` — si cambias una regla acá, cambia la otra allá.
 */
export const POLITICA_PASSWORD_HABILITADA = false;

export const LONGITUD_MINIMA = 10; // "más de 10" del encargo → 11+ caracteres reales

const SECUENCIAS_DEBILES = [
  '0123456789',
  '1234567890',
  '9876543210',
  '0987654321',
  'abcdefghij',
  'abcdefgh',
  'qwertyuiop',
  'password',
  'contrasena',
  'contraseña',
];

export interface RequisitosPassword {
  longitud: boolean;
  mayuscula: boolean;
  simbolo: boolean;
  sinPatrones: boolean;
}

/** Evalúa los 4 requisitos por separado — usado tanto para bloquear el
 * submit como para pintar el checklist bajo el campo. */
export function evaluarRequisitos(password: string): RequisitosPassword {
  const lower = password.toLowerCase();
  const tieneSecuenciaDebil = SECUENCIAS_DEBILES.some((seq) =>
    lower.includes(seq),
  );
  // 4 o más repeticiones seguidas del mismo carácter (ej. "aaaa", "1111").
  const tieneRepeticionObvia = /(.)\1{3,}/.test(password);
  return {
    longitud: password.length > LONGITUD_MINIMA,
    mayuscula: /[A-Z]/.test(password),
    simbolo: /[^A-Za-z0-9]/.test(password),
    sinPatrones:
      password.length > 0 && !tieneSecuenciaDebil && !tieneRepeticionObvia,
  };
}

export function cumpleTodosLosRequisitos(password: string): boolean {
  const r = evaluarRequisitos(password);
  return r.longitud && r.mayuscula && r.simbolo && r.sinPatrones;
}

/** Primer requisito incumplido, en el orden en que pide cumplirlos el
 * encargo — usado para el mensaje de `toast.error` al bloquear el submit. */
export function primerRequisitoFaltante(password: string): string | null {
  const r = evaluarRequisitos(password);
  if (!r.longitud) return `La contraseña debe tener más de ${LONGITUD_MINIMA} caracteres`;
  if (!r.mayuscula) return 'La contraseña debe incluir al menos una letra mayúscula';
  if (!r.simbolo) return 'La contraseña debe incluir al menos un símbolo';
  if (!r.sinPatrones)
    return 'La contraseña no debe contener secuencias obvias (ej. "1234567890") ni caracteres repetidos';
  return null;
}

export type NivelFortaleza = 'muy-debil' | 'debil' | 'media' | 'fuerte' | 'muy-fuerte';

export interface Fortaleza {
  /** 0 a 5. */
  puntaje: number;
  nivel: NivelFortaleza;
  etiqueta: string;
}

/** Puntaje 0-5 para la barra — más granular que "cumple/no cumple" para que
 * la barra se mueva mientras el usuario todavía está escribiendo. */
export function calcularFortaleza(password: string): Fortaleza {
  if (!password) return { puntaje: 0, nivel: 'muy-debil', etiqueta: 'Sin contraseña' };

  const r = evaluarRequisitos(password);
  let puntaje = 0;
  if (password.length >= 8) puntaje++;
  if (r.longitud) puntaje++;
  if (r.mayuscula) puntaje++;
  if (r.simbolo) puntaje++;
  if (r.sinPatrones) puntaje++;

  if (puntaje >= 5) return { puntaje, nivel: 'muy-fuerte', etiqueta: 'Muy robusta' };
  if (puntaje >= 4) return { puntaje, nivel: 'fuerte', etiqueta: 'Robusta' };
  if (puntaje >= 3) return { puntaje, nivel: 'media', etiqueta: 'Media' };
  if (puntaje >= 2) return { puntaje, nivel: 'debil', etiqueta: 'Débil' };
  return { puntaje, nivel: 'muy-debil', etiqueta: 'Muy débil' };
}
