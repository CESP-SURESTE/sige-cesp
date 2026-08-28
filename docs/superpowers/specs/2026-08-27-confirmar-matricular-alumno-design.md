# Modal de confirmación al matricular un alumno — diseño

Fecha: 2026-08-27
Contexto: pulido de usabilidad sobre el Día 31 (UI de gestión de grupos). Cierra esa parte.

## Problema

En `app/admin/grupos/[id]/page.tsx`, al elegir un alumno en el autocomplete de
"Agregar alumno", el `Combobox.onChange` dispara `matricularAlumno` de inmediato. No
hay paso de verificación: un clic accidental en la opción equivocada matricula a la
persona equivocada (y luego hay que quitarla). El usuario quiere un modal de
confirmación que muestre los datos del alumno seleccionado (solo lectura) para
verificar que es el correcto antes de matricularlo.

## Solución

### Componente nuevo — `app/admin/grupos/[id]/ConfirmarMatricularAlumnoModal.tsx`

Local a la sección (regla 11, sin import cruzado). Calco estructural de
`ConfirmarQuitarAlumnoModal.tsx` (mismo overlay `fixed inset-0 z-50 … bg-slate/40 p-4`,
panel `w-full max-w-md rounded-lg bg-white p-6 shadow-lg`) con estas diferencias:

- **Botón principal `bg-navy`** ("Matricular"), no `bg-crimson` — es un alta, no un
  borrado.
- **Encabezado**: "¿Matricular a este alumno?"
- **Subtexto**: "Verifica que sea el alumno correcto antes de agregarlo al grupo
  **{grupoNombre}**."
- **Lista de solo lectura** (pares etiqueta/valor, `<dl>` o filas simples), con:
  - Nombre completo — `${apellidoPaterno} ${apellidoMaterno ?? ''} ${nombres}` (trim).
  - Matrícula — `matricula`.
  - Carrera — `carrera.nombre`.
  - Semestre actual — `semestreActual`.
  - Estatus académico — texto vía un `Record<EstatusAcademico, string>` local
    (`INSCRITO`→"Inscrito", `BAJA_TEMPORAL`→"Baja temporal", `BAJA_DEFINITIVA`→"Baja
    definitiva", `EGRESADO`→"Egresado"). (Mismo mapa que ya existe en `page.tsx`; se
    duplica en el modal, mismo criterio que `ESTATUS_EMPLEADO_LABEL`/
    `TIPO_LICENCIA_LABEL` ya duplicados entre archivos del árbol admin.)
  - Cuenta — "Activa" si `activo`, "Inactiva" si `!activo`. Cuando es inactiva, el
    valor se resalta en ámbar (`text-warning`) para que salte a la vista (el backend
    del Día 30 permite matricular a un alumno de baja lógica; verlo antes de confirmar
    es la salvaguarda).
- **Botones**: "Cancelar" (borde, `text-slate`) / "Matricular" (`bg-navy`).
  Ambos `disabled` mientras `matriculando` (el `matricularMutation.isPending`).
- Ningún campo es editable — es solo presentación.

**Props:**

```ts
interface ConfirmarMatricularAlumnoModalProps {
  alumno: PersonaListItemAlumno; // importado de '@/lib/api/personas'
  grupoNombre: string;
  matriculando: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}
```

### Cambio de flujo — `app/admin/grupos/[id]/page.tsx`

- Import nuevo: `ConfirmarMatricularAlumnoModal` (local) y el tipo
  `PersonaListItemAlumno` (ya se importa `listarAlumnos`/`PersonaListItemAlumno` de
  `@/lib/api/personas` en la Task 3 del Día 31 — reusar).
- Estado nuevo: `const [alumnoAConfirmar, setAlumnoAConfirmar] = useState<PersonaListItemAlumno | null>(null);`
- `Combobox.onChange` cambia de:
  ```tsx
  onChange={(usuarioId: string | null) => {
    if (usuarioId) matricularMutation.mutate(usuarioId);
  }}
  ```
  a:
  ```tsx
  onChange={(usuarioId: string | null) => {
    if (!usuarioId) return;
    setAlumnoAConfirmar(candidatos.find((p) => p.usuarioId === usuarioId) ?? null);
  }}
  ```
- `matricularMutation.onSuccess`: además de lo actual (toast + `setInputValue('')` +
  `invalidateQueries(['admin','grupos','detalle', id])`), agrega
  `setAlumnoAConfirmar(null)`.
- `matricularMutation.onError`: sin cambio (ya hace `console.error` + passthrough de los
  4 códigos). El modal permanece abierto en caso de error (p. ej. `409
  CAPACIDAD_EXCEDIDA` si el grupo se llenó entre seleccionar y confirmar) — el toast
  informa y el usuario puede cancelar. **No** se cierra el modal en `onError` (a
  diferencia de `desmatricularMutation`, que sí lo hace) para que el usuario vea contra
  qué alumno falló.
- Render del modal, junto al de quitar:
  ```tsx
  {alumnoAConfirmar && grupo && (
    <ConfirmarMatricularAlumnoModal
      alumno={alumnoAConfirmar}
      grupoNombre={grupo.nombre}
      matriculando={matricularMutation.isPending}
      onConfirmar={() => matricularMutation.mutate(alumnoAConfirmar.usuarioId)}
      onCancelar={() => setAlumnoAConfirmar(null)}
    />
  )}
  ```
- **Cancelar** solo hace `setAlumnoAConfirmar(null)` — NO limpia `inputValue`, para que
  el texto de búsqueda quede y el usuario pueda elegir otra opción de inmediato.

## Fuera de alcance

- Ningún cambio de backend.
- No se muestra `fechaNacimiento`, `curp`, contactos ni info médica — solo los campos
  que el autocomplete ya trae en `PersonaListItemAlumno` (sin fetch adicional).
- No se bloquea la confirmación por `activo: false` ni por `estatusAcademico` — solo se
  muestran; el admin decide (coherente con el backend del Día 30).
- El modal de quitar (`ConfirmarQuitarAlumnoModal`) no se toca.

## Verificación

- `cd App/frontend && pnpm tsc --noEmit` — limpio (el `Record<EstatusAcademico, string>`
  del modal obliga a cubrir los 4 valores).
- `cd App/frontend && pnpm build` — OK.
- Verificación manual en navegador (a cargo del usuario): en el detalle de un grupo,
  buscar un alumno y hacer clic en una opción → aparece el modal con sus datos → "Cancelar"
  no matricula y deja el texto de búsqueda → volver a elegir y "Matricular" sí lo agrega
  (contador `N / M` sube). Elegir un alumno inactivo → la fila "Cuenta" se ve en ámbar.
