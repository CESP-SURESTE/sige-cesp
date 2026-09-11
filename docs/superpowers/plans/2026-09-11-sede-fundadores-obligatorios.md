# Sede con Fundadores Obligatorios — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /sedes` crea, en la misma request, una sede nueva + 2 cuentas
`ADMINISTRATIVO` reales fundadoras: un director (`SUPER_ADMIN`) y un administrativo
(`ADMIN`) — atómico para sede+director, best-effort para el segundo administrativo.

**Architecture:** Se extrae el núcleo de `PersonasService.altaPersona` (Auth + `$transaction`
+ compensación + correo) a un método privado reusable `ejecutarAltaPersona`, expuesto
también sin la jerarquía de `nivelPermiso` vía `altaAdministrativoFundador` (solo lo llama
`SedesService`). `SedesService.crearConFundadores` orquesta 3 pasos secuenciales
(Sede → Director → Administrativo), cada uno con su propia atomicidad interna ya
existente, con compensación manual (borrar la sede) solo si el paso del Director falla.

**Tech Stack:** NestJS + Prisma + class-validator (backend), Next.js + React Hook Form +
Zod + React Query (frontend), Jest + Supertest (e2e).

## Global Constraints

- Regla 1 de `CLAUDE.md` raíz: nunca persistir/confiar en el cliente un campo calculable
  o de autoridad — `nivelPermiso` de director/administrativo se fuerza server-side.
- Regla 2: `sedeId` nunca viene del cliente en rutas de negocio (no aplica directo acá —
  `POST /sedes` no tiene sede de contexto — pero los 2 altas fundadoras usan el `id` de
  la sede recién creada, nunca uno mandado por el cliente).
- Regla 3 (no negociable): nunca `DELETE` real de una persona (`Usuario`/perfiles) — solo
  baja lógica. La compensación de este flujo NUNCA borra un `Usuario` ya creado.
- Regla 11: `app/plataforma/` no importa de `app/admin/` ni de `components/admin/ui/` —
  todo componente de UI reusado se duplica dentro de `app/plataforma/`.
- Regla 12: todo catch/error handler loguea con `console.error` antes de responder.
- Contrato de API: `{ data: ... }` en éxito, `{ error, code }` en error; reutilizar
  `VALIDATION_ERROR`/`CONFLICT`/`SERVER_ERROR` — sin códigos nuevos.
- Spec de referencia: `docs/superpowers/specs/2026-09-11-sede-fundadores-obligatorios-design.md`.

---

### Task 1: Backend — extraer `ejecutarAltaPersona` + `altaAdministrativoFundador`

**Files:**
- Modify: `App/backend/src/personas/personas.service.ts:613-1108` (método `altaPersona`)
- Modify: `App/backend/src/personas/personas.module.ts`
- Test: `App/backend/test/personas.e2e-spec.ts` (regresión completa, sin cambios de
  contenido — solo se corre para confirmar que el refactor no rompe nada)

**Interfaces:**
- Produces: `PersonasService.altaAdministrativoFundador(dto: CrearPersonaDto, sedeId: string): Promise<AltaPersonaResult>` — usado por Task 2.
- Produces: `PersonasService` exportado desde `PersonasModule` — usado por Task 2.

- [ ] **Step 1: Extraer el núcleo de `altaPersona` a un método privado**

En `App/backend/src/personas/personas.service.ts`, el método `altaPersona` (líneas
613-1108) hoy hace: pre-checks + `verificarJerarquiaNivelPermiso` (líneas 613-731),
luego generación de login + Supabase Auth + `$transaction` + compensación + correo de
bienvenida (líneas 733-1107, empieza en el comentario `// --- Generación del login...`
y termina en el `}` que cierra el `catch` justo antes del `}` final del método).

Corta ese segundo bloque (733-1107) tal cual, sin modificar una sola línea, a un método
privado nuevo:

```ts
  private async ejecutarAltaPersona(
    dto: CrearPersonaDto,
    sedeId: string,
  ): Promise<AltaPersonaResult> {
    // ... contenido exacto de las líneas 733-1107, sin cambios ...
  }
```

Y deja `altaPersona` así (reemplaza el bloque cortado por una sola línea):

```ts
  async altaPersona(
    dto: CrearPersonaDto,
    sedeId: string,
    actorUsuarioId: string,
  ): Promise<AltaPersonaResult> {
    // ... pre-checks + verificarJerarquiaNivelPermiso, líneas 618-731 SIN CAMBIOS ...

    return this.ejecutarAltaPersona(dto, sedeId);
  }
```

- [ ] **Step 2: Agregar `altaAdministrativoFundador`**

Inmediatamente después del nuevo `ejecutarAltaPersona` (o después de `altaPersona`,
donde quede más legible), agrega:

```ts
  /**
   * Solo lo llama `SedesService.crearConFundadores` — sin controller/ruta
   * propia. Crea un ADMINISTRATIVO fundador de una sede recién creada, SIN
   * `verificarJerarquiaNivelPermiso` (no hay jerarquía previa que consultar:
   * 0 administrativos en la sede todavía; el actor real es `AdminPlataforma`,
   * por diseño ya por encima de esa jerarquía — mismo criterio del spec de
   * Día 20, `docs/superpowers/specs/2026-08-14-crud-sedes-admin-plataforma-design.md`).
   * `dto.perfilAdministrativo.nivelPermiso` debe venir ya resuelto por el
   * caller — `SedesService` lo fuerza a SUPER_ADMIN/ADMIN server-side, nunca
   * lo decide el cliente (regla 1 de CLAUDE.md raíz).
   */
  async altaAdministrativoFundador(
    dto: CrearPersonaDto,
    sedeId: string,
  ): Promise<AltaPersonaResult> {
    if (dto.codigoExterno) {
      const codigoExternoEnUso = await this.prisma.usuario.findUnique({
        where: { codigoExterno: dto.codigoExterno },
        select: { id: true },
      });
      if (codigoExternoEnUso) {
        throw new ConflictException({
          error: 'Ya existe un usuario con ese código externo',
          code: 'CONFLICT',
        });
      }
    }

    if (!dto.perfilAdministrativo) {
      throw new BadRequestException({
        error: 'perfilAdministrativo es requerido',
        code: 'VALIDATION_ERROR',
      });
    }

    return this.ejecutarAltaPersona(dto, sedeId);
  }
```

- [ ] **Step 3: Exportar `PersonasService` desde `PersonasModule`**

En `App/backend/src/personas/personas.module.ts`, cambia:

```ts
  exports: [PERSONAS_SUPABASE_CLIENT_OVERRIDE],
```

por:

```ts
  exports: [PersonasService, PERSONAS_SUPABASE_CLIENT_OVERRIDE],
```

- [ ] **Step 4: Verificar que el refactor no rompió nada**

Run: `cd App/backend && pnpm test:e2e -- personas.e2e-spec.ts`
Expected: mismos resultados que antes del refactor (todos los `it` en verde) — es un
refactor puro, cero cambio de comportamiento esperado.

Run: `cd App/backend && pnpm build`
Expected: compila sin errores (confirma que `ejecutarAltaPersona` quedó bien tipado y
`PersonasModule` exporta correctamente).

- [ ] **Step 5: Commit**

```bash
git add App/backend/src/personas/personas.service.ts App/backend/src/personas/personas.module.ts
git commit -m "refactor(backend): extraer ejecutarAltaPersona + altaAdministrativoFundador

Prepara PersonasService para ser reusado por SedesService.crearConFundadores
sin pasar por verificarJerarquiaNivelPermiso (el actor AdminPlataforma ya
está por encima de esa jerarquía). Refactor puro, sin cambio de
comportamiento en POST /personas."
```

---

### Task 2: Backend — `SedesService.crearConFundadores` + DTOs + controller

**Files:**
- Create: `App/backend/src/sedes/dto/crear-sede-con-fundadores.dto.ts`
- Modify: `App/backend/src/sedes/sedes.service.ts`
- Modify: `App/backend/src/sedes/sedes.controller.ts`
- Modify: `App/backend/src/sedes/sedes.module.ts`
- Modify: `App/backend/test/sedes-crud.e2e-spec.ts` (el test `POST /sedes crea una sede...`
  ya no puede mandar solo los 4 campos planos — necesita `sede`/`director`/`administrativo`
  y el mock de Supabase Auth)

**Interfaces:**
- Consumes: `PersonasService.altaAdministrativoFundador(dto, sedeId)` (Task 1),
  `AltaPersonaResult` (`App/backend/src/personas/personas.service.ts:179`).
- Produces: `SedesService.crearConFundadores(dtoSede, dtoDirector, dtoAdministrativo, actorPlatformAdminId): Promise<{ sede: Sede; director: AltaPersonaResult; administrativo: AltaPersonaResult | null; advertenciaAdministrativo?: string }>` — usado por Task 3 (tests) y el frontend (Task 4).

- [ ] **Step 1: DTO nuevo**

Crea `App/backend/src/sedes/dto/crear-sede-con-fundadores.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { IsDefined, ValidateNested } from 'class-validator';
import { PerfilAdministrativoDto } from '../../personas/dto/crear-persona.dto';
import { CrearSedeDto } from './crear-sede.dto';

/**
 * `POST /sedes` (2026-09-11) — la sede ya no se da de alta sola: el body
 * ahora exige también los datos de las 2 cuentas fundadoras (director +
 * administrativo). Reutiliza `PerfilAdministrativoDto` tal cual (mismas
 * reglas de contactos 1-3 + info médica con `tipoSangre` obligatorio que
 * cualquier alta de ADMINISTRATIVO) — su campo `nivelPermiso` se ignora
 * si viene, `SedesService.crearConFundadores` lo fuerza server-side
 * (SUPER_ADMIN para `director`, ADMIN para `administrativo`).
 */
export class CrearSedeConFundadoresDto {
  @IsDefined({ message: 'sede es requerido' })
  @ValidateNested()
  @Type(() => CrearSedeDto)
  sede!: CrearSedeDto;

  @IsDefined({ message: 'director es requerido' })
  @ValidateNested()
  @Type(() => PerfilAdministrativoDto)
  director!: PerfilAdministrativoDto;

  @IsDefined({ message: 'administrativo es requerido' })
  @ValidateNested()
  @Type(() => PerfilAdministrativoDto)
  administrativo!: PerfilAdministrativoDto;
}
```

- [ ] **Step 2: `SedesModule` importa `PersonasModule`**

En `App/backend/src/sedes/sedes.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PersonasModule } from '../personas/personas.module';
import { SedesController } from './sedes.controller';
import { SedesService } from './sedes.service';

@Module({
  imports: [PersonasModule],
  controllers: [SedesController],
  providers: [SedesService],
})
export class SedesModule {}
```

- [ ] **Step 3: `SedesService.crearConFundadores`**

En `App/backend/src/sedes/sedes.service.ts`, el archivo ya importa (línea 6):

```ts
import { AccionAuditoria, Prisma, RolUsuario, type Sede } from '@prisma/client';
```

Cámbiala para agregar `NivelPermiso` (no dupliques un import nuevo de `@prisma/client`,
solo agrega el nombre a esta misma línea):

```ts
import { AccionAuditoria, NivelPermiso, Prisma, RolUsuario, type Sede } from '@prisma/client';
```

Y agrega, junto a los otros imports del tope del archivo:

```ts
import type {
  CrearPersonaDto,
  PerfilAdministrativoDto,
} from '../personas/dto/crear-persona.dto';
import { PersonasService, type AltaPersonaResult } from '../personas/personas.service';
```

Inyecta `PersonasService` en el constructor:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly personasService: PersonasService,
  ) {}
```

Agrega el método nuevo (después de `crear`, antes de `listar`):

```ts
  /**
   * `POST /sedes` (2026-09-11) — crea la sede + 2 cuentas ADMINISTRATIVO
   * fundadoras (director `SUPER_ADMIN` + administrativo `ADMIN`). Ver
   * `docs/superpowers/specs/2026-09-11-sede-fundadores-obligatorios-design.md`
   * para la justificación completa de la estrategia de atomicidad.
   *
   * Atómico de verdad para Sede+Director: si el alta del director falla, la
   * sede recién creada (0 dependientes todavía) se borra — mismo camino que
   * `eliminar`. El segundo administrativo es best-effort: si falla, sede y
   * director quedan creados (regla 3 de CLAUDE.md raíz prohíbe deshacer una
   * persona ya creada) y la respuesta trae `administrativo: null` +
   * `advertenciaAdministrativo`.
   */
  async crearConFundadores(
    dtoSede: CrearSedeDto,
    dtoDirector: PerfilAdministrativoDto,
    dtoAdministrativo: PerfilAdministrativoDto,
    actorPlatformAdminId: string,
  ): Promise<{
    sede: Sede;
    director: AltaPersonaResult;
    administrativo: AltaPersonaResult | null;
    advertenciaAdministrativo?: string;
  }> {
    const sede = await this.crear(dtoSede, actorPlatformAdminId);

    const dtoDirectorCompleto: CrearPersonaDto = {
      rol: RolUsuario.ADMINISTRATIVO,
      perfilAdministrativo: {
        ...dtoDirector,
        nivelPermiso: NivelPermiso.SUPER_ADMIN,
      },
    };

    let director: AltaPersonaResult;
    try {
      director = await this.personasService.altaAdministrativoFundador(
        dtoDirectorCompleto,
        sede.id,
      );
    } catch (err) {
      console.error(
        '[SedesService.crearConFundadores] Falló el alta del director — compensando (borrando la sede recién creada):',
        err,
      );
      try {
        await this.eliminar(sede.id, actorPlatformAdminId);
      } catch (compensationErr) {
        console.error(
          '[SedesService.crearConFundadores] CRÍTICO: no se pudo borrar la sede tras el fallo del director — queda huérfana, requiere limpieza manual:',
          { sedeId: sede.id, compensationErr },
        );
      }
      throw err;
    }

    const dtoAdministrativoCompleto: CrearPersonaDto = {
      rol: RolUsuario.ADMINISTRATIVO,
      perfilAdministrativo: {
        ...dtoAdministrativo,
        nivelPermiso: NivelPermiso.ADMIN,
      },
    };

    try {
      const administrativo = await this.personasService.altaAdministrativoFundador(
        dtoAdministrativoCompleto,
        sede.id,
      );
      return { sede, director, administrativo };
    } catch (err) {
      console.error(
        '[SedesService.crearConFundadores] Falló el alta del segundo administrativo — sede y director quedan creados, sin deshacer (regla 3):',
        err,
      );
      return {
        sede,
        director,
        administrativo: null,
        advertenciaAdministrativo:
          'La sede y el director se crearon correctamente, pero el segundo administrativo no pudo darse de alta. Inicia sesión como el director y complétalo desde "Administrativos > Nuevo".',
      };
    }
  }
```

- [ ] **Step 4: `SedesController.crear` usa el nuevo DTO/método**

En `App/backend/src/sedes/sedes.controller.ts`, reemplaza el import de `CrearSedeDto`
por `CrearSedeConFundadoresDto` y actualiza el handler:

```ts
import { CrearSedeConFundadoresDto } from './dto/crear-sede-con-fundadores.dto';
// (elimina el import de CrearSedeDto si ya no se usa en ningún otro handler de
// este archivo — confírmalo con grep antes de borrarlo)

  @Post()
  @HttpCode(201)
  @UseGuards(PlatformAdminGuard)
  async crear(
    @Body() body: CrearSedeConFundadoresDto,
    @PlatformAdminActual() actorId: string,
  ) {
    const data = await this.sedesService.crearConFundadores(
      body.sede,
      body.director,
      body.administrativo,
      actorId,
    );
    return { data };
  }
```

- [ ] **Step 5: Actualizar el test existente que rompe con el nuevo contrato**

`App/backend/test/sedes-crud.e2e-spec.ts` tiene un test `POST /sedes crea una sede y
audita con adminPlataformaId` (líneas 110-130) que manda el body plano viejo — con el
DTO nuevo, eso ahora falla con `400 VALIDATION_ERROR` (`director`/`administrativo`
faltantes). Este archivo también necesita el mock de Supabase Auth (mismo patrón que
`test/personas.e2e-spec.ts`), porque `POST /sedes` ahora dispara 2 altas de persona.

Agrega los imports al tope de `sedes-crud.e2e-spec.ts` (junto a los existentes):

```ts
import { NivelPermiso, PuestoAdministrativo, RolUsuario } from '@prisma/client';
import { PERSONAS_SUPABASE_CLIENT_OVERRIDE } from '../src/personas/personas.service';
```

(Ojo: `RolUsuario` ya se importa en este archivo, línea 4 — no lo dupliques, solo agrega
`NivelPermiso`/`PuestoAdministrativo` a esa misma línea de import existente. No hace
falta `TipoContacto` — los fundadores usan `ContactoDto`/`contactoValido()` sin `tipo`,
ese campo es exclusivo de `ContactoAlumnoDto`.)

Agrega los helpers (mismo patrón que `test/personas.e2e-spec.ts`, copiados tal cual):

```ts
  function contactoValido(overrides: Record<string, unknown> = {}) {
    return {
      nombre: 'Contacto Prueba',
      telefono: '9990004444',
      parentesco: 'Padre',
      ...overrides,
    };
  }

  function infoMedicaValida(overrides: Record<string, unknown> = {}) {
    return {
      tieneCondicionMedica: false,
      tipoSangre: 'O_POSITIVO',
      ...overrides,
    };
  }

  function fundadorValido(overrides: Record<string, unknown> = {}) {
    return {
      nombres: 'Prueba',
      apellidoPaterno: 'Fundador',
      curp: `CURP${randomUUID().slice(0, 14).toUpperCase()}`,
      correoPersonal: `fundador.${randomUUID()}@example.com`,
      telefono: '9990001111',
      fechaContratacion: '2026-01-01',
      puesto: PuestoAdministrativo.DIRECTOR,
      contactos: [contactoValido()],
      infoMedica: infoMedicaValida(),
      ...overrides,
    };
  }

  function mockCreateUserExitoso() {
    createUser.mockImplementation(({ email }: { email: string }) => ({
      data: {
        user: {
          id: randomUUID(),
          email,
          aud: 'authenticated',
          role: 'authenticated',
          app_metadata: {},
          user_metadata: {},
        },
      },
      error: null,
    }));
  }
```

Modifica `beforeAll` para inyectar el mock (agrega las variables `createUser`/
`deleteUser` al `describe` junto a `token`, y encadena `.overrideProvider` antes del
`.compile()` existente):

```ts
  let createUser: jest.Mock;
  let deleteUser: jest.Mock;

  beforeAll(async () => {
    createUser = jest.fn();
    deleteUser = jest.fn().mockResolvedValue({ data: {}, error: null });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PERSONAS_SUPABASE_CLIENT_OVERRIDE)
      .useValue({ auth: { admin: { createUser, deleteUser } } })
      .compile();

    // ... resto del beforeAll sin cambios ...
```

Reemplaza el test `POST /sedes crea una sede y audita con adminPlataformaId` (líneas
110-130) por:

```ts
  it('POST /sedes crea una sede + director + administrativo, audita con adminPlataformaId', async () => {
    mockCreateUserExitoso();

    const res = await request(app.getHttpServer())
      .post('/sedes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sede: {
          nombre: nombreSedePrueba,
          direccion: 'Calle Falsa 123',
          ubicacionReferencia: 'Frente al parque',
          telefono: '9991234567',
        },
        director: fundadorValido({ correoPersonal: `director.${randomUUID()}@example.com` }),
        administrativo: fundadorValido({
          correoPersonal: `admin.${randomUUID()}@example.com`,
        }),
      });

    expect(res.status).toBe(201);
    const body = res.body as {
      data: {
        sede: { id: string; nombre: string };
        director: { usuario: { id: string } };
        administrativo: { usuario: { id: string } } | null;
      };
    };
    expect(body.data.sede.nombre).toBe(nombreSedePrueba);
    expect(body.data.director.usuario.id).toBeTruthy();
    expect(body.data.administrativo?.usuario.id).toBeTruthy();
    sedeCreadaId = body.data.sede.id;

    const registro = await prisma.registroAuditoria.findFirst({
      where: { entidad: 'Sede', entidadId: sedeCreadaId },
    });
    expect(registro?.adminPlataformaId).not.toBeNull();
    expect(registro?.usuarioId).toBeNull();

    const director = await prisma.perfilAdministrativo.findUnique({
      where: { usuarioId: body.data.director.usuario.id },
    });
    expect(director?.nivelPermiso).toBe(NivelPermiso.SUPER_ADMIN);

    const administrativo = await prisma.perfilAdministrativo.findUnique({
      where: { usuarioId: body.data.administrativo!.usuario.id },
    });
    expect(administrativo?.nivelPermiso).toBe(NivelPermiso.ADMIN);
  });
```

El `afterAll` ya borra `Usuario` por `sedeId: { in: idsSedesPrueba }` (línea 98-100) —
cubre a los 2 fundadores creados por este test sin cambios adicionales.

- [ ] **Step 6: Verificar**

Run: `cd App/backend && pnpm build`
Expected: compila sin errores.

Run: `cd App/backend && pnpm test:e2e -- sedes-crud.e2e-spec.ts`
Expected: todos los tests en verde, incluyendo el actualizado.

- [ ] **Step 7: Commit**

```bash
git add App/backend/src/sedes App/backend/test/sedes-crud.e2e-spec.ts
git commit -m "feat(backend): POST /sedes crea sede + director + administrativo fundadores

SedesService.crearConFundadores orquesta 3 altas: la sede, luego el
director (SUPER_ADMIN, atómico con la sede - se compensa borrándola si
falla) y el administrativo (ADMIN, best-effort - regla 3 no permite
deshacer una persona ya creada si falla después del director).
nivelPermiso se fuerza server-side, nunca lo decide el cliente."
```

---

### Task 3: Backend — e2e de los 2 caminos de falla (compensación)

**Files:**
- Modify: `App/backend/test/sedes-crud.e2e-spec.ts`

**Interfaces:**
- Consumes: `SedesService.crearConFundadores` (Task 2), mocks `createUser`/`deleteUser`
  ya wireados en Task 2.

- [ ] **Step 1: Test — falla el director → la sede se borra, nada queda**

Agrega, en el mismo `describe`, después del test de Task 2:

```ts
  it('POST /sedes — falla el alta del director -> la sede recién creada se borra (nada queda)', async () => {
    // El director es el primer alta que llama a Supabase Auth -> falla de
    // entrada, así que ni siquiera se intenta el administrativo.
    createUser.mockReset();
    createUser.mockImplementation(() => ({
      data: null,
      error: { code: 'unexpected_failure', status: 500, message: 'boom' },
    }));

    const nombreSedeFalla = `Sede E2E Falla Director ${Date.now()}`;

    const res = await request(app.getHttpServer())
      .post('/sedes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sede: {
          nombre: nombreSedeFalla,
          direccion: 'Calle Falsa 456',
          ubicacionReferencia: 'Frente al mercado',
          telefono: '9991234568',
        },
        director: fundadorValido({ correoPersonal: `director-falla.${randomUUID()}@example.com` }),
        administrativo: fundadorValido({
          correoPersonal: `admin-falla.${randomUUID()}@example.com`,
        }),
      });

    expect(res.status).toBe(500);

    const sedeHuerfana = await prisma.sede.findUnique({
      where: { nombre: nombreSedeFalla },
    });
    expect(sedeHuerfana).toBeNull();
  });
```

- [ ] **Step 2: Test — falla el segundo administrativo → sede+director quedan, advertencia presente**

```ts
  it('POST /sedes — falla el alta del administrativo -> sede+director quedan, respuesta trae advertencia', async () => {
    createUser.mockReset();
    let llamada = 0;
    createUser.mockImplementation(({ email }: { email: string }) => {
      llamada += 1;
      if (llamada === 1) {
        // Director: éxito
        return {
          data: {
            user: {
              id: randomUUID(),
              email,
              aud: 'authenticated',
              role: 'authenticated',
              app_metadata: {},
              user_metadata: {},
            },
          },
          error: null,
        };
      }
      // Administrativo: falla
      return {
        data: null,
        error: { code: 'unexpected_failure', status: 500, message: 'boom' },
      };
    });

    const nombreSedeParcial = `Sede E2E Falla Administrativo ${Date.now()}`;

    const res = await request(app.getHttpServer())
      .post('/sedes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sede: {
          nombre: nombreSedeParcial,
          direccion: 'Calle Falsa 789',
          ubicacionReferencia: 'Frente a la plaza',
          telefono: '9991234569',
        },
        director: fundadorValido({
          correoPersonal: `director-parcial.${randomUUID()}@example.com`,
        }),
        administrativo: fundadorValido({
          correoPersonal: `admin-parcial.${randomUUID()}@example.com`,
        }),
      });

    expect(res.status).toBe(201);
    const body = res.body as {
      data: {
        sede: { id: string };
        director: { usuario: { id: string } };
        administrativo: null;
        advertenciaAdministrativo: string;
      };
    };
    expect(body.data.administrativo).toBeNull();
    expect(body.data.advertenciaAdministrativo).toContain('director');

    const sedeParcial = await prisma.sede.findUnique({
      where: { id: body.data.sede.id },
    });
    expect(sedeParcial).not.toBeNull();

    const director = await prisma.usuario.findUnique({
      where: { id: body.data.director.usuario.id },
    });
    expect(director).not.toBeNull();
  });
```

- [ ] **Step 3: Ajustar `afterAll` para limpiar las 2 sedes nuevas de este task**

El `afterAll` ya existente filtra sedes por `nombre: { startsWith: 'Sede E2E ' }` (línea
94-96) — los nombres `Sede E2E Falla Director ...`/`Sede E2E Falla Administrativo ...`
ya matchean ese prefijo, sin cambios necesarios ahí. El `Usuario` del director creado en
el Step 2 de este task también cae dentro de `usuario.deleteMany({ where: { sedeId: {
in: idsSedesPrueba } } })` (línea 98-100) — confírmalo, no requiere cambio.

- [ ] **Step 4: Correr el suite completo**

Run: `cd App/backend && pnpm test:e2e -- sedes-crud.e2e-spec.ts`
Expected: los 3 tests de `POST /sedes` en verde (feliz, falla director, falla
administrativo), más los tests preexistentes de `PATCH`/`DELETE /sedes` sin romperse.

Run: `cd App/backend && pnpm test:e2e`
Expected: suite e2e completa en verde (regresión — nada de lo tocado en Tasks 1-3 debe
romper otro módulo).

- [ ] **Step 5: Commit**

```bash
git add App/backend/test/sedes-crud.e2e-spec.ts
git commit -m "test(backend): cubrir los 2 caminos de falla de POST /sedes con fundadores

Falla el director -> la sede se borra (compensación real, nada queda).
Falla el segundo administrativo -> sede+director quedan creados (regla 3
no permite deshacerlos), respuesta trae advertenciaAdministrativo."
```

---

### Task 4: Frontend — `lib/api/sedes.ts` con el nuevo contrato

**Files:**
- Modify: `App/frontend/src/lib/api/sedes.ts`

**Interfaces:**
- Produces: `FundadorInput`, `CrearSedeConFundadoresInput`, `CrearSedeConFundadoresResult`,
  `crearSedeConFundadores(input): Promise<CrearSedeConFundadoresResult>` — usados por
  Task 6.

- [ ] **Step 1: Agregar los tipos y la función nuevos**

En `App/frontend/src/lib/api/sedes.ts`, agrega (después de `SedeInput`, antes de
`listarSedes`):

```ts
/** Espejo de `ContactoDto` (backend, sin `tipo` — exclusivo de alumno). */
export interface ContactoInput {
  nombre: string;
  telefono: string;
  correo?: string;
  parentesco: string;
}

/** Espejo de `InfoMedicaDto` (backend) — `tipoSangre` requerido desde 2026-09-07. */
export interface InfoMedicaInput {
  tieneCondicionMedica: boolean;
  tipoSangre: string;
  padecimiento?: string;
  medicamentos?: string;
  alergias?: string;
  tratamientoAdicional?: string;
}

/**
 * Espejo de `PerfilAdministrativoDto` (backend) SIN `nivelPermiso` — el
 * backend lo fuerza server-side (SUPER_ADMIN para director, ADMIN para
 * administrativo, ver `SedesService.crearConFundadores`), el cliente nunca
 * lo manda para este flujo.
 */
export interface FundadorInput {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno?: string;
  curp: string;
  correoPersonal: string;
  telefono: string;
  /** ISO date (`YYYY-MM-DD`). */
  fechaContratacion: string;
  puesto: string;
  contactos: ContactoInput[];
  infoMedica: InfoMedicaInput;
}

export interface CrearSedeConFundadoresInput {
  sede: SedeInput;
  director: FundadorInput;
  administrativo: FundadorInput;
}

/** Espejo de `UsuarioAltaResult`/`AltaPersonaResult` (backend, `personas.service.ts`). */
export interface FundadorAltaResult {
  usuario: { id: string; email: string; rol: string; sedeId: string };
  temporaryPassword: string;
}

export interface CrearSedeConFundadoresResult {
  sede: Sede;
  director: FundadorAltaResult;
  /** `null` si el alta del administrativo falló (best-effort, ver `advertenciaAdministrativo`). */
  administrativo: FundadorAltaResult | null;
  advertenciaAdministrativo?: string;
}

export function crearSedeConFundadores(
  input: CrearSedeConFundadoresInput,
): Promise<CrearSedeConFundadoresResult> {
  return platformFetch<CrearSedeConFundadoresResult>('/sedes', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
```

Deja `crearSede`/`SedeInput` existentes intactos — `SedeInput` se reusa dentro de
`CrearSedeConFundadoresInput.sede`; `crearSede` (la función vieja, body plano) queda sin
uso desde `app/plataforma/sedes/page.tsx` después de Task 7, pero **no la borres en este
task** — Task 7 decide si queda muerta o se remueve, para no romper la compilación a
medio camino entre tasks.

- [ ] **Step 2: Verificar tipos**

Run: `cd App/frontend && pnpm build`
Expected: compila sin errores (nadie más usa `crearSedeConFundadores` todavía, pero el
archivo debe tipar limpio de forma aislada).

- [ ] **Step 3: Commit**

```bash
git add App/frontend/src/lib/api/sedes.ts
git commit -m "feat(frontend): cliente de POST /sedes con fundadores (lib/api/sedes.ts)"
```

---

### Task 5: Frontend — duplicar el kit de "alta de persona" dentro de `app/plataforma/`

**Files:**
- Create: `App/frontend/src/app/plataforma/sedes/nueva/persona-alta/estilos.ts`
- Create: `App/frontend/src/app/plataforma/sedes/nueva/persona-alta/mensajes-error.ts`
- Create: `App/frontend/src/app/plataforma/sedes/nueva/persona-alta/schemas.ts`
- Create: `App/frontend/src/app/plataforma/sedes/nueva/persona-alta/FieldError.tsx`
- Create: `App/frontend/src/app/plataforma/sedes/nueva/persona-alta/Select.tsx`
- Create: `App/frontend/src/app/plataforma/sedes/nueva/persona-alta/AltaPersonaFormShell.tsx`
- Create: `App/frontend/src/app/plataforma/sedes/nueva/persona-alta/CuentaFieldset.tsx`
- Create: `App/frontend/src/app/plataforma/sedes/nueva/persona-alta/DatosPersonalesFieldset.tsx`
- Create: `App/frontend/src/app/plataforma/sedes/nueva/persona-alta/ContactosFieldset.tsx`
- Create: `App/frontend/src/app/plataforma/sedes/nueva/persona-alta/InfoMedicaFieldset.tsx`

**Interfaces:**
- Produces: mismos exports que sus originales en `components/admin/ui/persona-alta/`
  (`contactosSchema`, `infoMedicaSchema`, `TIPO_SANGRE_VALORES`, `TipoSangre`,
  `ContactosFieldset`, `CuentaFieldset`, `DatosPersonalesFieldset`, `InfoMedicaFieldset`,
  `AltaPersonaFormShell`, `FieldError`, `Select`, `INPUT_CLASS`, `LABEL_CLASS`,
  `resolverMensajeError`, `MENSAJE_ERROR_GENERICO`) — usados por Task 6.

- [ ] **Step 1: Copiar los 10 archivos tal cual**

Ninguno de estos 10 archivos importa de `@/lib/api/personas` ni de nada específico de
`app/admin/` (verificado — solo se importan entre ellos por ruta relativa, más
`react-hook-form`/`zod`/`@headlessui/react`/`sonner`/`@/lib/api/http`, todas libs
compartidas). Cópialos byte a byte, sin modificar ni una línea:

```bash
cd App/frontend/src
mkdir -p app/plataforma/sedes/nueva/persona-alta
for f in estilos.ts mensajes-error.ts schemas.ts FieldError.tsx Select.tsx \
         AltaPersonaFormShell.tsx CuentaFieldset.tsx DatosPersonalesFieldset.tsx \
         ContactosFieldset.tsx InfoMedicaFieldset.tsx; do
  cp "components/admin/ui/persona-alta/$f" "app/plataforma/sedes/nueva/persona-alta/$f"
done
```

Al tope de cada archivo copiado, agrega este comentario (regla 11 de `CLAUDE.md` raíz —
documentar la duplicación deliberada, mismo criterio ya usado en `Skeleton.tsx`/
`PlataformaNav.tsx` de este árbol):

```ts
// Duplicado deliberado de `components/admin/ui/persona-alta/<NOMBRE_DEL_ARCHIVO>`
// (regla 11 de CLAUDE.md raíz — app/plataforma/ no importa de app/admin/).
// Mantener en sync a mano si el original cambia.
```

- [ ] **Step 2: Verificar que compilan de forma aislada**

Run: `cd App/frontend && pnpm build`
Expected: compila sin errores — estos 10 archivos no se usan todavía en ningún lado
(Task 6 los conecta), así que solo se valida que el copy-paste no introdujo un import
roto.

Run: `cd App/frontend && pnpm lint`
Expected: limpio, sin warnings nuevos.

- [ ] **Step 3: Commit**

```bash
git add App/frontend/src/app/plataforma/sedes/nueva/persona-alta
git commit -m "feat(frontend): duplicar kit de alta de persona dentro de app/plataforma/

Regla 11 de CLAUDE.md raíz — app/plataforma/ no importa de app/admin/.
10 archivos copiados tal cual (schemas, fieldsets, shell, estilos) para
construir el formulario de fundadores de sede en app/plataforma/sedes/nueva/."
```

---

### Task 6: Frontend — página `app/plataforma/sedes/nueva/page.tsx`

**Files:**
- Create: `App/frontend/src/app/plataforma/sedes/nueva/CredencialesCard.tsx`
- Create: `App/frontend/src/app/plataforma/sedes/nueva/page.tsx`

**Interfaces:**
- Consumes: `crearSedeConFundadores`, `FundadorInput`, `CrearSedeConFundadoresResult`,
  `FundadorAltaResult` (`@/lib/api/sedes`, Task 4); `contactosSchema`, `infoMedicaSchema`,
  `TIPO_SANGRE_VALORES`, `AltaPersonaFormShell`, `ContactosFieldset`, `CuentaFieldset`,
  `DatosPersonalesFieldset`, `InfoMedicaFieldset`, `FieldError`, `Select`, `INPUT_CLASS`,
  `LABEL_CLASS`, `resolverMensajeError`, `MENSAJE_ERROR_GENERICO` (`./persona-alta/*`,
  Task 5).

- [ ] **Step 1: `CredencialesCard.tsx` — tarjeta de resultado por persona (sin botones propios)**

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { FundadorAltaResult } from '@/lib/api/sedes';

/**
 * Tarjeta de credenciales de UNA cuenta fundadora — versión recortada de
 * `components/admin/ui/persona-alta/ResultadoAltaPersona.tsx` (regla 11, no
 * se importa de ahí): esta pantalla muestra 2 cuentas a la vez (director +
 * administrativo) bajo una sola sede, así que las acciones de "otro alta" /
 * "volver" viven UNA vez a nivel de página (`page.tsx`), no repetidas por
 * tarjeta. Sin `matricula` (exclusivo de ALUMNO, no aplica acá).
 */
interface CredencialesCardProps {
  titulo: string;
  resultado: FundadorAltaResult;
}

export function CredencialesCard({ titulo, resultado }: CredencialesCardProps) {
  const [copiado, setCopiado] = useState(false);

  async function copiarPassword() {
    try {
      await navigator.clipboard.writeText(resultado.temporaryPassword);
      setCopiado(true);
      toast.success('Contraseña copiada al portapapeles');
    } catch (err) {
      console.error('[CredencialesCard] No se pudo copiar la contraseña temporal:', err);
    }
  }

  return (
    <div className="rounded-lg border border-success-border bg-success-bg p-4">
      <h3 className="text-sm font-semibold text-slate">{titulo}</h3>
      <dl className="mt-3 space-y-3 text-sm">
        <div>
          <dt className="font-medium text-slate/70">Correo</dt>
          <dd className="text-slate">{resultado.usuario.email}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate/70">Contraseña temporal</dt>
          <dd className="mt-1 flex items-center gap-2">
            <code className="rounded-lg border border-gold bg-white px-2 py-1 text-slate">
              {resultado.temporaryPassword}
            </code>
            <button
              type="button"
              onClick={copiarPassword}
              className="rounded-lg border border-mist px-2 py-1 text-xs font-medium text-slate/80 hover:bg-bone"
            >
              {copiado ? 'Copiado' : 'Copiar'}
            </button>
          </dd>
        </div>
      </dl>
    </div>
  );
}
```

- [ ] **Step 2: `page.tsx` — formulario de 3 secciones + pantalla de resultado**

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { getPlatformToken } from '@/lib/api/platform-http';
import {
  crearSedeConFundadores,
  type CrearSedeConFundadoresResult,
} from '@/lib/api/sedes';
import { PlataformaNav } from '../../PlataformaNav';
import { AltaPersonaFormShell } from './persona-alta/AltaPersonaFormShell';
import { ContactosFieldset } from './persona-alta/ContactosFieldset';
import { CredencialesCard } from './CredencialesCard';
import { DatosPersonalesFieldset } from './persona-alta/DatosPersonalesFieldset';
import { FieldError } from './persona-alta/FieldError';
import { INPUT_CLASS, LABEL_CLASS } from './persona-alta/estilos';
import { InfoMedicaFieldset } from './persona-alta/InfoMedicaFieldset';
import {
  MENSAJE_ERROR_GENERICO,
  resolverMensajeError,
} from './persona-alta/mensajes-error';
import { contactosSchema, infoMedicaSchema } from './persona-alta/schemas';
import { Select } from './persona-alta/Select';

/**
 * `POST /sedes` con fundadores (2026-09-11) — ver
 * `docs/superpowers/specs/2026-09-11-sede-fundadores-obligatorios-design.md`.
 * Reemplaza el modo "alta" de `SedeModal` (que sigue existiendo solo para
 * edición, ver Task 7) — 2 altas completas de ADMINISTRATIVO no caben en un
 * modal (mismo motivo por el que `app/admin/administrativos/nuevo/` ya es
 * página completa, no modal, regla 13 de CLAUDE.md raíz).
 */

const PUESTO_OPCIONES = [
  'DIRECTOR',
  'COORDINADOR_ACADEMICO',
  'COORDINADOR_ADMINISTRATIVO',
  'AUXILIAR',
  'RECEPCION',
  'OTRO',
] as const;

const fundadorSchema = z.object({
  nombres: z.string().min(1, 'Los nombres son requeridos'),
  apellidoPaterno: z.string().min(1, 'El apellido paterno es requerido'),
  apellidoMaterno: z.string().optional(),
  curp: z.string().min(1, 'El CURP es requerido'),
  correoPersonal: z
    .string()
    .min(1, 'El correo personal es requerido')
    .email('Formato de correo inválido'),
  telefono: z.string().min(1, 'El teléfono es requerido'),
  fechaContratacion: z.string().min(1, 'La fecha de contratación es requerida'),
  puesto: z.enum(PUESTO_OPCIONES, { message: 'Selecciona un puesto' }),
  contactos: contactosSchema,
  infoMedica: infoMedicaSchema,
});

const formSchema = z.object({
  sede: z.object({
    nombre: z.string().min(1, 'El nombre es requerido'),
    direccion: z.string().min(1, 'La dirección es requerida'),
    ubicacionReferencia: z.string().min(1, 'La referencia de ubicación es requerida'),
    telefono: z.string().min(1, 'El teléfono es requerido'),
  }),
  director: fundadorSchema,
  administrativo: fundadorSchema,
});

type FormValues = z.infer<typeof formSchema>;

function fundadorVacio(): FormValues['director'] {
  return {
    nombres: '',
    apellidoPaterno: '',
    apellidoMaterno: '',
    curp: '',
    correoPersonal: '',
    telefono: '',
    fechaContratacion: '',
    puesto: '' as FormValues['director']['puesto'],
    contactos: [{ nombre: '', telefono: '', correo: '', parentesco: '' }],
    infoMedica: {
      tieneCondicionMedica: false,
      tipoSangre: '' as FormValues['director']['infoMedica']['tipoSangre'],
      padecimiento: '',
      medicamentos: '',
      alergias: '',
      tratamientoAdicional: '',
    },
  };
}

const DEFAULT_VALUES: FormValues = {
  sede: { nombre: '', direccion: '', ubicacionReferencia: '', telefono: '' },
  director: fundadorVacio(),
  administrativo: fundadorVacio(),
};

/** Arma el sub-objeto `FundadorInput` (backend) desde los valores del form de una sección. */
function construirFundador(valores: FormValues['director']) {
  return {
    ...valores,
    apellidoMaterno: valores.apellidoMaterno || undefined,
    contactos: valores.contactos.map((c) => ({ ...c, correo: c.correo || undefined })),
    infoMedica: {
      tipoSangre: valores.infoMedica.tipoSangre,
      ...(valores.infoMedica.tieneCondicionMedica
        ? {
            tieneCondicionMedica: true,
            padecimiento: valores.infoMedica.padecimiento || undefined,
            medicamentos: valores.infoMedica.medicamentos || undefined,
            alergias: valores.infoMedica.alergias || undefined,
            tratamientoAdicional: valores.infoMedica.tratamientoAdicional || undefined,
          }
        : { tieneCondicionMedica: false }),
    },
  };
}

/** Fieldset de una persona fundadora (director o administrativo) — reusado 2 veces. */
function SeccionFundador({
  titulo,
  prefix,
  register,
  errors,
  control,
  disabled,
}: {
  titulo: string;
  prefix: 'director' | 'administrativo';
  register: ReturnType<typeof useForm<FormValues>>['register'];
  errors: ReturnType<typeof useForm<FormValues>>['formState']['errors'];
  control: ReturnType<typeof useForm<FormValues>>['control'];
  disabled: boolean;
}) {
  const tieneCondicionMedica = useWatch({
    control,
    name: `${prefix}.infoMedica.tieneCondicionMedica`,
  });

  return (
    <fieldset className="space-y-5 rounded-lg border border-mist bg-bone/50 p-4">
      <legend className="px-1 font-display text-base font-semibold text-slate">
        {titulo}
      </legend>

      <div className="grid gap-5 xl:grid-cols-2">
        <DatosPersonalesFieldset
          register={register}
          errors={errors}
          disabled={disabled}
          prefix={prefix}
          curpOpcional={false}
          telefonoOpcional={false}
        />

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${prefix}-fechaContratacion`} className={LABEL_CLASS}>
                Fecha de contratación
              </label>
              <input
                id={`${prefix}-fechaContratacion`}
                type="date"
                disabled={disabled}
                className={INPUT_CLASS}
                {...register(`${prefix}.fechaContratacion`)}
              />
              <FieldError message={errors[prefix]?.fechaContratacion?.message} />
            </div>
            <div>
              <label htmlFor={`${prefix}-puesto`} className={LABEL_CLASS}>
                Puesto
              </label>
              <Controller
                control={control}
                name={`${prefix}.puesto`}
                render={({ field }) => (
                  <Select
                    id={`${prefix}-puesto`}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    disabled={disabled}
                    placeholder="Selecciona un puesto"
                    options={PUESTO_OPCIONES.map((v) => ({ value: v, label: v }))}
                  />
                )}
              />
              <FieldError message={errors[prefix]?.puesto?.message} />
            </div>
          </div>

          <InfoMedicaFieldset
            control={control}
            register={register}
            errors={errors}
            disabled={disabled}
            prefix={prefix}
            tieneCondicionMedica={Boolean(tieneCondicionMedica)}
          />
        </div>
      </div>

      <ContactosFieldset
        control={control}
        register={register}
        errors={errors}
        disabled={disabled}
        prefix={prefix}
      />
    </fieldset>
  );
}

export default function NuevaSedePage() {
  const router = useRouter();
  const [resultado, setResultado] = useState<CrearSedeConFundadoresResult | null>(null);

  useEffect(() => {
    if (!getPlatformToken()) {
      router.replace('/plataforma/login');
    }
  }, [router]);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: DEFAULT_VALUES,
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      crearSedeConFundadores({
        sede: values.sede,
        director: construirFundador(values.director),
        administrativo: construirFundador(values.administrativo),
      }),
    onSuccess: (data) => {
      setResultado(data);
      if (data.advertenciaAdministrativo) {
        toast.warning(data.advertenciaAdministrativo);
      } else {
        toast.success('Sede y cuentas fundadoras creadas');
      }
    },
    onError: (error) => {
      console.error('[PlataformaNuevaSedePage] Error al crear sede con fundadores:', error);
      toast.error(resolverMensajeError(error, {}) ?? MENSAJE_ERROR_GENERICO);
    },
  });

  if (resultado) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <PlataformaNav activo="sedes" titulo="Sedes" />
        <div className="mt-6 rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
          <h1 className="font-display text-xl font-semibold text-slate">
            {resultado.sede.nombre} — sede creada
          </h1>
          {resultado.advertenciaAdministrativo && (
            <p className="mt-3 rounded-lg border border-gold bg-gold/10 p-3 text-sm text-slate">
              {resultado.advertenciaAdministrativo}
            </p>
          )}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <CredencialesCard titulo="Director" resultado={resultado.director} />
            {resultado.administrativo && (
              <CredencialesCard titulo="Administrativo" resultado={resultado.administrativo} />
            )}
          </div>
          <div className="mt-6">
            <Link
              href="/plataforma/sedes"
              className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
            >
              Volver a sedes
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl p-8">
      <PlataformaNav activo="sedes" titulo="Sedes" />

      <AltaPersonaFormShell
        titulo="Nueva sede"
        descripcion="Crea la sede junto con sus 2 cuentas administrativas fundadoras — un director (SUPER_ADMIN) y un administrativo (ADMIN). Ambas cuentas quedan listas de inmediato, con contraseña temporal."
        onSubmit={handleSubmit((values) => mutation.mutate(values))}
        isPending={mutation.isPending}
      >
        <fieldset className="space-y-4 rounded-lg border border-mist bg-bone/50 p-4">
          <legend className="px-1 font-display text-base font-semibold text-slate">
            Datos de la sede
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="sede-nombre" className={LABEL_CLASS}>
                Nombre
              </label>
              <input
                id="sede-nombre"
                disabled={mutation.isPending}
                className={INPUT_CLASS}
                {...register('sede.nombre')}
              />
              <FieldError message={errors.sede?.nombre?.message} />
            </div>
            <div>
              <label htmlFor="sede-telefono" className={LABEL_CLASS}>
                Teléfono
              </label>
              <input
                id="sede-telefono"
                disabled={mutation.isPending}
                className={INPUT_CLASS}
                {...register('sede.telefono')}
              />
              <FieldError message={errors.sede?.telefono?.message} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="sede-direccion" className={LABEL_CLASS}>
                Dirección
              </label>
              <input
                id="sede-direccion"
                disabled={mutation.isPending}
                className={INPUT_CLASS}
                {...register('sede.direccion')}
              />
              <FieldError message={errors.sede?.direccion?.message} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="sede-ubicacionReferencia" className={LABEL_CLASS}>
                Referencia de ubicación
              </label>
              <input
                id="sede-ubicacionReferencia"
                disabled={mutation.isPending}
                className={INPUT_CLASS}
                {...register('sede.ubicacionReferencia')}
              />
              <FieldError message={errors.sede?.ubicacionReferencia?.message} />
            </div>
          </div>
        </fieldset>

        <SeccionFundador
          titulo="Director (SUPER_ADMIN)"
          prefix="director"
          register={register}
          errors={errors}
          control={control}
          disabled={mutation.isPending}
        />

        <SeccionFundador
          titulo="Administrativo (ADMIN)"
          prefix="administrativo"
          register={register}
          errors={errors}
          control={control}
          disabled={mutation.isPending}
        />
      </AltaPersonaFormShell>
    </main>
  );
}
```

Nota: `CuentaFieldset` (copiado en Task 5, no importado aquí) no se usa en esta página —
este flujo no captura `codigoExterno` por persona (fuera de alcance, no se pidió).
Queda disponible en el kit duplicado por si algún día hace falta.

- [ ] **Step 2: Revisar el shell (`AltaPersonaFormShell`) para confirmar el prop `titulo`/`descripcion`**

Antes de dar el Step 1 por bueno, abre
`App/frontend/src/app/plataforma/sedes/nueva/persona-alta/AltaPersonaFormShell.tsx`
(copiado en Task 5) y confirma que sus props (`titulo`, `descripcion`, `onSubmit`,
`isPending`, `children`) coinciden exactamente con lo usado arriba — es el mismo
componente que ya usa `app/admin/administrativos/nuevo/page.tsx`, así que debería
calzar sin ajuste, pero verifícalo antes de seguir.

- [ ] **Step 3: Build + lint**

Run: `cd App/frontend && pnpm build`
Expected: compila sin errores de tipos (presta atención a los `Path<FormValues>`
genéricos de `register`/`errors` en `SeccionFundador` — si TypeScript se queja de la
unión `'director' | 'administrativo'` contra los tipos genéricos de
`DatosPersonalesFieldset`/`ContactosFieldset`/`InfoMedicaFieldset`, revisa el tipo
`PerfilPrefix` exportado por `DatosPersonalesFieldset.tsx` copiado en Task 5 y ajusta el
tipo de `prefix` en `SeccionFundador` para que coincida exactamente).

Run: `cd App/frontend && pnpm lint`
Expected: limpio.

- [ ] **Step 4: Commit**

```bash
git add App/frontend/src/app/plataforma/sedes/nueva
git commit -m "feat(frontend): página app/plataforma/sedes/nueva con formulario de fundadores

Formulario de 3 secciones (sede, director, administrativo) en una sola
página — 2 altas completas de ADMINISTRATIVO no caben en el modal
existente (regla 13). Pantalla de resultado muestra credenciales de ambas
cuentas y la advertencia si el segundo administrativo falló (best-effort)."
```

---

### Task 7: Frontend — conectar el botón "+ Nueva sede" y recortar `SedeModal` a solo edición

**Files:**
- Modify: `App/frontend/src/app/plataforma/sedes/page.tsx`
- Modify: `App/frontend/src/app/plataforma/sedes/SedeModal.tsx`

**Interfaces:**
- Consumes: nada nuevo — solo re-cablea lo existente.

- [ ] **Step 1: `page.tsx` — el botón navega en vez de abrir el modal en modo alta**

En `App/frontend/src/app/plataforma/sedes/page.tsx`:

1. Cambia el import de `crearSede` — ya no se usa desde aquí:
   ```ts
   import { listarSedes, actualizarSede, eliminarSede, type Sede, type SedeInput } from '@/lib/api/sedes';
   ```
2. Quita `crearMutation` por completo (líneas 61-72).
3. Cambia el tipo de estado del modal — ya no hace falta distinguir alta/edición:
   ```ts
   const [sedeAEditar, setSedeAEditar] = useState<Sede | null>(null);
   ```
   (borra `EstadoModalSede`/`MODAL_CERRADO`, y todo `modalSede`/`setModalSede` de este
   archivo pasa a `sedeAEditar`/`setSedeAEditar` — `null` ahora significa "modal
   cerrado", ya no "modo alta").
4. El botón "+ Nueva sede" navega en vez de abrir el modal:
   ```tsx
   <button
     onClick={() => router.push('/plataforma/sedes/nueva')}
     className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
   >
     + Nueva sede
   </button>
   ```
5. El botón "Editar" de cada fila: `onClick={() => setSedeAEditar(sede)}`.
6. El render condicional del modal, al final del archivo:
   ```tsx
   {sedeAEditar && (
     <SedeModal
       sede={sedeAEditar}
       guardando={actualizarMutation.isPending}
       onEditar={(payload) => {
         actualizarMutation.mutate({ id: sedeAEditar.id, input: payload });
       }}
       onCancelar={() => setSedeAEditar(null)}
     />
   )}
   ```
   Y en `actualizarMutation.onSuccess`, cambia `setModalSede(MODAL_CERRADO)` por
   `setSedeAEditar(null)`. En `eliminarMutation.onSuccess`, cambia el chequeo
   `modalSede.sede?.id === id` / `setModalSede(MODAL_CERRADO)` por
   `sedeAEditar?.id === id` / `setSedeAEditar(null)`.

- [ ] **Step 2: `SedeModal.tsx` — recortar a solo edición**

En `App/frontend/src/app/plataforma/sedes/SedeModal.tsx`:

1. Borra la función `construirPayloadAlta` completa.
2. Borra `sede: Sede | null` de `SedeModalProps` — pasa a `sede: Sede` (siempre hay una
   sede real, el modal ya no tiene modo alta):
   ```ts
   export interface SedeModalProps {
     sede: Sede;
     guardando: boolean;
     onEditar: (payload: Partial<SedeInput>) => void;
     onCancelar: () => void;
   }
   ```
3. Borra `onCrear` de la firma del componente y de `SedeModalProps`.
4. Borra `esAlta` y todo lo condicionado a él:
   - `const [form, setForm] = useState<FormSede>(() => formDesdeSede(sede));`
   - `handleSubmit` pasa a llamar siempre `onEditar(construirPayloadEdicion(form))`.
   - El `<h2>` queda fijo: `Editar sede`.
   - Cada `required={esAlta}` se borra (los 4 `<input>` quedan sin `required` — blanco
     sigue significando "sin cambio", igual que hoy en modo edición).
   - El botón de submit queda fijo: `{guardando ? 'Guardando…' : 'Guardar cambios'}`.
5. Actualiza el comentario del tope del archivo (líneas 7-35) para reflejar que ya es
   solo-edición — la creación vive en `app/plataforma/sedes/nueva/page.tsx` desde
   2026-09-11.

- [ ] **Step 3: Build + lint**

Run: `cd App/frontend && pnpm build`
Expected: compila sin errores.

Run: `cd App/frontend && pnpm lint`
Expected: limpio — presta atención a que `crearSede`/`SedeInput` en `lib/api/sedes.ts`
puedan quedar sin ningún consumidor en el árbol de `app/plataforma/` después de este
task; si `pnpm build` no se queja (son exports, no variables locales, TypeScript no
marca exports sin uso como error), déjalos — siguen siendo parte pública del cliente y
no cuesta nada mantenerlos, no hace falta borrarlos para este cambio.

- [ ] **Step 4: Commit**

```bash
git add App/frontend/src/app/plataforma/sedes/page.tsx App/frontend/src/app/plataforma/sedes/SedeModal.tsx
git commit -m "refactor(frontend): '+ Nueva sede' navega a la página de fundadores

SedeModal se recorta a solo edición (esAlta ya no aplica) - la creación
de sede ahora siempre pasa por app/plataforma/sedes/nueva, que exige las
2 cuentas fundadoras. onCrear/construirPayloadAlta eliminados del modal."
```

---

## Verificación final (después de las 7 tasks)

- [ ] Run: `cd App/backend && pnpm test:e2e` — suite completa en verde.
- [ ] Run: `cd App/backend && pnpm build` — sin errores.
- [ ] Run: `cd App/frontend && pnpm build && pnpm lint` — ambos limpios.
- [ ] Verificación manual en navegador (usuario): `/plataforma/sedes` → "+ Nueva sede" →
  llenar sede + director + administrativo → confirmar credenciales en pantalla → login
  real con el director creado en `/login` (árbol admin) → confirmar que puede dar de
  alta al segundo administrativo si el flujo lo dejó pendiente.
