# Sede — baja lógica (`Sede.activa`) — Diseño

**Fecha:** 2026-09-11
**Origen:** hallazgo Important del review final de rama del plan "Sede con
fundadores obligatorios" (`docs/superpowers/plans/2026-09-11-sede-fundadores-obligatorios.md`).
Decisión del usuario: opción (b) — baja lógica de sede.

## El problema

Desde que `POST /sedes` crea siempre 2 cuentas `ADMINISTRATIVO` fundadoras
(director + administrativo), ninguna sede nueva queda "vacía" nunca.
`DELETE /sedes/:id` (`SedesService.eliminar`) bloquea con `409 CONFLICT` en 2
casos: alumnos activos, o el catch genérico de `P2003` (cualquier FK que
referencie la sede — incluida `Usuario.sedeId`, sin `onDelete`, que ahora
SIEMPRE existe por los 2 fundadores). Dar de baja a los fundadores
(`PATCH /personas/:id/estatus`) no ayuda: `Usuario.activo` no participa en el
chequeo de FK, la fila sigue ahí. Regla 3 de `CLAUDE.md` raíz prohíbe un
`DELETE` real de esa fila. Resultado: **ninguna sede creada por el flujo de
fundadores es borrable por el producto, nunca**, sin tocar la DB a mano.

## Decisión

Agregar `Sede.activa` (boolean, default `true`) y volver `DELETE /sedes/:id`
un fallback automático a baja lógica cuando el borrado real no es posible —
en vez de un endpoint nuevo o un botón nuevo. El mismo botón "Eliminar" que
ya existe en `app/plataforma/sedes/page.tsx` sigue siendo el único punto de
entrada.

### Comportamiento nuevo de `DELETE /sedes/:id`

1. Intenta el `DELETE` real de siempre (mismos 2 chequeos: `alumnosActivos`
   count, luego el `tx.sede.delete` con catch de `P2003`).
2. Si el `DELETE` real habría bloqueado por CUALQUIERA de los 2 motivos
   (alumnos activos O cualquier dato asociado vía `P2003`) → en vez de
   lanzar `409 CONFLICT`, hace `UPDATE sedes SET activa = false` y responde
   éxito igual. Nada se borra — es exactamente la baja lógica que el resto
   del sistema ya usa para personas (regla 3), aplicada a `Sede`.
3. Si la sede genuinamente no tiene ningún dato asociado (caso raro hoy —
   una sede recién creada por el flujo VIEJO ya no existe, pero una sede de
   pruebas limpiada a mano sigue siendo posible) → `DELETE` real, igual que
   hoy.
4. Éxito siempre `200 { data: { ok: true, eliminacionReal: boolean } }` —
   el flag nuevo le dice al frontend cuál de los 2 caminos ocurrió, para
   variar el mensaje de éxito (nunca hay un tercer estado de error para
   "sede con datos asociados" — ese 409 deja de existir).
5. `RegistroAuditoria`: `ELIMINACION` si fue borrado real (sin cambios);
   `CAMBIO_ESTATUS` si fue baja lógica (mismo valor de enum que ya usa
   `PATCH /personas/:id/estatus` para el mismo concepto — un cambio de
   estatus, no una edición de campos ni una eliminación real).
6. La compensación de `SedesService.crearConFundadores` (borra la sede si
   el alta del director falla) sigue llamando a `eliminar` tal cual — en
   ese punto la sede tiene 0 dependientes reales (el alta del director
   falló completo, su propia transacción hizo rollback), así que siempre
   toma la rama de `DELETE` real. Sin cambios ahí.

### Reactivación

`PATCH /sedes/:id` (ya existente) gana un campo opcional más: `activa?:
boolean`. Permite reactivar una sede dada de baja lógica (o desactivarla a
mano sin pasar por `DELETE`, aunque el flujo esperado es siempre vía el
botón "Eliminar"). `hayCambiosReales` se extiende para contemplarlo. Auditar
como `EDICION` si cambia (mismo criterio que el resto de campos de `PATCH
/sedes/:id` — no es un `CAMBIO_ESTATUS` porque viene de una edición
explícita, no del flujo de "eliminar", mismo criterio de distinción que ya
existe entre `PATCH /auth/cambiar-password` (`EDICION`) y `PATCH
/personas/:id/estatus` (`CAMBIO_ESTATUS`): la acción semántica del endpoint
manda, no el campo tocado).

### `GET /sedes`

Sin cambios de contrato — ya devuelve el objeto `Sede` completo, `activa`
sale gratis. El frontend decide cómo mostrarlo (badge).

### Fuera de alcance (YAGNI, sin pedido explícito)

- `Sede.activa` NO bloquea ninguna operación de negocio (alta de personas,
  grupos, carreras, login) dentro de esa sede — es un flag informativo /
  de gestión de plataforma, no un candado operativo. Si CESP algún día pide
  "una sede inactiva no deja hacer nada dentro", es un cambio aparte
  (tocaría `SedeGuard` u otro punto central).
- Sin filtro automático en `GET /sedes` (sigue devolviendo todas, activas e
  inactivas) — el catálogo es chico, la UI distingue con un badge, no hace
  falta paginar/filtrar server-side.
- Sin endpoint dedicado tipo `PATCH /sedes/:id/estatus` — se reusa el
  `PATCH /sedes/:id` genérico ya existente, mismo criterio que otros campos
  opcionales de ese mismo endpoint.

## Migración

`ALTER TABLE sedes ADD COLUMN activa boolean NOT NULL DEFAULT true` — todas
las sedes existentes quedan `true` automáticamente por el default, sin
backfill manual necesario (a diferencia de `tipoSangre`/`tipoLicencia`, acá
no hay ambigüedad de negocio: una sede que ya existe está, por definición,
activa hoy).

## Testing

- `DELETE /sedes/:id` — sede genuinamente vacía → sigue devolviendo
  `eliminacionReal: true`, sede realmente borrada de la DB (test existente,
  ajustar el shape de la respuesta esperada).
- `DELETE /sedes/:id` — sede con fundadores (el caso real y común desde
  2026-09-11) → `200 { data: { ok: true, eliminacionReal: false } }`,
  `prisma.sede.findUnique` sigue encontrando la fila con `activa: false`,
  los `Usuario` de los fundadores siguen existiendo intactos (regla 3).
- `DELETE /sedes/:id` — sede con alumnos activos → mismo camino de baja
  lógica que el caso anterior (ya no hay un 409 distinto para este caso).
- `PATCH /sedes/:id` con `{ activa: true }` sobre una sede dada de baja
  lógica → reactiva, audita `EDICION`.
- Los 2 tests existentes que hoy esperan `409 CONFLICT` en `DELETE
  /sedes/:id` (alumnos activos, datos asociados) deben reescribirse — ya no
  aplican, el endpoint ya no falla en esos casos.
