/**
 * Genera el grid de 6 semanas x 7 días para la vista mensual de
 * calendario — Fase 15, Día 43. Función pura, duplicada a propósito en
 * los 3 árboles (regla 11 — sin componente/util compartido entre admin/
 * maestro/alumno más allá de `lib/api/*`).
 *
 * Las celdas de días fuera del mes (relleno antes del día 1 o después del
 * último día) SÍ se generan, para que el grid sea siempre 6x7 = 42 celdas
 * — necesario para que el layout no salte de alto entre meses. `enElMes`
 * distingue cuáles son del mes actual para pintarlas atenuadas.
 */
export interface CeldaMes {
  /** ISO `YYYY-MM-DD`, UTC. */
  fecha: string;
  enElMes: boolean;
  esHoy: boolean;
}

export function generarGridMensual(anio: number, mesIndiceCero: number): CeldaMes[] {
  const primerDiaDelMes = new Date(Date.UTC(anio, mesIndiceCero, 1));
  const inicioGrid = new Date(primerDiaDelMes);
  inicioGrid.setUTCDate(inicioGrid.getUTCDate() - primerDiaDelMes.getUTCDay());

  const hoy = new Date();
  const hoyISO = new Date(
    Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()),
  )
    .toISOString()
    .slice(0, 10);

  const celdas: CeldaMes[] = [];
  const cursor = new Date(inicioGrid);
  for (let i = 0; i < 42; i++) {
    const iso = cursor.toISOString().slice(0, 10);
    celdas.push({
      fecha: iso,
      enElMes: cursor.getUTCMonth() === mesIndiceCero,
      esHoy: iso === hoyISO,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return celdas;
}

/** Primer y último día ISO cubiertos por el grid de un mes — el rango que
 * se le pide a `GET /eventos?desde=&hasta=`. Puede ser más ancho que el
 * mes calendario real (incluye el relleno de semanas vecinas). */
export function rangoDelGrid(anio: number, mesIndiceCero: number): { desde: string; hasta: string } {
  const celdas = generarGridMensual(anio, mesIndiceCero);
  return { desde: celdas[0].fecha, hasta: celdas[celdas.length - 1].fecha };
}
