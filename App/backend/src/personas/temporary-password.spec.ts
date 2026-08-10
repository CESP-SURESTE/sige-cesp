import { generateTemporaryPassword } from './temporary-password';

/**
 * Test unitario — Fase 4, Día 11.
 *
 * Unidad de trabajo chica y aislada (sin Nest, sin Prisma, sin Supabase) para
 * probar el generador de contraseña temporal antes de integrarlo al endpoint
 * completo — ver comentario de `temporary-password.ts`.
 */
describe('generateTemporaryPassword', () => {
  it('genera 16 caracteres por default', () => {
    expect(generateTemporaryPassword()).toHaveLength(16);
  });

  it('respeta una longitud custom >= 8', () => {
    expect(generateTemporaryPassword(24)).toHaveLength(24);
  });

  it('rechaza longitudes menores a 8', () => {
    expect(() => generateTemporaryPassword(4)).toThrow();
  });

  it('incluye al menos una mayúscula, una minúscula, un dígito y un símbolo', () => {
    const password = generateTemporaryPassword();

    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).toMatch(/[!@#$%^&*\-_=+?]/);
  });

  it('no repite el mismo valor en llamadas sucesivas (CSPRNG, no Math.random)', () => {
    const valores = new Set(
      Array.from({ length: 20 }, () => generateTemporaryPassword()),
    );

    expect(valores.size).toBe(20);
  });

  it('no usa caracteres visualmente ambiguos (0/O, 1/l/I)', () => {
    const password = generateTemporaryPassword(200);

    expect(password).not.toMatch(/[0O1lI]/);
  });
});
