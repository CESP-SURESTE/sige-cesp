import { apiFetchAuth, API_URL, ApiError, obtenerAccessToken } from './http';

/**
 * `GET /carreras` — Fase 4, Día 14, extendido en Fase 6 Día 21 (backend,
 * corrección posterior al cierre inicial de QA).
 *
 * Endpoint construido en paralelo por otro agente para desbloquear el
 * dropdown de `carreraId` del formulario de alta de alumno
 * (`app/admin/alumnos/nuevo/page.tsx`). Shape espejo de
 * `App/backend/src/carreras/carreras.service.ts` (`listarPorSede`) —
 * mantener en sync a mano si cambia el backend, mismo criterio que
 * `lib/api/auth.ts` con `LoginResult`.
 *
 * `sedeId` no es un parámetro aquí: el backend lo saca del JWT
 * (`@SedeActual()`, regla 2 de CLAUDE.md raíz), nunca de query/param.
 *
 * ACTUALIZADO (2026-08-17, confirmado leyendo `carreras.service.ts` real —
 * `listarPorSede` ya no tiene `select` limitado, suite e2e completa en
 * verde incluyendo el test de Día 14 actualizado a este shape nuevo):
 * `GET /carreras` ahora devuelve el objeto `Carrera` COMPLETO (mismo shape
 * que `POST`/`PATCH /carreras`, ver `CarreraCompleta` abajo), ya no el
 * shape mínimo `{ id, nombre, clave }` de Día 14. `Carrera` se mantiene
 * como alias de `CarreraCompleta` — el shape mínimo dejó de existir como
 * tal, pero el nombre se conserva para no romper imports existentes
 * (`app/admin/alumnos/nuevo/page.tsx` solo usa `id`/`nombre`/`clave` del
 * resultado, le es indiferente que el objeto traiga más campos).
 */
export type Carrera = CarreraCompleta;

export function listarCarreras(): Promise<Carrera[]> {
  return apiFetchAuth<Carrera[]>('/carreras');
}

/**
 * `NivelCarrera`/`ModalidadCarrera`/`EstatusCarrera` — espejo de los enums
 * homónimos en `App/backend/prisma/schema.prisma` (líneas ~63-79).
 */
export type NivelCarrera = 'TECNICO' | 'LICENCIATURA' | 'MAESTRIA' | 'DOCTORADO';
export type ModalidadCarrera = 'PRESENCIAL' | 'SEMIPRESENCIAL' | 'EN_LINEA';
export type EstatusCarrera = 'ACTIVA' | 'INACTIVA';

/**
 * Shape completo del modelo `Carrera` — lo que devuelven `GET`/`POST`/`PATCH
 * /carreras` (Fase 6, Día 21, `carreras.service.ts` — sin `select`, Prisma
 * regresa el registro completo). Espejo de `model Carrera` en
 * `schema.prisma` (sin `sedeId`, redundante — el frontend nunca lo necesita,
 * regla 2).
 */
export interface CarreraCompleta {
  id: string;
  nombre: string;
  clave: string;
  duracion: number;
  nivel: NivelCarrera;
  modalidad: ModalidadCarrera;
  estatus: EstatusCarrera;
  rvoe: string;
  descripcion: string;
  createdAt: string;
  updatedAt: string;
  tieneMalla: boolean;
}

/** Body de `POST /carreras` — los 6 campos son requeridos (`sedeId`/`estatus` nunca van acá, ver `CrearCarreraDto` del backend). */
export interface CrearCarreraInput {
  nombre: string;
  clave: string;
  duracion: number;
  nivel: NivelCarrera;
  modalidad: ModalidadCarrera;
  rvoe: string;
  descripcion: string;
}

/** Body de `PATCH /carreras/:id` — mismos campos que `CrearCarreraInput` + `estatus`, todos opcionales (`{}` es válido). */
export type ActualizarCarreraInput = Partial<
  CrearCarreraInput & { estatus: EstatusCarrera }
>;

export function crearCarrera(input: CrearCarreraInput): Promise<CarreraCompleta> {
  return apiFetchAuth<CarreraCompleta>('/carreras', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function actualizarCarrera(
  id: string,
  input: ActualizarCarreraInput,
): Promise<CarreraCompleta> {
  return apiFetchAuth<CarreraCompleta>(`/carreras/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/**
 * `MallaCurricular` — Fase 7, Día 23. Espejo de `model MallaCurricular`
 * (`schema.prisma`) tal como lo devuelve `POST /carreras/:id/malla` —
 * sin `carrera` (relación completa, el frontend no la necesita acá).
 */
export interface MallaCurricular {
  id: string;
  carreraId: string;
  storagePath: string;
  nombreArchivo: string;
  subidaEn: string;
  subidaPorId: string;
}

/**
 * `GET /carreras/:id/malla` — detalle de quién y cuándo subió la malla
 * vigente. `null` si la carrera todavía no tiene malla (no es un error).
 */
export interface MallaCurricularInfo {
  nombreArchivo: string;
  subidaEn: string;
  subidaPor: {
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string | null;
  };
}

export function obtenerMallaCurricular(
  carreraId: string,
): Promise<MallaCurricularInfo | null> {
  return apiFetchAuth<MallaCurricularInfo | null>(
    `/carreras/${carreraId}/malla`,
  );
}

/**
 * `POST /carreras/:id/malla` con progreso real de subida — usa
 * `XMLHttpRequest` en vez de `apiFetchAuth`/`fetch` (2026-08-19) porque
 * `fetch` no expone eventos de progreso de subida de forma práctica en el
 * navegador; es la única llamada de este árbol que lo necesita. Mismo
 * contrato de retorno y de errores (`ApiError` con `code`/`status`) que
 * el resto de la API — `onProgress` es opcional, sin cambio de
 * comportamiento para callers que no lo pasan.
 */
export function subirMallaCurricular(
  carreraId: string,
  file: File,
  onProgress?: (porcentaje: number) => void,
): Promise<MallaCurricular> {
  return new Promise((resolve, reject) => {
    obtenerAccessToken()
      .then((token) => {
        const formData = new FormData();
        formData.append('archivo', file);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_URL}/carreras/${carreraId}/malla`);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);

        xhr.upload.onprogress = (e) => {
          if (onProgress && e.lengthComputable) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        };

        xhr.onload = () => {
          let body: unknown = null;
          try {
            body = JSON.parse(xhr.responseText);
          } catch {
            body = null;
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            const success = body as { data?: MallaCurricular } | null;
            if (success && success.data) {
              resolve(success.data);
            } else {
              reject(
                new ApiError(
                  'Respuesta inesperada del servidor al subir la malla curricular.',
                  'SERVER_ERROR',
                  xhr.status,
                ),
              );
            }
          } else {
            const failure = body as Partial<{ error: string; code: string }> | null;
            reject(
              new ApiError(
                failure?.error ?? 'Error inesperado del servidor',
                failure?.code ?? 'SERVER_ERROR',
                xhr.status,
              ),
            );
          }
        };

        xhr.onerror = () => {
          reject(new Error('Error de red al subir la malla curricular.'));
        };

        xhr.send(formData);
      })
      .catch(reject);
  });
}
