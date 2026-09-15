# Plan — Fase 15: cerrar los 4 hallazgos Important pendientes

Cierre de los 4 pendientes reales documentados al final de la Fase 15
(Calendario) en `documentacion_de_agentes/ESTADO.md`, sección "Pendientes
reales, documentados, NO corregidos en esta fase". Se hace ANTES de empezar
la Fase 16 (Avisos) porque 3 de los 4 tocan `src/common/publicacion/` o el
contrato de `OcurrenciaEvento`, que Avisos va a reusar tal cual.

Spec de referencia:
`docs/superpowers/specs/2026-08-31-calendario-avisos-notificaciones-design.md`
(sección "FASE 15"). Plan original:
`docs/superpowers/plans/2026-09-01-fase15-calendario.md`.

## Global Constraints

- **Rama:** se trabaja directo sobre `dev` (convención del proyecto para
  todas las fases vía SDD — no es `main`). Working tree limpio al empezar.
- **Contrato de API** (CLAUDE.md, sección "Contrato de API"): JSON camelCase,
  fechas ISO 8601, éxito `{ data: ... }`, error `{ error, code }`. No
  inventar códigos de error nuevos en este plan — ninguno de los 4 fixes lo
  necesita.
- **Regla 1** (nunca persistir lo calculable): `puedeEditar` de la Tarea 3 se
  deriva al vuelo por request, NUNCA se persiste ni se agrega columna.
- **Regla 12** (todo catch loguea antes de responder): cualquier catch nuevo
  en el batching de la Tarea 2 hace `console.error` (o logger equivalente)
  con el error completo antes de seguir.
- **Regla 2** (doble capa RLS + Guard) y **Regla 11** (separación total
  admin/alumno en frontend) siguen vigentes — ningún fix las toca, pero no
  romperlas.
- **`prisma migrate dev` está roto** en este repo (`P3006` shadow-DB). Ningún
  fix de este plan necesita migración — si alguno la necesitara, es señal de
  que el fix se desvió del alcance.
- **Tests:** cada tarea deja `pnpm test:e2e` del módulo tocado en verde y no
  rompe la suite e2e completa (24 suites / 334 tests hoy). `tsc` + `eslint` +
  `pnpm build` limpios en el/los árbol(es) tocado(s).
- **Verificación contra DB real:** máximo 3 escrituras manuales antes de un
  veredicto (regla 14) — la suite Jest no cuenta, ya limpia sola.
- Sin nuevas dependencias (regla global del usuario) — el batching de la
  Tarea 2 se hace con `Promise.all` sobre lotes hechos a mano, no con una
  librería de pool.

## Task 1 — Cobertura de test de `resolverDestinatarios` (ramas CARRERA y GRUPO)

**Dominio:** backend (`backend-coder`). Solo tests, cero código de producción.

**Problema (hallazgo 2):** `resolverDestinatarios`
(`App/backend/src/common/publicacion/alcance-publicacion.util.ts`) solo tiene
sus ramas `SEDE` ejercitadas por test. Las ramas `CARRERA` y `GRUPO` —las más
complejas, `CARRERA` resuelve maestros vía asignación de grupo— tienen CERO
cobertura. Avisos (Fase 16) va a importar este helper tal cual, así que es el
hueco de cobertura de mayor valor de la fase.

**Qué hacer:**
1. Leer `alcance-publicacion.util.ts` completo y entender exactamente qué
   consulta cada rama (`SEDE` / `CARRERA` / `GRUPO`) de `resolverDestinatarios`
   y qué devuelve (lista de `usuarioId` destinatarios).
2. Localizar cómo se ejercita hoy `SEDE` (buscar en `App/backend/test/` y en
   specs unit — `grep -rn "resolverDestinatarios" App/backend`). Seguir EXACTO
   ese patrón (mismo tipo de test —unit con Prisma mockeado, o e2e con
   fixtures reales— que ya usa la rama `SEDE`; no introducir un estilo nuevo).
3. Agregar casos que cubran:
   - **`CARRERA`**: destinatarios = alumnos de esa carrera + maestros
     asignados a algún grupo de esa carrera (vía `GrupoMateriaMaestro` →
     `Grupo.carreraId`). Verificar que un maestro asignado a un grupo de OTRA
     carrera NO aparece, y que no hay duplicados si un maestro da varias
     materias de la misma carrera.
   - **`GRUPO`**: destinatarios = alumnos matriculados en ese grupo
     (`GrupoAlumno`) + maestros asignados a ese grupo (`GrupoMateriaMaestro`).
     Verificar aislamiento: alguien de otro grupo no aparece.
   - Caso vacío de cada rama (carrera/grupo sin nadie) → lista vacía, sin
     lanzar.
4. Si el patrón existente es e2e con fixtures: crear/limpiar los fixtures en
   `afterAll` acotado a los `id` creados (regla 14 — NUNCA limpieza por
   patrón de nombre/email, eso ya causó un bug en el Día 24).

**Alcance explícito:** NO refactorizar `alcance-publicacion.util.ts`. NO
tocar `validarAlcancePublicacion` (ya tiene cobertura). Solo sumar tests.

**Verificación:** el spec nuevo/ampliado en verde + suite e2e completa del
backend sigue 24 suites / 334+ tests en verde (el total de tests sube, ningún
suite baja) + `tsc`/`eslint` limpios.

## Task 2 — Batching con concurrencia acotada en el correo del job de recordatorios

**Dominio:** backend (`backend-coder`).

**Problema (hallazgo 1):** en
`CalendarioService.generarRecordatoriosPendientes`
(`App/backend/src/calendario/calendario.service.ts`), tras crear las
`Notificacion` + `RecordatorioEnviado`, el envío de correo
(`MailService.enviarNotificacion`) se hace en un loop secuencial sin límite de
concurrencia dentro del mismo request. Un evento de alcance `SEDE` con un
conteo real de usuarios no sobreviviría el timeout del load balancer de Render
y se perderían la mayoría de los correos sin reintento. Las `Notificacion` /
`RecordatorioEnviado` YA quedan bien (van en su transacción) — el correo es lo
único afectado y es best-effort por diseño.

**Qué hacer:**
1. Leer `generarRecordatoriosPendientes` completo. Identificar el punto donde
   hoy se recorren los destinatarios mandando correo uno por uno.
2. Reemplazar ese loop secuencial por procesamiento en lotes de tamaño fijo
   (constante nombrada, p. ej. `LOTE_CORREOS_RECORDATORIO = 20` — elegir un
   valor razonable y comentarlo), con `Promise.allSettled` por lote para que
   un correo que falla no tumbe el lote ni el job.
3. Cada rechazo de `Promise.allSettled` se loguea con `console.error` (regla
   12) incluyendo a qué `usuarioId` / notificación correspondía y el error
   completo. El job sigue con el siguiente lote.
4. El valor de retorno del método (`{ ocurrenciasProcesadas,
   notificacionesCreadas }`) NO cambia — el contrato de
   `POST /internal/recordatorios/ejecutar` queda idéntico.
5. `RECORDATORIOS_HABILITADO` apagado sigue siendo no-op total (no tocar esa
   guarda temprana).

**Alcance explícito:** NO agregar reintentos con backoff, NO agregar una cola
persistente, NO nueva dependencia (nada de `p-limit`/`p-queue` — lotes a mano
con `slice` + `Promise.allSettled`). NO cambiar la transacción de
`Notificacion`/`RecordatorioEnviado`. Solo el fan-out del correo.

**Verificación:** `internal-recordatorios.e2e-spec.ts` sigue en verde (6/6 o
más). Agregar al menos un caso que confirme que con varios destinatarios y un
`MailService` que rechaza para uno de ellos, (a) el job igual devuelve el
conteo correcto, (b) los demás correos se intentan, (c) se logueó el error.
Suite e2e completa en verde + `tsc`/`eslint` limpios.

## Task 3 — `puedeEditar: boolean` en `OcurrenciaEvento` (`GET /eventos`)

**Dominio:** backend (`backend-coder`). Depende de nada; la Tarea 4 depende de
esta.

**Problema (hallazgo 4, backend):** `GET /eventos` devuelve `OcurrenciaEvento`
sin ninguna señal de si el actor puede editar/borrar ese evento. Hoy el
frontend de maestro muestra "Editar"/"Eliminar" en CUALQUIER evento visible
(la mayoría son eventos `SEDE` creados por un admin), y al intentarlo el
maestro recibe un toast genérico equivocado. `PATCH`/`DELETE /eventos/:id` ya
aplican la regla correcta server-side (`obtenerPropioODeSede` /
"solo el autor o un `ADMINISTRATIVO` de la sede") — falta exponerla en el GET.

**Qué hacer:**
1. Leer en `calendario.service.ts` el método que sirve `GET /eventos` y el
   helper que hoy usan `PATCH`/`DELETE` para decidir permiso (el que la nota
   de ESTADO llama `obtenerPropioODeSede` — confirmar nombre real).
2. Agregar `puedeEditar: boolean` a cada `OcurrenciaEvento` devuelta por
   `GET /eventos`, calculado al vuelo (regla 1 — no persistir) con EXACTAMENTE
   la misma regla que aplica `PATCH`/`DELETE`:
   - `true` si el actor es el autor del evento (`autorUsuarioId === actor`), o
   - `true` si el actor es `ADMINISTRATIVO` de la sede del evento, o
   - `false` en cualquier otro caso (incluye alumno siempre → `false`, y
     maestro sobre evento que no creó).
   Reusar el helper existente, no reimplementar la condición.
3. Añadir el campo al tipo/interface de la respuesta en el backend (DTO o
   type de `OcurrenciaEvento` si existe uno explícito en el service).
4. NO tocar el frontend en esta tarea (es la Tarea 4). NO agregar
   `autorUsuarioId` crudo a la respuesta — solo el booleano derivado (evita
   filtrar identidad y evita que el frontend reimplemente la regla).

**Alcance explícito:** solo `GET /eventos`. No hay `GET /eventos/:id` y no se
crea aquí. `POST`/`PATCH`/`DELETE` no cambian su respuesta.

**Verificación:** ampliar `calendario.e2e-spec.ts` con casos que afirmen
`puedeEditar`:
- admin ve `true` en todo evento de su sede;
- maestro ve `true` SOLO en eventos que él creó, `false` en eventos `SEDE` de
  un admin y en eventos de otro maestro;
- alumno ve `false` siempre.
Suite e2e completa en verde + `tsc`/`eslint` limpios.

## Task 4 — Frontend: consumir `puedeEditar` + tipar `ActualizarEventoInput` con `null`

**Dominio:** frontend (`alumno-coder` — cubre alumno y maestro). Esta tarea
también toca `app/admin/calendario/EventoModal.tsx` y el cliente compartido
`lib/api/calendario.ts`; ver nota de alcance abajo. Depende de la Tarea 3
(campo `puedeEditar` ya en la respuesta del backend).

**Problema A (hallazgo 4, frontend):** el calendario de maestro
(`app/maestro/calendario/`) ofrece "Editar"/"Eliminar" en eventos que el
maestro no puede tocar.

**Problema B (hallazgo 3):** `ActualizarEventoInput` en
`lib/api/calendario.ts` es `Partial<CrearEventoInput>`, que no puede expresar
`null`. Por eso hay un cast `as string | undefined` repetido ~8 veces entre
`app/admin/calendario/EventoModal.tsx` y `app/maestro/calendario/EventoModal.tsx`
al armar el payload de PATCH (para poder mandar `null` y limpiar un campo).

**Qué hacer:**
1. **`lib/api/calendario.ts`** (cliente compartido por los 3 árboles, mismo
   criterio que `lib/api/grupos.ts`):
   - Agregar `puedeEditar: boolean` a la interface `OcurrenciaEvento` (espejo
     del backend de la Tarea 3).
   - Cambiar `export type ActualizarEventoInput = Partial<CrearEventoInput>;`
     por `export type ActualizarEventoInput = { [K in keyof CrearEventoInput]?: CrearEventoInput[K] | null };`
     (permite `null` explícito para limpiar campos opcionales).
2. **`app/maestro/calendario/`**: usar `ocurrencia.puedeEditar` para decidir
   si se renderizan los botones/acciones "Editar" y "Eliminar" (y/o el acceso
   al `EventoModal` en modo edición y al `ConfirmarEliminarEventoModal`). Si
   `puedeEditar === false`, esas acciones no se muestran para esa ocurrencia.
   Buscar el componente de lista/celda de evento en ese árbol y aplicarlo ahí.
3. **`app/maestro/calendario/EventoModal.tsx` y
   `app/admin/calendario/EventoModal.tsx`**: eliminar los casts
   `as string | undefined` que ahora son innecesarios porque
   `ActualizarEventoInput` ya admite `null`. Confirmar que `tsc` pasa sin
   ellos en ambos árboles.
4. **admin y alumno**: NO cambian su comportamiento de botones. Admin ya
   tiene permiso sobre todo evento de su sede (`puedeEditar` será `true` en su
   caso normal — se puede usar el flag también en admin para blindar, pero no
   es obligatorio y no debe alterar la UX actual). Alumno es solo lectura, no
   toca botones de edición.

**Nota de alcance (regla 11):** la separación total admin/alumno prohíbe
COMPONENTES compartidos entre árboles, no que una misma tarea toque archivos
de ambos. El cambio de tipo en `lib/api/calendario.ts` (infra compartida, ya
lo era) obliga a ajustar los dos `EventoModal.tsx` en el mismo commit para no
dejar `tsc` roto — es un cambio de tipo repo-wide, no un componente
compartido nuevo. Está autorizado explícitamente en este plan.

**Alcance explícito:** NO rediseñar el calendario de maestro. NO tocar el
árbol de alumno más allá de verificar que compila. NO cambiar
`DetalleEventoModal.tsx` de alumno. El cambio de botones es solo
mostrar/ocultar según `puedeEditar`.

**Verificación:** `pnpm build` + `tsc` + `eslint` limpios en los 3 árboles de
frontend (o al menos admin + maestro + alumno afectados). Verificación manual
la hará el usuario después (parte de la verificación manual pendiente de toda
la Fase 15).

## Fuera de alcance de este plan

- Verificación manual en navegador de la Fase 15 (la hace el usuario después).
- Push a `origin/dev` (lo autoriza el usuario después).
- Fase 16 (Avisos).
- `GET /eventos/:id` (no se pide, no se crea).
- Reintentos/cola persistente para el correo del job.
