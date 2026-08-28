# Día 33 — Maestro por materia — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un administrativo puede asignar maestros a materias dentro de un grupo (`POST/GET/DELETE /grupos/:id/asignaciones`), y crear/listar las materias que esa asignación necesita (`GET/POST /materias`).

**Architecture:** Modelo de unión nuevo `GrupoMateriaMaestro` (migración con RLS calcada de `grupo_alumnos`). `MateriasModule` propio para `GET/POST /materias` (entidad top-level con RLS propia). Los endpoints de asignación se suman a `GruposController`/`GruposService` como sub-recurso de `Grupo`, exactamente como `/grupos/:id/alumnos`. Solo backend — la UI es Día 34.

**Tech Stack:** NestJS 11 + Prisma 6.x + PostgreSQL (Supabase) + class-validator. Tests e2e con Jest + supertest contra la DB real de Supabase (`pnpm test:e2e`, serial).

## Global Constraints

- **`sedeId` SIEMPRE de `@SedeActual()`** (JWT), nunca de body/query/path (regla 2 de `CLAUDE.md` raíz).
- **Doble capa RLS + Guards** — toda tabla nueva sede-scoped necesita policy RLS en Postgres además del guard (regla 2).
- **Nunca persistir datos calculables** (regla 1).
- **Todo catch/error handler loguea antes de responder** — mínimo `console.error` con el error completo (regla 12). Mirar `CarrerasService.crear` / `GruposService.desmatricular` como referencia exacta.
- **`RegistroAuditoria` solo inserción**, dentro de la misma transacción de la acción, `usuarioId` = actor (`@ActorUsuarioId()`), nunca `adminPlataformaId` (regla 5). `AccionAuditoria` es un enum cerrado: usar `ALTA` / `ELIMINACION`.
- **Contrato de API:** JSON camelCase, fechas ISO 8601. Éxito `{ data: ... }`. Error `{ error, code }` con `code` de la lista fija (`VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`) o `ROL_NO_AUTORIZADO` (vía `RolesGuard`). **NO se crea código de error nuevo este día.**
- **No agregar dependencias nuevas.**
- **Guards de los endpoints nuevos:** `SedeGuard` + `RolesGuard` con `@Roles(RolUsuario.ADMINISTRATIVO)`, sin jerarquía de `nivelPermiso` (mismo criterio que `CarrerasController`/`GruposController`/`SalonesController`).
- **Comandos:** desde `App/backend/` — migración `npx prisma migrate dev`, generar cliente `npx prisma generate`, build `pnpm build`, e2e completo `pnpm test:e2e`, e2e de un archivo `pnpm test:e2e <filtro>`, unit `pnpm test`. **NO correr `pnpm lint`** (es `eslint --fix` y reformatea archivos ajenos — hallazgo de Día 32). Para lint puntual: `npx eslint "src/materias/**/*.ts" "test/materias.e2e-spec.ts"` (sin `--fix`).
- **Regla 14:** el `afterAll` de cada spec e2e nuevo limpia acotado a los `id` creados en la corrida — nunca por patrón de email/nombre.
- **Entorno:** Windows + PowerShell; el shell Bash disponible acepta `/` en rutas.

---

### Task 1: Modelo `GrupoMateriaMaestro` + migración con RLS + seed de materias

**Files:**
- Modify: `App/backend/prisma/schema.prisma` (nuevo `model GrupoMateriaMaestro` + 3 back-relations)
- Create: `App/backend/prisma/migrations/<timestamp>_grupo_materia_maestro/migration.sql` (Prisma lo genera; se le añade a mano el bloque RLS)
- Modify: `App/backend/prisma/seed-helpers.ts` (sembrar materias dentro de `seedSede`)

**Interfaces:**
- Consumes: modelos existentes `Grupo`, `Materia`, `PerfilMaestro`; función SQL `public.current_sede_id()` (definida en la migración `20260806224102_rls_multisede`); policy `sede_isolation_grupo_alumnos` de esa misma migración (patrón a calcar).
- Produces (lo que Task 2 y Task 3 consumen):
  - Modelo Prisma `GrupoMateriaMaestro` con campos `id`, `grupoId`, `materiaId`, `maestroId` (= `PerfilMaestro.id`), `asignadoEn`, y `@@unique([grupoId, materiaId, maestroId])`. Nombre de tabla `grupo_materia_maestro`. Delegado Prisma: `prisma.grupoMateriaMaestro`.
  - Materias sembradas: 3 por cada carrera de cada sede, todas `ciclo: 1`, para que emparejen con los grupos sembrados (`cicloActual: 1`).

- [ ] **Step 1: Añadir el modelo al schema**

En `App/backend/prisma/schema.prisma`, después del `model Materia { ... }` (que termina antes del comentario `// USUARIO (cuenta de acceso)`), añadir:

```prisma
model GrupoMateriaMaestro {
  id         String        @id @default(uuid())
  grupoId    String        @map("grupo_id")
  grupo      Grupo         @relation(fields: [grupoId], references: [id])
  materiaId  String        @map("materia_id")
  materia    Materia       @relation(fields: [materiaId], references: [id])
  maestroId  String        @map("maestro_id")
  maestro    PerfilMaestro @relation(fields: [maestroId], references: [id])
  asignadoEn DateTime      @default(now()) @map("asignado_en")

  @@unique([grupoId, materiaId, maestroId])
  @@map("grupo_materia_maestro")
}
```

Añadir la back-relation en `model Grupo` (junto a `alumnos GrupoAlumno[]`):

```prisma
  alumnos      GrupoAlumno[]
  asignaciones GrupoMateriaMaestro[]
```

En `model Materia`, añadir la relación inversa (Materia hoy no tiene `updatedAt`; solo se agrega el array):

```prisma
model Materia {
  id           String                @id @default(uuid())
  nombre       String
  carreraId    String                @map("carrera_id")
  carrera      Carrera               @relation(fields: [carreraId], references: [id])
  ciclo        Int
  createdAt    DateTime              @default(now()) @map("created_at")
  asignaciones GrupoMateriaMaestro[]

  @@map("materias")
}
```

En `model PerfilMaestro`, añadir `asignaciones GrupoMateriaMaestro[]` junto a las otras relaciones (buscar el bloque `model PerfilMaestro` y añadir la línea entre las demás relaciones `[]`, respetando el alineamiento del archivo).

- [ ] **Step 2: Generar la migración sin aplicarla**

Run: `cd App/backend && npx prisma migrate dev --name grupo_materia_maestro --create-only`
Expected: crea `prisma/migrations/<timestamp>_grupo_materia_maestro/migration.sql` con el `CREATE TABLE "grupo_materia_maestro"`, el `CREATE UNIQUE INDEX ... ("grupo_id", "materia_id", "maestro_id")`, y 3 `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY`. NO la aplica todavía.

- [ ] **Step 3: Añadir el bloque RLS al final del `migration.sql` generado**

Abrir el `migration.sql` recién creado y **añadir al final** (calcado de `sede_isolation_grupo_alumnos` en `prisma/migrations/20260806224102_rls_multisede/migration.sql`):

```sql
-- ============================================================
-- GRUPO_MATERIA_MAESTRO (indirecto vía grupos.sede_id)
-- ============================================================
ALTER TABLE "grupo_materia_maestro" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "grupo_materia_maestro" TO authenticated;

CREATE POLICY "sede_isolation_grupo_materia_maestro" ON "grupo_materia_maestro"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "grupos" g
      WHERE g.id = "grupo_materia_maestro".grupo_id
        AND g.sede_id = public.current_sede_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "grupos" g
      WHERE g.id = "grupo_materia_maestro".grupo_id
        AND g.sede_id = public.current_sede_id()
    )
  );
```

- [ ] **Step 4: Aplicar la migración y regenerar el cliente**

Run: `cd App/backend && npx prisma migrate dev`
Expected: aplica la migración pendiente (sin pedir `--name` porque ya existe el archivo), regenera el cliente Prisma. `npx prisma migrate status` → "Database schema is up to date!".

- [ ] **Step 5: Verificar que compila con el nuevo delegado**

Run: `cd App/backend && pnpm build`
Expected: `nest build` sin errores. `prisma.grupoMateriaMaestro` es un delegado válido.

- [ ] **Step 6: Sembrar materias en `seedSede`**

En `App/backend/prisma/seed-helpers.ts`, dentro de `seedSede`, **justo después** del bucle que llena `const carreras: Carrera[] = []` (después de `carreras.push(carrera);` y su `}`), añadir:

```ts
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
```

- [ ] **Step 7: Verificar el seed contra la DB de dev**

Run: `cd App/backend && SEED_DEMO_PASSWORD=irrelevante npx ts-node -e "import('./prisma/seed-helpers').then(async m => { const n = await m.prisma.materia.count(); console.log('materias antes:', n); await m.prisma.$disconnect(); })"`
Expected: imprime un número (puede ser 0). Luego correr el seed real:

Run: `cd App/backend && SEED_DEMO_PASSWORD="$SEED_DEMO_PASSWORD" pnpm prisma db seed` (si el proyecto define `prisma.seed` en `package.json`; si no, `npx ts-node prisma/seed.ts`). Si el seed real crea cuentas en Supabase Auth y no querés efectos: en su lugar, correr solo la parte de materias con un script ad-hoc que llame `seedSede` es demasiado — basta con verificar por conteo:

Run: `cd App/backend && npx ts-node -e "import('./prisma/seed-helpers').then(async m => { const merida = await m.prisma.sede.findFirst({ where: { nombre: 'CESP Mérida' } }); const carreras = await m.prisma.carrera.findMany({ where: { sedeId: merida.id } }); for (const c of carreras) { const existentes = await m.prisma.materia.count({ where: { carreraId: c.id, ciclo: 1 } }); if (existentes === 0) { await m.prisma.materia.createMany({ data: ['Fundamentos de Investigación','Matemáticas I','Comunicación Oral y Escrita'].map(nombre => ({ carreraId: c.id, nombre, ciclo: 1 })) }); } } const total = await m.prisma.materia.count(); console.log('materias tras backfill Mérida:', total); await m.prisma.\$disconnect(); })"`
Expected: imprime un total ≥ 6 (2 carreras Mérida × 3). Esto deja materias reales para el "entregable visible" y para Día 34. (El seed completo `seed.ts` las creará igual en el próximo reseed; este backfill es solo para no depender de un reseed completo ahora — cuenta como uso legítimo del seed, no como las "3 escrituras de verificación manual" de la regla 14.)

- [ ] **Step 8: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/backend/prisma/schema.prisma "App/backend/prisma/migrations" App/backend/prisma/seed-helpers.ts
git commit -m "$(cat <<'EOF'
feat(db): modelo GrupoMateriaMaestro + RLS + seed de materias (Día 33)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017iN4GYdSAc7Xoa78CyaaWc
EOF
)"
```

---

### Task 2: `MateriasModule` — `GET /materias` + `POST /materias` + e2e

**Files:**
- Create: `App/backend/src/materias/materias.module.ts`
- Create: `App/backend/src/materias/materias.controller.ts`
- Create: `App/backend/src/materias/materias.service.ts`
- Create: `App/backend/src/materias/dto/crear-materia.dto.ts`
- Create: `App/backend/src/materias/dto/listar-materias.query.dto.ts`
- Modify: `App/backend/src/app.module.ts` (registrar `MateriasModule`)
- Test: `App/backend/test/materias.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (global), `SedeGuard`/`RolesGuard`/`@Roles`/`@SedeActual`/`@ActorUsuarioId` de `src/common/`, delegado `prisma.materia` (existente), `prisma.grupoMateriaMaestro` (Task 1, no lo usa este task pero comparte migración).
- Produces (lo que Task 3 y Día 34 consumen):
  - `GET /materias?carreraId=&ciclo=` → `200 { data: MateriaDto[] }`, `MateriaDto = { id: string; nombre: string; carreraId: string; ciclo: number }`, orden `ciclo asc, nombre asc`.
  - `POST /materias` body `{ nombre: string; carreraId: string; ciclo: number }` → `201 { data: MateriaDto }`.
  - `MateriasService.crear(dto, sedeId, actorUsuarioId)` y `MateriasService.listar(carreraId, ciclo | undefined, sedeId)`.

- [ ] **Step 1: Escribir el spec e2e (fallará: rutas 404)**

Crear `App/backend/test/materias.e2e-spec.ts`. Andamiaje calcado de `test/grupos-alumnos.e2e-spec.ts` (JWKS de prueba, `SEDE_GUARD_ENV_OVERRIDE`, `firmarToken`, `configureApp`). Fixtures por Prisma directo; `afterAll` limpia por `id` (regla 14).

```ts
import { randomUUID } from 'node:crypto';
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
interface MateriaBody {
  data: { id: string; nombre: string; carreraId: string; ciclo: number };
}
interface MateriaListBody {
  data: Array<{ id: string; nombre: string; carreraId: string; ciclo: number }>;
}

describe('MateriasController (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let sedeValladolidId: string;
  let carreraLaeId: string; // LAE-MID (Mérida), duracion 8
  let carreraValladolidId: string; // LC-VLD (Valladolid)
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';

  const materiaIdsCreados: string[] = [];
  const usuarioIdsCreados: string[] = [];

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

  async function tokenAdminMerida(): Promise<string> {
    const admin = await prisma.usuario.findFirstOrThrow({
      where: { rol: RolUsuario.ADMINISTRATIVO, sedeId: sedeMeridaId },
    });
    return firmarToken(admin.id, RolUsuario.ADMINISTRATIVO, sedeMeridaId);
  }

  async function crearMateria(carreraId: string, nombre: string, ciclo: number) {
    const m = await prisma.materia.create({
      data: { carreraId, nombre, ciclo },
    });
    materiaIdsCreados.push(m.id);
    return m;
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
    sedeMeridaId = (
      await prisma.sede.findUniqueOrThrow({ where: { nombre: 'CESP Mérida' } })
    ).id;
    sedeValladolidId = (
      await prisma.sede.findUniqueOrThrow({ where: { nombre: 'CESP Valladolid' } })
    ).id;
    carreraLaeId = (
      await prisma.carrera.findUniqueOrThrow({ where: { clave: 'LAE-MID' } })
    ).id;
    carreraValladolidId = (
      await prisma.carrera.findUniqueOrThrow({ where: { clave: 'LC-VLD' } })
    ).id;
  }, 30000);

  afterAll(async () => {
    if (materiaIdsCreados.length > 0) {
      await prisma.registroAuditoria.deleteMany({
        where: { entidad: 'Materia', entidadId: { in: materiaIdsCreados } },
      });
      await prisma.materia.deleteMany({
        where: { id: { in: materiaIdsCreados } },
      });
    }
    if (usuarioIdsCreados.length > 0) {
      await prisma.usuario.deleteMany({
        where: { id: { in: usuarioIdsCreados } },
      });
    }
    await app.close();
  });

  it('GET /materias?carreraId= -> 200, ordenado ciclo asc, nombre asc', async () => {
    await crearMateria(carreraLaeId, 'ZZZ Materia', 2);
    await crearMateria(carreraLaeId, 'AAA Materia', 2);
    await crearMateria(carreraLaeId, 'MMM Materia', 1);
    const token = await tokenAdminMerida();

    const res = await request(app.getHttpServer())
      .get(`/materias?carreraId=${carreraLaeId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const data = (res.body as MateriaListBody).data;
    const nuestras = data.filter((m) => materiaIdsCreados.includes(m.id));
    // ciclo 1 antes que ciclo 2; dentro del mismo ciclo, nombre asc
    expect(nuestras.map((m) => m.nombre)).toEqual([
      'MMM Materia',
      'AAA Materia',
      'ZZZ Materia',
    ]);
    expect(nuestras[0]).toMatchObject({ carreraId: carreraLaeId, ciclo: 1 });
  });

  it('GET /materias?carreraId=&ciclo=1 -> filtra por ciclo', async () => {
    const token = await tokenAdminMerida();
    const res = await request(app.getHttpServer())
      .get(`/materias?carreraId=${carreraLaeId}&ciclo=1`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    for (const m of (res.body as MateriaListBody).data) {
      expect(m.ciclo).toBe(1);
    }
  });

  it('GET /materias sin carreraId -> 400 VALIDATION_ERROR', async () => {
    const token = await tokenAdminMerida();
    const res = await request(app.getHttpServer())
      .get('/materias')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('GET /materias con carreraId de otra sede -> 404 NOT_FOUND', async () => {
    const token = await tokenAdminMerida();
    const res = await request(app.getHttpServer())
      .get(`/materias?carreraId=${carreraValladolidId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('POST /materias -> 201 y audita ALTA', async () => {
    const token = await tokenAdminMerida();
    const nombre = `Materia E2E ${randomUUID().slice(0, 8)}`;
    const res = await request(app.getHttpServer())
      .post('/materias')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre, carreraId: carreraLaeId, ciclo: 3 });

    expect(res.status).toBe(201);
    const body = res.body as MateriaBody;
    materiaIdsCreados.push(body.data.id);
    expect(body.data).toMatchObject({ nombre, carreraId: carreraLaeId, ciclo: 3 });

    const registro = await prisma.registroAuditoria.findFirst({
      where: { entidad: 'Materia', accion: 'ALTA', entidadId: body.data.id },
    });
    expect(registro).not.toBeNull();
  });

  it('POST /materias con ciclo fuera de 1..duracion -> 400', async () => {
    const token = await tokenAdminMerida();
    // LAE-MID tiene duracion 8 en el seed
    const res = await request(app.getHttpServer())
      .post('/materias')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'Fuera de rango', carreraId: carreraLaeId, ciclo: 99 });
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('POST /materias con nombre duplicado en misma carrera+ciclo -> 409', async () => {
    const token = await tokenAdminMerida();
    const nombre = `Dup ${randomUUID().slice(0, 8)}`;
    const primera = await request(app.getHttpServer())
      .post('/materias')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre, carreraId: carreraLaeId, ciclo: 2 });
    expect(primera.status).toBe(201);
    materiaIdsCreados.push((primera.body as MateriaBody).data.id);

    const segunda = await request(app.getHttpServer())
      .post('/materias')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: nombre.toUpperCase(), carreraId: carreraLaeId, ciclo: 2 });
    expect(segunda.status).toBe(409);
    expect((segunda.body as ErrorBody).code).toBe('CONFLICT');
  });

  it('POST /materias con carreraId de otra sede -> 404', async () => {
    const token = await tokenAdminMerida();
    const res = await request(app.getHttpServer())
      .post('/materias')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'X', carreraId: carreraValladolidId, ciclo: 1 });
    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('GET/POST /materias con rol MAESTRO -> 403 ROL_NO_AUTORIZADO', async () => {
    const maestro = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.materias.maestro.${randomUUID()}@example.com`,
        rol: RolUsuario.MAESTRO,
        sedeId: sedeMeridaId,
      },
    });
    usuarioIdsCreados.push(maestro.id);
    const token = await firmarToken(maestro.id, RolUsuario.MAESTRO, sedeMeridaId);

    const get = await request(app.getHttpServer())
      .get(`/materias?carreraId=${carreraLaeId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(get.status).toBe(403);
    expect((get.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');

    const post = await request(app.getHttpServer())
      .post('/materias')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'X', carreraId: carreraLaeId, ciclo: 1 });
    expect(post.status).toBe(403);
  });
});
```

- [ ] **Step 2: Correr el spec y verificar que falla**

Run: `cd App/backend && pnpm test:e2e materias`
Expected: FAIL — `/materias` no existe (404 en los casos 200/201/400/409; 403 podría pasar por accidente si `RolesGuard` corre antes del route match, pero la mayoría falla).

- [ ] **Step 3: Crear los DTOs**

`App/backend/src/materias/dto/crear-materia.dto.ts`:

```ts
import { IsInt, IsNotEmpty, IsString, IsUUID, Min } from 'class-validator';

/**
 * `POST /materias` — Fase 12, Día 33. `sedeId` NUNCA va acá (regla 2 — sale
 * de `@SedeActual()`). El rango real de `ciclo` (1..carrera.duracion) se
 * valida en el service porque depende de la carrera; acá solo el piso.
 */
export class CrearMateriaDto {
  @IsString()
  @IsNotEmpty({ message: 'nombre es requerido' })
  nombre!: string;

  @IsUUID('4', { message: 'carreraId debe ser un UUID válido' })
  carreraId!: string;

  @IsInt({ message: 'ciclo debe ser un entero' })
  @Min(1, { message: 'ciclo debe ser al menos 1' })
  ciclo!: number;
}
```

`App/backend/src/materias/dto/listar-materias.query.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

/**
 * Query de `GET /materias` — Fase 12, Día 33. `carreraId` REQUERIDO (a
 * diferencia de los filtros opcionales de `GET /grupos`). `ciclo` filtro
 * opcional. `@Type(() => Number)` porque el `ValidationPipe` global
 * (`setup-app.ts`, `transform: true`) coerciona query params.
 */
export class ListarMateriasQueryDto {
  @IsUUID('4', { message: 'carreraId debe ser un UUID válido' })
  carreraId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'ciclo debe ser un entero' })
  @Min(1, { message: 'ciclo debe ser al menos 1' })
  ciclo?: number;
}
```

- [ ] **Step 4: Crear el service**

`App/backend/src/materias/materias.service.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccionAuditoria, Prisma, type Materia } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CrearMateriaDto } from './dto/crear-materia.dto';

export interface MateriaDto {
  id: string;
  nombre: string;
  carreraId: string;
  ciclo: number;
}

@Injectable()
export class MateriasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resuelve una carrera exigiendo que pertenezca a la sede del actor
   * (mismo criterio que `CarrerasService.actualizar` / `GruposService.crear`):
   * un solo `findFirst({ id, sedeId })`, 404 si no aparece — sin distinguir
   * "no existe" de "existe en otra sede".
   */
  private async obtenerCarreraEnSede(carreraId: string, sedeId: string) {
    const carrera = await this.prisma.carrera.findFirst({
      where: { id: carreraId, sedeId },
    });
    if (!carrera) {
      throw new NotFoundException({
        error: 'Carrera no encontrada en tu sede',
        code: 'NOT_FOUND',
      });
    }
    return carrera;
  }

  /**
   * `GET /materias?carreraId=&ciclo=` — Fase 12, Día 33. `carreraId`
   * requerido; debe ser de la sede del actor o 404. Sin paginación
   * (catálogo chico). Orden `ciclo asc, nombre asc`.
   */
  async listar(
    carreraId: string,
    ciclo: number | undefined,
    sedeId: string,
  ): Promise<MateriaDto[]> {
    await this.obtenerCarreraEnSede(carreraId, sedeId);

    const materias = await this.prisma.materia.findMany({
      where: { carreraId, ...(ciclo !== undefined ? { ciclo } : {}) },
      orderBy: [{ ciclo: 'asc' }, { nombre: 'asc' }],
      select: { id: true, nombre: true, carreraId: true, ciclo: true },
    });
    return materias;
  }

  /**
   * `nombre` único por `(carreraId, ciclo)` case-insensitive — validado a
   * nivel de aplicación (sin `@@unique` compuesto nuevo en el schema, mismo
   * criterio que `Carrera.nombre` en Día 21).
   */
  private async verificarNombreDuplicado(
    nombre: string,
    carreraId: string,
    ciclo: number,
  ): Promise<void> {
    const existente = await this.prisma.materia.findFirst({
      where: {
        carreraId,
        ciclo,
        nombre: { equals: nombre, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (existente) {
      throw new ConflictException({
        error: 'Ya existe una materia con ese nombre en ese ciclo de la carrera',
        code: 'CONFLICT',
      });
    }
  }

  /**
   * `POST /materias` — Fase 12, Día 33. Carrera de la sede del actor (404);
   * `ciclo` entre 1 y `carrera.duracion` (400); `nombre` único por
   * carrera+ciclo (409). Audita `ALTA` en la misma transacción (regla 5).
   */
  async crear(
    dto: CrearMateriaDto,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<MateriaDto> {
    const carrera = await this.obtenerCarreraEnSede(dto.carreraId, sedeId);

    if (dto.ciclo < 1 || dto.ciclo > carrera.duracion) {
      throw new BadRequestException({
        error: `ciclo debe estar entre 1 y ${carrera.duracion} para esta carrera`,
        code: 'VALIDATION_ERROR',
      });
    }

    await this.verificarNombreDuplicado(dto.nombre, dto.carreraId, dto.ciclo);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const materia = await tx.materia.create({
          data: {
            nombre: dto.nombre,
            carreraId: dto.carreraId,
            ciclo: dto.ciclo,
          },
          select: { id: true, nombre: true, carreraId: true, ciclo: true },
        });

        await tx.registroAuditoria.create({
          data: {
            usuarioId: actorUsuarioId,
            sedeId,
            accion: AccionAuditoria.ALTA,
            entidad: 'Materia',
            entidadId: materia.id,
          },
        });

        return materia;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Defensivo — el pre-check de aplicación ya cubre el duplicado; no
        // hay `@@unique` en `Materia`, así que este camino no debería
        // dispararse. Se degrada al contrato por si acaso.
        throw new ConflictException({
          error: 'Ya existe una materia con ese nombre en ese ciclo de la carrera',
          code: 'CONFLICT',
        });
      }
      console.error('[MateriasService.crear] error inesperado:', err);
      throw err;
    }
  }
}
```

- [ ] **Step 5: Crear el controller**

`App/backend/src/materias/materias.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RolUsuario } from '@prisma/client';
import { ActorUsuarioId } from '../common/decorators/actor-usuario-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SedeActual } from '../common/decorators/sede-actual.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { SedeGuard } from '../common/guards/sede.guard';
import { CrearMateriaDto } from './dto/crear-materia.dto';
import { ListarMateriasQueryDto } from './dto/listar-materias.query.dto';
import { MateriasService } from './materias.service';

/**
 * `GET/POST /materias` — Fase 12, Día 33. Bootstrap de la entidad `Materia`
 * (existía en el schema desde el Día 2, sin código). Mismo patrón de guards
 * que `CarrerasController`: `SedeGuard` primero, `@Roles(ADMINISTRATIVO)`
 * por método, sin jerarquía de `nivelPermiso`. `sedeId` siempre de
 * `@SedeActual()`. Sin `GET /materias/:id` / `PATCH` / `DELETE` (diferidos,
 * mismo criterio que Carreras).
 */
@Controller('materias')
@UseGuards(SedeGuard, RolesGuard)
export class MateriasController {
  constructor(private readonly materiasService: MateriasService) {}

  @Get()
  @Roles(RolUsuario.ADMINISTRATIVO)
  async listar(
    @Query() query: ListarMateriasQueryDto,
    @SedeActual() sedeId: string,
  ) {
    const data = await this.materiasService.listar(
      query.carreraId,
      query.ciclo,
      sedeId,
    );
    return { data };
  }

  @Post()
  @HttpCode(201)
  @Roles(RolUsuario.ADMINISTRATIVO)
  async crear(
    @Body() body: CrearMateriaDto,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    const data = await this.materiasService.crear(body, sedeId, actorUsuarioId);
    return { data };
  }
}
```

- [ ] **Step 6: Crear el módulo y registrarlo**

`App/backend/src/materias/materias.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { MateriasController } from './materias.controller';
import { MateriasService } from './materias.service';

@Module({
  controllers: [MateriasController],
  providers: [MateriasService],
})
export class MateriasModule {}
```

En `App/backend/src/app.module.ts`: añadir `import { MateriasModule } from './materias/materias.module';` junto a los otros imports, y `MateriasModule,` en el array `imports` (después de `GruposModule,` / `SalonesModule,`).

- [ ] **Step 7: Correr el spec y verificar que pasa**

Run: `cd App/backend && pnpm test:e2e materias`
Expected: PASS — los 9 casos en verde.

- [ ] **Step 8: Build + lint puntual**

Run: `cd App/backend && pnpm build && npx eslint "src/materias/**/*.ts" "test/materias.e2e-spec.ts"`
Expected: sin errores de tipos ni de lint. (NO `pnpm lint`.)

- [ ] **Step 9: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/backend/src/materias App/backend/src/app.module.ts App/backend/test/materias.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(materias): GET/POST /materias — bootstrap de la entidad Materia (Día 33)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017iN4GYdSAc7Xoa78CyaaWc
EOF
)"
```

---

### Task 3: Asignaciones — `POST/GET/DELETE /grupos/:id/asignaciones` + e2e + `CLAUDE.md`

**Files:**
- Create: `App/backend/src/grupos/dto/asignar-maestro.dto.ts`
- Modify: `App/backend/src/grupos/grupos.controller.ts` (3 métodos nuevos)
- Modify: `App/backend/src/grupos/grupos.service.ts` (3 métodos nuevos + helper `resolverMaestroEnSede`)
- Test: `App/backend/test/grupos-asignaciones.e2e-spec.ts`
- Modify: `C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp/CLAUDE.md` (contrato + tabla CRUD)

**Interfaces:**
- Consumes: `prisma.grupoMateriaMaestro` (Task 1), `prisma.materia` (existente), helpers existentes `GruposService.obtenerGrupoEnSede` (privado, ya existe), patrones de auditoría de `matricular`/`desmatricular`.
- Produces (lo que Día 34 consume):
  - `POST /grupos/:id/asignaciones` body `{ materiaId: string; usuarioId: string }` → `201 { data: GrupoMateriaMaestro }` (fila plana).
  - `GET /grupos/:id/asignaciones` → `200 { data: AsignacionListItem[] }`, `AsignacionListItem = { id: string; materia: { id: string; nombre: string; ciclo: number }; maestro: { usuarioId: string; nombres: string; apellidoPaterno: string; apellidoMaterno: string | null } }`, orden `materia.nombre asc, maestro.apellidoPaterno asc, maestro.apellidoMaterno asc`.
  - `DELETE /grupos/:id/asignaciones/:asignacionId` → `200 { data: { ok: true } }`.

- [ ] **Step 1: Escribir el spec e2e (fallará: rutas 404)**

Crear `App/backend/test/grupos-asignaciones.e2e-spec.ts`. Andamiaje calcado de `test/grupos-alumnos.e2e-spec.ts`.

```ts
import { randomUUID } from 'node:crypto';
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
interface AsignacionBody {
  data: {
    id: string;
    grupoId: string;
    materiaId: string;
    maestroId: string;
    asignadoEn: string;
  };
}
interface AsignacionListBody {
  data: Array<{
    id: string;
    materia: { id: string; nombre: string; ciclo: number };
    maestro: {
      usuarioId: string;
      nombres: string;
      apellidoPaterno: string;
      apellidoMaterno: string | null;
    };
  }>;
}

describe('GruposController — asignaciones de maestro por materia (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sedeMeridaId: string;
  let sedeValladolidId: string;
  let carreraLaeId: string; // LAE-MID (Mérida), duracion 8
  let carreraIngId: string; // ING-SIS-MID (Mérida)
  let carreraValladolidId: string; // LC-VLD (Valladolid)
  let salonMeridaId: string;
  let salonValladolidId: string;
  let actorAdminMeridaId: string;
  let privateKey: CryptoKey;
  let jose: typeof import('jose');
  const kid = 'test-key-1';
  const alg = 'ES256';

  const asignacionIdsCreados: string[] = [];
  const grupoIdsCreados: string[] = [];
  const materiaIdsCreados: string[] = [];
  const usuarioIdsCreados: string[] = [];

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

  function tokenAdminMerida(): Promise<string> {
    return firmarToken(actorAdminMeridaId, RolUsuario.ADMINISTRATIVO, sedeMeridaId);
  }

  async function crearGrupo(opts: {
    sedeId: string;
    carreraId: string;
    salonId: string;
    cicloActual?: number;
  }): Promise<string> {
    const g = await prisma.grupo.create({
      data: {
        sedeId: opts.sedeId,
        carreraId: opts.carreraId,
        salonId: opts.salonId,
        nombre: `Grupo ASG E2E ${randomUUID().slice(0, 8)}`,
        anioInicio: 2027,
        cicloActual: opts.cicloActual ?? 1,
        capacidad: 30,
      },
    });
    grupoIdsCreados.push(g.id);
    return g.id;
  }

  async function crearMateria(
    carreraId: string,
    ciclo: number,
  ): Promise<string> {
    const m = await prisma.materia.create({
      data: {
        carreraId,
        nombre: `Materia ASG ${randomUUID().slice(0, 8)}`,
        ciclo,
      },
    });
    materiaIdsCreados.push(m.id);
    return m.id;
  }

  async function crearMaestro(
    sedeId: string,
    apellidoPaterno = 'Asignado',
  ): Promise<string> {
    const usuario = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.asg.maestro.${randomUUID()}@example.com`,
        rol: RolUsuario.MAESTRO,
        sedeId,
      },
    });
    await prisma.perfilMaestro.create({
      data: {
        usuarioId: usuario.id,
        nombres: 'Fixture',
        apellidoPaterno,
        apellidoMaterno: `Z${randomUUID().slice(0, 4)}`,
        curp: `FX${randomUUID().slice(0, 16).toUpperCase()}`,
        cedulaProfesional: `${randomUUID().slice(0, 7)}`,
        correoPersonal: `fixture.asg.maestro.p.${randomUUID()}@example.com`,
        telefono: '9990000000',
        fechaContratacion: new Date('2024-08-01'),
        estatus: 'ACTIVO',
      },
    });
    usuarioIdsCreados.push(usuario.id);
    return usuario.id;
  }

  async function crearAlumnoUsuario(sedeId: string): Promise<string> {
    const usuario = await prisma.usuario.create({
      data: {
        id: randomUUID(),
        email: `fixture.asg.alumno.${randomUUID()}@example.com`,
        rol: RolUsuario.ALUMNO,
        sedeId,
      },
    });
    usuarioIdsCreados.push(usuario.id);
    return usuario.id;
  }

  async function asignar(
    grupoId: string,
    materiaId: string,
    usuarioId: string,
    token: string,
  ): Promise<request.Response> {
    const res = await request(app.getHttpServer())
      .post(`/grupos/${grupoId}/asignaciones`)
      .set('Authorization', `Bearer ${token}`)
      .send({ materiaId, usuarioId });
    if (res.status === 201) {
      asignacionIdsCreados.push((res.body as AsignacionBody).data.id);
    }
    return res;
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
    sedeMeridaId = (
      await prisma.sede.findUniqueOrThrow({ where: { nombre: 'CESP Mérida' } })
    ).id;
    sedeValladolidId = (
      await prisma.sede.findUniqueOrThrow({ where: { nombre: 'CESP Valladolid' } })
    ).id;
    carreraLaeId = (
      await prisma.carrera.findUniqueOrThrow({ where: { clave: 'LAE-MID' } })
    ).id;
    carreraIngId = (
      await prisma.carrera.findUniqueOrThrow({ where: { clave: 'ING-SIS-MID' } })
    ).id;
    carreraValladolidId = (
      await prisma.carrera.findUniqueOrThrow({ where: { clave: 'LC-VLD' } })
    ).id;
    salonMeridaId = (
      await prisma.salon.findUniqueOrThrow({
        where: { sedeId_nombre: { sedeId: sedeMeridaId, nombre: 'Aula 101' } },
      })
    ).id;
    salonValladolidId = (
      await prisma.salon.findUniqueOrThrow({
        where: {
          sedeId_nombre: { sedeId: sedeValladolidId, nombre: 'Aula 201' },
        },
      })
    ).id;
    actorAdminMeridaId = (
      await prisma.usuario.findFirstOrThrow({
        where: { rol: RolUsuario.ADMINISTRATIVO, sedeId: sedeMeridaId },
      })
    ).id;
  }, 30000);

  afterAll(async () => {
    if (asignacionIdsCreados.length > 0) {
      await prisma.registroAuditoria.deleteMany({
        where: {
          entidad: 'GrupoMateriaMaestro',
          entidadId: { in: asignacionIdsCreados },
        },
      });
    }
    if (grupoIdsCreados.length > 0) {
      await prisma.grupoMateriaMaestro.deleteMany({
        where: { grupoId: { in: grupoIdsCreados } },
      });
      await prisma.grupo.deleteMany({ where: { id: { in: grupoIdsCreados } } });
    }
    if (materiaIdsCreados.length > 0) {
      await prisma.materia.deleteMany({
        where: { id: { in: materiaIdsCreados } },
      });
    }
    if (usuarioIdsCreados.length > 0) {
      await prisma.perfilMaestro.deleteMany({
        where: { usuarioId: { in: usuarioIdsCreados } },
      });
      await prisma.usuario.deleteMany({
        where: { id: { in: usuarioIdsCreados } },
      });
    }
    await app.close();
  });

  it('POST asignación válida (maestro y materia de la sede/carrera/ciclo del grupo) -> 201 y audita ALTA', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
      cicloActual: 1,
    });
    const materiaId = await crearMateria(carreraLaeId, 1);
    const maestroUsuarioId = await crearMaestro(sedeMeridaId);

    const res = await asignar(grupoId, materiaId, maestroUsuarioId, token);
    expect(res.status).toBe(201);
    expect((res.body as AsignacionBody).data.grupoId).toBe(grupoId);
    expect((res.body as AsignacionBody).data.materiaId).toBe(materiaId);

    const registro = await prisma.registroAuditoria.findFirst({
      where: {
        entidad: 'GrupoMateriaMaestro',
        accion: 'ALTA',
        entidadId: (res.body as AsignacionBody).data.id,
      },
    });
    expect(registro).not.toBeNull();
  });

  it('POST co-docencia (2º maestro distinto, misma materia y grupo) -> 201', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
    });
    const materiaId = await crearMateria(carreraLaeId, 1);
    const m1 = await crearMaestro(sedeMeridaId);
    const m2 = await crearMaestro(sedeMeridaId);

    expect((await asignar(grupoId, materiaId, m1, token)).status).toBe(201);
    expect((await asignar(grupoId, materiaId, m2, token)).status).toBe(201);
  });

  it('POST triple duplicado exacto -> 409 CONFLICT', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
    });
    const materiaId = await crearMateria(carreraLaeId, 1);
    const maestro = await crearMaestro(sedeMeridaId);

    expect((await asignar(grupoId, materiaId, maestro, token)).status).toBe(201);
    const dup = await asignar(grupoId, materiaId, maestro, token);
    expect(dup.status).toBe(409);
    expect((dup.body as ErrorBody).code).toBe('CONFLICT');
  });

  it('POST materia de otra carrera -> 400 VALIDATION_ERROR', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
    });
    const materiaOtraCarrera = await crearMateria(carreraIngId, 1);
    const maestro = await crearMaestro(sedeMeridaId);

    const res = await asignar(grupoId, materiaOtraCarrera, maestro, token);
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('POST materia de la carrera correcta pero otro ciclo -> 400 VALIDATION_ERROR', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
      cicloActual: 1,
    });
    const materiaCiclo3 = await crearMateria(carreraLaeId, 3);
    const maestro = await crearMaestro(sedeMeridaId);

    const res = await asignar(grupoId, materiaCiclo3, maestro, token);
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('POST usuarioId de un ALUMNO -> 404', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
    });
    const materiaId = await crearMateria(carreraLaeId, 1);
    const alumnoUsuarioId = await crearAlumnoUsuario(sedeMeridaId);

    const res = await asignar(grupoId, materiaId, alumnoUsuarioId, token);
    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('POST maestro de otra sede -> 404', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
    });
    const materiaId = await crearMateria(carreraLaeId, 1);
    const maestroValladolid = await crearMaestro(sedeValladolidId);

    const res = await asignar(grupoId, materiaId, maestroValladolid, token);
    expect(res.status).toBe(404);
  });

  it('POST grupo de otra sede -> 404', async () => {
    const token = await tokenAdminMerida();
    const grupoValladolid = await crearGrupo({
      sedeId: sedeValladolidId,
      carreraId: carreraValladolidId,
      salonId: salonValladolidId,
    });
    const materiaId = await crearMateria(carreraValladolidId, 1);
    const maestro = await crearMaestro(sedeMeridaId);

    const res = await asignar(grupoValladolid, materiaId, maestro, token);
    expect(res.status).toBe(404);
  });

  it('GET /grupos/:id/asignaciones -> shape + orden; vacío -> []', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
    });

    const vacio = await request(app.getHttpServer())
      .get(`/grupos/${grupoId}/asignaciones`)
      .set('Authorization', `Bearer ${token}`);
    expect(vacio.status).toBe(200);
    expect((vacio.body as AsignacionListBody).data).toEqual([]);

    const materiaId = await crearMateria(carreraLaeId, 1);
    const maestroB = await crearMaestro(sedeMeridaId, 'Balam');
    const maestroA = await crearMaestro(sedeMeridaId, 'Aguilar');
    await asignar(grupoId, materiaId, maestroB, token);
    await asignar(grupoId, materiaId, maestroA, token);

    const res = await request(app.getHttpServer())
      .get(`/grupos/${grupoId}/asignaciones`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const data = (res.body as AsignacionListBody).data;
    expect(data).toHaveLength(2);
    // misma materia -> desempata por maestro.apellidoPaterno asc
    expect(data.map((a) => a.maestro.apellidoPaterno)).toEqual([
      'Aguilar',
      'Balam',
    ]);
    expect(data[0].materia).toMatchObject({ id: materiaId, ciclo: 1 });
    expect(data[0].maestro.usuarioId).toBe(maestroA);
  });

  it('DELETE /grupos/:id/asignaciones/:asignacionId -> 200 y audita ELIMINACION', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
    });
    const materiaId = await crearMateria(carreraLaeId, 1);
    const maestro = await crearMaestro(sedeMeridaId);
    const creada = await asignar(grupoId, materiaId, maestro, token);
    const asignacionId = (creada.body as AsignacionBody).data.id;

    const res = await request(app.getHttpServer())
      .delete(`/grupos/${grupoId}/asignaciones/${asignacionId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { ok: true } });

    const registro = await prisma.registroAuditoria.findFirst({
      where: {
        entidad: 'GrupoMateriaMaestro',
        accion: 'ELIMINACION',
        entidadId: asignacionId,
      },
    });
    expect(registro).not.toBeNull();
  });

  it('DELETE asignacionId inexistente -> 404', async () => {
    const token = await tokenAdminMerida();
    const grupoId = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
    });
    const res = await request(app.getHttpServer())
      .delete(`/grupos/${grupoId}/asignaciones/${randomUUID()}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('DELETE asignacionId que pertenece a OTRO grupo -> 404', async () => {
    const token = await tokenAdminMerida();
    const grupoA = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
    });
    const grupoB = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
    });
    const materiaId = await crearMateria(carreraLaeId, 1);
    const maestro = await crearMaestro(sedeMeridaId);
    const creada = await asignar(grupoA, materiaId, maestro, token);
    const asignacionId = (creada.body as AsignacionBody).data.id;

    const res = await request(app.getHttpServer())
      .delete(`/grupos/${grupoB}/asignaciones/${asignacionId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('las 3 rutas con rol MAESTRO -> 403 ROL_NO_AUTORIZADO', async () => {
    const grupoId = await crearGrupo({
      sedeId: sedeMeridaId,
      carreraId: carreraLaeId,
      salonId: salonMeridaId,
    });
    const maestroUsuarioId = await crearMaestro(sedeMeridaId);
    const token = await firmarToken(
      maestroUsuarioId,
      RolUsuario.MAESTRO,
      sedeMeridaId,
    );

    const post = await request(app.getHttpServer())
      .post(`/grupos/${grupoId}/asignaciones`)
      .set('Authorization', `Bearer ${token}`)
      .send({ materiaId: randomUUID(), usuarioId: randomUUID() });
    expect(post.status).toBe(403);
    expect((post.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');

    const get = await request(app.getHttpServer())
      .get(`/grupos/${grupoId}/asignaciones`)
      .set('Authorization', `Bearer ${token}`);
    expect(get.status).toBe(403);

    const del = await request(app.getHttpServer())
      .delete(`/grupos/${grupoId}/asignaciones/${randomUUID()}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(403);
  });
});
```

- [ ] **Step 2: Correr el spec y verificar que falla**

Run: `cd App/backend && pnpm test:e2e grupos-asignaciones`
Expected: FAIL — las rutas `/grupos/:id/asignaciones` no existen.

- [ ] **Step 3: Crear el DTO**

`App/backend/src/grupos/dto/asignar-maestro.dto.ts`:

```ts
import { IsUUID } from 'class-validator';

/**
 * Body de `POST /grupos/:id/asignaciones` (Fase 12, Día 33). El maestro se
 * identifica por su `Usuario.id` (mismo criterio que `MatricularAlumnoDto`);
 * el service lo resuelve a `PerfilMaestro.id`. `materiaId` es un
 * `Materia.id`.
 */
export class AsignarMaestroDto {
  @IsUUID('4', { message: 'materiaId debe ser un UUID válido' })
  materiaId!: string;

  @IsUUID('4', { message: 'usuarioId debe ser un UUID válido' })
  usuarioId!: string;
}
```

- [ ] **Step 4: Añadir los 3 métodos al service**

En `App/backend/src/grupos/grupos.service.ts`:

Añadir al bloque de tipos exportados (junto a `GrupoAlumnoListItem`):

```ts
export interface AsignacionListItem {
  id: string;
  materia: { id: string; nombre: string; ciclo: number };
  maestro: {
    usuarioId: string;
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string | null;
  };
}
```

Añadir el import del tipo `GrupoMateriaMaestro` a la línea de `@prisma/client` (junto a `type Grupo`, `type GrupoAlumno`):

```ts
  type GrupoMateriaMaestro,
```

Añadir el helper privado `resolverMaestroEnSede` (junto a `resolverAlumnoEnSede`):

```ts
  /**
   * Resuelve un `Usuario.id` a su `PerfilMaestro`, exigiendo que sea un
   * `MAESTRO` de la sede del actor. Cubre en un solo query: id inexistente,
   * maestro de otra sede (`sedeId` en el where), un `Usuario` ALUMNO/
   * ADMINISTRATIVO (`rol` en el where), y un MAESTRO sin fila de perfil
   * (defensivo). NO valida `estatus` — coherente con Día 30.
   */
  private async resolverMaestroEnSede(usuarioId: string, sedeId: string) {
    const usuario = await this.prisma.usuario.findFirst({
      where: { id: usuarioId, sedeId, rol: RolUsuario.MAESTRO },
      include: { perfilMaestro: true },
    });
    if (!usuario || !usuario.perfilMaestro) {
      throw new NotFoundException({
        error: 'Maestro no encontrado en tu sede',
        code: 'NOT_FOUND',
      });
    }
    return usuario.perfilMaestro;
  }
```

Añadir los 3 métodos públicos (al final de la clase, después de `listarAlumnos`):

```ts
  /**
   * `POST /grupos/:id/asignaciones` — Fase 12, Día 33. Valida grupo∈sede,
   * materia con `carreraId === grupo.carreraId` Y `ciclo ===
   * grupo.cicloActual` (400 VALIDATION_ERROR), maestro∈sede (`rol: MAESTRO`,
   * sin chequeo de `estatus` — coherente con Día 30). Co-docencia
   * permitida: solo el triple `(grupoId, materiaId, maestroId)` exacto ya
   * existente es 409 CONFLICT (pre-check en la transacción, respaldado por
   * `@@unique([grupoId, materiaId, maestroId])`). Audita `ALTA`.
   */
  async asignarMaestro(
    grupoId: string,
    materiaId: string,
    usuarioId: string,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<GrupoMateriaMaestro> {
    const grupo = await this.obtenerGrupoEnSede(grupoId, sedeId);

    const materia = await this.prisma.materia.findUnique({
      where: { id: materiaId },
      select: { id: true, carreraId: true, ciclo: true },
    });
    if (
      !materia ||
      materia.carreraId !== grupo.carreraId ||
      materia.ciclo !== grupo.cicloActual
    ) {
      throw new BadRequestException({
        error:
          'La materia no corresponde a la carrera y el ciclo de este grupo',
        code: 'VALIDATION_ERROR',
      });
    }

    const maestro = await this.resolverMaestroEnSede(usuarioId, sedeId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const yaAsignado = await tx.grupoMateriaMaestro.findUnique({
          where: {
            grupoId_materiaId_maestroId: {
              grupoId,
              materiaId,
              maestroId: maestro.id,
            },
          },
          select: { id: true },
        });
        if (yaAsignado) {
          throw new ConflictException({
            error: 'Ese maestro ya está asignado a esa materia en este grupo',
            code: 'CONFLICT',
          });
        }

        const fila = await tx.grupoMateriaMaestro.create({
          data: { grupoId, materiaId, maestroId: maestro.id },
        });

        await tx.registroAuditoria.create({
          data: {
            usuarioId: actorUsuarioId,
            sedeId,
            accion: AccionAuditoria.ALTA,
            entidad: 'GrupoMateriaMaestro',
            entidadId: fila.id,
            detalle: { grupoId, materiaId, maestroId: maestro.id },
          },
        });

        return fila;
      });
    } catch (err) {
      if (
        err instanceof ConflictException ||
        err instanceof BadRequestException ||
        err instanceof NotFoundException
      ) {
        throw err;
      }
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          error: 'Ese maestro ya está asignado a esa materia en este grupo',
          code: 'CONFLICT',
        });
      }
      console.error('[GruposService.asignarMaestro] error inesperado:', err);
      throw err;
    }
  }

  /**
   * `GET /grupos/:id/asignaciones` — Fase 12, Día 33. Sin paginar (catálogo
   * chico). Orden `materia.nombre asc, maestro.apellidoPaterno asc,
   * maestro.apellidoMaterno asc`.
   */
  async listarAsignaciones(
    grupoId: string,
    sedeId: string,
  ): Promise<AsignacionListItem[]> {
    await this.obtenerGrupoEnSede(grupoId, sedeId);

    const filas = await this.prisma.grupoMateriaMaestro.findMany({
      where: { grupoId },
      orderBy: [
        { materia: { nombre: 'asc' } },
        { maestro: { apellidoPaterno: 'asc' } },
        { maestro: { apellidoMaterno: 'asc' } },
      ],
      select: {
        id: true,
        materia: { select: { id: true, nombre: true, ciclo: true } },
        maestro: {
          select: {
            usuarioId: true,
            nombres: true,
            apellidoPaterno: true,
            apellidoMaterno: true,
          },
        },
      },
    });

    return filas.map((f) => ({
      id: f.id,
      materia: f.materia,
      maestro: f.maestro,
    }));
  }

  /**
   * `DELETE /grupos/:id/asignaciones/:asignacionId` — Fase 12, Día 33.
   * DELETE real de la fila de unión (regla 3 no aplica, igual que
   * `GrupoAlumno`). `404` si no existe, o si su `grupoId !== :id`, o si el
   * grupo no es de la sede. Audita `ELIMINACION` antes del delete.
   */
  async eliminarAsignacion(
    grupoId: string,
    asignacionId: string,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<{ ok: true }> {
    await this.obtenerGrupoEnSede(grupoId, sedeId);

    const fila = await this.prisma.grupoMateriaMaestro.findUnique({
      where: { id: asignacionId },
      select: { id: true, grupoId: true },
    });
    if (!fila || fila.grupoId !== grupoId) {
      throw new NotFoundException({
        error: 'Asignación no encontrada en este grupo',
        code: 'NOT_FOUND',
      });
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.registroAuditoria.create({
          data: {
            usuarioId: actorUsuarioId,
            sedeId,
            accion: AccionAuditoria.ELIMINACION,
            entidad: 'GrupoMateriaMaestro',
            entidadId: fila.id,
            detalle: { grupoId },
          },
        });
        await tx.grupoMateriaMaestro.delete({ where: { id: fila.id } });
      });
    } catch (err) {
      console.error('[GruposService.eliminarAsignacion] error inesperado:', err);
      throw new InternalServerErrorException({
        error: 'Error inesperado al eliminar la asignación',
        code: 'SERVER_ERROR',
      });
    }

    return { ok: true };
  }
```

- [ ] **Step 5: Añadir los 3 métodos al controller**

En `App/backend/src/grupos/grupos.controller.ts`:

Añadir el import: `import { AsignarMaestroDto } from './dto/asignar-maestro.dto';` (junto a los otros DTO imports).

Añadir 3 métodos. **El orden importa**: `@Get(':id/asignaciones')` debe ir junto a `@Get(':id/alumnos')`, ANTES del `@Get(':id')` dinámico (el archivo ya tiene ese comentario de advertencia). `POST` y `DELETE` van al final, junto a `matricular`/`desmatricular`:

```ts
  @Get(':id/asignaciones')
  @Roles(RolUsuario.ADMINISTRATIVO)
  async listarAsignaciones(
    @Param('id') id: string,
    @SedeActual() sedeId: string,
  ) {
    const data = await this.gruposService.listarAsignaciones(id, sedeId);
    return { data };
  }
```

(colocar el bloque anterior inmediatamente después del método `listarAlumnos` y antes del comentario `// Si en el futuro se agrega un segmento fijo...` + `@Get(':id')`)

```ts
  @Post(':id/asignaciones')
  @HttpCode(201)
  @Roles(RolUsuario.ADMINISTRATIVO)
  async asignarMaestro(
    @Param('id') id: string,
    @Body() body: AsignarMaestroDto,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    const data = await this.gruposService.asignarMaestro(
      id,
      body.materiaId,
      body.usuarioId,
      sedeId,
      actorUsuarioId,
    );
    return { data };
  }

  @Delete(':id/asignaciones/:asignacionId')
  @Roles(RolUsuario.ADMINISTRATIVO)
  async eliminarAsignacion(
    @Param('id') id: string,
    @Param('asignacionId') asignacionId: string,
    @SedeActual() sedeId: string,
    @ActorUsuarioId() actorUsuarioId: string,
  ) {
    const data = await this.gruposService.eliminarAsignacion(
      id,
      asignacionId,
      sedeId,
      actorUsuarioId,
    );
    return { data };
  }
```

- [ ] **Step 6: Correr el spec y verificar que pasa**

Run: `cd App/backend && pnpm test:e2e grupos-asignaciones`
Expected: PASS — los 13 casos en verde. Si el `orderBy` anidado por relación (`{ materia: { nombre: 'asc' } }` / `{ maestro: { ... } }`) no compilara con la versión de Prisma 6.x del repo (no debería — `GET /perfil/grupo/companeros` del Día 32 usa el mismo patrón y funciona), hacer `orderBy` simple y ordenar en memoria tras el `.map()` con un comparador explícito.

- [ ] **Step 7: Suite e2e completa + build + lint puntual**

Run: `cd App/backend && pnpm test:e2e`
Expected: PASS — todas las suites (crece en 2 archivos: `materias`, `grupos-asignaciones`).

Run: `cd App/backend && pnpm build && npx eslint "src/grupos/**/*.ts" "test/grupos-asignaciones.e2e-spec.ts"`
Expected: sin errores. (NO `pnpm lint`.)

- [ ] **Step 8: Documentar en `CLAUDE.md`**

En `C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp/CLAUDE.md`, sección "Contrato de API", añadir después de la entrada de `POST/DELETE/GET /grupos/:id/alumnos`:

```
- `GET/POST /materias` (Fase 12, Día 33) — bootstrap de la entidad `Materia`
  (existía en el schema desde el Día 2, sin código). Mismos guards que
  `CarrerasController` (`SedeGuard`+`RolesGuard(ADMINISTRATIVO)`, sin jerarquía
  de `nivelPermiso`), `sedeId` de `@SedeActual()`. `GET /materias?carreraId=&ciclo=`
  — `carreraId` REQUERIDO (carrera de otra sede → `404`; ausente → `400`), `ciclo`
  filtro opcional; sin paginar; `200 { data: Materia[] }` con `Materia = { id,
  nombre, carreraId, ciclo }`, orden `ciclo asc, nombre asc`. `POST /materias` —
  body `{ nombre, carreraId, ciclo }`; carrera de la sede (`404`); `ciclo` entre 1
  y `carrera.duracion` (`400`); `nombre` único por `(carreraId, ciclo)`
  case-insensitive a nivel de aplicación (`409`); audita `ALTA`; `201 { data:
  Materia }`. Sin `GET /materias/:id`/`PATCH`/`DELETE` (diferidos, mismo criterio
  que Carreras).
- `POST/GET/DELETE /grupos/:id/asignaciones` (Fase 12, Día 33) — asignación de
  maestros a materias dentro de un grupo, sub-recurso de `Grupo` (en
  `GruposController`). Modelo nuevo `GrupoMateriaMaestro` (`@@unique([grupoId,
  materiaId, maestroId])` — co-docencia permitida). Mismos guards que el resto de
  `GruposController`, `sedeId` de `@SedeActual()`, `:id` de grupo de otra sede →
  `404`. `POST` — body `{ materiaId, usuarioId }`: la materia debe cumplir
  `carreraId === grupo.carreraId` Y `ciclo === grupo.cicloActual` (`400
  VALIDATION_ERROR`); `usuarioId` (un `Usuario.id`) se resuelve a `PerfilMaestro.id`
  exigiendo `rol: MAESTRO` + misma sede (`404` si no) — el `estatus` del maestro NO
  se valida (coherente con Día 30); triple `(grupoId, materiaId, maestroId)` ya
  existente → `409 CONFLICT`; un 2º maestro distinto en la misma materia/grupo →
  `201`. Audita `ALTA`. `201 { data: GrupoMateriaMaestro }` (fila plana). `GET` —
  sin paginar; `200 { data: AsignacionListItem[] }` con `{ id, materia: { id,
  nombre, ciclo }, maestro: { usuarioId, nombres, apellidoPaterno, apellidoMaterno }
  }`, orden `materia.nombre asc, maestro.apellidoPaterno asc, apellidoMaterno asc`;
  grupo sin asignaciones → `{ data: [] }`. `DELETE .../:asignacionId` — por
  `GrupoMateriaMaestro.id`; `404` si no existe / pertenece a otro grupo / grupo de
  otra sede; DELETE real (regla 3 no aplica a esta tabla); audita `ELIMINACION`;
  `200 { data: { ok: true } }`. Sin `PATCH` (cambiar maestro = `DELETE`+`POST`).
```

En la sección "CRUD por tipo de entidad", en la fila "Negocio (no CRUD)", añadir `GrupoMateriaMaestro` (POST/DELETE + GET de listado)` junto a `GrupoAlumno`.

- [ ] **Step 9: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/backend/src/grupos App/backend/test/grupos-asignaciones.e2e-spec.ts CLAUDE.md
git commit -m "$(cat <<'EOF'
feat(grupos): POST/GET/DELETE /grupos/:id/asignaciones — maestro por materia (Día 33)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017iN4GYdSAc7Xoa78CyaaWc
EOF
)"
```

---

### Task 4: Cierre — QA y estado

**Files:**
- Modify: `documentacion_de_agentes/ESTADO.md` (sección Día 33)
- (NO tocar `docs/roadmap.md` — Fase 12 cierra con Día 34)

**Interfaces:**
- Consumes: veredicto de `qa-backend`.

- [ ] **Step 1: QA backend**

Dispatch `qa-backend` para auditar el modelo `GrupoMateriaMaestro` + migración/RLS, `MateriasModule` (`GET/POST /materias`), y las asignaciones (`POST/GET/DELETE /grupos/:id/asignaciones`) contra las reglas de `CLAUDE.md` raíz. Consigna veredicto en `ESTADO.md`. No corrige código.

- [ ] **Step 2: Corregir hallazgos bloqueantes (si los hay)**

Si QA reporta hallazgos bloqueantes: ronda de fix con `backend-coder`, re-verificar (`pnpm test:e2e materias`/`grupos-asignaciones` + `pnpm build`), volver a QA. Observaciones menores/parked se consignan y se sigue.

- [ ] **Step 3: Marcar estado**

En `documentacion_de_agentes/ESTADO.md`, añadir sección `### Día 33 — Modelo y endpoint de asignación — ✅ CERRADO EN CÓDIGO (2026-08-28)` siguiendo el formato de las secciones Día 30/31/32: **Backend** (modelo + migración + RLS + 2 endpoints de Materia + 3 de asignación), **Seed** (materias de ciclo 1), **Fuera de alcance**, **Verificación** (`materias` e2e, `grupos-asignaciones` e2e, suite completa, build; "entregable visible por Postman a cargo del usuario — PENDIENTE"), diferidos, y nota "Fase 12 NO completa — falta Día 34 (UI)". Spec/plan links.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add documentacion_de_agentes/ESTADO.md
git commit -m "$(cat <<'EOF'
docs: cierre en código Día 33 — maestro por materia (Fase 12, falta Día 34 UI)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017iN4GYdSAc7Xoa78CyaaWc
EOF
)"
```

- [ ] **Step 5: Verificación manual (usuario)**

Pendiente para el usuario: crear una asignación por Postman/Thunder — `POST /grupos/:id/asignaciones` con un `materiaId` sembrado y el `usuarioId` de un maestro real de la misma sede/carrera/ciclo del grupo; confirmar `201` y que `GET /grupos/:id/asignaciones` la devuelve.

---

## Self-Review

**1. Spec coverage:**
- Modelo `GrupoMateriaMaestro` + `@@unique([grupoId, materiaId, maestroId])` (co-docencia) → Task 1 Steps 1-5. ✓
- Migración con RLS calcada de `grupo_alumnos` → Task 1 Steps 2-4. ✓
- `GET /materias?carreraId=&ciclo=` (carreraId requerido, 404 cross-sede, orden, sin paginar) → Task 2 Steps 3-5, e2e Step 1. ✓
- `POST /materias` (carrera∈sede 404, ciclo 1..duracion 400, nombre único 409, audita ALTA) → Task 2 Steps 3-5, e2e Step 1. ✓
- `POST /grupos/:id/asignaciones` (materia carrera+ciclo 400, maestro∈sede 404, estatus NO validado, triple dup 409, co-docencia 201, audita ALTA) → Task 3 Steps 3-5, e2e Step 1. ✓
- `GET /grupos/:id/asignaciones` (shape, orden, vacío []) → Task 3 Steps 4-5, e2e Step 1. ✓
- `DELETE /grupos/:id/asignaciones/:asignacionId` (por id, 404 otro grupo/inexistente, audita ELIMINACION) → Task 3 Steps 4-5, e2e Step 1. ✓
- Seed de materias → Task 1 Steps 6-7. ✓
- Sin códigos de error nuevos; guards sin `nivelPermiso` → Global Constraints + cada controller. ✓
- `CLAUDE.md` contrato + tabla CRUD → Task 3 Step 8. ✓
- Fuera de alcance (PATCH asignación, Materia :id/PATCH/DELETE, UI, estatus del maestro) → respetado, ningún task los añade. ✓
- Ejecución SDD (backend-coder × 3, qa-backend, marcar ESTADO.md, NO tachar roadmap) → Task 4. ✓

**2. Placeholder scan:** Sin "TBD"/"TODO"/"manejo apropiado". El único condicional abierto (fallback de `orderBy` por relación en Task 3 Step 6) tiene instrucción concreta + precedente (Día 32). Los bloques de código son completos y copiables. ✓

**3. Type consistency:**
- `GrupoMateriaMaestro` (delegado `prisma.grupoMateriaMaestro`, `@@unique` → `grupoId_materiaId_maestroId`) usado idéntico en Task 1 (schema), Task 3 (service `findUnique where grupoId_materiaId_maestroId`, `create`, `delete`). ✓
- `AsignacionListItem` idéntico entre Task 3 Step 1 (e2e interface), Step 4 (service type), Step 8 (CLAUDE.md). ✓
- `MateriaDto = { id, nombre, carreraId, ciclo }` idéntico entre Task 2 Step 1 (e2e), Step 4 (service), Step 8 CLAUDE.md de Task 3. ✓
- `asignarMaestro(grupoId, materiaId, usuarioId, sedeId, actorUsuarioId)` — firma idéntica entre service (Task 3 Step 4) y controller (Step 5). ✓
- `resolverMaestroEnSede(usuarioId, sedeId)` → devuelve `perfilMaestro` (con `.id`), consumido como `maestro.id` en `asignarMaestro`. ✓
- DTO `AsignarMaestroDto { materiaId, usuarioId }` ↔ controller `body.materiaId, body.usuarioId` ↔ service params. ✓
- `entidad: 'Materia'` / `'GrupoMateriaMaestro'` como strings de auditoría — consistente entre service y los `afterAll`/asserts de los e2e. ✓
