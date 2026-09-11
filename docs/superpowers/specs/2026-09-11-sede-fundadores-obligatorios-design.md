# Alta de sede con 2 cuentas fundadoras obligatorias (Director + Administrativo)

**Fecha:** 2026-09-11
**Meta:** al dar de alta una sede nueva desde `/plataforma`, el mismo flujo crea
obligatoriamente 2 cuentas `ADMINISTRATIVO` reales para esa sede: un "director"
(`nivelPermiso: SUPER_ADMIN`) y un administrativo (`nivelPermiso: ADMIN`).

## Contexto

El usuario recordaba este requisito como parte del alcance original, pero no está
documentado en `docs/roadmap.md`, en el spec de Día 20
(`2026-08-14-crud-sedes-admin-plataforma-design.md`) ni en `docs/modelo-datos.md`. Se
buscó también en el historial de git sin encontrarlo. Lo más cercano que existe en el
código es el modelo `SedeResponsable` (`sede_id`, `administrativo_id`, `es_principal`) —
vive en `schema.prisma` desde el Día 2 pero **nunca se conectó a ningún endpoint**; solo
vincula un administrativo *ya existente*, no crea cuentas. Este spec formaliza el
requisito confirmado en conversación directa con el usuario (2026-09-11): `POST /sedes`
debe crear cuentas nuevas, no solo permitir vincular una existente. `SedeResponsable`
queda fuera de alcance de este cambio (gap pendiente, no se resuelve aquí).

## Decisión central: qué tan "atómico" es "todo o nada"

Alta de persona en este sistema son 2 sistemas sin transacción distribuida real
(Supabase Auth + Postgres, ver `PersonasService.altaPersona` — si Postgres falla
después de que Auth ya creó el usuario, se compensa borrando el usuario de Auth,
best-effort). Además, la **regla 3 de `CLAUDE.md` raíz es no negociable: nunca `DELETE`
real de una persona, solo baja lógica**.

Confirmado con el usuario: "todo o nada" se cumple **estrictamente para Sede + Director**
(si el director falla, la sede recién creada no tiene ningún dependiente todavía, así
que borrarla es limpio — mismo camino que ya usa `DELETE /sedes/:id`). El **segundo
administrativo (ADMIN) es best-effort** en la misma request — si falla, la sede y el
director ya quedaron creados de verdad (regla 3 lo impide deshacer), y el director
recién creado puede iniciar sesión y dar de alta al segundo administrativo por el
camino normal (`POST /personas` — ya funciona porque el director ya es un
`ADMINISTRATIVO` real de esa sede). No se construye un endpoint de "reintentar".

## Backend

### `PersonasService` — refactor sin tocar el comportamiento de `POST /personas`

- Se extrae el cuerpo de `altaPersona` desde "generación del login" (línea ~733 hoy)
  hasta el final (Auth, `$transaction`, compensación, correo de bienvenida) a un método
  privado nuevo `ejecutarAltaPersona(dto: CrearPersonaDto, sedeId: string)`, **verbatim**,
  sin cambios de lógica ni de contrato.
- `altaPersona(dto, sedeId, actorUsuarioId)` (pública, la usa `POST /personas`) queda
  igual desde afuera: corre sus pre-checks + `verificarJerarquiaNivelPermiso` si
  `rol === ADMINISTRATIVO`, y al final delega a `ejecutarAltaPersona`.
- Método nuevo, **sin controller/ruta propia** — solo lo llama `SedesService`:
  ```ts
  async altaAdministrativoFundador(
    dto: CrearPersonaDto, // rol siempre ADMINISTRATIVO
    sedeId: string,
  ): Promise<AltaPersonaResult>
  ```
  Corre los mismos pre-checks defensivos que ya aplican a ADMINISTRATIVO (código
  externo duplicado, `perfilAdministrativo` presente), pero **sin**
  `verificarJerarquiaNivelPermiso` — no hay jerarquía previa que consultar (0
  administrativos en la sede todavía); el actor es `AdminPlataforma`, por diseño ya por
  encima de esa jerarquía (mismo criterio del spec de Día 20: "ni siquiera
  `nivelPermiso: SUPER_ADMIN` encaja como actor de `POST /sedes`"). Llama a
  `ejecutarAltaPersona` igual que el camino normal — mismas reglas completas de
  contactos (1-3) + info médica (`tipoSangre` obligatorio).
- `nivelPermiso` del director y del administrativo **se fuerza server-side**
  (`SUPER_ADMIN` / `ADMIN` respectivamente) — el cliente no lo manda, mismo criterio de
  regla 1 ("nunca confiar en el cliente para un campo de autoridad"); si el DTO trae
  `perfilAdministrativo.nivelPermiso`, se ignora y se sobreescribe.

### `SedesService` — `crear` pasa a `crearConFundadores`

```ts
async crearConFundadores(
  dtoSede: CrearSedeDto,
  dtoDirector: CrearPersonaDto,      // sin nivelPermiso — se fuerza SUPER_ADMIN
  dtoAdministrativo: CrearPersonaDto, // sin nivelPermiso — se fuerza ADMIN
  actorPlataformaId: string,
): Promise<{
  sede: Sede;
  director: AltaPersonaResult;
  administrativo: AltaPersonaResult | null;
  advertenciaAdministrativo?: string;
}>
```

1. Crea la `Sede` — código actual sin cambios (transacción propia + `RegistroAuditoria`
   `ALTA`, `adminPlataformaId` del actor).
2. `altaAdministrativoFundador(dtoDirector, sede.id)`. Si lanza: borra la sede
   recién creada (0 dependientes todavía — mismo camino que `SedesService.eliminar`,
   reutilizado directo) y **relanza el error original** (`VALIDATION_ERROR`,
   `CONFLICT`, `SERVER_ERROR` según lo que haya fallado) — la respuesta de
   `POST /sedes` es un fallo limpio, nada quedó creado.
3. `altaAdministrativoFundador(dtoAdministrativo, sede.id)`. Si lanza: **no** se
   deshace nada (regla 3) — se loguea (regla 12) y la respuesta es `201` con
   `administrativo: null` + `advertenciaAdministrativo` describiendo el problema.
4. Éxito total: `201` con los 3 campos poblados.

Sin migraciones nuevas — `Sede`, `Usuario`, `PerfilAdministrativo` ya existen tal cual.
`SedeResponsable` no se toca (fuera de alcance, ver "Contexto").

### `POST /sedes` — contrato actualizado

Mismo guard (`PlatformAdminGuard`), mismo endpoint. Body gana 2 campos nuevos
obligatorios: `director` y `administrativo`, cada uno con el shape de
`perfilAdministrativo` de `CrearPersonaDto` (nombres, apellidos, curp, correoPersonal,
teléfono, fechaContratacion, puesto, contactos 1-3, infoMedica con `tipoSangre`) — sin
`nivelPermiso` (forzado server-side, ver arriba). Éxito `201 { data: { sede, director,
administrativo, advertenciaAdministrativo? } }`. Nuevos códigos de error: ninguno —
reutiliza `VALIDATION_ERROR`/`CONFLICT`/`SERVER_ERROR` ya existentes (mismos que
`POST /personas`).

## Frontend (`app/plataforma/`)

El modal actual de "Nueva sede" (regla 13, unificado 2026-08-25) no alcanza para 2
altas completas de administrativo — mismo problema que ya resolvió
`app/admin/administrativos/nuevo/` saliéndose del patrón modal (excepción ya
precedentada en regla 13 de `CLAUDE.md`).

- **Editar sede** sigue en el modal actual (`SedeModal.tsx`), sin cambios — edición
  nunca toca director/administrativo.
- **Nueva sede** se saca del modal a una página dedicada
  `app/plataforma/sedes/nueva/page.tsx` — un solo formulario con 3 secciones (datos de
  sede, datos del director, datos del administrativo) y un solo submit. Botón
  "+ Nueva sede" en `app/plataforma/sedes/page.tsx` navega ahí en vez de abrir el modal.
- Los sub-formularios de "datos de persona" (contactos dinámicos 1-3 + info médica con
  selector de `tipoSangre`) se **duplican** dentro de `app/plataforma/` — regla 11
  prohíbe importar de `app/admin/`; mismo criterio ya usado para `Skeleton.tsx` /
  `PlataformaNav.tsx` en este árbol. Se extrae un componente local
  `app/plataforma/sedes/nueva/FormularioAdministrativo.tsx` reusado 2 veces (director +
  administrativo) **dentro del mismo árbol** — sin duplicar ese sub-formulario una
  tercera vez dentro de la misma página.
- Pantalla de resultado: si `administrativo: null`, mostrar la advertencia de forma
  visible (no un toast que desaparece) — el usuario plataforma necesita saber que debe
  decirle al director que complete esa alta.
- `lib/api/sedes.ts` gana el nuevo shape de request/response de `crearConFundadores`.

## Testing

- Backend: e2e de `POST /sedes` — caso feliz (3 cuentas), falla el director (sede se
  borra, nada queda), falla el administrativo (sede+director quedan,
  `advertenciaAdministrativo` presente), `nivelPermiso` enviado por el cliente se
  ignora/sobreescribe, `verificarJerarquiaNivelPermiso` NO se invoca en este camino
  (verificable indirectamente: funciona con 0 administrativos previos en la sede).
  Regresión completa de `personas.e2e-spec.ts` sigue en verde (refactor no debe romper
  nada del camino existente).
- Frontend: smoke manual (mismo criterio que el resto de `app/plataforma/` — sin suite
  de tests de frontend instalada).

## Fuera de alcance de este cambio

- `SedeResponsable` — sigue sin usarse, no se resuelve aquí (gap documentado, no
  bloquea esto).
- Retrofit de las 3 sedes ya existentes en dev sin estas 2 cuentas — se decide aparte,
  no lo fuerza este spec.
- Endpoint de "reintentar alta del administrativo fundador" — el fallback es que el
  director ya creado use `POST /personas` normal.
