/**
 * Bootstrap del bucket de Storage para fotos de perfil — feature "Foto de
 * perfil" (2026-09-17). Permanente, idempotente y repetible (mismo criterio
 * que `crear-bucket-malla.ts`/`seed.ts`).
 *
 * Uso: `npx ts-node prisma/crear-bucket-fotos-perfil.ts`
 */
import { loadEnv } from '../src/load-env';

loadEnv();

const NOMBRE_BUCKET = 'fotos-perfil';

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
  console.error('Error en crear-bucket-fotos-perfil:', e);
  process.exit(1);
});
