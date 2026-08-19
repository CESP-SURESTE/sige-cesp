/**
 * Seed de datos DEMO — Fase 1 (Día 4) original, reescrito por completo el
 * 2026-08-16, y de nuevo el 2026-08-19 (extracción de helpers a
 * `seed-helpers.ts` + tercera sede CESP Tizimín).
 *
 * Siembra 3 sedes (Mérida, Valladolid, Tizimín) con un set de datos
 * ficticios completo y con apariencia de producción — 2 carreras, 2
 * salones, 2 grupos, 2 administrativos (uno `ADMIN`, uno `SUPER_ADMIN`), 3
 * maestros, 8 alumnos repartidos entre los 2 grupos y 2 personal de
 * servicios, por sede.
 *
 * Cada persona con cuenta (alumno/maestro/administrativo) tiene una cuenta
 * REAL en Supabase Auth (Admin API, `email_confirm: true`). `Usuario.id` =
 * el mismo UUID que devuelve Supabase Auth.
 *
 * Contraseña compartida por todas las cuentas ficticias: se lee de
 * `process.env.SEED_DEMO_PASSWORD` (`seed-helpers.ts` falla rápido si
 * falta) — NUNCA hardcodeada acá.
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
 *  - `jorge.ek@cesp-valladolid.edu.mx` — mismo shape que `ana.canul`
 *  - `luis.chan@cesp-merida.edu.mx` — ALUMNO, matrícula "MID-2026-0001"
 *  - `mariajose.pech@cesp-valladolid.edu.mx` — ALUMNO, matrícula
 *    "VLD-2026-0001"
 * "CESP Tizimín" y sus 13 personas son datos ficticios reales nuevos desde
 * hoy (2026-08-19) — ningún test e2e existente los verifica todavía, pero
 * siguen la misma convención de ancla (`EMAILS_ANCLA` en `seed-helpers.ts`)
 * por si algún test futuro sí lo hace.
 *
 * Es seguro volver a correr este script: cada persona se busca primero por
 * email en Postgres — si ya existe, no se toca (ni Auth ni DB).
 *
 * Uso: `SEED_DEMO_PASSWORD='...' npx ts-node prisma/seed.ts`
 */
import { AreaPersonalServicios } from '@prisma/client';
import { loadEnv } from '../src/load-env';

loadEnv();

import { prisma, seedSede, type SedeSeedConfig } from './seed-helpers';

const MERIDA: SedeSeedConfig = {
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
};

const VALLADOLID: SedeSeedConfig = {
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
};

/**
 * CESP Tizimín — tercera sede, agregada 2026-08-19 (pedido explícito del
 * usuario). Ubicación de referencia real: la Catedral de los Santos Reyes,
 * el landmark más conocido de Tizimín. Lada 986 (real). Una de las 2
 * carreras base ("Licenciatura en Agronegocios") tiene sabor local —
 * Tizimín es cabecera de una región ganadera/agrícola real.
 */
const TIZIMIN: SedeSeedConfig = {
  nombre: 'CESP Tizimín',
  direccion: 'Calle 51 #200, Centro',
  ubicacionReferencia: 'A una cuadra del parque principal, frente a la Catedral de los Santos Reyes',
  telefono: '9861234567',
  costoRenta: 12000,
  dominio: 'cesp-tizimin.edu.mx',
  carreras: [
    { nombre: 'Licenciatura en Agronegocios', clave: 'LAGRO-TIZ', rvoe: 'RVOE-TIZ-001' },
    { nombre: 'Ingeniería en Sistemas', clave: 'ING-SIS-TIZ', rvoe: 'RVOE-TIZ-002' },
  ],
  salones: ['Aula 301', 'Aula 302'],
  grupos: ['1A', '1B'],
  administrativos: [
    {
      nombres: 'Sofía Nohemí',
      apellidoPaterno: 'Moo',
      apellidoMaterno: 'Chuil',
      curp: 'MOCS870610MYNHXX01',
      correoPersonal: 'sofia.moo.personal@example.com',
      telefono: '9861112233',
      emailInstitucional: 'sofia.moo@cesp-tizimin.edu.mx',
      contacto: { nombre: 'Manuel Chuil', telefono: '9860000000', parentesco: 'Hermano/a' },
    },
    {
      nombres: 'Ricardo Antonio',
      apellidoPaterno: 'Pat',
      apellidoMaterno: 'Cocom',
      curp: 'PACR800215HYNTXX02',
      correoPersonal: 'ricardo.pat.personal@example.com',
      telefono: '9861223344',
      emailInstitucional: 'ricardo.pat@cesp-tizimin.edu.mx',
      contacto: { nombre: 'Beatriz Cocom', telefono: '9861112233', parentesco: 'Esposa' },
    },
  ],
  maestros: [
    {
      nombres: 'Humberto Javier',
      apellidoPaterno: 'Noh',
      apellidoMaterno: 'Balam',
      curp: 'NOBH850304HYNHXX03',
      cedulaProfesional: '1122334',
      correoPersonal: 'humberto.noh.personal@example.com',
      telefono: '9863334455',
      emailInstitucional: 'humberto.noh@cesp-tizimin.edu.mx',
      contacto: { nombre: 'Rosa Balam', telefono: '9860001111', parentesco: 'Madre' },
    },
    {
      nombres: 'Leticia Guadalupe',
      apellidoPaterno: 'Sulub',
      apellidoMaterno: 'Chi',
      curp: 'SUCL880519MYNSXX04',
      cedulaProfesional: '2233445',
      correoPersonal: 'leticia.sulub.personal@example.com',
      telefono: '9864445566',
      emailInstitucional: 'leticia.sulub@cesp-tizimin.edu.mx',
      contacto: { nombre: 'Manuel Sulub', telefono: '9860002222', parentesco: 'Padre' },
    },
    {
      nombres: 'Francisco Javier',
      apellidoPaterno: 'Mex',
      apellidoMaterno: 'Tun',
      curp: 'METF790822HYNXXX05',
      cedulaProfesional: '3344556',
      correoPersonal: 'francisco.mex.personal@example.com',
      telefono: '9865556677',
      emailInstitucional: 'francisco.mex@cesp-tizimin.edu.mx',
      contacto: { nombre: 'Silvia Mex', telefono: '9860003333', parentesco: 'Esposa' },
    },
  ],
  alumnos: [
    {
      nombres: 'Wendy Anahí',
      apellidoPaterno: 'Cituk',
      apellidoMaterno: 'Poot',
      matricula: 'TIZ-2026-0001',
      correoPersonal: 'wendy.cituk.personal@example.com',
      emailInstitucional: 'wendy.cituk@cesp-tizimin.edu.mx',
      fechaNacimiento: new Date('2007-05-18'),
      carreraIndex: 0,
      contacto: { nombre: 'Contacto de prueba', telefono: '9860000001', parentesco: 'Madre' },
    },
    {
      nombres: 'Axel Fernando',
      apellidoPaterno: 'Duarte',
      apellidoMaterno: 'Yah',
      matricula: 'TIZ-2026-0002',
      correoPersonal: 'axel.duarte.personal@example.com',
      emailInstitucional: 'axel.duarte@cesp-tizimin.edu.mx',
      fechaNacimiento: new Date('2006-09-02'),
      carreraIndex: 0,
      contacto: { nombre: 'Norma Yah', telefono: '9860004444', parentesco: 'Madre' },
    },
    {
      nombres: 'Brenda Itzel',
      apellidoPaterno: 'Peraza',
      apellidoMaterno: 'Chable',
      matricula: 'TIZ-2026-0003',
      correoPersonal: 'brenda.peraza.personal@example.com',
      emailInstitucional: 'brenda.peraza@cesp-tizimin.edu.mx',
      fechaNacimiento: new Date('2005-12-14'),
      carreraIndex: 0,
      contacto: { nombre: 'Julia Chable', telefono: '9860005555', parentesco: 'Madre' },
    },
    {
      nombres: 'Iván Alejandro',
      apellidoPaterno: 'Chin',
      apellidoMaterno: 'Xool',
      matricula: 'TIZ-2026-0004',
      correoPersonal: 'ivan.chin.personal@example.com',
      emailInstitucional: 'ivan.chin@cesp-tizimin.edu.mx',
      fechaNacimiento: new Date('2004-07-27'),
      carreraIndex: 0,
      contacto: { nombre: 'Pedro Xool', telefono: '9860006666', parentesco: 'Padre' },
    },
    {
      nombres: 'Melissa Guadalupe',
      apellidoPaterno: 'Tuz',
      apellidoMaterno: 'Batún',
      matricula: 'TIZ-2026-0005',
      correoPersonal: 'melissa.tuz.personal@example.com',
      emailInstitucional: 'melissa.tuz@cesp-tizimin.edu.mx',
      fechaNacimiento: new Date('2006-02-09'),
      carreraIndex: 1,
      contacto: { nombre: 'Elena Batún', telefono: '9860007777', parentesco: 'Madre' },
    },
    {
      nombres: 'Oscar Eduardo',
      apellidoPaterno: 'Nahuat',
      apellidoMaterno: 'Dzib',
      matricula: 'TIZ-2026-0006',
      correoPersonal: 'oscar.nahuat.personal@example.com',
      emailInstitucional: 'oscar.nahuat@cesp-tizimin.edu.mx',
      fechaNacimiento: new Date('2005-10-30'),
      carreraIndex: 1,
      contacto: { nombre: 'Rocío Dzib', telefono: '9860008888', parentesco: 'Madre' },
    },
    {
      nombres: 'Daniela Fernanda',
      apellidoPaterno: 'Ci',
      apellidoMaterno: 'Cen',
      matricula: 'TIZ-2026-0007',
      correoPersonal: 'daniela.ci.personal@example.com',
      emailInstitucional: 'daniela.ci@cesp-tizimin.edu.mx',
      fechaNacimiento: new Date('2006-06-21'),
      carreraIndex: 1,
      contacto: { nombre: 'Alicia Cen', telefono: '9860009999', parentesco: 'Madre' },
    },
    {
      nombres: 'Gerardo Antonio',
      apellidoPaterno: 'Yam',
      apellidoMaterno: 'Kumul',
      matricula: 'TIZ-2026-0008',
      correoPersonal: 'gerardo.yam.personal@example.com',
      emailInstitucional: 'gerardo.yam@cesp-tizimin.edu.mx',
      fechaNacimiento: new Date('2005-01-05'),
      carreraIndex: 1,
      contacto: { nombre: 'Fernando Kumul', telefono: '9860010101', parentesco: 'Padre' },
    },
  ],
  personalServicios: [
    {
      nombres: 'Baltazar',
      apellidoPaterno: 'Cocom',
      curp: 'COXB870303HYNCXX07',
      telefono: '9866667788',
      area: AreaPersonalServicios.INTENDENCIA,
      contacto: { nombre: 'Contacto de prueba', telefono: '9860000002', parentesco: 'Esposo/a' },
    },
    {
      nombres: 'Rosario',
      apellidoPaterno: 'Chuil',
      curp: 'CUXR890812MYNHXX12',
      telefono: '9867778899',
      area: AreaPersonalServicios.SEGURIDAD,
      contacto: { nombre: 'Ismael Dzul', telefono: '9860011111', parentesco: 'Esposo' },
    },
  ],
};

async function main() {
  console.log('Sembrando sede Mérida...');
  const merida = await seedSede(MERIDA);

  console.log('Sembrando sede Valladolid...');
  const valladolid = await seedSede(VALLADOLID);

  console.log('Sembrando sede Tizimín...');
  const tizimin = await seedSede(TIZIMIN);

  console.log('Seed completo.');
  console.log(`  Sede Mérida:     ${merida.sede.id}`);
  console.log(`  Sede Valladolid: ${valladolid.sede.id}`);
  console.log(`  Sede Tizimín:    ${tizimin.sede.id}`);
}

main()
  .catch((e) => {
    console.error('Error corriendo el seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
