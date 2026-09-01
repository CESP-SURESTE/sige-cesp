import { expandirOcurrencias, MAX_OCURRENCIAS } from './recurrencia.util';

function fecha(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

describe('expandirOcurrencias', () => {
  it('sin regla, fechaInicio dentro del rango -> [fechaInicio]', () => {
    const resultado = expandirOcurrencias(
      {
        fechaInicio: fecha('2026-10-15'),
        recurrenciaRegla: null,
        recurrenciaHasta: null,
      },
      { desde: fecha('2026-10-01'), hasta: fecha('2026-10-31') },
    );
    expect(resultado).toEqual([fecha('2026-10-15')]);
  });

  it('sin regla, fechaInicio fuera del rango -> []', () => {
    const resultado = expandirOcurrencias(
      {
        fechaInicio: fecha('2026-11-05'),
        recurrenciaRegla: null,
        recurrenciaHasta: null,
      },
      { desde: fecha('2026-10-01'), hasta: fecha('2026-10-31') },
    );
    expect(resultado).toEqual([]);
  });

  it('DIARIA cada 2 dias, dentro de un rango de 10 dias', () => {
    const resultado = expandirOcurrencias(
      {
        fechaInicio: fecha('2026-10-01'),
        recurrenciaRegla: { frecuencia: 'DIARIA', intervalo: 2 },
        recurrenciaHasta: fecha('2026-12-31'),
      },
      { desde: fecha('2026-10-01'), hasta: fecha('2026-10-10') },
    );
    expect(resultado).toEqual(
      [
        '2026-10-01',
        '2026-10-03',
        '2026-10-05',
        '2026-10-07',
        '2026-10-09',
      ].map(fecha),
    );
  });

  it('SEMANAL cada 2 semanas, lunes y miercoles', () => {
    // 2026-10-05 es lunes.
    const resultado = expandirOcurrencias(
      {
        fechaInicio: fecha('2026-10-05'),
        recurrenciaRegla: {
          frecuencia: 'SEMANAL',
          intervalo: 2,
          diasSemana: [1, 3],
        },
        recurrenciaHasta: fecha('2026-12-31'),
      },
      { desde: fecha('2026-10-01'), hasta: fecha('2026-11-04') },
    );
    // Semana 1 (5-11 oct): lun 5, mie 7. Semana 3 (19-25 oct, +2 semanas): lun 19, mie 21.
    // Semana 5 (2-8 nov, +2 semanas): lun 2 nov, mie 4 nov (dentro del rango inclusive).
    expect(resultado).toEqual(
      [
        '2026-10-05',
        '2026-10-07',
        '2026-10-19',
        '2026-10-21',
        '2026-11-02',
        '2026-11-04',
      ].map(fecha),
    );
  });

  it('MENSUAL dia -1 (ultimo dia del mes), 3 meses', () => {
    const resultado = expandirOcurrencias(
      {
        fechaInicio: fecha('2026-10-01'),
        recurrenciaRegla: { frecuencia: 'MENSUAL', intervalo: 1, diaMes: -1 },
        recurrenciaHasta: fecha('2026-12-31'),
      },
      { desde: fecha('2026-10-01'), hasta: fecha('2026-12-31') },
    );
    expect(resultado).toEqual(
      ['2026-10-31', '2026-11-30', '2026-12-31'].map(fecha),
    );
  });

  it('MENSUAL con diaMes fuera de rango del mes (31 en febrero) -> clamp al ultimo dia', () => {
    const resultado = expandirOcurrencias(
      {
        fechaInicio: fecha('2027-01-31'),
        recurrenciaRegla: { frecuencia: 'MENSUAL', intervalo: 1, diaMes: 31 },
        recurrenciaHasta: fecha('2027-03-31'),
      },
      { desde: fecha('2027-01-01'), hasta: fecha('2027-03-31') },
    );
    // Enero 31, Febrero clamp a 28 (2027 no es bisiesto), Marzo 31.
    expect(resultado).toEqual(
      ['2027-01-31', '2027-02-28', '2027-03-31'].map(fecha),
    );
  });

  it('respeta recurrenciaHasta aunque el rango consultado sea mas amplio', () => {
    const resultado = expandirOcurrencias(
      {
        fechaInicio: fecha('2026-10-01'),
        recurrenciaRegla: { frecuencia: 'DIARIA', intervalo: 1 },
        recurrenciaHasta: fecha('2026-10-03'),
      },
      { desde: fecha('2026-10-01'), hasta: fecha('2026-10-31') },
    );
    expect(resultado).toEqual(
      ['2026-10-01', '2026-10-02', '2026-10-03'].map(fecha),
    );
  });

  it('trunca a MAX_OCURRENCIAS ocurrencias y no truena', () => {
    const resultado = expandirOcurrencias(
      {
        fechaInicio: fecha('2020-01-01'),
        recurrenciaRegla: { frecuencia: 'DIARIA', intervalo: 1 },
        recurrenciaHasta: fecha('2030-01-01'),
      },
      { desde: fecha('2020-01-01'), hasta: fecha('2030-01-01') },
    );
    expect(resultado.length).toBeLessThanOrEqual(MAX_OCURRENCIAS);
  });
});
