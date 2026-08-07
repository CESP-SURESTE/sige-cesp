/**
 * Seed de prueba — Fase 1 (Multi-sede), Día 4 del roadmap.
 *
 * Siembra 2 sedes (Mérida y Valladolid) con datos dummy razonables en cada
 * una — carreras, salón, personal de servicios, un administrativo y un
 * alumno (con sus contactos e info médica), un grupo y su matrícula — para
 * poder probar de punta a punta el aislamiento por sede (RLS + Guard de
 * NestJS) con datos reales en ambas sedes.
 *
 * ⚠️ EXCEPCIÓN DOCUMENTADA A LA REGLA 5.9 DE CLAUDE.md
 * ----------------------------------------------------
 * En producción, `Usuario.id` SIEMPRE debe ser el mismo UUID que devuelve la
 * Admin API de Supabase Auth al crear la cuenta (alta transaccional real,
 * ver Fase 4 del roadmap: Supabase Auth → Usuario → Perfil, con rollback si
 * falla cualquier paso). Ese flujo todavía no existe — Fase 2 (Auth) y
 * Fase 4 (alta de personas) no están construidas todavía.
 *
 * Este script es SOLO para sembrar datos de prueba y validar el modelo
 * multi-sede (Día 4) y las RLS policies (Día 5) de forma independiente del
 * login real. Genera UUIDs aleatorios para `Usuario.id` porque no hay
 * cuentas reales en Supabase Auth todavía. Ninguna fila de este seed debe
 * usarse jamás como cuenta real de acceso — no tienen contraseña ni existen
 * en Supabase Auth, por lo que de cualquier forma no podrían iniciar sesión.
 *
 * Es seguro volver a correr este script: usa upsert / findFirst+create por
 * cada entidad para no duplicar datos en corridas repetidas.
 *
 * Uso: `pnpm exec prisma db seed` (o automático tras `prisma migrate dev`).
 */

import {
  PrismaClient,
  type Carrera,
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
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

interface CarreraSeed {
  nombre: string;
  clave: string;
  rvoe: string;
}

interface SedeSeedConfig {
  nombre: string;
  direccion: string;
  ubicacionReferencia: string;
  telefono: string;
  costoRenta?: number;
  carreras: CarreraSeed[];
  salon: { nombre: string; capacidad: number };
  grupoNombre: string;
  admin: {
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno?: string;
    curp: string;
    correoPersonal: string;
    telefono: string;
    emailInstitucional: string;
  };
  alumno: {
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno?: string;
    matricula: string;
    correoPersonal: string;
    emailInstitucional: string;
    fechaNacimiento: Date;
  };
  personalServicios: {
    nombres: string;
    apellidoPaterno: string;
    curp: string;
    telefono: string;
  };
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

  const salon = await prisma.salon.upsert({
    where: { sedeId_nombre: { sedeId: sede.id, nombre: config.salon.nombre } },
    update: {},
    create: { sedeId: sede.id, nombre: config.salon.nombre, capacidad: config.salon.capacidad },
  });

  // --- Administrativo dummy ---
  const adminUsuario = await prisma.usuario.upsert({
    where: { email: config.admin.emailInstitucional },
    update: {},
    create: {
      id: randomUUID(),
      email: config.admin.emailInstitucional,
      rol: RolUsuario.ADMINISTRATIVO,
      sedeId: sede.id,
    },
  });

  const adminExistente = await prisma.perfilAdministrativo.findUnique({
    where: { usuarioId: adminUsuario.id },
  });
  if (!adminExistente) {
    await prisma.perfilAdministrativo.create({
      data: {
        usuarioId: adminUsuario.id,
        nombres: config.admin.nombres,
        apellidoPaterno: config.admin.apellidoPaterno,
        apellidoMaterno: config.admin.apellidoMaterno,
        curp: config.admin.curp,
        correoPersonal: config.admin.correoPersonal,
        telefono: config.admin.telefono,
        fechaContratacion: new Date('2024-01-15'),
        estatus: EstatusEmpleado.ACTIVO,
        puesto: PuestoAdministrativo.COORDINADOR_ADMINISTRATIVO,
        nivelPermiso: NivelPermiso.ADMIN,
        contactos: {
          create: [
            {
              nombre: 'Contacto de prueba',
              telefono: '9990000000',
              parentesco: 'Hermano/a',
              orden: 1,
            },
          ],
        },
        infoMedica: { create: { tieneCondicionMedica: false } },
      },
    });
  }

  // --- Alumno dummy ---
  const alumnoUsuario = await prisma.usuario.upsert({
    where: { email: config.alumno.emailInstitucional },
    update: {},
    create: {
      id: randomUUID(),
      email: config.alumno.emailInstitucional,
      rol: RolUsuario.ALUMNO,
      sedeId: sede.id,
    },
  });

  let alumnoPerfil = await prisma.perfilAlumno.findUnique({
    where: { matricula: config.alumno.matricula },
  });
  if (!alumnoPerfil) {
    alumnoPerfil = await prisma.perfilAlumno.create({
      data: {
        usuarioId: alumnoUsuario.id,
        nombres: config.alumno.nombres,
        apellidoPaterno: config.alumno.apellidoPaterno,
        apellidoMaterno: config.alumno.apellidoMaterno,
        fechaNacimiento: config.alumno.fechaNacimiento,
        matricula: config.alumno.matricula,
        correoPersonal: config.alumno.correoPersonal,
        carreraId: carreras[0].id,
        estatusAcademico: EstatusAcademico.INSCRITO,
        periodoIngreso: '2026-1',
        semestreActual: 1,
        contactos: {
          create: [
            {
              tipo: TipoContacto.EMERGENCIA,
              nombre: 'Contacto de prueba',
              telefono: '9990000001',
              parentesco: 'Madre',
              orden: 1,
            },
          ],
        },
        infoMedica: { create: { tieneCondicionMedica: false } },
      },
    });
  }

  // --- Grupo + matrícula del alumno dummy ---
  let grupo = await prisma.grupo.findFirst({
    where: { sedeId: sede.id, nombre: config.grupoNombre },
  });
  if (!grupo) {
    grupo = await prisma.grupo.create({
      data: {
        sedeId: sede.id,
        carreraId: carreras[0].id,
        salonId: salon.id,
        nombre: config.grupoNombre,
        anioInicio: 2026,
        cicloActual: 1,
        capacidad: 30,
      },
    });
  }

  await prisma.grupoAlumno.upsert({
    where: { grupoId_alumnoId: { grupoId: grupo.id, alumnoId: alumnoPerfil.id } },
    update: {},
    create: { grupoId: grupo.id, alumnoId: alumnoPerfil.id },
  });

  // --- Personal de servicios dummy (sin cuenta, ver regla 5.8) ---
  const personalExistente = await prisma.personalServicios.findFirst({
    where: { sedeId: sede.id, curp: config.personalServicios.curp },
  });
  if (!personalExistente) {
    await prisma.personalServicios.create({
      data: {
        sedeId: sede.id,
        nombres: config.personalServicios.nombres,
        apellidoPaterno: config.personalServicios.apellidoPaterno,
        curp: config.personalServicios.curp,
        area: AreaPersonalServicios.INTENDENCIA,
        telefono: config.personalServicios.telefono,
        fechaContratacion: new Date('2023-06-01'),
        estatus: EstatusEmpleado.ACTIVO,
        contactos: {
          create: [
            {
              nombre: 'Contacto de prueba',
              telefono: '9990000002',
              parentesco: 'Esposo/a',
              orden: 1,
            },
          ],
        },
        infoMedica: { create: { tieneCondicionMedica: false } },
      },
    });
  }

  return { sede, carreras, salon, grupo };
}

async function main() {
  console.log('Sembrando sede Mérida...');
  const merida = await seedSede({
    nombre: 'CESP Mérida',
    direccion: 'Calle 60 #123, Centro',
    ubicacionReferencia: 'Frente al parque de Santa Lucía',
    telefono: '9999123456',
    costoRenta: 25000,
    carreras: [
      { nombre: 'Licenciatura en Administración', clave: 'LAE-MID', rvoe: 'RVOE-MID-001' },
      { nombre: 'Ingeniería en Sistemas', clave: 'ING-SIS-MID', rvoe: 'RVOE-MID-002' },
    ],
    salon: { nombre: 'Aula 101', capacidad: 35 },
    grupoNombre: '1A',
    admin: {
      nombres: 'Ana María',
      apellidoPaterno: 'Canul',
      apellidoMaterno: 'Poot',
      curp: 'CAPA900101MYNNXX01',
      correoPersonal: 'ana.canul.personal@example.com',
      telefono: '9991112233',
      emailInstitucional: 'ana.canul@cesp-merida.edu.mx',
    },
    alumno: {
      nombres: 'Luis Fernando',
      apellidoPaterno: 'Chan',
      apellidoMaterno: 'Uc',
      matricula: 'MID-2026-0001',
      correoPersonal: 'luis.chan.personal@example.com',
      emailInstitucional: 'luis.chan@cesp-merida.edu.mx',
      fechaNacimiento: new Date('2007-03-12'),
    },
    personalServicios: {
      nombres: 'Roberto',
      apellidoPaterno: 'Dzul',
      curp: 'DURO850505HYNZBB02',
      telefono: '9994445566',
    },
  });

  console.log('Sembrando sede Valladolid...');
  const valladolid = await seedSede({
    nombre: 'CESP Valladolid',
    direccion: 'Calle 41 #456, Centro',
    ubicacionReferencia: 'A dos cuadras del Convento de Sisal',
    telefono: '9859876543',
    costoRenta: 15000,
    carreras: [
      { nombre: 'Licenciatura en Contaduría', clave: 'LC-VLD', rvoe: 'RVOE-VLD-001' },
      { nombre: 'Ingeniería Industrial', clave: 'ING-IND-VLD', rvoe: 'RVOE-VLD-002' },
    ],
    salon: { nombre: 'Aula 201', capacidad: 30 },
    grupoNombre: '1A',
    admin: {
      nombres: 'Jorge Alberto',
      apellidoPaterno: 'Ek',
      apellidoMaterno: 'Balam',
      curp: 'EKBJ880202HYNKLL03',
      correoPersonal: 'jorge.ek.personal@example.com',
      telefono: '9852223344',
      emailInstitucional: 'jorge.ek@cesp-valladolid.edu.mx',
    },
    alumno: {
      nombres: 'María José',
      apellidoPaterno: 'Pech',
      apellidoMaterno: 'Tun',
      matricula: 'VLD-2026-0001',
      correoPersonal: 'mariajose.pech.personal@example.com',
      emailInstitucional: 'mariajose.pech@cesp-valladolid.edu.mx',
      fechaNacimiento: new Date('2008-07-20'),
    },
    personalServicios: {
      nombres: 'Silvia',
      apellidoPaterno: 'Cauich',
      curp: 'CAXS900909MYNCXX04',
      telefono: '9856667788',
    },
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
