import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Carga `.env` en `process.env` con `process.loadEnvFile` (nativo de Node
 * >=20.6 — sin agregar `dotenv` como dependencia propia; ya viene transitivo
 * vía Prisma CLI, pero eso no ayuda al proceso de la app en runtime).
 *
 * NestJS no carga `.env` solo — a diferencia de Prisma CLI. Lo necesitan
 * tanto `main.ts` (arranque real) como los tests e2e (que instancian
 * `AppModule` directo, sin pasar por `main.ts`) — de ahí que viva en su
 * propio módulo en vez de estar solo en `main.ts`.
 *
 * Envuelto en `existsSync` + try/catch: en producción las env vars ya vienen
 * inyectadas por la plataforma de hosting, sin archivo `.env` — no debe
 * romper el arranque si el archivo no existe.
 */
export function loadEnv(): void {
  const envPath = join(process.cwd(), '.env');
  if (existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch {
      // Ya cargadas (ej. un test runner que las setea antes) o archivo no
      // parseable — seguimos con lo que ya haya en process.env.
    }
  }
}
