'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api/http';
import { listarEventos, type OcurrenciaEvento } from '@/lib/api/calendario';
import { SkeletonCalendarGrid } from '@/components/alumno/ui/Skeleton';
import { COLOR_POR_CATEGORIA, DetalleEventoModal } from './DetalleEventoModal';
import { generarGridMensual, rangoDelGrid } from './mes-grid.util';

/**
 * Vista mensual de calendario — árbol ALUMNO, Fase 15, Día 44 (Task 10).
 * Copia estructural de `app/maestro/calendario/page.tsx` (Task 9), reducida
 * a solo lectura: sin `useMutation`, sin botón "+ Nuevo evento", sin
 * `ConfirmarEliminarEventoModal` — el alumno nunca crea/edita/elimina
 * eventos (`CalendarioService`, backend, ya lo restringe así). Click en un
 * chip abre `DetalleEventoModal` en modo lectura, `onCerrar` es la única
 * acción disponible.
 *
 * El backend ya filtra `GET /eventos` según el JWT del alumno
 * (`CalendarioService.obtenerPropioODeSede`, Días 40-41): un alumno ve los
 * eventos de su sede/carrera/grupo(s), sin necesidad de mandar ningún
 * filtro desde acá.
 *
 * `mesActual` es el único estado de navegación; `rangoDelGrid` siempre
 * cubre 42 días (6 semanas), muy por debajo del tope de 62 días que valida
 * `CalendarioService.listar` — nunca dispara ese `VALIDATION_ERROR`.
 */

interface MesActual {
  anio: number;
  mesIndiceCero: number;
}

function mesActualDeHoy(): MesActual {
  const hoy = new Date();
  return { anio: hoy.getFullYear(), mesIndiceCero: hoy.getMonth() };
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

/**
 * Lista completa de eventos de un día — se abre desde el indicador "+N más"
 * de una celda cuando hay más eventos de los que caben. Antes ese indicador
 * era un `<p>` inerte (sin click ni acceso por teclado); ahora es un
 * `<button>` que abre este modal chico con el resto de los eventos del día,
 * cada uno abriendo a su vez `DetalleEventoModal` al hacer click. Mismo
 * patrón de cierre (Escape + click en overlay) que `DetalleEventoModal`.
 */
interface EventosDelDiaModalProps {
  fecha: string;
  eventos: OcurrenciaEvento[];
  onSeleccionar: (evento: OcurrenciaEvento) => void;
  onCerrar: () => void;
}

function EventosDelDiaModal({ fecha, eventos, onSeleccionar, onCerrar }: EventosDelDiaModalProps) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCerrar();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCerrar]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate/40 p-4"
      onClick={onCerrar}
    >
      <div
        className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-lg bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg font-semibold text-slate">
          Eventos del {Number(fecha.slice(8, 10))}
        </h2>
        <div className="mt-4 space-y-1.5">
          {eventos.map((evento) => (
            <button
              key={`${evento.eventoId}-${evento.fecha}`}
              type="button"
              onClick={() => onSeleccionar(evento)}
              className={[
                'block w-full truncate rounded px-2 py-1.5 text-left text-sm font-medium',
                COLOR_POR_CATEGORIA[evento.categoria],
              ].join(' ')}
            >
              {evento.horaInicio ? `${evento.horaInicio} ` : ''}
              {evento.titulo}
            </button>
          ))}
        </div>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-slate hover:bg-mist/30"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AlumnoCalendarioPage() {
  const [mesActual, setMesActual] = useState<MesActual>(mesActualDeHoy);
  const [eventoSeleccionado, setEventoSeleccionado] = useState<OcurrenciaEvento | null>(null);
  const [diaExpandido, setDiaExpandido] = useState<string | null>(null);

  const rango = rangoDelGrid(mesActual.anio, mesActual.mesIndiceCero);

  const eventosQuery = useQuery({
    queryKey: ['alumno', 'calendario', 'eventos', mesActual.anio, mesActual.mesIndiceCero],
    queryFn: async () => {
      try {
        return await listarEventos(rango.desde, rango.hasta);
      } catch (err) {
        // Regla 12 de `CLAUDE.md` raíz.
        console.error('[AlumnoCalendarioPage] Error al listar eventos:', err);
        throw err;
      }
    },
    placeholderData: keepPreviousData,
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
      <div className="rounded-lg border-l-4 border-navy bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-navy">Calendario</h1>
        <p className="mt-1 text-sm text-slate/60">
          Eventos, exámenes y avisos de tu sede, carrera y grupo.
        </p>
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
                    {visibles.map((ocurrencia) => (
                      <button
                        key={`${ocurrencia.eventoId}-${ocurrencia.fecha}`}
                        type="button"
                        onClick={() => setEventoSeleccionado(ocurrencia)}
                        title={ocurrencia.titulo}
                        className={[
                          'block w-full truncate rounded px-1.5 py-0.5 text-left text-xs font-medium',
                          COLOR_POR_CATEGORIA[ocurrencia.categoria],
                        ].join(' ')}
                      >
                        {ocurrencia.horaInicio ? `${ocurrencia.horaInicio} ` : ''}
                        {ocurrencia.titulo}
                      </button>
                    ))}
                    {restantes > 0 && (
                      <button
                        type="button"
                        onClick={() => setDiaExpandido(celda.fecha)}
                        className="block w-full px-1.5 text-left text-xs text-slate/50 hover:text-slate hover:underline"
                      >
                        +{restantes} más
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {eventoSeleccionado && (
        <DetalleEventoModal
          evento={eventoSeleccionado}
          onCerrar={() => setEventoSeleccionado(null)}
        />
      )}

      {diaExpandido && (
        <EventosDelDiaModal
          fecha={diaExpandido}
          eventos={ocurrenciasPorFecha.get(diaExpandido) ?? []}
          onSeleccionar={(evento) => {
            setDiaExpandido(null);
            setEventoSeleccionado(evento);
          }}
          onCerrar={() => setDiaExpandido(null)}
        />
      )}
    </div>
  );
}
