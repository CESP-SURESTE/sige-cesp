import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  const crear = (viva: boolean) =>
    new HealthController({
      dbEstaViva: jest.fn().mockResolvedValue(viva),
    } as unknown as HealthService);

  it('responde { status: "ok" } si la DB está viva', async () => {
    await expect(crear(true).check()).resolves.toEqual({ status: 'ok' });
  });

  it('lanza 503 con { status: "error" } si la DB falla', async () => {
    const err = await crear(false)
      .check()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    const e = err as ServiceUnavailableException;
    expect(e.getStatus()).toBe(503);
    expect(e.getResponse()).toEqual({ status: 'error' });
  });
});
