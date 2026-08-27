# Tooltip personalizado para el badge de Licencia — diseño

Fecha: 2026-08-27

## Problema

El tooltip que muestra el tipo de licencia sobre el badge de "Estatus"
(`EstatusEmpleadoBadge.tsx`, maestros y administrativos) usa el atributo `title`
nativo del navegador: aparición lenta (~1 s), estilo del sistema operativo, sin
relación visual con el resto de la UI.

## Contexto del código

- No existe ningún componente de tooltip en el proyecto. Uso de `title` nativo en
  `Sidebar.tsx` y `EstatusEmpleadoBadge.tsx`.
- `@headlessui/react` v2.2.10 está instalado pero no tiene primitiva de tooltip
  (`Popover` es por click). No hay Floating UI / Radix / Tippy. Regla del proyecto:
  no agregar dependencias nuevas si se resuelve con lo instalado.
- La tabla de ambas páginas va dentro de `<div className="overflow-x-auto ...">`
  (`administrativos/page.tsx:258`, `maestros/page.tsx` equivalente). Un tooltip
  posicionado con CSS dentro de la celda queda recortado por ese contenedor (y por
  spec de CSS, `overflow-x: auto` fuerza `overflow-y: auto`, generando además
  scroll vertical fantasma).

## Solución

### Componente nuevo — `App/frontend/src/components/admin/ui/Tooltip.tsx`

Genérico, reutilizable dentro del árbol admin (regla 11 lo mantiene fuera del árbol
alumno). Sin dependencias nuevas.

**API:**

```tsx
interface TooltipProps {
  label: string;
  children: React.ReactElement; // el trigger — un único elemento
}
export function Tooltip({ label, children }: TooltipProps): React.ReactElement;
```

**Mecánica:**

- El componente renderiza `children` tal cual como trigger, envuelto en un `<span>`
  inline con los handlers (`onMouseEnter`, `onMouseLeave`, `onFocus`, `onBlur`) y una
  `ref` para medir.
- Estado local `visible: boolean`. En `mouseenter`/`focus` arranca un `setTimeout`
  de 150 ms que pone `visible = true`; `mouseleave`/`blur`/`Escape` limpian el
  timeout y ponen `visible = false` de inmediato.
- Cuando `visible`, se mide el trigger con `getBoundingClientRect()` y se renderiza
  el tooltip vía `createPortal(…, document.body)` con `position: fixed`, centrado
  horizontalmente sobre el trigger, 8 px por encima de su borde superior. Al ir por
  portal a `body` con `position: fixed`, ningún `overflow` de ancestros lo recorta.
- **Flip vertical:** si `rect.top < 48` (no cabe arriba), se posiciona 8 px por
  debajo del borde inferior del trigger y la flecha apunta hacia arriba.
- Recalcular la posición en cada apertura (no se cachea). No se escucha `scroll`/
  `resize` mientras está abierto — el tooltip vive lo que dura un hover, si el
  usuario hace scroll con el tooltip abierto se cierra por `mouseleave`. Mantiene
  el componente simple; suficiente para el caso de uso (celda de tabla).

**Accesibilidad:**

- El trigger recibe `aria-describedby={tooltipId}` (id generado con `useId()`) solo
  mientras el tooltip está visible.
- El nodo del tooltip lleva `role="tooltip"` e `id={tooltipId}`.
- Se dispara con foco de teclado (`onFocus`/`onBlur`), no solo con mouse.
- `Escape` lo cierra (listener agregado solo mientras `visible`).
- `pointer-events: none` en el nodo del tooltip para que nunca intercepte el mouse.

**Estilo (chip oscuro, tokens de marca):**

- `fixed z-50 rounded-md bg-navy px-2.5 py-1.5 text-xs font-medium text-bone shadow-md`
- Flecha: `<span>` de 6 px rotado 45°, `bg-navy`, centrado bajo/sobre el chip según
  el flip.
- Sin animación de entrada compleja: `transition-opacity` de 100 ms sobre
  `opacity-0 → opacity-100` (el nodo se monta ya con `opacity-0` y pasa a
  `opacity-100` en el siguiente frame). Aceptable omitirla si complica; no es
  requisito.
- `max-w-xs` para que una etiqueta larga (p. ej. "Motivo: Incapacidad por riesgo de
  trabajo") haga wrap en vez de desbordar.

### Integración — `EstatusEmpleadoBadge.tsx`

- Quitar el atributo `title={titulo}` del `<span>` del badge.
- Cuando `estatus === 'LICENCIA' && tipoLicencia` (misma condición de hoy), envolver
  el `<span>` del badge en `<Tooltip label={`Motivo: ${TIPO_LICENCIA_LABEL[tipoLicencia]}`}>`.
  Cuando no aplica, renderizar el `<span>` sin envolver (sin tooltip, igual que hoy
  no ponía `title`).
- El resto del componente (labels, estilos, `crimson` para BAJA) no cambia.

## Fuera de alcance

- `Sidebar.tsx` sigue con su `title` nativo — migrarlo es otro cambio, nadie lo pidió.
- Tooltips en cualquier otro lugar de la app.
- Posicionamiento horizontal inteligente (flip izquierda/derecha) — solo flip
  vertical; la columna "Estatus" no está pegada a los bordes de la tabla.
- Reexportar `Tooltip` desde un barrel / índice de `components/admin/ui`.

## Verificación

- `cd App/frontend && pnpm tsc --noEmit` — limpio.
- `cd App/frontend && pnpm build` — OK.
- Verificación manual en navegador (a cargo del usuario): hover y foco de teclado
  sobre el badge de "Licencia" en `app/admin/maestros` y `app/admin/administrativos`;
  confirmar que el chip oscuro aparece sobre el badge, no se recorta contra el borde
  de la tabla, y se cierra al quitar el mouse / con Escape.
