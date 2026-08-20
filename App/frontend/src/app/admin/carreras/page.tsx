'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { INPUT_CLASS, LABEL_CLASS } from '@/components/admin/ui/persona-alta/estilos';
import {
  MENSAJE_ERROR_GENERICO,
  resolverMensajeError,
} from '@/components/admin/ui/persona-alta/mensajes-error';
import { Select } from '@/components/admin/ui/persona-alta/Select';
import { SubirMallaModal } from './SubirMallaModal';
import { ApiError } from '@/lib/api/http';
import {
  actualizarCarrera,
  crearCarrera,
  listarCarreras,
  type ActualizarCarreraInput,
  type Carrera,
  type CrearCarreraInput,
  type EstatusCarrera,
  type ModalidadCarrera,
  type NivelCarrera,
} from '@/lib/api/carreras';

/**
 * Gestión de carreras — Fase 6, Día 21 (frontend). Backend ya cerrado por
 * QA (`qa-backend`, sin hallazgos bloqueantes) — ver la entrada "Día 21
 * (backend)" en `documentacion_de_agentes/ESTADO.md` para el contrato
 * exacto de `POST`/`GET`/`PATCH /carreras`.
 *
 * Patrón visual/estructura inspirado en `app/plataforma/sedes/page.tsx`
 * (tabla + form inline, un solo `useState` de formulario que alterna entre
 * "nuevo" y "editar" según `editandoId`) — código propio, NO import desde
 * `app/plataforma/` (árbol completamente aislado, regla 11 de `CLAUDE.md`
 * raíz solo prohíbe compartir con alumno/maestro, pero por prudencia
 * tampoco se comparte con plataforma, que es una identidad distinta). Los
 * únicos imports desde fuera de esta página son utilidades genéricas ya
 * existentes en `components/admin/ui/persona-alta/` (`FieldError`,
 * `INPUT_CLASS`/`LABEL_CLASS`, `resolverMensajeError`) — no son específicas
 * de alta de persona, son helpers de formulario/estilo reutilizables dentro
 * del mismo árbol admin (regla 11 solo prohíbe cruzar con alumno/maestro).
 *
 * ACTUALIZADO (2026-08-17): el gap de backend documentado originalmente acá
 * (`GET /carreras` con shape mínimo, edición "a ciegas") ya se corrigió —
 * `GET /carreras` devuelve el objeto `Carrera` completo (ver
 * `lib/api/carreras.ts`), así que el formulario de "Editar" ahora se
 * prellena con los valores reales de la carrera seleccionada
 * (`iniciarEdicion`). `PATCH /carreras/:id` sigue siendo parcial por diseño
 * (campos vacíos = sin cambio no se envían), pero ya no es una edición a
 * ciegas — el admin ve y modifica los valores reales.
 */

const NIVEL_LABEL: Record<NivelCarrera, string> = {
  TECNICO: 'Técnico',
  LICENCIATURA: 'Licenciatura',
  MAESTRIA: 'Maestría',
  DOCTORADO: 'Doctorado',
};

const MODALIDAD_LABEL: Record<ModalidadCarrera, string> = {
  PRESENCIAL: 'Presencial',
  SEMIPRESENCIAL: 'Semipresencial',
  EN_LINEA: 'En línea',
};

const ESTATUS_LABEL: Record<EstatusCarrera, string> = {
  ACTIVA: 'Activa',
  INACTIVA: 'Inactiva',
};

const MENSAJES_ERROR_CARRERA: Record<string, string> = {
  NOT_FOUND: 'Esa carrera ya no existe o no pertenece a tu sede.',
};

/** Formulario de alta — los 6 campos de `CrearCarreraInput`, todos requeridos. */
interface FormNuevo {
  nombre: string;
  clave: string;
  duracion: string;
  nivel: NivelCarrera | '';
  modalidad: ModalidadCarrera | '';
  rvoe: string;
  descripcion: string;
}

const FORM_NUEVO_VACIO: FormNuevo = {
  nombre: '',
  clave: '',
  duracion: '',
  nivel: '',
  modalidad: '',
  rvoe: '',
  descripcion: '',
};

/**
 * Formulario de edición — mismos campos + `estatus`, prellenado con los
 * valores reales de la carrera (`iniciarEdicion`). Los campos se mantienen
 * opcionales a nivel de tipo porque `PATCH /carreras/:id` sigue siendo
 * parcial por diseño — si el admin deja algún campo en blanco (poco
 * probable ya que arranca prellenado), ese campo simplemente no se manda.
 */
interface FormEdicion extends FormNuevo {
  estatus: EstatusCarrera | '';
}

const FORM_EDICION_VACIO: FormEdicion = { ...FORM_NUEVO_VACIO, estatus: '' };

function construirPayloadAlta(form: FormNuevo): CrearCarreraInput | null {
  if (
    !form.nombre.trim() ||
    !form.clave.trim() ||
    !form.duracion.trim() ||
    !form.nivel ||
    !form.modalidad ||
    !form.rvoe.trim() ||
    !form.descripcion.trim()
  ) {
    return null;
  }
  const duracion = Number.parseInt(form.duracion, 10);
  if (!Number.isInteger(duracion) || duracion < 1) return null;

  return {
    nombre: form.nombre.trim(),
    clave: form.clave.trim(),
    duracion,
    nivel: form.nivel,
    modalidad: form.modalidad,
    rvoe: form.rvoe.trim(),
    descripcion: form.descripcion.trim(),
  };
}

/** Solo incluye en el `PATCH` los campos que el admin sí llenó — en blanco = sin cambio. */
function construirPayloadEdicion(form: FormEdicion): ActualizarCarreraInput {
  const payload: ActualizarCarreraInput = {};

  if (form.nombre.trim()) payload.nombre = form.nombre.trim();
  if (form.clave.trim()) payload.clave = form.clave.trim();
  if (form.duracion.trim()) {
    const duracion = Number.parseInt(form.duracion, 10);
    if (Number.isInteger(duracion) && duracion >= 1) payload.duracion = duracion;
  }
  if (form.nivel) payload.nivel = form.nivel;
  if (form.modalidad) payload.modalidad = form.modalidad;
  if (form.rvoe.trim()) payload.rvoe = form.rvoe.trim();
  if (form.descripcion.trim()) payload.descripcion = form.descripcion.trim();
  if (form.estatus) payload.estatus = form.estatus;

  return payload;
}

export default function AdminCarrerasPage() {
  const queryClient = useQueryClient();
  const [formNuevo, setFormNuevo] = useState<FormNuevo>(FORM_NUEVO_VACIO);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [formEdicion, setFormEdicion] = useState<FormEdicion>(FORM_EDICION_VACIO);

  const carrerasQuery = useQuery({
    queryKey: ['admin', 'carreras'],
    queryFn: async () => {
      try {
        return await listarCarreras();
      } catch (err) {
        // Regla 12 de `CLAUDE.md` raíz — loguear antes de dejar que React
        // Query marque `isError`.
        console.error('[AdminCarrerasPage] Error al listar carreras:', err);
        throw err;
      }
    },
  });

  const crearMutation = useMutation({
    mutationFn: (input: CrearCarreraInput) => crearCarrera(input),
    onSuccess: () => {
      toast.success('Carrera creada');
      setFormNuevo(FORM_NUEVO_VACIO);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'carreras'] });
      // También invalida la caché del dropdown de `carreraId` que usa
      // `app/admin/alumnos/nuevo/page.tsx` (`queryKey: ['carreras']`,
      // `lib/api/carreras.ts#listarCarreras`) — misma función, distinto
      // `queryKey` en cada consumidor, así que hay que invalidar ambas
      // explícitamente para que la carrera recién creada aparezca ahí sin
      // recargar la página.
      void queryClient.invalidateQueries({ queryKey: ['carreras'] });
    },
    onError: (err) => {
      console.error('[AdminCarrerasPage] Error al crear carrera:', err);
      toast.error(resolverMensajeError(err, MENSAJES_ERROR_CARRERA) ?? MENSAJE_ERROR_GENERICO);
    },
  });

  const actualizarMutation = useMutation({
    mutationFn: (vars: { id: string; input: ActualizarCarreraInput }) =>
      actualizarCarrera(vars.id, vars.input),
    onSuccess: () => {
      toast.success('Carrera actualizada');
      setEditandoId(null);
      setFormEdicion(FORM_EDICION_VACIO);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'carreras'] });
      void queryClient.invalidateQueries({ queryKey: ['carreras'] });
    },
    onError: (err) => {
      console.error('[AdminCarrerasPage] Error al actualizar carrera:', err);
      toast.error(resolverMensajeError(err, MENSAJES_ERROR_CARRERA) ?? MENSAJE_ERROR_GENERICO);
    },
  });

  const [carreraParaMalla, setCarreraParaMalla] = useState<Carrera | null>(null);

  function handleSubmitNuevo(e: FormEvent) {
    e.preventDefault();
    const payload = construirPayloadAlta(formNuevo);
    if (!payload) {
      toast.error('Revisa que todos los campos estén completos y con formato correcto.');
      return;
    }
    crearMutation.mutate(payload);
  }

  function handleSubmitEdicion(e: FormEvent) {
    e.preventDefault();
    if (!editandoId) return;
    const payload = construirPayloadEdicion(formEdicion);
    actualizarMutation.mutate({ id: editandoId, input: payload });
  }

  function iniciarEdicion(carrera: Carrera) {
    setEditandoId(carrera.id);
    // `GET /carreras` ya trae el objeto completo — prellenamos con los
    // valores reales de la carrera seleccionada, no arranca en blanco.
    setFormEdicion({
      nombre: carrera.nombre,
      clave: carrera.clave,
      duracion: String(carrera.duracion),
      nivel: carrera.nivel,
      modalidad: carrera.modalidad,
      rvoe: carrera.rvoe,
      descripcion: carrera.descripcion,
      estatus: carrera.estatus,
    });
  }

  function cancelarEdicion() {
    setEditandoId(null);
    setFormEdicion(FORM_EDICION_VACIO);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-navy">Carreras</h1>
        <p className="mt-1 text-sm text-slate/60">
          Alta y edición de las carreras de tu sede.
        </p>
      </div>

      {editandoId ? (
        <form
          onSubmit={handleSubmitEdicion}
          className="space-y-4 rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm"
        >
          <h2 className="font-display text-lg font-semibold text-slate">Editar carrera</h2>

          <CamposCarrera
            form={formEdicion}
            onChange={(cambios) => setFormEdicion((f) => ({ ...f, ...cambios }))}
            disabled={actualizarMutation.isPending}
            requerido={false}
          />

          <div>
            <label htmlFor="estatus" className={LABEL_CLASS}>
              Estatus
            </label>
            <Select
              id="estatus"
              disabled={actualizarMutation.isPending}
              value={formEdicion.estatus}
              onChange={(value) =>
                setFormEdicion((f) => ({ ...f, estatus: value as EstatusCarrera | '' }))
              }
              options={[
                { value: '', label: 'Sin cambio' },
                ...(Object.entries(ESTATUS_LABEL) as [EstatusCarrera, string][]).map(
                  ([value, label]) => ({ value, label }),
                ),
              ]}
              placeholder="Sin cambio"
            />
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={actualizarMutation.isPending}
              className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
            >
              {actualizarMutation.isPending ? 'Guardando…' : 'Guardar cambios'}
            </button>
            <button
              type="button"
              onClick={cancelarEdicion}
              disabled={actualizarMutation.isPending}
              className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30 disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <form
          onSubmit={handleSubmitNuevo}
          className="space-y-4 rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm"
        >
          <h2 className="font-display text-lg font-semibold text-slate">Nueva carrera</h2>

          <CamposCarrera
            form={formNuevo}
            onChange={(cambios) => setFormNuevo((f) => ({ ...f, ...cambios }))}
            disabled={crearMutation.isPending}
            requerido
          />

          <button
            type="submit"
            disabled={crearMutation.isPending}
            className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
          >
            {crearMutation.isPending ? 'Guardando…' : 'Crear carrera'}
          </button>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border-l-4 border-navy bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-mist text-left text-slate/60">
              <th className="px-4 py-3 font-medium">Nombre</th>
              <th className="px-4 py-3 font-medium">Clave</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {carrerasQuery.isLoading && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-slate/60">
                  Cargando…
                </td>
              </tr>
            )}
            {carrerasQuery.isError && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-crimson">
                  {carrerasQuery.error instanceof ApiError
                    ? carrerasQuery.error.message
                    : 'No se pudo cargar el listado de carreras. Intenta de nuevo más tarde.'}
                </td>
              </tr>
            )}
            {!carrerasQuery.isLoading &&
              !carrerasQuery.isError &&
              carrerasQuery.data?.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-slate/60">
                    Todavía no hay carreras registradas en tu sede.
                  </td>
                </tr>
              )}
            {carrerasQuery.data?.map((carrera) => (
              <tr key={carrera.id} className="border-b border-mist last:border-0">
                <td className="px-4 py-3 text-slate">{carrera.nombre}</td>
                <td className="px-4 py-3 text-slate/80">{carrera.clave}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => setCarreraParaMalla(carrera)}
                    className="mr-4 text-navy hover:underline"
                  >
                    {carrera.tieneMalla && (
                      <span className="mr-1 text-success">✓</span>
                    )}
                    Subir malla
                  </button>
                  <button
                    onClick={() => iniciarEdicion(carrera)}
                    className="text-navy hover:underline"
                  >
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {carreraParaMalla && (
        <SubirMallaModal
          carrera={carreraParaMalla}
          onClose={() => setCarreraParaMalla(null)}
          onSubidoConExito={() => {
            toast.success('Malla curricular actualizada');
            void queryClient.invalidateQueries({ queryKey: ['admin', 'carreras'] });
          }}
        />
      )}
    </div>
  );
}

/**
 * Campos comunes entre "Nueva carrera" y "Editar carrera" — `requerido`
 * controla si se marcan como `required` (alta) o no (edición, ver GAP de
 * cabecera: en blanco = sin cambio, no se puede forzar `required` ahí).
 */
function CamposCarrera({
  form,
  onChange,
  disabled,
  requerido,
}: {
  form: FormNuevo;
  onChange: (cambios: Partial<FormNuevo>) => void;
  disabled: boolean;
  requerido: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor="nombre" className={LABEL_CLASS}>
          Nombre
        </label>
        <input
          id="nombre"
          type="text"
          required={requerido}
          disabled={disabled}
          className={INPUT_CLASS}
          value={form.nombre}
          onChange={(e) => onChange({ nombre: e.target.value })}
        />
      </div>
      <div>
        <label htmlFor="clave" className={LABEL_CLASS}>
          Clave
        </label>
        <input
          id="clave"
          type="text"
          required={requerido}
          disabled={disabled}
          className={INPUT_CLASS}
          value={form.clave}
          onChange={(e) => onChange({ clave: e.target.value })}
        />
      </div>
      <div>
        <label htmlFor="duracion" className={LABEL_CLASS}>
          Duración (semestres)
        </label>
        <input
          id="duracion"
          type="number"
          min={1}
          step={1}
          required={requerido}
          disabled={disabled}
          className={INPUT_CLASS}
          value={form.duracion}
          onChange={(e) => onChange({ duracion: e.target.value })}
        />
      </div>
      <div>
        <label htmlFor="rvoe" className={LABEL_CLASS}>
          RVOE
        </label>
        <input
          id="rvoe"
          type="text"
          required={requerido}
          disabled={disabled}
          className={INPUT_CLASS}
          value={form.rvoe}
          onChange={(e) => onChange({ rvoe: e.target.value })}
        />
      </div>
      <div>
        <label htmlFor="nivel" className={LABEL_CLASS}>
          Nivel
        </label>
        <Select
          id="nivel"
          disabled={disabled}
          value={form.nivel}
          onChange={(value) => onChange({ nivel: value as NivelCarrera | '' })}
          options={[
            { value: '', label: requerido ? 'Selecciona un nivel' : 'Sin cambio' },
            ...(Object.entries(NIVEL_LABEL) as [NivelCarrera, string][]).map(([value, label]) => ({
              value,
              label,
            })),
          ]}
          placeholder={requerido ? 'Selecciona un nivel' : 'Sin cambio'}
        />
      </div>
      <div>
        <label htmlFor="modalidad" className={LABEL_CLASS}>
          Modalidad
        </label>
        <Select
          id="modalidad"
          disabled={disabled}
          value={form.modalidad}
          onChange={(value) => onChange({ modalidad: value as ModalidadCarrera | '' })}
          options={[
            { value: '', label: requerido ? 'Selecciona una modalidad' : 'Sin cambio' },
            ...(Object.entries(MODALIDAD_LABEL) as [ModalidadCarrera, string][]).map(
              ([value, label]) => ({ value, label }),
            ),
          ]}
          placeholder={requerido ? 'Selecciona una modalidad' : 'Sin cambio'}
        />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="descripcion" className={LABEL_CLASS}>
          Descripción
        </label>
        <textarea
          id="descripcion"
          rows={3}
          required={requerido}
          disabled={disabled}
          className={INPUT_CLASS}
          value={form.descripcion}
          onChange={(e) => onChange({ descripcion: e.target.value })}
        />
      </div>
    </div>
  );
}
