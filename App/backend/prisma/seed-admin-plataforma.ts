/**
 * Recrea la cuenta de prueba de `AdminPlataforma` (`plataforma.prueba@nexo-sd.mx`)
 * después de un reset total de la DB (`reset-db.ts`) — 2026-08-16, a pedido
 * explícito del usuario.
 *
 * Separado de `prisma/seed.ts` a propósito: `AdminPlataforma` es una
 * identidad completamente aparte de `Usuario`/Supabase Auth (Fase 6, Día
 * 20 — password `scrypt` propio, sin relación con la sede ni con el resto
 * del seed de personas). Mezclarlo en el mismo archivo/loop no aporta nada
 * y complica el idempotente-por-email que ya tiene `seed.ts`.
 *
 * Es seguro volver a correr: usa `upsert` por email.
 *
 * Uso: `SEED_DEMO_PASSWORD='...' npx ts-node prisma/seed-admin-plataforma.ts`
 */
import { PrismaClient } from '@prisma/client';
import { loadEnv } from '../src/load-env';
import { hashPassword } from '../src/platform-admin/password.util';

// Mismo motivo que en `reset-db.ts`/`seed.ts` — `ts-node` directo no carga
// `.env` solo.
loadEnv();

const prisma = new PrismaClient();

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD;
if (!DEMO_PASSWORD) {
  console.error(
    'Falta SEED_DEMO_PASSWORD en el entorno. Uso: ' +
      "SEED_DEMO_PASSWORD='...' npx ts-node prisma/seed-admin-plataforma.ts",
  );
  process.exit(1);
}

async function main() {
  const email = 'plataforma.prueba@nexo-sd.mx';
  const passwordHash = await hashPassword(DEMO_PASSWORD as string);

  await prisma.adminPlataforma.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, passwordHash, nombre: 'Plataforma Prueba' },
  });

  console.log(`AdminPlataforma recreado: ${email}`);
}

main()
  .catch((e) => {
    console.error('Error corriendo el seed de AdminPlataforma:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
