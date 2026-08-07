/**
 * Verificación del claim `rol` en el Auth Hook — Fase 2, Día 8.
 *
 * Extiende la verificación de `custom_access_token_hook` (Fase 1, Día 5,
 * ver `verify-rls.ts`) para confirmar que, tras la migración
 * `20260807191727_auth_hook_rol_claim`, la función también embebe el claim
 * `rol` (Usuario.rol / columna `rol` en `usuarios`) además del `sede_id`
 * ya existente.
 *
 * Invoca la función SQL directamente (`SELECT
 * public.custom_access_token_hook(...)`) contra usuarios reales sembrados
 * por `prisma/seed.ts` — no requiere que el hook esté activado en el
 * Dashboard de Supabase (eso solo afecta si Supabase Auth invoca la función
 * automáticamente al emitir un JWT real; la función en sí es invocable por
 * SQL sin importar ese estado).
 *
 * Uso: `pnpm exec ts-node prisma/verify-auth-hook-rol.ts`
 *
 * --------------------------------------------------------------------------
 * EQUIVALENTE MANUAL — SQL Editor de Supabase:
 * --------------------------------------------------------------------------
 *
 *   SELECT id, email, rol FROM usuarios ORDER BY rol;
 *
 *   SELECT public.custom_access_token_hook(
 *     jsonb_build_object('user_id', '<id-real-del-seed>', 'claims', '{}'::jsonb)
 *   );
 *   -- debe devolver { "claims": { "rol": "<ROL>", "sede_id": "<SEDE_ID>" } }
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const usuarios: { id: string; email: string; rol: string; sedeId: string }[] =
    await prisma.$queryRawUnsafe(
      `SELECT id, email, rol::text AS "rol", sede_id AS "sedeId" FROM usuarios ORDER BY rol;`,
    );
  console.log('Usuarios encontrados en la DB real (sembrados por seed.ts):');
  console.log(usuarios);

  for (const u of usuarios) {
    const result: any[] = await prisma.$queryRawUnsafe(
      `SELECT public.custom_access_token_hook(
         jsonb_build_object('user_id', $1::text, 'claims', '{}'::jsonb)
       ) AS result;`,
      u.id,
    );
    console.log(`\n--- Usuario ${u.email} (rol=${u.rol}, sedeId=${u.sedeId}, id=${u.id}) ---`);
    console.log(JSON.stringify(result[0].result, null, 2));
  }
}

main()
  .catch((e) => console.error('ERROR:', e))
  .finally(() => prisma.$disconnect());
