import type { TelefonoEmergenciaSede } from '@prisma/client';
import type { ActualizarTelefonoDto } from './dto/actualizar-telefono.dto';

/**
 * Compara cada campo presente en el `dto` contra el valor actual — mismo
 * criterio que `hayCambiosReales` de `SalonesService`/`CarrerasService`. Un
 * campo ausente del `dto` (PATCH parcial o vacío) nunca cuenta como cambio.
 */
export function hayCambiosRealesTelefono(
  dto: ActualizarTelefonoDto,
  existente: Pick<TelefonoEmergenciaSede, 'etiqueta' | 'telefono'>,
): boolean {
  const campos = ['etiqueta', 'telefono'] as const;
  for (const campo of campos) {
    if (dto[campo] !== undefined && dto[campo] !== existente[campo]) return true;
  }
  return false;
}
