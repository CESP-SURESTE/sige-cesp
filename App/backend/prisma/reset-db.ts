/**
 * Reset TOTAL de la base — borra TODO (Supabase Auth + todas las tablas de
 * negocio de Postgres, EXCEPTO `admin_plataforma`, que es una identidad
 * separada de las sedes y no se toca) — para dejar la DB lista para un
 * reseed completo con datos ficticios (2026-08-16, a pedido explícito del
 * usuario: "limpia todos los registros de la db... no quiero ver registros
 * de prueba").
 *
 * ⚠️ DESTRUCTIVO E IRREVERSIBLE. NO se ejecuta nunca automáticamente (no es
 * `prisma/seed.ts` — ese sigue corriendo solo tras `prisma migrate dev`, y
 * es idempotente/no destructivo). Este script exige el flag `--confirmar`
 * a propósito, para que nadie lo dispare sin querer copiando/pegando un
 * comando en la terminal equivocada.
 *
 * Uso: `npx ts-node prisma/reset-db.ts --confirmar`
 *
 * Qué borra:
 *  1. TODOS los usuarios de Supabase Auth (Admin API, paginado) — incluye
 *     cuentas reales creadas por `POST /personas` en pruebas manuales, no
 *     solo las del seed.
 *  2. TODAS las filas de las 24 tablas de `schema.prisma` (`TRUNCATE ...
 *     CASCADE`, respeta FKs automáticamente, no hace falta orden manual).
 *
 * Qué NO toca: la estructura del schema (no hay DDL acá, `prisma migrate`
 * es un proceso aparte) ni las RLS policies (viven en las migraciones, no
 * se recrean ni se borran con TRUNCATE).
 */
import { PrismaClient } from '@prisma/client';
import { loadEnv } from '../src/load-env';

// A diferencia de `prisma db seed` (que Prisma CLI carga `.env` solo antes
// de invocar el script), correr `ts-node` directo no trae las env vars —
// hace falta cargarlas a mano, mismo helper que usan los tests e2e.
loadEnv();

const prisma = new PrismaClient();

type CreateAdminClientFn =
  typeof import('@supabase/server/core').createAdminClient;

async function getAdminClient() {
  const core = await import('@supabase/server/core');
  const createAdminClient = core.createAdminClient as unknown as CreateAdminClientFn;
  return createAdminClient();
}

async function purgarSupabaseAuth() {
  const client = await getAdminClient();
  let pagina = 1;
  let totalBorrados = 0;

  for (;;) {
    const { data, error } = await client.auth.admin.listUsers({
      page: pagina,
      perPage: 200,
    });
    if (error) {
      throw new Error(`Error listando usuarios de Supabase Auth: ${error.message}`);
    }
    if (!data.users.length) {
      break;
    }

    for (const user of data.users) {
      const { error: deleteError } = await client.auth.admin.deleteUser(user.id);
      if (deleteError) {
        console.error(
          `  ⚠️  No se pudo borrar ${user.email ?? user.id}:`,
          deleteError.message,
        );
        continue;
      }
      totalBorrados++;
    }

    // `listUsers` no avanza sola de página cuando vamos borrando en el
    // camino (los índices se recalculan) — pedir la página 1 otra vez hasta
    // que no queden usuarios es más simple y correcto que llevar la cuenta
    // de `nextPage` mientras el set cambia bajo los pies.
    if (data.users.length < 1) {
      break;
    }
  }

  console.log(`  Supabase Auth: ${totalBorrados} cuentas borradas.`);
}

// admin_plataforma NO está en esta lista a propósito — esa identidad
// (login de /plataforma) es independiente de las sedes y no se toca aquí
// (decisión explícita del usuario, 2026-09-17).
const TABLAS = [
  'sede_responsables',
  'telefonos_emergencia_sede',
  'mallas_curriculares',
  'grupo_materia_maestro',
  'grupo_alumnos',
  'grupos',
  'materias',
  'contador_matricula',
  'recordatorio_enviado',
  'eventos_calendario',
  'notificaciones',
  'avisos',
  'contactos_alumno',
  'info_medica_alumno',
  'perfiles_alumno',
  'contactos_maestro',
  'info_medica_maestro',
  'perfiles_maestro',
  'contactos_administrativo',
  'info_medica_administrativo',
  'permisos_administrativo',
  'perfiles_administrativo',
  'contactos_personal_servicios',
  'info_medica_personal_servicios',
  'personal_servicios',
  'registro_auditoria',
  'usuarios',
  'secciones',
  'salones',
  'carreras',
  'sedes',
];

async function truncarPostgres() {
  const lista = TABLAS.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${lista} CASCADE;`);
  console.log(`  Postgres: ${TABLAS.length} tablas truncadas.`);
}

async function main() {
  if (!process.argv.includes('--confirmar')) {
    console.error(
      'Falta el flag --confirmar. Este script borra TODA la base (Auth + Postgres) ' +
        'de forma irreversible. Correr con: npx ts-node prisma/reset-db.ts --confirmar',
    );
    process.exit(1);
  }

  console.log('Borrando usuarios de Supabase Auth...');
  await purgarSupabaseAuth();

  console.log('Truncando tablas de Postgres...');
  await truncarPostgres();

  console.log('Reset completo. La DB está vacía.');
}

main()
  .catch((e) => {
    console.error('Error corriendo el reset:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
