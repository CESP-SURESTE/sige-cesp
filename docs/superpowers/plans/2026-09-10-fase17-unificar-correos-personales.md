# Fase 17 (parcial) — unificar `obtenerCorreosPersonales` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar la copia `private` de `obtenerCorreosPersonales` en `CalendarioService` haciéndola usar el util compartido `src/common/publicacion/correos-destinatarios.util.ts` que `AvisosService` ya consume.

**Architecture:** Refactor puro, sin cambio de comportamiento ni de contrato. Un solo archivo de producción tocado (`calendario.service.ts`): un import nuevo, un call site ajustado, un método privado borrado.

**Tech Stack:** NestJS + Prisma. Gate: `nest build` + suite e2e completa del backend en verde + `qa-backend`.

## Global Constraints

- **Sin cambio de comportamiento** — el util es funcionalmente idéntico al método privado (mismas 3 queries `Promise.all` sobre `perfilAlumno`/`perfilMaestro`/`perfilAdministrativo`, mismo retorno `{ usuarioId, correoPersonal }[]`, misma omisión silenciosa de usuarios sin perfil). Única diferencia: el util hace `if (usuarioIds.length === 0) return [];` al inicio — inocuo, el call site de calendario ya está guardado por `if (destinatarios.length > 0)`.
- **Sin cambio de contrato de API** — ningún test de e2e debería moverse.
- **Regla 12** — no se toca ningún `console.error`/`console.log` existente del job de recordatorios.

---

## Task 1: `CalendarioService` usa el util compartido

**Files:**
- Modify: `App/backend/src/calendario/calendario.service.ts`
- Modify (opcional, 1 frase de docstring): `App/backend/src/common/publicacion/correos-destinatarios.util.ts`

**Interfaces:**
- Consumes: `obtenerCorreosPersonales(prisma: PrismaService, usuarioIds: string[]): Promise<{ usuarioId: string; correoPersonal: string }[]>` de `../common/publicacion/correos-destinatarios.util` (misma firma que ya usa `avisos.service.ts:193`).
- Produces: nada — comportamiento interno idéntico.

---

- [ ] **Step 1: Correr la suite e2e relevante ANTES del cambio (baseline verde)**

Run: `cd App/backend && npx jest --config test/jest-e2e.json calendario avisos`
Expected: todo verde. Anotar la cifra de tests como baseline.

- [ ] **Step 2: Agregar el import y ajustar el call site**

En `App/backend/src/calendario/calendario.service.ts`:

1. Agregar (junto a los otros imports relativos, mismo estilo que `avisos.service.ts`):
   ```ts
   import { obtenerCorreosPersonales } from '../common/publicacion/correos-destinatarios.util';
   ```
2. En el único call site (dentro de `generarRecordatoriosPendientes`, actualmente
   `const correos = await this.obtenerCorreosPersonales(destinatarios);`), cambiar a:
   ```ts
   const correos = await obtenerCorreosPersonales(this.prisma, destinatarios);
   ```

- [ ] **Step 3: Borrar el método privado**

Eliminar de `calendario.service.ts` el método completo:
```ts
  /**
   * Resuelve `correoPersonal` para una lista de `Usuario.id` ...
   */
  private async obtenerCorreosPersonales(
    usuarioIds: string[],
  ): Promise<{ usuarioId: string; correoPersonal: string }[]> {
    const [alumnos, maestros, administrativos] = await Promise.all([ ... ]);
    return [...alumnos, ...maestros, ...administrativos];
  }
```
(incluyendo su bloque de docstring inmediatamente anterior).

- [ ] **Step 4: (Opcional) limpiar el docstring del util**

En `App/backend/src/common/publicacion/correos-destinatarios.util.ts`, quitar de su
docstring la frase que dejó de aplicar:
> `CalendarioService.obtenerCorreosPersonales` es una copia private idéntica — se deja sin tocar por estabilidad; Fase 17 la unifica contra esta función.
Reemplazar por algo como: "Usado por `AvisosService` y `CalendarioService` (fan-out de correo best-effort)."

- [ ] **Step 5: Build**

Run: `cd App/backend && npx tsc --noEmit -p tsconfig.json`
Expected: limpio. Si `tsc` marca `obtenerCorreosPersonales` como no encontrado, es que quedó otro call site — grep `grep -n "obtenerCorreosPersonales" App/backend/src/calendario/calendario.service.ts` (debe quedar solo la línea del `import` y la del call site nuevo).

- [ ] **Step 6: Correr la suite e2e completa (sin regresiones)**

Run: `cd App/backend && npx jest --config test/jest-e2e.json`
Expected: mismo conteo verde que el baseline general del repo (referencia reciente: 419 tests / 27 suites), en particular `calendario`/`avisos` sin cambios.

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/sebas/OneDrive/Desktop/Proyectos/sige-cesp"
git add App/backend/src/calendario/calendario.service.ts App/backend/src/common/publicacion/correos-destinatarios.util.ts
git commit -m "refactor(backend): CalendarioService usa el util compartido obtenerCorreosPersonales (Fase 17)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X7R2h7GTKWnYfDo541JgqH"
```

---

## Verificación final

1. `cd App/backend && npx jest --config test/jest-e2e.json` — verde, sin regresiones.
2. `qa-backend` sobre el cambio (confirmar: sin cambio de comportamiento, sin call site huérfano, docstring del util coherente).

## Self-Review (hecho al escribir el plan)

- **Cobertura del spec:** import nuevo (Step 2) ✓ · call site ajustado a `(this.prisma, destinatarios)` (Step 2) ✓ · método privado borrado (Step 3) ✓ · docstring del util (Step 4, opcional) ✓ · build + e2e sin regresión (Steps 5-6) ✓.
- **Placeholders:** ninguno.
- **Consistencia de tipos:** la firma `obtenerCorreosPersonales(prisma, usuarioIds)` que invoca el Step 2 es exactamente la exportada por el util y la ya usada en `avisos.service.ts:193`.
