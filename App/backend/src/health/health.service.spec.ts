import { Logger } from '@nestjs/common';
import { HealthService } from './health.service';
import { PrismaService } from '../prisma/prisma.service';

describe('HealthService', () => {
  let queryRaw: jest.Mock;
  let service: HealthService;
  let logError: jest.SpyInstance;

  beforeEach(() => {
    queryRaw = jest.fn();
    service = new HealthService({
      $queryRaw: queryRaw,
    } as unknown as PrismaService);
    logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('devuelve true cuando SELECT 1 responde', async () => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    await expect(service.dbEstaViva()).resolves.toBe(true);
  });

  it('devuelve false y loguea cuando la query falla', async () => {
    queryRaw.mockRejectedValue(new Error('conexión rechazada'));
    await expect(service.dbEstaViva()).resolves.toBe(false);
    expect(logError).toHaveBeenCalled();
  });

  it('devuelve false cuando la query excede el timeout', async () => {
    queryRaw.mockReturnValue(new Promise(() => undefined));
    await expect(service.dbEstaViva(20)).resolves.toBe(false);
    expect(logError).toHaveBeenCalled();
  });
});
