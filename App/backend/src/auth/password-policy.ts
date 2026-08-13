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
export const POLITICA_PASSWORD_HABILITADA = false;

const LONGITUD_MINIMA = 10; // "más de 10" del encargo → 11+ caracteres reales
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
  const tieneSecuenciaDebil = SECUENCIAS_DEBILES.some((seq) =>
    lower.includes(seq),
  );
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
