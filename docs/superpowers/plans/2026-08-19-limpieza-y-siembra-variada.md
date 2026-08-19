# Limpieza de datos de prueba + siembra variada (3 sedes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Borrar los ~569 registros de prueba acumulados en la base de datos real (Postgres + Supabase Auth) sin tocar los 26 registros ficticios reales de `seed.ts`, y enriquecer la base con una tercera sede (CESP Tizimín) más datos variados (bajas, licencias, despedidos, carreras nuevas) en las 3 sedes.

**Architecture:** 4 scripts nuevos/modificados en `App/backend/prisma/`, ningún cambio de código de producción. `seed-helpers.ts` extrae la lógica compartida de `seed.ts` (sin cambiar su comportamiento) para que `seed-variado.ts` la reutilice. `limpiar-datos-prueba.ts` borra por lista blanca de emails ancla, en el orden que respeta las FK reales de la base (verificadas contra las migraciones, no supuestas), con modo dry-run obligatorio por default.

**Tech Stack:** TypeScript + `ts-node`, Prisma Client, Supabase Admin API (`@supabase/server/core`).

## Global Constraints

- Nunca hardcodear `SEED_DEMO_PASSWORD` — siempre `process.env.SEED_DEMO_PASSWORD`, con guardia que falla rápido si falta (spec, sección 5; mismo criterio ya usado en `seed.ts`).
- `limpiar-datos-prueba.ts` corre en modo dry-run por default; el borrado real requiere el flag explícito `--confirmar` (spec, sección 5).
- Las 39 personas ancla (`EMAILS_ANCLA`) nunca se borran (spec, sección 1).
- Ningún archivo de producción (`src/`) cambia — solo `prisma/*.ts` (spec, "Fuera de alcance").
- `PersonalServicios` no se enriquece, los alumnos nuevos no se asignan a `GrupoAlumno`, `AdminPlataforma` no se toca (spec, decisión 5).

---

### Task 1: Extraer helpers compartidos a `seed-helpers.ts`

**Files:**
- Create: `App/backend/prisma/seed-helpers.ts`
- Modify: `App/backend/prisma/seed.ts` (reemplaza las funciones extraídas por imports; sin cambio de comportamiento)

**Interfaces:**
- Produce (consumido por Task 2, 3 y 4):
  - `export const prisma: PrismaClient`
  - `export const EMAILS_ANCLA: readonly string[]` — 39 emails (13 Mérida + 13 Valladolid + 13 Tizimín, exactos, ver Task 2 para los de Tizimín)
  - `export async function getAdminClient(): Promise<SupabaseAdminClient>` (mismo tipo de retorno que ya tenía en `seed.ts`)
  - `export async function altaUsuarioSeed(email: string, rol: RolUsuario, sedeId: string): Promise<{ usuarioId: string; yaExistia: boolean }>`
  - `export async function seedAlumno(params: { email: string; sedeId: string; nombres: string; apellidoPaterno: string; apellidoMaterno?: string; curp?: string; matricula: string; correoPersonal: string; fechaNacimiento: Date; carreraId: string; contacto: ContactoSeed; estatusAcademico?: EstatusAcademico }): Promise<PerfilAlumno>` — `estatusAcademico` nuevo, default `INSCRITO`
  - `export async function seedMaestro(params: { ...igual que antes...; contacto: ContactoSeed; estatus?: EstatusEmpleado }): Promise<void>` — `estatus` nuevo, default `ACTIVO`
  - `export async function seedAdministrativo(params: { ...igual que antes...; contacto: ContactoSeed; estatus?: EstatusEmpleado }): Promise<void>` — `estatus` nuevo, default `ACTIVO`
  - `export async function seedPersonalServicios(params: {...}): Promise<void>` — sin cambios
  - `export async function seedSede(config: SedeSeedConfig): Promise<{ sede: Sede; carreras: Carrera[]; salones: Salon[]; grupos: Grupo[] }>` — `SedeSeedConfig['alumnos'][number]` gana `estatusAcademico?: EstatusAcademico`; `['maestros'][number]` y `['administrativos'][number]` ganan `estatus?: EstatusEmpleado`. `seedSede` también gana la capacidad de crear carreras con `nivel`/`modalidad` distintos de los defaults (ver abajo) — cada entrada de `config.carreras` gana `nivel?: NivelCarrera` (default `LICENCIATURA`) y `modalidad?: ModalidadCarrera` (default `PRESENCIAL`).
  - `export interface ContactoSeed { nombre: string; telefono: string; parentesco: string }`
  - `export interface SedeSeedConfig { ... }` (mismo shape que hoy en `seed.ts`, con los 3 campos opcionales de arriba agregados)

- [ ] **Step 1: Crear `seed-helpers.ts` con el contenido movido**

Crea `App/backend/prisma/seed-helpers.ts`:

```ts
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
  type PerfilAlumno,
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
}

const INFO_MEDICA_DEFAULT: InfoMedicaSeed = { tieneCondicionMedica: false };

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
      infoMedica: { create: INFO_MEDICA_DEFAULT },
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
      infoMedica: { create: INFO_MEDICA_DEFAULT },
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
      infoMedica: { create: INFO_MEDICA_DEFAULT },
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
```

- [ ] **Step 2: Reescribir `seed.ts` para importar de `seed-helpers.ts`**

Reemplaza TODO el contenido de `App/backend/prisma/seed.ts` (líneas 1-158, hasta el cierre de `seedPersonalServicios`, y la declaración de `SedeSeedConfig`/`seedSede`, líneas 345-557) por:

```ts
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

main()
  .catch((e) => {
    console.error('Error corriendo el seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 3: Verificar tipos**

Run: `cd App/backend && npx tsc --noEmit`
Expected: sin salida, exit 0. (Prisma ya conoce `EstatusAcademico`/`EstatusEmpleado`/`NivelCarrera`/`ModalidadCarrera` — no requiere migración, son enums ya existentes.)

- [ ] **Step 4: Commit**

```bash
git add App/backend/prisma/seed-helpers.ts App/backend/prisma/seed.ts
git commit -m "refactor(backend): extrae helpers de seed.ts a seed-helpers.ts, agrega sede CESP Tizimin

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Script de siembra variada — `prisma/seed-variado.ts`

**Files:**
- Create: `App/backend/prisma/seed-variado.ts`

**Interfaces:**
- Consumes: todo lo producido en Task 1 (`prisma`, `seedSede` no se usa aquí directamente — se usan `seedAlumno`/`seedMaestro`/`seedAdministrativo`/`altaUsuarioSeed` de `seed-helpers.ts`, más `NivelCarrera`/`ModalidadCarrera`/`EstatusAcademico`/`EstatusEmpleado`/`PuestoAdministrativo`/`NivelPermiso` de `@prisma/client`).
- Produces: nada — script hoja, nadie más lo importa.

- [ ] **Step 1: Crear `seed-variado.ts`**

```ts
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
 * minimizar coincidencias de nombre completo; `indiceGlobal` (0..21)
 * recorre las 22 personas nuevas de esa sede.
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
    await seedAlumno({
      email: `${p.nombres.toLowerCase().split(' ')[0]}.${p.apellidoPaterno.toLowerCase()}${i}@${config.dominio}`,
      sedeId: sede.id,
      nombres: p.nombres,
      apellidoPaterno: p.apellidoPaterno,
      apellidoMaterno: p.apellidoMaterno,
      curp: p.curp,
      matricula,
      correoPersonal: `${p.nombres.toLowerCase().split(' ')[0]}.${p.apellidoPaterno.toLowerCase()}${i}.personal@example.com`,
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
    const indiceGlobal = 100 + i; // offset distinto al de alumnos, mismo sedeIndice
    const genero: 'H' | 'M' = i % 2 === 0 ? 'H' : 'M';
    const p = generarPersona(sedeIndice, indiceGlobal, genero);
    await seedMaestro({
      email: `${p.nombres.toLowerCase().split(' ')[0]}.${p.apellidoPaterno.toLowerCase()}${i}@${config.dominio}`,
      sedeId: sede.id,
      nombres: p.nombres,
      apellidoPaterno: p.apellidoPaterno,
      apellidoMaterno: p.apellidoMaterno,
      curp: p.curp,
      cedulaProfesional: `${1000000 + sedeIndice * 10000 + i}`,
      correoPersonal: `${p.nombres.toLowerCase().split(' ')[0]}.${p.apellidoPaterno.toLowerCase()}${i}.personal@example.com`,
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
    await seedAdministrativo({
      email: `${p.nombres.toLowerCase().split(' ')[0]}.${p.apellidoPaterno.toLowerCase()}${i}@${config.dominio}`,
      sedeId: sede.id,
      nombres: p.nombres,
      apellidoPaterno: p.apellidoPaterno,
      apellidoMaterno: p.apellidoMaterno,
      curp: p.curp,
      correoPersonal: `${p.nombres.toLowerCase().split(' ')[0]}.${p.apellidoPaterno.toLowerCase()}${i}.personal@example.com`,
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
```

- [ ] **Step 2: Verificar tipos**

Run: `cd App/backend && npx tsc --noEmit`
Expected: sin salida, exit 0.

- [ ] **Step 3: Commit**

```bash
git add App/backend/prisma/seed-variado.ts
git commit -m "feat(backend): script de siembra variada (bajas, licencias, carreras nuevas) x3 sedes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Script de limpieza — `prisma/limpiar-datos-prueba.ts`

**Files:**
- Create: `App/backend/prisma/limpiar-datos-prueba.ts`

**Interfaces:**
- Consumes: `prisma`, `EMAILS_ANCLA`, `getAdminClient` de `seed-helpers.ts` (Task 1).
- Produces: nada — script hoja.

- [ ] **Step 1: Crear `limpiar-datos-prueba.ts`**

```ts
/**
 * Borra todo `Usuario` con rol ALUMNO/MAESTRO/ADMINISTRATIVO cuyo email NO
 * esté en `EMAILS_ANCLA` (las 39 personas ficticias reales del proyecto,
 * ver `seed-helpers.ts`) — pensado para limpiar la basura que deja la
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

const CONFIRMAR = process.argv.includes('--confirmar');
const TAMANO_LOTE = 20;
const PAUSA_ENTRE_LOTES_MS = 500;

async function main() {
  const candidatos = await prisma.usuario.findMany({
    where: {
      rol: { in: [RolUsuario.ALUMNO, RolUsuario.MAESTRO, RolUsuario.ADMINISTRATIVO] },
      email: { notIn: [...EMAILS_ANCLA] },
    },
    select: { id: true, email: true, rol: true },
  });

  const porRol = {
    ALUMNO: candidatos.filter((c) => c.rol === RolUsuario.ALUMNO).length,
    MAESTRO: candidatos.filter((c) => c.rol === RolUsuario.MAESTRO).length,
    ADMINISTRATIVO: candidatos.filter((c) => c.rol === RolUsuario.ADMINISTRATIVO).length,
  };

  console.log(`Modo: ${CONFIRMAR ? 'BORRADO REAL' : 'DRY-RUN (nada se borra)'}`);
  console.log(`Anclas protegidas: ${EMAILS_ANCLA.length}`);
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
```

- [ ] **Step 2: Verificar tipos**

Run: `cd App/backend && npx tsc --noEmit`
Expected: sin salida, exit 0.

- [ ] **Step 3: Commit**

```bash
git add App/backend/prisma/limpiar-datos-prueba.ts
git commit -m "feat(backend): script de limpieza de datos de prueba (dry-run por default)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Ejecución real (orden fijo, con gate de confirmación)

**Files:** ninguno — esta tarea solo corre los 3 scripts ya creados, en orden, contra la base real.

- [ ] **Step 1: Sembrar `seed.ts` (Mérida + Valladolid + Tizimín, idempotente)**

Run: `cd App/backend && SEED_DEMO_PASSWORD='<password temporal ya usada en esta sesión>' npx ts-node prisma/seed.ts`
Expected: 3 líneas "Sembrando sede...", termina con "Seed completo." y los 3 UUIDs de sede. Mérida/Valladolid no cambian (ya existían); Tizimín se crea nueva.

- [ ] **Step 2: Sembrar `seed-variado.ts`**

Run: `cd App/backend && SEED_DEMO_PASSWORD='<misma password>' npx ts-node prisma/seed-variado.ts`
Expected: 3 líneas de resumen (una por sede), termina con "Siembra variada completa."

- [ ] **Step 3: Dry-run de limpieza — mostrar al usuario antes de borrar**

Run: `cd App/backend && npx ts-node prisma/limpiar-datos-prueba.ts`
Expected: imprime "Modo: DRY-RUN", el conteo real de candidatos a borrar (debería rondar los ~569 originales, sin contar las 66 personas nuevas de `seed-variado.ts` ni las 39 anclas). **Mostrar este resultado al usuario y esperar su confirmación explícita en el chat antes del Step 4** — no basta con que el plan esté aprobado.

- [ ] **Step 4: Borrado real (solo tras confirmación explícita del usuario)**

Run: `cd App/backend && npx ts-node prisma/limpiar-datos-prueba.ts --confirmar`
Expected: mismos conteos que el dry-run, más "usuarios (Postgres) borrados: N" y "Cuentas de Supabase Auth borradas: N" (N debería ser igual o muy cercano — algunos fallos de Auth son aceptables si el log los explica, ej. una cuenta que ya no existía en Auth por alguna razón previa).

- [ ] **Step 5: Verificación final — contar la base resultante**

Run un script de solo lectura (igual al usado durante el brainstorming) o consulta directa:
```bash
cd App/backend && npx ts-node -e "
import { prisma } from './prisma/seed-helpers';
(async () => {
  console.log('alumnos:', await prisma.perfilAlumno.count());
  console.log('maestros:', await prisma.perfilMaestro.count());
  console.log('administrativos:', await prisma.perfilAdministrativo.count());
  console.log('sedes:', await prisma.sede.count());
  console.log('carreras:', await prisma.carrera.count());
  await prisma.\$disconnect();
})();
"
```
Expected (13 anclas por sede = 2 admin + 3 maestros + 8 alumnos, × 3 sedes = 39 anclas totales; + 22 variados por sede = 12 alumnos + 4 maestros + 4 administrativos, × 3 sedes = 66 variados):
- alumnos: 24 anclas + 36 variados = **60**
- maestros: 9 anclas + 12 variados = **21**
- administrativos: 6 anclas + 12 variados = **18**
- sedes: **3**
- carreras: 6 anclas (2×3) + 6 variadas (2×3) = **12**

- [ ] **Step 6: Commit (si el resumen de la corrida se documenta en ESTADO.md — opcional, ver Task 5)**

No hay archivos de código que commitear en esta tarea — es solo ejecución. Si se decide documentar el resultado, va en Task 5.

---

### Task 5: Documentar hallazgo de causa raíz (e2e ensuciando la DB) en `ESTADO.md`

**Files:**
- Modify: `App/backend/../documentacion_de_agentes/ESTADO.md` (agregar entrada al final del historial, sin tocar entradas existentes)

- [ ] **Step 1: Agregar entrada de mantenimiento**

Agrega al final de `documentacion_de_agentes/ESTADO.md` (antes de la sección "Requiere acción del usuario", mismo patrón que el resto del archivo) una entrada nueva que documente: la limpieza corrida (conteos reales tras el Step 5 de Task 4), la sede Tizimín agregada, y la causa raíz parked (la suite e2e del backend corre contra la misma base de datos de desarrollo y no limpia después de cada corrida — pendiente sin ticket formal, decisión del usuario 2026-08-19).

- [ ] **Step 2: Commit**

```bash
git add documentacion_de_agentes/ESTADO.md
git commit -m "docs: documenta limpieza de datos de prueba + sede Tizimin + causa raiz de e2e parked

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
