/**
 * Motor de recurrencia — Fase 15, Día 40. Función pura, sin DB ni DI: dado
 * un evento (con o sin regla) y un rango de fechas, devuelve las fechas de
 * inicio de cada ocurrencia dentro de ese rango. Regla 1 de `CLAUDE.md`
 * raíz — las ocurrencias NUNCA se persisten, se calculan al vuelo.
 *
 * Todas las fechas son UTC puro — ver nota en el archivo de tests. Sin
 * "primer viernes de mes" ni `BYSETPOS` de iCal — solo DIARIA/SEMANAL/
 * MENSUAL con intervalo, documentado como límite de alcance explícito.
 * Sin excepciones por ocurrencia (mover/cancelar una fecha suelta de una
 * serie) — fuera de alcance de v1.
 */
export interface ReglaRecurrencia {
  frecuencia: 'DIARIA' | 'SEMANAL' | 'MENSUAL';
  /** Cada N unidades de la frecuencia. Mínimo 1 (validado en el DTO). */
  intervalo: number;
  /** Solo SEMANAL. 0 = domingo .. 6 = sábado. Si falta, se usa el día de
   * la semana de `fechaInicio`. */
  diasSemana?: number[];
  /** Solo MENSUAL. 1..31, o -1 = último día del mes. Si falta, se usa el
   * día del mes de `fechaInicio`. */
  diaMes?: number;
}

interface EventoParaExpandir {
  fechaInicio: Date;
  recurrenciaRegla: ReglaRecurrencia | null;
  recurrenciaHasta: Date | null;
}

interface RangoFechas {
  desde: Date;
  hasta: Date;
}

/** Tope duro de ocurrencias por expansión — defensa contra rango +
 * intervalo abusivos (ej. intervalo=1 con un rango de 10 años). */
export const MAX_OCURRENCIAS = 366;

function addDiasUTC(fecha: Date, dias: number): Date {
  const resultado = new Date(fecha);
  resultado.setUTCDate(resultado.getUTCDate() + dias);
  return resultado;
}

function inicioDeSemanaUTC(fecha: Date): Date {
  return addDiasUTC(fecha, -fecha.getUTCDay());
}

function ultimoDiaDelMesUTC(anio: number, mesIndiceCero: number): number {
  // Día 0 del mes siguiente == último día del mes actual.
  return new Date(Date.UTC(anio, mesIndiceCero + 1, 0)).getUTCDate();
}

function fechaDelMesUTC(primerDiaDelMes: Date, diaMes: number): Date {
  const anio = primerDiaDelMes.getUTCFullYear();
  const mes = primerDiaDelMes.getUTCMonth();
  const ultimoDia = ultimoDiaDelMesUTC(anio, mes);
  const dia = diaMes === -1 ? ultimoDia : Math.min(diaMes, ultimoDia);
  return new Date(Date.UTC(anio, mes, dia));
}

function expandirDiaria(
  fechaInicio: Date,
  limite: Date,
  intervalo: number,
  desdeEfectivo: Date,
): Date[] {
  const candidatos: Date[] = [];
  let cursor = new Date(fechaInicio);
  while (
    cursor.getTime() <= limite.getTime() &&
    candidatos.length < MAX_OCURRENCIAS
  ) {
    if (cursor.getTime() >= desdeEfectivo.getTime()) {
      candidatos.push(new Date(cursor));
    }
    cursor = addDiasUTC(cursor, intervalo);
  }
  return candidatos;
}

function expandirSemanal(
  fechaInicio: Date,
  limite: Date,
  intervalo: number,
  diasSemana: number[],
  desdeEfectivo: Date,
): Date[] {
  const dias = diasSemana.length > 0 ? diasSemana : [fechaInicio.getUTCDay()];
  const candidatos: Date[] = [];
  let semanaCursor = inicioDeSemanaUTC(fechaInicio);

  while (
    semanaCursor.getTime() <= limite.getTime() &&
    candidatos.length < MAX_OCURRENCIAS
  ) {
    for (const dia of dias) {
      const fecha = addDiasUTC(semanaCursor, dia);
      if (
        fecha.getTime() >= fechaInicio.getTime() &&
        fecha.getTime() <= limite.getTime() &&
        fecha.getTime() >= desdeEfectivo.getTime()
      ) {
        candidatos.push(fecha);
      }
      if (candidatos.length >= MAX_OCURRENCIAS) break;
    }
    semanaCursor = addDiasUTC(semanaCursor, 7 * intervalo);
  }

  candidatos.sort((a, b) => a.getTime() - b.getTime());
  return candidatos;
}

function expandirMensual(
  fechaInicio: Date,
  limite: Date,
  intervalo: number,
  diaMes: number,
  desdeEfectivo: Date,
): Date[] {
  const candidatos: Date[] = [];
  let mesCursor = new Date(
    Date.UTC(fechaInicio.getUTCFullYear(), fechaInicio.getUTCMonth(), 1),
  );

  while (candidatos.length < MAX_OCURRENCIAS) {
    const fecha = fechaDelMesUTC(mesCursor, diaMes);
    if (fecha.getTime() > limite.getTime()) break;
    if (fecha.getTime() >= desdeEfectivo.getTime()) {
      candidatos.push(fecha);
    }
    mesCursor = new Date(
      Date.UTC(
        mesCursor.getUTCFullYear(),
        mesCursor.getUTCMonth() + intervalo,
        1,
      ),
    );
  }

  return candidatos;
}

export function expandirOcurrencias(
  evento: EventoParaExpandir,
  rango: RangoFechas,
): Date[] {
  if (!evento.recurrenciaRegla) {
    const f = evento.fechaInicio;
    if (
      f.getTime() >= rango.desde.getTime() &&
      f.getTime() <= rango.hasta.getTime()
    ) {
      return [f];
    }
    return [];
  }

  const regla = evento.recurrenciaRegla;
  // `recurrenciaHasta` es requerido por el DTO (Task 3) cuando hay regla —
  // este fallback a `rango.hasta` es solo defensivo para esta función pura.
  const limiteSerie = evento.recurrenciaHasta ?? rango.hasta;
  const limiteEfectivo =
    limiteSerie.getTime() < rango.hasta.getTime() ? limiteSerie : rango.hasta;

  // Solo cuentan contra MAX_OCURRENCIAS las ocurrencias dentro (o después)
  // del inicio del rango consultado — si la serie empieza mucho antes que
  // `rango.desde`, no queremos gastar el tope de 366 en ocurrencias que de
  // todos modos se van a descartar en el filtro final de abajo.
  const desdeEfectivo =
    evento.fechaInicio.getTime() > rango.desde.getTime()
      ? evento.fechaInicio
      : rango.desde;

  let candidatos: Date[];
  if (regla.frecuencia === 'DIARIA') {
    candidatos = expandirDiaria(
      evento.fechaInicio,
      limiteEfectivo,
      regla.intervalo,
      desdeEfectivo,
    );
  } else if (regla.frecuencia === 'SEMANAL') {
    candidatos = expandirSemanal(
      evento.fechaInicio,
      limiteEfectivo,
      regla.intervalo,
      regla.diasSemana ?? [],
      desdeEfectivo,
    );
  } else {
    candidatos = expandirMensual(
      evento.fechaInicio,
      limiteEfectivo,
      regla.intervalo,
      regla.diaMes ?? evento.fechaInicio.getUTCDate(),
      desdeEfectivo,
    );
  }

  if (candidatos.length >= MAX_OCURRENCIAS) {
    console.warn(
      `[recurrencia] expansión truncada a ${MAX_OCURRENCIAS} ocurrencias (evento con fechaInicio ${evento.fechaInicio.toISOString()})`,
    );
  }

  return candidatos.filter(
    (f) =>
      f.getTime() >= rango.desde.getTime() &&
      f.getTime() <= rango.hasta.getTime(),
  );
}
