/**
 * Verificación de claims del Auth Hook — Fase 2, Día 8 (`rol`) + Fase 4,
 * Día 12 (`primer_ingreso`).
 *
 * Extiende la verificación de `custom_access_token_hook` (Fase 1, Día 5,
 * ver `verify-rls.ts`) para confirmar que, tras las migraciones
 * `20260807191727_auth_hook_rol_claim` y
 * `20260810165756_auth_hook_primer_ingreso_claim`, la función también
 * embebe los claims `rol` (Usuario.rol) y `primer_ingreso`
 * (Usuario.primerIngreso) además del `sede_id` ya existente.
 *
 * Invoca la función SQL directamente (`SELECT
 * public.custom_access_token_hook(...)`) contra usuarios reales sembrados
 * por `prisma/seed.ts` — no requiere que el hook esté activado en el
 * Dashboard de Supabase (eso solo afecta si Supabase Auth invoca la función
 * automáticamente al emitir un JWT real; la función en sí es invocable por
 * SQL sin importar ese estado).
 *
 * Día 12 (encargo): "extiende ese mismo script o crea uno temporal de un
 * solo uso" — se optó por EXTENDER este script (no crear uno nuevo) porque
 * ya cubre exactamente el mismo mecanismo de verificación (invocar la
 * función SQL contra usuarios reales) para el `sede_id`/`rol` existentes;
 * agregar `primer_ingreso` a la misma consulta evita duplicar el query y
 * deja un solo script permanente que valida los 3 claims del hook a la vez.
 *
 * CORRECCIÓN (QA Día 12): el comentario original asumía que los usuarios
 * del seed no tenían fila en `usuarios` y por lo tanto `primer_ingreso`
 * saldría `null` para todos. Es falso — sí tienen fila (`seed.ts` los
 * inserta), así que su `primer_ingreso` real es `true` (default del
 * schema). El caso `null` (usuario SIN fila en `usuarios`) se prueba aparte
 * abajo, con un `user_id` sintético que no existe en la tabla — mismo
 * criterio de null-safety que ya usan `rol`/`sede_id`. También verifica la
 * cuenta de prueba real creada en la verificación de Día 11
 * (`7fd218b5-541f-4936-a4a4-9a89e7f9a3da`, si sigue en la DB — su
 * `primer_ingreso` debería seguir en `true`, no se tocó desde entonces).
 *
 * Uso: `pnpm exec ts-node prisma/verify-auth-hook-rol.ts`
 *
 * --------------------------------------------------------------------------
 * EQUIVALENTE MANUAL — SQL Editor de Supabase:
 * --------------------------------------------------------------------------
 *
 *   SELECT id, email, rol, primer_ingreso FROM usuarios ORDER BY rol;
 *
 *   SELECT public.custom_access_token_hook(
 *     jsonb_build_object('user_id', '<id-real-del-seed>', 'claims', '{}'::jsonb)
 *   );
 *   -- debe devolver { "claims": { "rol": "<ROL>", "sede_id": "<SEDE_ID>",
 *   --   "primer_ingreso": <true|false> } }
 *
 *   -- Caso null (user_id inexistente):
 *   SELECT public.custom_access_token_hook(
 *     jsonb_build_object('user_id', gen_random_uuid()::text, 'claims', '{}'::jsonb)
 *   );
 *   -- debe devolver { "claims": { "rol": null, "sede_id": null,
 *   --   "primer_ingreso": null } }
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ID_CUENTA_PRUEBA_DIA_11 = '7fd218b5-541f-4936-a4a4-9a89e7f9a3da';

interface HookResultRow {
  result: unknown;
}

async function main() {
  const usuarios: {
    id: string;
    email: string;
    rol: string;
    sedeId: string;
    primerIngreso: boolean;
  }[] = await prisma.$queryRawUnsafe(
    `SELECT id, email, rol::text AS "rol", sede_id AS "sedeId", primer_ingreso AS "primerIngreso" FROM usuarios ORDER BY rol;`,
  );
  console.log('Usuarios encontrados en la DB real (sembrados por seed.ts):');
  console.log(usuarios);

  for (const u of usuarios) {
    const result = await prisma.$queryRawUnsafe<HookResultRow[]>(
      `SELECT public.custom_access_token_hook(
         jsonb_build_object('user_id', $1::text, 'claims', '{}'::jsonb)
       ) AS result;`,
      u.id,
    );
    console.log(
      `\n--- Usuario ${u.email} (rol=${u.rol}, sedeId=${u.sedeId}, primerIngreso=${u.primerIngreso}, id=${u.id}) ---`,
    );
    console.log(JSON.stringify(result[0].result, null, 2));
  }

  // Cuenta de prueba real creada en la verificación de Día 11 (Fase 4) — si
  // sigue en la DB, es el único caso con `primer_ingreso: true` real (el
  // seed no crea usuarios reales de Supabase Auth, ver comentario en
  // `prisma/seed.ts`).
  console.log(
    `\n--- Verificando cuenta de prueba de Día 11 (id=${ID_CUENTA_PRUEBA_DIA_11}) ---`,
  );
  const cuentaPrueba = await prisma.$queryRawUnsafe<HookResultRow[]>(
    `SELECT public.custom_access_token_hook(
       jsonb_build_object('user_id', $1::text, 'claims', '{}'::jsonb)
     ) AS result;`,
    ID_CUENTA_PRUEBA_DIA_11,
  );
  console.log(JSON.stringify(cuentaPrueba[0].result, null, 2));

  // Caso null: user_id que no existe en `usuarios` (generado con
  // gen_random_uuid(), no hay riesgo real de colisión con una fila real).
  // Los 3 claims (`rol`, `sede_id`, `primer_ingreso`) deben salir en `null`
  // — mismo criterio de null-safety documentado arriba. Este es el caso que
  // ESTADO.md (Día 12) afirmaba haber probado pero que faltaba persistido
  // en este script (hallazgo de QA Día 12, corregido aquí).
  console.log(`\n--- Verificando user_id inexistente (caso null) ---`);
  const casoNull = await prisma.$queryRawUnsafe<HookResultRow[]>(
    `SELECT public.custom_access_token_hook(
       jsonb_build_object('user_id', gen_random_uuid()::text, 'claims', '{}'::jsonb)
     ) AS result;`,
  );
  console.log(JSON.stringify(casoNull[0].result, null, 2));
}

main()
  .catch((e) => console.error('ERROR:', e))
  .finally(() => prisma.$disconnect());
