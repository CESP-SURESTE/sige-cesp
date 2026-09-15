# Fase 17 (parcial) — unificar `obtenerCorreosPersonales` (diseño)

**Fecha:** 2026-09-10
**Estado:** aprobado, pendiente de plan de implementación
**Fase:** 17 (limpieza post-features). Solo la parte de deduplicación de helpers — el
`code-review ultra` global de la Fase 17 lo dispara el usuario, queda fuera.

## Objetivo

`CalendarioService` tiene una copia `private` de `obtenerCorreosPersonales`
(`calendario.service.ts:1076`) que es **idéntica** al util compartido
`src/common/publicacion/correos-destinatarios.util.ts`, el cual `AvisosService` ya
consume (`avisos.service.ts:13,193`). El propio CLAUDE.md y el docstring del util dicen
"se unifica en Fase 17". Es hora.

## Cambio (mínimo, un solo archivo de producción)

En `src/calendario/calendario.service.ts`:

1. Agregar el import:
   `import { obtenerCorreosPersonales } from '../common/publicacion/correos-destinatarios.util';`
   (ruta relativa igual que en `avisos.service.ts`).
2. Único call site — `:1032`:
   `await this.obtenerCorreosPersonales(destinatarios)` →
   `await obtenerCorreosPersonales(this.prisma, destinatarios)`.
3. Borrar el método `private async obtenerCorreosPersonales(...)` completo
   (aprox. `:1069`–`:1096`, incluyendo su docstring).

El util es funcionalmente idéntico: mismas 3 queries `Promise.all` sobre
`perfilAlumno`/`perfilMaestro`/`perfilAdministrativo`, mismo shape de retorno
(`{ usuarioId, correoPersonal }[]`), misma omisión silenciosa de usuarios sin perfil.
Única diferencia real: el util hace `if (usuarioIds.length === 0) return [];` al inicio —
el call site de calendario ya está guardado por `if (destinatarios.length > 0)`, así que
no cambia el comportamiento.

Opcional (limpieza de doc): actualizar el docstring del util quitando la frase "se deja
sin tocar por estabilidad; Fase 17 la unifica contra esta función" ya que deja de
aplicar.

## Verificación

- `nest build` limpio.
- Suite e2e completa del backend en verde — en particular
  `test/calendario-recordatorios.e2e-spec.ts` (o el que ejercite el job de recordatorios)
  y `test/avisos.e2e-spec.ts`. Sin cambios de contrato, no debería moverse ningún test.
- `qa-backend`.

## Archivos tocados

- `src/calendario/calendario.service.ts` (import + 1 línea + borrar método privado)
- `src/common/publicacion/correos-destinatarios.util.ts` (opcional — 1 frase de docstring)

## Fuera de alcance

- `resolverDestinatarios` / `validarAlcancePublicacion` en `src/common/publicacion/` — ya
  están compartidos, no se tocan.
- El `code-review ultra` global de Fase 17.
- Cualquier cambio de comportamiento del job de recordatorios o del fan-out de avisos.
