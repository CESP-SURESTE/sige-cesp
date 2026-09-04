'use client';

import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  SkeletonLines,
  SkeletonStatTiles,
} from '@/components/admin/ui/Skeleton';
import { ApiError } from '@/lib/api/http';
import { obtenerResumenAdmin, type ResumenAdmin } from '@/lib/api/dashboard';
import {
  listarEventosSede,
  type AlcanceDestino,
  type CategoriaEvento,
  type EventoListadoItem,
} from '@/lib/api/calendario';
import { Select } from '@/components/admin/ui/persona-alta/Select';
import { Paginacion } from '@/components/admin/ui/personas-listado/Paginacion';
import { CATEGORIA_LABEL, COLOR_POR_CATEGORIA } from './calendario/colores';

/**
 * Dashboard de admin — reemplaza el placeholder de 3 botones "dar de alta"
 * (esa navegación ya vive de forma permanente en el sidebar, mantenerla acá
 * también era redundante — decisión ya tomada, ver historial de este
 * archivo). Consume `GET /personas/resumen` (`lib/api/dashboard.ts`).
 *
 * Mismo patrón `isLoading`/`isError`/estado vacío que `app/admin/alumnos/page.tsx`
 * y `app/admin/maestros/page.tsx` — sin librería de gráficas, las barras de
 * "Alumnos por carrera" son un `<div>` con `width` proporcional al máximo del
 * set (CSS puro).
 *
 * `SeccionEventosSede` (Fase 15 polish, 2026-09-02) se monta SIEMPRE bajo el
 * resumen — no depende de que `GET /personas/resumen` haya cargado. Consume
 * `GET /eventos/listado` (`lib/api/calendario.ts`, `listarEventosSede`).
 */
export default function AdminHomePage() {
  const {
    data: resumen,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['admin', 'resumen'],
    queryFn: async () => {
      try {
        return await obtenerResumenAdmin();
      } catch (err) {
        // Regla 12 de `CLAUDE.md` raíz — loguear antes de dejar que React
        // Query marque `isError` y la UI muestre el mensaje genérico.
        console.error('[AdminHomePage] Error al obtener el resumen:', err);
        throw err;
      }
    },
  });

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-semibold text-navy">
        Panel administrativo
      </h1>

      {isLoading ? (
        <div className="space-y-6">
          <SkeletonStatTiles count={4} />
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-lg border-l-4 border-navy bg-white p-4 shadow-sm">
              <SkeletonLines count={4} />
            </div>
            <div className="rounded-lg border-l-4 border-navy bg-white p-4 shadow-sm">
              <SkeletonLines count={4} />
            </div>
          </div>
        </div>
      ) : isError ? (
        <p className="rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-crimson">
          {error instanceof ApiError
            ? error.message
            : 'No se pudo cargar el resumen. Intenta de nuevo más tarde.'}
        </p>
      ) : !resumen ? null : (
        <ResumenDashboard resumen={resumen} />
      )}

      <SeccionEventosSede />
    </div>
  );
}

function ResumenDashboard({ resumen }: { resumen: ResumenAdmin }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <TarjetaKpi valor={resumen.totalAlumnosActivos} etiqueta="Alumnos activos" />
        <TarjetaKpi valor={resumen.totalMaestrosActivos} etiqueta="Maestros activos" />
        <TarjetaKpi
          valor={resumen.totalAdministrativosActivos}
          etiqueta="Administrativos activos"
        />
        <TarjetaKpi valor={resumen.totalCarreras} etiqueta="Carreras activas" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border-l-4 border-navy bg-white p-4 shadow-sm">
          <h2 className="font-display text-lg font-semibold text-navy">
            Alumnos por carrera
          </h2>
          <div className="mt-4">
            {resumen.alumnosPorCarrera.length === 0 ? (
              <p className="text-sm text-slate/60">Sin datos todavía.</p>
            ) : (
              <AlumnosPorCarreraLista items={resumen.alumnosPorCarrera} />
            )}
          </div>
        </div>

        <div className="rounded-lg border-l-4 border-navy bg-white p-4 shadow-sm">
          <h2 className="font-display text-lg font-semibold text-navy">
            Altas recientes
          </h2>
          <div className="mt-4">
            {resumen.altasRecientes.length === 0 ? (
              <p className="text-sm text-slate/60">Sin datos todavía.</p>
            ) : (
              <AltasRecientesLista items={resumen.altasRecientes} />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function TarjetaKpi({ valor, etiqueta }: { valor: number; etiqueta: string }) {
  return (
    <div className="rounded-lg border-l-4 border-navy bg-white p-4 shadow-sm">
      <p className="font-display text-3xl font-semibold text-navy">{valor}</p>
      <p className="mt-1 text-xs uppercase tracking-wide text-slate/60">
        {etiqueta}
      </p>
    </div>
  );
}

function AlumnosPorCarreraLista({
  items,
}: {
  items: ResumenAdmin['alumnosPorCarrera'];
}) {
  const max = Math.max(...items.map((item) => item.cantidad));

  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.carreraId}>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate">{item.nombre}</span>
            <span className="font-medium text-navy">{item.cantidad}</span>
          </div>
          <div className="mt-1 h-2 w-full rounded-full bg-mist">
            <div
              className="h-2 rounded-full bg-navy"
              style={{ width: `${(item.cantidad / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

const ROL_LABEL: Record<ResumenAdmin['altasRecientes'][number]['rol'], string> = {
  ALUMNO: 'Alumno',
  MAESTRO: 'Maestro',
  ADMINISTRATIVO: 'Administrativo',
};

function AltasRecientesLista({
  items,
}: {
  items: ResumenAdmin['altasRecientes'];
}) {
  return (
    <ul className="divide-y divide-mist">
      {items.map((item) => (
        <li
          key={item.usuarioId}
          className="flex items-center justify-between gap-3 py-2 text-sm"
        >
          <span className="text-slate">{item.nombreCompleto}</span>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-bone px-2 py-0.5 text-xs font-medium text-navy">
              {ROL_LABEL[item.rol]}
            </span>
            <span className="text-xs text-slate/60">
              {new Date(item.fecha).toLocaleDateString('es-MX')}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Sección «Eventos de la sede» — Fase 15 polish (2026-09-02)                 */
/* -------------------------------------------------------------------------- */

type RangoEventos = '30' | '60' | '90' | 'todos';

const LIMITE_EVENTOS = 20;

const RANGO_OPTIONS: { value: RangoEventos; label: string }[] = [
  { value: '30', label: 'Próximos 30 días' },
  { value: '60', label: 'Próximos 60 días' },
  { value: '90', label: 'Próximos 90 días' },
  { value: 'todos', label: 'Todos' },
];

const ALCANCE_LABEL: Record<AlcanceDestino, string> = {
  SEDE: 'Toda la sede',
  CARRERA: 'Una carrera',
  GRUPO: 'Un grupo',
};

const ALCANCE_OPTIONS = [
  { value: '', label: 'Todos los alcances' },
  ...(Object.entries(ALCANCE_LABEL) as [AlcanceDestino, string][]).map(
    ([value, label]) => ({ value, label }),
  ),
];

const CATEGORIA_OPTIONS = [
  { value: '', label: 'Todas las categorías' },
  ...(Object.entries(CATEGORIA_LABEL) as [CategoriaEvento, string][]).map(
    ([value, label]) => ({ value, label }),
  ),
];

/** Fecha de hoy en `YYYY-MM-DD`, en horario local (sin corrimiento a UTC —
 * `toISOString()` daría el día equivocado de noche en zonas UTC-negativas
 * como México). */
function fechaISOhoy(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Suma `dias` naturales a una fecha `YYYY-MM-DD` y devuelve `YYYY-MM-DD`.
 * Aritmética con `Date` local (el constructor normaliza el desborde de mes),
 * sin librería. */
function sumarDiasISO(iso: string, dias: number): string {
  const [anio, mes, dia] = iso.split('-').map(Number);
  const d = new Date(anio, mes - 1, dia + dias);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function formatearFecha(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('es-MX');
}

function formatearFechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-MX');
}

function SeccionEventosSede() {
  const [rango, setRango] = useState<RangoEventos>('30');
  const [alcanceTipo, setAlcanceTipo] = useState<AlcanceDestino | ''>('');
  const [categoria, setCategoria] = useState<CategoriaEvento | ''>('');
  const [page, setPage] = useState(1);
  const [expandidoId, setExpandidoId] = useState<string | null>(null);

  // "Todos" = sin límites: ni `desde` ni `hasta`. Cualquier otro rango
  // acota desde hoy hasta hoy + N días.
  const esRangoTodos = rango === 'todos';
  const hoy = fechaISOhoy();
  const desde = esRangoTodos ? undefined : hoy;
  const hasta = esRangoTodos ? undefined : sumarDiasISO(hoy, Number(rango));

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'eventos-sede', rango, alcanceTipo, categoria, page],
    queryFn: async () => {
      try {
        return await listarEventosSede({
          desde,
          hasta,
          alcanceTipo: alcanceTipo || undefined,
          categoria: categoria || undefined,
          page,
          limit: LIMITE_EVENTOS,
        });
      } catch (err) {
        // Regla 12 de `CLAUDE.md` raíz.
        console.error(
          '[SeccionEventosSede] Error al listar eventos de la sede:',
          err,
        );
        throw err;
      }
    },
    placeholderData: keepPreviousData,
  });

  function alCambiarFiltro<T>(setter: (valor: T) => void) {
    return (valor: T) => {
      setter(valor);
      setPage(1);
    };
  }

  const eventos = data?.data ?? [];

  return (
    <div className="rounded-lg border-l-4 border-navy bg-white p-4 shadow-sm">
      <h2 className="font-display text-lg font-semibold text-navy">
        Eventos de la sede
      </h2>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Select
          id="eventos-sede-rango"
          value={rango}
          onChange={alCambiarFiltro((v: string) => setRango(v as RangoEventos))}
          options={RANGO_OPTIONS}
          placeholder="Rango"
        />
        <Select
          id="eventos-sede-alcance"
          value={alcanceTipo}
          onChange={alCambiarFiltro((v: string) =>
            setAlcanceTipo(v as AlcanceDestino | ''),
          )}
          options={ALCANCE_OPTIONS}
          placeholder="Alcance"
        />
        <Select
          id="eventos-sede-categoria"
          value={categoria}
          onChange={alCambiarFiltro((v: string) =>
            setCategoria(v as CategoriaEvento | ''),
          )}
          options={CATEGORIA_OPTIONS}
          placeholder="Categoría"
        />
      </div>

      <div className="mt-4">
        {isLoading ? (
          <SkeletonLines count={5} />
        ) : isError ? (
          <p className="rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-crimson">
            {error instanceof ApiError
              ? error.message
              : 'No se pudieron cargar los eventos. Intenta de nuevo más tarde.'}
          </p>
        ) : eventos.length === 0 ? (
          <p className="text-sm text-slate/60">No hay eventos con estos filtros.</p>
        ) : (
          <>
            <ul className="divide-y divide-mist rounded-lg border border-mist">
              {eventos.map((evento) => (
                <li key={evento.id}>
                  <FilaEvento
                    evento={evento}
                    expandido={expandidoId === evento.id}
                    onToggle={() =>
                      setExpandidoId((actual) =>
                        actual === evento.id ? null : evento.id,
                      )
                    }
                  />
                </li>
              ))}
            </ul>
            {data && data.total > 0 && (
              <div className="mt-4">
                <Paginacion
                  page={data.page}
                  limit={data.limit}
                  total={data.total}
                  onPageChange={setPage}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FilaEvento({
  evento,
  expandido,
  onToggle,
}: {
  evento: EventoListadoItem;
  expandido: boolean;
  onToggle: () => void;
}) {
  const resumenFecha = evento.esRecurrente
    ? `Recurrente · ${evento.recurrenciaResumen ?? 'sin resumen'}`
    : formatearFecha(evento.fechaInicio);

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expandido}
        className="flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-bone/50"
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate">{evento.titulo}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${COLOR_POR_CATEGORIA[evento.categoria]}`}
          >
            {CATEGORIA_LABEL[evento.categoria]}
          </span>
        </span>
        <span className="text-xs text-slate/70">
          {resumenFecha} · {evento.alcanceNombre} · {evento.autorNombre}
        </span>
      </button>

      {expandido && (
        <dl className="grid gap-x-4 gap-y-1 border-t border-mist bg-bone/30 px-4 py-3 text-sm sm:grid-cols-[max-content_1fr]">
          <DetalleFila etiqueta="Descripción">
            {evento.descripcion ?? 'Sin descripción'}
          </DetalleFila>
          <DetalleFila etiqueta="Hora">
            {evento.horaInicio ?? 'Todo el día'}
          </DetalleFila>
          <DetalleFila etiqueta="Fecha de fin">
            {evento.fechaFin ? formatearFecha(evento.fechaFin) : '—'}
          </DetalleFila>
          <DetalleFila etiqueta="Se repite hasta">
            {evento.recurrenciaHasta ? formatearFecha(evento.recurrenciaHasta) : '—'}
          </DetalleFila>
          <DetalleFila etiqueta="Alcance">{evento.alcanceNombre}</DetalleFila>
          <DetalleFila etiqueta="Creado">
            {formatearFechaHora(evento.createdAt)}
          </DetalleFila>
        </dl>
      )}
    </div>
  );
}

function DetalleFila({
  etiqueta,
  children,
}: {
  etiqueta: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="font-medium text-slate/60">{etiqueta}</dt>
      <dd className="text-slate">{children}</dd>
    </>
  );
}
