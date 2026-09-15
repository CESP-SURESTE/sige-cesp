'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api/http';
import {
  actualizarEvento,
  crearEvento,
  eliminarEvento,
  listarEventos,
  type ActualizarEventoInput,
  type CrearEventoInput,
  type OcurrenciaEvento,
} from '@/lib/api/calendario';
import { SkeletonCalendarGrid } from '@/components/maestro/ui/Skeleton';
import { COLOR_POR_CATEGORIA, EventoModal } from './EventoModal';
import { ConfirmarEliminarEventoModal } from './ConfirmarEliminarEventoModal';
import { generarGridMensual, rangoDelGrid } from './mes-grid.util';

/**
 * Vista mensual de calendario — árbol MAESTRO, Fase 15, Día 43 (Task 9).
 * Copia estructural de `app/admin/calendario/page.tsx` (Task 8) — regla 11
 * de `CLAUDE.md` raíz, sin import cruzado entre árboles.
 *
 * El backend ya filtra `GET /eventos` según el JWT del maestro
 * (`CalendarioService.obtenerPropioODeSede`, Días 40-41): un maestro ve los
 * eventos de su sede/carrera/grupos + los propios, sin necesidad de mandar
 * ningún filtro de rol desde acá. El botón "+ Nuevo evento" está siempre
 * disponible (un maestro siempre puede crear en alguno de sus grupos
 * asignados, aunque tenga que elegir cuál dentro del modal — ver
 * `EventoModal.tsx` para el caso de un maestro sin ninguna asignación
 * todavía, que solo ve un mensaje informativo en el bloque de alcance).
 *
 * DIFERENCIA respecto al admin sobre mostrar "Editar"/"Eliminar" solo al
 * autor del evento: `OcurrenciaEvento` trae `puedeEditar: boolean` (Fase 15,
 * hallazgo Important — backend: `true` si el actor es autor del evento o un
 * ADMINISTRATIVO de la sede). Un maestro que ve un evento de sede/carrera/de
 * otro maestro lo recibe con `puedeEditar: false`: su chip se renderiza como
 * elemento inerte (no `<button>`), sin acceso al `EventoModal` en modo
 * edición ni, por transición, al `ConfirmarEliminarEventoModal`. Con
 * `puedeEditar: true` el chip abre el modal de edición igual que en admin.
 * La capa de seguridad real sigue en el backend
 * (`CalendarioService.actualizar`/`eliminar` rechazan con `403
 * ROL_NO_AUTORIZADO` a un maestro no-autor, que cae en
 * `MENSAJES_ERROR_EVENTO.ROL_NO_AUTORIZADO`) — ocultar el acceso es solo UX.
 *
 * `mesActual` es el único estado de navegación; `rangoDelGrid` siempre
 * cubre 42 días (6 semanas), muy por debajo del tope de 62 días que valida
 * `CalendarioService.listar` — nunca dispara ese `VALIDATION_ERROR`.
 *
 * El modal de edición recibe la `OcurrenciaEvento` completa que ya vive en
 * el caché de esta misma query (`eventosQuery.data`) — NO se agregó un
 * `GET /eventos/:id` nuevo. Ver el docstring de `EventoModal.tsx` para el
 * detalle completo de por qué eso alcanza (evento no recurrente) y qué
 * queda deliberadamente fuera de alcance (editar la regla de un evento ya
 * recurrente).
 */

interface MesActual {
  anio: number;
  mesIndiceCero: number;
}

function mesActualDeHoy(): MesActual {
  const hoy = new Date();
  return { anio: hoy.getFullYear(), mesIndiceCero: hoy.getMonth() };
}

interface EstadoModalEvento {
  abierto: boolean;
  evento: OcurrenciaEvento | null;
}

const MODAL_CERRADO: EstadoModalEvento = { abierto: false, evento: null };

const MENSAJE_ERROR_GENERICO =
  'Ocurrió un error. Intenta de nuevo más tarde.';

const MENSAJES_ERROR_EVENTO: Record<string, string> = {
  NOT_FOUND: 'Ese evento ya no existe o no pertenece a tu sede.',
  ROL_NO_AUTORIZADO: 'Solo el autor del evento o un administrativo pueden modificarlo.',
};

function resolverMensajeError(err: unknown, mensajes: Record<string, string>): string | null {
  if (err instanceof ApiError && err.code && mensajes[err.code]) {
    return mensajes[err.code];
  }
  return null;
}

const NOMBRE_MES_FORMATTER = new Intl.DateTimeFormat('es-MX', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function nombreDeMes(anio: number, mesIndiceCero: number): string {
  const texto = NOMBRE_MES_FORMATTER.format(new Date(Date.UTC(anio, mesIndiceCero, 1)));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

const DIAS_SEMANA_HEADER = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MAX_CHIPS_POR_CELDA = 3;

export default function MaestroCalendarioPage() {
  const queryClient = useQueryClient();
  const [mesActual, setMesActual] = useState<MesActual>(mesActualDeHoy);
  const [modalEvento, setModalEvento] = useState<EstadoModalEvento>(MODAL_CERRADO);
  const [eventoAEliminar, setEventoAEliminar] = useState<OcurrenciaEvento | null>(null);

  const rango = rangoDelGrid(mesActual.anio, mesActual.mesIndiceCero);

  const eventosQuery = useQuery({
    queryKey: ['maestro', 'calendario', 'eventos', mesActual.anio, mesActual.mesIndiceCero],
    queryFn: async () => {
      try {
        return await listarEventos(rango.desde, rango.hasta);
      } catch (err) {
        // Regla 12 de `CLAUDE.md` raíz.
        console.error('[MaestroCalendarioPage] Error al listar eventos:', err);
        throw err;
      }
    },
    placeholderData: keepPreviousData,
  });

  const crearMutation = useMutation({
    mutationFn: (input: CrearEventoInput) => crearEvento(input),
    onSuccess: () => {
      toast.success('Evento creado');
      setModalEvento(MODAL_CERRADO);
      void queryClient.invalidateQueries({ queryKey: ['maestro', 'calendario', 'eventos'] });
    },
    onError: (err) => {
      console.error('[MaestroCalendarioPage] Error al crear evento:', err);
      if (err instanceof ApiError && err.code === 'VALIDATION_ERROR') {
        toast.error(err.message);
        return;
      }
      toast.error(resolverMensajeError(err, MENSAJES_ERROR_EVENTO) ?? MENSAJE_ERROR_GENERICO);
    },
  });

  const actualizarMutation = useMutation({
    mutationFn: (vars: { id: string; input: ActualizarEventoInput }) =>
      actualizarEvento(vars.id, vars.input),
    onSuccess: () => {
      toast.success('Evento actualizado');
      setModalEvento(MODAL_CERRADO);
      void queryClient.invalidateQueries({ queryKey: ['maestro', 'calendario', 'eventos'] });
    },
    onError: (err) => {
      console.error('[MaestroCalendarioPage] Error al actualizar evento:', err);
      if (err instanceof ApiError && err.code === 'VALIDATION_ERROR') {
        toast.error(err.message);
        return;
      }
      toast.error(resolverMensajeError(err, MENSAJES_ERROR_EVENTO) ?? MENSAJE_ERROR_GENERICO);
    },
  });

  const eliminarMutation = useMutation({
    mutationFn: (id: string) => eliminarEvento(id),
    onSuccess: () => {
      toast.success('Evento eliminado');
      setEventoAEliminar(null);
      void queryClient.invalidateQueries({ queryKey: ['maestro', 'calendario', 'eventos'] });
    },
    onError: (err) => {
      console.error('[MaestroCalendarioPage] Error al eliminar evento:', err);
      toast.error(resolverMensajeError(err, MENSAJES_ERROR_EVENTO) ?? MENSAJE_ERROR_GENERICO);
      setEventoAEliminar(null);
    },
  });

  function irMesAnterior() {
    setMesActual((prev) => {
      const nuevoMes = prev.mesIndiceCero - 1;
      return nuevoMes < 0
        ? { anio: prev.anio - 1, mesIndiceCero: 11 }
        : { anio: prev.anio, mesIndiceCero: nuevoMes };
    });
  }

  function irMesSiguiente() {
    setMesActual((prev) => {
      const nuevoMes = prev.mesIndiceCero + 1;
      return nuevoMes > 11
        ? { anio: prev.anio + 1, mesIndiceCero: 0 }
        : { anio: prev.anio, mesIndiceCero: nuevoMes };
    });
  }

  const ocurrenciasPorFecha = new Map<string, OcurrenciaEvento[]>();
  for (const ocurrencia of eventosQuery.data ?? []) {
    const lista = ocurrenciasPorFecha.get(ocurrencia.fecha) ?? [];
    lista.push(ocurrencia);
    ocurrenciasPorFecha.set(ocurrencia.fecha, lista);
  }

  const celdas = generarGridMensual(mesActual.anio, mesActual.mesIndiceCero);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <div>
          <h1 className="font-display text-2xl font-semibold text-navy">Calendario</h1>
          <p className="mt-1 text-sm text-slate/60">
            Eventos, exámenes y avisos de tu sede.
          </p>
        </div>
        <button
          onClick={() => setModalEvento({ abierto: true, evento: null })}
          className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
        >
          + Nuevo evento
        </button>
      </div>

      <div className="rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={irMesAnterior}
            aria-label="Mes anterior"
            className="rounded-lg border border-mist px-3 py-1.5 text-sm font-medium text-slate hover:bg-mist/30"
          >
            ← Mes anterior
          </button>
          <h2 className="font-display text-lg font-semibold text-slate">
            {nombreDeMes(mesActual.anio, mesActual.mesIndiceCero)}
          </h2>
          <button
            type="button"
            onClick={irMesSiguiente}
            aria-label="Mes siguiente"
            className="rounded-lg border border-mist px-3 py-1.5 text-sm font-medium text-slate hover:bg-mist/30"
          >
            Mes siguiente →
          </button>
        </div>

        {eventosQuery.isLoading && <SkeletonCalendarGrid />}
        {eventosQuery.isError && (
          <p className="mt-6 py-6 text-center text-sm text-crimson">
            {eventosQuery.error instanceof ApiError
              ? eventosQuery.error.message
              : 'No se pudo cargar el calendario. Intenta de nuevo más tarde.'}
          </p>
        )}

        {!eventosQuery.isLoading && !eventosQuery.isError && (
          <div className="mt-4 grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-mist bg-mist text-sm">
            {DIAS_SEMANA_HEADER.map((dia) => (
              <div
                key={dia}
                className="bg-bone px-2 py-2 text-center text-xs font-semibold text-slate/60"
              >
                {dia}
              </div>
            ))}
            {celdas.map((celda) => {
              const ocurrencias = ocurrenciasPorFecha.get(celda.fecha) ?? [];
              const visibles = ocurrencias.slice(0, MAX_CHIPS_POR_CELDA);
              const restantes = ocurrencias.length - visibles.length;

              return (
                <div
                  key={celda.fecha}
                  className={[
                    'min-h-24 bg-white p-1.5',
                    celda.enElMes ? '' : 'bg-bone/50',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'inline-flex size-6 items-center justify-center rounded-full text-xs',
                      celda.esHoy ? 'bg-navy font-semibold text-white' : 'text-slate/70',
                      celda.enElMes ? '' : 'text-slate/30',
                    ].join(' ')}
                  >
                    {Number(celda.fecha.slice(8, 10))}
                  </span>
                  <div className="mt-1 space-y-1">
                    {visibles.map((ocurrencia) => {
                      const claseChip = [
                        'block w-full truncate rounded px-1.5 py-0.5 text-left text-xs font-medium',
                        COLOR_POR_CATEGORIA[ocurrencia.categoria],
                      ].join(' ');
                      const contenidoChip = `${
                        ocurrencia.horaInicio ? `${ocurrencia.horaInicio} ` : ''
                      }${ocurrencia.titulo}`;

                      // `puedeEditar` (backend, Fase 15): solo el autor del
                      // evento o un ADMINISTRATIVO de la sede pueden
                      // editarlo/eliminarlo. Sin permiso, el chip se muestra
                      // pero no abre el modal de edición (ni, por transición,
                      // el de borrado). El backend igual rechaza con 403 —
                      // esto es solo UX.
                      if (!ocurrencia.puedeEditar) {
                        return (
                          <div
                            key={`${ocurrencia.eventoId}-${ocurrencia.fecha}`}
                            title={ocurrencia.titulo}
                            className={claseChip}
                          >
                            {contenidoChip}
                          </div>
                        );
                      }

                      return (
                        <button
                          key={`${ocurrencia.eventoId}-${ocurrencia.fecha}`}
                          type="button"
                          onClick={() => setModalEvento({ abierto: true, evento: ocurrencia })}
                          title={ocurrencia.titulo}
                          className={claseChip}
                        >
                          {contenidoChip}
                        </button>
                      );
                    })}
                    {restantes > 0 && (
                      <p className="px-1.5 text-xs text-slate/50">+{restantes} más</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {modalEvento.abierto && (
        <EventoModal
          evento={modalEvento.evento}
          guardando={crearMutation.isPending || actualizarMutation.isPending}
          onCrear={(payload) => crearMutation.mutate(payload)}
          onEditar={(payload) => {
            const eventoId = modalEvento.evento?.eventoId;
            if (!eventoId) return;
            actualizarMutation.mutate({ id: eventoId, input: payload });
          }}
          onCancelar={() => setModalEvento(MODAL_CERRADO)}
          onEliminar={
            modalEvento.evento
              ? () => {
                  setEventoAEliminar(modalEvento.evento);
                  setModalEvento(MODAL_CERRADO);
                }
              : undefined
          }
        />
      )}

      {eventoAEliminar && (
        <ConfirmarEliminarEventoModal
          eventoId={eventoAEliminar.eventoId}
          titulo={eventoAEliminar.titulo}
          esRecurrente={eventoAEliminar.esRecurrente}
          eliminando={eliminarMutation.isPending}
          onConfirmar={() => eliminarMutation.mutate(eventoAEliminar.eventoId)}
          onCancelar={() => setEventoAEliminar(null)}
        />
      )}
    </div>
  );
}
