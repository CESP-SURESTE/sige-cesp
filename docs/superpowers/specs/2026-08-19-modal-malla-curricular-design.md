# Modal de subida de malla curricular (mejora de UX)

**Fecha:** 2026-08-19
**Alcance:** Mejora de UX sobre el feature ya cerrado de Día 23 (Storage y
subida de malla curricular) — pedido directo del usuario tras probar el
flujo actual (botón + selector de archivo nativo) y confirmar que funciona.

## Contexto

El flujo actual (`app/admin/carreras/page.tsx`) ya probado manualmente y
funcionando: botón "Subir malla" por fila → abre el selector nativo del
SO → valida PDF/5MB en cliente → sube vía `fetch`. El usuario pide
reemplazarlo por un modal con: drag&drop o click, nombre/peso del archivo,
preview de PDF si es viable, barra de progreso real bloqueando todo durante
la subida, mensaje de éxito dentro del modal que se cierra solo, y — al
reabrir el modal de una carrera que ya tiene malla — mostrar quién y cuándo
la subió.

## Decisiones (confirmadas con el usuario)

1. **Barra de progreso real** — vía `XMLHttpRequest` (nativo, sin
   dependencia nueva) solo para esta subida puntual; el resto del árbol
   sigue usando `fetch`/`apiFetchAuth` sin cambios.
2. **`GET /carreras/:id/malla` dedicado** para el detalle completo
   (quién/cuándo) — se consulta solo al abrir el modal de esa carrera, no
   infla la respuesta de `GET /carreras`.
3. **Indicador también en la tabla** — como se necesita saber si CUALQUIER
   carrera de la lista tiene malla (no solo la que se abre), `GET /carreras`
   gana un campo barato `tieneMalla: boolean` por fila (un `select` de si
   existe la relación, nunca trae el archivo ni el detalle completo).

## Diseño

### 1. Backend — `GET /carreras` gana `tieneMalla`

`CarrerasService.listarPorSede` (`App/backend/src/carreras/carreras.service.ts`)
agrega `include: { mallaCurricular: { select: { id: true } } }` al
`findMany` ya existente, y mapea el resultado a
`{ ...carrera, tieneMalla: mallaCurricular !== null }` (sin exponer el
objeto `mallaCurricular` anidado — solo el booleano). Sin cambios en
`CarrerasController`/DTOs — el shape de respuesta solo gana un campo.

### 2. Backend — `GET /carreras/:id/malla` (nuevo)

Mismo módulo `malla-curricular/` (Día 23), mismos guards que el resto de
`MallaCurricularController` (`SedeGuard`+`RolesGuard(ADMINISTRATIVO)`).
Nuevo método `MallaCurricularService.obtener(carreraId, sedeId)`: valida
que la carrera exista y pertenezca a la sede (mismo criterio que `subir`,
`404 NOT_FOUND` si no) — si pasa la validación pero no hay malla, devuelve
`null` (200, no 404 — "todavía no hay malla" es un estado normal, no un
error). Si hay malla, devuelve `{ nombreArchivo, subidaEn, subidaPor: {
nombres, apellidoPaterno, apellidoMaterno } }` — el join a
`Usuario.perfilAdministrativo` es seguro sin chequeo defensivo adicional:
solo un `ADMINISTRATIVO` puede subir una malla (guard), y regla 3 (baja
lógica, nunca hard-delete de personas) garantiza que su
`PerfilAdministrativo` sigue existiendo aunque esté dado de baja. Éxito
siempre `200 { data: MallaInfo | null }`.

### 3. Frontend — `lib/api/http.ts`

Extrae el token-resolution ya usado por `resolveAuthHeaders` a una función
exportada `obtenerAccessToken(): Promise<string>` (mismo cuerpo, sin
cambiar comportamiento — `resolveAuthHeaders` pasa a llamarla) — la
necesita el nuevo upload por `XMLHttpRequest` de `lib/api/carreras.ts`,
que no puede pasar por `apiFetchAuth` (`fetch`-based, sin eventos de
progreso). También exporta `API_URL` (hoy un `const` privado del archivo).

### 4. Frontend — `lib/api/carreras.ts`

- `CarreraCompleta` gana `tieneMalla: boolean`.
- Nuevo tipo `MallaCurricularInfo { nombreArchivo: string; subidaEn: string;
  subidaPor: { nombres: string; apellidoPaterno: string; apellidoMaterno:
  string | null } }`.
- Nueva función `obtenerMallaCurricular(carreraId: string): Promise<MallaCurricularInfo | null>`
  — `apiFetchAuth` normal (no necesita progreso).
- `subirMallaCurricular` se reescribe para aceptar un tercer parámetro
  opcional `onProgress?: (porcentaje: number) => void` y usar
  `XMLHttpRequest` en vez de `apiFetchAuth`/`fetch` — mismo contrato de
  retorno (`Promise<MallaCurricular>`), mismo manejo de `{error,code}` en
  caso de falla (construye un `ApiError` igual que `apiFetchRaw`).

### 5. Frontend — `app/admin/carreras/SubirMallaModal.tsx` (nuevo)

Componente local a esta ruta (mismo criterio que
`app/plataforma/sedes/ConfirmarEliminarSedeModal.tsx` — primer modal
"real" del árbol admin, sin componente `Modal`/`Dialog` genérico
todavía, no se over-engineerea uno ahora solo por esto). Props: `carrera:
Carrera`, `onClose: () => void`, `onSubidoConExito: () => void`.

- Al montar: `useQuery` a `obtenerMallaCurricular(carrera.id)` — mientras
  carga, "Cargando…"; si devuelve una malla, banner "Subida por {nombres}
  {apellidoPaterno} el {fecha formateada `es-MX`}" arriba de la zona de
  drop; si `null`, sin banner (no hay nada que mostrar todavía).
- Zona de drop (`onDragOver`/`onDragLeave`/`onDrop`, con estado visual de
  "arrastrando encima") + click abre un `<input type="file"
  accept="application/pdf" className="hidden">` — ambos caminos llegan a
  la misma función `seleccionarArchivo(file)`, que valida
  `file.type === 'application/pdf'` y `file.size <= 5MB` (mismos límites
  que el backend, mismo mensaje que ya existía) antes de guardar el
  archivo en estado local.
- Archivo válido seleccionado → muestra nombre + peso formateado (ej. "2.3
  MB") + preview vía `<embed src={URL.createObjectURL(file)}
  type="application/pdf" className="h-64 w-full rounded border" />` —
  best-effort, sin manejo especial si el navegador no lo renderiza inline
  (el nombre/peso ya se ve, la preview es un extra).
- Botón "Subir" (deshabilitado sin archivo válido) → llama
  `subirMallaCurricular(carrera.id, file, setProgreso)`. Mientras
  `subiendo` es `true`: disabled en el botón de cerrar, la zona de
  drop/input, y el botón "Subir"; se muestra una barra de progreso
  (`<div style={{width: `${progreso}%`}}>`) con el porcentaje.
- Éxito: reemplaza el contenido del modal por un estado de éxito ("Malla
  curricular actualizada" + ícono), llama `onSubidoConExito()` (el padre
  invalida `['admin','carreras']` y muestra el toast, mismo patrón que ya
  usan `crearMutation`/`actualizarMutation`), y tras ~1.5s llama
  `onClose()` automáticamente (`setTimeout`, limpiado en un `useEffect` de
  cleanup si el componente se desmonta antes).
- Error: se muestra inline dentro del modal (no solo toast) con el mensaje
  real (`ApiError.message`), el modal NO se cierra — el admin puede
  reintentar sin perder el archivo ya seleccionado. También dispara
  `console.error` (regla 12) + `toast.error` (consistencia con el resto
  del árbol, doble canal — inline para que no se pierda dentro del modal,
  toast para el caso de que el admin ya haya mirado para otro lado).
- Cerrar (click en "X"/backdrop) solo funciona si `!subiendo` — mismo
  criterio que "modal sin `role=dialog`/focus trap" ya documentado como
  Minor para `ConfirmarEliminarSedeModal` (no se agrega ahora, mismo
  criterio de alcance).

### 6. Frontend — `app/admin/carreras/page.tsx`

- Se quita el mecanismo actual: `inputMallaRef`, `carreraIdParaMalla`,
  `iniciarSubidaMalla`, `handleArchivoMallaSeleccionado`, el `<input
  type="file">` oculto, y `subirMallaMutation` (reemplazado por el estado
  interno del modal).
- Nuevo estado `carreraParaMalla: Carrera | null` — el botón "Subir malla"
  de la fila ahora hace `setCarreraParaMalla(carrera)` (abre el modal para
  esa carrera) en vez de disparar el input oculto.
- El botón de la fila gana un indicador chico cuando `carrera.tieneMalla`
  (ej. un check verde `✓` antes del texto "Subir malla" — reutiliza el
  token `success`/`text-success` ya establecido en la paleta de este
  árbol, visto en `ResultadoAltaPersona.tsx`).
- Al final del JSX, `{carreraParaMalla && <SubirMallaModal carrera={carreraParaMalla} onClose={() => setCarreraParaMalla(null)} onSubidoConExito={() => { toast.success('Malla curricular actualizada'); void queryClient.invalidateQueries({ queryKey: ['admin', 'carreras'] }); }} />}`.

## Fuera de alcance

- Componente `Modal`/`Dialog` genérico reutilizable — se construye local a
  esta pantalla, como ya se hizo con `ConfirmarEliminarSedeModal`.
- Accesibilidad completa del modal (`role=dialog`, focus trap, cierre con
  Escape) — mismo criterio ya aceptado como deuda menor en el modal
  anterior del repo.
- Cambiar el resto del árbol admin de `fetch` a `XMLHttpRequest` — es
  exclusivo de esta subida, la única que necesita progreso real hoy.
- Descarga/preview de la malla YA SUBIDA (solo se previsualiza el archivo
  nuevo antes de subir) — eso es Día 24 del roadmap (signed URLs), no este
  cambio.
