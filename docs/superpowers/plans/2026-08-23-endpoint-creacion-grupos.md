# Endpoint y lógica de creación de grupos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir `POST /grupos` y `GET /grupos` en el backend de SIGE — el
primer código de aplicación real para la entidad `Grupo` (Fase 9, Día 28).

**Architecture:** Módulo NestJS nuevo `App/backend/src/grupos/`, mismo
esqueleto que `CarrerasModule` (Día 21): `GruposController` con
`SedeGuard`+`RolesGuard(ADMINISTRATIVO)`, `GruposService` con Prisma directo
(sin repositorio intermedio), DTOs con `class-validator`. `sedeId` siempre de
`@SedeActual()` (JWT). Auditoría vía `RegistroAuditoria` en la misma
transacción del alta.

**Tech Stack:** NestJS 11, Prisma 6.x, `class-validator`/`class-transformer`,
Jest + Supertest (e2e contra la DB real de Supabase, sin mocks — mismo
patrón que el resto del backend).

## Global Constraints

- Prisma NO sube a v7 (`CLAUDE.md` raíz) — no tocar `package.json` de Prisma.
- `sedeId` NUNCA sale de body/query/param — siempre de `@SedeActual()` (regla 2).
- `RegistroAuditoria` es solo-inserción, se crea dentro de la misma
  transacción de la acción que audita (regla 5).
- Contrato de API: éxito `{ data: ... }` (+ `page`/`limit`/`total` en listas
  paginadas); error `{ error, code }`. Códigos a reutilizar aquí:
  `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`, `ROL_NO_AUTORIZADO`,
  `UNAUTHORIZED` — sin códigos nuevos.
- Tests e2e corren seriales (`pnpm test:e2e -- <patrón>`, wrapper
  `scripts/run-e2e.js` con `--runInBand`) contra la DB real de Supabase — no
  hay DB de test separada. Usar nombres con timestamp para no chocar con
  datos sembrados (`grupos: ['1A', '1B']` ya existen en el seed de Mérida y
  Valladolid) y limpiar en `afterAll`.
- Sin `GET /grupos/:id`, `PATCH`, `DELETE`, ni nada de `Materia` — fuera de
  alcance de este plan (ver spec).

---

### Task 1: `POST /grupos` — DTO, service, controller, módulo, registro en AppModule

**Files:**
- Test: `App/backend/test/grupos.e2e-spec.ts`
- Create: `App/backend/src/grupos/dto/crear-grupo.dto.ts`
- Create: `App/backend/src/grupos/grupos.service.ts`
- Create: `App/backend/src/grupos/grupos.controller.ts`
- Create: `App/backend/src/grupos/grupos.module.ts`
- Modify: `App/backend/src/app.module.ts`

**Interfaces:**
- Consumes: `SedeGuard`/`RolesGuard` (`../common/guards/sede.guard`,
  `../common/guards/roles.guard`), `@Roles`
  (`../common/decorators/roles.decorator`), `@SedeActual`
  (`../common/decorators/sede-actual.decorator`), `@ActorUsuarioId`
  (`../common/decorators/actor-usuario-id.decorator`), `PrismaService`
  (`../prisma/prisma.service`), `AccionAuditoria` (`@prisma/client`).
- Produces: `GruposService.crear(dto: CrearGrupoDto, sedeId: string,
  actorUsuarioId: string): Promise<Grupo>` — usado por Task 2 sin cambios.
  `GruposController` en ruta `grupos` — Task 2 le agrega el método `listar`.
  El archivo de test `grupos.e2e-spec.ts` y sus variables de `beforeAll`
  (`sedeMeridaId`, `sedeValladolidId`, `carreraMeridaId`, `salonMeridaId`,
  `carreraValladolidId`, `salonValladolidId`, `actorUsuarioId`,
  `firmarToken`, `nombrePrueba`) — Task 2 agrega tests al mismo archivo,
  reutilizando ese mismo `beforeAll`.

- [ ] **Step 1: Escribir el test e2e (falla primero)**

`App/backend/test/grupos.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { RolUsuario } from '@prisma/client';
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
interface GrupoBody {
  data: {
    id: string;
    sedeId: string;
    carreraId: string;
    salonId: string;
    nombre: string;
    anioInicio: number;
    cicloActual: number;
    capacidad: number;
  };
}

/**
 * `POST /grupos` — Fase 9, Día 28. Mismo mecanismo de JWKS de prueba que
 * `carreras-crud.e2e-spec.ts`: JWT firmado con `jose`, inyectado vía
 * `SEDE_GUARD_ENV_OVERRIDE`. `sub` del token = el `usuarioId` real del
 * admin ANCLA de Mérida (`ana.canul@cesp-merida.edu.mx`, ver
 * `prisma/seed.ts`). Usa carrera/salón reales sembrados
 * (`prisma/seed-helpers.ts`): carrera `LAE-MID` (duracion: 8), salón
 * "Aula 101" — ambos en Mérida. `GET /grupos` se agrega en la Task 2 de
 * este mismo plan.
 */
describe('GruposController — POST /grupos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let sedeValladolidId: string;
  let carreraMeridaId: string;
  let salonMeridaId: string;
  let carreraValladolidId: string;
  let salonValladolidId: string;
  let actorUsuarioId: string;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';
  const nombrePrueba = `Grupo E2E ${Date.now()}`;

  async function firmarToken(claims: Record<string, unknown>): Promise<string> {
    return new jose.SignJWT(claims)
      .setProtectedHeader({ alg, kid })
      .setSubject(actorUsuarioId)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
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
    const merida = await prisma.sede.findUniqueOrThrow({
      where: { nombre: 'CESP Mérida' },
    });
    sedeMeridaId = merida.id;
    const valladolid = await prisma.sede.findUniqueOrThrow({
      where: { nombre: 'CESP Valladolid' },
    });
    sedeValladolidId = valladolid.id;

    const carreraMerida = await prisma.carrera.findUniqueOrThrow({
      where: { clave: 'LAE-MID' },
    });
    carreraMeridaId = carreraMerida.id;
    const salonMerida = await prisma.salon.findUniqueOrThrow({
      where: { sedeId_nombre: { sedeId: sedeMeridaId, nombre: 'Aula 101' } },
    });
    salonMeridaId = salonMerida.id;

    const carreraValladolid = await prisma.carrera.findUniqueOrThrow({
      where: { clave: 'LC-VLD' },
    });
    carreraValladolidId = carreraValladolid.id;
    const salonValladolid = await prisma.salon.findUniqueOrThrow({
      where: {
        sedeId_nombre: { sedeId: sedeValladolidId, nombre: 'Aula 201' },
      },
    });
    salonValladolidId = salonValladolid.id;

    const actor = await prisma.usuario.findUniqueOrThrow({
      where: { email: 'ana.canul@cesp-merida.edu.mx' },
    });
    actorUsuarioId = actor.id;
  });

  afterAll(async () => {
    await prisma.registroAuditoria.deleteMany({
      where: { entidad: 'Grupo', sedeId: sedeMeridaId },
    });
    await prisma.grupo.deleteMany({
      where: { nombre: { startsWith: 'Grupo E2E' } },
    });
    await app.close();
  });

  const bodyValido = () => ({
    carreraId: carreraMeridaId,
    salonId: salonMeridaId,
    nombre: nombrePrueba,
    anioInicio: 2027,
    cicloActual: 1,
    capacidad: 30,
  });

  it('POST /grupos crea un grupo en la sede del actor y audita con usuarioId', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/grupos')
      .set('Authorization', `Bearer ${token}`)
      .send(bodyValido());

    expect(res.status).toBe(201);
    const body = res.body as GrupoBody;
    expect(body.data.nombre).toBe(nombrePrueba);
    expect(body.data.sedeId).toBe(sedeMeridaId);
    expect(body.data.carreraId).toBe(carreraMeridaId);
    expect(body.data.salonId).toBe(salonMeridaId);

    const registro = await prisma.registroAuditoria.findFirst({
      where: { entidad: 'Grupo', entidadId: body.data.id },
    });
    expect(registro?.usuarioId).toBe(actorUsuarioId);
    expect(registro?.accion).toBe('ALTA');
  });

  it('POST /grupos con nombre duplicado en la misma sede+periodo -> 409 CONFLICT', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/grupos')
      .set('Authorization', `Bearer ${token}`)
      .send(bodyValido());

    expect(res.status).toBe(409);
    expect((res.body as ErrorBody).code).toBe('CONFLICT');
  });

  it('POST /grupos con el mismo nombre pero otro periodo -> 201 (no choca)', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/grupos')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...bodyValido(), cicloActual: 2 });

    expect(res.status).toBe(201);
  });

  it('POST /grupos con carreraId de otra sede -> 404 NOT_FOUND', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/grupos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...bodyValido(),
        nombre: `${nombrePrueba} carrera-otra-sede`,
        carreraId: carreraValladolidId,
      });

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('POST /grupos con salonId de otra sede -> 404 NOT_FOUND', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/grupos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...bodyValido(),
        nombre: `${nombrePrueba} salon-otra-sede`,
        salonId: salonValladolidId,
      });

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('POST /grupos con cicloActual fuera del rango de la carrera (duracion: 8) -> 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/grupos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...bodyValido(),
        nombre: `${nombrePrueba} ciclo-invalido`,
        cicloActual: 99,
      });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('POST /grupos con capacidad 0 -> 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .post('/grupos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...bodyValido(),
        nombre: `${nombrePrueba} capacidad-cero`,
        capacidad: 0,
      });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('POST /grupos sin nombre -> 400 VALIDATION_ERROR', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const { nombre, ...sinNombre } = bodyValido();
    void nombre;

    const res = await request(app.getHttpServer())
      .post('/grupos')
      .set('Authorization', `Bearer ${token}`)
      .send(sinNombre);

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('POST /grupos rol no ADMINISTRATIVO -> 403 ROL_NO_AUTORIZADO', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ALUMNO,
    });

    const res = await request(app.getHttpServer())
      .post('/grupos')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...bodyValido(), nombre: `${nombrePrueba} rol-invalido` });

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });

  it('POST /grupos sin Authorization -> 401 UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer())
      .post('/grupos')
      .send(bodyValido());

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test:e2e -- grupos.e2e-spec.ts` (desde `App/backend/`)
Expected: FAIL — el módulo `grupos` no existe todavía, así que
`POST /grupos` no está registrado en Nest. El primer test
("crea un grupo...") falla con `res.status` = `404` (Nest responde `Cannot
POST /grupos`) en vez del `201` esperado.

- [ ] **Step 3: Escribir el DTO de creación**

`App/backend/src/grupos/dto/crear-grupo.dto.ts`:
```ts
import { IsInt, IsNotEmpty, IsString, IsUUID, Min } from 'class-validator';

/**
 * `POST /grupos` — Fase 9, Día 28. Todos los campos son requeridos;
 * `sedeId` NUNCA va acá (regla 2 de CLAUDE.md raíz — sale de
 * `@SedeActual()` en el controller). Validaciones cross-campo (cicloActual
 * vs. duracion de la carrera, unicidad de nombre por sede+periodo,
 * pertenencia de carrera/salón a la sede) viven en `GruposService.crear`,
 * no acá — mismo criterio que `PersonasService`/`CarrerasService`.
 */
export class CrearGrupoDto {
  @IsUUID('4', { message: 'carreraId debe ser un UUID válido' })
  carreraId!: string;

  @IsUUID('4', { message: 'salonId debe ser un UUID válido' })
  salonId!: string;

  @IsString()
  @IsNotEmpty({ message: 'nombre es requerido' })
  nombre!: string;

  @IsInt({ message: 'anioInicio debe ser un entero' })
  @Min(1, { message: 'anioInicio debe ser al menos 1' })
  anioInicio!: number;

  @IsInt({ message: 'cicloActual debe ser un entero' })
  @Min(1, { message: 'cicloActual debe ser al menos 1' })
  cicloActual!: number;

  @IsInt({ message: 'capacidad debe ser un entero' })
  @Min(1, { message: 'capacidad debe ser al menos 1' })
  capacidad!: number;
}
```

- [ ] **Step 4: Escribir el service**

`App/backend/src/grupos/grupos.service.ts`:
```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccionAuditoria, type Grupo } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CrearGrupoDto } from './dto/crear-grupo.dto';

@Injectable()
export class GruposService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `POST /grupos` — Fase 9, Día 28. `sedeId` sale SIEMPRE de
   * `@SedeActual()` (regla 2), nunca del body. Orden de validaciones:
   * 1. Tipos/rangos básicos ya cubiertos por `CrearGrupoDto`.
   * 2. `carreraId` debe existir y pertenecer a la sede -> 404 NOT_FOUND.
   * 3. `cicloActual` debe caer entre 1 y `carrera.duracion` -> 400
   *    VALIDATION_ERROR.
   * 4. `salonId` debe existir y pertenecer a la sede -> 404 NOT_FOUND.
   * 5. `nombre` único por sede+periodo (case-insensitive, sin unique
   *    compuesto nuevo en el schema, mismo criterio que `Carrera.nombre`
   *    en Día 21) -> 409 CONFLICT.
   * `RegistroAuditoria` se crea en la misma transacción del alta, con
   * `usuarioId` = actor (regla 5).
   *
   * Fuera de alcance a propósito (ver spec): no valida `capacidad <=
   * salon.capacidad`, ni choque de salón en el mismo periodo.
   */
  async crear(
    dto: CrearGrupoDto,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<Grupo> {
    const carrera = await this.prisma.carrera.findFirst({
      where: { id: dto.carreraId, sedeId },
    });
    if (!carrera) {
      throw new NotFoundException({
        error: 'Carrera no encontrada en tu sede',
        code: 'NOT_FOUND',
      });
    }

    if (dto.cicloActual < 1 || dto.cicloActual > carrera.duracion) {
      throw new BadRequestException({
        error: `cicloActual debe estar entre 1 y ${carrera.duracion} para esta carrera`,
        code: 'VALIDATION_ERROR',
      });
    }

    const salon = await this.prisma.salon.findFirst({
      where: { id: dto.salonId, sedeId },
    });
    if (!salon) {
      throw new NotFoundException({
        error: 'Salón no encontrado en tu sede',
        code: 'NOT_FOUND',
      });
    }

    const existente = await this.prisma.grupo.findFirst({
      where: {
        sedeId,
        anioInicio: dto.anioInicio,
        cicloActual: dto.cicloActual,
        nombre: { equals: dto.nombre, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (existente) {
      throw new ConflictException({
        error: 'Ya existe un grupo con ese nombre en ese periodo',
        code: 'CONFLICT',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const grupo = await tx.grupo.create({
        data: {
          sedeId,
          carreraId: dto.carreraId,
          salonId: dto.salonId,
          nombre: dto.nombre,
          anioInicio: dto.anioInicio,
          cicloActual: dto.cicloActual,
          capacidad: dto.capacidad,
        },
      });

      await tx.registroAuditoria.create({
        data: {
          usuarioId: actorUsuarioId,
          sedeId,
          accion: AccionAuditoria.ALTA,
          entidad: 'Grupo',
          entidadId: grupo.id,
          detalle: {
            nombre: grupo.nombre,
            anioInicio: grupo.anioInicio,
            cicloActual: grupo.cicloActual,
          },
        },
      });

      return grupo;
    });
  }
}
```

- [ ] **Step 5: Escribir el controller**

`App/backend/src/grupos/grupos.controller.ts`:
```ts
import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { RolUsuario } from '@prisma/client';
import { ActorUsuarioId } from '../common/decorators/actor-usuario-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SedeActual } from '../common/decorators/sede-actual.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { SedeGuard } from '../common/guards/sede.guard';
import { CrearGrupoDto } from './dto/crear-grupo.dto';
import { GruposService } from './grupos.service';

/**
 * `POST /grupos` — Fase 9, Día 28. Mismo patrón de guards que
 * `CarrerasController`: `SedeGuard` primero (invariante de composición de
 * `RolesGuard`), `@Roles(ADMINISTRATIVO)` por método, sin jerarquía de
 * `nivelPermiso` (decisión explícita, mismo criterio que Carreras).
 * `sedeId` sale siempre de `@SedeActual()`, nunca del body.
 */
@Controller('grupos')
@UseGuards(SedeGuard, RolesGuard)
export class GruposController {
  constructor(private readonly gruposService: GruposService) {}

  @Post()
  @HttpCode(201)
  @Roles(RolUsuario.ADMINISTRATIVO)
  async crear(
    @Body() body: CrearGrupoDto,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    const data = await this.gruposService.crear(body, sedeId, actorUsuarioId);
    return { data };
  }
}
```

- [ ] **Step 6: Escribir el módulo**

`App/backend/src/grupos/grupos.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { GruposController } from './grupos.controller';
import { GruposService } from './grupos.service';

@Module({
  controllers: [GruposController],
  providers: [GruposService],
})
export class GruposModule {}
```

- [ ] **Step 7: Registrar `GruposModule` en `AppModule`**

`App/backend/src/app.module.ts` — agregar el import:
```ts
import { GruposModule } from './grupos/grupos.module';
```
Y en el array `imports: [...]`, agregar `GruposModule,` (después de
`MallaCurricularModule,`, o en cualquier posición — el orden no le importa
a NestJS, solo mantener el estilo de una línea por módulo).

- [ ] **Step 8: Correr el test y verificar que pasa**

Run: `pnpm test:e2e -- grupos.e2e-spec.ts` (desde `App/backend/`)
Expected: PASS — 9 tests en verde.

- [ ] **Step 9: Commit**

```bash
git add App/backend/src/grupos App/backend/src/app.module.ts App/backend/test/grupos.e2e-spec.ts
git commit -m "feat(grupos): POST /grupos con validaciones de periodo, carrera y salón"
```

---

### Task 2: `GET /grupos` — filtro por periodo/carrera, paginado

**Files:**
- Modify: `App/backend/test/grupos.e2e-spec.ts` — agregar tests de `GET /grupos` al `describe` existente
- Create: `App/backend/src/grupos/dto/listar-grupos.query.dto.ts`
- Modify: `App/backend/src/grupos/grupos.service.ts` — agregar método `listar` + interfaces `GrupoListItem`/`ListarGruposResult`
- Modify: `App/backend/src/grupos/grupos.controller.ts` — agregar método `listar`

**Interfaces:**
- Consumes: `GruposService.crear` (Task 1, sin cambios), las variables y
  helpers del `beforeAll`/`afterAll` de `grupos.e2e-spec.ts` creados en
  Task 1 (`sedeMeridaId`, `sedeValladolidId`, `carreraMeridaId`,
  `salonMeridaId`, `carreraValladolidId`, `salonValladolidId`,
  `actorUsuarioId`, `firmarToken`, `nombrePrueba`, `ErrorBody`).
- Produces: `GruposService.listar(filtros: ListarGruposQueryDto, sedeId:
  string): Promise<ListarGruposResult>` — no lo consume ningún otro task de
  este plan (Día 29, UI, es un plan futuro aparte).

- [ ] **Step 1: Agregar los tests de `GET /grupos` al mismo archivo (fallan primero)**

En `App/backend/test/grupos.e2e-spec.ts`, agregar estos `it` dentro del
`describe` existente (`GruposController — POST /grupos (e2e)`), después
del último `it` de `POST /grupos` (el de `401 UNAUTHORIZED`) y antes del
`});` que cierra el `describe`:
```ts
  it('GET /grupos sin filtros devuelve los grupos de la sede paginados, con carrera/salon expandidos', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .get('/grupos')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as {
      data: Array<{
        id: string;
        nombre: string;
        carrera: { id: string; nombre: string };
        salon: { id: string; nombre: string };
      }>;
      page: number;
      limit: number;
      total: number;
    };
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.total).toBeGreaterThanOrEqual(3); // 2 seed (1A/1B) + el creado en este archivo
    const creado = body.data.find((g) => g.nombre === nombrePrueba);
    expect(creado).toBeDefined();
    expect(creado?.carrera.id).toBe(carreraMeridaId);
    expect(creado?.salon.id).toBe(salonMeridaId);
  });

  it('GET /grupos?carreraId=... filtra por carrera', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .get('/grupos')
      .query({ carreraId: carreraMeridaId })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as { data: Array<{ carrera: { id: string } }> };
    expect(body.data.every((g) => g.carrera.id === carreraMeridaId)).toBe(
      true,
    );
  });

  it('GET /grupos?anioInicio=&cicloActual= filtra por periodo exacto', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .get('/grupos')
      .query({ anioInicio: 2027, cicloActual: 1 })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as {
      data: Array<{ nombre: string; anioInicio: number; cicloActual: number }>;
    };
    expect(
      body.data.every((g) => g.anioInicio === 2027 && g.cicloActual === 1),
    ).toBe(true);
    expect(body.data.some((g) => g.nombre === nombrePrueba)).toBe(true);
  });

  it('GET /grupos respeta el aislamiento por sede — grupo de Valladolid no aparece en Mérida', async () => {
    const tokenValladolid = await firmarToken({
      role: 'authenticated',
      sede_id: sedeValladolidId,
      rol: RolUsuario.ADMINISTRATIVO,
    });
    await request(app.getHttpServer())
      .post('/grupos')
      .set('Authorization', `Bearer ${tokenValladolid}`)
      .send({
        carreraId: carreraValladolidId,
        salonId: salonValladolidId,
        nombre: `Grupo E2E Valladolid ${Date.now()}`,
        anioInicio: 2027,
        cicloActual: 1,
        capacidad: 30,
      });

    const tokenMerida = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });
    const res = await request(app.getHttpServer())
      .get('/grupos')
      .query({ limit: 100 })
      .set('Authorization', `Bearer ${tokenMerida}`);

    expect(res.status).toBe(200);
    const body = res.body as { data: Array<{ nombre: string }> };
    expect(
      body.data.some((g) => g.nombre.startsWith('Grupo E2E Valladolid')),
    ).toBe(false);
  });

  it('GET /grupos con limit=1 pagina correctamente', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ADMINISTRATIVO,
    });

    const res = await request(app.getHttpServer())
      .get('/grupos')
      .query({ limit: 1, page: 1 })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as { data: unknown[]; limit: number; total: number };
    expect(body.data.length).toBe(1);
    expect(body.limit).toBe(1);
    expect(body.total).toBeGreaterThanOrEqual(3);
  });

  it('GET /grupos rol no ADMINISTRATIVO -> 403 ROL_NO_AUTORIZADO', async () => {
    const token = await firmarToken({
      role: 'authenticated',
      sede_id: sedeMeridaId,
      rol: RolUsuario.ALUMNO,
    });

    const res = await request(app.getHttpServer())
      .get('/grupos')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
  });
```

También actualizar el comentario del `describe` (la línea de docstring que
dice "`GET /grupos` se agrega en la Task 2 de este mismo plan.") — puedes
dejarlo tal cual (queda como nota histórica) o borrar esa última oración,
cualquiera de las dos es válido.

- [ ] **Step 2: Correr los tests y verificar que los nuevos fallan**

Run: `pnpm test:e2e -- grupos.e2e-spec.ts` (desde `App/backend/`)
Expected: los 9 tests de `POST /grupos` (Task 1) siguen en PASS. Los 6
tests nuevos de `GET /grupos` FALLAN — `res.status` = `404` (`Cannot GET
/grupos`, la ruta no está registrada todavía).

- [ ] **Step 3: Escribir el DTO de listado**

`App/backend/src/grupos/dto/listar-grupos.query.dto.ts`:
```ts
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/**
 * Query params de `GET /grupos` — Fase 9, Día 28. Todos los filtros son
 * opcionales — sin ninguno, devuelve todos los grupos de la sede,
 * paginados. Mismo shape de paginación que `ListarPersonasQueryDto` (Día
 * 19): `page`/`limit` con `@Type(() => Number)` (el `ValidationPipe`
 * global con `transform: true` ya coerciona tipos primitivos en query
 * params, `setup-app.ts`).
 */
export class ListarGruposQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'anioInicio debe ser un entero' })
  anioInicio?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'cicloActual debe ser un entero' })
  cicloActual?: number;

  @IsOptional()
  @IsUUID('4', { message: 'carreraId debe ser un UUID válido' })
  carreraId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page debe ser un entero' })
  @Min(1, { message: 'page debe ser al menos 1' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit debe ser un entero' })
  @Min(1, { message: 'limit debe ser al menos 1' })
  @Max(100, { message: 'limit debe ser máximo 100' })
  limit?: number;
}
```

- [ ] **Step 4: Agregar el método `listar` al service**

En `App/backend/src/grupos/grupos.service.ts`:
- Cambiar el import existente de `@prisma/client` para incluir `Prisma`:
  `import { AccionAuditoria, Prisma, type Grupo } from '@prisma/client';`
- Agregar el import: `import type { ListarGruposQueryDto } from
  './dto/listar-grupos.query.dto';`
- Agregar estas dos interfaces antes de `@Injectable()`:
```ts
export interface GrupoListItem {
  id: string;
  nombre: string;
  anioInicio: number;
  cicloActual: number;
  capacidad: number;
  carrera: { id: string; nombre: string };
  salon: { id: string; nombre: string };
}

export interface ListarGruposResult {
  data: GrupoListItem[];
  page: number;
  limit: number;
  total: number;
}
```
- Agregar este método dentro de la clase `GruposService`, después de `crear`:
```ts
  /**
   * `GET /grupos` — Fase 9, Día 28. Todos los filtros opcionales. Orden:
   * periodos más recientes primero (`anioInicio desc, cicloActual desc`),
   * luego `nombre asc`. `carrera`/`salon` expandidos a `{ id, nombre }`
   * para que la UI de Día 29 no haga N+1 requests — a diferencia de
   * `crear`, que devuelve el `Grupo` plano sin relaciones.
   */
  async listar(
    filtros: ListarGruposQueryDto,
    sedeId: string,
  ): Promise<ListarGruposResult> {
    const page = filtros.page ?? 1;
    const limit = filtros.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.GrupoWhereInput = {
      sedeId,
      ...(filtros.anioInicio !== undefined
        ? { anioInicio: filtros.anioInicio }
        : {}),
      ...(filtros.cicloActual !== undefined
        ? { cicloActual: filtros.cicloActual }
        : {}),
      ...(filtros.carreraId ? { carreraId: filtros.carreraId } : {}),
    };

    const [total, grupos] = await this.prisma.$transaction([
      this.prisma.grupo.count({ where }),
      this.prisma.grupo.findMany({
        where,
        orderBy: [
          { anioInicio: 'desc' },
          { cicloActual: 'desc' },
          { nombre: 'asc' },
        ],
        skip,
        take: limit,
        select: {
          id: true,
          nombre: true,
          anioInicio: true,
          cicloActual: true,
          capacidad: true,
          carrera: { select: { id: true, nombre: true } },
          salon: { select: { id: true, nombre: true } },
        },
      }),
    ]);

    return { data: grupos, page, limit, total };
  }
```

- [ ] **Step 5: Agregar el método `listar` al controller**

En `App/backend/src/grupos/grupos.controller.ts`:
- Cambiar el import de `@nestjs/common` para incluir `Get` y `Query`:
  `import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from
  '@nestjs/common';`
- Agregar el import: `import { ListarGruposQueryDto } from
  './dto/listar-grupos.query.dto';`
- Agregar este método dentro de la clase, antes de `crear` (mismo orden que
  `PersonasController`: listar primero, crear después):
```ts
  @Get()
  @Roles(RolUsuario.ADMINISTRATIVO)
  async listar(
    @Query() query: ListarGruposQueryDto,
    @SedeActual() sedeId: string,
  ) {
    return this.gruposService.listar(query, sedeId);
  }
```

- [ ] **Step 6: Correr los tests y confirmar verde**

Run: `pnpm test:e2e -- grupos.e2e-spec.ts` (desde `App/backend/`)
Expected: PASS — 15 tests en verde (9 de `POST` + 6 de `GET`).

- [ ] **Step 7: Commit**

```bash
git add App/backend/src/grupos App/backend/test/grupos.e2e-spec.ts
git commit -m "feat(grupos): GET /grupos paginado con filtro por periodo y carrera"
```

---

## Fuera de alcance de este plan

- `app/admin/grupos/` (UI de creación de grupos) — Día 29, plan separado.
- `Grupo.capacidad <= Salon.capacidad`, choque de salón por periodo,
  `GET/PATCH/DELETE /grupos/:id` — decisiones explícitas del spec, no se
  implementan aquí.
- `Materia`, `GrupoAlumno` (matrícula) — Fase 10 (Día 30) en adelante.
