/**
 * Bootstrap del bucket de Storage para mallas curriculares — Fase 7, Día
 * 23. Permanente (a diferencia de los scripts `-tmp.ts` de mantenimiento
 * de datos) — idempotente y repetible, mismo criterio que `seed.ts`.
 *
 * Uso: `npx ts-node prisma/crear-bucket-malla.ts`
 */
import { loadEnv } from '../src/load-env';

loadEnv();

const NOMBRE_BUCKET = 'mallas-curriculares';

async function main() {
  const { createAdminClient } = await import('@supabase/server/core');
  const client = createAdminClient();

  const { data: existente } = await client.storage.getBucket(NOMBRE_BUCKET);
  if (existente) {
    console.log(`Bucket "${NOMBRE_BUCKET}" ya existe, nada que hacer.`);
    return;
  }

  const { error } = await client.storage.createBucket(NOMBRE_BUCKET, {
    public: false,
    fileSizeLimit: '5MB',
    allowedMimeTypes: ['application/pdf'],
  });
  if (error) {
    throw new Error(
      `Error creando el bucket "${NOMBRE_BUCKET}": ${error.message}`,
    );
  }
  console.log(`Bucket "${NOMBRE_BUCKET}" creado (privado, 5MB, solo PDF).`);
}

main().catch((e: unknown) => {
  console.error('Error en crear-bucket-malla:', e);
  process.exit(1);
});
