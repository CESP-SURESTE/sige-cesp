import { platformFetchPaginated } from './platform-http';

export type AccionAuditoria =
  | 'ALTA'
  | 'BAJA'
  | 'EDICION'
  | 'CAMBIO_PERMISO'
  | 'CAMBIO_ESTATUS'
  | 'ELIMINACION'
  | 'CONSULTA_EMERGENCIA';

export const ACCIONES_AUDITORIA: AccionAuditoria[] = [
  'ALTA',
  'BAJA',
  'EDICION',
  'CAMBIO_PERMISO',
  'CAMBIO_ESTATUS',
  'ELIMINACION',
  'CONSULTA_EMERGENCIA',
];

/** Los 13 valores reales de `RegistroAuditoria.entidad` que escriben los
 * services hoy (grep en App/backend/src). El backend NO valida contra esta
 * lista — si aparece una entidad nueva, agrégala aquí para que salga en el
 * dropdown, sin cambio de backend. */
export const ENTIDADES_AUDITABLES = [
  'Usuario',
  'Sede',
  'Carrera',
  'Salon',
  'Grupo',
  'GrupoAlumno',
  'GrupoMateriaMaestro',
  'Materia',
  'MallaCurricular',
  'Aviso',
  'EventoCalendario',
  'TelefonoEmergenciaSede',
  'ExpedienteEmergencia',
] as const;

export type ActorTipo = 'USUARIO' | 'PLATAFORMA';
export type RolUsuario = 'ALUMNO' | 'MAESTRO' | 'ADMINISTRATIVO';

export interface RegistroAuditoriaItem {
  id: string;
  fecha: string;
  accion: AccionAuditoria;
  entidad: string;
  entidadId: string;
  actor: {
    id: string;
    tipo: ActorTipo;
    nombre: string;
    rol: RolUsuario | null;
  };
  sede: { id: string; nombre: string } | null;
  detalle: unknown | null;
}

export interface FiltrosAuditoria {
  sedeId?: string;
  accion?: AccionAuditoria;
  entidad?: string;
  actorId?: string;
  desde?: string;
  hasta?: string;
  page?: number;
  limit?: number;
}

export interface ListaAuditoria {
  data: RegistroAuditoriaItem[];
  page: number;
  limit: number;
  total: number;
}

export function listarAuditoria(
  filtros: FiltrosAuditoria,
): Promise<ListaAuditoria> {
  const qs = new URLSearchParams();
  if (filtros.sedeId) qs.set('sedeId', filtros.sedeId);
  if (filtros.accion) qs.set('accion', filtros.accion);
  if (filtros.entidad) qs.set('entidad', filtros.entidad);
  if (filtros.actorId) qs.set('actorId', filtros.actorId);
  if (filtros.desde) qs.set('desde', filtros.desde);
  if (filtros.hasta) qs.set('hasta', filtros.hasta);
  if (filtros.page) qs.set('page', String(filtros.page));
  if (filtros.limit) qs.set('limit', String(filtros.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return platformFetchPaginated<RegistroAuditoriaItem>(
    `/platform-admin/auditoria${suffix}`,
  );
}
