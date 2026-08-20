# Malla curricular — Descarga desde perfil de alumno Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un alumno pueda descargar el PDF de la malla curricular de su propia carrera desde su perfil, vía una signed URL de corta expiración, sin exponer el bucket públicamente. Cierra la Fase 7.

**Architecture:** Nuevo método en el `MallaCurricularService` ya existente (Día 23) que deriva la carrera del actor desde su propio `PerfilAlumno` (sin `:id` de ruta) y genera una signed URL del bucket privado `mallas-curriculares`. Se expone como `GET /perfil/malla` en `PerfilController` (no en `MallaCurricularController` — semánticamente es "mi malla", mismo criterio que `GET /perfil`), lo que exige que `PerfilModule` importe `MallaCurricularModule`. Frontend: botón nuevo en `SeccionCarrera` (`app/alumno/page.tsx`) que pide la URL en el click y abre una pestaña nueva.

**Tech Stack:** NestJS + Prisma + `@supabase/server` (Storage Admin API, `createSignedUrl`) — mismo stack que Día 23, sin dependencias nuevas. Frontend: React (`useState` local, sin React Query — es una acción disparada por click, no una consulta con caché) + `sonner` (toast ya usado en el proyecto).

## Global Constraints

- Sin `:id` en la ruta de descarga — la carrera sale del `PerfilAlumno` del actor (`@ActorUsuarioId()`), nunca de un parámetro que haya que verificar (spec, decisión 1).
- Signed URL con expiración de **300 segundos (5 min)**, generada en cada click, nunca cacheada (spec, decisión 2).
- Carrera sin malla subida → `200 { data: null }`, nunca un error — es un estado normal (spec, decisión 3).
- El botón pide la URL en el `onClick`, sin precarga al montar la página (spec, decisión 4).
- Solo rol `ALUMNO` puede llamar `GET /perfil/malla` — `403 ROL_NO_AUTORIZADO` para cualquier otro rol (spec, sección 2).
- Sin código de error nuevo — reutiliza `NOT_FOUND` (defensivo) y `SERVER_ERROR` (falla real de Storage).
- Regla 12 de `CLAUDE.md` raíz — todo catch/error handler real (no el caso "sin malla", que no es un error) loguea con `console.error` antes de responder.
- Fuera de alcance: descarga desde vista de maestro/administrativo, precarga de estado, auditoría de descargas (spec, "Fuera de alcance").

---

### Task 1: Backend — `GET /perfil/malla`

**Files:**
- Modify: `App/backend/src/malla-curricular/malla-curricular.service.ts` (agrega método al final de la clase)
- Modify: `App/backend/src/malla-curricular/malla-curricular.module.ts` (exporta el service)
- Modify: `App/backend/src/perfil/perfil.module.ts` (importa `MallaCurricularModule`)
- Modify: `App/backend/src/perfil/perfil.controller.ts` (agrega la ruta)
- Modify: `App/backend/test/malla-curricular.e2e-spec.ts` (extiende la suite existente)

**Interfaces:**
- Consumes: `PrismaService` (ya inyectado en `MallaCurricularService`), `BUCKET_MALLA_CURRICULAR` (constante ya existente en el mismo archivo), `ActorUsuarioId`/`Roles` (`../common/decorators/`), `RolesGuard` (`../common/guards/roles.guard`), `RolUsuario` (`@prisma/client`).
- Produces: `MallaCurricularService.obtenerUrlDescargaPropia(actorUsuarioId: string): Promise<{ url: string; nombreArchivo: string } | null>` — consumido por `PerfilController` en este mismo task, y por el frontend (Task 2) a través del contrato HTTP `GET /perfil/malla` → `{ data: { url, nombreArchivo } | null }`.

- [ ] **Step 1: Agregar `obtenerUrlDescargaPropia` a `MallaCurricularService`**

En `App/backend/src/malla-curricular/malla-curricular.service.ts`, agrega este método al final de la clase (después de `obtener`, antes de la llave de cierre `}` del final del archivo):

```ts
  /**
   * `GET /perfil/malla` — Fase 7, Día 24. Genera una signed URL (5 min) de
   * la malla curricular de la carrera del propio alumno — sin `:id`, la
   * carrera sale de su `PerfilAlumno` (`actorUsuarioId` = JWT `sub`, ver
   * `PerfilController.obtenerUrlDescargaMalla`). `null` (200, NUNCA error)
   * si su carrera todavía no tiene malla subida — mismo criterio que
   * `obtener()`.
   */
  async obtenerUrlDescargaPropia(
    actorUsuarioId: string,
  ): Promise<{ url: string; nombreArchivo: string } | null> {
    const perfilAlumno = await this.prisma.perfilAlumno.findUnique({
      where: { usuarioId: actorUsuarioId },
      select: { carreraId: true },
    });
    if (!perfilAlumno) {
      // Defensivo — no debería pasar nunca en la práctica (regla 3: baja
      // lógica, un `Usuario` con rol ALUMNO siempre tiene su
      // `PerfilAlumno`, el `RolesGuard` ya filtró por `ALUMNO` antes de
      // llegar acá).
      console.error(
        '[MallaCurricularService.obtenerUrlDescargaPropia] actor ALUMNO sin PerfilAlumno:',
        actorUsuarioId,
      );
      throw new NotFoundException({
        error: 'Perfil de alumno no encontrado',
        code: 'NOT_FOUND',
      });
    }

    const malla = await this.prisma.mallaCurricular.findUnique({
      where: { carreraId: perfilAlumno.carreraId },
      select: { storagePath: true, nombreArchivo: true },
    });
    if (!malla) {
      return null;
    }

    const client = await this.getClient();
    const { data, error } = await client.storage
      .from(BUCKET_MALLA_CURRICULAR)
      .createSignedUrl(malla.storagePath, 300);
    if (error || !data) {
      console.error(
        '[MallaCurricularService.obtenerUrlDescargaPropia] error generando signed URL:',
        error,
      );
      throw new InternalServerErrorException({
        error: 'No se pudo generar el enlace de descarga. Intenta de nuevo.',
        code: 'SERVER_ERROR',
      });
    }

    return { url: data.signedUrl, nombreArchivo: malla.nombreArchivo };
  }
```

Sin imports nuevos — `NotFoundException`, `InternalServerErrorException`, `BUCKET_MALLA_CURRICULAR` ya están importados/declarados en este archivo (Día 23).

- [ ] **Step 2: Exportar `MallaCurricularService` desde el módulo**

En `App/backend/src/malla-curricular/malla-curricular.module.ts`, el archivo completo queda:

```ts
import { Module } from '@nestjs/common';
import { MallaCurricularController } from './malla-curricular.controller';
import {
  MALLA_SUPABASE_CLIENT_OVERRIDE,
  MallaCurricularService,
} from './malla-curricular.service';

/**
 * `MALLA_SUPABASE_CLIENT_OVERRIDE` vale `undefined` por default — en
 * producción `MallaCurricularService` cae al `createAdminClient()` real de
 * `@supabase/server/core`. En tests se overridea vía
 * `Test.createTestingModule({ imports: [AppModule] })
 *   .overrideProvider(MALLA_SUPABASE_CLIENT_OVERRIDE)`
 * — mismo patrón que `PERSONAS_SUPABASE_CLIENT_OVERRIDE` en
 * `personas.module.ts`. Sin este provider registrado acá, `overrideProvider`
 * no tiene token que sobreescribir y el service cae al cliente real
 * (bug detectado en Task 2 de Día 23 al correr el e2e — el primer intento
 * subió un archivo real al bucket en vez de usar el mock).
 *
 * `MallaCurricularService` se exporta desde Día 24 — `PerfilModule` lo
 * importa para exponer `GET /perfil/malla` sin duplicar la lógica de
 * Storage (cliente admin, bucket, `storagePath`) dentro de `PerfilService`.
 */
@Module({
  controllers: [MallaCurricularController],
  providers: [
    MallaCurricularService,
    { provide: MALLA_SUPABASE_CLIENT_OVERRIDE, useValue: undefined },
  ],
  exports: [MALLA_SUPABASE_CLIENT_OVERRIDE, MallaCurricularService],
})
export class MallaCurricularModule {}
```

- [ ] **Step 3: `PerfilModule` importa `MallaCurricularModule`**

En `App/backend/src/perfil/perfil.module.ts`, el archivo completo queda:

```ts
import { Module } from '@nestjs/common';
import { MallaCurricularModule } from '../malla-curricular/malla-curricular.module';
import { PerfilController } from './perfil.controller';
import { PerfilService } from './perfil.service';

@Module({
  imports: [MallaCurricularModule],
  controllers: [PerfilController],
  providers: [PerfilService],
})
export class PerfilModule {}
```

- [ ] **Step 4: Agregar la ruta `GET /perfil/malla` a `PerfilController`**

En `App/backend/src/perfil/perfil.controller.ts`, el archivo completo queda:

```ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { RolUsuario } from '@prisma/client';
import { ActorUsuarioId } from '../common/decorators/actor-usuario-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { SedeGuard } from '../common/guards/sede.guard';
import { MallaCurricularService } from '../malla-curricular/malla-curricular.service';
import { PerfilService } from './perfil.service';

/**
 * `GET /perfil` — Fase 5, Día 16.
 *
 * Solo `SedeGuard` de clase — sin `RolesGuard` a nivel de clase — mismo
 * criterio que `PATCH /auth/cambiar-password` (Día 12): cualquier rol
 * autenticado consulta su propio perfil, no es una acción restringida a
 * `ADMINISTRATIVO` ni a ningún rol en particular.
 *
 * El `usuarioId` a consultar sale exclusivamente de `@ActorUsuarioId()`
 * (JWT `sub`, ver `PerfilService.obtenerPerfilPropio`) — no hay `:id` ni
 * query param por el que se pueda pedir el perfil de otra persona.
 *
 * `GET /perfil/malla` (Fase 7, Día 24) es la excepción — sí restringida a
 * `ALUMNO`, `RolesGuard` declarado a nivel de MÉTODO (no de clase, para no
 * afectar `GET /perfil`), mismo criterio de composición de guards que
 * `SedesController` (Día 20: guard declarado por método cuando la clase
 * sirve rutas con requisitos distintos).
 */
@Controller('perfil')
@UseGuards(SedeGuard)
export class PerfilController {
  constructor(
    private readonly perfilService: PerfilService,
    private readonly mallaCurricularService: MallaCurricularService,
  ) {}

  @Get()
  async obtenerPropio(@ActorUsuarioId() actorUsuarioId: string) {
    const data = await this.perfilService.obtenerPerfilPropio(actorUsuarioId);
    return { data };
  }

  @Get('malla')
  @UseGuards(RolesGuard)
  @Roles(RolUsuario.ALUMNO)
  async obtenerUrlDescargaMalla(@ActorUsuarioId() actorUsuarioId: string) {
    const data =
      await this.mallaCurricularService.obtenerUrlDescargaPropia(actorUsuarioId);
    return { data };
  }
}
```

- [ ] **Step 5: Verificar tipos**

Run: `cd App/backend && npx tsc --noEmit`
Expected: sin salida, exit 0.

- [ ] **Step 6: Extender el mock de Storage en el e2e existente con `createSignedUrl`**

En `App/backend/test/malla-curricular.e2e-spec.ts`, agrega el import de `randomUUID` al inicio del archivo (junto a los otros imports):

```ts
import { randomUUID } from 'node:crypto';
```

Declara la variable del mock nuevo junto a `let upload: jest.Mock;`:

```ts
  let upload: jest.Mock;
  let createSignedUrl: jest.Mock;
```

En `beforeAll`, donde hoy dice:

```ts
    upload = jest.fn().mockResolvedValue({ data: { path: 'x' }, error: null });
    const mockSupabaseAdminClient = {
      storage: { from: () => ({ upload }) },
    };
```

Reemplázalo por:

```ts
    upload = jest.fn().mockResolvedValue({ data: { path: 'x' }, error: null });
    createSignedUrl = jest.fn().mockResolvedValue({
      data: { signedUrl: 'https://storage.example.com/signed/mock-url' },
      error: null,
    });
    const mockSupabaseAdminClient = {
      storage: { from: () => ({ upload, createSignedUrl }) },
    };
```

En el `firmarToken` existente, agrega un segundo parámetro `subject` opcional (por defecto el actor administrativo ya usado por todas las pruebas de Día 23) — necesario porque las pruebas nuevas de este task firman tokens a nombre de un alumno fixture, no del admin. Donde hoy dice:

```ts
  async function firmarToken(claims: Record<string, unknown>): Promise<string> {
    return new jose.SignJWT(claims)
      .setProtectedHeader({ alg, kid })
      .setSubject(actorUsuarioId)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  }
```

Reemplázalo por:

```ts
  async function firmarToken(
    claims: Record<string, unknown>,
    subject: string = actorUsuarioId,
  ): Promise<string> {
    return new jose.SignJWT(claims)
      .setProtectedHeader({ alg, kid })
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  }
```

En `afterEach`, donde hoy dice `upload.mockClear();`, agrega debajo:

```ts
    createSignedUrl.mockClear();
```

- [ ] **Step 7: Agregar el bloque de pruebas de `GET /perfil/malla`**

Al final del archivo `App/backend/test/malla-curricular.e2e-spec.ts`, justo antes del `});` que cierra el `describe` principal (después del último `it(...)` existente, "GET /carreras refleja tieneMalla..."), agrega:

```ts

  describe('GET /perfil/malla (Día 24)', () => {
    let alumnoConMallaUsuarioId: string;
    let alumnoConMallaPerfilId: string;
    let alumnoSinMallaUsuarioId: string;
    let alumnoSinMallaPerfilId: string;

    beforeAll(async () => {
      // Asegura una malla vigente en `carreraMeridaId` sin depender del
      // orden de ejecución de las pruebas de arriba.
      const tokenAdmin = await firmarToken({
        role: 'authenticated',
        sede_id: sedeMeridaId,
        rol: RolUsuario.ADMINISTRATIVO,
      });
      await request(app.getHttpServer())
        .post(`/carreras/${carreraMeridaId}/malla`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .attach('archivo', Buffer.from('%PDF-1.4 dia24'), {
          filename: 'malla-dia24.pdf',
          contentType: 'application/pdf',
        });

      const carreraSinMalla = await prisma.carrera.findUniqueOrThrow({
        where: { clave: 'LC-VLD' },
      });

      const alumnoConMalla = await prisma.usuario.create({
        data: {
          id: randomUUID(),
          email: `fixture.alumnoconmalla.${randomUUID()}@cesp-merida.edu.mx`,
          rol: RolUsuario.ALUMNO,
          sedeId: sedeMeridaId,
        },
      });
      const perfilConMalla = await prisma.perfilAlumno.create({
        data: {
          usuarioId: alumnoConMalla.id,
          nombres: 'Fixture',
          apellidoPaterno: 'ConMalla',
          fechaNacimiento: new Date('2005-01-01'),
          matricula: `MID-2026-DIA24A-${randomUUID().slice(0, 8)}`,
          correoPersonal: `fixture.alumnoconmalla.${randomUUID()}@example.com`,
          carreraId: carreraMeridaId,
          estatusAcademico: 'INSCRITO',
          periodoIngreso: '2026-1',
          semestreActual: 1,
        },
      });
      alumnoConMallaUsuarioId = alumnoConMalla.id;
      alumnoConMallaPerfilId = perfilConMalla.id;

      const alumnoSinMalla = await prisma.usuario.create({
        data: {
          id: randomUUID(),
          email: `fixture.alumnosinmalla.${randomUUID()}@cesp-valladolid.edu.mx`,
          rol: RolUsuario.ALUMNO,
          sedeId: sedeValladolidId,
        },
      });
      const perfilSinMalla = await prisma.perfilAlumno.create({
        data: {
          usuarioId: alumnoSinMalla.id,
          nombres: 'Fixture',
          apellidoPaterno: 'SinMalla',
          fechaNacimiento: new Date('2005-01-01'),
          matricula: `VLD-2026-DIA24B-${randomUUID().slice(0, 8)}`,
          correoPersonal: `fixture.alumnosinmalla.${randomUUID()}@example.com`,
          carreraId: carreraSinMalla.id,
          estatusAcademico: 'INSCRITO',
          periodoIngreso: '2026-1',
          semestreActual: 1,
        },
      });
      alumnoSinMallaUsuarioId = alumnoSinMalla.id;
      alumnoSinMallaPerfilId = perfilSinMalla.id;
    });

    afterAll(async () => {
      await prisma.perfilAlumno.delete({ where: { id: alumnoConMallaPerfilId } });
      await prisma.usuario.delete({ where: { id: alumnoConMallaUsuarioId } });
      await prisma.perfilAlumno.delete({ where: { id: alumnoSinMallaPerfilId } });
      await prisma.usuario.delete({ where: { id: alumnoSinMallaUsuarioId } });
    });

    it('alumno con malla en su carrera -> 200 con url/nombreArchivo', async () => {
      const token = await firmarToken(
        { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ALUMNO },
        alumnoConMallaUsuarioId,
      );

      const res = await request(app.getHttpServer())
        .get('/perfil/malla')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const body = res.body as { data: { url: string; nombreArchivo: string } };
      expect(body.data.nombreArchivo).toBe('malla-dia24.pdf');
      expect(body.data.url).toBe('https://storage.example.com/signed/mock-url');
      expect(createSignedUrl).toHaveBeenCalledWith(
        `${carreraMeridaId}/malla.pdf`,
        300,
      );
    });

    it('alumno sin malla en su carrera -> 200 con data null', async () => {
      const token = await firmarToken(
        { role: 'authenticated', sede_id: sedeValladolidId, rol: RolUsuario.ALUMNO },
        alumnoSinMallaUsuarioId,
      );

      const res = await request(app.getHttpServer())
        .get('/perfil/malla')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect((res.body as { data: unknown }).data).toBeNull();
      expect(createSignedUrl).not.toHaveBeenCalled();
    });

    it('rol MAESTRO -> 403 ROL_NO_AUTORIZADO', async () => {
      const token = await firmarToken(
        { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.MAESTRO },
        alumnoConMallaUsuarioId,
      );

      const res = await request(app.getHttpServer())
        .get('/perfil/malla')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect((res.body as ErrorBody).code).toBe('ROL_NO_AUTORIZADO');
    });

    it('sin Authorization -> 401 UNAUTHORIZED', async () => {
      const res = await request(app.getHttpServer()).get('/perfil/malla');

      expect(res.status).toBe(401);
      expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
    });

    it('falla de Storage al firmar la URL -> 500 SERVER_ERROR', async () => {
      createSignedUrl.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });

      const token = await firmarToken(
        { role: 'authenticated', sede_id: sedeMeridaId, rol: RolUsuario.ALUMNO },
        alumnoConMallaUsuarioId,
      );

      const res = await request(app.getHttpServer())
        .get('/perfil/malla')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(500);
      expect((res.body as ErrorBody).code).toBe('SERVER_ERROR');
    });
  });
```

- [ ] **Step 8: Correr la suite e2e de malla curricular**

Run: `cd App/backend && npm run test:e2e -- malla-curricular`
Expected: todos los tests en verde (los 12 existentes de Día 23 + los 5 nuevos de este task).

- [ ] **Step 9: Correr la suite e2e completa (sin regresión)**

Run: `cd App/backend && npm run test:e2e`
Expected: todas las suites existentes en verde, sin ninguna afectada por el cambio en `PerfilModule`/`PerfilController` (revisar en particular `perfil.e2e-spec.ts`, que sigue intacto — este task no modifica `GET /perfil`).

- [ ] **Step 10: Commit**

```bash
git add App/backend/src/malla-curricular/malla-curricular.service.ts App/backend/src/malla-curricular/malla-curricular.module.ts App/backend/src/perfil/perfil.module.ts App/backend/src/perfil/perfil.controller.ts App/backend/test/malla-curricular.e2e-spec.ts
git commit -m "feat(backend): GET /perfil/malla - descarga de malla curricular via signed URL

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Frontend — botón de descarga en el perfil de alumno

**Files:**
- Modify: `App/frontend/src/lib/api/perfil.ts` (agrega función nueva al final)
- Modify: `App/frontend/src/app/alumno/page.tsx` (imports + botón en `SeccionCarrera`)

**Interfaces:**
- Consumes: `apiFetchAuth` (`./http`), contrato `GET /perfil/malla` → `{ data: { url: string; nombreArchivo: string } | null }` (Task 1).
- Produces: `export function obtenerUrlDescargaMalla(): Promise<{ url: string; nombreArchivo: string } | null>` en `lib/api/perfil.ts`, consumido solo por `SeccionCarrera` en este task.

- [ ] **Step 1: Agregar `obtenerUrlDescargaMalla` a `lib/api/perfil.ts`**

Al final de `App/frontend/src/lib/api/perfil.ts` (después de `obtenerPerfil`), agrega:

```ts

/**
 * `GET /perfil/malla` — Fase 7, Día 24. Signed URL (5 min) de la malla
 * curricular de la carrera del propio alumno. `null` si su carrera
 * todavía no tiene malla subida — estado normal, no un error (ver
 * `SeccionCarrera` en `app/alumno/page.tsx`, que muestra un mensaje
 * tranquilizador en ese caso en vez de un `toast.error`).
 */
export function obtenerUrlDescargaMalla(): Promise<{
  url: string;
  nombreArchivo: string;
} | null> {
  return apiFetchAuth('/perfil/malla');
}
```

- [ ] **Step 2: Verificar tipos tras el Step 1**

Run: `cd App/frontend && npx tsc --noEmit`
Expected: sin salida, exit 0.

- [ ] **Step 3: Botón "Descargar malla curricular" en `SeccionCarrera`**

En `App/frontend/src/app/alumno/page.tsx`, el bloque de imports del inicio del archivo (líneas 1-10) queda:

```tsx
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api/http';
import {
  obtenerPerfil,
  obtenerUrlDescargaMalla,
  type ContactoAlumno,
  type Perfil,
  type PerfilAlumno,
} from '@/lib/api/perfil';
```

La función `SeccionCarrera` (hoy sin estado propio) queda:

```tsx
function SeccionCarrera({ alumno }: { alumno: PerfilAlumno }) {
  const carrera = alumno.carrera;
  const [descargando, setDescargando] = useState(false);

  async function handleDescargar() {
    setDescargando(true);
    try {
      const resultado = await obtenerUrlDescargaMalla();
      if (!resultado) {
        toast.info(
          'Tu malla curricular aún no ha sido cargada por la escuela. Estará disponible pronto.',
        );
        return;
      }
      window.open(resultado.url, '_blank');
    } catch (err) {
      console.error('[SeccionCarrera] Error al descargar malla curricular:', err);
      toast.error(
        err instanceof ApiError
          ? err.message
          : 'No se pudo descargar la malla curricular. Intenta de nuevo.',
      );
    } finally {
      setDescargando(false);
    }
  }

  return (
    <section className="rounded-lg border border-mist p-5">
      <h2 className="text-sm font-semibold text-navy">
        Carrera / plan de estudios
      </h2>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        <Campo etiqueta="Carrera" valor={carrera.nombre} />
        <Campo etiqueta="Clave" valor={carrera.clave} />
        <Campo etiqueta="RVOE" valor={carrera.rvoe} />
        <Campo
          etiqueta="Duración"
          valor={`${carrera.duracion} ${carrera.duracion === 1 ? 'semestre' : 'semestres'}`}
        />
        <Campo etiqueta="Nivel" valor={NIVEL_CARRERA_LABEL[carrera.nivel]} />
        <Campo
          etiqueta="Modalidad"
          valor={MODALIDAD_CARRERA_LABEL[carrera.modalidad]}
        />
        {carrera.descripcion && (
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium text-slate/50">Descripción</dt>
            <dd className="mt-0.5 text-sm text-slate">{carrera.descripcion}</dd>
          </div>
        )}
      </dl>
      <button
        onClick={handleDescargar}
        disabled={descargando}
        className="mt-4 rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
      >
        {descargando ? 'Generando enlace…' : 'Descargar malla curricular'}
      </button>
    </section>
  );
}
```

- [ ] **Step 4: Verificar tipos**

Run: `cd App/frontend && npx tsc --noEmit`
Expected: sin salida, exit 0.

- [ ] **Step 5: Verificar lint**

Run: `cd App/frontend && npx eslint src/lib/api/perfil.ts src/app/alumno/page.tsx`
Expected: sin salida, exit 0.

- [ ] **Step 6: Commit**

```bash
git add App/frontend/src/lib/api/perfil.ts App/frontend/src/app/alumno/page.tsx
git commit -m "feat(frontend): boton de descarga de malla curricular en perfil de alumno

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Verificación manual final (recomendada antes de cerrar Fase 7)

Con backend y frontend corriendo (`npm run start:dev` / `pnpm dev`): entrar a `/alumno` como un alumno de prueba cuya carrera ya tenga malla subida (ej. desde `/admin/carreras`, "Subir malla") → click en "Descargar malla curricular" → confirmar que abre una pestaña nueva con el PDF real. Repetir con un alumno de una carrera sin malla subida → confirmar el mensaje tranquilizador ("estará disponible pronto"), sin toast de error. Esperar más de 5 minutos y reintentar abrir una URL vieja copiada manualmente (si se guardó) → confirmar que Supabase la rechaza (signed URL expirada). Este es el entregable visible literal del roadmap ("alumno de prueba descarga su malla curricular real desde su perfil") y cierra la Fase 7 — actualizar `docs/roadmap.md` (tachar Día 24) y la línea "Fase actual" de `CLAUDE.md` raíz al confirmar.
