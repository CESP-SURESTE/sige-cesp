'use client';

import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/react';
import { INPUT_CLASS } from './estilos';

/**
 * Reemplazo de `<select>` nativo con `Listbox` de Headless UI (v2.2.10) —
 * el panel de opciones del `<select>` del navegador es un overlay del SO
 * que no respeta el `border-radius`/layout de las tarjetas y se sale del
 * contenedor. Headless respecto a `react-hook-form`: NO usa `register()`,
 * recibe `value`/`onChange`/`onBlur` como props controlados — cada
 * formulario lo integra vía `Controller` de RHF.
 *
 * API real instalada (v2.2.10) difiere del `Listbox.Button`/`Listbox.Options`
 * con notación de punto sugerida originalmente: esa notación sigue existiendo
 * pero está `@deprecated` a favor de los componentes sueltos `ListboxButton`/
 * `ListboxOptions`/`ListboxOption` (ver `dist/components/listbox/listbox.d.ts`)
 * — se usan esos acá.
 */
export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  options: SelectOption[];
  placeholder: string;
  disabled?: boolean;
}

export function Select({
  id,
  value,
  onChange,
  onBlur,
  options,
  placeholder,
  disabled,
}: SelectProps) {
  const selected = options.find((o) => o.value === value);

  return (
    <Listbox value={value} onChange={onChange} disabled={disabled}>
      {({ open }) => (
        <div className="relative">
          <ListboxButton
            id={id}
            onBlur={onBlur}
            className={`${INPUT_CLASS} flex items-center justify-between text-left`}
          >
            <span className={selected ? 'text-slate' : 'text-slate/40'}>
              {selected ? selected.label : placeholder}
            </span>
            <svg
              className={`size-4 text-slate/60 transition-transform ${open ? 'rotate-180' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </ListboxButton>
          <ListboxOptions className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-mist bg-white py-1 text-sm shadow-lg focus:outline-none">
            {options.map((option) => (
              <ListboxOption
                key={option.value}
                value={option.value}
                className={({ focus, selected: isSelected }) =>
                  `cursor-pointer px-3 py-2 ${focus ? 'bg-navy/10' : ''} ${
                    isSelected ? 'font-semibold text-navy' : 'text-slate'
                  }`
                }
              >
                {option.label}
              </ListboxOption>
            ))}
          </ListboxOptions>
        </div>
      )}
    </Listbox>
  );
}
