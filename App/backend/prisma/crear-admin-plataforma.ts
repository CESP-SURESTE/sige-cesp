/**
 * Crea (o actualiza) la cuenta real de `AdminPlataforma` contra el Supabase
 * al que apunte `.env` en el momento de correrlo — pensado para bootstrapear
 * el primer admin de plataforma de un ambiente nuevo (ej. producción,
 * 2026-08-22), a diferencia de `seed-admin-plataforma.ts`, que siempre crea
 * la cuenta de PRUEBA fija (`plataforma.prueba@nexo-sd.mx`) para dev/demos.
 *
 * Mismo criterio que `seed-admin-plataforma.ts`: `AdminPlataforma` es una
 * identidad separada de `Usuario`/Supabase Auth (Fase 6, Día 20 — password
 * `scrypt` propio). Es seguro volver a correr: usa `upsert` por email, así
 * que también sirve para rotar el password de una cuenta ya creada.
 *
 * Uso:
 *   ADMIN_PLATAFORMA_EMAIL='tu@correo.com' \
 *   ADMIN_PLATAFORMA_NOMBRE='Tu Nombre' \
 *   ADMIN_PLATAFORMA_PASSWORD='...' \
 *   npx ts-node prisma/crear-admin-plataforma.ts
 */
import { PrismaClient } from '@prisma/client';
import { loadEnv } from '../src/load-env';
import { hashPassword } from '../src/platform-admin/password.util';

// Mismo motivo que en `reset-db.ts`/`seed.ts` — `ts-node` directo no carga
// `.env` solo.
loadEnv();

const prisma = new PrismaClient();

const EMAIL = process.env.ADMIN_PLATAFORMA_EMAIL;
const NOMBRE = process.env.ADMIN_PLATAFORMA_NOMBRE;
const PASSWORD = process.env.ADMIN_PLATAFORMA_PASSWORD;

if (!EMAIL || !NOMBRE || !PASSWORD) {
  console.error(
    'Faltan variables. Uso: ADMIN_PLATAFORMA_EMAIL=... ADMIN_PLATAFORMA_NOMBRE=... ' +
      "ADMIN_PLATAFORMA_PASSWORD=... npx ts-node prisma/crear-admin-plataforma.ts",
  );
  process.exit(1);
}

async function main() {
  const passwordHash = await hashPassword(PASSWORD as string);

  await prisma.adminPlataforma.upsert({
    where: { email: EMAIL as string },
    update: { passwordHash, nombre: NOMBRE as string },
    create: { email: EMAIL as string, passwordHash, nombre: NOMBRE as string },
  });

  console.log(`AdminPlataforma creado/actualizado: ${EMAIL}`);
}

main()
  .catch((e) => {
    console.error('Error creando el AdminPlataforma:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
