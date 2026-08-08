import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { validationExceptionFactory } from './common/pipes/validation-exception-factory';

/**
 * Configuración global de la app — compartida entre `main.ts` (producción)
 * y los tests e2e (`test/*.e2e-spec.ts`, que arman la app con
 * `Test.createTestingModule(...).createNestApplication()` y NO pasan por
 * `bootstrap()`). Centralizar acá evita que la app real y la de los tests
 * diverjan en configuración global.
 *
 * `ValidationPipe` global — Fase 2, Día 9. `whitelist` descarta props no
 * declaradas en el DTO; `forbidNonWhitelisted` responde 400 en vez de
 * descartarlas en silencio (más explícito para el frontend que algo no
 * esperado llegó en el body); `transform` instancia el DTO real (tipos
 * primitivos coercionados). `exceptionFactory` mapea al contrato
 * `{ error, code }` del proyecto (`VALIDATION_ERROR`) — sin esto, Nest
 * devuelve por default `{ statusCode, message: string[], error }`.
 *
 * `helmet()` — Fase 2, Día 10. Setea headers de seguridad HTTP estándar
 * (`X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`,
 * CSP básica, etc.), sin dependencias externas ni configuración por entorno
 * (a diferencia de CORS, ver `main.ts`). Se agrega acá, no solo en
 * `main.ts`, a propósito: aunque hoy ningún e2e verifica headers, dejarlo
 * fuera de `configureApp` habría creado el mismo tipo de divergencia
 * prod/test que este archivo existe para evitar (mismo criterio que
 * `ValidationPipe`) — si en el futuro se agrega un test que audite headers
 * de seguridad, ya corre contra la config real sin tocar este archivo. Es
 * middleware puro (no depende de env vars ni de estado externo), así que
 * no hay riesgo de comportamiento no determinista en los tests por
 * incluirlo acá.
 */
export function configureApp(app: INestApplication): void {
  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );
}
