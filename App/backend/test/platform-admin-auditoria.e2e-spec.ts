import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccionAuditoria, RolUsuario } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/load-env';
import { firmarPlatformAdminToken } from '../src/platform-admin/platform-admin-jwt.util';
import { hashPassword } from '../src/platform-admin/password.util';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup-app';

loadEnv();

interface ErrorBody {
  error: string;
  code: string;
}
interface ActorShape {
  id: string;
  tipo: 'USUARIO' | 'PLATAFORMA';
  nombre: string;
  rol: string | null;
}
interface ItemShape {
  id: string;
  fecha: string;
  accion: string;
  entidad: string;
  entidadId: string;
  actor: ActorShape;
  sede: { id: string; nombre: string } | null;
  detalle: unknown;
}
interface ListaBody {
  data: ItemShape[];
  page: number;
  limit: number;
  total: number;
}

// Mismo offset fijo -06:00 (America/Merida, sin DST) que usa
// PlatformAdminService.listarAuditoria para anclar desde/hasta al día
// calendario local, no al UTC de `new Date().toISOString()`.
function fechaLocalCESP(fecha: Date): string {
  return new Date(fecha.getTime() - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

describe('GET /platform-admin/auditoria (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;
  const emailAdmin = 'e2e.auditoria@nexo-sd.mx';

  // ids que crea este spec — se borran acotados en afterAll (regla 14)
  const idsAuditoria: string[] = [];
  let sedeAId: string;
  let sedeBId: string;
  let usuarioActorId: string;
  let adminActorId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = moduleFixture.get(PrismaService);

    await prisma.adminPlataforma.deleteMany({ where: { email: emailAdmin } });
    const admin = await prisma.adminPlataforma.create({
      data: {
        email: emailAdmin,
        passwordHash: await hashPassword('password-e2e-123'),
        nombre: 'E2E Auditoria',
      },
    });
    adminActorId = admin.id;
    token = await firmarPlatformAdminToken({
      sub: admin.id,
      email: admin.email,
    });

    const sedeA = await prisma.sede.create({
      data: {
        nombre: `Sede E2E Auditoria A ${Date.now()}`,
        direccion: 'x',
        ubicacionReferencia: 'x',
        telefono: '9990000000',
      },
    });
    const sedeB = await prisma.sede.create({
      data: {
        nombre: `Sede E2E Auditoria B ${Date.now()}`,
        direccion: 'x',
        ubicacionReferencia: 'x',
        telefono: '9990000001',
      },
    });
    sedeAId = sedeA.id;
    sedeBId = sedeB.id;

    // Un Usuario real de sede A para usar como actor tipo USUARIO.
    const usuario = await prisma.usuario.create({
      data: {
        id: `00000000-0000-4000-8000-${Date.now().toString().slice(-12).padStart(12, '0')}`,
        email: `e2e.auditoria.actor.${Date.now()}@acceso.cesp.edu.mx`,
        rol: RolUsuario.ADMINISTRATIVO,
        activo: true,
        sedeId: sedeAId,
      },
    });
    usuarioActorId = usuario.id;
    await prisma.perfilAdministrativo.create({
      data: {
        usuarioId: usuario.id,
        nombres: 'Actor',
        apellidoPaterno: 'De',
        apellidoMaterno: 'Prueba',
        curp: `AEDP${Date.now().toString().slice(-14)}`,
        correoPersonal: 'actor.prueba@example.com',
        telefono: '9990000002',
        puesto: 'AUXILIAR',
        nivelPermiso: 'AUXILIAR',
        fechaContratacion: new Date('2020-01-01'),
        estatus: 'ACTIVO',
      },
    });

    // 6 registros de auditoría de prueba.
    const base = [
      {
        actor: 'usuario',
        sedeId: sedeAId,
        accion: AccionAuditoria.ALTA,
        entidad: 'Carrera',
        detalle: { antes: null, despues: { nombre: 'X' } },
      },
      {
        actor: 'usuario',
        sedeId: sedeAId,
        accion: AccionAuditoria.EDICION,
        entidad: 'Carrera',
        detalle: null,
      },
      {
        actor: 'usuario',
        sedeId: sedeBId,
        accion: AccionAuditoria.ELIMINACION,
        entidad: 'Salon',
        detalle: null,
      },
      {
        actor: 'admin',
        sedeId: sedeAId,
        accion: AccionAuditoria.ALTA,
        entidad: 'Sede',
        detalle: { nombre: 'Sede A' },
      },
      {
        actor: 'admin',
        sedeId: sedeBId,
        accion: AccionAuditoria.EDICION,
        entidad: 'Sede',
        detalle: null,
      },
      {
        actor: 'admin',
        sedeId: null,
        accion: AccionAuditoria.EDICION,
        entidad: 'Sede',
        detalle: null,
      }, // sede borrada -> sedeId null
    ];
    for (const r of base) {
      const row = await prisma.registroAuditoria.create({
        data: {
          usuarioId: r.actor === 'usuario' ? usuarioActorId : null,
          adminPlataformaId: r.actor === 'admin' ? adminActorId : null,
          sedeId: r.sedeId,
          accion: r.accion,
          entidad: r.entidad,
          entidadId: `10000000-0000-4000-8000-000000000001`,
          detalle: r.detalle === null ? undefined : r.detalle,
        },
      });
      idsAuditoria.push(row.id);
    }
  });

  afterAll(async () => {
    await prisma.registroAuditoria.deleteMany({
      where: { id: { in: idsAuditoria } },
    });
    await prisma.perfilAdministrativo.deleteMany({
      where: { usuarioId: usuarioActorId },
    });
    await prisma.usuario.deleteMany({ where: { id: usuarioActorId } });
    await prisma.sede.deleteMany({ where: { id: { in: [sedeAId, sedeBId] } } });
    await prisma.adminPlataforma.deleteMany({ where: { email: emailAdmin } });
    await app.close();
  });

  function get(qs = '') {
    return request(app.getHttpServer())
      .get(`/platform-admin/auditoria${qs}`)
      .set('Authorization', `Bearer ${token}`);
  }

  it('sin token -> 401', async () => {
    const res = await request(app.getHttpServer()).get(
      '/platform-admin/auditoria',
    );
    expect(res.status).toBe(401);
  });

  it('sin filtros -> pagina desc y total >= 6', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = res.body as ListaBody;
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.total).toBeGreaterThanOrEqual(6);
    // orden fecha desc
    const fechas = body.data.map((r) => new Date(r.fecha).getTime());
    expect([...fechas].sort((a, b) => b - a)).toEqual(fechas);
  });

  it('filtra por sedeId', async () => {
    const res = await get(`?sedeId=${sedeBId}&limit=100`);
    expect(res.status).toBe(200);
    const body = res.body as ListaBody;
    const mios = body.data.filter((r) => idsAuditoria.includes(r.id));
    expect(mios.length).toBe(2); // los 2 de sedeB con sedeId no-null
    expect(mios.every((r) => r.sede?.id === sedeBId)).toBe(true);
  });

  it('filtra por accion', async () => {
    const res = await get(`?accion=ELIMINACION&limit=100`);
    const body = res.body as ListaBody;
    const mios = body.data.filter((r) => idsAuditoria.includes(r.id));
    expect(mios.length).toBe(1);
    expect(mios[0].entidad).toBe('Salon');
  });

  it('filtra por entidad', async () => {
    const res = await get(`?entidad=Carrera&limit=100`);
    const body = res.body as ListaBody;
    const mios = body.data.filter((r) => idsAuditoria.includes(r.id));
    expect(mios.length).toBe(2);
  });

  it('filtra por actorId (usuario y admin de plataforma)', async () => {
    const resU = await get(`?actorId=${usuarioActorId}&limit=100`);
    const misU = (resU.body as ListaBody).data.filter((r) =>
      idsAuditoria.includes(r.id),
    );
    expect(misU.length).toBe(3);
    expect(
      misU.every(
        (r) => r.actor.tipo === 'USUARIO' && r.actor.id === usuarioActorId,
      ),
    ).toBe(true);
    expect(
      misU.every(
        (r) =>
          r.actor.nombre === 'Actor De Prueba' &&
          r.actor.rol === 'ADMINISTRATIVO',
      ),
    ).toBe(true);

    const resA = await get(`?actorId=${adminActorId}&limit=100`);
    const misA = (resA.body as ListaBody).data.filter((r) =>
      idsAuditoria.includes(r.id),
    );
    expect(misA.length).toBe(3);
    expect(
      misA.every((r) => r.actor.tipo === 'PLATAFORMA' && r.actor.rol === null),
    ).toBe(true);
    expect(misA.every((r) => r.actor.nombre === 'E2E Auditoria')).toBe(true);
  });

  it('fila con sedeId null -> sede: null', async () => {
    const res = await get(`?actorId=${adminActorId}&limit=100`);
    const mios = (res.body as ListaBody).data.filter((r) =>
      idsAuditoria.includes(r.id),
    );
    expect(mios.some((r) => r.sede === null)).toBe(true);
  });

  it('filtra por rango de fechas', async () => {
    // Espeja el offset fijo -06:00 (America/Merida, sin DST) que usa
    // PlatformAdminService.listarAuditoria para el filtro desde/hasta, para
    // que "hoy" coincida con el día calendario local a cualquier hora, no
    // solo evitando fallar cerca de medianoche UTC.
    const hoy = fechaLocalCESP(new Date());
    const res = await get(`?desde=${hoy}&hasta=${hoy}&limit=100`);
    expect(res.status).toBe(200);
    const mios = (res.body as ListaBody).data.filter((r) =>
      idsAuditoria.includes(r.id),
    );
    expect(mios.length).toBe(6); // todos creados hoy
  });

  it('hasta < desde -> 400 VALIDATION_ERROR', async () => {
    const res = await get(`?desde=2026-02-01&hasta=2026-01-01`);
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('accion inválida -> 400', async () => {
    const res = await get(`?accion=NO_EXISTE`);
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('page=0 -> 400 ; limit=101 -> 400', async () => {
    expect((await get(`?page=0`)).status).toBe(400);
    expect((await get(`?limit=101`)).status).toBe(400);
  });

  it('detalle Json se devuelve tal cual', async () => {
    const res = await get(`?entidad=Carrera&accion=ALTA&limit=100`);
    const mio = (res.body as ListaBody).data.find((r) =>
      idsAuditoria.includes(r.id),
    );
    expect(mio?.detalle).toEqual({ antes: null, despues: { nombre: 'X' } });
  });
});
