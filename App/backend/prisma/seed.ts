/**
 * Seed de datos DEMO — Fase 1 (Día 4) original, reescrito por completo el
 * 2026-08-16 a pedido explícito del usuario: "limpia toda los registros de
 * la db, y remplazalos por datos ficticios... vamos a hacer pruebas, pero
 * no quiero ver registros de prueba".
 *
 * Siembra 2 sedes (Mérida y Valladolid) con un set de datos ficticios
 * completo y con apariencia de producción — 2 carreras, 2 salones, 2 grupos,
 * 2 administrativos (uno `ADMIN`, uno `SUPER_ADMIN`), 3 maestros, 8 alumnos
 * repartidos entre los 2 grupos y 2 personal de servicios, por sede.
 *
 * DIFERENCIA CLAVE con la versión anterior de este archivo: cada persona con
 * cuenta (alumno/maestro/administrativo) ahora tiene una cuenta REAL en
 * Supabase Auth (Admin API, `email_confirm: true`), no un UUID aleatorio —
 * a pedido explícito del usuario, para poder loguearse de verdad y probar
 * guards/permisos/flujos completos, no solo ver filas en la tabla.
 * `Usuario.id` = el mismo UUID que devuelve Supabase Auth (mismo criterio
 * que el alta transaccional real de `PersonasService.altaPersona`,
 * Fase 4 Día 11 — ya NO aplica la excepción a la regla 9 que documentaba
 * la versión anterior de este archivo).
 *
 * Contraseña compartida por todas las cuentas ficticias: se lee de
 * `process.env.SEED_DEMO_PASSWORD` (el script falla rápido si falta) — NUNCA
 * hardcodeada acá, mismo criterio que "nunca contraseñas/API keys reales en
 * ningún archivo del repo" (CLAUDE.md global del usuario). Se define al
 * invocar el script, no se persiste en ningún lado.
 *
 * ⚠️ ANCLAS QUE NO SE PUEDEN RENOMBRAR NI CAMBIAR DE VALOR sin romper tests
 * e2e reales que los verifican campo por campo (`test/perfil.e2e-spec.ts`,
 * `test/personas.e2e-spec.ts`, `test/personas-listado.e2e-spec.ts`,
 * `test/carreras.e2e-spec.ts`, `test/sede-guard.e2e-spec.ts`,
 * `test/roles-guard.e2e-spec.ts`, `test/cambiar-password.e2e-spec.ts`):
 *  - Nombres de sede: "CESP Mérida" / "CESP Valladolid"
 *  - Claves de carrera: LAE-MID / ING-SIS-MID (Mérida), LC-VLD / ING-IND-VLD
 *    (Valladolid)
 *  - `ana.canul@cesp-merida.edu.mx` — ADMINISTRATIVO, nivelPermiso ADMIN,
 *    puesto COORDINADOR_ADMINISTRATIVO, exactamente 1 contacto
 *    ("Contacto de prueba", orden 1)
 *  - `jorge.ek@cesp-valladolid.edu.mx` — mismo shape que `ana.canul`, para
 *    Valladolid
 *  - `luis.chan@cesp-merida.edu.mx` — ALUMNO, nombres "Luis Fernando",
 *    apellidoPaterno "Chan", apellidoMaterno "Uc", matrícula
 *    "MID-2026-0001", correoPersonal "luis.chan.personal@example.com",
 *    fechaNacimiento 2007-03-12, carrera LAE-MID, exactamente 1 contacto
 *    tipo EMERGENCIA orden 1 ("Contacto de prueba")
 *  - `mariajose.pech@cesp-valladolid.edu.mx` — ALUMNO, matrícula
 *    "VLD-2026-0001", fechaNacimiento 2008-07-20
 * Todo lo demás (los 7 alumnos extra, los 3 maestros, el segundo
 * administrativo y el personal de servicios extra por sede) es ficticio
 * nuevo, libre de renombrar.
 *
 * Es seguro volver a correr este script: cada persona se busca primero por
 * email en Postgres — si ya existe, no se toca (ni Auth ni DB). Si en algún
 * momento se vuelve a correr `prisma migrate dev` (que dispara este seed
 * automáticamente), no vuelve a crear nada que ya exista.
 *
 * Uso: `SEED_DEMO_PASSWORD='...' npx ts-node prisma/seed.ts`
 * (o `pnpm exec prisma db seed` con la misma variable ya exportada).
 */

import {
  PrismaClient,
  type Carrera,
  type Salon,
  type Grupo,
  RolUsuario,
  EstatusAcademico,
  TipoContacto,
  EstatusEmpleado,
  PuestoAdministrativo,
  NivelPermiso,
  NivelCarrera,
  ModalidadCarrera,
  EstatusCarrera,
  AreaPersonalServicios,
} from '@prisma/client';
import { loadEnv } from '../src/load-env';

// Correr `ts-node prisma/seed.ts` directo (no vía `prisma db seed`) no trae
// las env vars solo — mismo helper que usan los tests e2e (`src/load-env.ts`).
loadEnv();

const prisma = new PrismaClient();

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD;
if (!DEMO_PASSWORD) {
  console.error(
    'Falta SEED_DEMO_PASSWORD en el entorno. Este seed crea cuentas reales ' +
      'en Supabase Auth — hace falta una password compartida para todas. ' +
      "Uso: SEED_DEMO_PASSWORD='...' npx ts-node prisma/seed.ts",
  );
  process.exit(1);
}

/**
 * `@supabase/server` (y `jose`, del que depende) son ESM-only — mismo
 * patrón de `import()` dinámico + caché que ya usan `sede.guard.ts`,
 * `auth.service.ts` y `personas.service.ts` (cada archivo cachea su propia
 * referencia, es el criterio ya establecido en esta base de código).
 */
type CreateAdminClientFn =
  typeof import('@supabase/server/core').createAdminClient;
let createAdminClientFn: CreateAdminClientFn | undefined;

async function getAdminClient() {
  if (!createAdminClientFn) {
    const core = await import('@supabase/server/core');
    createAdminClientFn =
      core.createAdminClient as unknown as CreateAdminClientFn;
  }
  return createAdminClientFn();
}

interface ContactoSeed {
  nombre: string;
  telefono: string;
  parentesco: string;
}

interface InfoMedicaSeed {
  tieneCondicionMedica: false;
}

const INFO_MEDICA_DEFAULT: InfoMedicaSeed = { tieneCondicionMedica: false };

/**
 * Alta de una persona con cuenta (alumno/maestro/administrativo) — Auth real
 * + fila en `usuarios`. Idempotente: si el email ya existe en Postgres, no
 * toca Auth ni crea nada, devuelve el `usuarioId` existente.
 */
async function altaUsuarioSeed(
  email: string,
  rol: RolUsuario,
  sedeId: string,
): Promise<{ usuarioId: string; yaExistia: boolean }> {
  const existente = await prisma.usuario.findUnique({ where: { email } });
  if (existente) {
    return { usuarioId: existente.id, yaExistia: true };
  }

  const client = await getAdminClient();
  const { data, error } = await client.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
  });
  if (error || !data?.user) {
    throw new Error(
      `Error creando ${email} en Supabase Auth: ${error?.message ?? 'sin detalle'}`,
    );
  }

  await prisma.usuario.create({
    data: { id: data.user.id, email, rol, sedeId },
  });

  return { usuarioId: data.user.id, yaExistia: false };
}

async function seedAlumno(params: {
  email: string;
  sedeId: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno?: string;
  curp?: string;
  matricula: string;
  correoPersonal: string;
  fechaNacimiento: Date;
  carreraId: string;
  contacto: ContactoSeed;
}) {
  const { usuarioId, yaExistia } = await altaUsuarioSeed(
    params.email,
    RolUsuario.ALUMNO,
    params.sedeId,
  );
  if (yaExistia) {
    return prisma.perfilAlumno.findUniqueOrThrow({ where: { usuarioId } });
  }

  return prisma.perfilAlumno.create({
    data: {
      usuarioId,
      nombres: params.nombres,
      apellidoPaterno: params.apellidoPaterno,
      apellidoMaterno: params.apellidoMaterno,
      curp: params.curp,
      fechaNacimiento: params.fechaNacimiento,
      matricula: params.matricula,
      correoPersonal: params.correoPersonal,
      carreraId: params.carreraId,
      estatusAcademico: EstatusAcademico.INSCRITO,
      periodoIngreso: '2026-1',
      semestreActual: 1,
      contactos: {
        create: [
          {
            tipo: TipoContacto.EMERGENCIA,
            nombre: params.contacto.nombre,
            telefono: params.contacto.telefono,
            parentesco: params.contacto.parentesco,
            orden: 1,
          },
        ],
      },
      infoMedica: { create: INFO_MEDICA_DEFAULT },
    },
  });
}

async function seedMaestro(params: {
  email: string;
  sedeId: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno?: string;
  curp: string;
  cedulaProfesional?: string;
  correoPersonal: string;
  telefono: string;
  contacto: ContactoSeed;
}) {
  const { usuarioId, yaExistia } = await altaUsuarioSeed(
    params.email,
    RolUsuario.MAESTRO,
    params.sedeId,
  );
  if (yaExistia) return;

  await prisma.perfilMaestro.create({
    data: {
      usuarioId,
      nombres: params.nombres,
      apellidoPaterno: params.apellidoPaterno,
      apellidoMaterno: params.apellidoMaterno,
      curp: params.curp,
      cedulaProfesional: params.cedulaProfesional,
      correoPersonal: params.correoPersonal,
      telefono: params.telefono,
      fechaContratacion: new Date('2024-08-01'),
      estatus: EstatusEmpleado.ACTIVO,
      contactos: {
        create: [
          {
            nombre: params.contacto.nombre,
            telefono: params.contacto.telefono,
            parentesco: params.contacto.parentesco,
            orden: 1,
          },
        ],
      },
      infoMedica: { create: INFO_MEDICA_DEFAULT },
    },
  });
}

async function seedAdministrativo(params: {
  email: string;
  sedeId: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno?: string;
  curp: string;
  correoPersonal: string;
  telefono: string;
  puesto: PuestoAdministrativo;
  nivelPermiso: NivelPermiso;
  contacto: ContactoSeed;
}) {
  const { usuarioId, yaExistia } = await altaUsuarioSeed(
    params.email,
    RolUsuario.ADMINISTRATIVO,
    params.sedeId,
  );
  if (yaExistia) return;

  await prisma.perfilAdministrativo.create({
    data: {
      usuarioId,
      nombres: params.nombres,
      apellidoPaterno: params.apellidoPaterno,
      apellidoMaterno: params.apellidoMaterno,
      curp: params.curp,
      correoPersonal: params.correoPersonal,
      telefono: params.telefono,
      fechaContratacion: new Date('2023-01-15'),
      estatus: EstatusEmpleado.ACTIVO,
      puesto: params.puesto,
      nivelPermiso: params.nivelPermiso,
      contactos: {
        create: [
          {
            nombre: params.contacto.nombre,
            telefono: params.contacto.telefono,
            parentesco: params.contacto.parentesco,
            orden: 1,
          },
        ],
      },
      infoMedica: { create: INFO_MEDICA_DEFAULT },
    },
  });
}

async function seedPersonalServicios(params: {
  sedeId: string;
  nombres: string;
  apellidoPaterno: string;
  curp: string;
  telefono: string;
  area: AreaPersonalServicios;
  contacto: ContactoSeed;
}) {
  const existente = await prisma.personalServicios.findFirst({
    where: { sedeId: params.sedeId, curp: params.curp },
  });
  if (existente) return;

  await prisma.personalServicios.create({
    data: {
      sedeId: params.sedeId,
      nombres: params.nombres,
      apellidoPaterno: params.apellidoPaterno,
      curp: params.curp,
      area: params.area,
      telefono: params.telefono,
      fechaContratacion: new Date('2023-06-01'),
      estatus: EstatusEmpleado.ACTIVO,
      contactos: {
        create: [
          {
            nombre: params.contacto.nombre,
            telefono: params.contacto.telefono,
            parentesco: params.contacto.parentesco,
            orden: 1,
          },
        ],
      },
      infoMedica: { create: INFO_MEDICA_DEFAULT },
    },
  });
}

interface SedeSeedConfig {
  nombre: string;
  direccion: string;
  ubicacionReferencia: string;
  telefono: string;
  costoRenta: number;
  dominio: string; // "cesp-merida.edu.mx" / "cesp-valladolid.edu.mx"
  carreras: [
    { nombre: string; clave: string; rvoe: string },
    { nombre: string; clave: string; rvoe: string },
  ];
  salones: [string, string];
  grupos: [string, string]; // 1 por carrera, mismo orden
  administrativos: [
    {
      nombres: string;
      apellidoPaterno: string;
      apellidoMaterno: string;
      curp: string;
      correoPersonal: string;
      telefono: string;
      emailInstitucional: string; // ancla — NO cambiar
      contacto: ContactoSeed;
    },
    {
      nombres: string;
      apellidoPaterno: string;
      apellidoMaterno: string;
      curp: string;
      correoPersonal: string;
      telefono: string;
      emailInstitucional: string;
      contacto: ContactoSeed;
    },
  ];
  maestros: Array<{
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string;
    curp: string;
    cedulaProfesional: string;
    correoPersonal: string;
    telefono: string;
    emailInstitucional: string;
    contacto: ContactoSeed;
  }>;
  alumnos: Array<{
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string;
    matricula: string;
    correoPersonal: string;
    emailInstitucional: string; // ancla en el primero de la lista — NO cambiar
    fechaNacimiento: Date;
    carreraIndex: 0 | 1;
    contacto: ContactoSeed;
  }>;
  personalServicios: [
    {
      nombres: string;
      apellidoPaterno: string;
      curp: string;
      telefono: string;
      area: AreaPersonalServicios;
      contacto: ContactoSeed;
    },
    {
      nombres: string;
      apellidoPaterno: string;
      curp: string;
      telefono: string;
      area: AreaPersonalServicios;
      contacto: ContactoSeed;
    },
  ];
}

async function seedSede(config: SedeSeedConfig) {
  const sede = await prisma.sede.upsert({
    where: { nombre: config.nombre },
    update: {},
    create: {
      nombre: config.nombre,
      direccion: config.direccion,
      ubicacionReferencia: config.ubicacionReferencia,
      telefono: config.telefono,
      costoRenta: config.costoRenta,
    },
  });

  const carreras: Carrera[] = [];
  for (const c of config.carreras) {
    const carrera = await prisma.carrera.upsert({
      where: { clave: c.clave },
      update: {},
      create: {
        nombre: c.nombre,
        clave: c.clave,
        sedeId: sede.id,
        duracion: 8,
        nivel: NivelCarrera.LICENCIATURA,
        modalidad: ModalidadCarrera.PRESENCIAL,
        estatus: EstatusCarrera.ACTIVA,
        rvoe: c.rvoe,
        descripcion: `Carrera de prueba (${c.nombre}) sembrada para validar el aislamiento multi-sede.`,
      },
    });
    carreras.push(carrera);
  }

  const salones: Salon[] = [];
  for (const nombreSalon of config.salones) {
    const salon = await prisma.salon.upsert({
      where: { sedeId_nombre: { sedeId: sede.id, nombre: nombreSalon } },
      update: {},
      create: { sedeId: sede.id, nombre: nombreSalon, capacidad: 35 },
    });
    salones.push(salon);
  }

  const grupos: Grupo[] = [];
  for (let i = 0; i < config.grupos.length; i++) {
    let grupo = await prisma.grupo.findFirst({
      where: { sedeId: sede.id, nombre: config.grupos[i] },
    });
    if (!grupo) {
      grupo = await prisma.grupo.create({
        data: {
          sedeId: sede.id,
          carreraId: carreras[i].id,
          salonId: salones[i].id,
          nombre: config.grupos[i],
          anioInicio: 2026,
          cicloActual: 1,
          capacidad: 30,
        },
      });
    }
    grupos.push(grupo);
  }

  for (const admin of config.administrativos) {
    await seedAdministrativo({
      email: admin.emailInstitucional,
      sedeId: sede.id,
      nombres: admin.nombres,
      apellidoPaterno: admin.apellidoPaterno,
      apellidoMaterno: admin.apellidoMaterno,
      curp: admin.curp,
      correoPersonal: admin.correoPersonal,
      telefono: admin.telefono,
      puesto:
        admin === config.administrativos[0]
          ? PuestoAdministrativo.COORDINADOR_ADMINISTRATIVO
          : PuestoAdministrativo.DIRECTOR,
      nivelPermiso:
        admin === config.administrativos[0]
          ? NivelPermiso.ADMIN
          : NivelPermiso.SUPER_ADMIN,
      contacto: admin.contacto,
    });
  }

  for (const maestro of config.maestros) {
    await seedMaestro({
      email: maestro.emailInstitucional,
      sedeId: sede.id,
      nombres: maestro.nombres,
      apellidoPaterno: maestro.apellidoPaterno,
      apellidoMaterno: maestro.apellidoMaterno,
      curp: maestro.curp,
      cedulaProfesional: maestro.cedulaProfesional,
      correoPersonal: maestro.correoPersonal,
      telefono: maestro.telefono,
      contacto: maestro.contacto,
    });
  }

  for (const alumno of config.alumnos) {
    const perfilAlumno = await seedAlumno({
      email: alumno.emailInstitucional,
      sedeId: sede.id,
      nombres: alumno.nombres,
      apellidoPaterno: alumno.apellidoPaterno,
      apellidoMaterno: alumno.apellidoMaterno,
      matricula: alumno.matricula,
      correoPersonal: alumno.correoPersonal,
      fechaNacimiento: alumno.fechaNacimiento,
      carreraId: carreras[alumno.carreraIndex].id,
      contacto: alumno.contacto,
    });

    await prisma.grupoAlumno.upsert({
      where: {
        grupoId_alumnoId: {
          grupoId: grupos[alumno.carreraIndex].id,
          alumnoId: perfilAlumno.id,
        },
      },
      update: {},
      create: {
        grupoId: grupos[alumno.carreraIndex].id,
        alumnoId: perfilAlumno.id,
      },
    });
  }

  for (const personal of config.personalServicios) {
    await seedPersonalServicios({ sedeId: sede.id, ...personal });
  }

  return { sede, carreras, salones, grupos };
}

async function main() {
  console.log('Sembrando sede Mérida...');
  const merida = await seedSede({
    nombre: 'CESP Mérida',
    direccion: 'Calle 60 #123, Centro',
    ubicacionReferencia: 'Frente al parque de Santa Lucía',
    telefono: '9999123456',
    costoRenta: 25000,
    dominio: 'cesp-merida.edu.mx',
    carreras: [
      { nombre: 'Licenciatura en Administración', clave: 'LAE-MID', rvoe: 'RVOE-MID-001' },
      { nombre: 'Ingeniería en Sistemas', clave: 'ING-SIS-MID', rvoe: 'RVOE-MID-002' },
    ],
    salones: ['Aula 101', 'Aula 102'],
    grupos: ['1A', '1B'],
    administrativos: [
      {
        // ANCLA — ver comentario del encabezado del archivo.
        nombres: 'Ana María',
        apellidoPaterno: 'Canul',
        apellidoMaterno: 'Poot',
        curp: 'CAPA900101MYNNXX01',
        correoPersonal: 'ana.canul.personal@example.com',
        telefono: '9991112233',
        emailInstitucional: 'ana.canul@cesp-merida.edu.mx',
        contacto: { nombre: 'Contacto de prueba', telefono: '9990000000', parentesco: 'Hermano/a' },
      },
      {
        nombres: 'Fátima Guadalupe',
        apellidoPaterno: 'Sosa',
        apellidoMaterno: 'Loeza',
        curp: 'SOLF850312MYNSZT02',
        correoPersonal: 'fatima.sosa.personal@example.com',
        telefono: '9991223344',
        emailInstitucional: 'fatima.sosa@cesp-merida.edu.mx',
        contacto: { nombre: 'Antonio Sosa', telefono: '9992223344', parentesco: 'Esposo' },
      },
    ],
    maestros: [
      {
        nombres: 'Mario Alberto',
        apellidoPaterno: 'Loeza',
        apellidoMaterno: 'Sosa',
        curp: 'LOSM820304HYNZSR03',
        cedulaProfesional: '4455667',
        correoPersonal: 'mario.loeza.personal@example.com',
        telefono: '9993334455',
        emailInstitucional: 'mario.loeza@cesp-merida.edu.mx',
        contacto: { nombre: 'Rosa Loeza', telefono: '9990001111', parentesco: 'Madre' },
      },
      {
        nombres: 'Gabriela Isabel',
        apellidoPaterno: 'Novelo',
        apellidoMaterno: 'Rejón',
        curp: 'NORG870519MYNVJB04',
        cedulaProfesional: '5566778',
        correoPersonal: 'gabriela.novelo.personal@example.com',
        telefono: '9994445566',
        emailInstitucional: 'gabriela.novelo@cesp-merida.edu.mx',
        contacto: { nombre: 'Luis Novelo', telefono: '9990002222', parentesco: 'Padre' },
      },
      {
        nombres: 'Alejandro Iván',
        apellidoPaterno: 'Vera',
        apellidoMaterno: 'Ortegón',
        curp: 'VEOA791122HYNRRL05',
        cedulaProfesional: '6677889',
        correoPersonal: 'alejandro.vera.personal@example.com',
        telefono: '9995556677',
        emailInstitucional: 'alejandro.vera@cesp-merida.edu.mx',
        contacto: { nombre: 'Marisol Vera', telefono: '9990003333', parentesco: 'Esposa' },
      },
    ],
    alumnos: [
      {
        // ANCLA — ver comentario del encabezado del archivo.
        nombres: 'Luis Fernando',
        apellidoPaterno: 'Chan',
        apellidoMaterno: 'Uc',
        matricula: 'MID-2026-0001',
        correoPersonal: 'luis.chan.personal@example.com',
        emailInstitucional: 'luis.chan@cesp-merida.edu.mx',
        fechaNacimiento: new Date('2007-03-12'),
        carreraIndex: 0,
        contacto: { nombre: 'Contacto de prueba', telefono: '9990000001', parentesco: 'Madre' },
      },
      {
        nombres: 'María Fernanda',
        apellidoPaterno: 'Poot',
        apellidoMaterno: 'Chi',
        matricula: 'MID-2026-0002',
        correoPersonal: 'mariafernanda.poot.personal@example.com',
        emailInstitucional: 'mariafernanda.poot@cesp-merida.edu.mx',
        fechaNacimiento: new Date('2006-05-14'),
        carreraIndex: 0,
        contacto: { nombre: 'Julia Chi', telefono: '9990004444', parentesco: 'Madre' },
      },
      {
        nombres: 'Carlos Eduardo',
        apellidoPaterno: 'Tec',
        apellidoMaterno: 'Balam',
        matricula: 'MID-2026-0003',
        correoPersonal: 'carlos.tec.personal@example.com',
        emailInstitucional: 'carlos.tec@cesp-merida.edu.mx',
        fechaNacimiento: new Date('2005-11-02'),
        carreraIndex: 0,
        contacto: { nombre: 'Norma Balam', telefono: '9990005555', parentesco: 'Madre' },
      },
      {
        nombres: 'Ximena Guadalupe',
        apellidoPaterno: 'Chuc',
        apellidoMaterno: 'Cocom',
        matricula: 'MID-2026-0006',
        correoPersonal: 'ximena.chuc.personal@example.com',
        emailInstitucional: 'ximena.chuc@cesp-merida.edu.mx',
        fechaNacimiento: new Date('2004-12-09'),
        carreraIndex: 0,
        contacto: { nombre: 'Pedro Chuc', telefono: '9990006666', parentesco: 'Padre' },
      },
      {
        nombres: 'Andrea Nohemí',
        apellidoPaterno: 'Couoh',
        apellidoMaterno: 'Yam',
        matricula: 'MID-2026-0004',
        correoPersonal: 'andrea.couoh.personal@example.com',
        emailInstitucional: 'andrea.couoh@cesp-merida.edu.mx',
        fechaNacimiento: new Date('2006-02-28'),
        carreraIndex: 1,
        contacto: { nombre: 'Elena Yam', telefono: '9990007777', parentesco: 'Madre' },
      },
      {
        nombres: 'Diego Alejandro',
        apellidoPaterno: 'Cahum',
        apellidoMaterno: 'May',
        matricula: 'MID-2026-0005',
        correoPersonal: 'diego.cahum.personal@example.com',
        emailInstitucional: 'diego.cahum@cesp-merida.edu.mx',
        fechaNacimiento: new Date('2005-08-19'),
        carreraIndex: 1,
        contacto: { nombre: 'Rocío May', telefono: '9990008888', parentesco: 'Madre' },
      },
      {
        nombres: 'Ricardo Iván',
        apellidoPaterno: 'Puc',
        apellidoMaterno: 'Ku',
        matricula: 'MID-2026-0007',
        correoPersonal: 'ricardo.puc.personal@example.com',
        emailInstitucional: 'ricardo.puc@cesp-merida.edu.mx',
        fechaNacimiento: new Date('2006-07-23'),
        carreraIndex: 1,
        contacto: { nombre: 'Alicia Ku', telefono: '9990009999', parentesco: 'Madre' },
      },
      {
        nombres: 'Valeria Itzel',
        apellidoPaterno: 'Uicab',
        apellidoMaterno: 'Canché',
        matricula: 'MID-2026-0008',
        correoPersonal: 'valeria.uicab.personal@example.com',
        emailInstitucional: 'valeria.uicab@cesp-merida.edu.mx',
        fechaNacimiento: new Date('2005-03-30'),
        carreraIndex: 1,
        contacto: { nombre: 'Fernando Uicab', telefono: '9990010101', parentesco: 'Padre' },
      },
    ],
    personalServicios: [
      {
        nombres: 'Roberto',
        apellidoPaterno: 'Dzul',
        curp: 'DURO850505HYNZBB02',
        telefono: '9994445566',
        area: AreaPersonalServicios.INTENDENCIA,
        contacto: { nombre: 'Contacto de prueba', telefono: '9990000002', parentesco: 'Esposo/a' },
      },
      {
        nombres: 'Miguel Ángel',
        apellidoPaterno: 'Chan',
        curp: 'CAPM880714HYNHNG06',
        telefono: '9996667788',
        area: AreaPersonalServicios.SEGURIDAD,
        contacto: { nombre: 'Lourdes Chan', telefono: '9990011111', parentesco: 'Esposa' },
      },
    ],
  });

  console.log('Sembrando sede Valladolid...');
  const valladolid = await seedSede({
    nombre: 'CESP Valladolid',
    direccion: 'Calle 41 #456, Centro',
    ubicacionReferencia: 'A dos cuadras del Convento de Sisal',
    telefono: '9859876543',
    costoRenta: 15000,
    dominio: 'cesp-valladolid.edu.mx',
    carreras: [
      { nombre: 'Licenciatura en Contaduría', clave: 'LC-VLD', rvoe: 'RVOE-VLD-001' },
      { nombre: 'Ingeniería Industrial', clave: 'ING-IND-VLD', rvoe: 'RVOE-VLD-002' },
    ],
    salones: ['Aula 201', 'Aula 202'],
    grupos: ['1A', '1B'],
    administrativos: [
      {
        // ANCLA — ver comentario del encabezado del archivo.
        nombres: 'Jorge Alberto',
        apellidoPaterno: 'Ek',
        apellidoMaterno: 'Balam',
        curp: 'EKBJ880202HYNKLL03',
        correoPersonal: 'jorge.ek.personal@example.com',
        telefono: '9852223344',
        emailInstitucional: 'jorge.ek@cesp-valladolid.edu.mx',
        contacto: { nombre: 'Contacto de prueba', telefono: '9850000000', parentesco: 'Hermano/a' },
      },
      {
        nombres: 'Raúl Enrique',
        apellidoPaterno: 'Itza',
        apellidoMaterno: 'Góngora',
        curp: 'ITGR830825HYNTNL07',
        correoPersonal: 'raul.itza.personal@example.com',
        telefono: '9853334455',
        emailInstitucional: 'raul.itza@cesp-valladolid.edu.mx',
        contacto: { nombre: 'Beatriz Itza', telefono: '9851112233', parentesco: 'Esposa' },
      },
    ],
    maestros: [
      {
        nombres: 'Patricia Elena',
        apellidoPaterno: 'Herrera',
        apellidoMaterno: 'Uh',
        curp: 'HEUP810613MYNRHT08',
        cedulaProfesional: '7788990',
        correoPersonal: 'patricia.herrera.personal@example.com',
        telefono: '9854445566',
        emailInstitucional: 'patricia.herrera@cesp-valladolid.edu.mx',
        contacto: { nombre: 'Manuel Herrera', telefono: '9850001111', parentesco: 'Padre' },
      },
      {
        nombres: 'Julio César',
        apellidoPaterno: 'Wicab',
        apellidoMaterno: 'Xiu',
        curp: 'WIXJ760930HYNCXL09',
        cedulaProfesional: '8899001',
        correoPersonal: 'julio.wicab.personal@example.com',
        telefono: '9855556677',
        emailInstitucional: 'julio.wicab@cesp-valladolid.edu.mx',
        contacto: { nombre: 'Ana Wicab', telefono: '9850002222', parentesco: 'Esposa' },
      },
      {
        nombres: 'Adriana Lucía',
        apellidoPaterno: 'Yah',
        apellidoMaterno: 'Zapata',
        curp: 'YAZA891117MYNHPD10',
        cedulaProfesional: '9900112',
        correoPersonal: 'adriana.yah.personal@example.com',
        telefono: '9856667788',
        emailInstitucional: 'adriana.yah@cesp-valladolid.edu.mx',
        contacto: { nombre: 'Ricardo Yah', telefono: '9850003333', parentesco: 'Padre' },
      },
    ],
    alumnos: [
      {
        // ANCLA — ver comentario del encabezado del archivo.
        nombres: 'María José',
        apellidoPaterno: 'Pech',
        apellidoMaterno: 'Tun',
        matricula: 'VLD-2026-0001',
        correoPersonal: 'mariajose.pech.personal@example.com',
        emailInstitucional: 'mariajose.pech@cesp-valladolid.edu.mx',
        fechaNacimiento: new Date('2008-07-20'),
        carreraIndex: 0,
        contacto: { nombre: 'Contacto de prueba', telefono: '9850000001', parentesco: 'Madre' },
      },
      {
        nombres: 'José Manuel',
        apellidoPaterno: 'Chable',
        apellidoMaterno: 'Kantún',
        matricula: 'VLD-2026-0002',
        correoPersonal: 'josemanuel.chable.personal@example.com',
        emailInstitucional: 'josemanuel.chable@cesp-valladolid.edu.mx',
        fechaNacimiento: new Date('2006-01-17'),
        carreraIndex: 0,
        contacto: { nombre: 'Silvia Kantún', telefono: '9850004444', parentesco: 'Madre' },
      },
      {
        nombres: 'Karla Daniela',
        apellidoPaterno: 'Xool',
        apellidoMaterno: 'Batún',
        matricula: 'VLD-2026-0003',
        correoPersonal: 'karla.xool.personal@example.com',
        emailInstitucional: 'karla.xool@cesp-valladolid.edu.mx',
        fechaNacimiento: new Date('2005-09-05'),
        carreraIndex: 0,
        contacto: { nombre: 'Ismael Xool', telefono: '9850005555', parentesco: 'Padre' },
      },
      {
        nombres: 'Fernando Gerardo',
        apellidoPaterno: 'Baas',
        apellidoMaterno: 'Cen',
        matricula: 'VLD-2026-0006',
        correoPersonal: 'fernando.baas.personal@example.com',
        emailInstitucional: 'fernando.baas@cesp-valladolid.edu.mx',
        fechaNacimiento: new Date('2004-10-08'),
        carreraIndex: 0,
        contacto: { nombre: 'Teresa Cen', telefono: '9850006666', parentesco: 'Madre' },
      },
      {
        nombres: 'Emilio Rodrigo',
        apellidoPaterno: 'Cetz',
        apellidoMaterno: 'Dzib',
        matricula: 'VLD-2026-0004',
        correoPersonal: 'emilio.cetz.personal@example.com',
        emailInstitucional: 'emilio.cetz@cesp-valladolid.edu.mx',
        fechaNacimiento: new Date('2006-06-11'),
        carreraIndex: 1,
        contacto: { nombre: 'Luz Dzib', telefono: '9850007777', parentesco: 'Madre' },
      },
      {
        nombres: 'Renata Paulina',
        apellidoPaterno: 'Tzuc',
        apellidoMaterno: 'Ake',
        matricula: 'VLD-2026-0005',
        correoPersonal: 'renata.tzuc.personal@example.com',
        emailInstitucional: 'renata.tzuc@cesp-valladolid.edu.mx',
        fechaNacimiento: new Date('2005-04-22'),
        carreraIndex: 1,
        contacto: { nombre: 'Hugo Tzuc', telefono: '9850008888', parentesco: 'Padre' },
      },
      {
        nombres: 'Camila Sofía',
        apellidoPaterno: 'Chim',
        apellidoMaterno: 'Cob',
        matricula: 'VLD-2026-0007',
        correoPersonal: 'camila.chim.personal@example.com',
        emailInstitucional: 'camila.chim@cesp-valladolid.edu.mx',
        fechaNacimiento: new Date('2006-03-15'),
        carreraIndex: 1,
        contacto: { nombre: 'Marcela Cob', telefono: '9850009999', parentesco: 'Madre' },
      },
      {
        nombres: 'Pablo Antonio',
        apellidoPaterno: 'Euan',
        apellidoMaterno: 'Kumul',
        matricula: 'VLD-2026-0008',
        correoPersonal: 'pablo.euan.personal@example.com',
        emailInstitucional: 'pablo.euan@cesp-valladolid.edu.mx',
        fechaNacimiento: new Date('2005-12-27'),
        carreraIndex: 1,
        contacto: { nombre: 'Georgina Euan', telefono: '9850010101', parentesco: 'Madre' },
      },
    ],
    personalServicios: [
      {
        nombres: 'Silvia',
        apellidoPaterno: 'Cauich',
        curp: 'CAXS900909MYNCXX04',
        telefono: '9856667788',
        area: AreaPersonalServicios.INTENDENCIA,
        contacto: { nombre: 'Contacto de prueba', telefono: '9850000002', parentesco: 'Esposo/a' },
      },
      {
        nombres: 'Armando José',
        apellidoPaterno: 'Kumul',
        curp: 'KUVA870228HYNMRR11',
        telefono: '9857778899',
        area: AreaPersonalServicios.MANTENIMIENTO,
        contacto: { nombre: 'Concepción Kumul', telefono: '9850011111', parentesco: 'Esposa' },
      },
    ],
  });

  console.log('Seed completo.');
  console.log(`  Sede Mérida:     ${merida.sede.id}`);
  console.log(`  Sede Valladolid: ${valladolid.sede.id}`);
}

main()
  .catch((e) => {
    console.error('Error corriendo el seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
