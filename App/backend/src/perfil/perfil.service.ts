import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { NivelPermiso, RolUsuario } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * `PerfilService` — Fase 5, Día 16.
 *
 * `GET /perfil` — el usuario autenticado (cualquier rol) consulta su propio
 * perfil. Fuente del `usuarioId` a consultar: `@ActorUsuarioId()` (JWT
 * `sub`), NUNCA un `:id`/query param — no existe forma de pedir el perfil de
 * otra persona por esta ruta (eso es `GET /personas?rol=...`, Día 19, con su
 * propio filtro por sede y guard de rol).
 *
 * Decisión de alcance (encargo del día, "documenta el criterio"): se dejó la
 * ESTRUCTURA ya preparada para ramificar por rol (el `select` de Prisma ya
 * trae `perfilAlumno` con su `carrera`, y el shape de salida separa
 * `usuario`/`sede` — comunes a los 3 roles — del sub-objeto específico del
 * rol), en vez de acotar el endpoint solo a `ALUMNO`. Motivo: la ruta
 * (`GET /perfil`, sin `@Roles(...)`) ya es la misma para los 3 roles desde
 * hoy — un maestro o administrativo que llame a este endpoint hoy debe
 * recibir 200 con sus datos comunes (no un error), no una ruta que solo
 * funcione para alumnos hasta Día 18. Lo que SÍ se acota estrictamente a hoy
 * es el CONTENIDO de rol: `perfilMaestro`/`perfilAdministrativo` se agregan
 * recién en Día 17/18 (no se selecciona ese `include` todavía — no hay
 * campos que mostrar), por eso `maestro`/`administrativo` en la respuesta
 * son siempre `null` por ahora, documentado explícitamente más abajo.
 *
 * Actualización (extensión de contactos/infoMedica de `POST /personas`,
 * encargo del usuario 2026-08-12): `alumno.esMenorDeEdad` se agregó como
 * campo derivado — calculado al vuelo desde `fechaNacimiento`, NUNCA
 * persistido (regla 1 de CLAUDE.md raíz), ver `calcularEsMenorDeEdad` al
 * final de este archivo. Reemplaza la nota anterior de Día 16 que decía
 * explícitamente que no se agregaba ningún campo calculable — ese día no
 * había un pedido real; ahora sí lo hay.
 *
 * Actualización (gap real reportado por el usuario probando la app,
 * 2026-08-13): `alumno.contactos` se agregó al `select` — el usuario notó
 * que el contacto de emergencia/tutor capturado en el alta (`POST
 * /personas`, extensión 2026-08-12) no se veía en ningún lado después.
 * Regla 4 de CLAUDE.md raíz (contactos son sub-recurso anidado al perfil):
 * sigue siendo así, esto NO es una ruta nueva `GET /alumnos/:id/contactos`,
 * es un `select` anidado más dentro de `GET /perfil`, igual que ya lo es
 * `carrera`. Se ordena por `orden` ascendente — ese `orden` lo asigna
 * `PersonasService.conOrdenSecuencial` al momento del alta y es
 * significativo (el primero, `orden: 1`, es el contacto principal). No se
 * selecciona `alumnoId` — FK redundante, el cliente ya sabe de quién es su
 * propio perfil.
 *
 * Alcance deliberado de este cambio — SOLO `contactos`, NO `infoMedica`:
 * el usuario pidió ver el contacto de emergencia/tutor, no datos de salud.
 * `infoMedica` es más sensible (padecimientos, medicamentos, alergias) y no
 * hubo un pedido explícito de mostrarla en el perfil — se agrega el día que
 * haya un encargo real para eso, no antes (mismo criterio de otras
 * decisiones de alcance de este archivo, ver notas de Día 16/17/18).
 *
 * Día 17 (roadmap, "Perfil de maestro — mismo patrón, campos propios de
 * maestro"): `maestro` deja de ser siempre `null` — cuando
 * `usuario.rol === MAESTRO` trae los campos propios de `PerfilMaestro` +
 * `contactos` (`ContactoMaestro`, ordenados por `orden` ascendente, mismo
 * criterio recién aplicado a `alumno.contactos`). NO se selecciona
 * `usuarioId` (FK redundante) ni `createdAt`/`updatedAt` (no aportan al
 * perfil que ve el propio usuario). `ContactoMaestro` NO tiene el campo
 * `tipo` (eso es exclusivo de `ContactoAlumno` — un maestro no tiene
 * distinción tutor/emergencia, solo contactos genéricos), tampoco se
 * selecciona `maestroId` (FK redundante). Igual que `alumno`, `infoMedica`
 * queda fuera de alcance a propósito — sin pedido explícito de mostrarla.
 * `PerfilMaestro` NO tiene `fechaNacimiento` en el schema (a diferencia de
 * `PerfilAlumno`), por lo que NO existe un `esMenorDeEdad` equivalente para
 * maestro — no aplica y no hay columna fuente para derivarlo.
 *
 * Día 18 (roadmap, "Perfil de administrativo — campos propios + indicador
 * visual de su nivel de permiso"): `administrativo` deja de ser siempre
 * `null` — cuando `usuario.rol === ADMINISTRATIVO` trae los campos propios de
 * `PerfilAdministrativo` + `contactos` (`ContactoAdministrativo`, ordenados
 * por `orden` ascendente, mismo criterio de `alumno`/`maestro`). NO se
 * selecciona `usuarioId` (FK redundante) ni `createdAt`/`updatedAt`. Igual
 * que los otros 2 roles, `infoMedica` queda fuera de alcance a propósito —
 * sin pedido explícito. Tampoco se selecciona `permisos`
 * (`PermisoAdministrativo[]`, la matriz de secciones por AUXILIAR) — decisión
 * de alcance deliberada: el roadmap de hoy pide el indicador de nivel de
 * permiso (singular), no la matriz completa, que `CLAUDE.md` raíz ya lista
 * aparte, en la tabla "CRUD por tipo de entidad", como su propia feature de
 * negocio sin día asignado todavía.
 *
 * `puedeDarAltaAdministrativos` (regla 1 de CLAUDE.md raíz — nunca persistir
 * algo calculable) — booleano derivado al vuelo desde `nivelPermiso`, MISMO
 * criterio exacto que `PersonasService.verificarJerarquiaNivelPermiso`
 * (`src/personas/personas.service.ts`, regla 7 de CLAUDE.md raíz): un
 * `AUXILIAR` no puede dar de alta a ningún `ADMINISTRATIVO`, `ADMIN` y
 * `SUPER_ADMIN` sí pueden (con tope de jerarquía entre ellos, pero eso ya es
 * un detalle de la ruta de alta, no de este indicador de solo lectura). Por
 * eso acá basta con `nivelPermiso !== AUXILIAR` — no se reimplementa la
 * jerarquía completa (`JERARQUIA_NIVEL_PERMISO`) porque este indicador no
 * necesita comparar contra el nivel de un tercero, solo reflejar la regla
 * "AUXILIAR no da de alta, ADMIN/SUPER_ADMIN sí" tal cual existe hoy en
 * `personas.service.ts`.
 */
@Injectable()
export class PerfilService {
  constructor(private readonly prisma: PrismaService) {}

  async obtenerPerfilPropio(actorUsuarioId: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: actorUsuarioId },
      select: {
        id: true,
        email: true,
        rol: true,
        sedeId: true,
        codigoExterno: true,
        primerIngreso: true,
        activo: true,
        ultimoAcceso: true,
        sede: {
          select: {
            id: true,
            nombre: true,
            direccion: true,
            ubicacionReferencia: true,
            telefono: true,
            // `costoRenta` queda fuera a propósito — dato financiero interno,
            // no tiene lugar en el perfil que ve el propio usuario.
          },
        },
        perfilAlumno: {
          select: {
            id: true,
            nombres: true,
            apellidoPaterno: true,
            apellidoMaterno: true,
            curp: true,
            fechaNacimiento: true,
            matricula: true,
            correoPersonal: true,
            estatusAcademico: true,
            periodoIngreso: true,
            semestreActual: true,
            telefono: true,
            carrera: {
              select: {
                id: true,
                nombre: true,
                clave: true,
                duracion: true,
                nivel: true,
                modalidad: true,
                estatus: true,
                rvoe: true,
                descripcion: true,
              },
            },
            // Gap real reportado por el usuario 2026-08-13 (ver comentario de
            // clase) — SOLO contactos, `infoMedica` queda fuera de alcance a
            // propósito. `alumnoId` no se selecciona (FK redundante).
            contactos: {
              select: {
                id: true,
                tipo: true,
                nombre: true,
                telefono: true,
                correo: true,
                parentesco: true,
                orden: true,
              },
              orderBy: { orden: 'asc' },
            },
          },
        },
        // Día 17 — campos propios de `PerfilMaestro` + `contactos`, ver
        // comentario de clase. `usuarioId` no se selecciona (FK redundante).
        perfilMaestro: {
          select: {
            id: true,
            nombres: true,
            apellidoPaterno: true,
            apellidoMaterno: true,
            curp: true,
            cedulaProfesional: true,
            correoPersonal: true,
            telefono: true,
            fechaContratacion: true,
            estatus: true,
            contactos: {
              select: {
                id: true,
                nombre: true,
                telefono: true,
                correo: true,
                parentesco: true,
                orden: true,
              },
              orderBy: { orden: 'asc' },
            },
          },
        },
        // Día 18 — campos propios de `PerfilAdministrativo` + `contactos`,
        // ver comentario de clase. `usuarioId` no se selecciona (FK
        // redundante). `permisos` (matriz completa) queda fuera de alcance.
        perfilAdministrativo: {
          select: {
            id: true,
            nombres: true,
            apellidoPaterno: true,
            apellidoMaterno: true,
            curp: true,
            correoPersonal: true,
            telefono: true,
            fechaContratacion: true,
            estatus: true,
            puesto: true,
            nivelPermiso: true,
            contactos: {
              select: {
                id: true,
                nombre: true,
                telefono: true,
                correo: true,
                parentesco: true,
                orden: true,
              },
              orderBy: { orden: 'asc' },
            },
          },
        },
      },
    });

    if (!usuario) {
      // Defensivo — no debería pasar nunca en la práctica: `SedeGuard` ya
      // exige el claim `sede_id`, que el Auth Hook (Día 5) solo emite si
      // existe una fila en `usuarios` para ese `sub` — si el JWT pasó el
      // guard, el actor tiene fila. Regla 12 de CLAUDE.md raíz — loguear
      // antes de responder.
      console.error(
        '[PerfilService.obtenerPerfilPropio] Actor autenticado sin fila en `usuarios` — inconsistencia de datos:',
        { actorUsuarioId },
      );
      throw new NotFoundException({
        error: 'No se encontró el usuario autenticado',
        code: 'NOT_FOUND',
      });
    }

    if (usuario.rol === RolUsuario.ALUMNO && !usuario.perfilAlumno) {
      // Igualmente defensivo — la alta transaccional (regla 9 de CLAUDE.md
      // raíz) garantiza que un `Usuario` con `rol: ALUMNO` siempre tiene su
      // `PerfilAlumno`. Si esto pasa, es una inconsistencia de datos real
      // (ej. edición manual en DB), no un caso de negocio esperado.
      console.error(
        '[PerfilService.obtenerPerfilPropio] Usuario con rol ALUMNO sin PerfilAlumno — inconsistencia de datos:',
        { actorUsuarioId },
      );
      throw new InternalServerErrorException({
        error: 'El perfil de este usuario está incompleto',
        code: 'SERVER_ERROR',
      });
    }

    if (usuario.rol === RolUsuario.MAESTRO && !usuario.perfilMaestro) {
      // Mismo criterio defensivo que el bloque de ALUMNO — la alta
      // transaccional (regla 9 de CLAUDE.md raíz) garantiza que un
      // `Usuario` con `rol: MAESTRO` siempre tiene su `PerfilMaestro`.
      console.error(
        '[PerfilService.obtenerPerfilPropio] Usuario con rol MAESTRO sin PerfilMaestro — inconsistencia de datos:',
        { actorUsuarioId },
      );
      throw new InternalServerErrorException({
        error: 'El perfil de este usuario está incompleto',
        code: 'SERVER_ERROR',
      });
    }

    if (
      usuario.rol === RolUsuario.ADMINISTRATIVO &&
      !usuario.perfilAdministrativo
    ) {
      // Mismo criterio defensivo que ALUMNO/MAESTRO — la alta transaccional
      // (regla 9 de CLAUDE.md raíz) garantiza que un `Usuario` con
      // `rol: ADMINISTRATIVO` siempre tiene su `PerfilAdministrativo`. Si
      // esto pasa, es una inconsistencia de datos real, NO el criterio de
      // "tratar como AUXILIAR" de `verificarJerarquiaNivelPermiso` — ese es
      // para el flujo de alta (decidir si el actor puede dar de alta a
      // otro), no aplica acá (el actor está viendo SU PROPIO perfil, que
      // debería existir siempre).
      console.error(
        '[PerfilService.obtenerPerfilPropio] Usuario con rol ADMINISTRATIVO sin PerfilAdministrativo — inconsistencia de datos:',
        { actorUsuarioId },
      );
      throw new InternalServerErrorException({
        error: 'El perfil de este usuario está incompleto',
        code: 'SERVER_ERROR',
      });
    }

    const {
      perfilAlumno,
      perfilMaestro,
      perfilAdministrativo,
      ...usuarioComun
    } = usuario;

    return {
      ...usuarioComun,
      alumno:
        usuario.rol === RolUsuario.ALUMNO && perfilAlumno
          ? {
              ...perfilAlumno,
              // `esMenorDeEdad` — regla 1 de CLAUDE.md raíz (nunca persistir
              // algo calculable): NO existe columna para esto en
              // `PerfilAlumno`, se deriva al vuelo en cada response desde
              // `fechaNacimiento`, nunca se guarda en DB. Encargo explícito
              // del usuario (extensión de contactos/infoMedica de
              // `POST /personas`, 2026-08-12). Solo aplica a `alumno` — los
              // otros 2 perfiles no tienen `fechaNacimiento` en el schema.
              esMenorDeEdad: calcularEsMenorDeEdad(
                perfilAlumno.fechaNacimiento,
              ),
            }
          : null,
      // Día 17 — `PerfilMaestro` + `contactos`. `PerfilMaestro` no tiene
      // `fechaNacimiento` en el schema, por eso no hay `esMenorDeEdad` (ni
      // equivalente) acá — a diferencia de `alumno`, no aplica.
      maestro:
        usuario.rol === RolUsuario.MAESTRO && perfilMaestro
          ? perfilMaestro
          : null,
      // Día 18 — `PerfilAdministrativo` + `contactos` + indicador derivado
      // de `nivelPermiso`. `PerfilAdministrativo` no tiene `fechaNacimiento`
      // en el schema, por lo que tampoco aplica `esMenorDeEdad` acá.
      administrativo:
        usuario.rol === RolUsuario.ADMINISTRATIVO && perfilAdministrativo
          ? {
              ...perfilAdministrativo,
              // `puedeDarAltaAdministrativos` — regla 1 de CLAUDE.md raíz
              // (nunca persistir algo calculable): replica SOLO la primera
              // compuerta de `PersonasService.verificarJerarquiaNivelPermiso`
              // (`src/personas/personas.service.ts`, regla 7) — un AUXILIAR
              // nunca puede dar de alta administrativos, ADMIN/SUPER_ADMIN
              // sí. NO replica la segunda compuerta de esa misma función (un
              // ADMIN no puede asignar SUPER_ADMIN) — hallazgo de QA
              // (`qa-backend`, 2026-08-13): sin impacto real, este campo es
              // solo informativo acá, `POST /personas` sigue validando la
              // jerarquía completa por su cuenta. Ver comentario de clase.
              puedeDarAltaAdministrativos:
                perfilAdministrativo.nivelPermiso !== NivelPermiso.AUXILIAR,
            }
          : null,
    };
  }
}

/**
 * Edad calculada al vuelo desde `fechaNacimiento` (día/mes exactos, no solo
 * diferencia de años) — 18 años es el corte real de mayoría de edad en
 * México. Función pura, sin acceso a DB ni efectos secundarios: nunca se
 * persiste el resultado (regla 1 de CLAUDE.md raíz).
 */
function calcularEsMenorDeEdad(fechaNacimiento: Date): boolean {
  const hoy = new Date();
  let edad = hoy.getFullYear() - fechaNacimiento.getFullYear();
  const noHaCumplidoAnosEsteAnio =
    hoy.getMonth() < fechaNacimiento.getMonth() ||
    (hoy.getMonth() === fechaNacimiento.getMonth() &&
      hoy.getDate() < fechaNacimiento.getDate());
  if (noHaCumplidoAnosEsteAnio) {
    edad -= 1;
  }
  return edad < 18;
}
