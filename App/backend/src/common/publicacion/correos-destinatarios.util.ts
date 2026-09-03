import { PrismaService } from '../../prisma/prisma.service';

/**
 * Resuelve `correoPersonal` para una lista de `Usuario.id`, cualquiera que
 * sea su rol — el correo real/legible SIEMPRE es `correoPersonal` del
 * perfil, nunca `Usuario.email` (login sintético, ver Fase 4). Usuarios
 * sin ningún perfil se omiten silenciosamente (no hay a dónde escribir).
 * Devuelve el par `usuarioId`/`correoPersonal` para poder identificar en
 * el log a qué destinatario correspondió un envío fallido (regla 12).
 *
 * Standalone (recibe `prisma` como arg, igual que `resolverDestinatarios`
 * en `alcance-publicacion.util.ts`). `CalendarioService.obtenerCorreosPersonales`
 * es una copia private idéntica — se deja sin tocar por estabilidad; Fase 17
 * la unifica contra esta función.
 */
export async function obtenerCorreosPersonales(
  prisma: PrismaService,
  usuarioIds: string[],
): Promise<{ usuarioId: string; correoPersonal: string }[]> {
  if (usuarioIds.length === 0) return [];
  const [alumnos, maestros, administrativos] = await Promise.all([
    prisma.perfilAlumno.findMany({
      where: { usuarioId: { in: usuarioIds } },
      select: { usuarioId: true, correoPersonal: true },
    }),
    prisma.perfilMaestro.findMany({
      where: { usuarioId: { in: usuarioIds } },
      select: { usuarioId: true, correoPersonal: true },
    }),
    prisma.perfilAdministrativo.findMany({
      where: { usuarioId: { in: usuarioIds } },
      select: { usuarioId: true, correoPersonal: true },
    }),
  ]);
  return [...alumnos, ...maestros, ...administrativos];
}
