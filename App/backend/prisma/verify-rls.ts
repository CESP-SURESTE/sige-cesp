/**
 * Verificación de aislamiento por sede (RLS) — Fase 1, Día 5.
 *
 * Corre pruebas reales contra la base de datos de Supabase, "impersonando"
 * al rol `authenticated` (el que de verdad queda sujeto a RLS — `postgres`,
 * el rol que usa Prisma/el backend, tiene BYPASSRLS y por eso NUNCA se ve
 * afectado por ninguna policy).
 *
 * Técnica: `SET LOCAL ROLE authenticated` + `set_config('request.jwt.claims',
 * ..., true)` dentro de una transacción — exactamente lo que hace
 * PostgREST/Supabase en producción a partir del JWT de cada request, así
 * que es una prueba fiel del comportamiento real, no una simulación aparte.
 *
 * Uso: `pnpm exec ts-node prisma/verify-rls.ts`
 *
 * --------------------------------------------------------------------------
 * EQUIVALENTE MANUAL — para correr esto mismo desde el SQL Editor de
 * Supabase (Dashboard → SQL Editor), sin pasar por este script:
 * --------------------------------------------------------------------------
 *
 *   -- 1) Ver los IDs de las 2 sedes sembradas:
 *   SELECT id, nombre FROM sedes ORDER BY nombre;
 *
 *   -- 2) "Ser" un usuario de sede Mérida y listar carreras:
 *   BEGIN;
 *   SET LOCAL ROLE authenticated;
 *   SELECT set_config('request.jwt.claims', '{"sede_id":"<ID_MERIDA>"}', true);
 *   SELECT nombre, sede_id FROM carreras;         -- solo las 2 de Mérida
 *   SELECT nombre FROM carreras WHERE sede_id = '<ID_VALLADOLID>'; -- 0 filas
 *   ROLLBACK;
 *
 *   -- 3) Mismo ejercicio con el ID de Valladolid — resultado espejo.
 *
 *   -- 4) Intento de escritura cruzada (debe fallar con 42501):
 *   BEGIN;
 *   SET LOCAL ROLE authenticated;
 *   SELECT set_config('request.jwt.claims', '{"sede_id":"<ID_MERIDA>"}', true);
 *   INSERT INTO salones (id, sede_id, nombre, capacidad, created_at, updated_at)
 *     VALUES (gen_random_uuid()::text, '<ID_VALLADOLID>', 'Aula intrusa', 10, now(), now());
 *   -- ERROR: new row violates row-level security policy for table "salones"
 *   ROLLBACK;
 *
 * Resultado real de la última corrida de este script (2026-08-06, contra la
 * base de datos real del proyecto) — ver
 * documentacion_de_agentes/bitacoras/backend/historial/2026-08-06-fase1-multisede-reporte.md
 * para el log completo.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function asRole(sedeId: string | null, fn: (tx: any) => Promise<void>) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE authenticated;`);
    const claims = JSON.stringify({
      sub: '00000000-0000-0000-0000-000000000000',
      role: 'authenticated',
      sede_id: sedeId,
    });
    await tx.$executeRawUnsafe(
      `SELECT set_config('request.jwt.claims', $1, true);`,
      claims,
    );
    await fn(tx);
  });
}

async function main() {
  const sedes: { id: string; nombre: string }[] = await prisma.$queryRawUnsafe(
    `SELECT id, nombre FROM sedes ORDER BY nombre;`,
  );
  const merida = sedes.find((s) => s.nombre === 'CESP Mérida')!;
  const valladolid = sedes.find((s) => s.nombre === 'CESP Valladolid')!;
  console.log('Sede Mérida:', merida.id);
  console.log('Sede Valladolid:', valladolid.id);

  console.log('\n=== PASO 0: como rol postgres (el que usa Prisma/backend) ===');
  const totalCarrerasPostgres: any[] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS total FROM carreras;`,
  );
  console.log('Total de carreras visibles (bypassa RLS):', totalCarrerasPostgres[0].total);

  console.log('\n=== PASO 1: impersonando un usuario de sede MÉRIDA (SET LOCAL ROLE authenticated) ===');
  await asRole(merida.id, async (tx) => {
    const propias: any[] = await tx.$queryRawUnsafe(
      `SELECT nombre, sede_id FROM carreras ORDER BY nombre;`,
    );
    console.log(`Carreras visibles para el usuario de Mérida: ${propias.length}`);
    console.log(propias.map((c: any) => c.nombre));

    const cruzado: any[] = await tx.$queryRawUnsafe(
      `SELECT nombre FROM carreras WHERE sede_id = $1;`,
      valladolid.id,
    );
    console.log(
      `Intento de leer carreras de Valladolid desde sesión de Mérida -> filas devueltas: ${cruzado.length} (debe ser 0)`,
    );

    const usuarios: any[] = await tx.$queryRawUnsafe(`SELECT email FROM usuarios ORDER BY email;`);
    console.log(`Usuarios visibles para el usuario de Mérida: ${usuarios.length}`);
    console.log(usuarios.map((u: any) => u.email));
  });

  console.log('\n=== PASO 2: impersonando un usuario de sede VALLADOLID ===');
  await asRole(valladolid.id, async (tx) => {
    const propias: any[] = await tx.$queryRawUnsafe(
      `SELECT nombre, sede_id FROM carreras ORDER BY nombre;`,
    );
    console.log(`Carreras visibles para el usuario de Valladolid: ${propias.length}`);
    console.log(propias.map((c: any) => c.nombre));

    const cruzado: any[] = await tx.$queryRawUnsafe(
      `SELECT nombre FROM carreras WHERE sede_id = $1;`,
      merida.id,
    );
    console.log(
      `Intento de leer carreras de Mérida desde sesión de Valladolid -> filas devueltas: ${cruzado.length} (debe ser 0)`,
    );
  });

  console.log('\n=== PASO 3: intento de INSERT cruzado (sede_id que no coincide con el JWT) ===');
  try {
    await asRole(merida.id, async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO salones (id, sede_id, nombre, capacidad, created_at, updated_at)
         VALUES (gen_random_uuid()::text, $1, 'Aula intrusa', 10, now(), now());`,
        valladolid.id,
      );
    });
    console.log('❌ El INSERT cruzado se permitió — esto NO debería pasar.');
  } catch (e: any) {
    console.log('✅ El INSERT cruzado fue rechazado por RLS, como se esperaba.');
    console.log('   Código Postgres:', e.meta?.code ?? e.code);
    console.log('   Mensaje Postgres:', e.meta?.message ?? e.message);
  }

  console.log('\n=== PASO 4: sin JWT / sin claim sede_id -> no debe ver nada ===');
  await asRole(null, async (tx) => {
    const sinClaim: any[] = await tx.$queryRawUnsafe(`SELECT nombre FROM carreras;`);
    console.log(`Carreras visibles sin claim sede_id: ${sinClaim.length} (debe ser 0)`);
  });
}

main()
  .catch((e) => console.error('ERROR:', e))
  .finally(() => prisma.$disconnect());
