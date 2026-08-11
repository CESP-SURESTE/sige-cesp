import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CarrerasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lista las carreras de una sede — campos mínimos para poblar un
   * `<select>` (Día 14, formulario de alta de alumno del frontend). `clave`
   * se incluye porque es una identificación corta obviamente útil en un
   * dropdown (ej. "LAE-MID — Licenciatura en Administración"); el resto del
   * modelo (`nivel`, `modalidad`, `rvoe`, `descripcion`, etc.) queda fuera a
   * propósito, no hace falta para este uso.
   */
  async listarPorSede(sedeId: string) {
    return this.prisma.carrera.findMany({
      where: { sedeId },
      select: { id: true, nombre: true, clave: true },
      orderBy: { nombre: 'asc' },
    });
  }
}
