import { hashPassword, verifyPassword } from './password.util';

describe('password.util', () => {
  it('verifyPassword regresa true con la password correcta', async () => {
    const hash = await hashPassword('una-password-de-prueba-123');
    await expect(
      verifyPassword('una-password-de-prueba-123', hash),
    ).resolves.toBe(true);
  });

  it('verifyPassword regresa false con la password incorrecta', async () => {
    const hash = await hashPassword('una-password-de-prueba-123');
    await expect(verifyPassword('password-equivocada', hash)).resolves.toBe(
      false,
    );
  });

  it('2 hashes de la misma password son distintos (salt aleatorio)', async () => {
    const hash1 = await hashPassword('misma-password');
    const hash2 = await hashPassword('misma-password');
    expect(hash1).not.toBe(hash2);
  });
});
