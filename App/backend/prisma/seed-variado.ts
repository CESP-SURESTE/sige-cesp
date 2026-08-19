/**
 * Siembra variada — agrega, por cada una de las 3 sedes ya sembradas por
 * `seed.ts`, 2 carreras nuevas (con nivel/modalidad distintos a las 2
 * originales, que son 100% Licenciatura/Presencial) y personas con estatus
 * variado (bajas, licencias, egresados) — hoy `seed.ts` solo produce
 * personas `INSCRITO`/`ACTIVO`.
 *
 * REQUIERE que `seed.ts` ya se haya corrido antes (necesita las 3 sedes y
 * sus 2 carreras base ya creadas) — falla explícito si una sede no existe,
 * no la crea él mismo (responsabilidad separada).
 *
 * Nombres/apellidos se generan de una lista fija de nombres y apellidos
 * yucatecos (no se reinventa un generador de datos falsos genérico) —
 * combinación determinística por índice, así 2 corridas del script
 * producen exactamente las mismas 66 personas (idempotente por email, como
 * el resto de los scripts de este directorio).
 *
 * Uso: `SEED_DEMO_PASSWORD='...' npx ts-node prisma/seed-variado.ts`
 */
import {
  EstatusAcademico,
  EstatusEmpleado,
  ModalidadCarrera,
  NivelCarrera,
  NivelPermiso,
  PuestoAdministrativo,
} from '@prisma/client';
import { loadEnv } from '../src/load-env';

loadEnv();

import {
  prisma,
  seedAlumno,
  seedAdministrativo,
  seedMaestro,
} from './seed-helpers';

const NOMBRES_M = [
  'Emiliano', 'Rodrigo', 'Santiago', 'Mauricio', 'Joel', 'Iker',
  'Bruno', 'Tadeo', 'Ian', 'Damián', 'Kevin', 'Uriel',
];
const NOMBRES_F = [
  'Regina', 'Ximena', 'Paola', 'Yolanda', 'Perla', 'Alondra',
  'Jimena', 'Marisol', 'Alejandra', 'Cecilia', 'Nayeli', 'Abigail',
];
const APELLIDOS = [
  'Canul', 'Koyoc', 'Chan', 'Poot', 'Uc', 'Dzul', 'Balam', 'Chi',
  'Tun', 'Cauich', 'Euan', 'Pech', 'Ake', 'Chuc', 'Xool', 'Yah',
  'Chable', 'Kumul', 'Batun', 'Baas', 'Ku', 'Puc', 'Tzuc', 'Cob',
  'Mex', 'Noh', 'Moo', 'Pat', 'Chin', 'Tuz',
];
const PARENTESCOS = ['Madre', 'Padre', 'Hermano/a', 'Esposo/a', 'Tío/a'];
const NOMBRES_CONTACTO = [
  'Rosa', 'Manuel', 'Beatriz', 'Antonio', 'Silvia', 'Ricardo',
  'Norma', 'Julio', 'Concepción', 'Armando',
];

function quitarAcentos(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** CURP con formato plausible (no algoritmo oficial — datos ficticios). */
function generarCurp(
  nombres: string,
  apellidoPaterno: string,
  apellidoMaterno: string,
  sexo: 'H' | 'M',
  anioNacimiento: number,
  indice: number,
): string {
  const primeraLetra = (s: string) => quitarAcentos(s).charAt(0).toUpperCase();
  const primeraVocalInterna = (s: string) => {
    const limpio = quitarAcentos(s).toUpperCase();
    const match = limpio.slice(1).match(/[AEIOU]/);
    return match ? match[0] : 'X';
  };
  const yy = String(anioNacimiento % 100).padStart(2, '0');
  const mm = String(((indice * 7) % 12) + 1).padStart(2, '0');
  const dd = String(((indice * 3) % 28) + 1).padStart(2, '0');
  const consonantes = quitarAcentos(apellidoPaterno)
    .toUpperCase()
    .replace(/[AEIOU]/g, '')
    .padEnd(4, 'X')
    .slice(1, 4);
  return `${primeraLetra(apellidoPaterno)}${primeraVocalInterna(apellidoPaterno)}${primeraLetra(apellidoMaterno)}${primeraLetra(nombres)}${yy}${mm}${dd}${sexo}YN${consonantes}${String(indice).padStart(2, '0')}`;
}

interface PersonaGenerada {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  curp: string;
  telefono: string;
  contacto: { nombre: string; telefono: string; parentesco: string };
  anioNacimiento: number;
}

/**
 * `sedeIndice` (0/1/2) separa el pool de nombres entre sedes para
 * minimizar coincidencias de nombre completo; `indiceGlobal` recorre las
 * personas nuevas de esa sede (offsets distintos por rol para no repetir
 * combinaciones entre alumnos/maestros/administrativos de la misma sede).
 */
function generarPersona(
  sedeIndice: number,
  indiceGlobal: number,
  genero: 'H' | 'M',
): PersonaGenerada {
  const offset = sedeIndice * 37;
  const nombrePool = genero === 'H' ? NOMBRES_M : NOMBRES_F;
  const nombres = nombrePool[(indiceGlobal + offset) % nombrePool.length];
  const apellidoPaterno = APELLIDOS[(indiceGlobal + offset) % APELLIDOS.length];
  const apellidoMaterno = APELLIDOS[(indiceGlobal + offset + 11) % APELLIDOS.length];
  const anioNacimiento = 2004 + (indiceGlobal % 6);
  const curp = generarCurp(nombres, apellidoPaterno, apellidoMaterno, genero, anioNacimiento, indiceGlobal + offset);
  const telefono = `999${String(1000000 + sedeIndice * 100000 + indiceGlobal * 137).slice(-7)}`;
  const contactoNombre = NOMBRES_CONTACTO[(indiceGlobal + offset) % NOMBRES_CONTACTO.length];
  const contacto = {
    nombre: `${contactoNombre} ${APELLIDOS[(indiceGlobal + offset + 5) % APELLIDOS.length]}`,
    telefono: `999${String(2000000 + sedeIndice * 100000 + indiceGlobal * 149).slice(-7)}`,
    parentesco: PARENTESCOS[indiceGlobal % PARENTESCOS.length],
  };
  return { nombres, apellidoPaterno, apellidoMaterno, curp, telefono, contacto, anioNacimiento };
}

interface SedeVariadoConfig {
  nombreSede: string;
  dominio: string;
  matriculaPrefijo: string;
  carreraNuevaTecnico: { nombre: string; clave: string; rvoe: string };
  carreraNuevaMaestria: { nombre: string; clave: string; rvoe: string };
  clavesCarrerasExistentes: [string, string];
}

const SEDES: SedeVariadoConfig[] = [
  {
    nombreSede: 'CESP Mérida',
    dominio: 'cesp-merida.edu.mx',
    matriculaPrefijo: 'MID',
    carreraNuevaTecnico: { nombre: 'Técnico en Gastronomía', clave: 'TEC-GAST-MID', rvoe: 'RVOE-MID-003' },
    carreraNuevaMaestria: { nombre: 'Maestría en Educación', clave: 'MAE-EDU-MID', rvoe: 'RVOE-MID-004' },
    clavesCarrerasExistentes: ['LAE-MID', 'ING-SIS-MID'],
  },
  {
    nombreSede: 'CESP Valladolid',
    dominio: 'cesp-valladolid.edu.mx',
    matriculaPrefijo: 'VLD',
    carreraNuevaTecnico: { nombre: 'Técnico en Turismo', clave: 'TEC-TUR-VLD', rvoe: 'RVOE-VLD-003' },
    carreraNuevaMaestria: { nombre: 'Maestría en Administración', clave: 'MAE-ADM-VLD', rvoe: 'RVOE-VLD-004' },
    clavesCarrerasExistentes: ['LC-VLD', 'ING-IND-VLD'],
  },
  {
    nombreSede: 'CESP Tizimín',
    dominio: 'cesp-tizimin.edu.mx',
    matriculaPrefijo: 'TIZ',
    carreraNuevaTecnico: { nombre: 'Técnico en Producción Agropecuaria', clave: 'TEC-AGRO-TIZ', rvoe: 'RVOE-TIZ-003' },
    carreraNuevaMaestria: { nombre: 'Maestría en Gestión Educativa', clave: 'MAE-GEST-TIZ', rvoe: 'RVOE-TIZ-004' },
    clavesCarrerasExistentes: ['LAGRO-TIZ', 'ING-SIS-TIZ'],
  },
];

const PUESTOS_VARIADOS = [
  PuestoAdministrativo.AUXILIAR,
  PuestoAdministrativo.RECEPCION,
  PuestoAdministrativo.COORDINADOR_ACADEMICO,
  PuestoAdministrativo.AUXILIAR,
];

async function sembrarVariadoSede(config: SedeVariadoConfig, sedeIndice: number) {
  const sede = await prisma.sede.findUniqueOrThrow({
    where: { nombre: config.nombreSede },
  });

  const carreraTecnico = await prisma.carrera.upsert({
    where: { clave: config.carreraNuevaTecnico.clave },
    update: {},
    create: {
      nombre: config.carreraNuevaTecnico.nombre,
      clave: config.carreraNuevaTecnico.clave,
      sedeId: sede.id,
      duracion: 4,
      nivel: NivelCarrera.TECNICO,
      modalidad: ModalidadCarrera.EN_LINEA,
      estatus: 'ACTIVA',
      rvoe: config.carreraNuevaTecnico.rvoe,
      descripcion: `Carrera de prueba (${config.carreraNuevaTecnico.nombre}) sembrada para dar variedad de nivel/modalidad.`,
    },
  });

  const carreraMaestria = await prisma.carrera.upsert({
    where: { clave: config.carreraNuevaMaestria.clave },
    update: {},
    create: {
      nombre: config.carreraNuevaMaestria.nombre,
      clave: config.carreraNuevaMaestria.clave,
      sedeId: sede.id,
      duracion: 4,
      nivel: NivelCarrera.MAESTRIA,
      modalidad: ModalidadCarrera.SEMIPRESENCIAL,
      estatus: 'ACTIVA',
      rvoe: config.carreraNuevaMaestria.rvoe,
      descripcion: `Carrera de prueba (${config.carreraNuevaMaestria.nombre}) sembrada para dar variedad de nivel/modalidad.`,
    },
  });

  const carrerasExistentes = await Promise.all(
    config.clavesCarrerasExistentes.map((clave) =>
      prisma.carrera.findUniqueOrThrow({ where: { clave } }),
    ),
  );
  const todasLasCarreras = [...carrerasExistentes, carreraTecnico, carreraMaestria];

  // 12 alumnos: 6 INSCRITO, 2 BAJA_TEMPORAL, 2 BAJA_DEFINITIVA, 2 EGRESADO
  const distribucionAlumnos: EstatusAcademico[] = [
    EstatusAcademico.INSCRITO, EstatusAcademico.INSCRITO, EstatusAcademico.INSCRITO,
    EstatusAcademico.INSCRITO, EstatusAcademico.INSCRITO, EstatusAcademico.INSCRITO,
    EstatusAcademico.BAJA_TEMPORAL, EstatusAcademico.BAJA_TEMPORAL,
    EstatusAcademico.BAJA_DEFINITIVA, EstatusAcademico.BAJA_DEFINITIVA,
    EstatusAcademico.EGRESADO, EstatusAcademico.EGRESADO,
  ];
  for (let i = 0; i < distribucionAlumnos.length; i++) {
    const genero: 'H' | 'M' = i % 2 === 0 ? 'M' : 'H';
    const p = generarPersona(sedeIndice, i, genero);
    const matricula = `${config.matriculaPrefijo}-2026-${String(9 + i).padStart(4, '0')}`;
    const nombreEmail = quitarAcentos(p.nombres.toLowerCase().split(' ')[0]);
    const apellidoEmail = quitarAcentos(p.apellidoPaterno.toLowerCase());
    await seedAlumno({
      email: `${nombreEmail}.${apellidoEmail}${i}@${config.dominio}`,
      sedeId: sede.id,
      nombres: p.nombres,
      apellidoPaterno: p.apellidoPaterno,
      apellidoMaterno: p.apellidoMaterno,
      curp: p.curp,
      matricula,
      correoPersonal: `${nombreEmail}.${apellidoEmail}${i}.personal@example.com`,
      fechaNacimiento: new Date(p.anioNacimiento, i % 12, ((i * 3) % 27) + 1),
      carreraId: todasLasCarreras[i % todasLasCarreras.length].id,
      contacto: p.contacto,
      estatusAcademico: distribucionAlumnos[i],
    });
  }

  // 4 maestros: 2 ACTIVO, 1 BAJA, 1 LICENCIA
  const distribucionMaestros: EstatusEmpleado[] = [
    EstatusEmpleado.ACTIVO, EstatusEmpleado.ACTIVO,
    EstatusEmpleado.BAJA, EstatusEmpleado.LICENCIA,
  ];
  for (let i = 0; i < distribucionMaestros.length; i++) {
    const indiceGlobal = 100 + i;
    const genero: 'H' | 'M' = i % 2 === 0 ? 'H' : 'M';
    const p = generarPersona(sedeIndice, indiceGlobal, genero);
    const nombreEmail = quitarAcentos(p.nombres.toLowerCase().split(' ')[0]);
    const apellidoEmail = quitarAcentos(p.apellidoPaterno.toLowerCase());
    await seedMaestro({
      email: `${nombreEmail}.${apellidoEmail}${i}@${config.dominio}`,
      sedeId: sede.id,
      nombres: p.nombres,
      apellidoPaterno: p.apellidoPaterno,
      apellidoMaterno: p.apellidoMaterno,
      curp: p.curp,
      cedulaProfesional: `${1000000 + sedeIndice * 10000 + i}`,
      correoPersonal: `${nombreEmail}.${apellidoEmail}${i}.personal@example.com`,
      telefono: p.telefono,
      contacto: p.contacto,
      estatus: distribucionMaestros[i],
    });
  }

  // 4 administrativos: 2 ACTIVO, 1 BAJA (despedido), 1 LICENCIA (vacaciones)
  const distribucionAdmins: EstatusEmpleado[] = [
    EstatusEmpleado.ACTIVO, EstatusEmpleado.ACTIVO,
    EstatusEmpleado.BAJA, EstatusEmpleado.LICENCIA,
  ];
  for (let i = 0; i < distribucionAdmins.length; i++) {
    const indiceGlobal = 200 + i;
    const genero: 'H' | 'M' = i % 2 === 0 ? 'M' : 'H';
    const p = generarPersona(sedeIndice, indiceGlobal, genero);
    const nombreEmail = quitarAcentos(p.nombres.toLowerCase().split(' ')[0]);
    const apellidoEmail = quitarAcentos(p.apellidoPaterno.toLowerCase());
    await seedAdministrativo({
      email: `${nombreEmail}.${apellidoEmail}${i}@${config.dominio}`,
      sedeId: sede.id,
      nombres: p.nombres,
      apellidoPaterno: p.apellidoPaterno,
      apellidoMaterno: p.apellidoMaterno,
      curp: p.curp,
      correoPersonal: `${nombreEmail}.${apellidoEmail}${i}.personal@example.com`,
      telefono: p.telefono,
      puesto: PUESTOS_VARIADOS[i],
      nivelPermiso: NivelPermiso.AUXILIAR,
      contacto: p.contacto,
      estatus: distribucionAdmins[i],
    });
  }

  console.log(`  ${config.nombreSede}: +2 carreras, +12 alumnos, +4 maestros, +4 administrativos`);
}

async function main() {
  for (let i = 0; i < SEDES.length; i++) {
    console.log(`Sembrando variedad en ${SEDES[i].nombreSede}...`);
    await sembrarVariadoSede(SEDES[i], i);
  }
  console.log('Siembra variada completa.');
}

main()
  .catch((e) => {
    console.error('Error corriendo la siembra variada:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
