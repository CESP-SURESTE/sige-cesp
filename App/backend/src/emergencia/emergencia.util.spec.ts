import {
  calcularEdad,
  compararPorApellidos,
  hayCambiosRealesTelefono,
  nombreCompleto,
} from './emergencia.util';

describe('hayCambiosRealesTelefono', () => {
  const existente = { etiqueta: 'Cruz Roja', telefono: '911' };

  it('PATCH vacío → false', () => {
    expect(hayCambiosRealesTelefono({}, existente)).toBe(false);
  });
  it('mismo valor → false', () => {
    expect(hayCambiosRealesTelefono({ telefono: '911' }, existente)).toBe(false);
  });
  it('valor distinto → true', () => {
    expect(hayCambiosRealesTelefono({ telefono: '065' }, existente)).toBe(true);
  });
});

describe('nombreCompleto', () => {
  it('sin apellido materno no deja doble espacio', () => {
    expect(
      nombreCompleto({
        nombres: 'Ana',
        apellidoPaterno: 'Canul',
        apellidoMaterno: null,
      }),
    ).toBe('Ana Canul');
  });

  it('con los 3 componentes los une con un solo espacio', () => {
    expect(
      nombreCompleto({
        nombres: 'Ana María',
        apellidoPaterno: 'Canul',
        apellidoMaterno: 'Poot',
      }),
    ).toBe('Ana María Canul Poot');
  });

  it('ignora componentes en blanco', () => {
    expect(
      nombreCompleto({
        nombres: 'Ana',
        apellidoPaterno: '   ',
        apellidoMaterno: '',
      }),
    ).toBe('Ana');
  });
});

describe('compararPorApellidos', () => {
  it('ordena por apellido paterno', () => {
    const lista = [
      { nombres: 'Z', apellidoPaterno: 'Bravo', apellidoMaterno: null },
      { nombres: 'A', apellidoPaterno: 'Alfa', apellidoMaterno: null },
    ];
    lista.sort(compararPorApellidos);
    expect(lista[0].apellidoPaterno).toBe('Alfa');
  });

  it('desempata por apellido materno y luego por nombres', () => {
    const lista = [
      { nombres: 'Beto', apellidoPaterno: 'Cámara', apellidoMaterno: 'Zavala' },
      { nombres: 'Ana', apellidoPaterno: 'Cámara', apellidoMaterno: 'Ávila' },
      { nombres: 'Zoe', apellidoPaterno: 'Cámara', apellidoMaterno: 'Ávila' },
    ];
    lista.sort(compararPorApellidos);
    expect(lista.map((p) => p.nombres)).toEqual(['Ana', 'Zoe', 'Beto']);
  });

  it('trata apellido materno null como cadena vacía (va primero)', () => {
    const lista = [
      { nombres: 'A', apellidoPaterno: 'Dzul', apellidoMaterno: 'Balam' },
      { nombres: 'B', apellidoPaterno: 'Dzul', apellidoMaterno: null },
    ];
    lista.sort(compararPorApellidos);
    expect(lista[0].nombres).toBe('B');
  });
});

describe('calcularEdad', () => {
  it('cumpleaños ya pasado este año', () => {
    const nac = new Date(Date.UTC(2000, 0, 1));
    expect(calcularEdad(nac)).toBeGreaterThanOrEqual(25);
  });

  it('recién nacido hoy → 0 años', () => {
    const hoy = new Date();
    const nac = new Date(
      Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate()),
    );
    expect(calcularEdad(nac)).toBe(0);
  });

  it('resta un año si el cumpleaños de este año aún no llega', () => {
    const hoy = new Date();
    const nac = new Date(
      Date.UTC(hoy.getUTCFullYear() - 20, hoy.getUTCMonth() + 1, hoy.getUTCDate()),
    );
    // si el mes +1 se pasa de diciembre el rollover lo lleva al año siguiente,
    // lo que igualmente deja el cumpleaños "por venir" respecto de hoy.
    expect(calcularEdad(nac)).toBe(19);
  });
});
