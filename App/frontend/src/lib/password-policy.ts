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

// Palabras/patrones de teclado obvios que no son una corrida ascendente o
// descendente de caracteres consecutivos (esas las detecta `tieneCorridaObvia`).
const PALABRAS_DEBILES = ['qwertyuiop', 'password', 'contrasena', 'contraseña'];

const LONGITUD_MINIMA_CORRIDA = 4; // mismo umbral que la regla de repetición ({4,})

function esDigito(c: string): boolean {
  return c >= '0' && c <= '9';
}

function esLetraAscii(c: string): boolean {
  return c >= 'a' && c <= 'z';
}

/**
 * Detecta corridas de `LONGITUD_MINIMA_CORRIDA` o más caracteres consecutivos
 * ascendentes o descendentes (dígitos con dígitos, letras con letras — nunca
 * cruzando clase) en cualquier posición de la contraseña.
 *
 * Reemplaza la lista fija de secuencias completas de 10 caracteres que había
 * antes (`'0123456789'`, etc.): esa lista solo detectaba un match exacto de
 * substring contra esos 4 strings literales, así que cualquier corrida más
 * corta se colaba — bug real reportado por el usuario 2026-08-14:
 * "123456789" (9 dígitos, sin el 0 inicial ni final) no calzaba con ninguna
 * entrada de la lista y la política lo aceptaba como válido.
 */
function tieneCorridaObvia(password: string): boolean {
  const lower = password.toLowerCase();
  let ascendente = 1;
  let descendente = 1;
  for (let i = 1; i < lower.length; i++) {
    const anterior = lower[i - 1];
    const actual = lower[i];
    const mismaClase =
      (esDigito(anterior) && esDigito(actual)) ||
      (esLetraAscii(anterior) && esLetraAscii(actual));
    if (mismaClase && actual.charCodeAt(0) === anterior.charCodeAt(0) + 1) {
      ascendente++;
      descendente = 1;
    } else if (
      mismaClase &&
      actual.charCodeAt(0) === anterior.charCodeAt(0) - 1
    ) {
      descendente++;
      ascendente = 1;
    } else {
      ascendente = 1;
      descendente = 1;
    }
    if (
      ascendente >= LONGITUD_MINIMA_CORRIDA ||
      descendente >= LONGITUD_MINIMA_CORRIDA
    ) {
      return true;
    }
  }
  return false;
}

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
  const tieneSecuenciaDebil =
    PALABRAS_DEBILES.some((palabra) => lower.includes(palabra)) ||
    tieneCorridaObvia(password);
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
