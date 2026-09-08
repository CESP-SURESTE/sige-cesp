import { hayCambiosRealesTelefono } from './emergencia.util';

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
