import { Matches } from 'class-validator';

/**
 * `GET /eventos?desde=&hasta=` — ambos requeridos. El rango máximo (62
 * días) se valida en el service (depende de comparar las 2 fechas, no de
 * una sola), no acá.
 *
 * `@Matches(YYYY-MM-DD)` en vez de `@IsDateString()` — este último valida
 * contra `isISO8601`, que TAMBIÉN acepta datetimes completos
 * (`2026-01-01T10:00:00Z`), rompiendo las asunciones de fecha-sola de
 * `CalendarioService` (`aFechaUTC` les concatena `T00:00:00.000Z` a mano;
 * un datetime ya completo produce `Invalid Date`, que hace que las
 * comparaciones `NaN` pasen de largo en vez de rechazar el input).
 */
export class ListarEventosQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'desde debe tener formato YYYY-MM-DD',
  })
  desde!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'hasta debe tener formato YYYY-MM-DD',
  })
  hasta!: string;
}
