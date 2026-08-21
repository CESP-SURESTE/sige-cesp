import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * Política de contraseña robusta — pedida por el usuario 2026-08-13, para
 * habilitarse recién cerca de la entrega al cliente (CESP). Por eso el flag
 * queda APAGADO por defecto: es la forma fácil de tenerla lista para
 * probarla ahora (prender el flag en local) sin que afecte a nadie más
 * mientras no se decida usarla en serio.
 *
 * Espejo manual del mismo módulo en el frontend
 * (`App/frontend/src/lib/password-policy.ts`) — no existe forma de
 * compartir código entre los 2 proyectos sin un monorepo/paquete
 * compartido (sobredimensionado para esto, ver prioridad de arquitectura
 * de `CLAUDE.md` raíz: "no sobredimensionar"). Mismo criterio de
 * "mantener en sync a mano" que ya usa `lib/api/perfil.ts` (frontend) con
 * este backend — si cambias una regla acá, cambia la otra allá.
 *
 * IMPORTANTE al activar (`POLITICA_PASSWORD_HABILITADA = true`): esto solo
 * cambia la validación de `PATCH /auth/cambiar-password`
 * (`CambiarPasswordDto.passwordNueva`, vía `@PoliticaPasswordRobusta()`
 * abajo). NO valida las contraseñas temporales que genera
 * `generateTemporaryPassword` (`src/personas/temporary-password.ts`,
 * Día 11) — esas las genera el sistema, no las escribe un humano, no
 * tiene sentido pedirles "sin secuencias obvias" de la misma forma.
 */
export const POLITICA_PASSWORD_HABILITADA = true;

const LONGITUD_MINIMA = 10; // "más de 10" del encargo → 11+ caracteres reales

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

export interface EvaluacionPoliticaPassword {
  valido: boolean;
  motivo?: string;
}

/**
 * Función pura, reutilizada por el validador de `class-validator` de abajo
 * — separada para poder testearla directo sin instanciar el DTO completo.
 */
export function evaluarPoliticaPassword(
  password: string,
): EvaluacionPoliticaPassword {
  if (!POLITICA_PASSWORD_HABILITADA) return { valido: true };

  if (typeof password !== 'string' || password.length <= LONGITUD_MINIMA) {
    return {
      valido: false,
      motivo: `La contraseña debe tener más de ${LONGITUD_MINIMA} caracteres`,
    };
  }
  if (!/[A-Z]/.test(password)) {
    return {
      valido: false,
      motivo: 'La contraseña debe incluir al menos una letra mayúscula',
    };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return {
      valido: false,
      motivo: 'La contraseña debe incluir al menos un símbolo',
    };
  }
  const lower = password.toLowerCase();
  const tieneSecuenciaDebil =
    PALABRAS_DEBILES.some((palabra) => lower.includes(palabra)) ||
    tieneCorridaObvia(password);
  // 4 o más repeticiones seguidas del mismo carácter (ej. "aaaa", "1111").
  const tieneRepeticionObvia = /(.)\1{3,}/.test(password);
  if (tieneSecuenciaDebil || tieneRepeticionObvia) {
    return {
      valido: false,
      motivo:
        'La contraseña no debe contener secuencias obvias (ej. "1234567890") ni caracteres repetidos',
    };
  }

  return { valido: true };
}

/**
 * Decorador de `class-validator` — se agrega junto a `@MinLength(8)` en
 * `CambiarPasswordDto.passwordNueva`, no lo reemplaza (ver comentario del
 * DTO). Con el flag apagado, `evaluarPoliticaPassword` siempre devuelve
 * `valido: true` — cero cambio de comportamiento hoy.
 */
export function PoliticaPasswordRobusta(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'politicaPasswordRobusta',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;
          return evaluarPoliticaPassword(value).valido;
        },
        defaultMessage(args: ValidationArguments) {
          const resultado = evaluarPoliticaPassword(args.value as string);
          return (
            resultado.motivo ??
            'La contraseña no cumple la política de seguridad'
          );
        },
      },
    });
  };
}
