'use client';

import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/react';
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { obtenerMisAsignaciones, type GrupoConMaterias } from '@/lib/api/perfil';
import type {
  ActualizarEventoInput,
  CategoriaEvento,
  CrearEventoInput,
  OcurrenciaEvento,
  ReglaRecurrencia,
} from '@/lib/api/calendario';

/**
 * Modal único de alta+edición de evento de calendario — árbol MAESTRO,
 * Fase 15, Día 43 (Task 9). Copia estructural de
 * `app/admin/calendario/EventoModal.tsx` (Task 8) — regla 11 de `CLAUDE.md`
 * raíz, sin import cruzado entre árboles: `INPUT_CLASS`/`LABEL_CLASS`/
 * `Select` se duplican localmente en este archivo (el árbol maestro no
 * tiene un `components/maestro/ui/persona-alta/` equivalente al de admin —
 * maestro nunca da de alta personas — así que no hay nada reutilizable ahí;
 * se define la variante local mínima en vez de crear un archivo compartido
 * nuevo fuera del alcance de esta tarea).
 *
 * DOS DIFERENCIAS respecto al admin (pedidas explícitamente en el brief de
 * esta tarea):
 *
 * 1. Alcance fijo a GRUPO. Un maestro solo puede crear/editar eventos con
 *    `alcanceTipo: 'GRUPO'` — nunca SEDE/CARRERA (`CalendarioService`,
 *    backend, ya lo exige así). En vez de un `<select>` de tipo de alcance
 *    con una sola opción disponible, este modal fija `alcanceTipo: 'GRUPO'`
 *    de forma implícita (no hay campo de formulario para elegirlo) y solo
 *    expone el `<select>` de grupo.
 * 2. El `<select>` de grupo se alimenta de `obtenerMisAsignaciones()`
 *    (`GET /perfil/asignaciones`, Fase 12/Día 34) — los grupos donde el
 *    maestro tiene una asignación real (`GrupoMateriaMaestro`) — en vez de
 *    `listarGrupos()` (catálogo completo de la sede, alcance incorrecto
 *    para un maestro). `GrupoConMaterias[]` se aplana a pares únicos
 *    `{grupoId, nombre}` (`gruposUnicosDeAsignaciones`, abajo) — en la
 *    práctica ya vienen únicos por grupo (`obtenerAsignacionesPropias`
 *    agrupa por grupo en el backend), la dedupe es solo defensiva.
 *
 * El resto del comportamiento (edición de evento no recurrente vs.
 * recurrente, reenvío completo de campos editables, `null` explícito para
 * "bórralo" vs. `undefined` para "sin cambio") es idéntico al admin — ver
 * el docstring original en `app/admin/calendario/EventoModal.tsx` para el
 * detalle completo, incluyendo el fix de `descripcion`/`alcanceId`/
 * `horaInicio`/`fechaFin` (`hayCambiosReales` con `'' !== null` espurio,
 * fix round 1/5 del review de Task 8) — se replica tal cual acá: los 4
 * campos usan el patrón `valor || null` en vez de string vacío/omitido.
 * `alcanceId` en este árbol siempre trae un grupo real seleccionado (la
 * validación de abajo lo exige antes de construir cualquier payload), así
 * que el `|| null` ahí es defensivo — nunca se ejercita en la práctica —
 * pero se mantiene por consistencia con el patrón ya revisado.
 */

const CATEGORIA_LABEL: Record<CategoriaEvento, string> = {
  EXAMEN: 'Examen',
  SOCIAL: 'Social',
  ADMINISTRATIVO: 'Administrativo',
  SUSPENSION_CLASES: 'Suspensión de clases',
  OTRO: 'Otro',
};

/** Paleta de color por categoría — reutilizada también por `page.tsx` para
 * pintar los chips del grid mensual (mismo criterio de color en ambos
 * lugares, copiado del árbol admin). Tokens de `globals.css` (paleta
 * institucional CESP + derivados semánticos, ver ese archivo). */
export const COLOR_POR_CATEGORIA: Record<CategoriaEvento, string> = {
  EXAMEN: 'bg-crimson/10 text-crimson',
  SOCIAL: 'bg-success/10 text-success',
  ADMINISTRATIVO: 'bg-navy/10 text-navy',
  SUSPENSION_CLASES: 'bg-warning/10 text-warning',
  OTRO: 'bg-slate/10 text-slate',
};

const FRECUENCIA_LABEL: Record<ReglaRecurrencia['frecuencia'], string> = {
  DIARIA: 'Diaria',
  SEMANAL: 'Semanal',
  MENSUAL: 'Mensual',
};

const DIAS_SEMANA_LABEL = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-mist px-3 py-2 text-sm text-slate focus:border-navy focus:ring-2 focus:ring-navy/20 focus:outline-none disabled:opacity-50';
const LABEL_CLASS = 'block text-sm font-medium text-slate/80';

/**
 * Reemplazo mínimo de `<select>` nativo, copiado de
 * `components/admin/ui/persona-alta/Select.tsx` (regla 11 — copia local,
 * no import cruzado). Mismo motivo que el original: el panel de opciones
 * de un `<select>` nativo es un overlay del SO que no respeta el layout de
 * las tarjetas.
 */
interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder: string;
  disabled?: boolean;
}

function Select({ id, value, onChange, options, placeholder, disabled }: SelectProps) {
  const selected = options.find((o) => o.value === value);

  return (
    <Listbox value={value} onChange={onChange} disabled={disabled}>
      {({ open }) => (
        <div className="relative">
          <ListboxButton
            id={id}
            className={`${INPUT_CLASS} flex items-center justify-between gap-2 text-left`}
          >
            <span className={`truncate ${selected ? 'text-slate' : 'text-slate/40'}`}>
              {selected ? selected.label : placeholder}
            </span>
            <svg
              className={`size-4 shrink-0 text-slate/60 transition-transform ${open ? 'rotate-180' : ''}`}
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
          <ListboxOptions className="absolute z-20 mt-1 max-h-60 w-max min-w-full max-w-xs overflow-y-auto rounded-lg border border-mist bg-white py-1 text-sm shadow-lg focus:outline-none">
            {options.map((option) => (
              <ListboxOption
                key={option.value}
                value={option.value}
                className={({ focus, selected: isSelected }) =>
                  `cursor-pointer px-3 py-2 whitespace-normal break-words ${focus ? 'bg-navy/10' : ''} ${
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

interface FormEvento {
  titulo: string;
  descripcion: string;
  fechaInicio: string;
  horaInicio: string;
  todoElDia: boolean;
  fechaFin: string;
  categoria: CategoriaEvento | '';
  /** `alcanceId` — siempre un `Grupo.id` real (`alcanceTipo` está fijo a
   * `'GRUPO'` en este árbol, ver docstring del archivo). */
  grupoId: string;
  seRepite: boolean;
  frecuencia: ReglaRecurrencia['frecuencia'] | '';
  intervalo: string;
  diasSemana: number[];
  diaMes: string;
  ultimoDiaMes: boolean;
  recurrenciaHasta: string;
}

const FORM_VACIO: FormEvento = {
  titulo: '',
  descripcion: '',
  fechaInicio: '',
  horaInicio: '',
  todoElDia: false,
  fechaFin: '',
  categoria: '',
  grupoId: '',
  seRepite: false,
  frecuencia: '',
  intervalo: '1',
  diasSemana: [],
  diaMes: '',
  ultimoDiaMes: false,
  recurrenciaHasta: '',
};

function formDesdeOcurrencia(evento: OcurrenciaEvento): FormEvento {
  return {
    titulo: evento.titulo,
    descripcion: evento.descripcion ?? '',
    fechaInicio: evento.fecha,
    horaInicio: evento.horaInicio ?? '',
    todoElDia: !evento.horaInicio,
    fechaFin: evento.fechaFin ?? '',
    categoria: evento.categoria,
    grupoId: evento.alcanceId ?? '',
    seRepite: false,
    frecuencia: '',
    intervalo: '1',
    diasSemana: [],
    diaMes: '',
    ultimoDiaMes: false,
    recurrenciaHasta: '',
  };
}

/** Aplana `GrupoConMaterias[]` (`GET /perfil/asignaciones`) a pares únicos
 * `{grupoId, nombre}` para el `<select>` de alcance. */
function gruposUnicosDeAsignaciones(
  asignaciones: GrupoConMaterias[],
): { grupoId: string; nombre: string }[] {
  const vistos = new Set<string>();
  const resultado: { grupoId: string; nombre: string }[] = [];
  for (const grupo of asignaciones) {
    if (vistos.has(grupo.grupoId)) continue;
    vistos.add(grupo.grupoId);
    resultado.push({ grupoId: grupo.grupoId, nombre: grupo.nombre });
  }
  return resultado;
}

interface RecurrenciaConstruida {
  recurrenciaRegla: ReglaRecurrencia;
  recurrenciaHasta: string;
}

/** Asume que ya se confirmó `form.seRepite === true` antes de llamarla — solo valida/arma el detalle de la regla. */
function construirRecurrencia(form: FormEvento): RecurrenciaConstruida | null {
  if (!form.frecuencia || !form.recurrenciaHasta) return null;
  const intervalo = Number.parseInt(form.intervalo, 10);
  if (!Number.isInteger(intervalo) || intervalo < 1) return null;

  const regla: ReglaRecurrencia = { frecuencia: form.frecuencia, intervalo };

  if (form.frecuencia === 'SEMANAL') {
    if (form.diasSemana.length === 0) return null;
    regla.diasSemana = [...form.diasSemana].sort((a, b) => a - b);
  }

  if (form.frecuencia === 'MENSUAL') {
    if (form.ultimoDiaMes) {
      regla.diaMes = -1;
    } else {
      const diaMes = Number.parseInt(form.diaMes, 10);
      if (!Number.isInteger(diaMes) || diaMes < 1 || diaMes > 31) return null;
      regla.diaMes = diaMes;
    }
  }

  return { recurrenciaRegla: regla, recurrenciaHasta: form.recurrenciaHasta };
}

function construirPayloadAlta(form: FormEvento): CrearEventoInput | null {
  if (!form.titulo.trim() || !form.fechaInicio || !form.categoria || !form.grupoId) {
    return null;
  }

  const payload: CrearEventoInput = {
    titulo: form.titulo.trim(),
    fechaInicio: form.fechaInicio,
    categoria: form.categoria,
    alcanceTipo: 'GRUPO',
    alcanceId: form.grupoId,
  };
  if (form.descripcion.trim()) payload.descripcion = form.descripcion.trim();
  if (!form.todoElDia && form.horaInicio) payload.horaInicio = form.horaInicio;
  if (form.fechaFin) payload.fechaFin = form.fechaFin;

  if (form.seRepite) {
    const recurrencia = construirRecurrencia(form);
    if (!recurrencia) return null;
    payload.recurrenciaRegla = recurrencia.recurrenciaRegla;
    payload.recurrenciaHasta = recurrencia.recurrenciaHasta;
  }

  return payload;
}

function construirPayloadEdicion(
  form: FormEvento,
  evento: OcurrenciaEvento,
): ActualizarEventoInput | null {
  if (!form.titulo.trim() || !form.categoria || !form.grupoId) return null;

  const payload: ActualizarEventoInput = {
    titulo: form.titulo.trim(),
    categoria: form.categoria,
    alcanceTipo: 'GRUPO',
    // Ver docstring del archivo — `null` explícito es "bórralo", `undefined`
    // es "sin cambio" (mismo patrón fijado en el review de Task 8, admin).
    // `ActualizarEventoInput` ya modela `| null` en cada campo, así que estos
    // 4 se asignan directo sin casteo. `alcanceId` acá siempre trae un grupo
    // real (`form.grupoId` ya se validó arriba) — el `|| null` es defensivo,
    // nunca se ejercita.
    alcanceId: form.grupoId || null,
    descripcion: form.descripcion.trim() || null,
    horaInicio: form.todoElDia ? null : form.horaInicio || null,
    fechaFin: form.fechaFin || null,
  };

  if (!evento.esRecurrente) {
    if (!form.fechaInicio) return null;
    payload.fechaInicio = form.fechaInicio;

    if (form.seRepite) {
      const recurrencia = construirRecurrencia(form);
      if (!recurrencia) return null;
      payload.recurrenciaRegla = recurrencia.recurrenciaRegla;
      payload.recurrenciaHasta = recurrencia.recurrenciaHasta;
    }
  }

  return payload;
}

export interface EventoModalProps {
  /** `null` = modo alta. Objeto real (una ocurrencia) = modo edición. */
  evento: OcurrenciaEvento | null;
  guardando: boolean;
  onCrear: (payload: CrearEventoInput) => void;
  onEditar: (payload: ActualizarEventoInput) => void;
  onCancelar: () => void;
  /** Solo se muestra en modo edición — abre el modal de confirmación de borrado en `page.tsx`. */
  onEliminar?: () => void;
}

export function EventoModal({
  evento,
  guardando,
  onCrear,
  onEditar,
  onCancelar,
  onEliminar,
}: EventoModalProps) {
  const esAlta = evento === null;
  const recurrenciaEditable = esAlta || !evento.esRecurrente;

  const [form, setForm] = useState<FormEvento>(() =>
    evento ? formDesdeOcurrencia(evento) : FORM_VACIO,
  );

  const asignacionesQuery = useQuery({
    queryKey: ['maestro', 'asignaciones', 'catalogo-alcance'],
    queryFn: async () => {
      try {
        return await obtenerMisAsignaciones();
      } catch (err) {
        console.error('[EventoModal] Error al obtener asignaciones:', err);
        throw err;
      }
    },
  });

  const gruposDisponibles = gruposUnicosDeAsignaciones(asignacionesQuery.data ?? []);

  function toggleDiaSemana(dia: number) {
    setForm((f) => ({
      ...f,
      diasSemana: f.diasSemana.includes(dia)
        ? f.diasSemana.filter((d) => d !== dia)
        : [...f.diasSemana, dia],
    }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (esAlta) {
      const payload = construirPayloadAlta(form);
      if (!payload) {
        toast.error('Revisa que todos los campos requeridos estén completos y con formato correcto.');
        return;
      }
      onCrear(payload);
      return;
    }
    const payload = construirPayloadEdicion(form, evento);
    if (!payload) {
      toast.error('Revisa que todos los campos requeridos estén completos y con formato correcto.');
      return;
    }
    onEditar(payload);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-slate">
          {esAlta ? 'Nuevo evento' : 'Editar evento'}
        </h2>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="evento-modal-titulo" className={LABEL_CLASS}>
              Título
            </label>
            <input
              id="evento-modal-titulo"
              type="text"
              required
              disabled={guardando}
              className={INPUT_CLASS}
              value={form.titulo}
              onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))}
            />
          </div>

          <div>
            <label htmlFor="evento-modal-descripcion" className={LABEL_CLASS}>
              Descripción
            </label>
            <textarea
              id="evento-modal-descripcion"
              rows={2}
              disabled={guardando}
              className={INPUT_CLASS}
              value={form.descripcion}
              onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="evento-modal-fecha-inicio" className={LABEL_CLASS}>
                Fecha
              </label>
              <input
                id="evento-modal-fecha-inicio"
                type="date"
                required
                disabled={guardando || (!esAlta && !recurrenciaEditable)}
                title={
                  !esAlta && !recurrenciaEditable
                    ? 'Este evento es recurrente — la fecha de inicio de la serie no se puede editar desde acá.'
                    : undefined
                }
                className={INPUT_CLASS}
                value={form.fechaInicio}
                onChange={(e) => setForm((f) => ({ ...f, fechaInicio: e.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="evento-modal-fecha-fin" className={LABEL_CLASS}>
                Fecha de fin (opcional)
              </label>
              <input
                id="evento-modal-fecha-fin"
                type="date"
                disabled={guardando}
                className={INPUT_CLASS}
                value={form.fechaFin}
                onChange={(e) => setForm((f) => ({ ...f, fechaFin: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="evento-modal-hora-inicio" className={LABEL_CLASS}>
                Hora
              </label>
              <input
                id="evento-modal-hora-inicio"
                type="time"
                disabled={guardando || form.todoElDia}
                className={INPUT_CLASS}
                value={form.horaInicio}
                onChange={(e) => setForm((f) => ({ ...f, horaInicio: e.target.value }))}
              />
              <label className="mt-2 flex items-center gap-2 text-sm text-slate/80">
                <input
                  type="checkbox"
                  disabled={guardando}
                  checked={form.todoElDia}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      todoElDia: e.target.checked,
                      horaInicio: e.target.checked ? '' : f.horaInicio,
                    }))
                  }
                />
                Todo el día
              </label>
            </div>
            <div>
              <label htmlFor="evento-modal-categoria" className={LABEL_CLASS}>
                Categoría
              </label>
              <Select
                id="evento-modal-categoria"
                disabled={guardando}
                value={form.categoria}
                onChange={(value) =>
                  setForm((f) => ({ ...f, categoria: value as CategoriaEvento | '' }))
                }
                options={[
                  { value: '', label: 'Selecciona una categoría' },
                  ...(Object.entries(CATEGORIA_LABEL) as [CategoriaEvento, string][]).map(
                    ([value, label]) => ({ value, label }),
                  ),
                ]}
                placeholder="Selecciona una categoría"
              />
            </div>
          </div>

          <div className="rounded-lg border border-mist p-4">
            <p className={LABEL_CLASS}>Alcance</p>
            <p className="mt-1 text-xs text-slate/60">
              Como maestro, solo puedes publicar eventos para uno de tus grupos
              asignados.
            </p>
            <div className="mt-2">
              {asignacionesQuery.isLoading && (
                <p className="text-sm text-slate/60">Cargando tus grupos…</p>
              )}
              {asignacionesQuery.isError && (
                <p className="text-sm text-crimson">
                  No se pudieron cargar tus grupos asignados. Intenta de nuevo más
                  tarde.
                </p>
              )}
              {!asignacionesQuery.isLoading &&
                !asignacionesQuery.isError &&
                gruposDisponibles.length === 0 && (
                  <p className="text-sm text-slate/60">
                    Aún no tienes materias asignadas en ningún grupo.
                  </p>
                )}
              {!asignacionesQuery.isLoading &&
                !asignacionesQuery.isError &&
                gruposDisponibles.length > 0 && (
                  <Select
                    id="evento-modal-alcance-grupo"
                    disabled={guardando}
                    value={form.grupoId}
                    onChange={(value) => setForm((f) => ({ ...f, grupoId: value }))}
                    options={[
                      { value: '', label: 'Selecciona un grupo' },
                      ...gruposDisponibles.map((g) => ({ value: g.grupoId, label: g.nombre })),
                    ]}
                    placeholder="Selecciona un grupo"
                  />
                )}
            </div>
          </div>

          <div className="rounded-lg border border-mist p-4">
            {recurrenciaEditable ? (
              <>
                <label className="flex items-center gap-2 text-sm font-medium text-slate/80">
                  <input
                    type="checkbox"
                    disabled={guardando}
                    checked={form.seRepite}
                    onChange={(e) => setForm((f) => ({ ...f, seRepite: e.target.checked }))}
                  />
                  Se repite
                </label>

                {form.seRepite && (
                  <div className="mt-3 space-y-3">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor="evento-modal-frecuencia" className={LABEL_CLASS}>
                          Frecuencia
                        </label>
                        <Select
                          id="evento-modal-frecuencia"
                          disabled={guardando}
                          value={form.frecuencia}
                          onChange={(value) =>
                            setForm((f) => ({
                              ...f,
                              frecuencia: value as ReglaRecurrencia['frecuencia'] | '',
                            }))
                          }
                          options={[
                            { value: '', label: 'Selecciona una frecuencia' },
                            ...(
                              Object.entries(FRECUENCIA_LABEL) as [
                                ReglaRecurrencia['frecuencia'],
                                string,
                              ][]
                            ).map(([value, label]) => ({ value, label })),
                          ]}
                          placeholder="Selecciona una frecuencia"
                        />
                      </div>
                      <div>
                        <label htmlFor="evento-modal-intervalo" className={LABEL_CLASS}>
                          Cada
                        </label>
                        <input
                          id="evento-modal-intervalo"
                          type="number"
                          min={1}
                          step={1}
                          disabled={guardando}
                          className={INPUT_CLASS}
                          value={form.intervalo}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, intervalo: e.target.value }))
                          }
                        />
                      </div>
                    </div>

                    {form.frecuencia === 'SEMANAL' && (
                      <div>
                        <p className={LABEL_CLASS}>Días</p>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {DIAS_SEMANA_LABEL.map((label, dia) => (
                            <label
                              key={dia}
                              className="flex items-center gap-1 rounded border border-mist px-2 py-1 text-sm text-slate/80"
                            >
                              <input
                                type="checkbox"
                                disabled={guardando}
                                checked={form.diasSemana.includes(dia)}
                                onChange={() => toggleDiaSemana(dia)}
                              />
                              {label}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    {form.frecuencia === 'MENSUAL' && (
                      <div>
                        <label htmlFor="evento-modal-dia-mes" className={LABEL_CLASS}>
                          Día del mes
                        </label>
                        <input
                          id="evento-modal-dia-mes"
                          type="number"
                          min={1}
                          max={31}
                          disabled={guardando || form.ultimoDiaMes}
                          className={INPUT_CLASS}
                          value={form.diaMes}
                          onChange={(e) => setForm((f) => ({ ...f, diaMes: e.target.value }))}
                        />
                        <label className="mt-2 flex items-center gap-2 text-sm text-slate/80">
                          <input
                            type="checkbox"
                            disabled={guardando}
                            checked={form.ultimoDiaMes}
                            onChange={(e) =>
                              setForm((f) => ({ ...f, ultimoDiaMes: e.target.checked }))
                            }
                          />
                          Último día del mes
                        </label>
                      </div>
                    )}

                    <div>
                      <label htmlFor="evento-modal-recurrencia-hasta" className={LABEL_CLASS}>
                        Repetir hasta
                      </label>
                      <input
                        id="evento-modal-recurrencia-hasta"
                        type="date"
                        required={form.seRepite}
                        disabled={guardando}
                        className={INPUT_CLASS}
                        value={form.recurrenciaHasta}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, recurrenciaHasta: e.target.value }))
                        }
                      />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-slate/70">
                Este evento es recurrente. La regla de recurrencia no se puede editar desde
                este formulario (el calendario no guarda los detalles completos de la serie
                acá, solo la ocurrencia del día que abriste) — si necesitas cambiarla, elimina
                el evento y créalo de nuevo.
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              {!esAlta && onEliminar && (
                <button
                  type="button"
                  onClick={onEliminar}
                  disabled={guardando}
                  className="rounded-lg border border-crimson px-4 py-2 text-sm font-medium text-crimson hover:bg-crimson/10 disabled:opacity-50"
                >
                  Eliminar evento
                </button>
              )}
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onCancelar}
                disabled={guardando}
                className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={guardando}
                className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
              >
                {guardando ? 'Guardando…' : esAlta ? 'Crear evento' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
