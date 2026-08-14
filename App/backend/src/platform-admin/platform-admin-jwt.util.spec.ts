import {
  firmarPlatformAdminToken,
  verificarPlatformAdminToken,
} from './platform-admin-jwt.util';

describe('platform-admin-jwt.util', () => {
  beforeAll(() => {
    process.env.PLATFORM_ADMIN_JWT_SECRET = 'secreto-de-prueba-solo-para-tests-1234567890';
  });

  it('firma y verifica un token válido, recupera los claims', async () => {
    const token = await firmarPlatformAdminToken({
      sub: '11111111-1111-1111-1111-111111111111',
      email: 'plataforma.prueba@nexo-sd.mx',
    });

    const claims = await verificarPlatformAdminToken(token);

    expect(claims.sub).toBe('11111111-1111-1111-1111-111111111111');
    expect(claims.email).toBe('plataforma.prueba@nexo-sd.mx');
  });

  it('rechaza un token con firma inválida', async () => {
    const token = await firmarPlatformAdminToken({
      sub: '11111111-1111-1111-1111-111111111111',
      email: 'x@x.mx',
    });
    const tokenAlterado = token.slice(0, -2) + 'xx';

    await expect(verificarPlatformAdminToken(tokenAlterado)).rejects.toThrow();
  });
});
