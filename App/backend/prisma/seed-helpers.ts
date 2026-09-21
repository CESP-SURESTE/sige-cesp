/**
 * Helpers compartidos de siembra de datos ficticios — extraídos de
 * `seed.ts` (2026-08-19) para que `seed-variado.ts` los reutilice sin
 * duplicar lógica. Comportamiento idéntico al original de `seed.ts` salvo
 * 3 adiciones, todas con default = el valor fijo que `seed.ts` ya usaba
 * (así `seed.ts` no cambia de comportamiento al importar esto):
 *  - `seedAlumno` acepta `estatusAcademico?` (default `INSCRITO`)
 *  - `seedMaestro`/`seedAdministrativo` aceptan `estatus?` (default `ACTIVO`)
 *  - `seedSede` reenvía esos 2 campos y agrega `nivel?`/`modalidad?` por
 *    carrera (default `LICENCIATURA`/`PRESENCIAL`, igual que antes)
 */
import {
  PrismaClient,
  type Carrera,
  type Salon,
  type Grupo,
  type TelefonoEmergenciaSede,
  type Aviso,
  type EventoCalendario,
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
  TipoSangre,
  AlcanceDestino,
  TipoNotificacion,
  CategoriaEvento,
} from '@prisma/client';
import { resolverDestinatarios } from '../src/common/publicacion/alcance-publicacion.util';
import type { PrismaService } from '../src/prisma/prisma.service';

export const prisma = new PrismaClient();

/**
 * Emails institucionales de las 39 personas "ancla" (13 por sede × 3 sedes:
 * Mérida, Valladolid, Tizimín) — datos ficticios reales del proyecto,
 * NUNCA basura de pruebas. `limpiar-datos-prueba.ts` los usa para nunca
 * borrarlos. Lista plana, no calculada dinámicamente — más simple y sin
 * riesgo de desincronizarse si `seed.ts` cambia de forma inesperada.
 */
export const EMAILS_ANCLA = [
  // CESP Mérida
  'ana.canul@cesp-merida.edu.mx',
  'fatima.sosa@cesp-merida.edu.mx',
  'mario.loeza@cesp-merida.edu.mx',
  'gabriela.novelo@cesp-merida.edu.mx',
  'alejandro.vera@cesp-merida.edu.mx',
  'luis.chan@cesp-merida.edu.mx',
  'mariafernanda.poot@cesp-merida.edu.mx',
  'carlos.tec@cesp-merida.edu.mx',
  'ximena.chuc@cesp-merida.edu.mx',
  'andrea.couoh@cesp-merida.edu.mx',
  'diego.cahum@cesp-merida.edu.mx',
  'ricardo.puc@cesp-merida.edu.mx',
  'valeria.uicab@cesp-merida.edu.mx',
  // CESP Valladolid
  'jorge.ek@cesp-valladolid.edu.mx',
  'raul.itza@cesp-valladolid.edu.mx',
  'patricia.herrera@cesp-valladolid.edu.mx',
  'julio.wicab@cesp-valladolid.edu.mx',
  'adriana.yah@cesp-valladolid.edu.mx',
  'mariajose.pech@cesp-valladolid.edu.mx',
  'josemanuel.chable@cesp-valladolid.edu.mx',
  'karla.xool@cesp-valladolid.edu.mx',
  'fernando.baas@cesp-valladolid.edu.mx',
  'emilio.cetz@cesp-valladolid.edu.mx',
  'renata.tzuc@cesp-valladolid.edu.mx',
  'camila.chim@cesp-valladolid.edu.mx',
  'pablo.euan@cesp-valladolid.edu.mx',
  // CESP Tizimín
  'sofia.moo@cesp-tizimin.edu.mx',
  'ricardo.pat@cesp-tizimin.edu.mx',
  'humberto.noh@cesp-tizimin.edu.mx',
  'leticia.sulub@cesp-tizimin.edu.mx',
  'francisco.mex@cesp-tizimin.edu.mx',
  'wendy.cituk@cesp-tizimin.edu.mx',
  'axel.duarte@cesp-tizimin.edu.mx',
  'brenda.peraza@cesp-tizimin.edu.mx',
  'ivan.chin@cesp-tizimin.edu.mx',
  'melissa.tuz@cesp-tizimin.edu.mx',
  'oscar.nahuat@cesp-tizimin.edu.mx',
  'daniela.ci@cesp-tizimin.edu.mx',
  'gerardo.yam@cesp-tizimin.edu.mx',
] as const;

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD;
if (!DEMO_PASSWORD) {
  console.error(
    'Falta SEED_DEMO_PASSWORD en el entorno. Los scripts de siembra crean ' +
      'cuentas reales en Supabase Auth — hace falta una password compartida. ' +
      "Uso: SEED_DEMO_PASSWORD='...' npx ts-node prisma/<script>.ts",
  );
  process.exit(1);
}

type CreateAdminClientFn =
  typeof import('@supabase/server/core').createAdminClient;
let createAdminClientFn: CreateAdminClientFn | undefined;

export async function getAdminClient() {
  if (!createAdminClientFn) {
    const core = await import('@supabase/server/core');
    createAdminClientFn =
      core.createAdminClient as unknown as CreateAdminClientFn;
  }
  return createAdminClientFn();
}

export interface ContactoSeed {
  nombre: string;
  telefono: string;
  parentesco: string;
}

interface InfoMedicaSeed {
  tieneCondicionMedica: false;
  tipoSangre: TipoSangre;
}

const VALORES_TIPO_SANGRE = Object.values(TipoSangre);

/**
 * `tipoSangre` es requerido a nivel de aplicación desde 2026-09-07 (ver
 * CLAUDE.md raíz), pero el seed no lo traía — se deriva de forma
 * determinística de un dato ya único de la persona (email o CURP, según
 * el rol) en vez de pedirlo como parámetro nuevo en cada llamada de
 * `seed.ts`/`seed-variado.ts`: mismo resultado en cada corrida (seed
 * idempotente), variado entre personas (no todas quedan con el mismo
 * tipo de sangre), sin tocar los ~45 objetos de persona ya definidos ahí.
 */
function derivarTipoSangre(claveUnica: string): TipoSangre {
  let hash = 0;
  for (let i = 0; i < claveUnica.length; i++) {
    hash = (hash * 31 + claveUnica.charCodeAt(i)) >>> 0;
  }
  return VALORES_TIPO_SANGRE[hash % VALORES_TIPO_SANGRE.length];
}

function construirInfoMedica(claveUnica: string): InfoMedicaSeed {
  return { tieneCondicionMedica: false, tipoSangre: derivarTipoSangre(claveUnica) };
}

export async function altaUsuarioSeed(
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

export async function seedAlumno(params: {
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
  estatusAcademico?: EstatusAcademico;
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
      estatusAcademico: params.estatusAcademico ?? EstatusAcademico.INSCRITO,
      periodoIngreso: '2026-1',
      cuatrimestreActual: 1,
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
      infoMedica: { create: construirInfoMedica(params.email) },
    },
  });
}

export async function seedMaestro(params: {
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
  estatus?: EstatusEmpleado;
}) {
  const { usuarioId, yaExistia } = await altaUsuarioSeed(
    params.email,
    RolUsuario.MAESTRO,
    params.sedeId,
  );
  if (yaExistia) {
    // El `Usuario` puede existir sin su `PerfilMaestro` si un reseed
    // anterior se truncó a mitad de camino (visto en producción/dev el
    // 2026-09-10: `reset-db.ts` limpia todo, pero un reseed parcial deja
    // `Usuario` creado y el perfil sin crear todavía) — self-healing en
    // vez de asumir "Usuario existe ⇒ ya está completo".
    const existente = await prisma.perfilMaestro.findUnique({
      where: { usuarioId },
    });
    if (existente) return existente;
  }

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
      estatus: params.estatus ?? EstatusEmpleado.ACTIVO,
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
      infoMedica: { create: construirInfoMedica(params.email) },
    },
  });
}

export async function seedAdministrativo(params: {
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
  estatus?: EstatusEmpleado;
}) {
  const { usuarioId, yaExistia } = await altaUsuarioSeed(
    params.email,
    RolUsuario.ADMINISTRATIVO,
    params.sedeId,
  );
  if (yaExistia) {
    // Mismo self-healing que `seedMaestro` — un `Usuario` sin
    // `PerfilAdministrativo` es el síntoma real encontrado el 2026-09-10:
    // los 6 administrativos ancla (2 por sede × 3 sedes) quedaron así tras
    // un reseed parcial, rompiendo `perfil.e2e-spec.ts`/
    // `emergencia.e2e-spec.ts` con 500 en vez de asumir que ya estaban
    // completos.
    const existente = await prisma.perfilAdministrativo.findUnique({
      where: { usuarioId },
    });
    if (existente) return existente;
  }

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
      estatus: params.estatus ?? EstatusEmpleado.ACTIVO,
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
      infoMedica: { create: construirInfoMedica(params.email) },
    },
  });
}

export async function seedPersonalServicios(params: {
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
      infoMedica: { create: construirInfoMedica(params.curp) },
    },
  });
}

export async function seedTelefonoEmergencia(params: {
  sedeId: string;
  etiqueta: string;
  telefono: string;
  orden: number;
}): Promise<TelefonoEmergenciaSede> {
  const existente = await prisma.telefonoEmergenciaSede.findFirst({
    where: { sedeId: params.sedeId, etiqueta: params.etiqueta },
  });
  if (existente) return existente;

  return prisma.telefonoEmergenciaSede.create({
    data: {
      sedeId: params.sedeId,
      etiqueta: params.etiqueta,
      telefono: params.telefono,
      orden: params.orden,
    },
  });
}

/** Deriva un teléfono distinto pero con la misma forma/lada que `base`, sumando `offset` al último dígito — evita inventar números sueltos por sede a mano. */
function variarTelefono(base: string, offset: number): string {
  const numero = Number(base) + offset;
  return String(numero).padStart(base.length, '0');
}

export async function seedAviso(params: {
  sedeId: string;
  autorUsuarioId: string;
  titulo: string;
  cuerpo: string;
  alcanceTipo: AlcanceDestino;
  alcanceId?: string;
}): Promise<Aviso> {
  let aviso = await prisma.aviso.findFirst({
    where: { sedeId: params.sedeId, titulo: params.titulo },
  });

  if (!aviso) {
    aviso = await prisma.aviso.create({
      data: {
        sedeId: params.sedeId,
        autorUsuarioId: params.autorUsuarioId,
        titulo: params.titulo,
        cuerpo: params.cuerpo,
        alcanceTipo: params.alcanceTipo,
        alcanceId: params.alcanceId,
      },
    });
  }

  // Mismo fan-out que `AvisosService.publicar` en producción — reutiliza
  // la función real, no reimplementa la resolución de destinatarios.
  // Se recalcula SIEMPRE (aviso nuevo o ya existente de una corrida previa)
  // y solo se crea `Notificacion` para quien todavía no la tiene — así un
  // reseed incremental (personas agregadas a la config después de la
  // primera corrida) también las notifica, en vez de quedarse mudo para
  // siempre por el `findFirst` de arriba.
  const destinatarios = await resolverDestinatarios(
    prisma as unknown as PrismaService,
    params.sedeId,
    params.alcanceTipo,
    params.alcanceId ?? null,
  );

  const yaNotificados = await prisma.notificacion.findMany({
    where: { referenciaId: aviso.id, tipo: TipoNotificacion.AVISO },
    select: { usuarioId: true },
  });
  const yaNotificadosIds = new Set(yaNotificados.map((n) => n.usuarioId));

  const cuerpoCorto = params.cuerpo.slice(0, 140);
  const receptoresFaltantes = destinatarios.filter(
    (id) => id !== params.autorUsuarioId && !yaNotificadosIds.has(id),
  );
  if (receptoresFaltantes.length > 0) {
    await prisma.notificacion.createMany({
      data: receptoresFaltantes.map((usuarioId) => ({
        usuarioId,
        sedeId: params.sedeId,
        tipo: TipoNotificacion.AVISO,
        referenciaId: aviso.id,
        titulo: aviso.titulo,
        cuerpoCorto,
      })),
    });
  }

  return aviso;
}

export async function seedEvento(params: {
  sedeId: string;
  autorUsuarioId: string;
  titulo: string;
  descripcion?: string;
  fechaInicio: Date;
  horaInicio?: string;
  categoria: CategoriaEvento;
  alcanceTipo: AlcanceDestino;
  alcanceId?: string;
}): Promise<EventoCalendario> {
  const existente = await prisma.eventoCalendario.findFirst({
    where: { sedeId: params.sedeId, titulo: params.titulo },
  });
  if (existente) return existente;

  return prisma.eventoCalendario.create({
    data: {
      sedeId: params.sedeId,
      autorUsuarioId: params.autorUsuarioId,
      titulo: params.titulo,
      descripcion: params.descripcion,
      fechaInicio: params.fechaInicio,
      horaInicio: params.horaInicio,
      categoria: params.categoria,
      alcanceTipo: params.alcanceTipo,
      alcanceId: params.alcanceId,
    },
  });
}

export interface SedeSeedConfig {
  nombre: string;
  direccion: string;
  ubicacionReferencia: string;
  telefono: string;
  costoRenta: number;
  dominio: string;
  carreras: [
    { nombre: string; clave: string; rvoe: string; nivel?: NivelCarrera; modalidad?: ModalidadCarrera },
    { nombre: string; clave: string; rvoe: string; nivel?: NivelCarrera; modalidad?: ModalidadCarrera },
  ];
  salones: [string, string];
  grupos: [string, string];
  administrativos: [
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
    emailInstitucional: string;
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

export async function seedSede(config: SedeSeedConfig) {
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
        nivel: c.nivel ?? NivelCarrera.LICENCIATURA,
        modalidad: c.modalidad ?? ModalidadCarrera.PRESENCIAL,
        estatus: EstatusCarrera.ACTIVA,
        rvoe: c.rvoe,
        descripcion: `Carrera de prueba (${c.nombre}) sembrada para validar el aislamiento multi-sede.`,
      },
    });
    carreras.push(carrera);
  }

  // Materias de ciclo 1 por carrera — Día 33 (Fase 12). 3 por carrera, todas
  // `ciclo: 1` para emparejar con los grupos sembrados (`cicloActual: 1`).
  // Sin `@@unique` en `Materia`, así que se usa findFirst + create (mismo
  // patrón que los grupos más abajo en esta función).
  const NOMBRES_MATERIAS_CICLO_1 = [
    'Fundamentos de Investigación',
    'Matemáticas I',
    'Comunicación Oral y Escrita',
  ];
  for (const carrera of carreras) {
    for (const nombreMateria of NOMBRES_MATERIAS_CICLO_1) {
      const existente = await prisma.materia.findFirst({
        where: { carreraId: carrera.id, nombre: nombreMateria, ciclo: 1 },
      });
      if (!existente) {
        await prisma.materia.create({
          data: { carreraId: carrera.id, nombre: nombreMateria, ciclo: 1 },
        });
      }
    }
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

  // Asignación de maestros a las materias de ciclo 1 de cada grupo — para que
  // la vista de asignaciones del admin y el dashboard del maestro no salgan
  // vacíos. Reparte las materias del grupo entre los maestros de la sede de
  // forma determinística (materia i → maestro i % N). Idempotente por el
  // `@@unique([grupoId, materiaId, maestroId])` (findFirst + create, mismo
  // patrón que grupos/materias más arriba en esta función).
  const maestrosSede = await prisma.perfilMaestro.findMany({
    where: { usuario: { sedeId: sede.id } },
    orderBy: { usuario: { email: 'asc' } },
  });
  if (maestrosSede.length > 0) {
    for (const grupo of grupos) {
      const materiasGrupo = await prisma.materia.findMany({
        where: { carreraId: grupo.carreraId, ciclo: grupo.cicloActual },
        orderBy: { nombre: 'asc' },
      });
      for (let i = 0; i < materiasGrupo.length; i++) {
        const maestro = maestrosSede[i % maestrosSede.length];
        const yaAsignado = await prisma.grupoMateriaMaestro.findFirst({
          where: {
            grupoId: grupo.id,
            materiaId: materiasGrupo[i].id,
            maestroId: maestro.id,
          },
        });
        if (!yaAsignado) {
          await prisma.grupoMateriaMaestro.create({
            data: {
              grupoId: grupo.id,
              materiaId: materiasGrupo[i].id,
              maestroId: maestro.id,
            },
          });
        }
      }
    }
  }

  for (const personal of config.personalServicios) {
    await seedPersonalServicios({ sedeId: sede.id, ...personal });
  }

  // Módulos de actividad — teléfono de emergencia, aviso y evento por
  // sede, para que la app no se sienta vacía al navegarla (2026-09-17).
  // El autor es el administrativo ADMIN de la sede (config.administrativos[0]),
  // ya sembrado arriba en esta misma función.
  const adminAutor = await prisma.usuario.findUniqueOrThrow({
    where: { email: config.administrativos[0].emailInstitucional },
  });

  await seedTelefonoEmergencia({
    sedeId: sede.id,
    etiqueta: 'Dirección',
    telefono: config.telefono,
    orden: 1,
  });
  await seedTelefonoEmergencia({
    sedeId: sede.id,
    etiqueta: 'Enfermería',
    telefono: variarTelefono(config.telefono, 1),
    orden: 2,
  });
  await seedTelefonoEmergencia({
    sedeId: sede.id,
    etiqueta: 'Seguridad',
    telefono: variarTelefono(config.telefono, 2),
    orden: 3,
  });

  await seedAviso({
    sedeId: sede.id,
    autorUsuarioId: adminAutor.id,
    titulo: 'Bienvenida al ciclo escolar 2026',
    cuerpo: `Bienvenidos al nuevo ciclo escolar en ${config.nombre}. Recuerden revisar sus horarios y mantener actualizados sus datos de contacto de emergencia.`,
    alcanceTipo: AlcanceDestino.SEDE,
  });

  await seedEvento({
    sedeId: sede.id,
    autorUsuarioId: adminAutor.id,
    titulo: 'Examen parcial — primer parcial',
    descripcion: 'Primer examen parcial del cuatrimestre para todos los grupos.',
    fechaInicio: new Date('2026-10-15'),
    horaInicio: '09:00',
    categoria: CategoriaEvento.EXAMEN,
    alcanceTipo: AlcanceDestino.SEDE,
  });

  return { sede, carreras, salones, grupos };
}
