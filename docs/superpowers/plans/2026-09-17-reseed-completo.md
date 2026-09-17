# Reseed completo de datos ficticios — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar el seed de datos ficticios de sige-cesp completo y coherente (tipo de sangre en info médica, teléfonos de emergencia, un aviso y un evento por sede), corregir la lista de tablas desactualizada de `reset-db.ts`, y ejecutar un reset+reseed real contra la DB de dev para eliminar las 38 cuentas `ADMINISTRATIVO` sin `PerfilAdministrativo` encontradas al probar el feature de reseteo de contraseña.

**Architecture:** El seed existente (`prisma/seed-helpers.ts` → `seedSede()`) ya construye sedes/carreras/salones/grupos/materias/matriculación/asignaciones de forma idempotente — no se reescribe. Se extiende quirúrgicamente: (1) `tipoSangre` se deriva de forma determinística (hash simple del email/CURP → uno de los 8 valores del enum) dentro de los helpers existentes, sin tocar `seed.ts`/`seed-variado.ts`; (2) 3 helpers nuevos (`seedTelefonoEmergencia`, `seedAviso`, `seedEvento`) se agregan a `seed-helpers.ts` y se invocan automáticamente al final de `seedSede()`, usando datos que la propia config de la sede ya trae (nombre, teléfono, el administrativo `ADMIN` como autor) — tampoco requiere tocar `seed.ts`. `seedAviso` reutiliza `resolverDestinatarios` real del backend para el fan-out a `Notificacion`, igual que hace `AvisosService.publicar` en producción.

**Tech Stack:** TypeScript + `ts-node` (scripts de Prisma) · Prisma 6.x · Postgres (Supabase).

## Global Constraints

- Spec completo: `docs/superpowers/specs/2026-09-17-reseed-completo-design.md`.
- `AdminPlataforma` NO se toca — se excluye explícitamente de la lista de tablas que `reset-db.ts` trunca.
- `MallaCurricular` no se siembra (sin PDF de prueba) — fuera de alcance.
- `PermisoAdministrativo`/`Seccion` no se siembran — sin código de aplicación que los consuma todavía.
- `RegistroAuditoria` nunca se siembra (regla 5 de CLAUDE.md raíz — es rastro de acciones reales).
- Todo helper nuevo debe ser idempotente (mismo patrón `findFirst` + `create` que ya usan `materias`/`grupos`/`grupoMateriaMaestro` en este archivo) — correr el seed dos veces seguidas no debe duplicar nada ni tronar.
- Sin librerías nuevas.
- `reset-db.ts` sigue exigiendo el flag `--confirmar` — no se relaja esa salvaguarda.

---

## Task 1: Actualizar `reset-db.ts` — lista de tablas completa

**Files:**
- Modify: `App/backend/prisma/reset-db.ts:1-25` (comentario de cabecera) y `App/backend/prisma/reset-db.ts:86-112` (array `TABLAS`)

**Interfaces:**
- Consumes: nada de otra task.
- Produces: nada que otra task consuma directamente — es un script standalone que Task 3 ejecuta.

- [ ] **Step 1: Actualizar el array `TABLAS`**

En `App/backend/prisma/reset-db.ts`, reemplazar el array completo (líneas 86-112):

```ts
const TABLAS = [
  'sede_responsables',
  'admin_plataforma',
  'mallas_curriculares',
  'grupo_alumnos',
  'grupos',
  'materias',
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
```

por:

```ts
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
```

Verificar contando: la nueva lista tiene 31 tablas (las 32 que trae `schema.prisma` hoy, menos `admin_plataforma`). Confirmar con:

```bash
cd App/backend
grep -c '@@map' prisma/schema.prisma
```

Debe imprimir `32`.

- [ ] **Step 2: Actualizar el comentario de cabecera**

En el mismo archivo, línea 2, cambiar:

```ts
 * Reset TOTAL de la base — borra TODO (Supabase Auth + las 24 tablas de
```

por:

```ts
 * Reset TOTAL de la base — borra TODO (Supabase Auth + todas las tablas de
 * negocio de Postgres, EXCEPTO `admin_plataforma`, que es una identidad
 * separada de las sedes y no se toca) — para dejar la DB lista para un
```

Y ajustar el resto de esa oración para que no quede duplicado "para dejar la DB lista para un reseed completo con datos ficticios..." (el texto original seguía en la misma frase — leer las líneas 1-5 completas antes de editar para no dejar la oración rota).

- [ ] **Step 3: Verificar que el archivo quedó bien formado**

Este cambio es solo datos (un array de strings) — no hace falta compilar por separado. La verificación real de tipos para todo `prisma/*.ts` (incluido este archivo) ocurre junto con la de `seed-helpers.ts` en el Step 8 de la Task 2 (`npx tsc --noEmit` desde `App/backend`, usa el `tsconfig.json` raíz que SÍ incluye `prisma/` — a diferencia de `tsconfig.build.json`, que lo excluye). Por ahora, confirmar a simple vista que el array `TABLAS` quedó con comas y comillas correctas (31 strings) y que el comentario de cabecera no quedó con una oración rota.

- [ ] **Step 4: Commit**

```bash
cd App/backend
git add prisma/reset-db.ts
git commit -m "$(cat <<'EOF'
fix(seed): reset-db.ts incluye todas las tablas actuales del schema

La lista TABLAS quedó desactualizada según fueron agregándose features
(grupos/materias, calendario, avisos, emergencia) — un reset real dejaba
7 tablas huérfanas sin truncar. admin_plataforma se excluye a propósito,
es una identidad separada de las sedes.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Extender `seed-helpers.ts` — tipoSangre, teléfonos, avisos, eventos

**Files:**
- Modify: `App/backend/prisma/seed-helpers.ts`

**Interfaces:**
- Consumes: `resolverDestinatarios(prisma: PrismaService, sedeId: string, alcanceTipo: AlcanceDestino, alcanceId: string | null): Promise<string[]>` de `App/backend/src/common/publicacion/alcance-publicacion.util.ts` (ya existe, sin cambios — la usa `AvisosService.publicar` en producción).
- Produces: `seedTelefonoEmergencia(params): Promise<TelefonoEmergenciaSede>`, `seedAviso(params): Promise<Aviso>`, `seedEvento(params): Promise<EventoCalendario>` — nuevas, exportadas desde `seed-helpers.ts`. Ningún otro archivo las consume en este plan (Task 2 las invoca internamente desde `seedSede`).

- [ ] **Step 1: Agregar los imports nuevos**

En `App/backend/prisma/seed-helpers.ts`, en el bloque de import de `@prisma/client` (inicio del archivo), agregar a la lista existente: `TipoSangre`, `AlcanceDestino`, `TipoNotificacion`, `CategoriaEvento`, `type TelefonoEmergenciaSede`, `type Aviso`, `type EventoCalendario`.

El bloque completo queda:

```ts
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
```

Justo debajo, agregar el import de la función real del backend que se reutiliza:

```ts
import { resolverDestinatarios } from '../src/common/publicacion/alcance-publicacion.util';
import type { PrismaService } from '../src/prisma/prisma.service';
```

- [ ] **Step 2: Reemplazar `INFO_MEDICA_DEFAULT` por derivación determinística de `tipoSangre`**

Buscar (cerca de la línea 112-116):

```ts
interface InfoMedicaSeed {
  tieneCondicionMedica: false;
}

const INFO_MEDICA_DEFAULT: InfoMedicaSeed = { tieneCondicionMedica: false };
```

Reemplazar por:

```ts
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
```

- [ ] **Step 3: Usar `construirInfoMedica` en los 4 helpers de persona**

Reemplazar las 4 ocurrencias de `infoMedica: { create: INFO_MEDICA_DEFAULT }` en este archivo:

En `seedAlumno` y `seedMaestro` y `seedAdministrativo` (los 3 tienen `params.email`), cambiar:
```ts
      infoMedica: { create: INFO_MEDICA_DEFAULT },
```
por:
```ts
      infoMedica: { create: construirInfoMedica(params.email) },
```

En `seedPersonalServicios` (no tiene `email`, usa `curp`), cambiar la misma línea por:
```ts
      infoMedica: { create: construirInfoMedica(params.curp) },
```

(Son 4 ediciones puntuales — el resto de cada función no cambia. Buscar `INFO_MEDICA_DEFAULT` en el archivo debe dar 0 resultados al terminar.)

- [ ] **Step 4: Agregar `seedTelefonoEmergencia`**

Al final del archivo (después de `seedPersonalServicios`, antes de `seedSede`), agregar:

```ts
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
```

- [ ] **Step 5: Agregar `seedAviso`**

Justo debajo, agregar:

```ts
export async function seedAviso(params: {
  sedeId: string;
  autorUsuarioId: string;
  titulo: string;
  cuerpo: string;
  alcanceTipo: AlcanceDestino;
  alcanceId?: string;
}): Promise<Aviso> {
  const existente = await prisma.aviso.findFirst({
    where: { sedeId: params.sedeId, titulo: params.titulo },
  });
  if (existente) return existente;

  const aviso = await prisma.aviso.create({
    data: {
      sedeId: params.sedeId,
      autorUsuarioId: params.autorUsuarioId,
      titulo: params.titulo,
      cuerpo: params.cuerpo,
      alcanceTipo: params.alcanceTipo,
      alcanceId: params.alcanceId,
    },
  });

  // Mismo fan-out que `AvisosService.publicar` en producción — reutiliza
  // la función real, no reimplementa la resolución de destinatarios.
  const destinatarios = await resolverDestinatarios(
    prisma as unknown as PrismaService,
    params.sedeId,
    params.alcanceTipo,
    params.alcanceId ?? null,
  );

  const cuerpoCorto = params.cuerpo.slice(0, 140);
  const receptores = destinatarios.filter((id) => id !== params.autorUsuarioId);
  if (receptores.length > 0) {
    await prisma.notificacion.createMany({
      data: receptores.map((usuarioId) => ({
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
```

- [ ] **Step 6: Agregar `seedEvento`**

Justo debajo, agregar:

```ts
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
```

- [ ] **Step 7: Invocar los 3 helpers nuevos al final de `seedSede`**

En `seedSede`, justo antes de `return { sede, carreras, salones, grupos };` (última línea de la función), agregar:

```ts
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
```

- [ ] **Step 8: Verificar que compila**

```bash
cd App/backend
npx tsc --noEmit
```

Expected: sin errores nuevos atribuibles a `seed-helpers.ts` (puede haber warnings preexistentes ajenos — solo importa que no aparezcan errores en este archivo ni en `seed.ts`/`seed-variado.ts`, que consumen `seedSede` sin cambios de firma).

- [ ] **Step 9: Commit**

```bash
cd App/backend
git add prisma/seed-helpers.ts
git commit -m "$(cat <<'EOF'
feat(seed): tipoSangre determinístico + teléfonos, aviso y evento por sede

tipoSangre se deriva de un hash del email/CURP en vez de pedirse como
parámetro nuevo en cada persona de seed.ts — mismo resultado en cada
corrida, variado entre personas. seedAviso reutiliza resolverDestinatarios
real del backend para el fan-out a Notificacion, igual que
AvisosService.publicar en producción.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Ejecutar el reset + reseed contra la DB de dev y verificar

**Files:**
- No modifica código — ejecuta los scripts de Task 1/2 contra la DB real de dev y verifica el resultado con una consulta de solo lectura.

**Interfaces:**
- Consumes: `reset-db.ts` (Task 1), `seed.ts`/`seed-helpers.ts` (Task 2).
- Produces: nada — es la task de verificación final del plan.

- [ ] **Step 1: Confirmar que el backend NO está corriendo contra la misma DB durante el reset**

```bash
netstat -ano | grep ":3001" | grep LISTENING
```

No es estrictamente necesario detenerlo (el reset/seed usa su propia conexión Prisma), pero si hay requests en curso durante el `TRUNCATE`, pueden fallar con errores de FK — no reintentar automáticamente si el backend loguea un error puntual durante la ventana del reset, es esperado.

- [ ] **Step 2: Ejecutar el reset (DESTRUCTIVO — pide confirmación explícita del usuario antes de correr este paso si no se dio ya en esta sesión)**

```bash
cd App/backend
npx ts-node prisma/reset-db.ts --confirmar
```

Expected: imprime cuántas cuentas de Supabase Auth borró y `Postgres: 31 tablas truncadas.` seguido de `Reset completo. La DB está vacía.`

- [ ] **Step 3: Ejecutar el reseed completo**

```bash
cd App/backend
SEED_DEMO_PASSWORD='DemoSige2026!Temp' npx prisma db seed
```

Expected: termina con `Seed completo.` y los 3 IDs de sede impresos, sin excepciones.

- [ ] **Step 4: Verificar integridad — 0 personas sin su perfil, tipoSangre poblado, módulos de actividad presentes**

Crear un script temporal `App/backend/verificar-seed.tmp.js` (fuera de git, se borra al final de este step):

```js
const { PrismaClient, RolUsuario } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const [admins, alumnos, maestros] = await Promise.all([
    prisma.usuario.findMany({
      where: { rol: RolUsuario.ADMINISTRATIVO },
      select: { email: true, perfilAdministrativo: { select: { id: true, tipoSangre: false } } },
    }),
    prisma.usuario.findMany({
      where: { rol: RolUsuario.ALUMNO },
      select: { email: true, perfilAlumno: { select: { id: true } } },
    }),
    prisma.usuario.findMany({
      where: { rol: RolUsuario.MAESTRO },
      select: { email: true, perfilMaestro: { select: { id: true } } },
    }),
  ]);

  const adminsRotos = admins.filter((a) => !a.perfilAdministrativo);
  const alumnosRotos = alumnos.filter((a) => !a.perfilAlumno);
  const maestrosRotos = maestros.filter((a) => !a.perfilMaestro);

  console.log('ADMINISTRATIVO sin perfil:', adminsRotos.length, adminsRotos.map((a) => a.email));
  console.log('ALUMNO sin perfil:', alumnosRotos.length, alumnosRotos.map((a) => a.email));
  console.log('MAESTRO sin perfil:', maestrosRotos.length, maestrosRotos.map((a) => a.email));

  const sinTipoSangre = await prisma.infoMedicaAlumno.count({ where: { tipoSangre: null } });
  console.log('InfoMedicaAlumno sin tipoSangre:', sinTipoSangre);

  const [sedes, telefonos, avisos, eventos, notificaciones] = await Promise.all([
    prisma.sede.count(),
    prisma.telefonoEmergenciaSede.count(),
    prisma.aviso.count(),
    prisma.eventoCalendario.count(),
    prisma.notificacion.count(),
  ]);
  console.log('Sedes:', sedes, '| Teléfonos emergencia:', telefonos, '| Avisos:', avisos, '| Eventos:', eventos, '| Notificaciones:', notificaciones);

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
```

Correr:

```bash
cd App/backend
node verificar-seed.tmp.js
rm verificar-seed.tmp.js
```

Expected: `ADMINISTRATIVO sin perfil: 0`, `ALUMNO sin perfil: 0`, `MAESTRO sin perfil: 0`, `InfoMedicaAlumno sin tipoSangre: 0`, `Sedes: 3`, `Teléfonos emergencia: 9`, `Avisos: 3`, `Eventos: 3`, `Notificaciones` > 0 (una por cada usuario activo de cada sede, menos el autor).

Si algún conteo de "sin perfil" es mayor a 0, DETENERSE — no continuar a Step 5, hay un bug real en Task 2 que investigar antes de dar el plan por cerrado.

- [ ] **Step 5: Verificar idempotencia — correr el seed una segunda vez sin resetear**

```bash
cd App/backend
SEED_DEMO_PASSWORD='DemoSige2026!Temp' npx prisma db seed
```

Expected: termina limpio, sin excepciones (`Seed completo.`). Repetir el Step 4 (sin borrar el script hasta confirmar) — los conteos de `Sedes`/`Teléfonos emergencia`/`Avisos`/`Eventos` deben ser IDÉNTICOS a la primera corrida (3 / 9 / 3 / 3) — si crecieron, algún helper nuevo no es idempotente y hay que corregirlo antes de cerrar la task.

- [ ] **Step 6: Confirmar con el usuario que puede volver a loguearse y probar**

Reportar al usuario: reset+reseed completo, cuenta `ricardo.pat@cesp-tizimin.edu.mx` (y el resto de administrativos) ya con perfil completo — puede volver a entrar a `/admin` con las cuentas del seed (password = el valor usado en `SEED_DEMO_PASSWORD` de este run) y probar de nuevo el botón de reseteo de contraseña sin el error de `GET /perfil`.
