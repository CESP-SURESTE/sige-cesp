/**
 * Borra todo `Usuario` con rol ALUMNO/MAESTRO/ADMINISTRATIVO cuyo email NO
 * esté en `EMAILS_ANCLA` (las 39 personas ficticias reales del proyecto,
 * ver `seed-helpers.ts`) NI en `obtenerEmailsVariados()` (los 60 emails
 * generados por `seed-variado.ts` — bajas, licencias, egresados; función
 * pura y determinística, recalcularla acá reproduce exactamente los mismos
 * emails ya creados en la DB, sin necesidad de hardcodear una segunda
 * lista) — pensado para limpiar la basura que deja la
 * suite e2e del backend al correr contra esta misma base de datos (causa
 * raíz documentada en `documentacion_de_agentes/ESTADO.md`, sin corregir
 * hoy a propósito).
 *
 * Dry-run por default — solo cuenta y lista qué se borraría, sin tocar
 * nada. Requiere el flag `--confirmar` para ejecutar el borrado real.
 *
 * Orden de borrado (verificado contra las FK reales de las migraciones):
 *  1. `grupo_alumnos` de los alumnos a borrar — `ON DELETE RESTRICT`,
 *     bloquea el borrado del alumno si no se limpia antes.
 *  2. `usuarios` por id — cascada automática a
 *     `perfiles_alumno`/`perfiles_maestro`/`perfiles_administrativo` y sus
 *     `contactos_*`/`info_medica_*` (`ON DELETE CASCADE`).
 *     `registro_auditoria.usuario_id` ya es `ON DELETE SET NULL` (migración
 *     de Día 20) — el historial de auditoría sobrevive, solo pierde la
 *     referencia.
 *  3. La cuenta correspondiente en Supabase Auth — si no se borra acá
 *     también, el email queda huérfano en Auth y nadie podría volver a
 *     registrarse con él. Best-effort en lotes de 20 con una pausa de
 *     500ms entre lotes, para no saturar la Admin API.
 *
 * Uso:
 *   npx ts-node prisma/limpiar-datos-prueba.ts               (dry-run)
 *   npx ts-node prisma/limpiar-datos-prueba.ts --confirmar   (borrado real)
 */
import { RolUsuario } from '@prisma/client';
import { loadEnv } from '../src/load-env';

loadEnv();

import { prisma, EMAILS_ANCLA, getAdminClient } from './seed-helpers';
import { obtenerEmailsVariados } from './seed-variado';

const CONFIRMAR = process.argv.includes('--confirmar');
const TAMANO_LOTE = 20;
const PAUSA_ENTRE_LOTES_MS = 500;

async function main() {
  const emailsProtegidos = [...EMAILS_ANCLA, ...obtenerEmailsVariados()];

  const candidatos = await prisma.usuario.findMany({
    where: {
      rol: { in: [RolUsuario.ALUMNO, RolUsuario.MAESTRO, RolUsuario.ADMINISTRATIVO] },
      email: { notIn: emailsProtegidos },
    },
    select: { id: true, email: true, rol: true },
  });

  const porRol = {
    ALUMNO: candidatos.filter((c) => c.rol === RolUsuario.ALUMNO).length,
    MAESTRO: candidatos.filter((c) => c.rol === RolUsuario.MAESTRO).length,
    ADMINISTRATIVO: candidatos.filter((c) => c.rol === RolUsuario.ADMINISTRATIVO).length,
  };

  console.log(`Modo: ${CONFIRMAR ? 'BORRADO REAL' : 'DRY-RUN (nada se borra)'}`);
  console.log(`Anclas protegidas: ${EMAILS_ANCLA.length} + ${emailsProtegidos.length - EMAILS_ANCLA.length} variados = ${emailsProtegidos.length}`);
  console.log(`Candidatos a borrar: ${candidatos.length}`);
  console.log(`  Alumnos: ${porRol.ALUMNO}`);
  console.log(`  Maestros: ${porRol.MAESTRO}`);
  console.log(`  Administrativos: ${porRol.ADMINISTRATIVO}`);

  if (!CONFIRMAR) {
    console.log('\nDry-run — no se borró nada. Corre con --confirmar para ejecutar de verdad.');
    return;
  }

  if (candidatos.length === 0) {
    console.log('\nNada que borrar.');
    return;
  }

  const alumnoUsuarioIds = candidatos.filter((c) => c.rol === RolUsuario.ALUMNO).map((c) => c.id);
  if (alumnoUsuarioIds.length > 0) {
    const perfiles = await prisma.perfilAlumno.findMany({
      where: { usuarioId: { in: alumnoUsuarioIds } },
      select: { id: true },
    });
    const { count: gruposEliminados } = await prisma.grupoAlumno.deleteMany({
      where: { alumnoId: { in: perfiles.map((p) => p.id) } },
    });
    console.log(`grupo_alumnos borrados: ${gruposEliminados}`);
  }

  const idsABorrar = candidatos.map((c) => c.id);
  const { count: usuariosEliminados } = await prisma.usuario.deleteMany({
    where: { id: { in: idsABorrar } },
  });
  console.log(`usuarios (Postgres) borrados: ${usuariosEliminados}`);

  const client = await getAdminClient();
  let authBorrados = 0;
  let authFallos = 0;
  for (let i = 0; i < candidatos.length; i += TAMANO_LOTE) {
    const lote = candidatos.slice(i, i + TAMANO_LOTE);
    await Promise.all(
      lote.map(async (c) => {
        const { error } = await client.auth.admin.deleteUser(c.id);
        if (error) {
          console.error(`Error borrando ${c.email} de Supabase Auth:`, error.message);
          authFallos++;
        } else {
          authBorrados++;
        }
      }),
    );
    if (i + TAMANO_LOTE < candidatos.length) {
      await new Promise((resolve) => setTimeout(resolve, PAUSA_ENTRE_LOTES_MS));
    }
  }
  console.log(`Cuentas de Supabase Auth borradas: ${authBorrados}`);
  if (authFallos > 0) {
    console.log(`Fallos al borrar de Auth: ${authFallos} (revisar log de errores arriba)`);
  }

  console.log('\nLimpieza completa.');
}

main()
  .catch((e) => {
    console.error('Error corriendo la limpieza:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
