import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadEnv } from './load-env';

loadEnv();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap().catch((err: unknown) => {
  console.error('Error fatal al arrancar Nest:', err);
  process.exit(1);
});
