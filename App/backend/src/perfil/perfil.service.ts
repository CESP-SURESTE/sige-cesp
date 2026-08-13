import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { RolUsuario } from '@prisma/client';
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

    const { perfilAlumno, ...usuarioComun } = usuario;

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
      // Reservados — se llenan en Día 17 (`PerfilMaestro`) y Día 18
      // (`PerfilAdministrativo` + indicador de `nivelPermiso`). No se
      // selecciona ese `include` todavía (nada que mostrar hoy); se dejan
      // explícitos en `null` en vez de omitir la clave, para que el shape de
      // la respuesta ya sea estable de cara al frontend desde hoy.
      maestro: null,
      administrativo: null,
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
