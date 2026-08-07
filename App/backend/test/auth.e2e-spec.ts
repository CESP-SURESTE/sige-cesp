import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppModule } from '../src/app.module';
import { AUTH_SUPABASE_CLIENT_OVERRIDE } from '../src/auth/auth.service';
import { loadEnv } from '../src/load-env';

loadEnv();

interface ErrorBody {
  error: string;
  code: string;
}

interface LoginBody {
  data: {
    accessToken: string;
    refreshToken: string;
    tokenType: string;
    expiresIn: number;
    user: { id: string; email?: string };
  };
}

/**
 * Test de integración — Fase 2, Día 7.
 *
 * `POST /auth/login` de punta a punta contra la app real (`AppModule`
 * completo), pero sin pegarle a un proyecto real de Supabase Auth: se
 * inyecta un mock de `SupabaseClient` (solo `.auth.signInWithPassword`) vía
 * `AUTH_SUPABASE_CLIENT_OVERRIDE` — mismo patrón de override por inyección
 * que `SEDE_GUARD_ENV_OVERRIDE` usa en `test/sede-guard.e2e-spec.ts`, pero
 * overrideando el cliente completo en vez del JWKS (acá no hay firma que
 * verificar, solo una llamada HTTP a Supabase Auth que hay que poder
 * simular sin credenciales reales).
 */
describe('AuthController — POST /auth/login (e2e)', () => {
  let app: INestApplication<App>;
  let signInWithPassword: jest.Mock;

  beforeAll(async () => {
    signInWithPassword = jest.fn();
    const mockSupabaseClient = {
      auth: { signInWithPassword },
    } as unknown as SupabaseClient;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AUTH_SUPABASE_CLIENT_OVERRIDE)
      .useValue(mockSupabaseClient)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(() => {
    signInWithPassword.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  it('login exitoso -> 200 con accessToken/refreshToken/user', async () => {
    signInWithPassword.mockResolvedValueOnce({
      data: {
        user: {
          id: '11111111-1111-1111-1111-111111111111',
          email: 'admin@cesp.edu.mx',
          role: 'authenticated',
          app_metadata: {},
          user_metadata: {},
        },
        session: {
          access_token: 'access-token-de-prueba',
          refresh_token: 'refresh-token-de-prueba',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: 9999999999,
        },
      },
      error: null,
    });

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@cesp.edu.mx', password: 'password-correcto' });

    expect(res.status).toBe(200);
    const body = res.body as LoginBody;
    expect(body.data.accessToken).toBe('access-token-de-prueba');
    expect(body.data.refreshToken).toBe('refresh-token-de-prueba');
    expect(body.data.user.email).toBe('admin@cesp.edu.mx');
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'admin@cesp.edu.mx',
      password: 'password-correcto',
    });
  });

  it('credenciales inválidas -> 401 UNAUTHORIZED', async () => {
    signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: {
        name: 'AuthApiError',
        message: 'Invalid login credentials',
        status: 400,
        code: 'invalid_credentials',
      },
    });

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@cesp.edu.mx', password: 'password-incorrecto' });

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).code).toBe('UNAUTHORIZED');
  });

  it('cuenta bloqueada -> 403 CUENTA_BLOQUEADA', async () => {
    signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: {
        name: 'AuthApiError',
        message: 'User is banned',
        status: 403,
        code: 'user_banned',
      },
    });

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'bloqueado@cesp.edu.mx', password: 'cualquier-cosa' });

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('CUENTA_BLOQUEADA');
  });

  it('error inesperado de Supabase -> 500 SERVER_ERROR', async () => {
    signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: {
        name: 'AuthApiError',
        message: 'Service unavailable',
        status: 503,
        code: 'unexpected_failure',
      },
    });

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@cesp.edu.mx', password: 'lo-que-sea' });

    expect(res.status).toBe(500);
    expect((res.body as ErrorBody).code).toBe('SERVER_ERROR');
    expect(signInWithPassword).toHaveBeenCalled();
  });

  it('body sin password -> 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@cesp.edu.mx' });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('body sin email -> 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ password: 'password-correcto' });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('email con formato inválido -> 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'esto-no-es-un-email', password: 'password-correcto' });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('body vacío -> 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer()).post('/auth/login').send({});

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });
});
