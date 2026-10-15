import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Tiempo máximo que se espera al `SELECT 1` antes de declarar la DB caída. */
export const HEALTH_DB_TIMEOUT_MS = 3000;

/**
 * Chequeo de salud de la DB para `GET /health`. Solo ejecuta `SELECT 1`
 * (sin tocar tablas de negocio) — suficiente para mantener despierto el
 * proyecto de Supabase y detectar caídas. Nunca lanza: devuelve `true`/`false`
 * y loguea el error real solo en el servidor (regla 12 del `CLAUDE.md`).
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async dbEstaViva(timeoutMs: number = HEALTH_DB_TIMEOUT_MS): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`Health check: SELECT 1 excedió ${timeoutMs}ms`)),
          timeoutMs,
        );
      });
      await Promise.race([this.prisma.$queryRaw`SELECT 1`, timeout]);
      return true;
    } catch (error) {
      this.logger.error('Health check de DB falló', error);
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
