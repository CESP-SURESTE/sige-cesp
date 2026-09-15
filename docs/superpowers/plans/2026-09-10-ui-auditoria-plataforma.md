# UI de auditoría de plataforma — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar al `AdminPlataforma` una pantalla cross-sede para consultar `RegistroAuditoria` con filtros y detalle del `Json`, más un widget de actividad reciente en el dashboard de plataforma.

**Architecture:** Un endpoint de solo lectura `GET /platform-admin/auditoria` (paginado, resolución de actor/sede en batch) detrás de `PlatformAdminGuard`. En el frontend, un nuevo helper `platformFetchPaginated` (el actual `platformFetch` descarta `page/limit/total`), un cliente de API, un componente de navegación compartido dentro del árbol `app/plataforma/`, la página de auditoría con su modal de detalle, y una card en el dashboard.

**Tech Stack:** NestJS + Prisma 6 + class-validator (backend); Next.js 16 (App Router, client components) + React Query + Tailwind (frontend). Jest + supertest para e2e de backend. El frontend NO tiene runner de tests en este repo — su gate es `pnpm build` + `pnpm lint` + verificación manual (mismo criterio que todos los planes previos).

## Global Constraints

- **Regla 1** — nunca persistir datos calculables. `actor.nombre`, `actor.tipo`, `sede.nombre` se derivan por request, no se guardan.
- **Regla 5** — `RegistroAuditoria` es solo inserción. Este trabajo solo hace `findMany`/`count`; ningún `create`/`update`/`delete` sobre esa tabla en código de producción.
- **Regla 11** — árboles de frontend aislados. `app/plataforma/` no importa de `app/admin/` ni `app/alumno/`; los componentes nuevos viven dentro de `app/plataforma/`.
- **Regla 12** — todo catch loguea con `console.error` (o `console.log` para casos esperados) el error completo antes de responder/propagar, backend y frontend.
- **Regla 14** — al verificar contra la DB real, máx. 3 escrituras antes de un veredicto. Los `afterAll` de e2e limpian **acotado por `id`**, nunca por patrón de nombre/email.
- **Contrato de API** — JSON camelCase; fechas ISO 8601; éxito `{ data: ... }` (+ `page`/`limit`/`total` en listas paginadas); error `{ error, code }`. Sin códigos de error nuevos — reutiliza `VALIDATION_ERROR` y `UNAUTHORIZED`.
- **Convención de paginación del repo** — `page` default `1` (entero ≥ 1), `limit` default `20` (entero 1–100); fuera de rango → `400 VALIDATION_ERROR`. Mismo shape que `GET /personas` / `GET /grupos`.
- **Orden fijo** — `fecha desc`. No hay parámetro de orden.
- **Sin migración** — no hay cambios de `schema.prisma`.
- **Paleta del árbol plataforma** — tokens Tailwind `navy`, `navy-deep`, `slate`, `crimson`, `mist`, `bone`; tipografía `font-display`. Contenedor de página: `<main className="mx-auto max-w-4xl p-8">`.

---

## File Structure

**Backend (`App/backend/`):**
- `src/platform-admin/dto/listar-auditoria-query.dto.ts` — **crear**. DTO de query params con validación class-validator.
- `src/platform-admin/platform-admin.service.ts` — **modificar**. Nuevo método `listarAuditoria` + interfaces `RegistroAuditoriaItem` / `ListaAuditoria`.
- `src/platform-admin/platform-admin.controller.ts` — **modificar**. Nuevo método `auditoria()`.
- `test/platform-admin-auditoria.e2e-spec.ts` — **crear**. e2e del endpoint.

**Frontend (`App/frontend/`):**
- `src/lib/api/platform-http.ts` — **modificar**. Nueva función `platformFetchPaginated`.
- `src/lib/api/auditoria-plataforma.ts` — **crear**. Tipos, constantes (`ACCIONES_AUDITORIA`, `ENTIDADES_AUDITABLES`), `listarAuditoria`.
- `src/app/plataforma/PlataformaNav.tsx` — **crear**. Header/nav compartido del árbol.
- `src/app/plataforma/page.tsx` — **modificar**. Refactor a `PlataformaNav` + widget "Actividad reciente".
- `src/app/plataforma/sedes/page.tsx` — **modificar**. Refactor a `PlataformaNav`.
- `src/app/plataforma/auditoria/page.tsx` — **crear**. Página principal.
- `src/app/plataforma/auditoria/DetalleAuditoriaModal.tsx` — **crear**. Modal de detalle.

---

## Task 1: Backend — endpoint `GET /platform-admin/auditoria`

**Files:**
- Create: `App/backend/src/platform-admin/dto/listar-auditoria-query.dto.ts`
- Modify: `App/backend/src/platform-admin/platform-admin.service.ts`
- Modify: `App/backend/src/platform-admin/platform-admin.controller.ts`
- Test: `App/backend/test/platform-admin-auditoria.e2e-spec.ts`

**Interfaces:**
- Consumes: `PlatformAdminGuard` (`src/common/guards/platform-admin.guard.ts`), `PrismaService`, `firmarPlatformAdminToken` / `hashPassword` (para el test).
- Produces (frontend Task 2 replica estos tipos):
  ```ts
  type ActorTipo = 'USUARIO' | 'PLATAFORMA';
  interface RegistroAuditoriaItem {
    id: string;
    fecha: string;              // ISO 8601
    accion: AccionAuditoria;    // enum de @prisma/client
    entidad: string;
    entidadId: string;
    actor: {
      id: string;
      tipo: ActorTipo;
      nombre: string;
      rol: 'ALUMNO' | 'MAESTRO' | 'ADMINISTRATIVO' | null;
    };
    sede: { id: string; nombre: string } | null;
    detalle: unknown | null;
  }
  interface ListaAuditoria {
    data: RegistroAuditoriaItem[];
    page: number;
    limit: number;
    total: number;
  }
  ```
- Endpoint: `GET /platform-admin/auditoria` con query `sedeId?`, `accion?`, `entidad?`, `actorId?`, `desde?` (`YYYY-MM-DD`), `hasta?` (`YYYY-MM-DD`), `page?`, `limit?`. Respuesta `200 { data, page, limit, total }`.

---

- [ ] **Step 1: Escribir el e2e que falla**

Crear `App/backend/test/platform-admin-auditoria.e2e-spec.ts`. Sigue el andamiaje de `test/sedes-crud.e2e-spec.ts` (imports, `configureApp`, admin de plataforma de prueba, token).

```ts
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccionAuditoria, RolUsuario } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/load-env';
import { firmarPlatformAdminToken } from '../src/platform-admin/platform-admin-jwt.util';
import { hashPassword } from '../src/platform-admin/password.util';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup-app';

loadEnv();

interface ErrorBody { error: string; code: string }
interface ActorShape { id: string; tipo: 'USUARIO' | 'PLATAFORMA'; nombre: string; rol: string | null }
interface ItemShape {
  id: string; fecha: string; accion: string; entidad: string; entidadId: string;
  actor: ActorShape; sede: { id: string; nombre: string } | null; detalle: unknown;
}
interface ListaBody { data: ItemShape[]; page: number; limit: number; total: number }

describe('GET /platform-admin/auditoria (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;
  const emailAdmin = 'e2e.auditoria@nexo-sd.mx';

  // ids que crea este spec — se borran acotados en afterAll (regla 14)
  const idsAuditoria: string[] = [];
  let sedeAId: string;
  let sedeBId: string;
  let usuarioActorId: string;
  let adminActorId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = moduleFixture.get(PrismaService);

    await prisma.adminPlataforma.deleteMany({ where: { email: emailAdmin } });
    const admin = await prisma.adminPlataforma.create({
      data: { email: emailAdmin, passwordHash: await hashPassword('password-e2e-123'), nombre: 'E2E Auditoria' },
    });
    adminActorId = admin.id;
    token = await firmarPlatformAdminToken({ sub: admin.id, email: admin.email });

    const sedeA = await prisma.sede.create({
      data: { nombre: `Sede E2E Auditoria A ${Date.now()}`, direccion: 'x', ubicacionReferencia: 'x', telefono: '9990000000' },
    });
    const sedeB = await prisma.sede.create({
      data: { nombre: `Sede E2E Auditoria B ${Date.now()}`, direccion: 'x', ubicacionReferencia: 'x', telefono: '9990000001' },
    });
    sedeAId = sedeA.id;
    sedeBId = sedeB.id;

    // Un Usuario real de sede A para usar como actor tipo USUARIO.
    const usuario = await prisma.usuario.create({
      data: {
        id: `00000000-0000-4000-8000-${Date.now().toString().slice(-12).padStart(12, '0')}`,
        email: `e2e.auditoria.actor.${Date.now()}@acceso.cesp.edu.mx`,
        rol: RolUsuario.ADMINISTRATIVO,
        activo: true,
        sedeId: sedeAId,
      },
    });
    usuarioActorId = usuario.id;
    await prisma.perfilAdministrativo.create({
      data: {
        usuarioId: usuario.id,
        nombres: 'Actor', apellidoPaterno: 'De', apellidoMaterno: 'Prueba',
        curp: `AEDP${Date.now().toString().slice(-14)}`,
        correoPersonal: 'actor.prueba@example.com',
        telefono: '9990000002',
        puesto: 'AUXILIAR',
        nivelPermiso: 'AUXILIAR',
        fechaContratacion: new Date('2020-01-01'),
        estatus: 'ACTIVO',
      },
    });

    // 6 registros de auditoría de prueba.
    const base = [
      { actor: 'usuario', sedeId: sedeAId, accion: AccionAuditoria.ALTA, entidad: 'Carrera', detalle: { antes: null, despues: { nombre: 'X' } } },
      { actor: 'usuario', sedeId: sedeAId, accion: AccionAuditoria.EDICION, entidad: 'Carrera', detalle: null },
      { actor: 'usuario', sedeId: sedeBId, accion: AccionAuditoria.ELIMINACION, entidad: 'Salon', detalle: null },
      { actor: 'admin', sedeId: sedeAId, accion: AccionAuditoria.ALTA, entidad: 'Sede', detalle: { nombre: 'Sede A' } },
      { actor: 'admin', sedeId: sedeBId, accion: AccionAuditoria.EDICION, entidad: 'Sede', detalle: null },
      { actor: 'admin', sedeId: null, accion: AccionAuditoria.EDICION, entidad: 'Sede', detalle: null }, // sede borrada -> sedeId null
    ];
    for (const r of base) {
      const row = await prisma.registroAuditoria.create({
        data: {
          usuarioId: r.actor === 'usuario' ? usuarioActorId : null,
          adminPlataformaId: r.actor === 'admin' ? adminActorId : null,
          sedeId: r.sedeId,
          accion: r.accion,
          entidad: r.entidad,
          entidadId: `10000000-0000-4000-8000-000000000001`,
          detalle: r.detalle === null ? undefined : r.detalle,
        },
      });
      idsAuditoria.push(row.id);
    }
  });

  afterAll(async () => {
    await prisma.registroAuditoria.deleteMany({ where: { id: { in: idsAuditoria } } });
    await prisma.perfilAdministrativo.deleteMany({ where: { usuarioId: usuarioActorId } });
    await prisma.usuario.deleteMany({ where: { id: usuarioActorId } });
    await prisma.sede.deleteMany({ where: { id: { in: [sedeAId, sedeBId] } } });
    await prisma.adminPlataforma.deleteMany({ where: { email: emailAdmin } });
    await app.close();
  });

  function get(qs = '') {
    return request(app.getHttpServer())
      .get(`/platform-admin/auditoria${qs}`)
      .set('Authorization', `Bearer ${token}`);
  }

  it('sin token -> 401', async () => {
    const res = await request(app.getHttpServer()).get('/platform-admin/auditoria');
    expect(res.status).toBe(401);
  });

  it('sin filtros -> pagina desc y total >= 6', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = res.body as ListaBody;
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.total).toBeGreaterThanOrEqual(6);
    // orden fecha desc
    const fechas = body.data.map((r) => new Date(r.fecha).getTime());
    expect([...fechas].sort((a, b) => b - a)).toEqual(fechas);
  });

  it('filtra por sedeId', async () => {
    const res = await get(`?sedeId=${sedeBId}&limit=100`);
    expect(res.status).toBe(200);
    const body = res.body as ListaBody;
    const mios = body.data.filter((r) => idsAuditoria.includes(r.id));
    expect(mios.length).toBe(2); // los 2 de sedeB con sedeId no-null
    expect(mios.every((r) => r.sede?.id === sedeBId)).toBe(true);
  });

  it('filtra por accion', async () => {
    const res = await get(`?accion=ELIMINACION&limit=100`);
    const body = res.body as ListaBody;
    const mios = body.data.filter((r) => idsAuditoria.includes(r.id));
    expect(mios.length).toBe(1);
    expect(mios[0].entidad).toBe('Salon');
  });

  it('filtra por entidad', async () => {
    const res = await get(`?entidad=Carrera&limit=100`);
    const body = res.body as ListaBody;
    const mios = body.data.filter((r) => idsAuditoria.includes(r.id));
    expect(mios.length).toBe(2);
  });

  it('filtra por actorId (usuario y admin de plataforma)', async () => {
    const resU = await get(`?actorId=${usuarioActorId}&limit=100`);
    const misU = (resU.body as ListaBody).data.filter((r) => idsAuditoria.includes(r.id));
    expect(misU.length).toBe(3);
    expect(misU.every((r) => r.actor.tipo === 'USUARIO' && r.actor.id === usuarioActorId)).toBe(true);
    expect(misU.every((r) => r.actor.nombre === 'Actor De Prueba' && r.actor.rol === 'ADMINISTRATIVO')).toBe(true);

    const resA = await get(`?actorId=${adminActorId}&limit=100`);
    const misA = (resA.body as ListaBody).data.filter((r) => idsAuditoria.includes(r.id));
    expect(misA.length).toBe(3);
    expect(misA.every((r) => r.actor.tipo === 'PLATAFORMA' && r.actor.rol === null)).toBe(true);
    expect(misA.every((r) => r.actor.nombre === 'E2E Auditoria')).toBe(true);
  });

  it('fila con sedeId null -> sede: null', async () => {
    const res = await get(`?actorId=${adminActorId}&limit=100`);
    const mios = (res.body as ListaBody).data.filter((r) => idsAuditoria.includes(r.id));
    expect(mios.some((r) => r.sede === null)).toBe(true);
  });

  it('filtra por rango de fechas', async () => {
    const hoy = new Date().toISOString().slice(0, 10);
    const res = await get(`?desde=${hoy}&hasta=${hoy}&limit=100`);
    expect(res.status).toBe(200);
    const mios = (res.body as ListaBody).data.filter((r) => idsAuditoria.includes(r.id));
    expect(mios.length).toBe(6); // todos creados hoy
  });

  it('hasta < desde -> 400 VALIDATION_ERROR', async () => {
    const res = await get(`?desde=2026-02-01&hasta=2026-01-01`);
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('accion inválida -> 400', async () => {
    const res = await get(`?accion=NO_EXISTE`);
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('page=0 -> 400 ; limit=101 -> 400', async () => {
    expect((await get(`?page=0`)).status).toBe(400);
    expect((await get(`?limit=101`)).status).toBe(400);
  });

  it('detalle Json se devuelve tal cual', async () => {
    const res = await get(`?entidad=Carrera&accion=ALTA&limit=100`);
    const mio = (res.body as ListaBody).data.find((r) => idsAuditoria.includes(r.id));
    expect(mio?.detalle).toEqual({ antes: null, despues: { nombre: 'X' } });
  });
});
```

> Nota sobre el `id` del `Usuario` de prueba: `Usuario.id` normalmente viene de Supabase Auth (regla 9), pero en e2e se crea directo con un UUID v4 sintético — mismo atajo que usan otros specs del repo (p. ej. los de `personas`/`grupos`). Si `perfilAdministrativo.create` exige enums exactos, ver los valores válidos en `schema.prisma` (`PuestoAdministrativo`, `NivelPermiso`, `EstatusEmpleado`).

- [ ] **Step 2: Correr el e2e y verificar que falla**

Run: `cd App/backend && npx jest --config test/jest-e2e.json platform-admin-auditoria`
Expected: FALLA — la ruta `/platform-admin/auditoria` no existe todavía (404 en vez de 200/400).

- [ ] **Step 3: Crear el DTO de query**

Crear `App/backend/src/platform-admin/dto/listar-auditoria-query.dto.ts`:

```ts
import { AccionAuditoria } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsNotEmpty,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class ListarAuditoriaQueryDto {
  @IsOptional()
  @IsUUID()
  sedeId?: string;

  @IsOptional()
  @IsEnum(AccionAuditoria)
  accion?: AccionAuditoria;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  entidad?: string;

  @IsOptional()
  @IsUUID()
  actorId?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'desde debe ser YYYY-MM-DD' })
  desde?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'hasta debe ser YYYY-MM-DD' })
  hasta?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
```

> El `ValidationPipe` global del repo (ver `setup-app.ts`) ya normaliza los errores de class-validator al `{ error, code: 'VALIDATION_ERROR' }` del contrato — no hay que hacer nada extra para eso. Verifica que `configureApp`/`setup-app.ts` aplique `whitelist: true` y `forbidNonWhitelisted: true` (es el patrón del repo); si es así, un query param desconocido también da 400, lo cual está bien.

- [ ] **Step 4: Implementar `listarAuditoria` en el service**

Modificar `App/backend/src/platform-admin/platform-admin.service.ts`. Agregar imports que falten (`AccionAuditoria`, `Prisma` de `@prisma/client`) y, después de `resumenGlobal`, el método:

```ts
export type ActorTipo = 'USUARIO' | 'PLATAFORMA';

export interface RegistroAuditoriaItem {
  id: string;
  fecha: string;
  accion: AccionAuditoria;
  entidad: string;
  entidadId: string;
  actor: {
    id: string;
    tipo: ActorTipo;
    nombre: string;
    rol: RolUsuario | null;
  };
  sede: { id: string; nombre: string } | null;
  detalle: unknown | null;
}

export interface ListaAuditoria {
  data: RegistroAuditoriaItem[];
  page: number;
  limit: number;
  total: number;
}

export interface FiltrosAuditoria {
  sedeId?: string;
  accion?: AccionAuditoria;
  entidad?: string;
  actorId?: string;
  desde?: string;
  hasta?: string;
  page?: number;
  limit?: number;
}
```

```ts
  async listarAuditoria(filtros: FiltrosAuditoria): Promise<ListaAuditoria> {
    const page = filtros.page ?? 1;
    const limit = filtros.limit ?? 20;

    // Regla cruzada: hasta < desde -> 400. (El formato ya lo validó el DTO.)
    if (filtros.desde && filtros.hasta && filtros.hasta < filtros.desde) {
      throw new BadRequestException({
        error: 'El parámetro "hasta" no puede ser anterior a "desde"',
        code: 'VALIDATION_ERROR',
      });
    }

    const where: Prisma.RegistroAuditoriaWhereInput = {};
    if (filtros.sedeId) where.sedeId = filtros.sedeId;
    if (filtros.accion) where.accion = filtros.accion;
    if (filtros.entidad) where.entidad = filtros.entidad;
    if (filtros.actorId) {
      where.OR = [
        { usuarioId: filtros.actorId },
        { adminPlataformaId: filtros.actorId },
      ];
    }
    if (filtros.desde || filtros.hasta) {
      const fecha: Prisma.DateTimeFilter = {};
      if (filtros.desde) fecha.gte = new Date(`${filtros.desde}T00:00:00.000Z`);
      if (filtros.hasta) {
        const d = new Date(`${filtros.hasta}T00:00:00.000Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        fecha.lt = d; // rango [desde, hasta] inclusivo por día, en UTC
      }
      where.fecha = fecha;
    }

    const [filas, total] = await Promise.all([
      this.prisma.registroAuditoria.findMany({
        where,
        orderBy: { fecha: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          fecha: true,
          accion: true,
          entidad: true,
          entidadId: true,
          detalle: true,
          usuarioId: true,
          adminPlataformaId: true,
          sede: { select: { id: true, nombre: true } },
        },
      }),
      this.prisma.registroAuditoria.count({ where }),
    ]);

    // Resolución de actor en batch (sin N+1).
    const usuarioIds = [
      ...new Set(filas.map((f) => f.usuarioId).filter((x): x is string => !!x)),
    ];
    const adminIds = [
      ...new Set(
        filas.map((f) => f.adminPlataformaId).filter((x): x is string => !!x),
      ),
    ];

    const [usuarios, admins] = await Promise.all([
      usuarioIds.length
        ? this.prisma.usuario.findMany({
            where: { id: { in: usuarioIds } },
            select: {
              id: true,
              rol: true,
              email: true,
              perfilAlumno: {
                select: { nombres: true, apellidoPaterno: true, apellidoMaterno: true },
              },
              perfilMaestro: {
                select: { nombres: true, apellidoPaterno: true, apellidoMaterno: true },
              },
              perfilAdministrativo: {
                select: { nombres: true, apellidoPaterno: true, apellidoMaterno: true },
              },
            },
          })
        : Promise.resolve([]),
      adminIds.length
        ? this.prisma.adminPlataforma.findMany({
            where: { id: { in: adminIds } },
            select: { id: true, nombre: true },
          })
        : Promise.resolve([]),
    ]);

    const nombreUsuario = new Map<
      string,
      { nombre: string; rol: RolUsuario }
    >();
    for (const u of usuarios) {
      const p = u.perfilAlumno ?? u.perfilMaestro ?? u.perfilAdministrativo;
      const nombre = p
        ? `${p.nombres} ${p.apellidoPaterno} ${p.apellidoMaterno}`.trim()
        : u.email;
      nombreUsuario.set(u.id, { nombre, rol: u.rol });
    }
    const nombreAdmin = new Map(admins.map((a) => [a.id, a.nombre]));

    const data: RegistroAuditoriaItem[] = filas.map((f) => {
      let actor: RegistroAuditoriaItem['actor'];
      if (f.usuarioId) {
        const info = nombreUsuario.get(f.usuarioId);
        actor = {
          id: f.usuarioId,
          tipo: 'USUARIO',
          nombre: info?.nombre ?? '—',
          rol: info?.rol ?? null,
        };
      } else {
        actor = {
          id: f.adminPlataformaId!,
          tipo: 'PLATAFORMA',
          nombre: nombreAdmin.get(f.adminPlataformaId!) ?? '—',
          rol: null,
        };
      }
      return {
        id: f.id,
        fecha: f.fecha.toISOString(),
        accion: f.accion,
        entidad: f.entidad,
        entidadId: f.entidadId,
        actor,
        sede: f.sede ? { id: f.sede.id, nombre: f.sede.nombre } : null,
        detalle: (f.detalle ?? null) as unknown,
      };
    });

    return { data, page, limit, total };
  }
```

Agregar `BadRequestException` al import de `@nestjs/common`.

> Verifica los nombres de relación reales en `schema.prisma` para `Usuario` — si los campos son `perfilAlumno`/`perfilMaestro`/`perfilAdministrativo` úsalos tal cual; si difieren (p. ej. `alumno`/`maestro`/`administrativo`), ajusta el `select`. Grep: `grep -n "PerfilAlumno\|PerfilMaestro\|PerfilAdministrativo" App/backend/prisma/schema.prisma` dentro de `model Usuario`.

- [ ] **Step 5: Agregar el método al controller**

Modificar `App/backend/src/platform-admin/platform-admin.controller.ts`:

```ts
import { Query } from '@nestjs/common';
import { ListarAuditoriaQueryDto } from './dto/listar-auditoria-query.dto';
```

```ts
  @Get('auditoria')
  @UseGuards(PlatformAdminGuard)
  async auditoria(@Query() query: ListarAuditoriaQueryDto) {
    const { data, page, limit, total } =
      await this.platformAdminService.listarAuditoria(query);
    return { data, page, limit, total };
  }
```

> Declarar este método junto a `resumen()`. No hay colisión de rutas (`resumen` y `auditoria` son segmentos fijos distintos; `login` es `POST`).

- [ ] **Step 6: Correr el e2e nuevo y verificar que pasa**

Run: `cd App/backend && npx jest --config test/jest-e2e.json platform-admin-auditoria`
Expected: PASA — los ~13 `it(...)` en verde.

- [ ] **Step 7: Correr build + la suite e2e completa (sin regresiones)**

Run: `cd App/backend && npx tsc --noEmit -p tsconfig.json && npx jest --config test/jest-e2e.json`
Expected: `tsc` limpio; suite e2e completa en verde (la cifra de referencia más reciente es 419 tests / 27 suites — debe subir por la suite nueva, nada debe ponerse en rojo).

- [ ] **Step 8: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/backend/src/platform-admin/dto/listar-auditoria-query.dto.ts App/backend/src/platform-admin/platform-admin.service.ts App/backend/src/platform-admin/platform-admin.controller.ts App/backend/test/platform-admin-auditoria.e2e-spec.ts
git commit -m "feat(backend): GET /platform-admin/auditoria (bitacora cross-sede paginada)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X7R2h7GTKWnYfDo541JgqH"
```

---

## Task 2: Frontend — `platformFetchPaginated` + cliente de API

**Files:**
- Modify: `App/frontend/src/lib/api/platform-http.ts`
- Create: `App/frontend/src/lib/api/auditoria-plataforma.ts`

**Interfaces:**
- Consumes: `ApiError` (`./http`), `getPlatformToken` / `clearPlatformToken` (`./platform-http`), y del backend (Task 1) el shape `ListaAuditoria` / `RegistroAuditoriaItem`.
- Produces (Tasks 4 y 5 lo consumen):
  ```ts
  function platformFetchPaginated<T>(path: string, init?: RequestInit):
    Promise<{ data: T[]; page: number; limit: number; total: number }>;

  type AccionAuditoria = 'ALTA' | 'BAJA' | 'EDICION' | 'CAMBIO_PERMISO'
    | 'CAMBIO_ESTATUS' | 'ELIMINACION' | 'CONSULTA_EMERGENCIA';
  const ACCIONES_AUDITORIA: AccionAuditoria[];
  const ENTIDADES_AUDITABLES: readonly string[];   // 13 valores
  interface FiltrosAuditoria {
    sedeId?: string; accion?: AccionAuditoria; entidad?: string;
    actorId?: string; desde?: string; hasta?: string;
    page?: number; limit?: number;
  }
  interface RegistroAuditoriaItem { /* espejo del backend */ }
  interface ListaAuditoria {
    data: RegistroAuditoriaItem[]; page: number; limit: number; total: number;
  }
  function listarAuditoria(filtros: FiltrosAuditoria): Promise<ListaAuditoria>;
  ```

---

- [ ] **Step 1: Agregar `platformFetchPaginated` a `platform-http.ts`**

En `App/frontend/src/lib/api/platform-http.ts`, después de `platformFetch`, agregar una función gemela que solo difiere en el `return`. Para no duplicar el manejo de 401/errores, refactorizar el cuerpo compartido a un helper interno:

```ts
/**
 * Núcleo compartido por `platformFetch` y `platformFetchPaginated` — hace la
 * request, maneja el 401 (limpia token + redirige a /plataforma/login, igual
 * que antes) y lanza `ApiError` en cualquier !ok. Devuelve el body ya
 * parseado (el objeto `{ data, ... }` completo), sin desenvolver.
 */
async function platformRequest(
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  if (!API_URL) {
    throw new Error('NEXT_PUBLIC_API_URL no está definida (App/frontend/.env.local)');
  }
  const token = getPlatformToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') {
      clearPlatformToken();
      if (window.location.pathname !== '/plataforma/login') {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = '/plataforma/login';
      }
    }
    const failure = body as Partial<{ error: string; code: string }> | null;
    throw new ApiError(
      failure?.error ?? 'Error inesperado del servidor',
      failure?.code ?? 'SERVER_ERROR',
      res.status,
    );
  }
  return body;
}

export async function platformFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const body = await platformRequest(path, init);
  return (body as { data: T }).data;
}

/**
 * Como `platformFetch`, pero para respuestas paginadas del contrato de esta
 * API (`{ data: T[], page, limit, total }`). `platformFetch` descarta
 * `page`/`limit`/`total` al hacer `.data` — esta variante los conserva.
 */
export async function platformFetchPaginated<T>(
  path: string,
  init?: RequestInit,
): Promise<{ data: T[]; page: number; limit: number; total: number }> {
  const body = await platformRequest(path, init);
  return body as { data: T[]; page: number; limit: number; total: number };
}
```

Conservar los comentarios existentes sobre el 401 y la exención de `proxy.ts`. `platformFetch` mantiene su firma y comportamiento exactos.

- [ ] **Step 2: Crear `src/lib/api/auditoria-plataforma.ts`**

```ts
import { platformFetchPaginated } from './platform-http';

export type AccionAuditoria =
  | 'ALTA'
  | 'BAJA'
  | 'EDICION'
  | 'CAMBIO_PERMISO'
  | 'CAMBIO_ESTATUS'
  | 'ELIMINACION'
  | 'CONSULTA_EMERGENCIA';

export const ACCIONES_AUDITORIA: AccionAuditoria[] = [
  'ALTA',
  'BAJA',
  'EDICION',
  'CAMBIO_PERMISO',
  'CAMBIO_ESTATUS',
  'ELIMINACION',
  'CONSULTA_EMERGENCIA',
];

/** Los 13 valores reales de `RegistroAuditoria.entidad` que escriben los
 * services hoy (grep en App/backend/src). El backend NO valida contra esta
 * lista — si aparece una entidad nueva, agrégala aquí para que salga en el
 * dropdown, sin cambio de backend. */
export const ENTIDADES_AUDITABLES = [
  'Usuario',
  'Sede',
  'Carrera',
  'Salon',
  'Grupo',
  'GrupoAlumno',
  'GrupoMateriaMaestro',
  'Materia',
  'MallaCurricular',
  'Aviso',
  'EventoCalendario',
  'TelefonoEmergenciaSede',
  'ExpedienteEmergencia',
] as const;

export type ActorTipo = 'USUARIO' | 'PLATAFORMA';
export type RolUsuario = 'ALUMNO' | 'MAESTRO' | 'ADMINISTRATIVO';

export interface RegistroAuditoriaItem {
  id: string;
  fecha: string;
  accion: AccionAuditoria;
  entidad: string;
  entidadId: string;
  actor: {
    id: string;
    tipo: ActorTipo;
    nombre: string;
    rol: RolUsuario | null;
  };
  sede: { id: string; nombre: string } | null;
  detalle: unknown | null;
}

export interface FiltrosAuditoria {
  sedeId?: string;
  accion?: AccionAuditoria;
  entidad?: string;
  actorId?: string;
  desde?: string;
  hasta?: string;
  page?: number;
  limit?: number;
}

export interface ListaAuditoria {
  data: RegistroAuditoriaItem[];
  page: number;
  limit: number;
  total: number;
}

export function listarAuditoria(
  filtros: FiltrosAuditoria,
): Promise<ListaAuditoria> {
  const qs = new URLSearchParams();
  if (filtros.sedeId) qs.set('sedeId', filtros.sedeId);
  if (filtros.accion) qs.set('accion', filtros.accion);
  if (filtros.entidad) qs.set('entidad', filtros.entidad);
  if (filtros.actorId) qs.set('actorId', filtros.actorId);
  if (filtros.desde) qs.set('desde', filtros.desde);
  if (filtros.hasta) qs.set('hasta', filtros.hasta);
  if (filtros.page) qs.set('page', String(filtros.page));
  if (filtros.limit) qs.set('limit', String(filtros.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return platformFetchPaginated<RegistroAuditoriaItem>(
    `/platform-admin/auditoria${suffix}`,
  );
}
```

- [ ] **Step 3: Verificar build + lint**

Run: `cd App/frontend && pnpm build && pnpm lint`
Expected: build y lint limpios (aún nadie importa `auditoria-plataforma.ts` — TypeScript igual lo type-checkea vía `next build`).

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/frontend/src/lib/api/platform-http.ts App/frontend/src/lib/api/auditoria-plataforma.ts
git commit -m "feat(frontend): platformFetchPaginated + cliente de API de auditoria de plataforma

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X7R2h7GTKWnYfDo541JgqH"
```

---

## Task 3: Frontend — `PlataformaNav` + refactor de headers

**Files:**
- Create: `App/frontend/src/app/plataforma/PlataformaNav.tsx`
- Modify: `App/frontend/src/app/plataforma/page.tsx`
- Modify: `App/frontend/src/app/plataforma/sedes/page.tsx`

**Interfaces:**
- Consumes: `useRouter` (`next/navigation`), `Link` (`next/link`), `clearPlatformToken` (`@/lib/api/platform-http`).
- Produces (Tasks 4 y 5 lo usan):
  ```tsx
  function PlataformaNav(props: {
    activo: 'dashboard' | 'sedes' | 'auditoria';
    titulo: string;   // el <h1> de la página
  }): JSX.Element;
  ```

---

- [ ] **Step 1: Crear `PlataformaNav.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { clearPlatformToken } from '@/lib/api/platform-http';

/**
 * Header + navegación compartida del árbol `app/plataforma/`. Extrae el
 * markup que estaba duplicado en `page.tsx` y `sedes/page.tsx`. Local a
 * este árbol — no cruza a `app/admin`/`app/alumno` (regla 11 de CLAUDE.md
 * raíz; mismo criterio que `../Skeleton.tsx` y los modales de `sedes/`).
 */
const LINKS: { id: 'dashboard' | 'sedes' | 'auditoria'; href: string; label: string }[] = [
  { id: 'dashboard', href: '/plataforma', label: 'Dashboard' },
  { id: 'sedes', href: '/plataforma/sedes', label: 'Sedes' },
  { id: 'auditoria', href: '/plataforma/auditoria', label: 'Auditoría' },
];

export function PlataformaNav({
  activo,
  titulo,
}: {
  activo: 'dashboard' | 'sedes' | 'auditoria';
  titulo: string;
}) {
  const router = useRouter();

  function cerrarSesion() {
    clearPlatformToken();
    router.push('/plataforma/login');
  }

  return (
    <div className="flex items-start justify-between">
      <div>
        <p className="font-display text-sm font-semibold tracking-[0.14em] text-navy uppercase">
          SIGE · Plataforma
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-slate">{titulo}</h1>
        <nav className="mt-3 flex gap-4 text-sm">
          {LINKS.map((l) => (
            <Link
              key={l.id}
              href={l.href}
              className={
                l.id === activo
                  ? 'font-medium text-navy'
                  : 'text-slate/60 hover:text-navy'
              }
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
      <button
        onClick={cerrarSesion}
        className="text-sm text-slate/60 hover:text-navy"
      >
        Cerrar sesión
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Refactor `app/plataforma/page.tsx` (dashboard)**

Reemplazar el bloque `<div className="flex items-center justify-between">…</div>` del header (el que tiene "SIGE · Plataforma", el `<h1>Dashboard</h1>`, el `<Link href="/plataforma/sedes">` y el botón "Cerrar sesión") por:

```tsx
<PlataformaNav activo="dashboard" titulo="Dashboard" />
```

Agregar `import { PlataformaNav } from './PlataformaNav';`. Quitar la función local `cerrarSesion` y el `import Link from 'next/link'` **solo si** ya no se usan en el resto del archivo (el dashboard actual usa `Link` solo en el header — confirmarlo; si es así, quitarlo). Dejar el `useEffect` del gate de ruta y el resto igual.

- [ ] **Step 3: Refactor `app/plataforma/sedes/page.tsx`**

Reemplazar el mismo bloque de header por:

```tsx
<PlataformaNav activo="sedes" titulo="Sedes" />
```

Agregar el import. Quitar la función local `cerrarSesion` de `sedes/page.tsx` (ya vive en `PlataformaNav`). **Cuidado:** `sedes/page.tsx` puede seguir usando `clearPlatformToken` en el manejo de error de alguna mutación — si NO lo usa fuera de `cerrarSesion`, quita también ese import; si sí, déjalo.

- [ ] **Step 4: Verificar build + lint**

Run: `cd App/frontend && pnpm build && pnpm lint`
Expected: limpio. Revisar visualmente que no queden imports sin usar (lint lo marca).

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/frontend/src/app/plataforma/PlataformaNav.tsx App/frontend/src/app/plataforma/page.tsx App/frontend/src/app/plataforma/sedes/page.tsx
git commit -m "refactor(frontend): PlataformaNav compartido en el arbol de plataforma

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X7R2h7GTKWnYfDo541JgqH"
```

---

## Task 4: Frontend — página `/plataforma/auditoria` + modal de detalle

**Files:**
- Create: `App/frontend/src/app/plataforma/auditoria/page.tsx`
- Create: `App/frontend/src/app/plataforma/auditoria/DetalleAuditoriaModal.tsx`

**Interfaces:**
- Consumes: `listarAuditoria`, `FiltrosAuditoria`, `RegistroAuditoriaItem`, `ACCIONES_AUDITORIA`, `ENTIDADES_AUDITABLES` (Task 2); `listarSedes` (`@/lib/api/sedes`); `PlataformaNav` (Task 3); `SkeletonTableRows` (`../Skeleton`); `ApiError` (`@/lib/api/http`); `getPlatformToken` (`@/lib/api/platform-http`).
- Produces: nada que otra task consuma (hoja del árbol).

---

- [ ] **Step 1: Crear `DetalleAuditoriaModal.tsx`**

```tsx
'use client';

import type { RegistroAuditoriaItem } from '@/lib/api/auditoria-plataforma';

/**
 * Modal de detalle de un registro de auditoría — local a
 * `app/plataforma/auditoria/`. Mismo patrón de overlay que
 * `../sedes/ConfirmarEliminarSedeModal.tsx` (regla 11 / 13: cada árbol tiene
 * sus modales, sin componente `Modal` genérico compartido).
 */
export function DetalleAuditoriaModal({
  registro,
  onCerrar,
}: {
  registro: RegistroAuditoriaItem;
  onCerrar: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate/40 p-4"
      onClick={onCerrar}
    >
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="font-display text-lg font-semibold text-slate">
            Detalle del registro
          </h2>
          <button
            type="button"
            onClick={onCerrar}
            className="text-sm text-slate/60 hover:text-navy"
          >
            Cerrar
          </button>
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Campo etiqueta="Fecha" valor={new Date(registro.fecha).toLocaleString('es-MX')} />
          <Campo etiqueta="Acción" valor={registro.accion} />
          <Campo etiqueta="Entidad" valor={registro.entidad} />
          <Campo etiqueta="Entidad ID" valor={registro.entidadId} />
          <Campo
            etiqueta="Actor"
            valor={`${registro.actor.nombre} (${registro.actor.tipo}${
              registro.actor.rol ? ` · ${registro.actor.rol}` : ''
            })`}
          />
          <Campo etiqueta="Actor ID" valor={registro.actor.id} />
          <Campo etiqueta="Sede" valor={registro.sede ? registro.sede.nombre : '—'} />
          <Campo etiqueta="Registro ID" valor={registro.id} />
        </dl>

        <h3 className="mt-5 text-sm font-semibold text-slate">Detalle</h3>
        {registro.detalle == null ? (
          <p className="mt-2 text-sm text-slate/60">Sin detalle registrado.</p>
        ) : (
          <pre className="mt-2 overflow-x-auto rounded bg-mist/40 p-3 text-xs text-slate">
            {JSON.stringify(registro.detalle, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function Campo({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate/50">{etiqueta}</dt>
      <dd className="mt-0.5 break-all text-slate">{valor}</dd>
    </div>
  );
}
```

- [ ] **Step 2: Crear `auditoria/page.tsx`**

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ACCIONES_AUDITORIA,
  ENTIDADES_AUDITABLES,
  listarAuditoria,
  type AccionAuditoria,
  type FiltrosAuditoria,
  type RegistroAuditoriaItem,
} from '@/lib/api/auditoria-plataforma';
import { ApiError } from '@/lib/api/http';
import { getPlatformToken } from '@/lib/api/platform-http';
import { listarSedes } from '@/lib/api/sedes';
import { PlataformaNav } from '../PlataformaNav';
import { SkeletonTableRows } from '../Skeleton';
import { DetalleAuditoriaModal } from './DetalleAuditoriaModal';

const FILTROS_INICIALES: FiltrosAuditoria = { page: 1, limit: 20 };

const ACCION_CLASE: Record<AccionAuditoria, string> = {
  ALTA: 'bg-green-100 text-green-800',
  EDICION: 'bg-navy/10 text-navy',
  CAMBIO_PERMISO: 'bg-navy/10 text-navy',
  CAMBIO_ESTATUS: 'bg-navy/10 text-navy',
  BAJA: 'bg-crimson/10 text-crimson',
  ELIMINACION: 'bg-crimson/10 text-crimson',
  CONSULTA_EMERGENCIA: 'bg-amber-100 text-amber-800',
};

export default function PlataformaAuditoriaPage() {
  const router = useRouter();
  const [filtros, setFiltros] = useState<FiltrosAuditoria>(FILTROS_INICIALES);
  const [detalle, setDetalle] = useState<RegistroAuditoriaItem | null>(null);
  const [actorNombre, setActorNombre] = useState<string | null>(null);

  useEffect(() => {
    if (!getPlatformToken()) router.replace('/plataforma/login');
  }, [router]);

  const sedesQuery = useQuery({
    queryKey: ['plataforma', 'sedes'],
    queryFn: async () => {
      try {
        return await listarSedes();
      } catch (err) {
        console.error('[PlataformaAuditoriaPage] Error al listar sedes:', err);
        throw err;
      }
    },
  });

  const auditoriaQuery = useQuery({
    queryKey: ['plataforma', 'auditoria', filtros],
    queryFn: async () => {
      try {
        return await listarAuditoria(filtros);
      } catch (err) {
        console.error('[PlataformaAuditoriaPage] Error al listar auditoría:', err);
        throw err;
      }
    },
  });

  function setFiltro<K extends keyof FiltrosAuditoria>(
    clave: K,
    valor: FiltrosAuditoria[K],
  ) {
    setFiltros((f) => ({ ...f, [clave]: valor || undefined, page: 1 }));
  }

  function limpiar() {
    setFiltros(FILTROS_INICIALES);
    setActorNombre(null);
  }

  const data = auditoriaQuery.data;
  const totalPaginas = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const page = filtros.page ?? 1;

  return (
    <main className="mx-auto max-w-4xl p-8">
      <PlataformaNav activo="auditoria" titulo="Auditoría" />

      {/* Barra de filtros */}
      <div className="mt-6 grid grid-cols-1 gap-3 rounded-lg border-l-4 border-navy bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">
          <span className="text-slate/60">Sede</span>
          <select
            value={filtros.sedeId ?? ''}
            onChange={(e) => setFiltro('sedeId', e.target.value)}
            className="mt-1 w-full rounded border border-mist px-2 py-1.5 text-sm"
          >
            <option value="">Todas las sedes</option>
            {sedesQuery.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="text-slate/60">Acción</span>
          <select
            value={filtros.accion ?? ''}
            onChange={(e) => setFiltro('accion', e.target.value as AccionAuditoria)}
            className="mt-1 w-full rounded border border-mist px-2 py-1.5 text-sm"
          >
            <option value="">Todas</option>
            {ACCIONES_AUDITORIA.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="text-slate/60">Entidad</span>
          <select
            value={filtros.entidad ?? ''}
            onChange={(e) => setFiltro('entidad', e.target.value)}
            className="mt-1 w-full rounded border border-mist px-2 py-1.5 text-sm"
          >
            <option value="">Todas</option>
            {ENTIDADES_AUDITABLES.map((en) => (
              <option key={en} value={en}>
                {en}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="text-slate/60">Desde</span>
          <input
            type="date"
            value={filtros.desde ?? ''}
            onChange={(e) => setFiltro('desde', e.target.value)}
            className="mt-1 w-full rounded border border-mist px-2 py-1.5 text-sm"
          />
        </label>

        <label className="text-sm">
          <span className="text-slate/60">Hasta</span>
          <input
            type="date"
            value={filtros.hasta ?? ''}
            onChange={(e) => setFiltro('hasta', e.target.value)}
            className="mt-1 w-full rounded border border-mist px-2 py-1.5 text-sm"
          />
        </label>

        <div className="flex items-end gap-2">
          {actorNombre && (
            <span className="inline-flex items-center gap-1 rounded-full bg-navy/10 px-3 py-1 text-xs text-navy">
              Actor: {actorNombre}
              <button
                type="button"
                onClick={() => {
                  setActorNombre(null);
                  setFiltro('actorId', undefined);
                }}
                aria-label="Quitar filtro de actor"
              >
                ✕
              </button>
            </span>
          )}
          <button
            type="button"
            onClick={limpiar}
            className="rounded-lg border border-mist px-3 py-1.5 text-sm text-slate hover:bg-mist/30"
          >
            Limpiar filtros
          </button>
        </div>
      </div>

      {/* Tabla */}
      <div className="mt-6 overflow-x-auto rounded-lg border-l-4 border-navy bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-mist text-left text-slate/60">
              <th className="px-4 py-3 font-medium">Fecha</th>
              <th className="px-4 py-3 font-medium">Actor</th>
              <th className="px-4 py-3 font-medium">Acción</th>
              <th className="px-4 py-3 font-medium">Entidad</th>
              <th className="px-4 py-3 font-medium">Sede</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {auditoriaQuery.isLoading && <SkeletonTableRows columns={6} />}
            {auditoriaQuery.isError && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-crimson">
                  {auditoriaQuery.error instanceof ApiError
                    ? auditoriaQuery.error.message
                    : 'No se pudo cargar la bitácora. Intenta de nuevo más tarde.'}
                </td>
              </tr>
            )}
            {!auditoriaQuery.isLoading &&
              !auditoriaQuery.isError &&
              data?.data.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate/60">
                    No hay registros que coincidan con los filtros.
                  </td>
                </tr>
              )}
            {data?.data.map((r) => (
              <tr key={r.id} className="border-b border-mist last:border-0">
                <td className="px-4 py-3 whitespace-nowrap text-slate/80">
                  {new Date(r.fecha).toLocaleString('es-MX')}
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => {
                      setActorNombre(r.actor.nombre);
                      setFiltros((f) => ({ ...f, actorId: r.actor.id, page: 1 }));
                    }}
                    className="text-navy hover:underline"
                  >
                    {r.actor.nombre}
                  </button>
                  <span className="ml-2 rounded bg-mist/60 px-1.5 py-0.5 text-[10px] tracking-wide text-slate/70 uppercase">
                    {r.actor.tipo}
                  </span>
                  {r.actor.rol && (
                    <span className="block text-[11px] text-slate/50">{r.actor.rol}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ACCION_CLASE[r.accion]}`}>
                    {r.accion}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate">
                  {r.entidad}
                  <span className="block text-[11px] text-slate/50">
                    {r.entidadId.slice(0, 8)}…
                  </span>
                </td>
                <td className="px-4 py-3 text-slate/80">{r.sede?.nombre ?? '—'}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => setDetalle(r)}
                    className="text-navy hover:underline"
                  >
                    Ver detalle
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      {data && data.total > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate/70">
          <span>
            Página {page} de {totalPaginas} · {data.total} registros
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setFiltros((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
              className="rounded border border-mist px-3 py-1 disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={page >= totalPaginas}
              onClick={() => setFiltros((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
              className="rounded border border-mist px-3 py-1 disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}

      {detalle && (
        <DetalleAuditoriaModal registro={detalle} onCerrar={() => setDetalle(null)} />
      )}
    </main>
  );
}
```

> `bg-green-100 text-green-800` / `bg-amber-100 text-amber-800` son clases estándar de Tailwind — verificar que la config del proyecto no purgue esos colores base (Tailwind v4 los trae por defecto). Si el proyecto solo usa tokens de marca, sustituir por `bg-navy/10 text-navy` para `ALTA` y `bg-slate/10 text-slate` para `CONSULTA_EMERGENCIA` y anotar en el commit.

- [ ] **Step 3: Verificar build + lint**

Run: `cd App/frontend && pnpm build && pnpm lint`
Expected: limpio. La ruta `/plataforma/auditoria` debe aparecer en el output de `next build`.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/frontend/src/app/plataforma/auditoria/
git commit -m "feat(frontend): pagina de auditoria de plataforma con filtros y detalle

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X7R2h7GTKWnYfDo541JgqH"
```

---

## Task 5: Frontend — widget "Actividad reciente" en el dashboard

**Files:**
- Modify: `App/frontend/src/app/plataforma/page.tsx`

**Interfaces:**
- Consumes: `listarAuditoria` (Task 2), `SkeletonLines` (`./Skeleton`), lo que ya importa el dashboard.
- Produces: nada.

---

- [ ] **Step 1: Agregar la query de actividad reciente**

En `app/plataforma/page.tsx`, junto a `resumenQuery`:

```tsx
const actividadQuery = useQuery({
  queryKey: ['plataforma', 'auditoria', 'reciente'],
  queryFn: async () => {
    try {
      return await listarAuditoria({ limit: 5 });
    } catch (err) {
      console.error('[PlataformaDashboardPage] Error al obtener actividad reciente:', err);
      throw err;
    }
  },
});
```

Imports: `import { listarAuditoria } from '@/lib/api/auditoria-plataforma';` y añadir `SkeletonLines` al import de `./Skeleton` si no está.

- [ ] **Step 2: Renderizar la card**

Debajo del bloque `<div className="mt-8 ...">Alumnos por sede</div>` (dentro del `{data && ( ... )}` o fuera de él — mejor **fuera**, para que el widget cargue aunque `resumen` falle):

```tsx
<div className="mt-8 rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
  <div className="flex items-center justify-between">
    <h2 className="font-display text-lg font-semibold text-slate">Actividad reciente</h2>
    <Link href="/plataforma/auditoria" className="text-sm text-navy hover:underline">
      Ver todo →
    </Link>
  </div>

  {actividadQuery.isLoading && <SkeletonLines count={5} />}
  {actividadQuery.isError && (
    <p className="mt-3 text-sm text-slate/60">
      No se pudo cargar la actividad reciente.
    </p>
  )}
  {actividadQuery.data && actividadQuery.data.data.length === 0 && (
    <p className="mt-3 text-sm text-slate/60">Sin actividad registrada todavía.</p>
  )}
  {actividadQuery.data && actividadQuery.data.data.length > 0 && (
    <ul className="mt-3 space-y-2 text-sm">
      {actividadQuery.data.data.map((r) => (
        <li key={r.id} className="flex flex-wrap gap-x-2 text-slate/80">
          <span className="text-slate/50">
            {new Date(r.fecha).toLocaleDateString('es-MX')}
          </span>
          <span className="font-medium text-slate">{r.actor.nombre}</span>
          <span>· {r.accion}</span>
          <span>· {r.entidad}</span>
        </li>
      ))}
    </ul>
  )}
</div>
```

> `Link` ya está importado en el dashboard (lo usa el header actual). Si el refactor de Task 3 lo quitó, re-agregar `import Link from 'next/link';`.

- [ ] **Step 3: Verificar build + lint**

Run: `cd App/frontend && pnpm build && pnpm lint`
Expected: limpio.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/frontend/src/app/plataforma/page.tsx
git commit -m "feat(frontend): widget de actividad reciente en el dashboard de plataforma

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X7R2h7GTKWnYfDo541JgqH"
```

---

## Verificación final (después de las 5 tasks)

1. `cd App/backend && npx jest --config test/jest-e2e.json` — suite e2e completa en verde, incluida `platform-admin-auditoria`.
2. `cd App/frontend && pnpm build && pnpm lint` — limpio.
3. `qa-backend` sobre Task 1; `qa-frontend` sobre Tasks 2-5 (el árbol `app/plataforma/` no tiene dueño de dominio propio — gap ya consignado en el Día 20; `qa-frontend` cubre la infra de frontend sin dueño).
4. Revisión final de rama (Opus) antes de cerrar — patrón del proyecto.
5. Verificación manual del usuario en navegador: login de plataforma → dashboard con widget → `/plataforma/auditoria` → filtrar por cada campo, click en actor fija el chip, "Ver detalle" abre el `Json`, paginación avanza/retrocede.

## Self-Review (hecho al escribir el plan)

- **Cobertura del spec:** endpoint backend (Task 1) ✓ · `platformFetchPaginated` (Task 2) ✓ · `lib/api/auditoria-plataforma.ts` (Task 2) ✓ · `PlataformaNav` + refactor de headers (Task 3) ✓ · página + filtros + chip de actor + tabla + paginación + estados (Task 4) ✓ · `DetalleAuditoriaModal` (Task 4) ✓ · widget en dashboard (Task 5) ✓ · e2e (Task 1) ✓ · sin migración ✓ · sin códigos de error nuevos ✓.
- **Placeholders:** ninguno — todo el código va literal. Las 2 notas "verificar X en schema/config" son validaciones de integración legítimas, no huecos de contenido.
- **Consistencia de tipos:** `FiltrosAuditoria` / `RegistroAuditoriaItem` / `ListaAuditoria` idénticos entre Task 1 (backend) y Task 2 (frontend). `platformFetchPaginated<T>` devuelve `{ data: T[]; page; limit; total }` — consumido así en Task 2 (`listarAuditoria`) y Tasks 4-5. `PlataformaNav({ activo, titulo })` — firma usada igual en Tasks 3, 4 y 5. `SkeletonTableRows({ columns })` y `SkeletonLines({ count })` — firmas reales confirmadas contra `app/plataforma/Skeleton.tsx`.
