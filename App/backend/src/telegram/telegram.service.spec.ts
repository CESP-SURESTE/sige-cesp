import { TelegramService } from './telegram.service';

/**
 * Test unitario — mismo criterio que `mail.service.spec.ts`: `fetch` se
 * inyecta a mano vía el constructor (mismo mecanismo que
 * `TELEGRAM_FETCH_OVERRIDE`), sin Nest, sin red real.
 */
describe('TelegramService', () => {
  const ENV_ORIGINAL = { ...process.env };

  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
    process.env.TELEGRAM_CHAT_ID = '123456789';
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

  it('sin capturaUrl, llama a sendMessage con chat_id y text', async () => {
    const fetchMock = mockFetchOk();
    const service = new TelegramService(fetchMock);

    await service.enviarReporteBug({
      descripcion: 'El botón de guardar no responde',
      nombreReportante: 'Ana Canul',
      sedeNombre: 'CESP Mérida',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/bottest-bot-token/sendMessage');
    const body = JSON.parse(init.body as string) as {
      chat_id: string;
      text: string;
    };
    expect(body.chat_id).toBe('123456789');
    expect(body.text).toContain('El botón de guardar no responde');
    expect(body.text).toContain('CESP Mérida');
    expect(body.text).toContain('Ana Canul');
  });

  it('con capturaUrl, llama a sendPhoto con photo y caption truncado a 1024', async () => {
    const fetchMock = mockFetchOk();
    const service = new TelegramService(fetchMock);
    const descripcionLarga = 'x'.repeat(2000);

    await service.enviarReporteBug({
      descripcion: descripcionLarga,
      nombreReportante: 'Jorge Ek',
      sedeNombre: 'CESP Valladolid',
      capturaUrl: 'https://storage.example.com/signed/captura.png',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/bottest-bot-token/sendPhoto');
    const body = JSON.parse(init.body as string) as {
      chat_id: string;
      photo: string;
      caption: string;
    };
    expect(body.photo).toBe('https://storage.example.com/signed/captura.png');
    expect(body.caption.length).toBeLessThanOrEqual(1024);
    expect(body.caption.endsWith('...')).toBe(true);
  });

  it('lanza si faltan TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const service = new TelegramService(mockFetchOk());

    await expect(
      service.enviarReporteBug({
        descripcion: 'x',
        nombreReportante: 'x',
        sedeNombre: 'x',
      }),
    ).rejects.toThrow('Falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID');
  });

  it('lanza si Telegram responde un status no-2xx', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: () => Promise.resolve('chat not found'),
    });
    const service = new TelegramService(fetchMock);

    await expect(
      service.enviarReporteBug({
        descripcion: 'x',
        nombreReportante: 'x',
        sedeNombre: 'x',
      }),
    ).rejects.toThrow('Telegram respondió 400');
  });
});
