/**
 * JWT propio de `AdminPlataforma` — Fase 6, Día 20.
 *
 * `jose` (v6) es ESM-only ("type": "module") — un `import ... from 'jose'`
 * estático revienta bajo Jest (ts-jest compila a CommonJS). Se resuelve con
 * `import()` dinámico + caché en módulo, mismo patrón exacto que
 * `src/common/guards/sede.guard.ts`.
 *
 * Secreto simétrico (`PLATFORM_ADMIN_JWT_SECRET`, HS256) — a diferencia del
 * JWT de Supabase (asimétrico, verificado contra JWKS), este JWT lo firma Y
 * verifica el propio backend, no hay tercero involucrado.
 */
let joseModule: typeof import('jose') | undefined;

async function getJose() {
  if (!joseModule) {
    joseModule = await import('jose');
  }
  return joseModule;
}

function getSecret(): Uint8Array {
  const secret = process.env.PLATFORM_ADMIN_JWT_SECRET;
  if (!secret) {
    throw new Error('Falta PLATFORM_ADMIN_JWT_SECRET en el entorno');
  }
  return new TextEncoder().encode(secret);
}

export interface PlatformAdminJwtClaims {
  sub: string;
  email: string;
}

export async function firmarPlatformAdminToken(
  claims: PlatformAdminJwtClaims,
): Promise<string> {
  const jose = await getJose();
  return new jose.SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(getSecret());
}

export async function verificarPlatformAdminToken(
  token: string,
): Promise<PlatformAdminJwtClaims> {
  const jose = await getJose();
  const { payload } = await jose.jwtVerify(token, getSecret());

  if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
    throw new Error('Token de plataforma con claims inválidos');
  }

  return { sub: payload.sub, email: payload.email };
}
