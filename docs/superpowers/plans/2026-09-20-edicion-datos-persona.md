# Edición de datos de persona (alumno/maestro/administrativo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que un `ADMINISTRATIVO` corrija los datos no-sensibles (en realidad: todo el perfil salvo lo que ya tiene su propio flujo) de un alumno/maestro/administrativo de su sede, vía un lápiz en cada fila de los 3 listados que abre un modal de edición.

**Architecture:** Dos endpoints nuevos en `PersonasController` (`GET /personas/:id` para precargar, `PATCH /personas/:id` para guardar), mismo patrón genérico que `PATCH /personas/:id/estatus` (un solo endpoint valida contra el `rol` real de la persona encontrada). El `PATCH` reutiliza tal cual los DTOs de perfil de `crear-persona.dto.ts` (`PerfilAlumnoDto`/`PerfilMaestroDto`/`PerfilAdministrativoDto`, que YA incluyen `contactos`/`infoMedica` anidados) — sin inventar un shape nuevo. En frontend, 3 modales nuevos (uno por rol) reusan directo los fieldsets ya construidos para el alta (`components/admin/ui/persona-alta/`).

**Tech Stack:** NestJS + Prisma (backend), Next.js + React Hook Form + Zod + React Query (frontend) — mismo stack que el resto del proyecto, sin dependencias nuevas.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-20-edicion-datos-persona-design.md` — leer primero.
- **Corrección respecto al spec:** la sección "Contrato de API" del spec describe `contactos`/`infoMedica` como siblings de `perfilX` a nivel raíz del body de `PATCH /personas/:id`. Este plan los deja ANIDADOS dentro de `perfilAlumno`/`perfilMaestro`/`perfilAdministrativo` — igual que `POST /personas` — porque permite reusar tal cual los DTOs (`PerfilAlumnoDto`/`PerfilMaestroDto`/`PerfilAdministrativoDto`) y los fieldsets de frontend sin inventar un shape nuevo. Mismo contenido, mejor implementación — no es una reducción de alcance.
- `GET /personas/:id` y `PATCH /personas/:id` van en `App/backend/src/personas/personas.controller.ts`, DESPUÉS de `resumen` (ruta literal) y ANTES de `:id/estatus` (Nest ya resuelve rutas literales antes que `:id` por orden de declaración — `resumen` ya está declarado antes).
- `sedeId` SIEMPRE de `@SedeActual()`, `actorUsuarioId` SIEMPRE de `@ActorUsuarioId()` — nunca del body (regla 2/5 de `CLAUDE.md` raíz).
- Todo catch debe loguear con `console.error` antes de responder (regla 12).
- `RegistroAuditoria` se crea SOLO dentro de la transacción del `PATCH`, nunca vía otro endpoint (regla 5).
- Migraciones: NINGUNA — `AccionAuditoria.CAMBIO_PERMISO` ya existe en el enum (`schema.prisma:79`), sin usar hasta ahora.
- Comandos de verificación en este proyecto (Windows/PowerShell, pero también válidos desde Git Bash):
  - Backend build: `cd App/backend && npx nest build`
  - Backend e2e (UN spec): `cd App/backend && node scripts/run-e2e.js <nombre-parcial-del-archivo>`
  - Backend e2e (suite completa, lenta): `cd App/backend && node scripts/run-e2e.js`
  - Frontend typecheck: `cd App/frontend && npx tsc --noEmit`
  - Frontend lint: `cd App/frontend && npm run lint`
  - Frontend build: `cd App/frontend && npm run build`

---

### Task 1: Backend — `GET /personas/:id` (precarga del modal)

**Files:**
- Modify: `App/backend/src/personas/personas.service.ts`
- Modify: `App/backend/src/personas/personas.controller.ts`
- Test: `App/backend/test/personas-editar.e2e-spec.ts` (crear)

**Interfaces:**
- Produces: `PersonasService.obtenerParaEditar(id: string, sedeId: string): Promise<PersonaParaEditar>` — usado por Task 2 (no, Task 2 no lo consume) y por el controller. `PersonaParaEditar` (y sus sub-tipos `PersonaEditableAlumno`/`PersonaEditableMaestro`/`PersonaEditableAdministrativo`/`PersonaEditableContacto`/`PersonaEditableInfoMedica`) se exportan desde `personas.service.ts` — Task 3 (frontend) los espeja a mano en `lib/api/personas.ts`, mismo criterio que el resto de ese archivo.

- [ ] **Step 1: Agregar las interfaces de resultado en `personas.service.ts`**

Abrir `App/backend/src/personas/personas.service.ts`. Agregar `TipoSangre` al import existente de `@prisma/client` (línea ~11-21, ya importa `AccionAuditoria, EstatusAcademico, EstatusEmpleado, MotivoBaja, NivelPermiso, Prisma, RolUsuario, TipoContratacion, TipoLicencia` — agregar `TipoSangre` a esa misma lista).

Justo debajo de la interface `ResumenPorSedeResult` (busca `/** \`GET /personas/resumen\` — dashboard de admin por sede. */\nexport interface ResumenPorSedeResult {`), agregar:

```typescript
/** `GET /personas/:id` (precarga del modal de edición) — contacto sin `id`
 * ni `orden`: el frontend no necesita ninguno de los 2 para prellenar el
 * form (el guardado reemplaza todo el array, ver `editarPersona`). `tipo`
 * solo viene poblado para contactos de ALUMNO. */
export interface PersonaEditableContacto {
  nombre: string;
  telefono: string;
  correo: string | null;
  parentesco: string;
  tipo?: 'TUTOR' | 'EMERGENCIA';
}

/** `GET /personas/:id` — idéntico para los 3 roles. `tipoSangre` puede ser
 * `null` en perfiles de altas anteriores al 2026-09-07 (columna nullable,
 * sin backfill — ver nota de `InfoMedicaDto` en `crear-persona.dto.ts`). */
export interface PersonaEditableInfoMedica {
  tieneCondicionMedica: boolean;
  tipoSangre: TipoSangre | null;
  padecimiento: string | null;
  medicamentos: string | null;
  alergias: string | null;
  tratamientoAdicional: string | null;
}

export interface PersonaEditableAlumno {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  curp: string | null;
  /** ISO `YYYY-MM-DD`. */
  fechaNacimiento: string;
  correoPersonal: string;
  carreraId: string;
  periodoIngreso: string;
  cuatrimestreActual: number;
  telefono: string | null;
}

export interface PersonaEditableMaestro {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  curp: string;
  cedulaProfesional: string | null;
  correoPersonal: string;
  telefono: string;
  /** ISO `YYYY-MM-DD`. */
  fechaContratacion: string;
  tipoContratacion: TipoContratacion | null;
  diasTemporal: number | null;
  /** ISO `YYYY-MM-DD`, o `null`. */
  contratoFechaInicio: string | null;
  /** ISO `YYYY-MM-DD`, o `null`. */
  contratoFechaFin: string | null;
}

export interface PersonaEditableAdministrativo {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  curp: string;
  correoPersonal: string;
  telefono: string;
  /** ISO `YYYY-MM-DD`. */
  fechaContratacion: string;
  puesto: string;
  nivelPermiso: NivelPermiso;
}

/**
 * `GET /personas/:id` — precarga del modal de edición (feature "Edición de
 * datos de persona", 2026-09-20). Exactamente uno de `perfilAlumno`/
 * `perfilMaestro`/`perfilAdministrativo` viene presente, según `rol`.
 */
export interface PersonaParaEditar {
  rol: RolUsuario;
  codigoExterno: string | null;
  perfilAlumno?: PersonaEditableAlumno;
  perfilMaestro?: PersonaEditableMaestro;
  perfilAdministrativo?: PersonaEditableAdministrativo;
  contactos: PersonaEditableContacto[];
  infoMedica: PersonaEditableInfoMedica;
}
```

- [ ] **Step 2: Agregar `obtenerParaEditar` y su helper `mapInfoMedicaEditable` a `PersonasService`**

Agregar como método de la clase `PersonasService`, después de `resolverFotosPerfil` (el último método privado antes de `listarPorSedeYRol` — busca el cierre de `resolverFotosPerfil` y pega esto justo después, antes de `async listarPorSedeYRol`):

```typescript
  /**
   * Espejo de `datosInfoMedica` (inverso): normaliza la fila de
   * `InfoMedica*` (o `null`, perfiles sin fila — no debería pasar en la
   * práctica desde que `tipoSangre` es requerido en el alta, pero
   * defensivo por si acaso) al shape `PersonaEditableInfoMedica`.
   */
  private mapInfoMedicaEditable(
    infoMedica: {
      tieneCondicionMedica: boolean;
      tipoSangre: TipoSangre | null;
      padecimiento: string | null;
      medicamentos: string | null;
      alergias: string | null;
      tratamientoAdicional: string | null;
    } | null,
  ): PersonaEditableInfoMedica {
    if (!infoMedica) {
      return {
        tieneCondicionMedica: false,
        tipoSangre: null,
        padecimiento: null,
        medicamentos: null,
        alergias: null,
        tratamientoAdicional: null,
      };
    }
    return infoMedica;
  }

  /**
   * `GET /personas/:id` — precarga del modal de edición (feature "Edición
   * de datos de persona", 2026-09-20). Sin auditoría (decisión explícita
   * del spec, sección "Contrato de API" — un `ADMINISTRATIVO` abriendo el
   * modal de edición de alguien de su sede no es un evento que valga la
   * pena rastrear, a diferencia de `GET /emergencia/expediente/...`).
   */
  async obtenerParaEditar(
    id: string,
    sedeId: string,
  ): Promise<PersonaParaEditar> {
    const CONTACTO_SELECT = {
      nombre: true,
      telefono: true,
      correo: true,
      parentesco: true,
    } as const;
    const INFO_MEDICA_SELECT = {
      tieneCondicionMedica: true,
      tipoSangre: true,
      padecimiento: true,
      medicamentos: true,
      alergias: true,
      tratamientoAdicional: true,
    } as const;

    const usuario = await this.prisma.usuario.findFirst({
      where: { id, sedeId },
      select: {
        rol: true,
        codigoExterno: true,
        perfilAlumno: {
          select: {
            nombres: true,
            apellidoPaterno: true,
            apellidoMaterno: true,
            curp: true,
            fechaNacimiento: true,
            correoPersonal: true,
            carreraId: true,
            periodoIngreso: true,
            cuatrimestreActual: true,
            telefono: true,
            contactos: {
              orderBy: { orden: 'asc' },
              select: { ...CONTACTO_SELECT, tipo: true },
            },
            infoMedica: { select: INFO_MEDICA_SELECT },
          },
        },
        perfilMaestro: {
          select: {
            nombres: true,
            apellidoPaterno: true,
            apellidoMaterno: true,
            curp: true,
            cedulaProfesional: true,
            correoPersonal: true,
            telefono: true,
            fechaContratacion: true,
            tipoContratacion: true,
            diasTemporal: true,
            contratoFechaInicio: true,
            contratoFechaFin: true,
            contactos: { orderBy: { orden: 'asc' }, select: CONTACTO_SELECT },
            infoMedica: { select: INFO_MEDICA_SELECT },
          },
        },
        perfilAdministrativo: {
          select: {
            nombres: true,
            apellidoPaterno: true,
            apellidoMaterno: true,
            curp: true,
            correoPersonal: true,
            telefono: true,
            fechaContratacion: true,
            puesto: true,
            nivelPermiso: true,
            contactos: { orderBy: { orden: 'asc' }, select: CONTACTO_SELECT },
            infoMedica: { select: INFO_MEDICA_SELECT },
          },
        },
      },
    });

    if (!usuario) {
      throw new NotFoundException({
        error: 'Persona no encontrada en tu sede',
        code: 'NOT_FOUND',
      });
    }

    if (usuario.rol === RolUsuario.ALUMNO && usuario.perfilAlumno) {
      const perfil = usuario.perfilAlumno;
      return {
        rol: usuario.rol,
        codigoExterno: usuario.codigoExterno,
        perfilAlumno: {
          nombres: perfil.nombres,
          apellidoPaterno: perfil.apellidoPaterno,
          apellidoMaterno: perfil.apellidoMaterno,
          curp: perfil.curp,
          fechaNacimiento: perfil.fechaNacimiento.toISOString().slice(0, 10),
          correoPersonal: perfil.correoPersonal,
          carreraId: perfil.carreraId,
          periodoIngreso: perfil.periodoIngreso,
          cuatrimestreActual: perfil.cuatrimestreActual,
          telefono: perfil.telefono,
        },
        contactos: perfil.contactos,
        infoMedica: this.mapInfoMedicaEditable(perfil.infoMedica),
      };
    }

    if (usuario.rol === RolUsuario.MAESTRO && usuario.perfilMaestro) {
      const perfil = usuario.perfilMaestro;
      return {
        rol: usuario.rol,
        codigoExterno: usuario.codigoExterno,
        perfilMaestro: {
          nombres: perfil.nombres,
          apellidoPaterno: perfil.apellidoPaterno,
          apellidoMaterno: perfil.apellidoMaterno,
          curp: perfil.curp,
          cedulaProfesional: perfil.cedulaProfesional,
          correoPersonal: perfil.correoPersonal,
          telefono: perfil.telefono,
          fechaContratacion: perfil.fechaContratacion
            .toISOString()
            .slice(0, 10),
          tipoContratacion: perfil.tipoContratacion,
          diasTemporal: perfil.diasTemporal,
          contratoFechaInicio: perfil.contratoFechaInicio
            ? perfil.contratoFechaInicio.toISOString().slice(0, 10)
            : null,
          contratoFechaFin: perfil.contratoFechaFin
            ? perfil.contratoFechaFin.toISOString().slice(0, 10)
            : null,
        },
        contactos: perfil.contactos,
        infoMedica: this.mapInfoMedicaEditable(perfil.infoMedica),
      };
    }

    if (
      usuario.rol === RolUsuario.ADMINISTRATIVO &&
      usuario.perfilAdministrativo
    ) {
      const perfil = usuario.perfilAdministrativo;
      return {
        rol: usuario.rol,
        codigoExterno: usuario.codigoExterno,
        perfilAdministrativo: {
          nombres: perfil.nombres,
          apellidoPaterno: perfil.apellidoPaterno,
          apellidoMaterno: perfil.apellidoMaterno,
          curp: perfil.curp,
          correoPersonal: perfil.correoPersonal,
          telefono: perfil.telefono,
          fechaContratacion: perfil.fechaContratacion
            .toISOString()
            .slice(0, 10),
          puesto: perfil.puesto,
          nivelPermiso: perfil.nivelPermiso,
        },
        contactos: perfil.contactos,
        infoMedica: this.mapInfoMedicaEditable(perfil.infoMedica),
      };
    }

    // Defensivo — no debería ocurrir nunca: `usuario.rol` siempre coincide
    // con exactamente uno de los 3 perfiles (regla 9, alta transaccional).
    console.error(
      '[PersonasService.obtenerParaEditar] Usuario sin perfil correspondiente a su rol:',
      { id, rol: usuario.rol },
    );
    throw new InternalServerErrorException({
      error: 'Error inesperado al obtener los datos de la persona',
      code: 'SERVER_ERROR',
    });
  }
```

- [ ] **Step 3: Agregar `GET /personas/:id` al controller**

Abrir `App/backend/src/personas/personas.controller.ts`. Después del método `resumen` (y antes de `cambiarEstatus`), agregar:

```typescript
  @Get(':id')
  @Roles(RolUsuario.ADMINISTRATIVO)
  async obtenerParaEditar(
    @Param('id') id: string,
    @SedeActual() sedeId: string,
  ) {
    const data = await this.personasService.obtenerParaEditar(id, sedeId);
    return { data };
  }
```

- [ ] **Step 4: Crear el spec e2e con los casos de `GET /personas/:id`**

Crear `App/backend/test/personas-editar.e2e-spec.ts`:

```typescript
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  EstatusEmpleado,
  NivelPermiso,
  PuestoAdministrativo,
  RolUsuario,
  TipoContratacion,
} from '@prisma/client';
import { AppModule } from '../src/app.module';
import { SEDE_GUARD_ENV_OVERRIDE } from '../src/common/guards/sede.guard';
import { loadEnv } from '../src/load-env';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup-app';

loadEnv();

interface ErrorBody {
  error: string;
  code: string;
}

/**
 * Test de integración — feature "Edición de datos de persona" (2026-09-20).
 *
 * `GET /personas/:id` (Task 1) + `PATCH /personas/:id` (Task 2, agregado en
 * ese mismo archivo). Contra la app real (`AppModule` completo,
 * `PrismaService` conectado a la DB real de Supabase) — sin mockear
 * Supabase Auth/Storage: ninguno de los 2 endpoints los toca (a diferencia
 * de `POST /personas`/`foto-perfil`), mismo criterio que
 * `personas-listado.e2e-spec.ts`.
 */
describe('PersonasController — GET/PATCH /personas/:id (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let sedeValladolidId: string;
  let carreraMeridaId: string;
  let adminMeridaId: string;
  let adminValladolidId: string;

  // Cleanup real (mismo criterio que `personas-listado.e2e-spec.ts`, regla
  // 14 de `CLAUDE.md` raíz) — cada `usuarioId` real creado directo por
  // `prisma.usuario.create()` en este archivo se agrega acá; `afterAll` los
  // borra al final. NUNCA incluye a los actores reales del seed.
  const usuarioIdsCreados: string[] = [];

  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';

  async function firmarToken(
    sub: string,
    rol: RolUsuario,
    sedeId: string,
  ): Promise<string> {
    return new jose.SignJWT({ role: 'authenticated', sede_id: sedeId, rol })
      .setProtectedHeader({ alg, kid })
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  async function crearAlumnoFixture(sedeId: string, carreraId: string) {
    const usuario = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.editar.${randomUUID()}@example.com`,
        rol: RolUsuario.ALUMNO,
        sedeId,
      },
    });
    const perfil = await prisma.perfilAlumno.create({
      data: {
        usuarioId: usuario.id,
        nombres: 'Fixture Editar',
        apellidoPaterno: 'Original',
        curp: `FX${randomUUID().slice(0, 16).toUpperCase()}`,
        fechaNacimiento: new Date('2005-01-01'),
        matricula: `A2026${randomUUID().slice(0, 5).toUpperCase()}`,
        correoPersonal: `fixture.editar.personal.${randomUUID()}@example.com`,
        carreraId,
        estatusAcademico: 'INSCRITO',
        periodoIngreso: '2026-1',
        cuatrimestreActual: 1,
        telefono: '9990001111',
      },
    });
    await prisma.contactoAlumno.create({
      data: {
        alumnoId: perfil.id,
        tipo: 'TUTOR',
        nombre: 'Tutor Original',
        telefono: '9990002222',
        parentesco: 'Madre',
        orden: 1,
      },
    });
    await prisma.infoMedicaAlumno.create({
      data: { alumnoId: perfil.id, tieneCondicionMedica: false, tipoSangre: 'O_POSITIVO' },
    });
    usuarioIdsCreados.push(usuario.id);
    return usuario.id;
  }

  async function crearAdministrativoFixture(
    sedeId: string,
    nivelPermiso: NivelPermiso,
  ) {
    const usuario = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.editar.admin.${randomUUID()}@example.com`,
        rol: RolUsuario.ADMINISTRATIVO,
        sedeId,
      },
    });
    const perfil = await prisma.perfilAdministrativo.create({
      data: {
        usuarioId: usuario.id,
        nombres: 'Fixture Editar Admin',
        apellidoPaterno: 'Original',
        curp: `FX${randomUUID().slice(0, 16).toUpperCase()}`,
        correoPersonal: `fixture.editar.admin.personal.${randomUUID()}@example.com`,
        telefono: '9990003333',
        fechaContratacion: new Date('2024-01-01'),
        estatus: EstatusEmpleado.ACTIVO,
        puesto: PuestoAdministrativo.AUXILIAR,
        nivelPermiso,
      },
    });
    await prisma.contactoAdministrativo.create({
      data: {
        administrativoId: perfil.id,
        nombre: 'Contacto Original',
        telefono: '9990004444',
        parentesco: 'Padre',
        orden: 1,
      },
    });
    await prisma.infoMedicaAdministrativo.create({
      data: { administrativoId: perfil.id, tieneCondicionMedica: false, tipoSangre: 'A_POSITIVO' },
    });
    usuarioIdsCreados.push(usuario.id);
    return usuario.id;
  }

  beforeAll(async () => {
    jose = await import('jose');
    const keyPair = await jose.generateKeyPair(alg, { extractable: true });
    privateKey = keyPair.privateKey;
    const publicJwk = await jose.exportJWK(keyPair.publicKey);
    publicJwk.kid = kid;
    publicJwk.alg = alg;
    publicJwk.use = 'sig';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SEDE_GUARD_ENV_OVERRIDE)
      .useValue({ jwks: { keys: [publicJwk] } })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = moduleFixture.get(PrismaService);

    const merida = await prisma.sede.findUniqueOrThrow({ where: { nombre: 'CESP Mérida' } });
    sedeMeridaId = merida.id;
    const valladolid = await prisma.sede.findUniqueOrThrow({ where: { nombre: 'CESP Valladolid' } });
    sedeValladolidId = valladolid.id;
    const carreraMerida = await prisma.carrera.findUniqueOrThrow({ where: { clave: 'LAE-MID' } });
    carreraMeridaId = carreraMerida.id;

    const adminMerida = await prisma.usuario.findUniqueOrThrow({
      where: { email: 'ana.canul@cesp-merida.edu.mx' },
    });
    adminMeridaId = adminMerida.id;
    const adminValladolid = await prisma.usuario.findUniqueOrThrow({
      where: { email: 'jorge.ek@cesp-valladolid.edu.mx' },
    });
    adminValladolidId = adminValladolid.id;
  });

  afterAll(async () => {
    await prisma.registroAuditoria.deleteMany({
      where: { usuarioId: { in: usuarioIdsCreados } },
    });
    await prisma.usuario.deleteMany({ where: { id: { in: usuarioIdsCreados } } });
    await app.close();
  });

  describe('GET /personas/:id', () => {
    it('trae los datos editables de un alumno, con contactos e infoMedica', async () => {
      const alumnoId = await crearAlumnoFixture(sedeMeridaId, carreraMeridaId);
      const token = await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId);

      const res = await request(app.getHttpServer())
        .get(`/personas/${alumnoId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const body = res.body as {
        data: {
          rol: string;
          perfilAlumno: { nombres: string; carreraId: string };
          contactos: { nombre: string; tipo?: string }[];
          infoMedica: { tipoSangre: string | null };
        };
      };
      expect(body.data.rol).toBe('ALUMNO');
      expect(body.data.perfilAlumno.nombres).toBe('Fixture Editar');
      expect(body.data.perfilAlumno.carreraId).toBe(carreraMeridaId);
      expect(body.data.contactos).toHaveLength(1);
      expect(body.data.contactos[0].tipo).toBe('TUTOR');
      expect(body.data.infoMedica.tipoSangre).toBe('O_POSITIVO');
    });

    it('responde 404 NOT_FOUND si la persona es de otra sede', async () => {
      const alumnoId = await crearAlumnoFixture(sedeMeridaId, carreraMeridaId);
      const token = await firmarToken(
        adminValladolidId,
        RolUsuario.ADMINISTRATIVO,
        sedeValladolidId,
      );

      const res = await request(app.getHttpServer())
        .get(`/personas/${alumnoId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
    });

    it('responde 404 NOT_FOUND si el id no existe', async () => {
      const token = await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId);

      const res = await request(app.getHttpServer())
        .get(`/personas/${randomUUID()}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
    });
  });
});
```

- [ ] **Step 5: Correr el spec nuevo y confirmar que pasa**

Run: `cd App/backend && node scripts/run-e2e.js personas-editar`
Expected: `Test Suites: 1 passed`, los 3 casos de `GET /personas/:id` en verde.

- [ ] **Step 6: Build del backend**

Run: `cd App/backend && npx nest build`
Expected: sin errores de TypeScript (el import de `TipoSangre`/las interfaces nuevas deben compilar limpio).

- [ ] **Step 7: Commit**

```bash
git add App/backend/src/personas/personas.service.ts App/backend/src/personas/personas.controller.ts App/backend/test/personas-editar.e2e-spec.ts
git commit -m "feat(backend): GET /personas/:id para precargar el modal de edición"
```

---

### Task 2: Backend — `PATCH /personas/:id` (guarda los cambios)

**Files:**
- Create: `App/backend/src/personas/dto/editar-persona.dto.ts`
- Modify: `App/backend/src/personas/personas.service.ts`
- Modify: `App/backend/src/personas/personas.controller.ts`
- Test: `App/backend/test/personas-editar.e2e-spec.ts` (extender, agregado por Task 1)

**Interfaces:**
- Consumes: `PersonasService.JERARQUIA_NIVEL_PERMISO` (privado, ya existe), `this.conOrdenSecuencial`/`this.datosInfoMedica`/`this.datosContratacionMaestro` (privados, ya existen en `personas.service.ts`, Task 1 no los modifica).
- Produces: `PersonasService.editarPersona(id: string, dto: EditarPersonaDto, sedeId: string, actorUsuarioId: string): Promise<{ ok: true }>`.

- [ ] **Step 1: Crear el DTO de edición**

Crear `App/backend/src/personas/dto/editar-persona.dto.ts`:

```typescript
import { Type } from 'class-transformer';
import { IsOptional, IsString, ValidateNested } from 'class-validator';
import {
  PerfilAdministrativoDto,
  PerfilAlumnoDto,
  PerfilMaestroDto,
} from './crear-persona.dto';

/**
 * Body de `PATCH /personas/:id` — feature "Edición de datos de persona"
 * (2026-09-20, spec `docs/superpowers/specs/2026-09-20-edicion-datos-persona-design.md`).
 *
 * Reusa TAL CUAL `PerfilAlumnoDto`/`PerfilMaestroDto`/`PerfilAdministrativoDto`
 * de `crear-persona.dto.ts` (incluidos sus `contactos`/`infoMedica`
 * anidados) — el alcance de "editable" es idéntico al de "capturable en el
 * alta" para los 3 roles (ver spec, sección "Alcance"), así que no hace
 * falta declarar campos nuevos ni relajar requeridos/opcionales: son
 * exactamente los mismos.
 *
 * A diferencia de `CrearPersonaDto`, esta clase NO tiene un campo `rol`
 * discriminador — el `rol` real de la persona sale de la DB (`:id` +
 * `sedeId`), no lo manda el cliente. Por eso los 3 sub-perfiles son
 * simplemente `@IsOptional()` (sin `@ValidateIf` condicionado a un sibling):
 * el que corresponde al `rol` real se exige presente en
 * `PersonasService.editarPersona` (chequeo defensivo, mismo criterio que
 * `altaPersona`), no acá.
 */
export class EditarPersonaDto {
  @IsOptional()
  @IsString()
  codigoExterno?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PerfilAlumnoDto)
  perfilAlumno?: PerfilAlumnoDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PerfilMaestroDto)
  perfilMaestro?: PerfilMaestroDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PerfilAdministrativoDto)
  perfilAdministrativo?: PerfilAdministrativoDto;
}
```

- [ ] **Step 2: Agregar `editarPersona` a `PersonasService`**

En `App/backend/src/personas/personas.service.ts`, agregar el import de `EditarPersonaDto` (vive en `./dto/editar-persona.dto.ts`, un archivo distinto de `CrearPersonaDto`) junto al bloque de imports existente de DTOs (línea ~25-29):

```typescript
import {
  CrearPersonaDto,
  InfoMedicaDto,
  PerfilMaestroDto,
} from './dto/crear-persona.dto';
import { EditarPersonaDto } from './dto/editar-persona.dto';
```

Agregar el método `editarPersona` como método público de la clase, justo después de `obtenerParaEditar` (Task 1):

```typescript
  /**
   * `PATCH /personas/:id` — guarda los cambios del modal de edición (feature
   * "Edición de datos de persona", 2026-09-20). Mismo patrón que
   * `cambiarEstatus`: `id` es el `Usuario` objetivo, se valida contra su
   * `rol` real (no contra un discriminador del body).
   *
   * Reemplazo completo de `contactos` (`deleteMany` + recrear, dentro de la
   * transacción) — evita lógica de diff/merge, el modal siempre manda el
   * array completo (mismo criterio documentado en el spec).
   *
   * Auditoría: `EDICION` si cambió cualquier campo del perfil/contactos/
   * infoMedica/`codigoExterno`; un registro ADICIONAL `CAMBIO_PERMISO` si
   * `nivelPermiso` cambió (solo aplica a ADMINISTRATIVO) — primer uso real
   * de ese valor del enum. No se intenta evitar auditar cuando "no hay
   * cambios reales" (a diferencia de `PATCH /carreras`) — decisión explícita
   * del spec: el diff no vale el costo con contactos+infoMedica en el mismo
   * submit.
   */
  async editarPersona(
    id: string,
    dto: EditarPersonaDto,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<{ ok: true }> {
    const usuario = await this.prisma.usuario.findFirst({
      where: { id, sedeId },
      select: {
        rol: true,
        codigoExterno: true,
        perfilAdministrativo: { select: { nivelPermiso: true } },
      },
    });

    if (!usuario) {
      throw new NotFoundException({
        error: 'Persona no encontrada en tu sede',
        code: 'NOT_FOUND',
      });
    }

    // Mismo pre-check de `codigoExterno` que `altaPersona`, EXCLUYENDO a la
    // propia persona (editar sin cambiar su propio código no debe fallar).
    if (dto.codigoExterno && dto.codigoExterno !== usuario.codigoExterno) {
      const codigoExternoEnUso = await this.prisma.usuario.findUnique({
        where: { codigoExterno: dto.codigoExterno },
        select: { id: true },
      });
      if (codigoExternoEnUso && codigoExternoEnUso.id !== id) {
        throw new ConflictException({
          error: 'Ya existe un usuario con ese código externo',
          code: 'CONFLICT',
        });
      }
    }

    let nivelPermisoAnterior: NivelPermiso | undefined;
    let nivelPermisoNuevo: NivelPermiso | undefined;

    if (usuario.rol === RolUsuario.ALUMNO) {
      if (!dto.perfilAlumno) {
        throw new BadRequestException({
          error: 'perfilAlumno es requerido para editar un ALUMNO',
          code: 'VALIDATION_ERROR',
        });
      }
      const carrera = await this.prisma.carrera.findFirst({
        where: { id: dto.perfilAlumno.carreraId, sedeId },
        select: { duracion: true },
      });
      if (!carrera) {
        throw new NotFoundException({
          error: 'Carrera no encontrada en tu sede',
          code: 'NOT_FOUND',
        });
      }
      if (
        dto.perfilAlumno.cuatrimestreActual < 1 ||
        dto.perfilAlumno.cuatrimestreActual > carrera.duracion
      ) {
        throw new BadRequestException({
          error: `cuatrimestreActual debe estar entre 1 y ${carrera.duracion} para esa carrera`,
          code: 'VALIDATION_ERROR',
        });
      }
    } else if (usuario.rol === RolUsuario.MAESTRO) {
      if (!dto.perfilMaestro) {
        throw new BadRequestException({
          error: 'perfilMaestro es requerido para editar un MAESTRO',
          code: 'VALIDATION_ERROR',
        });
      }
      // Misma regla cruzada que `altaPersona`.
      if (
        dto.perfilMaestro.tipoContratacion === TipoContratacion.CONTRATO &&
        dto.perfilMaestro.contratoFechaInicio &&
        dto.perfilMaestro.contratoFechaFin &&
        new Date(dto.perfilMaestro.contratoFechaFin).getTime() <=
          new Date(dto.perfilMaestro.contratoFechaInicio).getTime()
      ) {
        throw new BadRequestException({
          error:
            'contratoFechaFin no puede ser anterior o igual a contratoFechaInicio',
          code: 'VALIDATION_ERROR',
        });
      }
    } else {
      if (!dto.perfilAdministrativo) {
        throw new BadRequestException({
          error: 'perfilAdministrativo es requerido para editar un ADMINISTRATIVO',
          code: 'VALIDATION_ERROR',
        });
      }
      nivelPermisoAnterior = usuario.perfilAdministrativo?.nivelPermiso;
      nivelPermisoNuevo =
        dto.perfilAdministrativo.nivelPermiso ?? nivelPermisoAnterior;

      // Jerarquía de `nivelPermiso` (regla 7) — igual que `cambiarEstatus`:
      // el actor debe tener nivel suficiente sobre el nivel ACTUAL del
      // target Y sobre el nivel NUEVO que le quiere asignar.
      const perfilActor = await this.prisma.perfilAdministrativo.findUnique({
        where: { usuarioId: actorUsuarioId },
        select: { nivelPermiso: true },
      });
      const nivelActor = perfilActor?.nivelPermiso ?? NivelPermiso.AUXILIAR;

      if (nivelActor === NivelPermiso.AUXILIAR) {
        throw new ForbiddenException({
          error: 'Un usuario con nivel AUXILIAR no puede editar personal administrativo',
          code: 'NIVEL_PERMISO_INSUFICIENTE',
        });
      }

      const rangoActor = PersonasService.JERARQUIA_NIVEL_PERMISO[nivelActor];
      const rangoObjetivoActual =
        PersonasService.JERARQUIA_NIVEL_PERMISO[
          nivelPermisoAnterior ?? NivelPermiso.AUXILIAR
        ];
      const rangoObjetivoNuevo =
        PersonasService.JERARQUIA_NIVEL_PERMISO[
          nivelPermisoNuevo ?? NivelPermiso.AUXILIAR
        ];

      if (rangoActor < rangoObjetivoActual || rangoActor < rangoObjetivoNuevo) {
        throw new ForbiddenException({
          error: 'No tienes nivel de permiso suficiente para editar a este administrativo',
          code: 'NIVEL_PERMISO_INSUFICIENTE',
        });
      }
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.usuario.update({
          where: { id },
          data: { codigoExterno: dto.codigoExterno },
        });

        if (usuario.rol === RolUsuario.ALUMNO && dto.perfilAlumno) {
          const perfil = await tx.perfilAlumno.update({
            where: { usuarioId: id },
            data: {
              nombres: dto.perfilAlumno.nombres,
              apellidoPaterno: dto.perfilAlumno.apellidoPaterno,
              apellidoMaterno: dto.perfilAlumno.apellidoMaterno,
              curp: dto.perfilAlumno.curp,
              fechaNacimiento: new Date(dto.perfilAlumno.fechaNacimiento),
              correoPersonal: dto.perfilAlumno.correoPersonal,
              carreraId: dto.perfilAlumno.carreraId,
              periodoIngreso: dto.perfilAlumno.periodoIngreso,
              cuatrimestreActual: dto.perfilAlumno.cuatrimestreActual,
              telefono: dto.perfilAlumno.telefono,
            },
          });

          await tx.contactoAlumno.deleteMany({ where: { alumnoId: perfil.id } });
          for (const contacto of this.conOrdenSecuencial(dto.perfilAlumno.contactos)) {
            await tx.contactoAlumno.create({
              data: {
                alumnoId: perfil.id,
                tipo: contacto.tipo,
                nombre: contacto.nombre,
                telefono: contacto.telefono,
                correo: contacto.correo,
                parentesco: contacto.parentesco,
                orden: contacto.orden,
              },
            });
          }

          await tx.infoMedicaAlumno.upsert({
            where: { alumnoId: perfil.id },
            create: { alumnoId: perfil.id, ...this.datosInfoMedica(dto.perfilAlumno.infoMedica) },
            update: this.datosInfoMedica(dto.perfilAlumno.infoMedica),
          });
        } else if (usuario.rol === RolUsuario.MAESTRO && dto.perfilMaestro) {
          const perfil = await tx.perfilMaestro.update({
            where: { usuarioId: id },
            data: {
              nombres: dto.perfilMaestro.nombres,
              apellidoPaterno: dto.perfilMaestro.apellidoPaterno,
              apellidoMaterno: dto.perfilMaestro.apellidoMaterno,
              curp: dto.perfilMaestro.curp,
              cedulaProfesional: dto.perfilMaestro.cedulaProfesional,
              correoPersonal: dto.perfilMaestro.correoPersonal,
              telefono: dto.perfilMaestro.telefono,
              fechaContratacion: new Date(dto.perfilMaestro.fechaContratacion),
              ...this.datosContratacionMaestro(dto.perfilMaestro),
            },
          });

          await tx.contactoMaestro.deleteMany({ where: { maestroId: perfil.id } });
          for (const contacto of this.conOrdenSecuencial(dto.perfilMaestro.contactos)) {
            await tx.contactoMaestro.create({
              data: {
                maestroId: perfil.id,
                nombre: contacto.nombre,
                telefono: contacto.telefono,
                correo: contacto.correo,
                parentesco: contacto.parentesco,
                orden: contacto.orden,
              },
            });
          }

          await tx.infoMedicaMaestro.upsert({
            where: { maestroId: perfil.id },
            create: { maestroId: perfil.id, ...this.datosInfoMedica(dto.perfilMaestro.infoMedica) },
            update: this.datosInfoMedica(dto.perfilMaestro.infoMedica),
          });
        } else if (usuario.rol === RolUsuario.ADMINISTRATIVO && dto.perfilAdministrativo) {
          const perfil = await tx.perfilAdministrativo.update({
            where: { usuarioId: id },
            data: {
              nombres: dto.perfilAdministrativo.nombres,
              apellidoPaterno: dto.perfilAdministrativo.apellidoPaterno,
              apellidoMaterno: dto.perfilAdministrativo.apellidoMaterno,
              curp: dto.perfilAdministrativo.curp,
              correoPersonal: dto.perfilAdministrativo.correoPersonal,
              telefono: dto.perfilAdministrativo.telefono,
              fechaContratacion: new Date(dto.perfilAdministrativo.fechaContratacion),
              puesto: dto.perfilAdministrativo.puesto,
              nivelPermiso: nivelPermisoNuevo,
            },
          });

          await tx.contactoAdministrativo.deleteMany({
            where: { administrativoId: perfil.id },
          });
          for (const contacto of this.conOrdenSecuencial(dto.perfilAdministrativo.contactos)) {
            await tx.contactoAdministrativo.create({
              data: {
                administrativoId: perfil.id,
                nombre: contacto.nombre,
                telefono: contacto.telefono,
                correo: contacto.correo,
                parentesco: contacto.parentesco,
                orden: contacto.orden,
              },
            });
          }

          await tx.infoMedicaAdministrativo.upsert({
            where: { administrativoId: perfil.id },
            create: {
              administrativoId: perfil.id,
              ...this.datosInfoMedica(dto.perfilAdministrativo.infoMedica),
            },
            update: this.datosInfoMedica(dto.perfilAdministrativo.infoMedica),
          });
        }

        await tx.registroAuditoria.create({
          data: {
            usuarioId: actorUsuarioId,
            sedeId,
            accion: AccionAuditoria.EDICION,
            entidad: 'Usuario',
            entidadId: id,
            detalle: { rol: usuario.rol },
          },
        });

        if (
          nivelPermisoAnterior !== undefined &&
          nivelPermisoNuevo !== undefined &&
          nivelPermisoAnterior !== nivelPermisoNuevo
        ) {
          await tx.registroAuditoria.create({
            data: {
              usuarioId: actorUsuarioId,
              sedeId,
              accion: AccionAuditoria.CAMBIO_PERMISO,
              entidad: 'Usuario',
              entidadId: id,
              detalle: { nivelPermisoAnterior, nivelPermisoNuevo },
            },
          });
        }
      });

      return { ok: true };
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof BadRequestException ||
        err instanceof ForbiddenException ||
        err instanceof ConflictException
      ) {
        throw err;
      }
      // Regla 12 de CLAUDE.md raíz — loguear el error completo server-side
      // antes de responder, aunque el cliente no reciba el detalle.
      console.error(
        '[PersonasService.editarPersona] Error inesperado editando persona:',
        err,
      );
      throw new InternalServerErrorException({
        error: 'Error inesperado al editar la persona',
        code: 'SERVER_ERROR',
      });
    }
  }
```

- [ ] **Step 3: Agregar `PATCH /personas/:id` al controller**

En `App/backend/src/personas/personas.controller.ts`, agregar el import de `EditarPersonaDto`:

```typescript
import { EditarPersonaDto } from './dto/editar-persona.dto';
```

Después del método `obtenerParaEditar` (Task 1) y antes de `cambiarEstatus`, agregar:

```typescript
  @Patch(':id')
  @Roles(RolUsuario.ADMINISTRATIVO)
  async editar(
    @Param('id') id: string,
    @Body() body: EditarPersonaDto,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    const data = await this.personasService.editarPersona(
      id,
      body,
      sedeId,
      actorUsuarioId,
    );
    return { data };
  }
```

- [ ] **Step 4: Agregar los casos de `PATCH /personas/:id` al spec e2e**

En `App/backend/test/personas-editar.e2e-spec.ts` (creado en Task 1), agregar el import de `interface OkBody { data: { ok: true } }` junto a `ErrorBody`, y un nuevo `describe('PATCH /personas/:id', ...)` DESPUÉS del `describe('GET /personas/:id', ...)` ya existente, antes del cierre del `describe` raíz:

```typescript
interface OkBody {
  data: { ok: true };
}
```

(agregar esta interface junto a `ErrorBody`, arriba del primer `describe`).

```typescript
  describe('PATCH /personas/:id', () => {
    it('edita nombres/apellidos/CURP/contactos/infoMedica de un alumno', async () => {
      const alumnoId = await crearAlumnoFixture(sedeMeridaId, carreraMeridaId);
      const token = await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId);

      const res = await request(app.getHttpServer())
        .patch(`/personas/${alumnoId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          perfilAlumno: {
            nombres: 'Fixture Editar CORREGIDO',
            apellidoPaterno: 'Corregido',
            fechaNacimiento: '2005-01-01',
            correoPersonal: 'corregido@example.com',
            carreraId: carreraMeridaId,
            periodoIngreso: '2026-1',
            cuatrimestreActual: 2,
            contactos: [
              { nombre: 'Tutor Nuevo', telefono: '9991110000', parentesco: 'Padre', tipo: 'TUTOR' },
            ],
            infoMedica: { tieneCondicionMedica: false, tipoSangre: 'B_NEGATIVO' },
          },
        });

      expect(res.status).toBe(200);
      expect((res.body as OkBody).data).toEqual({ ok: true });

      const perfil = await prisma.perfilAlumno.findUniqueOrThrow({
        where: { usuarioId: alumnoId },
        include: { contactos: true, infoMedica: true },
      });
      expect(perfil.nombres).toBe('Fixture Editar CORREGIDO');
      expect(perfil.apellidoPaterno).toBe('Corregido');
      expect(perfil.cuatrimestreActual).toBe(2);
      expect(perfil.contactos).toHaveLength(1);
      expect(perfil.contactos[0].nombre).toBe('Tutor Nuevo');
      expect(perfil.infoMedica?.tipoSangre).toBe('B_NEGATIVO');

      const registro = await prisma.registroAuditoria.findFirst({
        where: { entidad: 'Usuario', entidadId: alumnoId, accion: 'EDICION' },
        orderBy: { fecha: 'desc' },
      });
      expect(registro?.usuarioId).toBe(adminMeridaId);
    });

    it('responde 400 VALIDATION_ERROR si cuatrimestreActual excede la duración de la carrera', async () => {
      const alumnoId = await crearAlumnoFixture(sedeMeridaId, carreraMeridaId);
      const token = await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId);
      const carrera = await prisma.carrera.findUniqueOrThrow({ where: { id: carreraMeridaId } });

      const res = await request(app.getHttpServer())
        .patch(`/personas/${alumnoId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          perfilAlumno: {
            nombres: 'X',
            apellidoPaterno: 'Y',
            fechaNacimiento: '2005-01-01',
            correoPersonal: 'x@example.com',
            carreraId: carreraMeridaId,
            periodoIngreso: '2026-1',
            cuatrimestreActual: carrera.duracion + 1,
            contactos: [{ nombre: 'T', telefono: '1', parentesco: 'P', tipo: 'TUTOR' }],
            infoMedica: { tieneCondicionMedica: false, tipoSangre: 'O_POSITIVO' },
          },
        });

      expect(res.status).toBe(400);
      expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
    });

    it('responde 404 NOT_FOUND si la persona es de otra sede', async () => {
      const alumnoId = await crearAlumnoFixture(sedeMeridaId, carreraMeridaId);
      const token = await firmarToken(adminValladolidId, RolUsuario.ADMINISTRATIVO, sedeValladolidId);

      const res = await request(app.getHttpServer())
        .patch(`/personas/${alumnoId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          perfilAlumno: {
            nombres: 'X',
            apellidoPaterno: 'Y',
            fechaNacimiento: '2005-01-01',
            correoPersonal: 'x@example.com',
            carreraId: carreraMeridaId,
            periodoIngreso: '2026-1',
            cuatrimestreActual: 1,
            contactos: [{ nombre: 'T', telefono: '1', parentesco: 'P', tipo: 'TUTOR' }],
            infoMedica: { tieneCondicionMedica: false, tipoSangre: 'O_POSITIVO' },
          },
        });

      expect(res.status).toBe(404);
      expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
    });

    it('un AUXILIAR no puede editar a un ADMINISTRATIVO (403 NIVEL_PERMISO_INSUFICIENTE)', async () => {
      const targetId = await crearAdministrativoFixture(sedeMeridaId, NivelPermiso.AUXILIAR);
      const auxiliarId = await crearAdministrativoFixture(sedeMeridaId, NivelPermiso.AUXILIAR);
      const token = await firmarToken(auxiliarId, RolUsuario.ADMINISTRATIVO, sedeMeridaId);

      const res = await request(app.getHttpServer())
        .patch(`/personas/${targetId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          perfilAdministrativo: {
            nombres: 'X',
            apellidoPaterno: 'Y',
            curp: 'CURPCURPCURPCURPCU',
            correoPersonal: 'x@example.com',
            telefono: '9990000000',
            fechaContratacion: '2024-01-01',
            puesto: 'AUXILIAR',
            contactos: [{ nombre: 'T', telefono: '1', parentesco: 'P' }],
            infoMedica: { tieneCondicionMedica: false, tipoSangre: 'O_POSITIVO' },
          },
        });

      expect(res.status).toBe(403);
      expect((res.body as ErrorBody).code).toBe('NIVEL_PERMISO_INSUFICIENTE');
    });

    it('cambiar nivelPermiso audita CAMBIO_PERMISO además de EDICION', async () => {
      const targetId = await crearAdministrativoFixture(sedeMeridaId, NivelPermiso.AUXILIAR);
      const token = await firmarToken(adminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId);

      const res = await request(app.getHttpServer())
        .patch(`/personas/${targetId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          perfilAdministrativo: {
            nombres: 'X',
            apellidoPaterno: 'Y',
            curp: 'CURPCURPCURPCURPCU',
            correoPersonal: 'x@example.com',
            telefono: '9990000000',
            fechaContratacion: '2024-01-01',
            puesto: 'AUXILIAR',
            nivelPermiso: 'ADMIN',
            contactos: [{ nombre: 'T', telefono: '1', parentesco: 'P' }],
            infoMedica: { tieneCondicionMedica: false, tipoSangre: 'O_POSITIVO' },
          },
        });

      expect(res.status).toBe(200);

      const perfil = await prisma.perfilAdministrativo.findUniqueOrThrow({
        where: { usuarioId: targetId },
      });
      expect(perfil.nivelPermiso).toBe('ADMIN');

      const registroCambioPermiso = await prisma.registroAuditoria.findFirst({
        where: { entidad: 'Usuario', entidadId: targetId, accion: 'CAMBIO_PERMISO' },
      });
      expect(registroCambioPermiso).not.toBeNull();
      const registroEdicion = await prisma.registroAuditoria.findFirst({
        where: { entidad: 'Usuario', entidadId: targetId, accion: 'EDICION' },
      });
      expect(registroEdicion).not.toBeNull();
    });
  });
```

Nota: `adminMeridaId` (`ana.canul@cesp-merida.edu.mx`) debe tener `nivelPermiso` suficiente (`ADMIN` o `SUPER_ADMIN`) para que el último caso pase — si el seed real la tiene como `SUPER_ADMIN` o `ADMIN` el caso pasa tal cual; si corre y falla con `403`, confirmar el nivel real vía `prisma.perfilAdministrativo.findUnique({ where: { usuarioId: adminMeridaId } })` en un `console.log` temporal y ajustar el test para crear un fixture `ADMIN`/`SUPER_ADMIN` propio en vez de depender del seed (mismo patrón que `crearAdministrativoFixture`, ya parametrizado por `nivelPermiso`).

- [ ] **Step 5: Correr el spec completo y confirmar que pasa**

Run: `cd App/backend && node scripts/run-e2e.js personas-editar`
Expected: `Test Suites: 1 passed`, los 8 casos (3 de `GET` + 5 de `PATCH`) en verde.

- [ ] **Step 6: Build y regresión completa del backend**

Run: `cd App/backend && npx nest build`
Expected: sin errores.

Run: `cd App/backend && node scripts/run-e2e.js`
Expected: toda la suite en verde (no solo el spec nuevo) — confirma que reusar `PerfilAlumnoDto`/etc. y los helpers privados no rompió `POST /personas` ni `PATCH /personas/:id/estatus`.

- [ ] **Step 7: Commit**

```bash
git add App/backend/src/personas/dto/editar-persona.dto.ts App/backend/src/personas/personas.service.ts App/backend/src/personas/personas.controller.ts App/backend/test/personas-editar.e2e-spec.ts
git commit -m "feat(backend): PATCH /personas/:id para editar datos de persona"
```

---

### Task 3: Frontend — cliente de API

**Files:**
- Modify: `App/frontend/src/lib/api/personas.ts`

**Interfaces:**
- Consumes: nada nuevo (usa `apiFetchAuth`, ya importado).
- Produces: `obtenerPersonaParaEditar(usuarioId: string): Promise<PersonaParaEditar>`, `editarPersona(usuarioId: string, input: EditarPersonaInput): Promise<{ ok: true }>`, y los tipos `PersonaParaEditar`/`EditarPersonaInput`/`PersonaEditableContacto`/`PersonaEditableInfoMedica`/`EditarPerfilAlumnoInput`/`EditarPerfilMaestroInput`/`EditarPerfilAdministrativoInput` — consumidos por Task 4/5/6.

- [ ] **Step 1: Agregar los tipos y funciones al final de `lib/api/personas.ts`**

Abrir `App/frontend/src/lib/api/personas.ts`. Al final del archivo (después de `resetearPasswordPersona`), agregar:

```typescript
/**
 * `GET/PATCH /personas/:id` — feature "Edición de datos de persona"
 * (2026-09-20). Shape espejo de `PersonaParaEditar`/`PersonaEditableAlumno`/
 * `PersonaEditableMaestro`/`PersonaEditableAdministrativo`/
 * `PersonaEditableContacto`/`PersonaEditableInfoMedica`
 * (`App/backend/src/personas/personas.service.ts`) para el `GET`, y de
 * `EditarPersonaDto` (que reusa `PerfilAlumnoDto`/`PerfilMaestroDto`/
 * `PerfilAdministrativoDto` de `crear-persona.dto.ts`, backend) para el
 * `PATCH` — mismo shape que `CrearAlumnoInput`/`CrearMaestroInput`/
 * `CrearAdministrativoInput` de este mismo archivo, SIN `matricula`/`email`
 * (inmutables, ver spec) y sin `nivelPermiso` opcional-con-default (acá si
 * cambia se audita `CAMBIO_PERMISO`, ver backend).
 */
export interface PersonaEditableContacto {
  nombre: string;
  telefono: string;
  correo: string | null;
  parentesco: string;
  tipo?: TipoContacto;
}

export interface PersonaEditableInfoMedica {
  tieneCondicionMedica: boolean;
  tipoSangre: TipoSangre | null;
  padecimiento: string | null;
  medicamentos: string | null;
  alergias: string | null;
  tratamientoAdicional: string | null;
}

export interface PersonaEditableAlumno {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  curp: string | null;
  /** ISO date (`YYYY-MM-DD`). */
  fechaNacimiento: string;
  correoPersonal: string;
  carreraId: string;
  periodoIngreso: string;
  cuatrimestreActual: number;
  telefono: string | null;
}

export interface PersonaEditableMaestro {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  curp: string;
  cedulaProfesional: string | null;
  correoPersonal: string;
  telefono: string;
  fechaContratacion: string;
  tipoContratacion: TipoContratacion | null;
  diasTemporal: number | null;
  contratoFechaInicio: string | null;
  contratoFechaFin: string | null;
}

export interface PersonaEditableAdministrativo {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  curp: string;
  correoPersonal: string;
  telefono: string;
  fechaContratacion: string;
  puesto: PuestoAdministrativo;
  nivelPermiso: NivelPermiso;
}

export interface PersonaParaEditar {
  rol: 'ALUMNO' | 'MAESTRO' | 'ADMINISTRATIVO';
  codigoExterno: string | null;
  perfilAlumno?: PersonaEditableAlumno;
  perfilMaestro?: PersonaEditableMaestro;
  perfilAdministrativo?: PersonaEditableAdministrativo;
  contactos: PersonaEditableContacto[];
  infoMedica: PersonaEditableInfoMedica;
}

export function obtenerPersonaParaEditar(
  usuarioId: string,
): Promise<PersonaParaEditar> {
  return apiFetchAuth<PersonaParaEditar>(`/personas/${usuarioId}`);
}

export interface EditarPersonaInput {
  codigoExterno?: string;
  perfilAlumno?: PerfilAlumnoInput;
  perfilMaestro?: PerfilMaestroInput;
  perfilAdministrativo?: PerfilAdministrativoInput;
}

export function editarPersona(
  usuarioId: string,
  input: EditarPersonaInput,
): Promise<{ ok: true }> {
  return apiFetchAuth<{ ok: true }>(`/personas/${usuarioId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
```

Nota: `EditarPersonaInput` reusa `PerfilAlumnoInput`/`PerfilMaestroInput`/`PerfilAdministrativoInput` — YA definidos arriba en este mismo archivo (usados por `CrearAlumnoInput`/etc.), no hace falta declararlos de nuevo.

- [ ] **Step 2: Typecheck**

Run: `cd App/frontend && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add App/frontend/src/lib/api/personas.ts
git commit -m "feat(frontend): cliente de API para GET/PATCH /personas/:id"
```

---

### Task 4: Frontend — modal de edición de alumno

**Files:**
- Create: `App/frontend/src/app/admin/alumnos/EditarAlumnoModal.tsx`
- Modify: `App/frontend/src/app/admin/alumnos/page.tsx`

**Interfaces:**
- Consumes: `obtenerPersonaParaEditar`/`editarPersona`/`PersonaParaEditar` (Task 3); `AltaPersonaFormShell` NO se reusa acá (es un `<form>` de página completa, no un modal) — se reusan `DatosPersonalesFieldset`/`ContactosFieldset`/`InfoMedicaFieldset`/`FieldError`/`Select`/`estilos`/`schemas`/`mensajes-error` de `components/admin/ui/persona-alta/`.
- Produces: `EditarAlumnoModal` (componente), consumido dentro de este mismo task por `app/admin/alumnos/page.tsx`.

- [ ] **Step 1: Crear el modal**

Crear `App/frontend/src/app/admin/alumnos/EditarAlumnoModal.tsx`:

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { ContactosFieldset } from '@/components/admin/ui/persona-alta/ContactosFieldset';
import { DatosPersonalesFieldset } from '@/components/admin/ui/persona-alta/DatosPersonalesFieldset';
import { FieldError } from '@/components/admin/ui/persona-alta/FieldError';
import { INPUT_CLASS, LABEL_CLASS } from '@/components/admin/ui/persona-alta/estilos';
import { InfoMedicaFieldset } from '@/components/admin/ui/persona-alta/InfoMedicaFieldset';
import {
  MENSAJE_ERROR_GENERICO,
  resolverMensajeError,
} from '@/components/admin/ui/persona-alta/mensajes-error';
import {
  contactosAlumnoSchema,
  infoMedicaSchema,
} from '@/components/admin/ui/persona-alta/schemas';
import { Select } from '@/components/admin/ui/persona-alta/Select';
import { listarCarreras } from '@/lib/api/carreras';
import {
  editarPersona,
  obtenerPersonaParaEditar,
  type PersonaParaEditar,
} from '@/lib/api/personas';

/**
 * Modal de edición de datos de alumno — feature "Edición de datos de
 * persona" (2026-09-20, spec `docs/superpowers/specs/2026-09-20-edicion-datos-persona-design.md`).
 *
 * Disparado por el lápiz de `app/admin/alumnos/page.tsx` (`TablaAlumnos`).
 * Precarga vía `GET /personas/:id` (`obtenerPersonaParaEditar`), reusa el
 * mismo `alumnoSchema`/fieldsets que `app/admin/alumnos/nuevo/page.tsx`
 * (sin campo `estatus`/foto/password — esos tienen su propio flujo, fuera
 * de este modal, ver spec).
 */
const alumnoEditarSchema = z.object({
  codigoExterno: z.string().optional(),
  perfilAlumno: z.object({
    nombres: z.string().min(1, 'Los nombres son requeridos'),
    apellidoPaterno: z.string().min(1, 'El apellido paterno es requerido'),
    apellidoMaterno: z.string().optional(),
    curp: z.string().optional(),
    fechaNacimiento: z.string().min(1, 'La fecha de nacimiento es requerida'),
    correoPersonal: z
      .string()
      .min(1, 'El correo personal es requerido')
      .email('Formato de correo inválido'),
    carreraId: z.string().min(1, 'Selecciona una carrera'),
    periodoIngreso: z.string().min(1, 'El periodo de ingreso es requerido'),
    cuatrimestreActual: z.coerce
      .number()
      .int('El cuatrimestre debe ser un número entero')
      .min(1, 'El cuatrimestre debe ser al menos 1'),
    telefono: z.string().optional(),
    contactos: contactosAlumnoSchema,
    infoMedica: infoMedicaSchema,
  }),
});

type AlumnoEditarFormInput = z.input<typeof alumnoEditarSchema>;
type AlumnoEditarFormOutput = z.output<typeof alumnoEditarSchema>;

function valoresIniciales(persona: PersonaParaEditar): AlumnoEditarFormInput {
  const perfil = persona.perfilAlumno!;
  return {
    codigoExterno: persona.codigoExterno ?? '',
    perfilAlumno: {
      nombres: perfil.nombres,
      apellidoPaterno: perfil.apellidoPaterno,
      apellidoMaterno: perfil.apellidoMaterno ?? '',
      curp: perfil.curp ?? '',
      fechaNacimiento: perfil.fechaNacimiento,
      correoPersonal: perfil.correoPersonal,
      carreraId: perfil.carreraId,
      periodoIngreso: perfil.periodoIngreso,
      cuatrimestreActual: perfil.cuatrimestreActual,
      telefono: perfil.telefono ?? '',
      contactos:
        persona.contactos.length > 0
          ? persona.contactos.map((c) => ({
              nombre: c.nombre,
              telefono: c.telefono,
              correo: c.correo ?? '',
              parentesco: c.parentesco,
              tipo: (c.tipo ?? '') as AlumnoEditarFormInput['perfilAlumno']['contactos'][number]['tipo'],
            }))
          : [{ nombre: '', telefono: '', correo: '', parentesco: '', tipo: '' as never }],
      infoMedica: {
        tieneCondicionMedica: persona.infoMedica.tieneCondicionMedica,
        tipoSangre: (persona.infoMedica.tipoSangre ??
          '') as AlumnoEditarFormInput['perfilAlumno']['infoMedica']['tipoSangre'],
        padecimiento: persona.infoMedica.padecimiento ?? '',
        medicamentos: persona.infoMedica.medicamentos ?? '',
        alergias: persona.infoMedica.alergias ?? '',
        tratamientoAdicional: persona.infoMedica.tratamientoAdicional ?? '',
      },
    },
  };
}

const MENSAJES_ERROR_ALUMNO: Record<string, string> = {
  NOT_FOUND: 'La carrera seleccionada no existe o no pertenece a tu sede.',
};

export function EditarAlumnoModal({
  usuarioId,
  onClose,
  onGuardadoConExito,
}: {
  usuarioId: string;
  onClose: () => void;
  onGuardadoConExito: () => void;
}) {
  const personaQuery = useQuery({
    queryKey: ['admin', 'personas', 'editar', usuarioId],
    queryFn: async () => {
      try {
        return await obtenerPersonaParaEditar(usuarioId);
      } catch (err) {
        console.error('[EditarAlumnoModal] Error al obtener la persona:', err);
        throw err;
      }
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-slate">Editar alumno</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate/60 hover:text-slate"
          >
            ✕
          </button>
        </div>

        {personaQuery.isLoading ? (
          <p className="mt-6 text-sm text-slate/60">Cargando…</p>
        ) : personaQuery.isError ? (
          <p className="mt-6 rounded-lg border border-error-border bg-error-bg px-3 py-2 text-sm text-crimson">
            No se pudo cargar la información. Intenta de nuevo.
          </p>
        ) : (
          <FormularioEdicion
            usuarioId={usuarioId}
            persona={personaQuery.data}
            onClose={onClose}
            onGuardadoConExito={onGuardadoConExito}
          />
        )}
      </div>
    </div>
  );
}

function FormularioEdicion({
  usuarioId,
  persona,
  onClose,
  onGuardadoConExito,
}: {
  usuarioId: string;
  persona: PersonaParaEditar;
  onClose: () => void;
  onGuardadoConExito: () => void;
}) {
  const carrerasQuery = useQuery({
    queryKey: ['carreras'],
    queryFn: async () => {
      try {
        return await listarCarreras();
      } catch (err) {
        console.error('[EditarAlumnoModal] Error al listar carreras:', err);
        throw err;
      }
    },
  });

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<AlumnoEditarFormInput, unknown, AlumnoEditarFormOutput>({
    resolver: zodResolver(alumnoEditarSchema),
    defaultValues: valoresIniciales(persona),
  });

  const tieneCondicionMedica = useWatch({
    control,
    name: 'perfilAlumno.infoMedica.tieneCondicionMedica',
  });

  const mutation = useMutation({
    mutationFn: (values: AlumnoEditarFormOutput) =>
      editarPersona(usuarioId, {
        codigoExterno: values.codigoExterno || undefined,
        perfilAlumno: {
          ...values.perfilAlumno,
          apellidoMaterno: values.perfilAlumno.apellidoMaterno || undefined,
          curp: values.perfilAlumno.curp || undefined,
          telefono: values.perfilAlumno.telefono || undefined,
          contactos: values.perfilAlumno.contactos.map((contacto) => ({
            ...contacto,
            correo: contacto.correo || undefined,
          })),
          infoMedica: {
            tipoSangre: values.perfilAlumno.infoMedica.tipoSangre,
            ...(values.perfilAlumno.infoMedica.tieneCondicionMedica
              ? {
                  tieneCondicionMedica: true,
                  padecimiento: values.perfilAlumno.infoMedica.padecimiento || undefined,
                  medicamentos: values.perfilAlumno.infoMedica.medicamentos || undefined,
                  alergias: values.perfilAlumno.infoMedica.alergias || undefined,
                  tratamientoAdicional:
                    values.perfilAlumno.infoMedica.tratamientoAdicional || undefined,
                }
              : { tieneCondicionMedica: false }),
          },
        },
      }),
    onSuccess: () => {
      toast.success('Alumno actualizado.');
      onGuardadoConExito();
      onClose();
    },
    onError: (error) => {
      console.error('[EditarAlumnoModal] Error al editar alumno:', error);
      toast.error(resolverMensajeError(error, MENSAJES_ERROR_ALUMNO) ?? MENSAJE_ERROR_GENERICO);
    },
  });

  function onSubmit(values: AlumnoEditarFormOutput) {
    mutation.mutate(values);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mt-5 space-y-5" noValidate>
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="flex flex-col gap-5">
          <div>
            <label htmlFor="codigoExterno" className={LABEL_CLASS}>
              Código externo (opcional)
            </label>
            <input
              id="codigoExterno"
              type="text"
              disabled={mutation.isPending}
              className={INPUT_CLASS}
              {...register('codigoExterno')}
            />
            <FieldError message={errors.codigoExterno?.message} />
          </div>

          <InfoMedicaFieldset
            control={control}
            register={register}
            errors={errors}
            disabled={mutation.isPending}
            prefix="perfilAlumno"
            tieneCondicionMedica={Boolean(tieneCondicionMedica)}
          />
        </div>

        <DatosPersonalesFieldset
          register={register}
          errors={errors}
          disabled={mutation.isPending}
          prefix="perfilAlumno"
        />

        <fieldset className="space-y-3 rounded-lg border border-mist bg-bone/50 p-4">
          <legend className="text-sm font-semibold text-slate">Datos académicos</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="fechaNacimiento" className={LABEL_CLASS}>
                Fecha de nacimiento
              </label>
              <input
                id="fechaNacimiento"
                type="date"
                disabled={mutation.isPending}
                className={INPUT_CLASS}
                {...register('perfilAlumno.fechaNacimiento')}
              />
              <FieldError message={errors.perfilAlumno?.fechaNacimiento?.message} />
            </div>
            <div>
              <label htmlFor="carreraId" className={LABEL_CLASS}>
                Carrera
              </label>
              <Controller
                control={control}
                name="perfilAlumno.carreraId"
                render={({ field }) => (
                  <Select
                    id="carreraId"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    disabled={mutation.isPending || carrerasQuery.isLoading}
                    placeholder={
                      carrerasQuery.isLoading ? 'Cargando carreras…' : 'Selecciona una carrera'
                    }
                    options={(carrerasQuery.data ?? []).map((c) => ({
                      value: c.id,
                      label: `${c.clave} — ${c.nombre}`,
                    }))}
                  />
                )}
              />
              <FieldError message={errors.perfilAlumno?.carreraId?.message} />
            </div>
            <div>
              <label htmlFor="periodoIngreso" className={LABEL_CLASS}>
                Periodo de ingreso
              </label>
              <input
                id="periodoIngreso"
                type="text"
                disabled={mutation.isPending}
                className={INPUT_CLASS}
                {...register('perfilAlumno.periodoIngreso')}
              />
              <FieldError message={errors.perfilAlumno?.periodoIngreso?.message} />
            </div>
            <div>
              <label htmlFor="cuatrimestreActual" className={LABEL_CLASS}>
                Cuatrimestre actual
              </label>
              <input
                id="cuatrimestreActual"
                type="number"
                min={1}
                step={1}
                disabled={mutation.isPending}
                className={INPUT_CLASS}
                {...register('perfilAlumno.cuatrimestreActual')}
              />
              <FieldError message={errors.perfilAlumno?.cuatrimestreActual?.message} />
            </div>
          </div>
        </fieldset>
      </div>

      <ContactosFieldset
        control={control}
        register={register}
        errors={errors}
        disabled={mutation.isPending}
        prefix="perfilAlumno"
        mostrarTipo
      />

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={mutation.isPending}
          className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30 disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
        >
          {mutation.isPending ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Agregar la columna del lápiz y el modal a `app/admin/alumnos/page.tsx`**

Abrir `App/frontend/src/app/admin/alumnos/page.tsx`. Agregar el import del ícono (después del import de `Avatar`):

```typescript
import { Pencil } from 'lucide-react';
import { EditarAlumnoModal } from './EditarAlumnoModal';
```

Agregar el estado nuevo junto a `alumnoAResetear`/`alumnoAFotografiar` (dentro de `AdminAlumnosPage`):

```typescript
  const [alumnoAEditarDatos, setAlumnoAEditarDatos] =
    useState<PersonaListItemAlumno | null>(null);
```

Pasar el handler a `TablaAlumnos` (agregar `onEditarDatos={setAlumnoAEditarDatos}` a la llamada existente de `<TablaAlumnos ... />`).

Agregar el modal al final del JSX, junto a los otros 2 modales condicionales (`alumnoAResetear`/`alumnoAFotografiar`):

```tsx
      {alumnoAEditarDatos && (
        <EditarAlumnoModal
          usuarioId={alumnoAEditarDatos.usuarioId}
          onClose={() => setAlumnoAEditarDatos(null)}
          onGuardadoConExito={() =>
            queryClient.invalidateQueries({
              queryKey: ['admin', 'personas', 'ALUMNO'],
            })
          }
        />
      )}
```

En `TablaAlumnos`, agregar `onEditarDatos` al tipo de props:

```typescript
  onEditarDatos: (alumno: PersonaListItemAlumno) => void;
```

Y agregar una `<Th>` nueva AL PRINCIPIO del `<thead>` (antes de `<Th>Foto</Th>`), y una `<Td>` correspondiente al inicio de cada fila (antes de la `<Td>` de la foto):

```tsx
<Th></Th>
```

```tsx
              <Td>
                <button
                  type="button"
                  onClick={() => onEditarDatos(alumno)}
                  aria-label={`Editar datos de ${alumno.nombres}`}
                  className="text-slate/60 hover:text-navy"
                >
                  <Pencil className="size-4" />
                </button>
              </Td>
```

Actualizar `columns={8}` del `<SkeletonTableRows columns={8} />` (en el bloque `isLoading`) a `columns={9}` (una columna más).

- [ ] **Step 3: Verificar en el navegador**

Con backend + frontend corriendo (`npm run dev` en ambos), navegar a `/admin/alumnos`, click en el lápiz de una fila, confirmar que el modal abre con los datos precargados, editar un campo (ej. teléfono), guardar, confirmar el toast de éxito y que la tabla refleja el cambio si es visible en columnas (la mayoría de los campos editados no son columnas de la tabla — verificar directo contra `GET /perfil` o reabriendo el modal de esa misma fila).

- [ ] **Step 4: Typecheck + lint + build**

Run: `cd App/frontend && npx tsc --noEmit`
Expected: sin errores.

Run: `cd App/frontend && npm run lint`
Expected: 0 errores (warnings preexistentes sin relación son aceptables).

Run: `cd App/frontend && npm run build`
Expected: build exitoso.

- [ ] **Step 5: Commit**

```bash
git add App/frontend/src/app/admin/alumnos/EditarAlumnoModal.tsx App/frontend/src/app/admin/alumnos/page.tsx
git commit -m "feat(frontend): modal de edición de datos de alumno"
```

---

### Task 5: Frontend — modal de edición de maestro

**Files:**
- Create: `App/frontend/src/app/admin/maestros/EditarMaestroModal.tsx`
- Modify: `App/frontend/src/app/admin/maestros/page.tsx`

**Interfaces:**
- Consumes: igual que Task 4, más el `perfilMaestroSchema` con `tipoContratacion` condicional — copiar EXACTO el `superRefine` de `app/admin/maestros/nuevo/page.tsx` (líneas 72-138 de ese archivo, ver Task de referencia arriba en este plan).
- Produces: `EditarMaestroModal`, consumido por `app/admin/maestros/page.tsx` en este mismo task.

- [ ] **Step 1: Crear el modal**

Crear `App/frontend/src/app/admin/maestros/EditarMaestroModal.tsx` — mismo patrón que `EditarAlumnoModal.tsx` (Task 4), con estas diferencias:

1. El schema es el `perfilMaestroSchema` (con su `.superRefine` de `tipoContratacion`) copiado literal de `App/frontend/src/app/admin/maestros/nuevo/page.tsx` líneas 72-138, envuelto en:

```typescript
const maestroEditarSchema = z.object({
  codigoExterno: z.string().optional(),
  perfilMaestro: perfilMaestroSchema,
});
type MaestroEditarFormInput = z.infer<typeof maestroEditarSchema>;
```

(sin el `z.input`/`z.output` separado de alumno — `perfilMaestroSchema` no usa `z.coerce`, mismo criterio que `app/admin/maestros/nuevo/page.tsx` ya hace con `MaestroFormValues`).

2. `valoresIniciales(persona: PersonaParaEditar)` mapea `persona.perfilMaestro!` (en vez de `perfilAlumno`) a los mismos campos que `DEFAULT_VALUES` de `maestros/nuevo/page.tsx`, PERO con los valores reales en vez de vacíos:

```typescript
function valoresIniciales(persona: PersonaParaEditar): MaestroEditarFormInput {
  const perfil = persona.perfilMaestro!;
  return {
    codigoExterno: persona.codigoExterno ?? '',
    perfilMaestro: {
      nombres: perfil.nombres,
      apellidoPaterno: perfil.apellidoPaterno,
      apellidoMaterno: perfil.apellidoMaterno ?? '',
      curp: perfil.curp,
      cedulaProfesional: perfil.cedulaProfesional ?? '',
      correoPersonal: perfil.correoPersonal,
      telefono: perfil.telefono,
      fechaContratacion: perfil.fechaContratacion,
      tipoContratacion: (perfil.tipoContratacion ??
        'BASE') as MaestroEditarFormInput['perfilMaestro']['tipoContratacion'],
      diasTemporal: perfil.diasTemporal ? String(perfil.diasTemporal) : '',
      contratoFechaInicio: perfil.contratoFechaInicio ?? '',
      contratoFechaFin: perfil.contratoFechaFin ?? '',
      contactos:
        persona.contactos.length > 0
          ? persona.contactos.map((c) => ({
              nombre: c.nombre,
              telefono: c.telefono,
              correo: c.correo ?? '',
              parentesco: c.parentesco,
            }))
          : [{ nombre: '', telefono: '', correo: '', parentesco: '' }],
      infoMedica: {
        tieneCondicionMedica: persona.infoMedica.tieneCondicionMedica,
        tipoSangre: (persona.infoMedica.tipoSangre ??
          '') as MaestroEditarFormInput['perfilMaestro']['infoMedica']['tipoSangre'],
        padecimiento: persona.infoMedica.padecimiento ?? '',
        medicamentos: persona.infoMedica.medicamentos ?? '',
        alergias: persona.infoMedica.alergias ?? '',
        tratamientoAdicional: persona.infoMedica.tratamientoAdicional ?? '',
      },
    },
  };
}
```

3. `DatosPersonalesFieldset` con `curpOpcional={false}` `telefonoOpcional={false}` (igual que `maestros/nuevo`).

4. El fieldset "Datos laborales" (cédula/fechaContratación/tipoContratación + condicionales) es COPIA LITERAL del bloque `<fieldset>` de `app/admin/maestros/nuevo/page.tsx` líneas 293-399 (mismo JSX, mismos `register`/`Controller` paths — no cambia nada porque el prefix `perfilMaestro` es el mismo).

5. `mutationFn` llama `editarPersona(usuarioId, { codigoExterno: ..., perfilMaestro: {...} })` — mismo shape de transformación (`diasTemporal`/`contratoFecha*` condicionados a `tipoContratacion`) que el `mutationFn` de `maestros/nuevo/page.tsx` líneas 200-237, cambiando `crearMaestro` por `editarPersona(usuarioId, ...)`.

6. Sin `ResultadoAltaPersona` — al éxito, `toast.success('Maestro actualizado.')` + `onGuardadoConExito()` + `onClose()`, igual que `EditarAlumnoModal`.

7. El chrome del modal (overlay, `max-w-3xl`, botones Cancelar/Guardar) es IDÉNTICO al de `EditarAlumnoModal.tsx` — cópialo tal cual, solo cambia el título (`"Editar maestro"`) y los fieldsets internos.

- [ ] **Step 2: Agregar la columna del lápiz y el modal a `app/admin/maestros/page.tsx`**

Mismo patrón que Task 4 Step 2, adaptado a maestro:
- Import `Pencil` de `lucide-react` + `EditarMaestroModal` de `./EditarMaestroModal`.
- Estado `maestroAEditarDatos` (distinto de `maestroAEditar`, que ya existe y abre `CambiarEstatusModal` — NO reusar ese nombre).
- Prop `onEditarDatos` en `TablaMaestros`.
- Columna `<Th></Th>` + `<Td>` con el botón de lápiz, al inicio de la tabla.
- `columns={7}` → `columns={8}` en `SkeletonTableRows`.
- Modal `<EditarMaestroModal usuarioId={maestroAEditarDatos.usuarioId} onClose={...} onGuardadoConExito={() => queryClient.invalidateQueries({ queryKey: ['admin', 'personas', 'MAESTRO'] })} />` junto a los otros modales condicionales.

- [ ] **Step 3: Verificar en el navegador**

Navegar a `/admin/maestros`, abrir el modal desde el lápiz, cambiar `tipoContratacion` de `BASE` a `TEMPORAL` y confirmar que aparece el campo `diasTemporal`, guardar, confirmar toast de éxito.

- [ ] **Step 4: Typecheck + lint + build**

Run: `cd App/frontend && npx tsc --noEmit && npm run lint && npm run build`
Expected: los 3 comandos sin errores.

- [ ] **Step 5: Commit**

```bash
git add App/frontend/src/app/admin/maestros/EditarMaestroModal.tsx App/frontend/src/app/admin/maestros/page.tsx
git commit -m "feat(frontend): modal de edición de datos de maestro"
```

---

### Task 6: Frontend — modal de edición de administrativo (+ jerarquía de nivelPermiso)

**Files:**
- Create: `App/frontend/src/app/admin/administrativos/EditarAdministrativoModal.tsx`
- Modify: `App/frontend/src/app/admin/administrativos/page.tsx`

**Interfaces:**
- Consumes: igual que Task 4/5, más `NivelPermiso`/`JERARQUIA_NIVEL_PERMISO` (ya definido en `app/admin/administrativos/page.tsx`, línea 70).
- Produces: `EditarAdministrativoModal`, consumido por `app/admin/administrativos/page.tsx` en este mismo task.

- [ ] **Step 1: Crear el modal**

Crear `App/frontend/src/app/admin/administrativos/EditarAdministrativoModal.tsx` — mismo patrón que Task 4/5, con estas diferencias:

1. Schema = copia literal de `administrativoSchema` de `app/admin/administrativos/nuevo/page.tsx` líneas 80-102, envuelto igual (`codigoExterno` + `perfilAdministrativo`).

2. `valoresIniciales(persona)` mapea `persona.perfilAdministrativo!` — incluyendo `nivelPermiso: perfil.nivelPermiso` (SIEMPRE presente acá, a diferencia del alta donde es opcional-con-default: en edición ya existe un valor real).

3. Fieldset "Datos laborales" = copia literal de `app/admin/administrativos/nuevo/page.tsx` líneas 236-302 (fechaContratación + puesto + nivelPermiso), MISMO texto de ayuda bajo el `<select>` de nivel ("Solo puedes asignar un nivel igual o menor al tuyo…").

4. El componente recibe una prop adicional `nivelPermisoActor: NivelPermiso | undefined` (viene de `app/admin/administrativos/page.tsx`, que ya la calcula desde `GET /perfil`) — SOLO para deshabilitar las opciones del `<select>` de `nivelPermiso` que el actor no puede asignar (UX preventiva, el backend es la fuente de verdad real, mismo criterio que el comentario de `JERARQUIA_NIVEL_PERMISO` en `page.tsx`). El `Select` de este árbol (`components/admin/ui/persona-alta/Select.tsx`) no soporta deshabilitar opciones individuales — en vez de modificarlo, filtra `NIVEL_PERMISO_OPCIONES` a las que el actor SÍ puede asignar antes de pasarlas a `options`:

```typescript
const JERARQUIA_NIVEL_PERMISO: Record<string, number> = {
  AUXILIAR: 0,
  ADMIN: 1,
  SUPER_ADMIN: 2,
};

function opcionesNivelPermisoDisponibles(
  nivelPermisoActor: string | undefined,
): readonly ('SUPER_ADMIN' | 'ADMIN' | 'AUXILIAR')[] {
  if (nivelPermisoActor === undefined) return NIVEL_PERMISO_OPCIONES;
  const rangoActor = JERARQUIA_NIVEL_PERMISO[nivelPermisoActor];
  return NIVEL_PERMISO_OPCIONES.filter(
    (nivel) => JERARQUIA_NIVEL_PERMISO[nivel] <= rangoActor,
  );
}
```

Y en el `<Controller name="perfilAdministrativo.nivelPermiso" ...>`, usar `options={opcionesNivelPermisoDisponibles(nivelPermisoActor).map((valor) => ({ value: valor, label: valor }))}` en vez de `NIVEL_PERMISO_OPCIONES.map(...)` directo.

5. `mutationFn` llama `editarPersona(usuarioId, { codigoExterno: ..., perfilAdministrativo: {...} })`, mismo shape que el `mutationFn` de `administrativos/nuevo/page.tsx` líneas 150-178 (cambiando `crearAdministrativo` por `editarPersona(usuarioId, ...)`), SIN el `nivelPermiso: values.perfilAdministrativo.nivelPermiso || undefined` (acá `nivelPermiso` siempre tiene un valor real seleccionado, no hace falta el fallback a `undefined`).

6. Chrome del modal idéntico a `EditarAlumnoModal.tsx` (overlay, ancho, botones) — título `"Editar administrativo"`.

7. Manejo de error: agregar `NIVEL_PERMISO_INSUFICIENTE` al `Record` de mensajes específicos (mismo texto que `administrativos/nuevo/page.tsx` línea 76-77, adaptado: `'No tienes permiso suficiente para editar a este administrativo con ese nivel de permiso.'`).

- [ ] **Step 2: Agregar la columna del lápiz, el modal y el gate de jerarquía a `app/admin/administrativos/page.tsx`**

Mismo patrón que Task 4/5 Step 2, con una diferencia importante: el gate de visibilidad del lápiz NO reusa `puedeGestionarAdministrativo` tal cual (esa constante excluye la fila del propio actor — `administrativo.usuarioId !== usuarioIdActor` — porque "Cambiar estatus"/"Restablecer contraseña" no tienen sentido sobre uno mismo). Editar los PROPIOS datos SÍ tiene sentido (corregir tu propio typo) — el gate de "Editar datos" es solo la jerarquía, sin la exclusión de self:

```typescript
const puedeEditarDatos =
  nivelPermisoActor === undefined ||
  JERARQUIA_NIVEL_PERMISO[nivelPermisoActor] >=
    JERARQUIA_NIVEL_PERMISO[administrativo.nivelPermiso];
```

(calculado dentro del `.map()` de `TablaAdministrativos`, junto a `puedeGestionarAdministrativo` — mismo bloque, variable nueva).

- Import `Pencil` de `lucide-react` + `EditarAdministrativoModal` de `./EditarAdministrativoModal`.
- Estado `administrativoAEditarDatos` (distinto de `administrativoAEditar`, que ya existe y abre `CambiarEstatusModal` — NO reusar ese nombre, mismo cuidado que Task 5).
- Prop `onEditarDatos` en `TablaAdministrativos`, envuelta en `{puedeEditarDatos && (<button onClick={() => onEditarDatos(administrativo)}>...</button>)}` — el botón del lápiz vive en la MISMA `<Td>` de "Acciones" que "Cambiar estatus"/"Restablecer contraseña" (no en la columna nueva del inicio, ya que acá el gate de jerarquía es específico de esta fila y no siempre se muestra — a diferencia de alumno/maestro donde el lápiz SIEMPRE se muestra en una columna dedicada al inicio). Decisión de consistencia visual: para mantener las 3 tablas con el mismo patrón (lápiz como primera columna, pedido explícito del usuario), el lápiz SÍ va en una `<Th></Th>`/`<Td>` al inicio como en alumno/maestro, pero el `<button>` dentro de esa `<Td>` se envuelve en `{puedeEditarDatos && (...)}` (celda vacía si no aplica, igual que ya hace la columna "Acciones" con `puedeGestionarAdministrativo`).
- `columns={7}` → `columns={8}` en `SkeletonTableRows`.
- Modal:

```tsx
      {administrativoAEditarDatos && (
        <EditarAdministrativoModal
          usuarioId={administrativoAEditarDatos.usuarioId}
          nivelPermisoActor={perfilActorQuery.data?.administrativo?.nivelPermiso}
          onClose={() => setAdministrativoAEditarDatos(null)}
          onGuardadoConExito={() =>
            queryClient.invalidateQueries({
              queryKey: ['admin', 'personas', 'ADMINISTRATIVO'],
            })
          }
        />
      )}
```

- [ ] **Step 3: Verificar en el navegador — incluye el caso de jerarquía**

Con backend + frontend corriendo:
1. Como un admin con nivel `SUPER_ADMIN`/`ADMIN` (ej. `ana.canul@cesp-merida.edu.mx` si tiene ese nivel), abrir `/admin/administrativos`, confirmar que el lápiz aparece en todas las filas visibles según jerarquía, editar un administrativo (incluyendo cambiar su propio `puesto`/`teléfono` en su propia fila), guardar, confirmar toast.
2. Cambiar el `nivelPermiso` de un administrativo y confirmar que el cambio se refleja en la columna "Nivel de permiso" de la tabla tras el refresh.

- [ ] **Step 4: Typecheck + lint + build**

Run: `cd App/frontend && npx tsc --noEmit && npm run lint && npm run build`
Expected: los 3 comandos sin errores.

- [ ] **Step 5: Commit**

```bash
git add App/frontend/src/app/admin/administrativos/EditarAdministrativoModal.tsx App/frontend/src/app/admin/administrativos/page.tsx
git commit -m "feat(frontend): modal de edición de datos de administrativo"
```

---

## Después de las 6 tasks

Actualizar `CLAUDE.md` raíz (Fase actual + Contrato de API, mismo criterio que toda feature ad hoc de este proyecto) y `documentacion_de_agentes/ESTADO.md` — **no lo hagas dentro de ninguna de las 6 tasks**, es un paso de cierre aparte una vez que la revisión final de rama (whole-branch) confirme que no hay hallazgos que cambien el contrato. Pedir verificación manual en navegador de las 3 tablas al usuario antes de dar la feature por completa.
