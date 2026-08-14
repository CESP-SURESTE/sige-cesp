import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Hash de password de `AdminPlataforma` — Fase 6, Día 20.
 *
 * `scrypt` de `node:crypto` (nativo, sin `bcrypt`/`argon2` como dependencia
 * nueva — decisión ya tomada en `docs/roadmap.md`, nota de diseño del Día 20).
 * Formato de almacenamiento: `"<salt-hex>:<derivedKey-hex>"` — el salt viaja
 * junto al hash (estándar, no es secreto), se necesita para re-derivar la
 * key al verificar.
 */
const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  const [salt, key] = hash.split(':');
  if (!salt || !key) {
    return false;
  }

  const keyBuffer = Buffer.from(key, 'hex');
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;

  // Longitud debe coincidir antes de timingSafeEqual (revienta si difieren).
  if (derivedKey.length !== keyBuffer.length) {
    return false;
  }

  return timingSafeEqual(derivedKey, keyBuffer);
}
