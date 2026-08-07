# Setup de Backend — NestJS + Prisma + Supabase

Guía de referencia basada en el setup real del proyecto SIGE (Día 2 del roadmap). Documenta el camino correcto **y por qué** — no solo los comandos, sino las trampas específicas que nos costaron tiempo, para que la próxima vez (este proyecto u otro) se resuelva en minutos en vez de horas.

---

## 0. Antes de empezar — decisiones que hay que tomar primero

| Decisión | Qué elegimos | Por qué |
|---|---|---|
| Versión de Prisma | **Prisma 6.x**, no 7 | Prisma 7 (nov 2025) cambió por completo cómo se configura la conexión (requiere `prisma.config.ts` y, para producción real, un driver adapter). Tiene bugs abiertos y conflictos conocidos con Next.js/Turbopack. No vale la pena pelear con eso al inicio de un proyecto |
| Cómo verifica el backend los JWT de usuarios | `@supabase/server` (paquete oficial, incluye adaptador para NestJS) | Evita escribir a mano la verificación de JWT contra JWKS — el paquete lo resuelve internamente |
| Sesión en el frontend | `@supabase/ssr` + `@supabase/supabase-js` | Es un paquete distinto al de arriba — maneja sesión vía cookies en Next.js. Los dos coexisten, cada uno en su carpeta (`front/` vs `back/`) |

---

## 1. Instalar Prisma — fijando la versión

```bash
cd back
pnpm remove prisma @prisma/client   # si ya instalaste la 7 por accidente
pnpm add -D prisma@6
pnpm add @prisma/client@6
pnpm exec prisma -v                 # confirma que diga 6.x.x, no 7.x.x
```

### ⚠️ Error que vas a ver la primera vez: `ERR_PNPM_IGNORED_BUILDS`

```
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: @prisma/engines@6.19.3, prisma@6.19.3
```

**Causa:** pnpm (versión reciente) bloquea por seguridad los scripts de instalación de paquetes hasta que los apruebas a mano — no es un error real, es una medida de seguridad.

**Fix:**
```bash
pnpm approve-builds --all
pnpm install
```

Este mismo error aparece también al instalar el frontend (Next.js, por `sharp` y `unrs-resolver`) — mismo fix.

---

## 2. Inicializar Prisma

```bash
pnpm exec prisma init
```

Esto crea `back/prisma/schema.prisma` y `back/.env`.

### ⚠️ Si por accidente quedó un `prisma.config.ts` en la raíz

Si en algún punto instalaste Prisma 7 y luego bajaste a 6, es posible que haya quedado un archivo `prisma.config.ts` de la versión 7. **Bórralo** — Prisma 6 no lo usa, y si lo detecta puede interferir con la carga de variables de entorno:

```
Prisma config detected, skipping environment variable loading.
```

Ese mensaje en los logs es la señal de que el archivo sigue ahí y hay que quitarlo.

---

## 3. Configurar el datasource en `schema.prisma`

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

Esto va **arriba de todo**, antes de los enums y modelos.

---

## 4. Crear el proyecto en Supabase — configuración inicial correcta

Al crear el proyecto, Supabase pregunta sobre 3 configuraciones. Así se dejaron y por qué:

| Opción | Valor | Por qué |
|---|---|---|
| **Enable Data API** | ❌ Apagado | El frontend nunca debe hablar directo con las tablas vía `supabase-js` — todo pasa por NestJS (guards de sede/rol, validaciones). Dejar esto prendido permite saltarse el backend por completo |
| **Automatically expose new tables** | ❌ Apagado | Aunque Data API esté apagado, no conviene dejar esto en automático — control manual siempre. La propia Supabase lo recomienda |
| **Enable automatic RLS** | ✅ Encendido | Cuando Prisma crea una tabla nueva por migración, esto la deja con RLS activado desde el día uno. Una tabla con RLS activado pero sin policies **bloquea todo acceso por default** — si se te olvida escribir la policy de una tabla nueva, queda cerrada, no abierta por accidente |

---

## 5. Conseguir las URLs de conexión — la parte que más tiempo costó

Supabase da **3 tipos de connection string** distintos. Confundirlas fue la causa de casi todos los errores de conexión que tuvimos.

| Tipo | Puerto | Host | Uso |
|---|---|---|---|
| **Direct connection** | 5432 | `db.[ref].supabase.co` | ❌ No usar — solo funciona por IPv6, la mayoría de redes en México son IPv4. Causa `P1001: Can't reach database server` |
| **Transaction pooler** | 6543 | `aws-0-[region].pooler.supabase.com` | ✅ Para `DATABASE_URL` (lo que usa la app en runtime) |
| **Session pooler** | 5432 | `aws-0-[region].pooler.supabase.com` | ✅ Para `DIRECT_URL` (lo que usa Prisma CLI para migraciones) |

**Cómo conseguirlas:** Supabase → botón **Connect** (o Project Settings → Database) → ahí aparecen las 3 pestañas. Copia cada una de su pestaña correspondiente — **nunca** de "Direct connection".

### `back/.env` correcto:

```dotenv
DATABASE_URL="postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres"
```

Puntos que se nos escaparon en el camino:

- **`?pgbouncer=true`** no viene incluido en lo que copias del dashboard — hay que agregarlo a mano al final de `DATABASE_URL`. Le dice a Prisma que desactive los prepared statements, que el pooler en modo transacción no soporta.
- **`DIRECT_URL` no lleva `?pgbouncer=true`** — solo `DATABASE_URL`.
- Las dos URLs usan el **mismo host**, solo cambia el puerto (6543 vs 5432) y el query param al final. Es fácil no notar la diferencia a simple vista.

---

## 6. La contraseña de la base de datos

### ⚠️ Nunca la compartas en texto plano — ni en chat, ni en documentos, ni en commits

Si en algún momento se expone (por accidente, en un chat, en un commit), **resetéala de inmediato**: Supabase → Project Settings → Database → Reset database password.

### Caracteres especiales rompen la URL de conexión

Si la contraseña tiene `@`, `#`, `%`, `+`, `/`, `:`, `&`, `=`, hay que codificarlos:

| Carácter | Reemplazo |
|---|---|
| `@` | `%40` |
| `#` | `%23` |
| `%` | `%25` |
| `+` | `%2B` |
| `/` | `%2F` |
| `:` | `%3A` |
| `&` | `%26` |
| `=` | `%3D` |

**Alternativa más simple:** al generar la contraseña, usar solo letras y números — evita el problema de raíz.

### Dónde guardarla

En un gestor de contraseñas (Vaultwarden en este proyecto), nunca en texto plano en ningún archivo que se vaya a compartir o commitear.

---

## 7. Errores de conexión — tabla de diagnóstico rápido

| Error | Causa más probable | Fix |
|---|---|---|
| `P1012: Environment variable not found: DIRECT_URL` | La variable no existe en `.env`, está mal escrita, o el archivo se llama `.env.txt` en vez de `.env` (típico en Windows con Notepad) | Verificar nombre exacto del archivo y de la variable |
| `P1001: Can't reach database server at db.[ref].supabase.co` | Estás usando el host de Direct Connection cruda (solo IPv6) | Cambiar a Session pooler (`aws-0-[region].pooler.supabase.com:5432`) |
| `P1000: Authentication failed` | Contraseña incorrecta, desactualizada (si la reseteaste y no actualizaste ambas URLs), con caracteres sin codificar, o con espacios invisibles al copiar/pegar | Verificar contraseña idéntica y actualizada en ambas variables; codificar caracteres especiales o generar una sin ellos |
| `[ERR_PNPM_IGNORED_BUILDS]` | pnpm bloqueando scripts de instalación por seguridad | `pnpm approve-builds --all` |
| `error: The datasource property url is no longer supported` | Instalaste Prisma 7 sin querer | Bajar a `prisma@6` y `@prisma/client@6` |

---

## 8. Las llaves de API de Supabase — dónde va cada una

Supabase migró de `anon`/`service_role` a un nuevo sistema: `publishable`/`secret`. Mezclarlas de lugar es el error de seguridad más común en proyectos con Supabase.

| Llave | Formato | Dónde va | Por qué |
|---|---|---|---|
| **Publishable** | `sb_publishable_...` | `front/.env.local`, con prefijo `NEXT_PUBLIC_` | Segura de exponer en el navegador — Row Level Security sigue filtrando todo lo que puede ver |
| **Secret** | `sb_secret_...` | **Solo** `back/.env` — nunca con prefijo `NEXT_PUBLIC_` | Se salta RLS por completo (`BYPASSRLS`). Si se expone en el navegador, cualquiera puede leer/escribir toda la base sin restricción |

**Regla que no se rompe nunca:** cualquier variable de entorno en Next.js que empiece con `NEXT_PUBLIC_` termina en el JavaScript que baja al navegador de cualquiera — visible con solo abrir devtools. La `secret` key jamás lleva ese prefijo.

### `back/.env` — variables de Supabase (además de `DATABASE_URL`/`DIRECT_URL`)

```dotenv
SUPABASE_URL="https://[ref].supabase.co"
SUPABASE_PUBLISHABLE_KEY="sb_publishable_xxxxxxxxxxxx"
SUPABASE_SECRET_KEY="sb_secret_xxxxxxxxxxxx"
SUPABASE_JWKS_URL="https://[ref].supabase.co/auth/v1/.well-known/jwks.json"
```

### `front/.env.local`

```dotenv
NEXT_PUBLIC_SUPABASE_URL="https://[ref].supabase.co"
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="sb_publishable_xxxxxxxxxxxx"
```

---

## 9. Instalar los paquetes de Supabase — en el lugar correcto

```bash
# Backend (back/) — verificación de JWT, admin API
cd back
npm install @supabase/server

# Frontend (front/) — login, sesión vía cookies
cd front
npm install @supabase/supabase-js @supabase/ssr
```

No son intercambiables ni redundantes — cada uno resuelve un problema distinto en una capa distinta del stack.

---

## 10. Migrar — por fin

```bash
cd back
pnpm exec prisma migrate dev --name init_modelo_completo
```

Si todo lo de arriba está bien, esto debería correr limpio. Verificar con:

```bash
pnpm exec prisma studio
```

---

## Checklist resumen — para la próxima vez que se conecte un proyecto nuevo a Supabase

- [ ] Prisma fijado en versión 6.x (`prisma@6`, `@prisma/client@6`)
- [ ] `pnpm approve-builds --all` corrido después de cada instalación nueva de Prisma/Next.js
- [ ] Ningún `prisma.config.ts` en la raíz (eso es de Prisma 7)
- [ ] Data API apagada, auto-exponer tablas apagado, RLS automático encendido — configurado al crear el proyecto en Supabase
- [ ] `DATABASE_URL` = Transaction pooler (6543) + `?pgbouncer=true`
- [ ] `DIRECT_URL` = Session pooler (5432), sin `?pgbouncer=true`
- [ ] Nunca usar el host `db.[ref].supabase.co` directo (IPv6 only, falla en la mayoría de redes)
- [ ] Contraseña sin caracteres especiales, o correctamente codificada
- [ ] `.env` se llama exactamente `.env` (no `.env.txt`), está en la raíz de `back/`
- [ ] `SUPABASE_SECRET_KEY` solo en `back/.env`, nunca en el frontend, nunca con prefijo `NEXT_PUBLIC_`
- [ ] `@supabase/server` en el backend, `@supabase/ssr` + `@supabase/supabase-js` en el frontend — no confundir
