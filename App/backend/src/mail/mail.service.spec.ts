import { MailService } from './mail.service';

/**
 * Test unitario — Fase 4, Día 13 (desbloqueado 2026-08-17).
 *
 * Sin Nest, sin red real — `fetch` se inyecta a mano vía el constructor
 * (mismo mecanismo que `MAIL_FETCH_OVERRIDE`), mismo criterio que
 * `temporary-password.spec.ts`/`platform-admin-jwt.util.spec.ts` (unidad
 * chica y aislada). Ninguno de estos tests le pega a Mailgun real.
 *
 * `correoDestino` (feature 2026-08-18) — desde que el login (`email`) pasó a
 * ser sintético para los 3 roles, el destino REAL del envío (`to:`) es un
 * campo separado (`correoPersonal` del perfil, en la práctica). Todos los
 * payloads de este archivo lo incluyen; el test principal ("llama a Mailgun
 * con el payload correcto...") verifica explícitamente que `to` usa
 * `correoDestino` y que el CUERPO del mensaje (`text`/`html`) sigue
 * mostrando `email` (el login) como texto.
 */
describe('MailService', () => {
  const ENV_ORIGINAL = { ...process.env };

  beforeEach(() => {
    process.env.MAILGUN_API_KEY = 'test-api-key';
    process.env.MAILGUN_DOMAIN = 'sandbox-test.mailgun.org';
    process.env.MAILGUN_BASE_URL = 'https://api.mailgun.net';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.MAILGUN_ENVIOS_HABILITADO = 'true';
  });

  afterEach(() => {
    process.env = { ...ENV_ORIGINAL };
  });

  function mockFetchOk(): jest.Mock {
    return jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve(''),
    });
  }

  it('llama a Mailgun con el payload correcto (from/to/subject/text/html, Basic Auth, form-urlencoded)', async () => {
    const fetchMock = mockFetchOk();
    const service = new MailService(fetchMock);

    await service.enviarCorreoBienvenida({
      nombreCompleto: 'Juan Pérez',
      email: 'arturob1@acceso.cesp.edu.mx',
      correoDestino: 'juan.perez.personal@example.com',
      temporaryPassword: 'Temporal123!',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe(
      'https://api.mailgun.net/v3/sandbox-test.mailgun.org/messages',
    );
    expect(init.method).toBe('POST');

    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const auth = Buffer.from('api:test-api-key').toString('base64');
    expect(headers.Authorization).toBe(`Basic ${auth}`);

    const body = new URLSearchParams(init.body as string);
    expect(body.get('from')).toBe(
      'SIGE CESP <no-reply.sige@sandbox-test.mailgun.org>',
    );
    // Destino REAL del envío (feature 2026-08-18) — `correoDestino`, NO el
    // login (`email`).
    expect(body.get('to')).toBe('juan.perez.personal@example.com');
    expect(body.get('subject')).toContain('Bienvenido a SIGE');
    expect(body.get('text')).toContain('Juan Pérez');
    // El CUERPO del correo sigue mostrando el login (`email`) como texto —
    // es el dato que la persona necesita para iniciar sesión, aunque el
    // correo no llegue a esa dirección.
    expect(body.get('text')).toContain('arturob1@acceso.cesp.edu.mx');
    expect(body.get('text')).toContain('Temporal123!');
    expect(body.get('text')).toContain('http://localhost:3000/login');
    expect(body.get('html')).toContain('Juan Pérez');
    expect(body.get('html')).toContain('arturob1@acceso.cesp.edu.mx');
    expect(body.get('html')).toContain('Temporal123!');
  });

  it('Mailgun responde no-2xx -> lanza (el caller decide qué hacer con eso)', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: () => Promise.resolve("'to' parameter is not a valid address"),
    });
    const service = new MailService(fetchMock);

    await expect(
      service.enviarCorreoBienvenida({
        nombreCompleto: 'Falla Sandbox',
        email: 'no.autorizado@acceso.cesp.edu.mx',
        correoDestino: 'no.autorizado.personal@example.com',
        temporaryPassword: 'Temporal123!',
      }),
    ).rejects.toThrow();
  });

  it('fetch rechaza (falla de red) -> lanza igual', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('network down'));
    const service = new MailService(fetchMock);

    await expect(
      service.enviarCorreoBienvenida({
        nombreCompleto: 'Falla Red',
        email: 'x@acceso.cesp.edu.mx',
        correoDestino: 'x.personal@example.com',
        temporaryPassword: 'Temporal123!',
      }),
    ).rejects.toThrow('network down');
  });

  it('faltan MAILGUN_API_KEY/MAILGUN_DOMAIN -> lanza sin llamar a fetch', async () => {
    delete process.env.MAILGUN_API_KEY;
    const fetchMock = mockFetchOk();
    const service = new MailService(fetchMock);

    await expect(
      service.enviarCorreoBienvenida({
        nombreCompleto: 'Sin Config',
        email: 'x@acceso.cesp.edu.mx',
        correoDestino: 'x.personal@example.com',
        temporaryPassword: 'Temporal123!',
      }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * `MAILGUN_ENVIOS_HABILITADO` — pedido explícito del usuario 2026-08-17
   * (flag para no gastar la capa gratuita de Mailgun en desarrollo/QA).
   * Con el flag apagado (o ausente, o cualquier valor que no sea
   * exactamente `"true"` — falla cerrado), `enviarCorreoBienvenida` NO debe
   * llamar a `fetch` en absoluto, y debe resolver sin lanzar.
   */
  describe('MAILGUN_ENVIOS_HABILITADO', () => {
    it('flag apagado ("false") -> no llama a fetch, resuelve como no-op exitoso', async () => {
      process.env.MAILGUN_ENVIOS_HABILITADO = 'false';
      const fetchMock = mockFetchOk();
      const service = new MailService(fetchMock);

      await expect(
        service.enviarCorreoBienvenida({
          nombreCompleto: 'No Enviar',
          email: 'x@acceso.cesp.edu.mx',
          correoDestino: 'x.personal@example.com',
          temporaryPassword: 'Temporal123!',
        }),
      ).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledTimes(0);
    });

    it('flag ausente (no seteado en el entorno) -> falla cerrado, no llama a fetch', async () => {
      delete process.env.MAILGUN_ENVIOS_HABILITADO;
      const fetchMock = mockFetchOk();
      const service = new MailService(fetchMock);

      await service.enviarCorreoBienvenida({
        nombreCompleto: 'Sin Flag',
        email: 'x@acceso.cesp.edu.mx',
        correoDestino: 'x.personal@example.com',
        temporaryPassword: 'Temporal123!',
      });

      expect(fetchMock).toHaveBeenCalledTimes(0);
    });

    it('flag con valor inválido (typo) -> falla cerrado, no llama a fetch', async () => {
      process.env.MAILGUN_ENVIOS_HABILITADO = 'TRUE';
      const fetchMock = mockFetchOk();
      const service = new MailService(fetchMock);

      await service.enviarCorreoBienvenida({
        nombreCompleto: 'Typo Flag',
        email: 'x@acceso.cesp.edu.mx',
        correoDestino: 'x.personal@example.com',
        temporaryPassword: 'Temporal123!',
      });

      expect(fetchMock).toHaveBeenCalledTimes(0);
    });

    it('flag prendido ("true") -> sí llama a fetch (comportamiento real)', async () => {
      process.env.MAILGUN_ENVIOS_HABILITADO = 'true';
      const fetchMock = mockFetchOk();
      const service = new MailService(fetchMock);

      await service.enviarCorreoBienvenida({
        nombreCompleto: 'Flag Prendido',
        email: 'x@acceso.cesp.edu.mx',
        correoDestino: 'x.personal@example.com',
        temporaryPassword: 'Temporal123!',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('enviarNotificacion', () => {
    it('con el flag apagado -> no llama fetch, resuelve', async () => {
      process.env.MAILGUN_ENVIOS_HABILITADO = 'false';
      const fetchMock = jest.fn();
      const service = new MailService(fetchMock);
      await expect(
        service.enviarNotificacion({
          correoDestino: 'x@example.com',
          asunto: 'Hola',
          cuerpoTexto: 'Cuerpo',
        }),
      ).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('con el flag prendido -> hace POST a Mailgun con to/subject/text', async () => {
      process.env.MAILGUN_ENVIOS_HABILITADO = 'true';
      process.env.MAILGUN_API_KEY = 'key-test';
      process.env.MAILGUN_DOMAIN = 'sandbox.mailgun.org';
      const fetchMock = jest.fn().mockResolvedValue({ ok: true });
      const service = new MailService(fetchMock);

      await service.enviarNotificacion({
        correoDestino: 'dest@example.com',
        asunto: 'Nuevo aviso',
        cuerpoTexto: 'Tienes un aviso nuevo',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/v3/sandbox.mailgun.org/messages');
      const body = new URLSearchParams(init.body as string);
      expect(body.get('to')).toBe('dest@example.com');
      expect(body.get('subject')).toBe('Nuevo aviso');
    });

    it('si Mailgun responde no-ok -> lanza', async () => {
      process.env.MAILGUN_ENVIOS_HABILITADO = 'true';
      process.env.MAILGUN_API_KEY = 'key-test';
      process.env.MAILGUN_DOMAIN = 'sandbox.mailgun.org';
      const fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('forbidden'),
      });
      const service = new MailService(fetchMock);
      await expect(
        service.enviarNotificacion({
          correoDestino: 'd@example.com',
          asunto: 'x',
          cuerpoTexto: 'y',
        }),
      ).rejects.toThrow('Mailgun respondió 401');
    });
  });
});
