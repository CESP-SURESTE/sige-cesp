'use client';

import { INPUT_CLASS, LABEL_CLASS } from '../persona-alta/estilos';
import { Select } from '../persona-alta/Select';

/**
 * `BuscadorFiltro` — Fase 5, Día 19.
 *
 * Búsqueda (`buscar`, con debounce — el debounce vive en el `page.tsx` que
 * usa este componente, acá solo se recibe el valor ya controlado) + filtro
 * por `estatus` (dropdown con los valores del enum correspondiente al rol
 * activo, pasado por el caller vía `estatusOptions` — `alumnos/page.tsx` y
 * `maestros/page.tsx` tienen enums distintos, `EstatusAcademico` vs
 * `EstatusEmpleado`).
 *
 * Compartido entre `app/admin/alumnos/page.tsx` y `app/admin/maestros/page.tsx`
 * (mismo árbol admin, no viola la regla 11 — esa regla es sobre no compartir
 * entre admin/alumno, no sobre reutilizar dentro del propio árbol admin).
 *
 * Reutiliza `INPUT_CLASS`/`LABEL_CLASS` de `persona-alta/estilos.ts` — son
 * constantes de estilo genéricas (no específicas de formularios de alta),
 * mismo criterio que ya las hace "single source" para todo el árbol admin.
 */
export function BuscadorFiltro({
  buscarInput,
  onBuscarChange,
  buscarPlaceholder,
  estatus,
  onEstatusChange,
  estatusOptions,
}: {
  buscarInput: string;
  onBuscarChange: (valor: string) => void;
  buscarPlaceholder: string;
  estatus: string;
  onEstatusChange: (valor: string) => void;
  estatusOptions: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="min-w-[240px] flex-1">
        <label className={LABEL_CLASS} htmlFor="buscar">
          Buscar
        </label>
        <input
          id="buscar"
          type="text"
          className={INPUT_CLASS}
          placeholder={buscarPlaceholder}
          value={buscarInput}
          onChange={(e) => onBuscarChange(e.target.value)}
        />
      </div>
      <div className="min-w-[200px]">
        <label className={LABEL_CLASS} htmlFor="estatus">
          Estatus
        </label>
        <Select
          id="estatus"
          value={estatus}
          onChange={onEstatusChange}
          options={[{ value: '', label: 'Todos' }, ...estatusOptions]}
          placeholder="Todos"
        />
      </div>
    </div>
  );
}
