# Mensajes de error en UI + UX rota — Día 22 (sub-proyectos 2 y 3)

**Fecha:** 2026-08-19
**Fase:** 6 (Sedes y carreras configurables), Día 22 — segundo y tercer
sub-proyecto de 3 (el primero, `DELETE /sedes/:id`, cerrado el 2026-08-18, ver
`docs/superpowers/specs/2026-08-18-delete-sedes-design.md`).

## Contexto

`docs/roadmap.md`, Día 22, dos puntos sin marcar:
- "Mensajes de error claros en UI"
- "Ajustes de UX según pruebas de los días anteriores"

El recap de la sesión anterior traía como ejemplo suelto de "ajustes de UX" el
botón "Copiar" del panel de alta — **el usuario confirmó en esta sesión que
nunca fue un bug real** ("Nunka fallo, ignoralo"), así que se descarta por
completo. No queda ningún otro punto concreto de "ajustes de UX" fuera de lo
que aparezca al auditar mensajes de error — el usuario decidió fusionar
ambos puntos en una sola pasada: auditar `app/admin/*` + `app/plataforma/*`
buscando (1) mutaciones/queries sin manejo de error visible al usuario, y (2)
cualquier UX obviamente rota (no cosmética) que aparezca de paso.

Se excluye explícitamente `app/alumno`/`app/maestro` (Fase 5) — el usuario
priorizó `/admin` + `/plataforma` para esta ronda.

## Auditoría — estado real encontrado

El patrón ya establecido (desde la pasada de toasts con `sonner`, documentada
en `ESTADO.md`) es: `queryFn` envuelve el fetch en `try/catch` con
`console.error` antes de re-lanzar (regla 12 de `CLAUDE.md` raíz), y la UI
renderiza un bloque `isError` con `border-error-border bg-error-bg
text-crimson`; las mutaciones usan `onError` con `console.error` +
`toast.error(mensaje)`. Los 3 formularios de alta (`nuevo/page.tsx`),
`app/admin/{alumnos,maestros,carreras}/page.tsx` y `app/admin/page.tsx` ya
siguen ese patrón completo — no se tocan.

Se encontraron 6 gaps concretos contra ese mismo patrón, todos en archivos que
se construyeron en días distintos y nunca se re-auditaron juntos:

1. **`app/admin/perfil/page.tsx`** — el `useQuery` de `obtenerPerfil` no
   envuelve el fetch en `try/catch`/`console.error` (a diferencia de
   `alumnos`/`maestros`/`page.tsx` en el mismo árbol). El `isError` sí
   renderiza mensaje al usuario — el gap es solo de logging (regla 12).
2. **`app/plataforma/page.tsx`** (dashboard global) — mismo gap: `resumenQuery`
   (`obtenerResumenGlobal`) sin `try/catch`/`console.error`. El `isError` sí
   renderiza mensaje.
3. **`app/plataforma/sedes/page.tsx`** — el gap más serio de los 6:
   - `sedesQuery` (`listarSedes`) **no tiene ninguna rama `isError` en el
     JSX** (solo `isLoading`). Si el fetch falla, la tabla no muestra
     `Cargando…` ni error — simplemente no renderiza filas, sin ninguna
     explicación. Este es el caso real de "mensaje de error faltante en UI".
   - Los 3 `onError` (`crearMutation`/`actualizarMutation`/`eliminarMutation`)
     sí llaman `toast.error(...)` pero ninguno llama `console.error` primero
     — gap de regla 12, a diferencia de `admin/carreras/page.tsx` que sí
     loguea en sus dos `onError` equivalentes.
   - `sedesQuery` tampoco tiene `try/catch`/`console.error` en su `queryFn`.
4. **`app/plataforma/login/page.tsx`** — `onError` no llama `console.error`
   antes de mostrar el toast. Caso más discutible (login fallido es un error
   *esperado* del usuario, no una falla del sistema) pero regla 12 no hace esa
   distinción — se aplica igual, mismo criterio que el resto.
5. **`app/admin/alumnos/nuevo/page.tsx`** — `carrerasQuery` (dropdown de
   carrera en el formulario de alta de alumno) ya renderiza un `isError`
   inline junto al campo, pero su `queryFn` tampoco tiene
   `try/catch`/`console.error`. Único consumidor de `listarCarreras` con este
   patrón — `maestros/nuevo` y `administrativos/nuevo` no tienen dropdown de
   carrera, no aplica ahí.
6. **UX rota encontrada de paso:** ninguna adicional a la ya documentada
   (modal de sedes sin a11y — `role=dialog`/focus trap/Escape — ya consignada
   como Minor no bloqueante en el review de `DELETE /sedes`, se mantiene fuera
   de alcance a propósito, no se re-abre acá).

No se encontraron mutaciones/queries completamente mudas (sin ningún
`isError`/`onError`) fuera del punto 3 — el resto del árbol ya tiene el
patrón visual correcto, solo le faltaba el logging.

## Diseño de la corrección

Mismo patrón en los 6 casos, sin inventar uno nuevo — con un ajuste pedido
por el usuario: los `console.error` deben llevar **contexto real de debug**,
no solo el string genérico `'[Componente] Error al <acción>:'` + `err`. Donde
haya variables relevantes (id, payload del form), se loguean junto al error
en un objeto — así el log sirve para reproducir el caso sin adivinar qué se
mandó. Nunca se loguea `password`/`passwordActual`/`passwordNueva` ni
cualquier credencial, aunque esté disponible en la función.

**Para queries (`useQuery`) sin parámetros relevantes** — envolver `queryFn`
en `try/catch`:
```ts
queryFn: async () => {
  try {
    return await fetchReal();
  } catch (err) {
    console.error('[Componente] Error al <acción>:', err);
    throw err;
  }
},
```

**Para mutaciones (`useMutation`) con variables** — agregar `console.error`
al inicio de `onError`, con las `vars` que trae el propio `onError` (React
Query las pasa como segundo argumento, no hay que capturarlas aparte):
```ts
onError: (err, vars) => {
  console.error('[Componente] Error al <acción>:', { vars, err });
  toast.error(...); // ya existente, sin cambios de mensaje/lógica
},
```

Aplicado a los casos concretos de este spec:
- `plataforma/sedes` `crearMutation.onError` → `{ input: vars, err }`.
- `plataforma/sedes` `actualizarMutation.onError` → `{ id: vars.id, input: vars.input, err }`.
- `plataforma/sedes` `eliminarMutation.onError` → `{ id: vars, err }` (`vars` ya es el `id` en esta mutation, ver `mutationFn: (id: string) => eliminarSede(id)`).
- `plataforma/login` `onError` → `{ email, err }` — **nunca** `password` (el valor vive en el closure del componente, no en `vars`, así que hay que loguearlo explícito con cuidado de excluir la contraseña).
- `admin/perfil` y `plataforma` (dashboard) — sin variables relevantes (queries sin params), se quedan con el patrón simple de arriba.
- `admin/alumnos/nuevo` `carrerasQuery` — sin parámetros (lista completa), patrón simple.

**Para el gap real de UI (punto 3, `sedesQuery`)** — agregar la rama
`isError` a la tabla, mismo bloque visual que ya usa
`admin/carreras/page.tsx` en su tabla (`colSpan` sobre toda la fila,
`text-crimson`, mensaje de `ApiError` si aplica o fallback genérico):
```tsx
{sedesQuery.isError && (
  <tr>
    <td colSpan={4} className="px-4 py-6 text-center text-crimson">
      {sedesQuery.error instanceof ApiError
        ? sedesQuery.error.message
        : 'No se pudo cargar el listado de sedes. Intenta de nuevo más tarde.'}
    </td>
  </tr>
)}
```

Sin cambios de mensaje, de lógica de negocio, ni de arquitectura — es
mecánico y de bajo riesgo en los 6 casos: mismo patrón ya validado en el
resto del árbol, solo replicado donde faltaba.

## Fuera de alcance

- Botón "Copiar" — descartado, nunca fue un bug (confirmado por el usuario).
- A11y del modal de sedes (`role=dialog`/focus trap/Escape) — ya documentado
  como Minor no bloqueante, se deja para cuando exista un componente
  `Modal`/`Dialog` genérico que valga la pena construir.
- `app/alumno`/`app/maestro` — excluido explícitamente por el usuario.
- Cualquier rediseño visual o cambio de mensaje — solo se agrega logging
  faltante y una rama `isError` que ya sigue el patrón visual existente.

## Ejecución

Dos tareas independientes (regla 11 — árboles separados):
- **Tarea 1** — puntos 1 y 5 (`app/admin/perfil/page.tsx`,
  `app/admin/alumnos/nuevo/page.tsx`): dominio de `admin-coder`.
- **Tarea 2** — puntos 2, 3 y 4 (`app/plataforma/*`): sin dueño de dominio
  asignado (mismo gap ya documentado desde Día 20/22 — `app/plataforma` no
  tiene coder/QA propio en el roster de agentes), se hace directo.

QA: `qa-admin` audita la Tarea 1 (sí tiene dueño). La Tarea 2 no tiene QA
dedicado — se revisa manualmente (lectura + `tsc`/`eslint`) al cierre, mismo
criterio ya aceptado para `DELETE /sedes`.
