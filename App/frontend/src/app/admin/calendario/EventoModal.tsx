'use client';

import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { LABEL_CLASS, INPUT_CLASS } from '@/components/admin/ui/persona-alta/estilos';
import { Select } from '@/components/admin/ui/persona-alta/Select';
import { listarCarreras } from '@/lib/api/carreras';
import { listarGrupos } from '@/lib/api/grupos';
import { CATEGORIA_LABEL } from './colores';
import type {
  ActualizarEventoInput,
  AlcanceDestino,
  CategoriaEvento,
  CrearEventoInput,
  OcurrenciaEvento,
  ReglaRecurrencia,
} from '@/lib/api/calendario';

/**
 * Modal único de alta+edición de evento de calendario — Fase 15, Día 43
 * (Task 8, árbol admin). Patrón calcado de `app/admin/carreras/CarreraModal.tsx`
 * (regla 13 de `CLAUDE.md` raíz): un componente, `evento: OcurrenciaEvento |
 * null` decide el modo (`null` = alta), la página es dueña de las 2
 * mutations y este modal solo arma el payload correcto.
 *
 * DECISIÓN DE DISEÑO (pedida explícitamente en el brief de esta tarea):
 * la edición usa `OcurrenciaEvento` (lo que YA devuelve `GET /eventos`, lo
 * único que `page.tsx` tiene a mano al hacer click en un chip del grid) en
 * vez de agregar un `GET /eventos/:id` nuevo. Esto es SUFICIENTE para
 * eventos no recurrentes (`esRecurrente: false`): `expandirOcurrencias`
 * (`recurrencia.util.ts`, backend) devuelve exactamente `fechaInicio` como
 * única ocurrencia cuando no hay `recurrenciaRegla`, así que
 * `OcurrenciaEvento.fecha === EventoCalendario.fechaInicio` en ese caso —
 * no hay pérdida de información.
 *
 * NO es suficiente para eventos RECURRENTES: `OcurrenciaEvento` solo trae
 * `esRecurrente: boolean` (no la regla real — `frecuencia`/`intervalo`/
 * `diasSemana`/`diaMes`/`recurrenciaHasta`) y `fecha` ahí es la fecha de
 * ESA ocurrencia puntual, no necesariamente el `fechaInicio` real de la
 * serie (ej. la 3ª ocurrencia de un evento semanal). Reconstruir/reenviar
 * esos campos con datos incompletos podría correr toda la serie o
 * corromper la recurrencia. Por eso, cuando `evento.esRecurrente` es
 * `true`, este modal:
 * - Deshabilita `fechaInicio` (se muestra pero no se puede editar ni se
 *   reenvía en el `PATCH`).
 * - Reemplaza el bloque de recurrencia editable por un aviso informativo
 *   — no se puede cambiar la regla desde acá; hay que borrar el evento y
 *   crearlo de nuevo si se necesita otra recurrencia.
 * Para un evento NO recurrente en modo edición, el bloque "Se repite" se
 * comporta igual que en alta (permite agregarle recurrencia por primera
 * vez).
 *
 * A diferencia de `CarreraModal` (que en edición solo envía los campos que
 * el admin llenó, "en blanco = sin cambio"), acá SIEMPRE se reenvían los
 * valores completos de los campos editables — es más simple y seguro
 * porque el formulario ya parte de los valores reales (no hay ambigüedad
 * de "¿vino vacío porque no cambió, o porque lo quiere vaciar?"). El
 * backend (`CalendarioService.actualizar`) ya no audita si no hay cambios
 * reales (`hayCambiosReales`), así que reenviar sin cambios es inofensivo.
 *
 * `descripcion`/`alcanceId`/`horaInicio`/`fechaFin`: el backend requiere
 * `null` explícito para "limpiar" un valor existente (`ActualizarEventoDto`
 * usa `@IsOptional()`, que en `class-validator` deja pasar tanto `undefined`
 * como `null` sin validar — `undefined` significa "sin cambio", `null`
 * significa "bórralo"). `ActualizarEventoInput` (`lib/api/calendario.ts`) ya
 * modela ese `null` en cada campo (mapped type con `| null`), así que estos
 * 4 campos se asignan directo con el patrón `valor || null` sin casteo.
 * Ejemplo real: si el admin cambia `alcanceTipo` de CARRERA a SEDE sin
 * mandar `alcanceId: null`, `CalendarioService.actualizar` conserva el
 * `alcanceId` viejo y `validarAlcancePublicacion` lo rechaza con
 * `400 VALIDATION_ERROR` ("alcanceId no debe enviarse cuando alcanceTipo
 * es SEDE"). Otro ejemplo real (fix round 1/5, encontrado por QA): un
 * evento sin descripción tiene `existente.descripcion === null`; mandar
 * `descripcion: ''` (en vez de `null`) al reenviar el valor completo del
 * form dispara `hayCambiosReales` (`'' !== null`) aunque el admin no haya
 * tocado nada, sobreescribiendo el `null` real y auditando una `EDICION`
 * espuria.
 */

// `CATEGORIA_LABEL` y `COLOR_POR_CATEGORIA` viven ahora en `./colores` (sin
// JSX) para que el dashboard (`app/admin/page.tsx`) los comparta sin importar
// desde este componente `'use client'`. Ver `colores.ts`.

const ALCANCE_LABEL: Record<AlcanceDestino, string> = {
  SEDE: 'Toda la sede',
  CARRERA: 'Una carrera',
  GRUPO: 'Un grupo',
};

const FRECUENCIA_LABEL: Record<ReglaRecurrencia['frecuencia'], string> = {
  DIARIA: 'Diaria',
  SEMANAL: 'Semanal',
  MENSUAL: 'Mensual',
};

const DIAS_SEMANA_LABEL = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

interface FormEvento {
  titulo: string;
  descripcion: string;
  fechaInicio: string;
  horaInicio: string;
  todoElDia: boolean;
  fechaFin: string;
  categoria: CategoriaEvento | '';
  alcanceTipo: AlcanceDestino | '';
  alcanceId: string;
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
  alcanceTipo: '',
  alcanceId: '',
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
    alcanceTipo: evento.alcanceTipo,
    alcanceId: evento.alcanceId ?? '',
    seRepite: false,
    frecuencia: '',
    intervalo: '1',
    diasSemana: [],
    diaMes: '',
    ultimoDiaMes: false,
    recurrenciaHasta: '',
  };
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
  if (!form.titulo.trim() || !form.fechaInicio || !form.categoria || !form.alcanceTipo) {
    return null;
  }
  if (form.alcanceTipo !== 'SEDE' && !form.alcanceId) return null;

  const payload: CrearEventoInput = {
    titulo: form.titulo.trim(),
    fechaInicio: form.fechaInicio,
    categoria: form.categoria,
    alcanceTipo: form.alcanceTipo,
  };
  if (form.descripcion.trim()) payload.descripcion = form.descripcion.trim();
  if (!form.todoElDia && form.horaInicio) payload.horaInicio = form.horaInicio;
  if (form.fechaFin && !form.seRepite) payload.fechaFin = form.fechaFin;
  if (form.alcanceTipo !== 'SEDE') payload.alcanceId = form.alcanceId;

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
  if (!form.titulo.trim() || !form.categoria || !form.alcanceTipo) return null;
  if (form.alcanceTipo !== 'SEDE' && !form.alcanceId) return null;

  const payload: ActualizarEventoInput = {
    titulo: form.titulo.trim(),
    categoria: form.categoria,
    alcanceTipo: form.alcanceTipo,
    // Ver docstring del archivo — `null` explícito es "bórralo", `undefined` es "sin cambio".
    // `descripcion` sigue el mismo patrón: `''` (trim vacío) se manda como `null`,
    // no como string vacío — de lo contrario, editar un evento SIN descripción
    // (`existente.descripcion === null`) reenviaría `''`, que `hayCambiosReales`
    // detecta como cambio real (`'' !== null`) aunque el admin no haya tocado nada,
    // sobreescribiendo el `null` guardado y generando una auditoría `EDICION`
    // espuria (hallazgo de fix round 1/5).
    descripcion: form.descripcion.trim() || null,
    alcanceId: form.alcanceTipo === 'SEDE' ? null : form.alcanceId,
    horaInicio: form.todoElDia ? null : form.horaInicio || null,
    // Con recurrencia, `fechaFin` no aplica (recurrenciaHasta es el fin real de
    // la serie); se manda null para borrar una que hubiera quedado de antes.
    // En edición de un recurrente ya existente `recurrenciaEditable` es false y
    // el bloque «Se repite» no se muestra: ahí `form.seRepite` es false y este
    // ternario cae en `form.fechaFin || null` — que reenvía el valor real del
    // form (cargado desde `formDesdeOcurrencia`), sin cambio.
    fechaFin: form.seRepite ? null : form.fechaFin || null,
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

/** Devuelve el mensaje de error de fechas cruzadas, o null si están OK.
 * Comparación de strings YYYY-MM-DD (lexicográfica = cronológica).
 *
 * `fechaFinEditable` gatea el primer check: en edición de un evento recurrente
 * legado, `form.fechaInicio` es la fecha de la OCURRENCIA clickeada (no el
 * inicio real de la serie) y `fechaFin` suele ser informativa cerca del
 * arranque — comparar ahí bloquearía guardar cualquier cambio (título,
 * categoría…) sin campo visible para corregirlo. Solo se valida cuando el
 * campo «Fecha de fin» está realmente visible/editable. */
function validarFechasCruzadas(form: FormEvento, fechaFinEditable: boolean): string | null {
  if (
    fechaFinEditable &&
    form.fechaInicio &&
    form.fechaFin &&
    form.fechaFin < form.fechaInicio
  ) {
    return 'La fecha de fin no puede ser anterior a la fecha de inicio.';
  }
  if (
    form.seRepite &&
    form.fechaInicio &&
    form.recurrenciaHasta &&
    form.recurrenciaHasta < form.fechaInicio
  ) {
    return 'La fecha de «repetir hasta» no puede ser anterior a la fecha de inicio.';
  }
  return null;
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

  const carrerasQuery = useQuery({
    queryKey: ['admin', 'carreras'],
    queryFn: async () => {
      try {
        return await listarCarreras();
      } catch (err) {
        console.error('[EventoModal] Error al listar carreras:', err);
        throw err;
      }
    },
    enabled: form.alcanceTipo === 'CARRERA',
  });

  const gruposQuery = useQuery({
    queryKey: ['admin', 'grupos', 'catalogo-alcance'],
    queryFn: async () => {
      try {
        return await listarGrupos({ limit: 100 });
      } catch (err) {
        console.error('[EventoModal] Error al listar grupos:', err);
        throw err;
      }
    },
    enabled: form.alcanceTipo === 'GRUPO',
  });

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
    const errorFechas = validarFechasCruzadas(form, recurrenciaEditable && !form.seRepite);
    if (errorFechas) {
      toast.error(errorFechas);
      return;
    }
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
            {recurrenciaEditable && !form.seRepite && (
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
            )}
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
            <div className="mt-2 grid gap-4 sm:grid-cols-2">
              <Select
                id="evento-modal-alcance-tipo"
                disabled={guardando}
                value={form.alcanceTipo}
                onChange={(value) =>
                  setForm((f) => ({
                    ...f,
                    alcanceTipo: value as AlcanceDestino | '',
                    alcanceId: '',
                  }))
                }
                options={[
                  { value: '', label: 'Selecciona un alcance' },
                  ...(Object.entries(ALCANCE_LABEL) as [AlcanceDestino, string][]).map(
                    ([value, label]) => ({ value, label }),
                  ),
                ]}
                placeholder="Selecciona un alcance"
              />

              {form.alcanceTipo === 'CARRERA' && (
                <Select
                  id="evento-modal-alcance-carrera"
                  disabled={guardando || carrerasQuery.isLoading}
                  value={form.alcanceId}
                  onChange={(value) => setForm((f) => ({ ...f, alcanceId: value }))}
                  options={[
                    { value: '', label: 'Selecciona una carrera' },
                    ...(carrerasQuery.data ?? []).map((c) => ({ value: c.id, label: c.nombre })),
                  ]}
                  placeholder="Selecciona una carrera"
                />
              )}

              {form.alcanceTipo === 'GRUPO' && (
                <Select
                  id="evento-modal-alcance-grupo"
                  disabled={guardando || gruposQuery.isLoading}
                  value={form.alcanceId}
                  onChange={(value) => setForm((f) => ({ ...f, alcanceId: value }))}
                  options={[
                    { value: '', label: 'Selecciona un grupo' },
                    ...(gruposQuery.data?.data ?? []).map((g) => ({
                      value: g.id,
                      label: g.nombre,
                    })),
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
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        seRepite: e.target.checked,
                        fechaFin: e.target.checked ? '' : f.fechaFin,
                      }))
                    }
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
