/**
 * Bootstrap del bucket de Storage para capturas de reportes de bugs —
 * feature "Bot de soporte" (2026-09-24). Permanente, idempotente y
 * repetible (mismo criterio que `crear-bucket-fotos-perfil.ts`).
 *
 * Uso: `npx ts-node prisma/crear-bucket-reportes-bug.ts`
 */
import { loadEnv } from '../src/load-env';

loadEnv();

const NOMBRE_BUCKET = 'reportes-bug';

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
    fileSizeLimit: '3MB',
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  });
  if (error) {
    throw new Error(
      `Error creando el bucket "${NOMBRE_BUCKET}": ${error.message}`,
    );
  }
  console.log(
    `Bucket "${NOMBRE_BUCKET}" creado (privado, 3MB, jpeg/png/webp).`,
  );
}

main().catch((e: unknown) => {
  console.error('Error en crear-bucket-reportes-bug:', e);
  process.exit(1);
});
