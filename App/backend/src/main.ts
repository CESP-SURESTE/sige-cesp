import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadEnv } from './load-env';
import { configureApp } from './setup-app';

loadEnv();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  // CORS — Fase 2, Día 10. Solo en `main.ts`, NO en `configureApp`
  // (`setup-app.ts`): a diferencia de Helmet, CORS depende de una env var
  // (`FRONTEND_URL`) y solo importa para requests reales de navegador (el
  // enforcement lo hace el browser leyendo `Access-Control-Allow-Origin`,
  // no el servidor) — los e2e pegan directo con supertest, sin navegador
  // de por medio, así que no hay ningún caso de test que se beneficie de
  // tenerlo acá, y sí un riesgo real de introducir dependencia de env vars
  // no seteadas en el entorno de test. Origen del frontend: `localhost:3000`
  // por convención desde Día 1 (`docs/roadmap.md`), con override opcional
  // por `FRONTEND_URL` para otros entornos (staging/prod). No se habilita
  // `credentials: true` — el contrato de API usa `Authorization: Bearer
  // <jwt>` (regla del `CLAUDE.md` raíz), no cookies cross-site.
  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap().catch((err: unknown) => {
  console.error('Error fatal al arrancar Nest:', err);
  process.exit(1);
});
